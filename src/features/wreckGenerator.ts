/**
 * Parametric Hero Wreck generator (Blueprint §7.2.1 & v2.1 §4.5 U6).
 * Composite multi-part hull + superstructure + instanced greebles (ribs, rails, hatches, rusticles)
 * shaded with the shared WATER + Analytic Beam shader (no external .glb dependencies).
 */

import * as THREE from 'three';
import { DeterministicRng } from '../core/hash';
import {
  WATER_UNIFORMS_GLSL,
  WATER_SHADE_GLSL,
  WaterUniforms,
  buildAnalyticBeamGlsl,
} from '../shaders/waterCommon.glsl';

export interface WreckSpec {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lengthM: number;
  beamM: number;
  draftM: number;
  broken: boolean;
  seed: number;
}

function createWreckMaterial(waterUniforms: WaterUniforms, beamSteps: 0 | 4 | 6, isRusticle = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...waterUniforms,
      uBaseColor: { value: new THREE.Color(isRusticle ? 0x6b2f16 : 0x3b2a22) },
      uAccentColor: { value: new THREE.Color(isRusticle ? 0x8a3b18 : 0x52392c) },
      uCamWorldY: { value: 0 },
    },
    vertexShader: /* glsl */ `
precision highp float;
uniform float uCamWorldY;

out vec4 vA; // xyz = world normal, w = rust mask
out vec4 vB; // xyz = camera-relative pos, w = dist
out vec4 vC; // x = worldY

void main() {
  vec4 localPos = vec4(position, 1.0);
  vec3 localN = normal;
  #ifdef USE_INSTANCING
    localPos = instanceMatrix * localPos;
    localN = mat3(instanceMatrix) * localN;
  #endif
  vec4 worldPos = modelMatrix * localPos;
  vec3 worldN = normalize(mat3(modelMatrix) * localN);
  vec4 mvPos = viewMatrix * worldPos;
  float dist = length(mvPos.xyz);

  float rustMask = fract(sin(dot(worldPos.xyz, vec3(12.98, 78.23, 37.71))) * 43758.54);
  vA = vec4(worldN, rustMask);
  vB = vec4(worldPos.x, worldPos.y - uCamWorldY, worldPos.z, dist);
  vC = vec4(worldPos.y, 0.0, 0.0, 0.0);
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
uniform mediump vec3 uBaseColor;
uniform mediump vec3 uAccentColor;
out vec4 fragColor;

void main() {
  mediump vec3 N = normalize(vA.xyz);
  mediump vec3 albedo = mix(uBaseColor, uAccentColor, vA.w);
  // Upward-facing surfaces collect pale ocean silt
  mediump float silt = smoothstep(0.45, 0.92, N.y);
  albedo = mix(albedo, vec3(0.28, 0.29, 0.28), silt * 0.65);

  mediump vec3 col = applyWaterOptics(albedo, N, vB.xyz, vB.w, vC.x, 0.0);
  fragColor = vec4(col, 1.0);
}
`,
  });
}

function buildHullLoftGeometry(lengthM: number, beamM: number, draftM: number, startZ01: number, endZ01: number): THREE.BufferGeometry {
  const stations = 18;
  const rings = 9;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= stations; i++) {
    const t = startZ01 + (endZ01 - startZ01) * (i / stations);
    const z = (t - 0.5) * lengthM;
    // Bow taper at front (t -> 1), rounded stern (t -> 0)
    const bowFactor = Math.sin(Math.pow(Math.min(1, Math.max(0, t)), 0.72) * Math.PI);
    const halfB = beamM * 0.5 * Math.max(0.06, bowFactor);
    const depth = draftM * (0.85 + 0.15 * Math.sin(t * Math.PI));

    for (let j = 0; j <= rings; j++) {
      const u = j / rings; // 0 = port gunwale -> 0.5 = keel -> 1 = stbd gunwale
      const angle = (u - 0.5) * Math.PI;
      const x = Math.sin(angle) * halfB;
      const y = (1 - Math.cos(angle)) * depth * 0.8 + (u === 0 || u === 1 ? depth * 0.15 : 0);
      positions.push(x, y, z);
    }
  }

  const stride = rings + 1;
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < rings; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = (i + 1) * stride + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class HeroWreckObject {
  group = new THREE.Group();
  spec: WreckSpec;
  private hullMat: THREE.ShaderMaterial;
  private greebleMat: THREE.ShaderMaterial;
  private disposables: { dispose(): void }[] = [];

  constructor(spec: WreckSpec, waterUniforms: WaterUniforms) {
    this.spec = spec;
    this.group.matrixAutoUpdate = false;
    this.hullMat = createWreckMaterial(waterUniforms, 4, false);
    this.greebleMat = createWreckMaterial(waterUniforms, 4, true);

    const rng = new DeterministicRng(spec.seed);
    const { lengthM, beamM, draftM } = spec;

    // 1. Primary silhouette: Hull section(s)
    const bowGeo = buildHullLoftGeometry(lengthM, beamM, draftM, spec.broken ? 0.45 : 0.0, 1.0);
    const bowMesh = new THREE.Mesh(bowGeo, this.hullMat);
    bowMesh.rotation.z = rng.range(-0.14, 0.14);
    this.group.add(bowMesh);
    this.disposables.push(bowGeo);

    if (spec.broken) {
      const sternGeo = buildHullLoftGeometry(lengthM, beamM, draftM, 0.0, 0.38);
      const sternMesh = new THREE.Mesh(sternGeo, this.hullMat);
      sternMesh.position.set(rng.range(-45, 45), 0, -lengthM * 0.55);
      sternMesh.rotation.y = rng.range(-0.6, 0.6);
      sternMesh.rotation.z = rng.range(-0.22, 0.22);
      this.group.add(sternMesh);
      this.disposables.push(sternGeo);
    }

    // 2. Secondary read: Superstructure decks, bridge, funnels, masts
    const deckGeo = new THREE.BoxGeometry(beamM * 0.72, draftM * 0.35, lengthM * 0.32);
    const deckMesh = new THREE.Mesh(deckGeo, this.hullMat);
    deckMesh.position.set(0, draftM * 0.95, lengthM * 0.08);
    this.group.add(deckMesh);
    this.disposables.push(deckGeo);

    const bridgeGeo = new THREE.BoxGeometry(beamM * 0.78, draftM * 0.28, lengthM * 0.08);
    const bridgeMesh = new THREE.Mesh(bridgeGeo, this.hullMat);
    bridgeMesh.position.set(0, draftM * 1.25, lengthM * 0.18);
    this.group.add(bridgeMesh);
    this.disposables.push(bridgeGeo);

    const funnelGeo = new THREE.CylinderGeometry(beamM * 0.11, beamM * 0.13, draftM * 0.7, 12);
    for (let f = 0; f < 2; f++) {
      const funnel = new THREE.Mesh(funnelGeo, this.hullMat);
      funnel.position.set(0, draftM * 1.38, lengthM * (0.04 + f * 0.1));
      funnel.rotation.x = -0.15;
      this.group.add(funnel);
    }
    this.disposables.push(funnelGeo);

    const mastGeo = new THREE.CylinderGeometry(0.18, 0.35, draftM * 1.2, 8);
    const mast = new THREE.Mesh(mastGeo, this.hullMat);
    mast.position.set(0, draftM * 1.45, lengthM * 0.32);
    mast.rotation.x = 0.22;
    this.group.add(mast);
    this.disposables.push(mastGeo);

    // 3. Accent greebles: Instanced hull ribs, deck hatches & hanging rusticles
    const greebleGeo = new THREE.BoxGeometry(0.45, 2.2, 0.45);
    const greebleCount = 120;
    const greebles = new THREE.InstancedMesh(greebleGeo, this.greebleMat, greebleCount);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let i = 0; i < greebleCount; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const zOff = rng.range(-lengthM * 0.42, lengthM * 0.45);
      p.set(side * beamM * rng.range(0.32, 0.48), rng.range(draftM * 0.35, draftM * 1.05), zOff);
      q.setFromEuler(new THREE.Euler(rng.range(-0.2, 0.2), rng.range(0, 0.4), rng.range(-0.15, 0.15)));
      s.set(rng.range(0.6, 1.5), rng.range(0.8, 2.4), rng.range(0.6, 1.8));
      m.compose(p, q, s);
      greebles.setMatrixAt(i, m);
    }
    greebles.instanceMatrix.needsUpdate = true;
    greebles.computeBoundingSphere();
    this.group.add(greebles);
    this.disposables.push(greebleGeo);
  }

  setRelativePosition(x: number, y: number, z: number, camWorldY: number) {
    this.group.position.set(x, y, z);
    this.group.updateMatrix();
    this.hullMat.uniforms.uCamWorldY.value = camWorldY;
    this.greebleMat.uniforms.uCamWorldY.value = camWorldY;
  }

  getMaterials(): THREE.Material[] {
    return [this.hullMat, this.greebleMat];
  }

  dispose() {
    this.hullMat.dispose();
    this.greebleMat.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
