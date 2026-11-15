/**
 * Shared WATER uniform block, Analytic Beam volumetric scatter (v2.2 §3.3),
 * Beer-Lambert underwater optics, caustics, sonar sweep, and OLED IGN dithering (v2.2 §4.5).
 * Single-pass tile-friendly GLSL3 chunks (no depthTexture, no post-processing).
 */

import * as THREE from 'three';

export interface WaterUniforms {
  uTime: { value: number };
  uDepth: { value: number };
  uSeaLevel: { value: number };
  uKd: { value: THREE.Vector3 };
  uWaterScatterColor: { value: THREE.Vector3 };
  uSunColorAtDepth: { value: THREE.Vector3 };
  uSunDir: { value: THREE.Vector3 };
  uReachOmni: { value: number };
  uReachCone: { value: number };
  uReachCoarse: { value: number };
  uTorchOn: { value: number };
  uTorchPos: { value: THREE.Vector3 };
  uTorchDir: { value: THREE.Vector3 };
  uCosInner: { value: number };
  uCosOuter: { value: number };
  uTorchColorLumens: { value: THREE.Vector3 };
  uSnowDensity: { value: number };
  uCausticsEnabled: { value: number };
  uSonarActive: { value: number };
  uSonarOrigin: { value: THREE.Vector3 };
  uSonarRadius: { value: number };
  uSurveyView: { value: number };
  uDarkAdaptation: { value: number };
  uDarknessFidelity: { value: number };
  uWaveSteepness: { value: number };
  uSpeedFactor: { value: number };
}

export function createWaterUniforms(): WaterUniforms {
  return {
    uTime: { value: 0 },
    uDepth: { value: 0 },
    uSeaLevel: { value: 0 },
    uKd: { value: new THREE.Vector3(0.37, 0.09, 0.042) },
    uWaterScatterColor: { value: new THREE.Vector3(0.015, 0.09, 0.16) },
    uSunColorAtDepth: { value: new THREE.Vector3(1.0, 0.98, 0.94) },
    uSunDir: { value: new THREE.Vector3(0.35, 0.88, 0.32).normalize() },
    uReachOmni: { value: 65.0 },
    uReachCone: { value: 65.0 },
    uReachCoarse: { value: 65.0 },
    uTorchOn: { value: 1.0 },
    uTorchPos: { value: new THREE.Vector3(0.32, -0.28, 0.0) },
    uTorchDir: { value: new THREE.Vector3(0.0, 0.0, -1.0) },
    uCosInner: { value: Math.cos(THREE.MathUtils.degToRad(20)) },
    uCosOuter: { value: Math.cos(THREE.MathUtils.degToRad(36)) },
    uTorchColorLumens: { value: new THREE.Vector3(75, 75, 75) },
    uSnowDensity: { value: 1.0 },
    uCausticsEnabled: { value: 1.0 },
    uSonarActive: { value: 0.0 },
    uSonarOrigin: { value: new THREE.Vector3(0, 0, 0) },
    uSonarRadius: { value: 0.0 },
    uSurveyView: { value: 0.0 },
    uDarkAdaptation: { value: 0.0 },
    uDarknessFidelity: { value: 1.0 },
    uWaveSteepness: { value: 0.28 },
    uSpeedFactor: { value: 0.0 },
  };
}

export const WATER_UNIFORMS_GLSL = /* glsl */ `
uniform highp float uTime;
uniform highp float uDepth;
uniform highp float uSeaLevel;
uniform highp vec3 uKd;
uniform mediump vec3 uWaterScatterColor;
uniform mediump vec3 uSunColorAtDepth;
uniform mediump vec3 uSunDir;
uniform highp float uReachOmni;
uniform highp float uReachCone;
uniform highp float uReachCoarse;
uniform mediump float uTorchOn;
uniform highp vec3 uTorchPos;
uniform mediump vec3 uTorchDir;
uniform mediump float uCosInner;
uniform mediump float uCosOuter;
uniform mediump vec3 uTorchColorLumens;
uniform mediump float uSnowDensity;
uniform mediump float uCausticsEnabled;
uniform mediump float uSonarActive;
uniform highp vec3 uSonarOrigin;
uniform highp float uSonarRadius;
uniform mediump float uSurveyView;
uniform mediump float uDarkAdaptation;
uniform mediump float uDarknessFidelity;
`;

/**
 * Analytic Beam volumetric torch backscatter (v2.2 §3.3).
 * Branchless ray-cone chord + fixed unrolled BEAM_STEPS loop + IGN jitter.
 */
export function buildAnalyticBeamGlsl(beamSteps: 0 | 4 | 6): string {
  if (beamSteps === 0) {
    return /* glsl */ `
vec3 beamScatter(mediump vec3 rd, highp float dist) {
  return vec3(0.0);
}
`;
  }
  return /* glsl */ `
mediump float ignNoise(highp vec2 xy) {
  return fract(52.9829189 * fract(dot(xy, vec2(0.06711056, 0.00583715))));
}

mediump float phaseHG(mediump float cosTheta, mediump float g) {
  mediump float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(0.05, 1.0 + g2 - 2.0 * g * cosTheta), 1.5));
}

mediump vec3 beamScatter(mediump vec3 rd, highp float dist) {
  if (uTorchOn < 0.5) return vec3(0.0);
  highp float tEnd = min(dist, uReachCone);
  // Bounding chord along camera ray in front of torch (branchless soft range)
  highp float tStart = 0.65;
  highp float chord = max(0.0, tEnd - tStart);
  mediump float j = ignNoise(gl_FragCoord.xy + fract(uTime) * 37.0);
  mediump vec3 acc = vec3(0.0);
  mediump float hg = phaseHG(dot(rd, -uTorchDir), 0.6);

  for (int i = 0; i < ${beamSteps}; i++) {
    highp float t = mix(tStart, tEnd, (float(i) + j) / ${beamSteps}.0);
    highp vec3 p = rd * t - uTorchPos;
    highp float d = max(length(p), 0.6);
    mediump float cone = smoothstep(uCosOuter, uCosInner, dot(vec3(p / d), uTorchDir));
    highp vec3 atten = exp(-uKd * (d + t));
    acc += uTorchColorLumens * cone * vec3(atten) / (d * d);
  }

  return acc * hg * (chord / ${beamSteps}.0) * uSnowDensity * 0.085;
}
`;
}

export const WATER_SHADE_GLSL = /* glsl */ `
mediump float hashCaustic(highp vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

mediump float causticPattern(highp vec2 p, highp float t) {
  highp vec2 uv1 = p * 0.35 + vec2(t * 0.22, -t * 0.17);
  highp vec2 uv2 = p * 0.52 + vec2(-t * 0.19, t * 0.25);
  mediump float w1 = sin(uv1.x * 3.1 + sin(uv1.y * 2.7 + t)) * 0.5 + 0.5;
  mediump float w2 = sin(uv2.y * 3.4 + cos(uv2.x * 2.9 - t * 1.1)) * 0.5 + 0.5;
  return pow(w1 * w2, 3.0);
}

mediump vec3 computeTorchAtPoint(highp vec3 relPos, mediump vec3 normal) {
  if (uTorchOn < 0.5) return vec3(0.0);
  highp vec3 toFrag = relPos - uTorchPos;
  highp float d = max(length(toFrag), 0.35);
  mediump vec3 dir = vec3(toFrag / d);
  mediump float cone = smoothstep(uCosOuter, uCosInner, dot(dir, uTorchDir));
  mediump float ndl = max(dot(normal, -dir), 0.05);
  highp vec3 atten = exp(-uKd * d);
  return uTorchColorLumens * cone * ndl * vec3(atten) / (d * d) * 0.45;
}

mediump vec3 applyWaterOptics(
  mediump vec3 albedo,
  mediump vec3 normal,
  highp vec3 relPos,
  highp float dist,
  highp float fragWorldY,
  mediump float predictedMask
) {
  highp float depthBelowSurface = max(0.0, uSeaLevel - fragWorldY);
  mediump float ndlSun = max(dot(normal, uSunDir), 0.0) * 0.78 + 0.22;

  // Sunlit / shallow caustics (uniform-gated below ~45m for Mali-G610)
  mediump float caustic = 0.0;
  if (uCausticsEnabled > 0.5 && depthBelowSurface < 45.0) {
    mediump float cFade = 1.0 - smoothstep(8.0, 45.0, depthBelowSurface);
    caustic = causticPattern(relPos.xz, uTime) * cFade * max(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0);
  }

  mediump vec3 sunDepthFactor = uSunColorAtDepth * vec3(exp(-uKd * depthBelowSurface * 0.42));
  mediump vec3 ambientFloor = vec3(0.008, 0.015, 0.025) * (1.0 - uDarknessFidelity);
  mediump vec3 torchIrrad = computeTorchAtPoint(relPos, normal);
  mediump vec3 sunIrrad = sunDepthFactor * (ndlSun + caustic * 0.9);

  mediump vec3 lit = albedo * (sunIrrad + torchIrrad + ambientFloor);

  // Beer-Lambert along view ray
  highp float viewFactor = max(0.0, fragWorldY - uSeaLevel) > 0.0 ? 0.06 : 1.0;
  mediump vec3 trans = vec3(exp(-uKd * dist * viewFactor));
  mediump vec3 inscatter = uWaterScatterColor * sunDepthFactor * (1.0 - trans);

  mediump vec3 rd = normalize(vec3(relPos));
  mediump vec3 beam = beamScatter(rd, dist);

  mediump vec3 finalColor = lit * trans + inscatter + beam;

  // Honest Map survey view tint (soft dreamlike haze on predicted cells)
  if (uSurveyView > 0.5) {
    mediump vec3 surveyTint = mix(vec3(0.08, 0.65, 0.45), vec3(0.45, 0.28, 0.75), predictedMask);
    finalColor = mix(finalColor, surveyTint * 0.35 + finalColor * 0.7, 0.55);
  }

  // Sonar expanding wireframe pulse
  if (uSonarActive > 0.5) {
    highp float sDist = length(relPos.xz - uSonarOrigin.xz);
    highp float ring = 1.0 - smoothstep(0.0, 16.0, abs(sDist - uSonarRadius));
    mediump float gridX = abs(fract(relPos.x * 0.125) - 0.5);
    mediump float gridZ = abs(fract(relPos.z * 0.125) - 0.5);
    mediump float wire = 1.0 - smoothstep(0.04, 0.10, min(gridX, gridZ));
    mediump float trail = smoothstep(uSonarRadius - 180.0, uSonarRadius, sDist) * step(sDist, uSonarRadius);
    mediump vec3 sonarCol = mix(vec3(0.15, 0.95, 0.65), vec3(0.95, 0.65, 0.25), predictedMask);
    finalColor += sonarCol * (ring * 0.85 + wire * trail * 0.45);
  }

  // Dark adaptation modest grain & subtle sensitivity boost
  mediump float sens = mix(1.0, 1.45, uDarkAdaptation);
  finalColor *= sens;

  // Cheap tone curve + 8-bit OLED IGN dithering (v2.2 §4.5)
  finalColor = finalColor / (1.0 + finalColor * 0.45);
  mediump float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  finalColor = pow(max(finalColor, vec3(0.0)), vec3(1.0 / 2.2));
  finalColor += (dither - 0.5) / 255.0;
  return clamp(finalColor, 0.0, 1.0);
}
`;
