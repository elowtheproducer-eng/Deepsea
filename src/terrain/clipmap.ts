/**
 * GPU Geometry Clipmap Terrain (v2.1 §4.3 + v2.2 §4 & §6).
 * - Static ring buffers created once per (N, rings) config, split into 12 angular sectors.
 * - Exact-lattice world-space noise in highp vertex shader matching heightfield.ts CPU twin.
 * - Geomorphing across outer 25% of each ring + skirts to prevent LOD pops/cracks.
 * - Photon-Budget LOD: fits cell0 and culls sectors by reach.omni, reach.cone, and sonar.
 * - <= 3 vec4 varyings (vA, vB, vC), mediump fragment shader with strata/sediment/ripples.
 */

import * as THREE from 'three';
import { TERRAIN_OCTAVES } from './heightfield';
import { computeExactLattice } from '../world/coords';
import { Reach, SonarState } from '../types';
import { CONFIG } from '../core/config';
import {
  WATER_UNIFORMS_GLSL,
  WATER_SHADE_GLSL,
  WaterUniforms,
  buildAnalyticBeamGlsl,
} from '../shaders/waterCommon.glsl';

interface SectorMesh {
  mesh: THREE.Mesh;
  dirX: number; // unit sector midpoint direction XZ
  dirZ: number;
  midRadiusNorm: number; // normalized radius in ring units
  halfChordNorm: number;
}

interface ClipmapRing {
  ringIndex: number;
  group: THREE.Group;
  geometry: THREE.BufferGeometry;
  sectors: SectorMesh[];
  material: THREE.ShaderMaterial;
  enabled: boolean;
  cellSize: number;
  innerRadius: number;
  outerRadius: number;
  snapX: number;
  snapZ: number;
}

const SECTOR_COUNT = 12;

function buildClipmapVertexShader(maxOctaves: number): string {
  const octFreqs = TERRAIN_OCTAVES.map((o) => o.freq.toFixed(6)).join(', ');
  const octAmps = TERRAIN_OCTAVES.map((o) => o.amp.toFixed(4)).join(', ');
  const octRidged = TERRAIN_OCTAVES.map((o) => (o.ridged ? '1.0' : '0.0')).join(', ');

  return /* glsl */ `
precision highp float;
precision highp int;

in vec2 aGrid;
in float aSkirt;

uniform vec2 uSnapRel;
uniform float uCell;
uniform float uRingHalfSpan;
uniform float uWorldLat;
uniform float uWorldLon;
uniform float uVerticalExag;
uniform float uDetailAmp;
uniform float uMicroEnabled;
uniform float uSeaLevel;
uniform vec2 uOrigIntF[10];
uniform vec2 uOrigFrac[10];

out vec4 vA; // xyz = normal, w = predictedMask (Honest Map)
out vec4 vB; // xyz = camera-relative pos, w = view dist
out vec4 vC; // x = worldY, y = slope, z = cavity, w = morph

const float OCT_FREQ[10] = float[10](${octFreqs});
const float OCT_AMP[10] = float[10](${octAmps});
const float OCT_RIDGED[10] = float[10](${octRidged});

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

float hash2(ivec2 c, uint seed) {
  uint hx = uint(c.x) * 1597334677u;
  uint hz = pcg(uint(c.y) + 0x9E3779B9u);
  return float(pcg(hx ^ hz ^ seed)) * (1.0 / 4294967295.0);
}

// Returns vec3(value, d/dx, d/dz)
vec3 smoothNoiseDeriv(vec2 localXZ, int octIdx, float freq) {
  vec2 q = localXZ * freq + uOrigFrac[octIdx];
  vec2 fl = floor(q);
  ivec2 cell = ivec2(round(uOrigIntF[octIdx])) + ivec2(fl);
  vec2 f = q - fl;
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);

  uint seed = uint(${CONFIG.seed}) + uint(octIdx) * 101u;
  float a = hash2(cell, seed);
  float b = hash2(cell + ivec2(1, 0), seed);
  float c = hash2(cell + ivec2(0, 1), seed);
  float d = hash2(cell + ivec2(1, 1), seed);

  float k0 = a;
  float k1 = b - a;
  float k2 = c - a;
  float k3 = a - b - c + d;

  float val = k0 + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
  float dx = (k1 + k3 * u.y) * du.x * freq;
  float dz = (k2 + k3 * u.x) * du.y * freq;
  return vec3(val, dx, dz);
}

float macroBathymetry(vec2 localXZ) {
  // Approximate local lat/lon around origin for regional shelves, blue hole, trench
  float lat = uWorldLat + localXZ.y / 111319.49;
  float cosLat = max(0.08, cos(radians(uWorldLat)));
  float lon = uWorldLon + localXZ.x / (111319.49 * cosLat);

  float dDeans = length(vec2((lat - 23.10639) * 111319.0, (lon + 75.00861) * 102400.0));
  if (dDeans < 2500.0) {
    float shaft = dDeans < 65.0 ? -202.0 * (1.0 - pow(dDeans / 65.0, 3.0)) : 0.0;
    float bank = -12.0 - 0.08 * max(0.0, dDeans - 120.0);
    return min(bank, shaft - 6.0);
  }

  float dMariana = length(vec2((lat - 11.373) * 111319.0, (lon - 142.591) * 109100.0));
  if (dMariana < 35000.0) {
    return -10920.0 + min(4800.0, dMariana * 0.22);
  }

  float dGbr = length(vec2((lat + 18.287) * 111319.0, (lon - 147.699) * 105700.0));
  if (dGbr < 8000.0) {
    return -14.0 - max(0.0, dGbr - 800.0) * 0.04;
  }

  float dTitanic = length(vec2((lat - 41.73) * 111319.0, (lon + 49.95) * 83000.0));
  if (dTitanic < 15000.0) {
    return -3810.0 + sin(dTitanic * 0.0005) * 65.0;
  }

  float dFalse = length(vec2((lat + 34.135) * 111319.0, (lon - 18.586) * 92100.0));
  if (dFalse < 12000.0) {
    return -36.0 - dFalse * 0.015;
  }

  float basin = -2600.0 + 2250.0 * cos(lat * 0.14) * sin(lon * 0.14);
  float ridge = sin(lon * 0.35 + cos(lat * 0.22)) * 950.0;
  return min(-28.0, basin + ridge);
}

void main() {
  vec2 localXZ = uSnapRel + aGrid * uCell;
  float cheb = max(abs(aGrid.x * uCell), abs(aGrid.y * uCell));
  float morph = smoothstep(uRingHalfSpan * 0.72, uRingHalfSpan, cheb);

  // Shallow damping near blue holes / reefs so macro octaves don't fill shafts
  float lat = uWorldLat + localXZ.y / 111319.49;
  float cosLat = max(0.08, cos(radians(uWorldLat)));
  float lon = uWorldLon + localXZ.x / (111319.49 * cosLat);
  float dDeans = length(vec2((lat - 23.10639) * 111319.0, (lon + 75.00861) * 102400.0));
  float dGbr = length(vec2((lat + 18.287) * 111319.0, (lon - 147.699) * 105700.0));
  float shallowDamp = min(1.0, dDeans < 400.0 ? max(0.05, (dDeans - 30.0) / 370.0) : (dGbr < 2000.0 ? 0.08 : 1.0));

  // Honest Map predicted mask (simulates GEBCO TID: ridges/trenches partly surveyed, deep plains predicted)
  float tidSample = smoothNoiseDeriv(localXZ, 0, 0.00045).x;
  float predictedMask = smoothstep(0.35, 0.78, tidSample);
  float tidAmp = mix(0.65, 1.25, predictedMask);

  float relief = 0.0;
  vec2 grad = vec2(0.0);
  float cavity = 0.0;

  for (int i = 0; i < ${maxOctaves}; i++) {
    float freq = OCT_FREQ[i];
    // Nyquist LOD guard: skip octaves with wavelength < 4 * cell
    float nyquist = smoothstep(4.0 * uCell, 8.0 * uCell, 1.0 / freq);
    float microGate = i >= 5 ? uMicroEnabled : 1.0;
    float bandScale = i < 2 ? shallowDamp : tidAmp;
    float weight = OCT_AMP[i] * uDetailAmp * nyquist * microGate * bandScale;

    vec3 nd = smoothNoiseDeriv(localXZ, i, freq);
    float s = nd.x * 2.0 - 1.0;
    float val = s;
    vec2 dval = nd.yz * 2.0;

    if (OCT_RIDGED[i] > 0.5) {
      float signS = s >= 0.0 ? 1.0 : -1.0;
      val = (1.0 - abs(s)) * 2.0 - 1.0;
      dval = -signS * dval * 2.0;
    }

    relief += val * weight;
    grad += dval * weight;
    if (i >= 4) cavity += val * 0.2;
  }

  float worldY = min(-4.0, macroBathymetry(localXZ) + relief) * uVerticalExag;
  worldY -= aSkirt * uCell * 2.2;

  vec3 normal = normalize(vec3(-grad.x * uVerticalExag, 1.0, -grad.y * uVerticalExag));
  vec4 mvPos = modelViewMatrix * vec4(localXZ.x, worldY, localXZ.y, 1.0);
  float dist = length(mvPos.xyz);

  vA = vec4(normal, predictedMask);
  vB = vec4(localXZ.x, worldY - (cameraPosition.y), localXZ.y, dist);
  vC = vec4(worldY, 1.0 - normal.y, clamp(0.5 - cavity, 0.0, 1.0), morph);

  gl_Position = projectionMatrix * mvPos;
}
`;
}

function buildClipmapFragmentShader(beamSteps: 0 | 4 | 6): string {
  return /* glsl */ `
precision mediump float;
precision mediump int;

${WATER_UNIFORMS_GLSL}
${buildAnalyticBeamGlsl(beamSteps)}
${WATER_SHADE_GLSL}

in vec4 vA;
in vec4 vB;
in vec4 vC;

uniform highp vec3 uCamRelPos;

out vec4 fragColor;

void main() {
  mediump vec3 N = normalize(vA.xyz);
  mediump float predictedMask = vA.w;
  highp float worldY = vC.x;
  mediump float slope = vC.y;
  mediump float cavity = vC.z;

  // World-space procedural substrate shading (rock strata, up-facing sediment, ripples)
  highp vec2 xz = vB.xz + uCamRelPos.xz;
  mediump float strata = sin(worldY * 0.65 + sin(xz.x * 0.08 + xz.y * 0.07) * 2.0) * 0.5 + 0.5;
  mediump float sedimentMask = smoothstep(0.32, 0.08, slope);

  // Ripples on flat sediment
  mediump float ripple = sin(xz.x * 3.8 + sin(xz.y * 0.6) * 1.4) * 0.5 + 0.5;
  mediump vec3 rockCol = mix(vec3(0.16, 0.14, 0.13), vec3(0.28, 0.24, 0.20), strata);
  mediump vec3 sandCol = mix(vec3(0.46, 0.42, 0.34), vec3(0.56, 0.51, 0.40), ripple * 0.45);
  mediump vec3 siltCol = vec3(0.24, 0.25, 0.24);

  mediump float depthBelow = max(0.0, uSeaLevel - worldY);
  mediump vec3 sedCol = mix(sandCol, siltCol, smoothstep(45.0, 600.0, depthBelow));

  // Warm rust/coral tint in shallow tropical shelves vs dark basalt in abyss
  mediump vec3 albedo = mix(rockCol, sedCol, sedimentMask);
  albedo *= mix(0.62, 1.08, cavity);

  // Micro-normal ripple perturbation on flat sediment
  mediump vec3 shadedN = normalize(N + vec3(cos(xz.x * 3.8) * 0.14 * sedimentMask, 0.0, 0.0));

  highp vec3 relPos = vec3(vB.x, worldY - uCamRelPos.y, vB.z);
  highp float dist = length(relPos);

  mediump vec3 col = applyWaterOptics(albedo, shadedN, relPos, dist, worldY, predictedMask);
  fragColor = vec4(col, 1.0);
}
`;
}

export class ClipmapTerrain {
  root = new THREE.Group();
  private rings: ClipmapRing[] = [];
  private materialsByRing: Map<string, THREE.ShaderMaterial> = new Map();
  private waterUniforms: WaterUniforms;
  private N = 192;
  private ringCount = 6;
  private beamSteps: 0 | 4 | 6 = 4;

  // Pre-allocated culling scratch objects (zero GC)
  private frustum = new THREE.Frustum();
  private projScreenMat = new THREE.Matrix4();
  private scratchSphere = new THREE.Sphere();
  private scratchCenter = new THREE.Vector3();
  private scratchToSector = new THREE.Vector3();

  private origInts: THREE.Vector2[] = Array.from({ length: 10 }, () => new THREE.Vector2());
  private origFracs: THREE.Vector2[] = Array.from({ length: 10 }, () => new THREE.Vector2());
  private camRelPosUniform = new THREE.Vector3();

  activeRingsCount = 0;
  visibleSectorsCount = 0;
  cell0Meters = 0.04;

  constructor(waterUniforms: WaterUniforms) {
    this.waterUniforms = waterUniforms;
    this.root.matrixAutoUpdate = false;
    this.rebuild(192, 6, 4);
  }

  /**
   * Build clipmap ring meshes once for given N and ringCount (only called when governor steps N).
   */
  rebuild(N: number, ringCount: number, beamSteps: 0 | 4 | 6) {
    if (this.N === N && this.ringCount === ringCount && this.beamSteps === beamSteps && this.rings.length > 0) {
      return;
    }
    this.dispose();
    this.N = N;
    this.ringCount = ringCount;
    this.beamSteps = beamSteps;

    const half = N / 2;
    const holeHalf = N / 4;

    for (let r = 0; r < ringCount; r++) {
      const hasHole = r > 0;
      const vertsPerSide = N + 1;
      const vertCount = vertsPerSide * vertsPerSide;
      const gridArr = new Float32Array(vertCount * 2);
      const skirtArr = new Float32Array(vertCount);

      let ptr = 0;
      for (let gz = -half; gz <= half; gz++) {
        for (let gx = -half; gx <= half; gx++) {
          gridArr[ptr * 2] = gx;
          gridArr[ptr * 2 + 1] = gz;
          const isBorder = Math.abs(gx) === half || Math.abs(gz) === half;
          skirtArr[ptr] = isBorder ? 1.0 : 0.0;
          ptr++;
        }
      }

      // Partition ring quads into 12 angular sectors
      const sectorIndices: number[][] = Array.from({ length: SECTOR_COUNT }, () => []);
      for (let gz = -half; gz < half; gz++) {
        for (let gx = -half; gx < half; gx++) {
          const cx = gx + 0.5;
          const cz = gz + 0.5;
          if (hasHole && Math.abs(cx) < holeHalf && Math.abs(cz) < holeHalf) {
            continue;
          }
          let angle = Math.atan2(cz, cx);
          if (angle < 0) angle += Math.PI * 2;
          const sIdx = Math.min(SECTOR_COUNT - 1, Math.floor((angle / (Math.PI * 2)) * SECTOR_COUNT));

          const row = gz + half;
          const col = gx + half;
          const i00 = row * vertsPerSide + col;
          const i10 = i00 + 1;
          const i01 = (row + 1) * vertsPerSide + col;
          const i11 = i01 + 1;

          sectorIndices[sIdx].push(i00, i01, i10, i10, i01, i11);
        }
      }

      const maxOctaves = Math.max(3, Math.min(10, 10 - r));
      const mat = this.createRingMaterial(maxOctaves, beamSteps);

      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      const sectors: SectorMesh[] = [];

      // Shared base geometry attributes, per-sector index buffer
      const baseGeo = new THREE.BufferGeometry();
      baseGeo.setAttribute('aGrid', new THREE.BufferAttribute(gridArr, 2));
      baseGeo.setAttribute('aSkirt', new THREE.BufferAttribute(skirtArr, 1));

      for (let s = 0; s < SECTOR_COUNT; s++) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('aGrid', baseGeo.getAttribute('aGrid'));
        geo.setAttribute('aSkirt', baseGeo.getAttribute('aSkirt'));
        geo.setIndex(sectorIndices[s]);

        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false; // we perform exact zero-GC cone/sphere/frustum culling in JS
        mesh.matrixAutoUpdate = false;
        group.add(mesh);

        const midAngle = ((s + 0.5) / SECTOR_COUNT) * Math.PI * 2;
        const innerNorm = hasHole ? holeHalf : 0;
        const outerNorm = half * 1.414;
        const midRadiusNorm = 0.5 * (innerNorm + outerNorm);
        const halfChordNorm = 0.5 * (outerNorm - innerNorm) + outerNorm * 0.28;

        sectors.push({
          mesh,
          dirX: Math.cos(midAngle),
          dirZ: Math.sin(midAngle),
          midRadiusNorm,
          halfChordNorm,
        });
      }

      this.root.add(group);
      this.rings.push({
        ringIndex: r,
        group,
        geometry: baseGeo,
        sectors,
        material: mat,
        enabled: true,
        cellSize: 0.04 * Math.pow(2, r),
        innerRadius: hasHole ? holeHalf * 0.04 * Math.pow(2, r) : 0,
        outerRadius: half * 0.04 * Math.pow(2, r),
        snapX: 0,
        snapZ: 0,
      });
    }
  }

  private createRingMaterial(maxOctaves: number, beamSteps: 0 | 4 | 6): THREE.ShaderMaterial {
    const key = `${maxOctaves}_${beamSteps}`;
    const existing = this.materialsByRing.get(key);
    if (existing) return existing;

    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: buildClipmapVertexShader(maxOctaves),
      fragmentShader: buildClipmapFragmentShader(beamSteps),
      uniforms: {
        ...this.waterUniforms,
        uSnapRel: { value: new THREE.Vector2() },
        uCell: { value: 0.1 },
        uRingHalfSpan: { value: 10 },
        uWorldLat: { value: 0 },
        uWorldLon: { value: 0 },
        uVerticalExag: { value: 1 },
        uDetailAmp: { value: 1 },
        uMicroEnabled: { value: 1 },
        uOrigIntF: { value: this.origInts },
        uOrigFrac: { value: this.origFracs },
        uCamRelPos: { value: this.camRelPosUniform },
      },
      side: THREE.FrontSide,
    });
    this.materialsByRing.set(key, mat);
    return mat;
  }

  setWireframe(wireframe: boolean) {
    this.materialsByRing.forEach((m) => {
      m.wireframe = wireframe;
    });
  }

  /**
   * Update exact-lattice uniforms, fit cell0 to Photon-Budget reach(), and cull ring sectors.
   */
  update(params: {
    camera: THREE.PerspectiveCamera;
    camEast: number;
    camNorth: number;
    camH: number;
    originLat: number;
    originLon: number;
    reach: Reach;
    minCell: number;
    maxCell: number;
    torchPos: THREE.Vector3;
    torchDir: THREE.Vector3;
    sonar: SonarState;
    verticalExag: number;
    detailAmp: number;
    microEnabled: boolean;
    seaLevel: number;
    isWarp: boolean;
  }) {
    const {
      camera,
      camEast,
      camNorth,
      camH,
      originLat,
      originLon,
      reach,
      minCell,
      maxCell,
      torchPos,
      torchDir,
      sonar,
      verticalExag,
      detailAmp,
      microEnabled,
      seaLevel,
      isWarp,
    } = params;

    // 1. Update exact-lattice splits for all 10 octaves using f64 origin-centered world coords
    // Here originWorld is (0, 0) since localXZ = uSnapRel + aGrid * uCell is relative to camera,
    // and we evaluate world coordinates = (camEast, camNorth) + localXZ
    for (let i = 0; i < TERRAIN_OCTAVES.length; i++) {
      const lat = computeExactLattice(camEast, camNorth, TERRAIN_OCTAVES[i].freq);
      this.origInts[i].set(lat.intX, lat.intZ);
      this.origFracs[i].set(lat.fracX, lat.fracZ);
    }

    this.camRelPosUniform.set(0, camH, 0);

    // 2. Photon-Budget LOD cell0 fit (v2.1 §4.4.2)
    const reachMax = Math.max(reach.cone, reach.coarse);
    const halfN = this.N * 0.5;
    const rawCell0 = (reachMax * 1.1) / (halfN * Math.pow(2, this.ringCount - 1));
    const cell0 = isWarp
      ? maxCell
      : Math.max(minCell, Math.min(maxCell, rawCell0));
    this.cell0Meters = cell0;

    // Update frustum matrix
    camera.updateMatrixWorld();
    this.projScreenMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMat);

    const cosHalfCone = Math.cos(reach.coneHalfAngle + 0.22); // +12.5° safety margin
    const sinHalfCone = Math.sin(reach.coneHalfAngle + 0.22);

    let activeRings = 0;
    let visibleSectors = 0;

    for (let r = 0; r < this.rings.length; r++) {
      const ring = this.rings[r];
      const cell = cell0 * Math.pow(2, r);
      const innerR = r === 0 ? 0 : (this.N * 0.25) * cell;
      const outerR = halfN * cell;
      ring.cellSize = cell;
      ring.innerRadius = innerR;
      ring.outerRadius = outerR;

      // Rings completely beyond reachMax are skipped
      ring.enabled = innerR < reachMax * 1.15;
      ring.group.visible = ring.enabled;
      if (!ring.enabled) continue;
      activeRings++;

      // Snap ring centre in WORLD f64 space to 2*cell increments so vertices never swim
      const snapStep = cell * 2.0;
      const worldSnapX = Math.round(camEast / snapStep) * snapStep;
      const worldSnapZ = Math.round(camNorth / snapStep) * snapStep;
      const snapRelX = worldSnapX - camEast;
      const snapRelZ = worldSnapZ - camNorth;

      const u = ring.material.uniforms;
      u.uSnapRel.value.set(snapRelX, snapRelZ);
      u.uCell.value = cell;
      u.uRingHalfSpan.value = outerR;
      u.uWorldLat.value = originLat;
      u.uWorldLon.value = originLon;
      u.uVerticalExag.value = verticalExag;
      u.uDetailAmp.value = detailAmp;
      u.uMicroEnabled.value = microEnabled && !isWarp ? 1.0 : 0.0;
      u.uSeaLevel.value = seaLevel;

      // 3. Per-sector frustum + omni-sphere / torch-cone / sonar culling (v2.1 §4.4.3)
      for (let s = 0; s < ring.sectors.length; s++) {
        const sec = ring.sectors[s];
        const midR = sec.midRadiusNorm * cell;
        const sphereR = Math.max(sec.halfChordNorm * cell, 450.0); // include vertical relief tolerance
        const cx = snapRelX + sec.dirX * midR;
        const cz = snapRelZ + sec.dirZ * midR;
        // Center vertically around camera/terrain band
        const cy = Math.min(-4, camH - 120);
        this.scratchCenter.set(cx, cy, cz);
        this.scratchSphere.set(this.scratchCenter, sphereR);

        if (!this.frustum.intersectsSphere(this.scratchSphere)) {
          sec.mesh.visible = false;
          continue;
        }

        // Distance from camera (0, camH, 0) in XZ + bounded Y
        const dx = cx;
        const dz = cz;
        const distXZ = Math.hypot(dx, dz);

        const inOmni = distXZ - sec.halfChordNorm * cell < reach.omni;
        const inSonar = sonar.active && distXZ - sec.halfChordNorm * cell < reach.coarse;

        let inCone = false;
        if (this.waterUniforms.uTorchOn.value > 0.5 && distXZ - sec.halfChordNorm * cell < reach.cone) {
          this.scratchToSector.set(cx - torchPos.x, 0, cz - torchPos.z);
          const len = this.scratchToSector.length();
          if (len < sec.halfChordNorm * cell + 10) {
            inCone = true;
          } else {
            this.scratchToSector.multiplyScalar(1 / len);
            // Horizontal cone dot test with sphere angular radius expansion
            const dirDot = this.scratchToSector.x * torchDir.x + this.scratchToSector.z * torchDir.z;
            const angExpand = (sec.halfChordNorm * cell) / len;
            inCone = dirDot > cosHalfCone - sinHalfCone * angExpand - 0.18;
          }
        }

        const vis = inOmni || inCone || inSonar || isWarp;
        sec.mesh.visible = vis;
        if (vis) visibleSectors++;
      }
    }

    this.activeRingsCount = activeRings;
    this.visibleSectorsCount = visibleSectors;
  }

  getAllMaterials(): THREE.Material[] {
    return Array.from(this.materialsByRing.values());
  }

  dispose() {
    for (const ring of this.rings) {
      ring.geometry.dispose();
      for (const s of ring.sectors) {
        s.mesh.geometry.dispose();
      }
      this.root.remove(ring.group);
    }
    this.rings = [];
    this.materialsByRing.forEach((m) => m.dispose());
    this.materialsByRing.clear();
  }
}
