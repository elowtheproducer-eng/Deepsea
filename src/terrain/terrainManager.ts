/**
 * Procedural bathymetry and seabed mesh generator for Phase 1 & 2.
 * Uses world-space noise (no seams) and simulates depth zones, trenches, and shelves.
 */

import * as THREE from 'three';

// Simple deterministic hash / noise function for procedural world generation
function pseudoNoise2D(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;

  const s = fx * fx * (3 - 2 * fx); // simplified smoothstep
  const t = fy * fy * (3 - 2 * fy);

  const n00 = pseudoNoise2D(i, j);
  const n10 = pseudoNoise2D(i + 1, j);
  const n01 = pseudoNoise2D(i, j + 1);
  const n11 = pseudoNoise2D(i + 1, j + 1);

  const nx0 = n00 * (1 - fx) + n10 * fx;
  const nx1 = n01 * (1 - fx) + n11 * fx;
  return nx0 * (1 - fy) + nx1 * fy;
}

export function fbm(x: number, y: number, octaves = 4): number {
  let val = 0;
  let freq = 1;
  let amp = 0.5;
  for (let o = 0; o < octaves; o++) {
    val += smoothNoise(x * freq, y * freq) * amp;
    freq *= 2.0;
    amp *= 0.5;
  }
  return val;
}

/**
 * Returns baseline ocean depth (negative meters) and micro-relief at given lat/lon.
 */
export function getSeabedDepth(lat: number, lon: number): number {
  // Base continental shelf & abyss simulation
  const distFromCenter = Math.sqrt(lat * lat + lon * lon);
  
  // Continental shelf near ~0,0 or coastlines, dropping into abyssal plain (~4000m) and trench (~10000m)
  const baseAbyss = -4000;
  const shelf = Math.exp(-distFromCenter * 0.05) * 3800; // shallow shelf near origin
  const trench = Math.sin(lat * 0.2) * Math.cos(lon * 0.2) > 0.7 ? -6500 : 0;
  
  // World-space procedural micro-hills (abyssal hills)
  const micro = (fbm(lat * 0.01, lon * 0.01) - 0.5) * 800;

  let depth = baseAbyss + shelf + trench + micro;
  if (depth > -10) depth = -10; // keep below surface
  return depth;
}

export class TerrainManager {
  mesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshStandardMaterial;

  constructor() {
    // Create a large camera-centered terrain patch for free-roam exploration
    this.geometry = new THREE.PlaneGeometry(10000, 10000, 128, 128);
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.MeshStandardMaterial({
      color: 0x112233,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.updateHeights(0, 0);
  }

  updateHeights(centerX: number, centerZ: number) {
    const pos = this.geometry.attributes.position;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      vertex.fromBufferAttribute(pos, i);
      const worldX = vertex.x + centerX;
      const worldZ = vertex.z + centerZ;

      // Approximate lat/lon from local offset meters
      const lat = worldZ * 9e-6;
      const lon = worldX * 9e-6;

      const depth = getSeabedDepth(lat, lon);
      // In Three.js y is up, so seabed is at negative depth
      vertex.y = depth;
      pos.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
