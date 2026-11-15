/**
 * Web Worker #1: Off-thread deterministic cell spawner (v2.2 §2 & §10 U6).
 * Computes rock/coral/sponge & fish school instance positions/scales/colors
 * using deterministic PCG hashing and transfers ArrayBuffers back to main thread.
 */

import { DeterministicRng, hash2, WORLD_SEED } from '../core/hash';
import { heightAt } from '../terrain/heightfield';
import speciesData from '../data/species.mini.json';
import { SpeciesRecord } from '../types';

export interface SpawnRequest {
  requestId: number;
  camEast: number;
  camNorth: number;
  camH: number;
  originLat: number;
  originLon: number;
  reachMeters: number;
  maxRocks: number;
  maxCorals: number;
  maxFish: number;
  timeOfDay: number;
  seed: number;
}

const SPECIES = speciesData as SpeciesRecord[];

function computeCellSize(reachMeters: number): number {
  return reachMeters < 45 ? 16 : 32;
}

self.onmessage = (e: MessageEvent<SpawnRequest>) => {
  const req = e.data;
  const cellSize = computeCellSize(req.reachMeters);
  const reach = Math.min(110, Math.max(24, req.reachMeters));
  const minCx = Math.floor((req.camEast - reach) / cellSize);
  const maxCx = Math.floor((req.camEast + reach) / cellSize);
  const minCz = Math.floor((req.camNorth - reach) / cellSize);
  const maxCz = Math.floor((req.camNorth + reach) / cellSize);

  // Each instance record: [worldX, worldY, worldZ, scale, yaw, colorR, colorG, colorB] = 8 floats
  const STRIDE = 8;
  const rocks = new Float32Array(req.maxRocks * STRIDE);
  const corals = new Float32Array(req.maxCorals * STRIDE);
  const fish = new Float32Array(req.maxFish * STRIDE);
  let rockCount = 0;
  let coralCount = 0;
  let fishCount = 0;

  // Diel vertical migration offset (mesopelagic layer rises at night)
  const nightFactor = 1.0 - Math.max(0, Math.cos(((req.timeOfDay - 12) / 12) * Math.PI));
  const dslShift = nightFactor * 220;

  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const cellSeed = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ req.seed) >>> 0;
      const rng = new DeterministicRng(cellSeed || WORLD_SEED);

      const cellCenterX = (cx + 0.5) * cellSize;
      const cellCenterZ = (cz + 0.5) * cellSize;
      const dx = cellCenterX - req.camEast;
      const dz = cellCenterZ - req.camNorth;
      if (dx * dx + dz * dz > reach * reach) continue;

      const approxLat = req.originLat + cellCenterZ / 111319.49;
      const approxLon = req.originLon + cellCenterX / (111319.49 * Math.max(0.1, Math.cos((req.originLat * Math.PI) / 180)));

      // 1. Rocks & boulders (world-space ground-pinned)
      const rockTarget = Math.min(8, req.maxRocks - rockCount);
      for (let i = 0; i < rockTarget; i++) {
        const wx = cx * cellSize + rng.next() * cellSize;
        const wz = cz * cellSize + rng.next() * cellSize;
        const wy = heightAt(wx, wz, approxLat, approxLon, 5, req.seed);
        const scale = rng.range(0.45, 2.8);
        const yaw = rng.range(0, Math.PI * 2);
        const tint = rng.range(0.75, 1.15);
        const off = rockCount * STRIDE;
        rocks[off] = wx;
        rocks[off + 1] = wy - scale * 0.2;
        rocks[off + 2] = wz;
        rocks[off + 3] = scale;
        rocks[off + 4] = yaw;
        rocks[off + 5] = 0.25 * tint;
        rocks[off + 6] = 0.24 * tint;
        rocks[off + 7] = 0.22 * tint;
        rockCount++;
      }

      // 2. Corals / sponges / tube worms (depth-plausible)
      const centerDepth = -heightAt(cellCenterX, cellCenterZ, approxLat, approxLon, 4, req.seed);
      const isShallowReef = centerDepth < 55;
      const coralTarget = Math.min(isShallowReef ? 10 : 3, req.maxCorals - coralCount);
      for (let i = 0; i < coralTarget; i++) {
        const wx = cx * cellSize + rng.next() * cellSize;
        const wz = cz * cellSize + rng.next() * cellSize;
        const wy = heightAt(wx, wz, approxLat, approxLon, 5, req.seed);
        const scale = isShallowReef ? rng.range(0.5, 1.9) : rng.range(0.25, 0.85);
        const yaw = rng.range(0, Math.PI * 2);
        const huePick = hash2(cx * 31 + i, cz * 17, req.seed);
        const off = coralCount * STRIDE;
        corals[off] = wx;
        corals[off + 1] = wy;
        corals[off + 2] = wz;
        corals[off + 3] = scale;
        corals[off + 4] = yaw;
        if (isShallowReef) {
          corals[off + 5] = huePick < 0.35 ? 0.92 : huePick < 0.7 ? 0.32 : 0.85;
          corals[off + 6] = huePick < 0.35 ? 0.42 : huePick < 0.7 ? 0.78 : 0.72;
          corals[off + 7] = huePick < 0.35 ? 0.38 : huePick < 0.7 ? 0.65 : 0.25;
        } else {
          // Deep sea glass sponges / cold-water pale coral
          corals[off + 5] = 0.72;
          corals[off + 6] = 0.76;
          corals[off + 7] = 0.82;
        }
        coralCount++;
      }

      // 3. Plausibility-filtered marine life (strictly inside species depth bounds!)
      const camDepth = Math.max(0, -req.camH);
      for (let s = 0; s < SPECIES.length && fishCount < req.maxFish; s++) {
        const sp = SPECIES[s];
        const minD = Math.max(0, sp.depthM.min - (sp.behavior === 'school' ? dslShift * 0.4 : 0));
        const maxD = sp.depthM.max;
        if (camDepth < minD - 45 || camDepth > maxD + 45) continue;

        const spawnChance = Math.min(1, sp.densityPerCell * 0.35);
        if (rng.next() > spawnChance) continue;

        const schoolCount = sp.behavior === 'school' ? Math.min(12, req.maxFish - fishCount) : 1;
        const anchorX = cx * cellSize + rng.next() * cellSize;
        const anchorZ = cz * cellSize + rng.next() * cellSize;
        const seabedY = heightAt(anchorX, anchorZ, approxLat, approxLon, 4, req.seed);
        const minY = Math.max(seabedY + 1.5, -maxD);
        const maxY = Math.min(-Math.max(1.5, minD), -1.5);
        if (minY >= maxY) continue;

        const anchorY = sp.behavior === 'bentho_crawler'
          ? seabedY + 0.5
          : rng.range(minY, maxY);

        for (let k = 0; k < schoolCount; k++) {
          const off = fishCount * STRIDE;
          const sizeM = rng.range(sp.sizeM.min, Math.min(sp.sizeM.max, sp.sizeM.typ * 1.35));
          fish[off] = anchorX + rng.range(-6, 6);
          fish[off + 1] = anchorY + rng.range(-2.5, 2.5);
          fish[off + 2] = anchorZ + rng.range(-6, 6);
          fish[off + 3] = sizeM;
          fish[off + 4] = rng.range(0, Math.PI * 2);

          if (sp.palette === 'reef_gold') {
            fish[off + 5] = 0.95; fish[off + 6] = 0.72; fish[off + 7] = 0.22;
          } else if (sp.palette === 'abyssal_red') {
            fish[off + 5] = 0.72; fish[off + 6] = 0.14; fish[off + 7] = 0.12;
          } else if (sp.palette === 'biolum_cyan') {
            fish[off + 5] = 0.18; fish[off + 6] = 0.85; fish[off + 7] = 0.95;
          } else if (sp.palette === 'shark_grey') {
            fish[off + 5] = 0.42; fish[off + 6] = 0.46; fish[off + 7] = 0.50;
          } else {
            fish[off + 5] = 0.68; fish[off + 6] = 0.78; fish[off + 7] = 0.86;
          }
          fishCount++;
        }
      }
    }
  }

  const rocksOut = rocks.slice(0, rockCount * STRIDE);
  const coralsOut = corals.slice(0, coralCount * STRIDE);
  const fishOut = fish.slice(0, fishCount * STRIDE);

  self.postMessage(
    {
      requestId: req.requestId,
      camEast: req.camEast,
      camNorth: req.camNorth,
      rocks: rocksOut,
      rockCount,
      corals: coralsOut,
      coralCount,
      fish: fishOut,
      fishCount,
    },
    // @ts-expect-error Web Worker postMessage transferables
    [rocksOut.buffer, coralsOut.buffer, fishOut.buffer]
  );
};
