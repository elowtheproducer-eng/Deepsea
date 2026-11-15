/**
 * Photon-Budget visibility reach, Beer-Lambert sunlight, torch cone distance solver,
 * exponential speed mapping, and ocean depth zones (v2.1 §4.4 + Blueprint §6.4).
 */

import { CONFIG, SPEED_MODES } from './config';
import { Reach, SpeedModeName, WaterType } from '../types';

export function sunlightBlueAtDepth(depthM: number, kdBlue: number, timeOfDay: number): number {
  const solarAngle = Math.cos(((timeOfDay - 12) / 12) * Math.PI);
  const surfaceIntensity = Math.max(0.03, solarAngle * 0.97 + 0.03);
  if (depthM <= 0) return surfaceIntensity;
  return surfaceIntensity * Math.exp(-kdBlue * 0.42 * depthM);
}

export function solveTorchReach(lumensScale: number, kdMin: number, floorIrrad: number = 0.0025): number {
  if (lumensScale <= 0) return 0;
  let hi = 120;
  let lo = 1;
  for (let i = 0; i < 16; i++) {
    const mid = 0.5 * (lo + hi);
    const val = (lumensScale * Math.exp(-kdMin * mid)) / (mid * mid);
    if (val > floorIrrad) lo = mid;
    else hi = mid;
  }
  return Math.max(12, Math.min(115, lo));
}

export function getWaterKdMultiplier(waterType: WaterType): number {
  if (waterType === 'Coastal') return CONFIG.kdCoastal;
  if (waterType === 'Murky') return CONFIG.kdMurky;
  return CONFIG.kdClear;
}

export function computeReach(params: {
  depthM: number;
  timeOfDay: number;
  waterType: WaterType;
  torchOn: boolean;
  torchPower: 'Low' | 'Std' | 'Search' | 'Flood';
  torchFocus: number;
  sonarActive: boolean;
  sonarRadius: number;
  isWarp: boolean;
}): Reach {
  const kdMult = getWaterKdMultiplier(params.waterType);
  const kdBlue = CONFIG.absorbB * kdMult;
  const sunlightFraction = sunlightBlueAtDepth(params.depthM, kdBlue, params.timeOfDay);

  // Above water or Warp sees far horizon
  let omni = params.depthM <= 0 ? 1800 : 18 + 380 * sunlightFraction;
  if (params.isWarp) omni = Math.max(omni, 950);

  const powerMult =
    params.torchPower === 'Low'
      ? 0.45
      : params.torchPower === 'Search'
      ? 2.2
      : params.torchPower === 'Flood'
      ? 1.55
      : 1.0;

  const focusRangeBoost = 1.25 - params.torchFocus * 0.45;
  const torchScale = CONFIG.torchLumensStd * powerMult * focusRangeBoost;
  const cone = params.torchOn
    ? Math.max(omni * 0.7, solveTorchReach(torchScale, kdBlue))
    : omni;

  const coneHalfAngle = ((14 + params.torchFocus * 26) * Math.PI) / 180;
  const coarse = params.sonarActive
    ? Math.max(omni, Math.min(900, params.sonarRadius + 60))
    : Math.max(omni, cone);

  return {
    omni,
    cone,
    coarse,
    coneHalfAngle,
    sunlightFraction,
  };
}

export function deriveMinCell(depthM: number, targetFps: number): number {
  const base = depthM < 60 ? 0.04 : depthM < 400 ? 0.08 : 0.12;
  return targetFps <= 30 ? base * 1.5 : base;
}

export function speedFromSlider(mode: SpeedModeName, slider01: number): number {
  const spec = SPEED_MODES[mode];
  const t = Math.max(0, Math.min(1, slider01));
  return spec.minMs * Math.pow(spec.maxMs / spec.minMs, t);
}

export function getDepthZone(depthM: number): string {
  if (depthM <= 0) return 'Sea Surface';
  if (depthM < 200) return 'Epipelagic (Sunlit)';
  if (depthM < 1000) return 'Mesopelagic (Twilight)';
  if (depthM < 4000) return 'Bathypelagic (Midnight)';
  if (depthM < 6000) return 'Abyssopelagic (Abyss)';
  return 'Hadopelagic (Trench)';
}

export function getSpeedComparison(speedMs: number): string {
  if (speedMs < 0.8) return 'Drift';
  if (speedMs < 2.2) return 'Diver Swim';
  if (speedMs < 12) return 'Submersible';
  if (speedMs < 80) return 'Jet Cruise';
  if (speedMs < 500) return 'Supersonic';
  return 'Orbital Survey';
}
