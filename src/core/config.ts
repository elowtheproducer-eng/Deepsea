/**
 * Speed modes, Redmi Note 13 Pro+ 5G hardware budgets (v2.2 §1 & §5),
 * and live-tunable physical optics / ocean parameters (§20.3).
 */

import { DeviceBudget, DeviceModeName, SpeedModeName } from '../types';
import { WORLD_SEED } from './hash';

export interface SpeedModeSpec {
  name: SpeedModeName;
  minMs: number;
  maxMs: number;
  defaultSlider: number;
}

export const SPEED_MODES: Record<SpeedModeName, SpeedModeSpec> = {
  CRAWL: { name: 'CRAWL', minMs: 0.1, maxMs: 10.0, defaultSlider: 0.45 },
  CRUISE: { name: 'CRUISE', minMs: 5.0, maxMs: 250.0, defaultSlider: 0.38 },
  WARP: { name: 'WARP', minMs: 250.0, maxMs: 50000.0, defaultSlider: 0.35 },
};

export const DEVICE_BUDGETS: Record<DeviceModeName, DeviceBudget> = {
  Balanced: {
    name: 'Balanced',
    targetFps: 60,
    initialRenderScale: 0.75,
    clipmapN: 192,
    clipmapRings: 6,
    beamSteps: 4,
    snowCount: 16000,
    caustics: true,
    maxDpr: 2.0,
  },
  Detail: {
    name: 'Detail',
    targetFps: 40,
    initialRenderScale: 0.85,
    clipmapN: 256,
    clipmapRings: 6,
    beamSteps: 6,
    snowCount: 24000,
    caustics: true,
    maxDpr: 2.2,
  },
  Max: {
    name: 'Max',
    targetFps: 60,
    initialRenderScale: 0.85,
    clipmapN: 256,
    clipmapRings: 6,
    beamSteps: 6,
    snowCount: 24000,
    caustics: true,
    maxDpr: 2.2,
  },
  Cool: {
    name: 'Cool',
    targetFps: 30,
    initialRenderScale: 0.60,
    clipmapN: 128,
    clipmapRings: 5,
    beamSteps: 0,
    snowCount: 6000,
    caustics: false,
    maxDpr: 1.5,
  },
};

export const DEFAULT_CONFIG = {
  seed: WORLD_SEED,
  absorbR: 0.37,
  absorbG: 0.09,
  absorbB: 0.042,
  kdClear: 1.0,
  kdCoastal: 2.1,
  kdMurky: 4.5,
  torchLumensStd: 75,
  backscatterStrength: 0.085,
  snowDensity: 1.0,
  waveSteepness: 0.28,
  detailAmplitude: 1.0,
  tDark: 220,
  verticalExag: 1.0,
  darknessFidelity: 1.0,
};

export const CONFIG = { ...DEFAULT_CONFIG };

export function resetConfig() {
  Object.assign(CONFIG, DEFAULT_CONFIG);
}
