/**
 * Instanced Content Density & Scale Gizmos (v2.1 §4.5 U6 + v2.2 §4.6).
 * - Instanced rocks, swaying corals/sponges, vertex-shader animated fish schools, bioluminescent glow sprites.
 * - Uses DynamicDrawUsage + dirty updateRanges driven by SpawnWorker transferable buffers.
 * - Includes 1m / 10m scale-check cubes and torch cone wireframe gizmo (§20.3).
 */

import * as THREE from 'three';
import {
  WATER_UNIFORMS_GLSL,
  WATER_SHADE_GLSL,
  WaterUniforms,
  buildAnalyticBeamGlsl,
} from '../shaders/waterCommon.glsl';

const STRIDE = 8;

function createInstancedBioMaterial(
  waterUniforms: WaterUniforms,
  beamSteps: 0 | 4 | 6,
  mode: 'rock' | 'coral' | 'fish'
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...waterUniforms,
      uCamWorldY: { value: 0 },
    },
    vertexShader: /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uCamWorldY;

out vec4 vA; // xyz = normal, w = tint/eyeshine
out vec4 vB; // xyz = relPos, w = dist
out vec4 vC; // rgb = instanceColor, w = worldY

void main() {
  vec3 pos = position;
  vec3 norm = normal;

  #ifdef USE_INSTANCING
    mat4 instMat = instanceMatrix;
  #else
    mat4 instMat = mat4(1.0);
  #endif

  #ifdef USE_INSTANCING_COLOR
    vec3 instCol = instanceColor;
  #else
    vec3 instCol = vec3(0.65, 0.72, 0.78);
  #endif

  ${
    mode === 'coral'
      ? /* glsl */ `
  // Gentle underwater current sway anchored at base (y = 0)
  float swayPhase = uTime * 1.4 + instMat[3][0] * 0.4 + instMat[3][2] * 0.3;
  float bend = max(0.0, pos.y) * 0.14;
  pos.x += sin(swayPhase) * bend;
  pos.z += cos(swayPhase * 0.8) * bend * 0.7;
  `
      : mode === 'fish'
      ? /* glsl */ `
  // Spine sine-wave swim animation (zero CPU cost)
  float swimPhase = uTime * 7.5 + instMat[3][0] * 0.7 + instMat[3][2] * 0.5;
  float tailMask = smoothstep(-0.1, 0.55, -pos.z);
  pos.x += sin(swimPhase - pos.z * 5.0) * 0.16 * tailMask;
  `
      : ''
  }

  vec4 worldPos = instMat * vec4(pos, 1.0);
  vec3 worldN = normalize(mat3(instMat) * norm);
  vec4 mvPos = viewMatrix * worldPos;
  float dist = length(mvPos.xyz);

  vA = vec4(worldN, ${mode === 'fish' ? 'step(0.28, pos.z)' : '0.0'});
  vB = vec4(worldPos.x, worldPos.y - uCamWorldY, worldPos.z, dist);
  vC = vec4(instCol, worldPos.y);
  gl_Position = projectionMatrix * mvPos;
}
`,
    fragmentShader: /* glsl */ `
precision mediump float;
${WATER_UNIFORMS_GLSL}
${buildAnalyticBeamGlsl(beamSteps)}
${WATER_SHADE_GLSL}

in vec4 vA;
in vec4 vB;
in vec4 vC;
out vec4 fragColor;

void main() {
  mediump vec3 N = normalize(vA.xyz);
  mediump vec3 albedo = vC.rgb;
  mediump vec3 col = applyWaterOptics(albedo, N, vB.xyz, vB.w, vC.w, 0.0);

  // Bioluminescence & eyeshine glint for deep-sea fauna inside torch cone
  if (vA.w > 0.5 && uTorchOn > 0.5) {
    mediump vec3 dir = normalize(vec3(vB.xyz - uTorchPos));
    mediump float inCone = smoothstep(uCosOuter, uCosInner, dot(dir, uTorchDir));
    col += vec3(0.45, 0.92, 0.98) * inCone * exp(-vB.w * 0.06) * 0.55;
  }
  fragColor = vec4(col, 1.0);
}
`,
  });
}

function buildFishGeometry(): THREE.BufferGeometry {
  // Streamlined fusiform body + tail fin (~1m normalized length along Z)
  const geo = new THREE.OctahedronGeometry(0.22, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Stretch along Z, flare tail at -Z
    const tail = z < -0.08 ? 1.8 : 1.0;
    pos.setXYZ(i, x * 0.55, y * 0.85 * tail, z * 2.4);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildCoralGeometry(): THREE.BufferGeometry {
  // Multi-lobe branching coral / sponge silhouette pivoted at bottom center
  const geo = new THREE.ConeGeometry(0.45, 1.2, 6, 2);
  geo.translate(0, 0.6, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const flare = 0.6 + 0.85 * y;
    pos.setXYZ(i, x * flare, y, z * flare);
  }
  geo.computeVertexNormals();
  return geo;
}

export class LifeSystem {
  group = new THREE.Group();
  private rocksMesh: THREE.InstancedMesh;
  private coralsMesh: THREE.InstancedMesh;
  private fishMesh: THREE.InstancedMesh;

  private rockMat: THREE.ShaderMaterial;
  private coralMat: THREE.ShaderMaterial;
  private fishMat: THREE.ShaderMaterial;

  private maxRocks = 2400;
  private maxCorals = 1600;
  private maxFish = 350;

  private rockData = new Float32Array(0);
  private rockCount = 0;
  private coralData = new Float32Array(0);
  private coralCount = 0;
  private fishData = new Float32Array(0);
  private fishCount = 0;

  private worker: Worker | null = null;
  private pendingRequest = false;
  private nextRequestId = 1;
  private lastSpawnEast = 1e9;
  private lastSpawnNorth = 1e9;

  // Debug Scale Cubes (1m & 10m) and Torch Gizmo
  scaleCubesGroup = new THREE.Group();
  torchGizmo: THREE.LineSegments;

  // Pre-allocated scratch math (zero GC)
  private mat4 = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler();
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private color = new THREE.Color();

  constructor(waterUniforms: WaterUniforms) {
    this.group.matrixAutoUpdate = false;

    const rockGeo = new THREE.DodecahedronGeometry(0.65, 1);
    this.rockMat = createInstancedBioMaterial(waterUniforms, 4, 'rock');
    this.rocksMesh = new THREE.InstancedMesh(rockGeo, this.rockMat, this.maxRocks);
    this.rocksMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rocksMesh.setColorAt(0, this.color.setRGB(0.25, 0.24, 0.22));
    this.rocksMesh.count = 0;
    this.rocksMesh.frustumCulled = false;
    this.group.add(this.rocksMesh);

    const coralGeo = buildCoralGeometry();
    this.coralMat = createInstancedBioMaterial(waterUniforms, 4, 'coral');
    this.coralsMesh = new THREE.InstancedMesh(coralGeo, this.coralMat, this.maxCorals);
    this.coralsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coralsMesh.setColorAt(0, this.color.setRGB(0.75, 0.65, 0.45));
    this.coralsMesh.count = 0;
    this.coralsMesh.frustumCulled = false;
    this.group.add(this.coralsMesh);

    const fishGeo = buildFishGeometry();
    this.fishMat = createInstancedBioMaterial(waterUniforms, 4, 'fish');
    this.fishMesh = new THREE.InstancedMesh(fishGeo, this.fishMat, this.maxFish);
    this.fishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fishMesh.setColorAt(0, this.color.setRGB(0.68, 0.78, 0.86));
    this.fishMesh.count = 0;
    this.fishMesh.frustumCulled = false;
    this.group.add(this.fishMesh);

    // Build 1m & 10m Scale Check Cubes (§20.3)
    const cube1 = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x38bdf8 })
    );
    cube1.position.set(-2.5, 0, -8);
    const cube10 = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(10, 10, 10)),
      new THREE.LineBasicMaterial({ color: 0xf59e0b })
    );
    cube10.position.set(8, 0, -24);
    this.scaleCubesGroup.add(cube1, cube10);
    this.scaleCubesGroup.visible = false;
    this.group.add(this.scaleCubesGroup);

    // Torch cone gizmo
    const coneGeo = new THREE.ConeGeometry(4.5, 16, 12, 1, true);
    coneGeo.rotateX(Math.PI / 2);
    coneGeo.translate(0, 0, -8);
    this.torchGizmo = new THREE.LineSegments(
      new THREE.EdgesGeometry(coneGeo),
      new THREE.LineBasicMaterial({ color: 0xfef08a })
    );
    this.torchGizmo.visible = false;
    this.group.add(this.torchGizmo);

    // Web Worker #1: SpawnWorker (guarded for WebAPK/restricted WebViews)
    try {
      this.worker = new Worker(new URL('../workers/spawnWorker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e) => {
        this.pendingRequest = false;
        const d = e.data;
        this.rockData = d.rocks;
        this.rockCount = d.rockCount;
        this.coralData = d.corals;
        this.coralCount = d.coralCount;
        this.fishData = d.fish;
        this.fishCount = d.fishCount;
        this.applyStaticBuffers(d.camEast, d.camNorth);
      };
      this.worker.onerror = () => {
        this.pendingRequest = false;
      };
    } catch {
      this.worker = null;
    }
  }

  private applyStaticBuffers(camEast: number, camNorth: number) {
    // Update rocks
    this.rocksMesh.count = Math.min(this.rockCount, this.maxRocks);
    for (let i = 0; i < this.rocksMesh.count; i++) {
      const off = i * STRIDE;
      this.pos.set(this.rockData[off] - camEast, this.rockData[off + 1], this.rockData[off + 2] - camNorth);
      this.euler.set(0, this.rockData[off + 4], 0);
      this.quat.setFromEuler(this.euler);
      const s = this.rockData[off + 3];
      this.scale.set(s, s * 0.72, s);
      this.mat4.compose(this.pos, this.quat, this.scale);
      this.rocksMesh.setMatrixAt(i, this.mat4);
      this.color.setRGB(this.rockData[off + 5], this.rockData[off + 6], this.rockData[off + 7]);
      this.rocksMesh.setColorAt(i, this.color);
    }
    this.rocksMesh.instanceMatrix.clearUpdateRanges();
    this.rocksMesh.instanceMatrix.addUpdateRange(0, this.rocksMesh.count * 16);
    this.rocksMesh.instanceMatrix.needsUpdate = true;
    if (this.rocksMesh.instanceColor) {
      this.rocksMesh.instanceColor.clearUpdateRanges();
      this.rocksMesh.instanceColor.addUpdateRange(0, this.rocksMesh.count * 3);
      this.rocksMesh.instanceColor.needsUpdate = true;
    }

    // Update corals
    this.coralsMesh.count = Math.min(this.coralCount, this.maxCorals);
    for (let i = 0; i < this.coralsMesh.count; i++) {
      const off = i * STRIDE;
      this.pos.set(this.coralData[off] - camEast, this.coralData[off + 1], this.coralData[off + 2] - camNorth);
      this.euler.set(0, this.coralData[off + 4], 0);
      this.quat.setFromEuler(this.euler);
      const s = this.coralData[off + 3];
      this.scale.set(s, s, s);
      this.mat4.compose(this.pos, this.quat, this.scale);
      this.coralsMesh.setMatrixAt(i, this.mat4);
      this.color.setRGB(this.coralData[off + 5], this.coralData[off + 6], this.coralData[off + 7]);
      this.coralsMesh.setColorAt(i, this.color);
    }
    this.coralsMesh.instanceMatrix.clearUpdateRanges();
    this.coralsMesh.instanceMatrix.addUpdateRange(0, this.coralsMesh.count * 16);
    this.coralsMesh.instanceMatrix.needsUpdate = true;
    if (this.coralsMesh.instanceColor) {
      this.coralsMesh.instanceColor.clearUpdateRanges();
      this.coralsMesh.instanceColor.addUpdateRange(0, this.coralsMesh.count * 3);
      this.coralsMesh.instanceColor.needsUpdate = true;
    }

    // Initialize fish colors
    this.fishMesh.count = Math.min(this.fishCount, this.maxFish);
    for (let i = 0; i < this.fishMesh.count; i++) {
      const off = i * STRIDE;
      this.color.setRGB(this.fishData[off + 5], this.fishData[off + 6], this.fishData[off + 7]);
      this.fishMesh.setColorAt(i, this.color);
    }
    if (this.fishMesh.instanceColor) {
      this.fishMesh.instanceColor.clearUpdateRanges();
      this.fishMesh.instanceColor.addUpdateRange(0, this.fishMesh.count * 3);
      this.fishMesh.instanceColor.needsUpdate = true;
    }
  }

  update(params: {
    timeSec: number;
    camEast: number;
    camNorth: number;
    camH: number;
    originLat: number;
    originLon: number;
    reachMeters: number;
    timeOfDay: number;
    seed: number;
    showActors: boolean;
    showScaleCubes: boolean;
    showTorchGizmo: boolean;
    camera: THREE.PerspectiveCamera;
    isWarp: boolean;
  }) {
    const {
      timeSec,
      camEast,
      camNorth,
      camH,
      originLat,
      originLon,
      reachMeters,
      timeOfDay,
      seed,
      showActors,
      showScaleCubes,
      showTorchGizmo,
      camera,
      isWarp,
    } = params;

    this.rocksMesh.visible = !isWarp;
    this.coralsMesh.visible = !isWarp;
    this.fishMesh.visible = showActors && !isWarp;

    this.rockMat.uniforms.uCamWorldY.value = camH;
    this.coralMat.uniforms.uCamWorldY.value = camH;
    this.fishMat.uniforms.uCamWorldY.value = camH;

    // Debug scale cubes & torch gizmo follow camera
    this.scaleCubesGroup.visible = showScaleCubes;
    if (showScaleCubes) {
      this.scaleCubesGroup.position.set(0, camH, 0);
    }
    this.torchGizmo.visible = showTorchGizmo;
    if (showTorchGizmo) {
      this.torchGizmo.position.set(0, camH, 0);
      this.torchGizmo.quaternion.copy(camera.quaternion);
    }

    if (isWarp) return;

    // Trigger SpawnWorker when camera moves > 12 m from last spawn center
    const moved = Math.hypot(camEast - this.lastSpawnEast, camNorth - this.lastSpawnNorth);
    if (this.worker && !this.pendingRequest && moved > 12.0) {
      this.pendingRequest = true;
      this.lastSpawnEast = camEast;
      this.lastSpawnNorth = camNorth;
      this.worker.postMessage({
        requestId: this.nextRequestId++,
        camEast,
        camNorth,
        camH,
        originLat,
        originLon,
        reachMeters,
        maxRocks: this.maxRocks,
        maxCorals: this.maxCorals,
        maxFish: this.maxFish,
        timeOfDay,
        seed,
      });
    }

    // Closed-form Lissajous swimming paths for active fish instances (zero state, deterministic)
    if (this.fishMesh.visible && this.fishMesh.count > 0) {
      for (let i = 0; i < this.fishMesh.count; i++) {
        const off = i * STRIDE;
        const ax = this.fishData[off] - camEast;
        const ay = this.fishData[off + 1];
        const az = this.fishData[off + 2] - camNorth;
        const s = this.fishData[off + 3];
        const phase = this.fishData[off + 4];

        const speed = 0.45 + (i % 5) * 0.12;
        const t = timeSec * speed + phase;
        const rx = 4.5 + (i % 3) * 2.5;
        const rz = 4.5 + ((i + 1) % 3) * 2.5;

        const px = ax + Math.cos(t) * rx;
        const pz = az + Math.sin(t * 0.85) * rz;
        const py = ay + Math.sin(t * 0.5) * 0.9;

        const vx = -Math.sin(t) * rx * speed;
        const vz = Math.cos(t * 0.85) * rz * 0.85 * speed;
        const yaw = Math.atan2(vx, vz);

        this.pos.set(px, py, pz);
        this.euler.set(0, yaw, 0);
        this.quat.setFromEuler(this.euler);
        this.scale.set(s, s, s);
        this.mat4.compose(this.pos, this.quat, this.scale);
        this.fishMesh.setMatrixAt(i, this.mat4);
      }
      this.fishMesh.instanceMatrix.clearUpdateRanges();
      this.fishMesh.instanceMatrix.addUpdateRange(0, this.fishMesh.count * 16);
      this.fishMesh.instanceMatrix.needsUpdate = true;
    }

    // Re-offset rocks/corals by latest camEast/camNorth if we moved slightly between worker updates
    if (this.rockCount > 0 && moved > 0.01) {
      for (let i = 0; i < this.rocksMesh.count; i++) {
        const off = i * STRIDE;
        this.pos.set(this.rockData[off] - camEast, this.rockData[off + 1], this.rockData[off + 2] - camNorth);
        this.euler.set(0, this.rockData[off + 4], 0);
        this.quat.setFromEuler(this.euler);
        const s = this.rockData[off + 3];
        this.scale.set(s, s * 0.72, s);
        this.mat4.compose(this.pos, this.quat, this.scale);
        this.rocksMesh.setMatrixAt(i, this.mat4);
      }
      this.rocksMesh.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < this.coralsMesh.count; i++) {
        const off = i * STRIDE;
        this.pos.set(this.coralData[off] - camEast, this.coralData[off + 1], this.coralData[off + 2] - camNorth);
        this.euler.set(0, this.coralData[off + 4], 0);
        this.quat.setFromEuler(this.euler);
        const s = this.coralData[off + 3];
        this.scale.set(s, s, s);
        this.mat4.compose(this.pos, this.quat, this.scale);
        this.coralsMesh.setMatrixAt(i, this.mat4);
      }
      this.coralsMesh.instanceMatrix.needsUpdate = true;
    }
  }

  getMaterials(): THREE.Material[] {
    return [this.rockMat, this.coralMat, this.fishMat];
  }

  dispose() {
    this.worker?.terminate();
    this.rocksMesh.geometry.dispose();
    this.rockMat.dispose();
    this.coralsMesh.geometry.dispose();
    this.coralMat.dispose();
    this.fishMesh.geometry.dispose();
    this.fishMat.dispose();
  }
}
