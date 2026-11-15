/**
 * Web Worker #2: Off-thread bathymetry queries & spatial feature nearest lookup (v2.2 §2).
 * Prepares the async worker boundary for Phase 3 GEBCO tile decoding.
 */

import featuresData from '../data/features.mini.json';
import { FeatureRecord } from '../types';
import { latLonToLocalMeters } from '../world/coords';
import { heightAt } from '../terrain/heightfield';
import { WORLD_SEED } from '../core/hash';

const FEATURES = featuresData as FeatureRecord[];

export interface TileQueryRequest {
  requestId: number;
  lat: number;
  lon: number;
  camEast: number;
  camNorth: number;
  originLat: number;
  originLon: number;
}

self.onmessage = (e: MessageEvent<TileQueryRequest>) => {
  const req = e.data;
  const seabedY = heightAt(req.camEast, req.camNorth, req.lat, req.lon, 5, WORLD_SEED);

  let nearestName: string | null = null;
  let nearestDist = 1e9;
  let nearestNote: string | null = null;

  for (let i = 0; i < FEATURES.length; i++) {
    const f = FEATURES[i];
    const rel = latLonToLocalMeters(req.originLat, req.originLon, f.lat, f.lon);
    const dx = rel.east - req.camEast;
    const dz = rel.north - req.camNorth;
    const dist = Math.hypot(dx, dz);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestName = f.name;
      nearestNote = f.tags?.includes('war_grave')
        ? 'Memorial / War Grave — observe respectfully.'
        : f.notes ?? null;
    }
  }

  self.postMessage({
    requestId: req.requestId,
    seabedY,
    nearestFeature:
      nearestDist <= 1500
        ? { name: nearestName, distM: nearestDist, note: nearestNote }
        : { name: null, distM: null, note: null },
  });
};
