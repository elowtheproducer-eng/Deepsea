/**
 * Ocean Surface (Gerstner waves + Snell's window), Far-Depth Sky/Water Background Quad
 * ("skybox-last" trick, v2.2 §3.1), and GPU-driven Marine Snow (v2.1 §4.6, zero CPU loop).
 */

import * as THREE from 'three';
import { hash2 } from '../core/hash';
import {
  WATER_UNIFORMS_GLSL,
  WaterUniforms,
  buildAnalyticBeamGlsl,
} from '../shaders/waterCommon.glsl';

export class OceanRenderer {
  private scene: THREE.Scene;
  private waterUniforms: WaterUniforms;

  private skyQuadMesh: THREE.Mesh;
  private skyMaterial: THREE.ShaderMaterial;

  private surfaceMesh: THREE.Mesh;
  private surfaceMaterial: THREE.ShaderMaterial;

  private snowPoints: THREE.Points;
  private snowMaterial: THREE.ShaderMaterial;
  private snowCount: number;

  private currentBeamSteps: 0 | 4 | 6 = 4;

  constructor(scene: THREE.Scene, waterUniforms: WaterUniforms, initialSnowCount: number = 16000) {
    this.scene = scene;
    this.waterUniforms = waterUniforms;
    this.snowCount = initialSnowCount;

    // 1. Background Far-Depth Quad ("skybox-last" trick, v2.2 §3.1)
    const skyGeo = new THREE.PlaneGeometry(2, 2);
    this.skyMaterial = this.createSkyMaterial(4);
    this.skyQuadMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.skyQuadMesh.frustumCulled = false;
    this.skyQuadMesh.matrixAutoUpdate = false;
    this.skyQuadMesh.renderOrder = 100;
    this.scene.add(this.skyQuadMesh);

    // 2. Camera-following Gerstner Sea Surface (non-linear radial warp: crisp near camera, reaches ~6.8km horizon)
    const surfGeo = new THREE.PlaneGeometry(2, 2, 128, 128);
    surfGeo.rotateX(-Math.PI / 2);
    const sPos = surfGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sPos.count; i++) {
      const ux = sPos.getX(i); // [-1, 1]
      const uz = sPos.getZ(i); // [-1, 1]
      const ax = Math.abs(ux);
      const az = Math.abs(uz);
      const r = Math.max(ax, az);
      const warp = 420.0 + 6400.0 * Math.pow(r, 2.3);
      sPos.setX(i, ux * warp);
      sPos.setZ(i, uz * warp);
    }
    sPos.needsUpdate = true;
    this.surfaceMaterial = this.createSurfaceMaterial();
    this.surfaceMesh = new THREE.Mesh(surfGeo, this.surfaceMaterial);
    this.surfaceMesh.frustumCulled = false;
    this.scene.add(this.surfaceMesh);

    // 3. GPU-driven Marine Snow (zero CPU updates, deterministic PCG-hashed IDs)
    this.snowMaterial = this.createSnowMaterial();
    this.snowPoints = this.buildSnowPoints(initialSnowCount);
    this.scene.add(this.snowPoints);
  }

  private createSkyMaterial(beamSteps: 0 | 4 | 6): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      depthTest: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      uniforms: {
        ...this.waterUniforms,
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorldMat: { value: new THREE.Matrix4() },
        uCamY: { value: 30.48 },
      },
      vertexShader: /* glsl */ `
precision highp float;
uniform mat4 uInvProj;
uniform mat4 uCamWorldMat;
out vec3 vRayDir;

void main() {
  vec4 clip = vec4(position.xy, 1.0, 1.0);
  vec4 viewPos = uInvProj * clip;
  vec3 viewDir = normalize(viewPos.xyz / viewPos.w);
  vRayDir = (uCamWorldMat * vec4(viewDir, 0.0)).xyz;
  gl_Position = vec4(position.xy, 0.99999, 1.0);
}
`,
      fragmentShader: /* glsl */ `
precision mediump float;
${WATER_UNIFORMS_GLSL}
${buildAnalyticBeamGlsl(beamSteps)}

in mediump vec3 vRayDir;
uniform highp float uCamY;
out vec4 fragColor;

void main() {
  mediump vec3 rd = normalize(vRayDir);
  highp float depth = max(0.0, uSeaLevel - uCamY);
  mediump vec3 col = vec3(0.0);

  if (uCamY >= uSeaLevel) {
    // Above water: atmospheric horizon + sun disk
    mediump float elev = clamp(rd.y, 0.0, 1.0);
    mediump float sunAmt = max(dot(rd, uSunDir), 0.0);
    mediump vec3 skyZenith = vec3(0.05, 0.22, 0.48) * max(0.08, uSunDir.y + 0.15);
    mediump vec3 skyHorizon = vec3(0.28, 0.48, 0.65) * max(0.08, uSunDir.y + 0.2);
    col = mix(skyHorizon, skyZenith, pow(elev, 0.55));
    col += vec3(1.0, 0.92, 0.78) * pow(sunAmt, 140.0) * 1.4;
    col += vec3(0.45, 0.62, 0.78) * pow(sunAmt, 12.0) * 0.25;
  } else {
    // Underwater: depth-driven water scatter -> true black (0,0,0) in abyss (v2.2 §4.5)
    mediump vec3 sunFactor = uSunColorAtDepth * vec3(exp(-uKd * depth * 0.45));
    mediump float upGlow = smoothstep(-0.35, 0.95, rd.y);
    mediump vec3 waterBg = uWaterScatterColor * sunFactor * mix(0.22, 1.25, upGlow);

    // Analytic Beam scatter in open water
    mediump vec3 beam = beamScatter(rd, uReachCone);
    col = waterBg + beam;
  }

  col = col / (1.0 + col * 0.4);
  mediump float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
  col += (dither - 0.5) / 255.0;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
    });
  }

  private createSurfaceMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      transparent: false,
      uniforms: {
        ...this.waterUniforms,
        uWaveSteepness: this.waterUniforms.uWaveSteepness,
        uCamWorldXZ: { value: new THREE.Vector2() },
        uCamWorldY: { value: 30.48 },
      },
      vertexShader: /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uSeaLevel;
uniform float uWaveSteepness;
uniform vec2 uCamWorldXZ;

out vec4 vA; // xyz = normal, w = foam Jacobian
out vec4 vB; // xyz = relPos, w = dist

vec3 gerstnerWave(vec2 pos, vec2 dir, float steepness, float wavelength, float t, inout vec3 tangent, inout vec3 binormal) {
  float k = 6.2831853 / wavelength;
  float c = sqrt(9.81 / k);
  vec2 d = normalize(dir);
  float f = k * (dot(d, pos) - c * t);
  float a = steepness / k;

  tangent += vec3(
    -d.x * d.x * (steepness * sin(f)),
    d.x * (steepness * cos(f)),
    -d.x * d.y * (steepness * sin(f))
  );
  binormal += vec3(
    -d.x * d.y * (steepness * sin(f)),
    d.y * (steepness * cos(f)),
    -d.y * d.y * (steepness * sin(f))
  );
  return vec3(d.x * (a * cos(f)), a * sin(f), d.y * (a * cos(f)));
}

void main() {
  vec2 worldXZ = position.xz + uCamWorldXZ;
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 disp = vec3(0.0);

  float s = uWaveSteepness;
  disp += gerstnerWave(worldXZ, vec2(1.0, 0.25), s * 0.35, 38.0, uTime, tangent, binormal);
  disp += gerstnerWave(worldXZ, vec2(0.7, 0.72), s * 0.28, 21.0, uTime, tangent, binormal);
  disp += gerstnerWave(worldXZ, vec2(-0.4, 0.9), s * 0.20, 11.5, uTime, tangent, binormal);
  disp += gerstnerWave(worldXZ, vec2(0.85, -0.5), s * 0.14, 6.2, uTime, tangent, binormal);

  vec3 pos = vec3(position.x + disp.x, uSeaLevel + disp.y, position.z + disp.z);
  vec3 normal = normalize(cross(binormal, tangent));
  float foam = clamp(1.0 - (tangent.x * binormal.z), 0.0, 1.0);

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  vA = vec4(normal, foam);
  vB = vec4(pos.x, pos.y - cameraPosition.y, pos.z, length(mvPos.xyz));
  gl_Position = projectionMatrix * mvPos;
}
`,
      fragmentShader: /* glsl */ `
precision mediump float;
${WATER_UNIFORMS_GLSL}
in vec4 vA;
in vec4 vB;
uniform highp float uCamWorldY;
out vec4 fragColor;

void main() {
  mediump vec3 N = normalize(vA.xyz);
  mediump float foam = vA.w;
  highp float dist = vB.w;
  mediump vec3 V = normalize(vec3(-vB.xyz));

  mediump vec3 col = vec3(0.0);
  if (uCamWorldY >= uSeaLevel) {
    // Viewed from ABOVE: Fresnel + deep water tint + sun glint + whitecaps
    mediump float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    mediump vec3 deepTint = vec3(0.01, 0.08, 0.15) * max(0.15, uSunDir.y + 0.15);
    mediump vec3 skyRefl = vec3(0.24, 0.45, 0.68) * max(0.15, uSunDir.y + 0.15);
    mediump vec3 H = normalize(uSunDir + V);
    mediump float spec = pow(max(dot(N, H), 0.0), 180.0) * 1.8;
    col = mix(deepTint, skyRefl, fresnel) + vec3(1.0, 0.96, 0.88) * spec;
    col = mix(col, vec3(0.85, 0.92, 0.96), smoothstep(0.32, 0.68, foam) * 0.55);
    mediump vec3 skyHorizon = vec3(0.28, 0.48, 0.65) * max(0.08, uSunDir.y + 0.2);
    mediump float horizonFade = smoothstep(800.0, 4800.0, dist);
    col = mix(col, skyHorizon, horizonFade);
  } else {
    // Viewed from BELOW: Snell's window (~97° bright sky cone overhead, TIR outside)
    mediump vec3 downN = -N;
    mediump float cosI = max(dot(downN, V), 0.0);
    mediump float sinI = sqrt(max(0.0, 1.0 - cosI * cosI));
    // Critical angle sin(theta_c) = 1 / 1.333 = 0.7502 (~48.6° half-angle = ~97.2° window)
    mediump float windowMask = 1.0 - smoothstep(0.71, 0.77, sinI);
    mediump vec3 skyWindow = vec3(0.25, 0.62, 0.85) * uSunColorAtDepth;
    mediump vec3 tirDark = uWaterScatterColor * uSunColorAtDepth * 0.25;
    col = mix(tirDark, skyWindow, windowMask);
    mediump vec3 trans = vec3(exp(-uKd * dist));
    col = col * trans + uWaterScatterColor * uSunColorAtDepth * (1.0 - trans);
  }

  col = col / (1.0 + col * 0.4);
  mediump float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
  col += (dither - 0.5) / 255.0;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
    });
  }

  private createSnowMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...this.waterUniforms,
        uSpeedFactor: this.waterUniforms.uSpeedFactor,
        uCamWorldPos: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
precision highp float;
in vec3 aSeedVec;
uniform float uTime;
uniform float uSeaLevel;
uniform float uReachCone;
uniform float uSpeedFactor;
uniform vec3 uCamWorldPos;
uniform vec3 uTorchPos;
uniform mediump vec3 uTorchDir;
uniform mediump float uCosOuter;
uniform mediump float uTorchOn;

out float vAlpha;
out float vInBeam;

void main() {
  float shell = clamp(uReachCone * 0.85, 16.0, 64.0);
  // Deterministic drifting particle inside camera-centered wrapping shell
  vec3 drift = vec3(
    sin(uTime * 0.2 + aSeedVec.y * 6.28) * 0.4 + 0.18 * uTime,
    -0.55 * uTime,
    cos(uTime * 0.17 + aSeedVec.x * 6.28) * 0.4
  );
  vec3 wrapped = mod(aSeedVec * shell + drift - uCamWorldPos, shell) - shell * 0.5;
  float worldY = uCamWorldPos.y + wrapped.y;
  float underwater = step(worldY, uSeaLevel - 0.5);

  vec4 mvPos = modelViewMatrix * vec4(wrapped.x, uCamWorldPos.y + wrapped.y, wrapped.z, 1.0);
  float dist = max(0.5, length(mvPos.xyz));

  // Check if inside torch beam to boost brightness
  vec3 toP = wrapped - uTorchPos;
  float tDist = max(0.5, length(toP));
  float inCone = smoothstep(uCosOuter, uCosOuter + 0.15, dot(toP / tDist, uTorchDir)) * uTorchOn;

  vInBeam = inCone;
  vAlpha = underwater * (0.14 + 0.72 * inCone) * (1.0 - smoothstep(shell * 0.3, shell * 0.5, dist));

  // Clamped <= 6 px per v2.2 §3.2
  float baseSize = mix(2.0, 5.2, aSeedVec.z);
  gl_PointSize = clamp(baseSize * (12.0 / dist) + uSpeedFactor * 1.5, 1.0, 6.0);
  gl_Position = projectionMatrix * mvPos;
}
`,
      fragmentShader: /* glsl */ `
precision mediump float;
${WATER_UNIFORMS_GLSL}
in float vAlpha;
in float vInBeam;
out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  float circle = 1.0 - smoothstep(0.08, 0.25, r2);
  mediump vec3 sunTint = uSunColorAtDepth * vec3(0.45, 0.75, 0.95);
  mediump vec3 beamTint = normalize(max(uTorchColorLumens, vec3(0.1))) * 0.95;
  mediump vec3 col = mix(sunTint, beamTint, vInBeam);
  fragColor = vec4(col * circle * vAlpha, circle * vAlpha);
}
`,
    });
  }

  private buildSnowPoints(count: number): THREE.Points {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3); // placeholder, overridden by aSeedVec
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      seeds[i * 3] = hash2(i, 17);
      seeds[i * 3 + 1] = hash2(i, 53);
      seeds[i * 3 + 2] = hash2(i, 109);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeedVec', new THREE.BufferAttribute(seeds, 3));
    const pts = new THREE.Points(geo, this.snowMaterial);
    pts.frustumCulled = false;
    pts.matrixAutoUpdate = false;
    pts.renderOrder = 110;
    return pts;
  }

  setSnowCount(count: number) {
    if (count === this.snowCount) return;
    this.snowCount = count;
    this.scene.remove(this.snowPoints);
    this.snowPoints.geometry.dispose();
    this.snowPoints = this.buildSnowPoints(count);
    this.scene.add(this.snowPoints);
  }

  setSnowVisible(visible: boolean) {
    this.snowPoints.visible = visible;
  }

  setBeamSteps(steps: 0 | 4 | 6) {
    if (steps === this.currentBeamSteps) return;
    this.currentBeamSteps = steps;
    this.skyMaterial.dispose();
    this.skyMaterial = this.createSkyMaterial(steps);
    this.skyQuadMesh.material = this.skyMaterial;
  }

  update(camera: THREE.PerspectiveCamera, camEast: number, camNorth: number, camH: number) {
    // Snap sea surface XZ to 15m grid cell in world space so waves don't swim
    const snap = 15.0;
    const snapX = Math.round(camEast / snap) * snap;
    const snapZ = Math.round(camNorth / snap) * snap;
    this.surfaceMesh.position.set(snapX - camEast, 0, snapZ - camNorth);
    this.surfaceMesh.updateMatrix();
    this.surfaceMaterial.uniforms.uCamWorldXZ.value.set(snapX, snapZ);
    this.surfaceMaterial.uniforms.uCamWorldY.value = camH;

    // Update skybox-last inverse projection & camera orientation
    this.skyMaterial.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.skyMaterial.uniforms.uCamWorldMat.value.copy(camera.matrixWorld);
    this.skyMaterial.uniforms.uCamY.value = camH;

    // Update snow world pos
    this.snowMaterial.uniforms.uCamWorldPos.value.set(camEast, camH, camNorth);
  }

  getMaterials(): THREE.Material[] {
    return [this.skyMaterial, this.surfaceMaterial, this.snowMaterial];
  }

  dispose() {
    this.skyQuadMesh.geometry.dispose();
    this.skyMaterial.dispose();
    this.surfaceMesh.geometry.dispose();
    this.surfaceMaterial.dispose();
    this.snowPoints.geometry.dispose();
    this.snowMaterial.dispose();
  }
}
