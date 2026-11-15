import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicRng, hash2, WORLD_SEED } from './hash';
import { computeExactLattice, latLonToLocalMeters, localMetersToLatLon } from '../world/coords';
import { heightAt } from '../terrain/heightfield';
import { computeReach, speedFromSlider, sunlightBlueAtDepth } from './reach';
import { DensityGovernor } from './governor';

test('deterministic PCG hashing & RNG never diverge', () => {
  const a = hash2(1024, -4096, WORLD_SEED);
  const b = hash2(1024, -4096, WORLD_SEED);
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 1);

  const r1 = new DeterministicRng(WORLD_SEED);
  const r2 = new DeterministicRng(WORLD_SEED);
  for (let i = 0; i < 10; i++) {
    assert.equal(r1.next(), r2.next());
  }
});

test('double-precision geodetic roundtrip stays sub-millimeter', () => {
  const oLat = 23.10639;
  const oLon = -75.00861;
  const ll = localMetersToLatLon(oLat, oLon, 12345.67, -8910.25);
  const en = latLonToLocalMeters(oLat, oLon, ll.lat, ll.lon);
  assert.ok(Math.abs(en.east - 12345.67) < 0.001);
  assert.ok(Math.abs(en.north - -8910.25) < 0.001);

  const split = computeExactLattice(50123.45, -19876.12, 1.85);
  assert.ok(split.fracX >= 0 && split.fracX < 1);
  assert.ok(split.fracZ >= 0 && split.fracZ < 1);
});

test('CPU heightfield twin honors global landmarks', () => {
  const deansCenter = heightAt(0, 0, 23.10639, -75.00861, 8, WORLD_SEED);
  assert.ok(deansCenter < -150 && deansCenter > -260, `Dean's depth got ${deansCenter}`);

  const challenger = heightAt(0, 0, 11.373, 142.591, 8, WORLD_SEED);
  assert.ok(challenger < -9500, `Challenger depth got ${challenger}`);

  const gbr = heightAt(0, 0, -18.287, 147.699, 8, WORLD_SEED);
  assert.ok(gbr < -5 && gbr > -45, `GBR depth got ${gbr}`);
});

test('Beer-Lambert sunlight attenuation and torch reach respond to depth and clarity', () => {
  const surf = sunlightBlueAtDepth(0, 0.042, 12);
  const twilight = sunlightBlueAtDepth(200, 0.042, 12);
  const midnight = sunlightBlueAtDepth(1200, 0.042, 12);
  assert.ok(surf > twilight);
  assert.ok(twilight > midnight);
  assert.ok(midnight < 1e-6);

  const clearReach = computeReach({
    depthM: 2000,
    timeOfDay: 12,
    waterType: 'Clear',
    torchOn: true,
    torchPower: 'Std',
    torchFocus: 0.3,
    sonarActive: false,
    sonarRadius: 0,
    isWarp: false,
  });
  const murkyReach = computeReach({
    depthM: 2000,
    timeOfDay: 12,
    waterType: 'Murky',
    torchOn: true,
    torchPower: 'Std',
    torchFocus: 0.3,
    sonarActive: false,
    sonarRadius: 0,
    isWarp: false,
  });
  assert.ok(clearReach.cone > murkyReach.cone);
});

test('exponential speed curves stay monotonic per mode', () => {
  assert.ok(speedFromSlider('CRAWL', 0) < speedFromSlider('CRAWL', 1));
  assert.ok(speedFromSlider('CRUISE', 0.5) < speedFromSlider('WARP', 0.5));
});

test('DensityGovernor divisor pacing and thermal throttle detection work', () => {
  const gov = new DensityGovernor();
  gov.setMode('Balanced');

  // Warm up 120Hz rAF cadence
  let t = 1000;
  for (let i = 0; i < 60; i++) {
    t += 8.333;
    gov.recordRafTick(t);
  }
  assert.equal(gov.tickHz, 120);
  const div = gov.getDivisor();
  assert.equal(div, 2);

  let rendered = 0;
  for (let i = 0; i < 120; i++) {
    if (i % div === 0) rendered++;
  }
  assert.equal(rendered, 60);

  // Simulate baseline 10ms frames then >12% thermal creep to 16ms
  for (let i = 0; i < 50; i++) {
    gov.recordFrame(10, 2, 2000 + i * 16);
  }
  assert.equal(gov.throttled, false);
  for (let i = 0; i < 90; i++) {
    gov.recordFrame(16.5, 2, 3000 + i * 16);
  }
  assert.equal(gov.throttled, true);
});
