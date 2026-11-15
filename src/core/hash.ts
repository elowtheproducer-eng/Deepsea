/**
 * Deterministic PCG 32-bit hashing (no Math.random() anywhere in world generation).
 * Matches the GLSL integer PCG hash in src/terrain/clipmap.ts bit-for-bit on cell corners.
 */

export const WORLD_SEED = 0x4f434541; // "OCEA"

export function pcg(v: number): number {
  let s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const shift = ((s >>> 28) + 4) >>> 0;
  let w = Math.imul((s >>> shift) ^ s, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

export function hash2(x: number, z: number, seed: number = WORLD_SEED): number {
  const hx = Math.imul(x | 0, 1597334677) >>> 0;
  const hz = pcg(((z | 0) + 0x9e3779b9) >>> 0);
  return pcg((hx ^ hz ^ (seed >>> 0)) >>> 0) / 4294967295;
}

export function hash3(x: number, y: number, z: number, seed: number = WORLD_SEED): number {
  const hx = Math.imul(x | 0, 1597334677) >>> 0;
  const hy = Math.imul(y | 0, 3812015801) >>> 0;
  const hz = pcg(((z | 0) + 0x9e3779b9) >>> 0);
  return pcg((hx ^ hy ^ hz ^ (seed >>> 0)) >>> 0) / 4294967295;
}

export class DeterministicRng {
  private state: number;

  constructor(seed: number = WORLD_SEED) {
    this.state = (seed >>> 0) || WORLD_SEED;
  }

  next(): number {
    this.state = pcg(this.state);
    return this.state / 4294967295;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(minInclusive: number, maxInclusive: number): number {
    return Math.floor(minInclusive + this.next() * (maxInclusive - minInclusive + 1));
  }
}
