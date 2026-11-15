export type SpeedModeName = 'CRAWL' | 'CRUISE' | 'WARP';
export type DeviceModeName = 'Balanced' | 'Detail' | 'Max' | 'Cool';
export type WaterType = 'Clear' | 'Coastal' | 'Murky';
export type UnitsMode = 'metric' | 'imperial';

export type DestinationCategory =
  | 'famous'
  | 'canyon_trench'
  | 'caves'
  | 'wrecks'
  | 'reefs'
  | 'vents'
  | 'south_africa'
  | 'open_ocean';

export interface Destination {
  id: string;
  title: string;
  region: string;
  category: DestinationCategory;
  subtitle: string;
  lat: number;
  lon: number;
  startDepthM: number;
  seabedDepthM: number;
  lightLevel: 'sunlit' | 'twilight' | 'midnight';
  dreadLevel: 1 | 2 | 3 | 4 | 5;
  warGrave?: boolean;
  note?: string;
  waterType?: WaterType;
}

export interface FeatureRecord {
  id: string;
  type: string;
  name: string;
  lat: number;
  lon: number;
  depthM: number;
  dims?: { lengthM: number; beamM: number };
  confidence: 'exact' | 'approx' | 'legendary';
  source: string;
  tags?: string[];
  notes?: string;
}

export interface SpeciesRecord {
  aphiaId: number;
  sci: string;
  common: string;
  sizeM: { min: number; typ: number; max: number };
  depthM: { min: number; typMax: number; max: number };
  habitat: string[];
  behavior: string;
  palette: string;
  densityPerCell: number;
  eyeshine: boolean;
  biolum: boolean;
}

export interface Reach {
  omni: number;
  cone: number;
  coarse: number;
  coneHalfAngle: number;
  sunlightFraction: number;
}

export interface SonarState {
  active: boolean;
  originX: number;
  originZ: number;
  radius: number;
  startTimeSec: number;
  surveyView: boolean;
}

export interface DeviceBudget {
  name: DeviceModeName;
  targetFps: number;
  initialRenderScale: number;
  clipmapN: number;
  clipmapRings: number;
  beamSteps: 0 | 4 | 6;
  snowCount: number;
  caustics: boolean;
  maxDpr: number;
}

export interface PointerVisual {
  id: number;
  role: 'stick' | 'lever' | 'look';
  x: number;
  y: number;
  originX: number;
  originY: number;
}

export interface InputState {
  move: { x: number; y: number };
  vert: number;
  vertLatched: boolean;
  lookDx: number;
  lookDy: number;
  pinchDelta: number;
  stickActive: boolean;
  stickBaseX: number;
  stickBaseY: number;
  stickKnobX: number;
  stickKnobY: number;
  leverActive: boolean;
  lastTouchMs: number;
  torchToggle: boolean;
  sonarPulse: boolean;
  pointers: PointerVisual[];
}

export interface GovernorTelemetry {
  fps: number;
  targetFps: number;
  tickHz: number;
  bottleneck: 'BALANCED' | 'CPU' | 'GPU';
  mode: DeviceModeName;
  renderScale: number;
  emaFrameMs: number;
  emaSubmitMs: number;
  throttled: boolean;
  triangles: number;
  calls: number;
  clipmapN: number;
  activeRings: number;
  visibleSectors: number;
  cell0Meters: number;
  reachOmni: number;
  reachCone: number;
}

export interface HudSnapshot {
  lat: number;
  lon: number;
  depthM: number;
  seabedDepthM: number;
  yawDeg: number;
  pitchDeg: number;
  hFov: number;
  pressureAtm: number;
  waterTempC: number;
  zoneName: string;
  speedMode: SpeedModeName;
  speedSlider: number;
  speedMs: number;
  speedComparison: string;
  units: UnitsMode;
  torchOn: boolean;
  torchPower: 'Low' | 'Std' | 'Search' | 'Flood';
  torchColor: 'White' | 'Blue-Green' | 'Red';
  torchFocus: number;
  stickActive: boolean;
  stickBaseX: number;
  stickBaseY: number;
  stickKnobX: number;
  stickKnobY: number;
  vertInput: number;
  vertLatched: boolean;
  leftHanded: boolean;
  idleSeconds: number;
  nearFeatureName: string | null;
  nearFeatureDistM: number | null;
  nearFeatureNote: string | null;
  overlays: {
    perfGraph: boolean;
    scaleCubes: boolean;
    torchGizmo: boolean;
    pointerVis: boolean;
    wireframe: boolean;
    disableMicroDetail: boolean;
    disableSnow: boolean;
    disableTorchVolume: boolean;
    disableActors: boolean;
  };
  governor: GovernorTelemetry;
  pointers: PointerVisual[];
}

export interface SoakEntry {
  minute: number;
  timestampIso: string;
  fpsAvg: number;
  emaFrameMs: number;
  emaSubmitMs: number;
  renderScale: number;
  clipmapN: number;
  throttled: boolean;
  depthM: number;
  lat: number;
  lon: number;
}
