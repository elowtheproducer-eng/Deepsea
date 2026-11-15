/**
 * Double-precision world coordinates, ECEF math, and ENU tangent frame conversion.
 * Avoids floating-point precision jitter during global navigation (Warp / Cruise).
 */

import * as THREE from 'three';

// WGS84 ellipsoid constants
export const WGS84_A = 6378137.0; // semi-major axis in meters
export const WGS84_B = 6356752.3142; // semi-minor axis
export const WGS84_F = 1.0 / 298.257223563;

export interface GeoCoord {
  lat: number; // degrees
  lon: number; // degrees
  h: number; // meters above WGS84 ellipsoid (0 = sea level)
}

/**
 * Convert geodetic (lat, lon, h) to Earth-Centered Earth-Fixed (ECEF) f64 vector.
 */
export function geoToEcef(coord: GeoCoord): THREE.Vector3 {
  const latRad = THREE.MathUtils.degToRad(coord.lat);
  const lonRad = THREE.MathUtils.degToRad(coord.lon);
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);

  const e2 = 2 * WGS84_F - WGS84_F * WGS84_F;
  const N = WGS84_A / Math.sqrt(1.0 - e2 * sinLat * sinLat);

  const x = (N + coord.h) * cosLat * cosLon;
  const y = (N + coord.h) * cosLat * sinLon;
  const z = (N * (1.0 - e2) + coord.h) * sinLat;

  return new THREE.Vector3(x, y, z);
}

/**
 * Convert ECEF back to geodetic (lat, lon, h) using Bowring's method.
 */
export function ecefToGeo(ecef: THREE.Vector3): GeoCoord {
  const x = ecef.x;
  const y = ecef.y;
  const z = ecef.z;

  const p = Math.sqrt(x * x + y * y);
  if (p < 1e-6) {
    return {
      lat: z > 0 ? 90 : -90,
      lon: 0,
      h: Math.abs(z) - WGS84_B,
    };
  }

  const e2 = 2 * WGS84_F - WGS84_F * WGS84_F;
  const ep2 = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_B * WGS84_B);
  const atan = Math.atan2(z * WGS84_A, p * WGS84_B);
  const latRad = Math.atan2(
    z + ep2 * WGS84_B * Math.pow(Math.sin(atan), 3),
    p - e2 * WGS84_A * Math.pow(Math.cos(atan), 3)
  );
  const lonRad = Math.atan2(y, x);

  const sinLat = Math.sin(latRad);
  const N = WGS84_A / Math.sqrt(1.0 - e2 * sinLat * sinLat);
  const h = p / Math.cos(latRad) - N;

  return {
    lat: THREE.MathUtils.radToDeg(latRad),
    lon: THREE.MathUtils.radToDeg(lonRad),
    h,
  };
}

/**
 * Compute East-North-Up (ENU) basis vectors at given geodetic coordinate.
 */
export function getEnuBasis(coord: GeoCoord) {
  const latRad = THREE.MathUtils.degToRad(coord.lat);
  const lonRad = THREE.MathUtils.degToRad(coord.lon);

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);

  // East vector
  const east = new THREE.Vector3(-sinLon, cosLon, 0).normalize();
  // North vector
  const north = new THREE.Vector3(-sinLat * cosLon, -sinLat * sinLon, cosLat).normalize();
  // Up vector (normal to ellipsoid)
  const up = new THREE.Vector3(cosLat * cosLon, cosLat * sinLon, sinLat).normalize();

  return { east, north, up };
}
