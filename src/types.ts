export type SpeedModeName = 'CRAWL' | 'CRUISE' | 'WARP';

export interface SpeedMode {
  name: SpeedModeName;
  vmin: number;
  vmax: number;
  slider01: number;
  accelTau: number;
  brake: boolean;
}

export interface WorldPos {
  lat: number; // degrees
  lon: number; // degrees
  h: number; // metres (0 = sea level, negative = depth)
}

export interface CameraState {
  lat: number;
  lon: number;
  h: number; // metres
  pitch: number; // radians
  yaw: number; // radians
  roll: number; // radians
  hFov: number; // degrees (80 - 120)
  speedMode: SpeedModeName;
  sliders: Record<SpeedModeName, number>; // 0 to 1
  inertia: number; // 0 to 1
  proximityBrake: boolean;
  ghostMode: boolean;
}

export interface TorchState {
  on: boolean;
  power: 'Low' | 'Std' | 'Search' | 'Flood';
  color: 'White' | 'Blue-Green' | 'Red';
  focus: number; // inner/outer spread
  glowSticksCount: number;
  strobeBeacon: boolean;
}

export interface SonarState {
  active: boolean;
  surveyView: boolean;
  range: number;
  hydrophone: boolean;
}

export interface ViewState {
  projection: 'Rectilinear' | 'Panini' | 'Stereographic';
  vignette: boolean;
  timeOfDay: number; // 0 to 24 hours
  seaLevel: number; // -130 to +70 metres
  verticalExaggeration: number; // 1 to 10
  waterType: 'Clear' | 'Coastal' | 'Murky';
}

export interface Destination {
  id: string;
  title: string;
  hook: string;
  expect: string;
  stats: {
    depthM: number;
    lightLevel: number; // 0 to 5
    dread: number; // 1 to 5
    scale: string;
  };
  bestFor: string[];
  start: {
    lat: number;
    lon: number;
    h: number;
    heading: number;
  };
  suggested: {
    mode: SpeedModeName;
    torch: 'Low' | 'Std' | 'Search' | 'Flood';
    timeOfDay: string;
    fov: number;
  };
  tags: string[];
  note?: string | null;
}

export interface FeatureRecord {
  id: string;
  type: 'wreck' | 'cave' | 'blue_hole' | 'reef' | 'cold_coral' | 'vent' | 'seamount' | 'named_feature';
  name: string;
  lat: number;
  lon: number;
  depthM: number;
  dims?: { lengthM: number; beamM: number };
  confidence: 'exact' | 'approx' | 'legendary' | 'procedural';
  source?: string;
  tags?: string[];
  notes?: string;
}
