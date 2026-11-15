/**
 * Double-precision geodetic / local ENU coordinates & exact-lattice noise split (v2.1 §4.3).
 * World geometry stays centered near (0, cam.h, 0) in float32 while originLatLon tracks f64.
 */

const METERS_PER_DEG_LAT = 111319.490793;

export function localMetersToLatLon(
  originLat: number,
  originLon: number,
  eastM: number,
  northM: number
): { lat: number; lon: number } {
  const lat = originLat + northM / METERS_PER_DEG_LAT;
  const cosLat = Math.max(0.08, Math.cos((originLat * Math.PI) / 180));
  const lon = originLon + eastM / (METERS_PER_DEG_LAT * cosLat);
  return { lat, lon };
}

export function latLonToLocalMeters(
  originLat: number,
  originLon: number,
  lat: number,
  lon: number
): { east: number; north: number } {
  const north = (lat - originLat) * METERS_PER_DEG_LAT;
  const cosLat = Math.max(0.08, Math.cos((originLat * Math.PI) / 180));
  const east = (lon - originLon) * METERS_PER_DEG_LAT * cosLat;
  return { east, north };
}

export function computeExactLattice(
  worldX: number,
  worldZ: number,
  freq: number
): { intX: number; intZ: number; fracX: number; fracZ: number } {
  const sx = worldX * freq;
  const sz = worldZ * freq;
  const intX = Math.floor(sx);
  const intZ = Math.floor(sz);
  return {
    intX,
    intZ,
    fracX: sx - intX,
    fracZ: sz - intZ,
  };
}
