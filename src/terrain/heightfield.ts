/**
 * CPU Twin of the GPU Geometry Clipmap Bathymetry + 10-Octave World-Space Noise.
 * Matches src/terrain/clipmap.ts vertex shader math so camera collision, wrecks,
 * instanced rocks/corals, and TileWorker depth queries sit flush on the terrain.
 */

import { hash2, WORLD_SEED } from '../core/hash';
import { computeExactLattice, localMetersToLatLon } from '../world/coords';
import { CONFIG } from '../core/config';

export interface TerrainOctave {
  freq: number;
  amp: number;
  ridged: boolean;
}

export const TERRAIN_OCTAVES: TerrainOctave[] = [
  { freq: 0.00028, amp: 420.0, ridged: false },
  { freq: 0.00065, amp: 185.0, ridged: true },
  { freq: 0.0018, amp: 74.0, ridged: true },
  { freq: 0.0046, amp: 28.0, ridged: false },
  { freq: 0.012, amp: 11.0, ridged: true },
  { freq: 0.035, amp: 3.8, ridged: false },
  { freq: 0.095, amp: 1.4, ridged: true },
  { freq: 0.24, amp: 0.52, ridged: false },
  { freq: 0.68, amp: 0.22, ridged: true },
  { freq: 1.85, amp: 0.09, ridged: false },
];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function smoothNoise(
  worldX: number,
  worldZ: number,
  octIdx: number,
  freq: number,
  seed: number
): number {
  const lat = computeExactLattice(worldX, worldZ, freq);
  const ux = lat.fracX * lat.fracX * (3 - 2 * lat.fracX);
  const uz = lat.fracZ * lat.fracZ * (3 - 2 * lat.fracZ);

  const octSeed = (seed + octIdx * 101) >>> 0;
  const a = hash2(lat.intX, lat.intZ, octSeed);
  const b = hash2(lat.intX + 1, lat.intZ, octSeed);
  const c = hash2(lat.intX, lat.intZ + 1, octSeed);
  const d = hash2(lat.intX + 1, lat.intZ + 1, octSeed);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function macroBathymetryMeters(lat: number, lon: number): number {
  const dDeans = Math.hypot((lat - 23.10639) * 111319.0, (lon + 75.00861) * 102400.0);
  if (dDeans < 2500.0) {
    const shaft = dDeans < 65.0 ? -202.0 * (1.0 - Math.pow(dDeans / 65.0, 3.0)) : 0.0;
    const bank = -12.0 - 0.08 * Math.max(0.0, dDeans - 120.0);
    return Math.min(bank, shaft - 6.0);
  }

  const dMariana = Math.hypot((lat - 11.373) * 111319.0, (lon - 142.591) * 109100.0);
  if (dMariana < 35000.0) {
    return -10920.0 + Math.min(4800.0, dMariana * 0.22);
  }

  const dGbr = Math.hypot((lat + 18.287) * 111319.0, (lon - 147.699) * 105700.0);
  if (dGbr < 8000.0) {
    return -14.0 - Math.max(0.0, dGbr - 800.0) * 0.04;
  }

  const dTitanic = Math.hypot((lat - 41.73) * 111319.0, (lon + 49.95) * 83000.0);
  if (dTitanic < 15000.0) {
    return -3810.0 + Math.sin(dTitanic * 0.0005) * 65.0;
  }

  const dFalse = Math.hypot((lat + 34.135) * 111319.0, (lon - 18.586) * 92100.0);
  if (dFalse < 12000.0) {
    return -36.0 - dFalse * 0.015;
  }

  const basin = -2600.0 + 2250.0 * Math.cos(lat * 0.14) * Math.sin(lon * 0.14);
  const ridge = Math.sin(lon * 0.35 + Math.cos(lat * 0.22)) * 950.0;
  return Math.min(-28.0, basin + ridge);
}

export function heightAt(
  localX: number,
  localZ: number,
  originLat: number,
  originLon: number,
  octaveCount: number = 8,
  seed: number = WORLD_SEED,
  detailAmp: number = CONFIG.detailAmplitude,
  verticalExag: number = CONFIG.verticalExag
): number {
  const { lat, lon } = localMetersToLatLon(originLat, originLon, localX, localZ);
  const dDeans = Math.hypot((lat - 23.10639) * 111319.0, (lon + 75.00861) * 102400.0);
  const dGbr = Math.hypot((lat + 18.287) * 111319.0, (lon - 147.699) * 105700.0);
  const shallowDamp = Math.min(
    1.0,
    dDeans < 400.0 ? Math.max(0.05, (dDeans - 30.0) / 370.0) : dGbr < 2000.0 ? 0.08 : 1.0
  );

  const tidSample = smoothNoise(localX, localZ, 0, 0.00045, seed);
  const predictedMask = smoothstep(0.35, 0.78, tidSample);
  const tidAmp = 0.65 + (1.25 - 0.65) * predictedMask;

  let relief = 0;
  const maxOct = Math.min(TERRAIN_OCTAVES.length, Math.max(1, octaveCount));
  for (let i = 0; i < maxOct; i++) {
    const oct = TERRAIN_OCTAVES[i];
    const bandScale = i < 2 ? shallowDamp : tidAmp;
    const n = smoothNoise(localX, localZ, i, oct.freq, seed);
    const s = n * 2.0 - 1.0;
    const val = oct.ridged ? (1.0 - Math.abs(s)) * 2.0 - 1.0 : s;
    relief += val * oct.amp * detailAmp * bandScale;
  }

  return Math.min(-4.0, macroBathymetryMeters(lat, lon) + relief) * verticalExag;
}
