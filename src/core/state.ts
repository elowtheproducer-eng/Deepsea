/**
 * Non-React Mutable Simulation State + 8 Hz useSyncExternalStore Bridge (v2.1 §2.1 & §4.3).
 * Zero React setState inside requestAnimationFrame.
 */

import { SPEED_MODES } from './config';
import { DensityGovernor } from './governor';
import { getDepthZone, getSpeedComparison, speedFromSlider } from './reach';
import { localMetersToLatLon } from '../world/coords';
import {
  Destination,
  HudSnapshot,
  InputState,
  Reach,
  SoakEntry,
  SonarState,
  SpeedModeName,
  UnitsMode,
  WaterType,
} from '../types';

export const governor = new DensityGovernor();

export const input: InputState = {
  move: { x: 0, y: 0 },
  vert: 0,
  vertLatched: false,
  lookDx: 0,
  lookDy: 0,
  pinchDelta: 0,
  stickActive: false,
  stickBaseX: 0,
  stickBaseY: 0,
  stickKnobX: 0,
  stickKnobY: 0,
  leverActive: false,
  lastTouchMs: typeof performance !== 'undefined' ? performance.now() : 0,
  torchToggle: false,
  sonarPulse: false,
  pointers: [],
};

export const STATE = {
  // Default start: Dean's Blue Hole, Bahamas at +30.48 m (100 ft) above sea level
  originLat: 23.10639,
  originLon: -75.00861,
  camEast: 0,
  camNorth: 0,
  cam: {
    h: 30.48,
    yaw: 0,
    pitch: -0.18,
    hFov: 92,
  },
  seabedDepthM: 202,
  speedMode: 'CRUISE' as SpeedModeName,
  sliders: {
    CRAWL: SPEED_MODES.CRAWL.defaultSlider,
    CRUISE: SPEED_MODES.CRUISE.defaultSlider,
    WARP: SPEED_MODES.WARP.defaultSlider,
  },
  proximityBrake: true,
  torch: {
    on: true,
    power: 'Std' as 'Low' | 'Std' | 'Search' | 'Flood',
    color: 'White' as 'White' | 'Blue-Green' | 'Red',
    focus: 0.35,
    glowSticksCount: 6,
  },
  sonar: {
    active: false,
    originX: 0,
    originZ: 0,
    radius: 0,
    startTimeSec: 0,
    surveyView: false,
  } as SonarState,
  view: {
    timeOfDay: 11.5,
    seaLevel: 0,
    waterType: 'Clear' as WaterType,
    units: 'metric' as UnitsMode,
  },
  settings: {
    leftHanded: false,
    fixedStick: false,
    levelFlight: false,
    haptics: true,
    audio: true,
    pinchFov: true,
    gyroLook: false,
  },
  overlays: {
    perfGraph: false,
    scaleCubes: false,
    torchGizmo: false,
    pointerVis: false,
    wireframe: false,
    disableMicroDetail: false,
    disableSnow: false,
    disableTorchVolume: false,
    disableActors: false,
  },
  nearFeature: {
    name: null as string | null,
    distM: null as number | null,
    note: null as string | null,
  },
  reach: {
    omni: 120,
    cone: 65,
    coarse: 120,
    coneHalfAngle: 0.42,
    sunlightFraction: 0.85,
  } as Reach,
  soakLog: [] as SoakEntry[],
  sessionStartMs: performance.now(),
  triangles: 0,
  calls: 0,
  activeRings: 0,
  visibleSectors: 0,
  cell0Meters: 0.04,
};

export function rebaseOriginIfNeeded() {
  if (Math.hypot(STATE.camEast, STATE.camNorth) > 50000) {
    const next = localMetersToLatLon(STATE.originLat, STATE.originLon, STATE.camEast, STATE.camNorth);
    STATE.originLat = next.lat;
    STATE.originLon = next.lon;
    STATE.camEast = 0;
    STATE.camNorth = 0;
  }
}

export function getRelativeEastNorth(targetLat: number, targetLon: number) {
  const cosLat = Math.max(0.08, Math.cos((STATE.originLat * Math.PI) / 180));
  const north = (targetLat - STATE.originLat) * 111319.490793;
  const east = (targetLon - STATE.originLon) * 111319.490793 * cosLat;
  return { east: east - STATE.camEast, north: north - STATE.camNorth };
}

export function teleportTo(lat: number, lon: number, depthM: number) {
  STATE.originLat = lat;
  STATE.originLon = lon;
  STATE.camEast = 0;
  STATE.camNorth = 0;
  STATE.cam.h = STATE.view.seaLevel - depthM;
  input.vertLatched = false;
  input.vert = 0;
  input.lastTouchMs = performance.now();
  notifyHudImmediate();
}

export function applyDestination(dest: Destination, startAtSurface: boolean = false) {
  if (dest.waterType) STATE.view.waterType = dest.waterType;
  const targetDepth = startAtSurface ? -30.48 : dest.startDepthM;
  STATE.seabedDepthM = dest.seabedDepthM;
  STATE.cam.yaw = 0;
  STATE.cam.pitch = startAtSurface ? -0.22 : -0.14;
  teleportTo(dest.lat, dest.lon, targetDepth);
}

// 8 Hz HUD snapshot store for React
const listeners = new Set<() => void>();
let lastNotifyMs = 0;

function buildSnapshot(): HudSnapshot {
  const ll = localMetersToLatLon(STATE.originLat, STATE.originLon, STATE.camEast, STATE.camNorth);
  const depthM = STATE.view.seaLevel - STATE.cam.h;
  const slider = STATE.sliders[STATE.speedMode];
  const speedMs = speedFromSlider(STATE.speedMode, slider);
  const absDepth = Math.max(0, depthM);
  const pressureAtm = 1 + absDepth / 10.0;
  const waterTempC = Math.max(1.5, 25.0 * Math.exp(-absDepth / 550) + 1.5);
  const yawDeg = (((-STATE.cam.yaw * 180) / Math.PI) % 360 + 360) % 360;

  return {
    lat: ll.lat,
    lon: ll.lon,
    depthM,
    seabedDepthM: STATE.seabedDepthM,
    yawDeg,
    pitchDeg: (STATE.cam.pitch * 180) / Math.PI,
    hFov: STATE.cam.hFov,
    pressureAtm,
    waterTempC,
    zoneName: getDepthZone(depthM),
    speedMode: STATE.speedMode,
    speedSlider: slider,
    speedMs,
    speedComparison: getSpeedComparison(speedMs),
    units: STATE.view.units,
    torchOn: STATE.torch.on,
    torchPower: STATE.torch.power,
    torchColor: STATE.torch.color,
    torchFocus: STATE.torch.focus,
    stickActive: input.stickActive,
    stickBaseX: input.stickBaseX,
    stickBaseY: input.stickBaseY,
    stickKnobX: input.stickKnobX,
    stickKnobY: input.stickKnobY,
    vertInput: input.vert,
    vertLatched: input.vertLatched,
    leftHanded: STATE.settings.leftHanded,
    idleSeconds: (performance.now() - input.lastTouchMs) / 1000,
    nearFeatureName: STATE.nearFeature.name,
    nearFeatureDistM: STATE.nearFeature.distM,
    nearFeatureNote: STATE.nearFeature.note,
    overlays: { ...STATE.overlays },
    governor: governor.getTelemetry({
      triangles: STATE.triangles,
      calls: STATE.calls,
      activeRings: STATE.activeRings,
      visibleSectors: STATE.visibleSectors,
      cell0Meters: STATE.cell0Meters,
      reachOmni: STATE.reach.omni,
      reachCone: STATE.reach.cone,
    }),
    pointers: input.pointers.slice(),
  };
}

let cachedSnapshot: HudSnapshot = buildSnapshot();

export function subscribeHud(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getHudSnapshot(): HudSnapshot {
  return cachedSnapshot;
}

export function notifyHudImmediate() {
  lastNotifyMs = performance.now();
  cachedSnapshot = buildSnapshot();
  listeners.forEach((cb) => cb());
}

export function notifyHudIfDue(nowMs: number) {
  if (nowMs - lastNotifyMs >= 125) {
    lastNotifyMs = nowMs;
    cachedSnapshot = buildSnapshot();
    listeners.forEach((cb) => cb());
  }
}
