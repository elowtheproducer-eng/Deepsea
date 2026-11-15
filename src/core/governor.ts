/**
 * Thermal-Aware Density Governor & Divisor Frame Pacing (v2.2 §1, §3, §5).
 * - Measures display refresh tickHz (120 / 90 / 60 Hz)
 * - Enforces divisor pacing: 120Hz -> every 2nd tick (60fps), every 3rd (40fps), every 4th (30fps)
 * - Classifies CPU-bound vs GPU-bound frames and steps discrete render scales {0.85, 0.75, 0.67, 0.60}
 * - Detects >12% frame-time creep as sustained thermal throttling
 */

import { DEVICE_BUDGETS } from './config';
import { DeviceModeName, GovernorTelemetry } from '../types';

export const RENDER_SCALE_STEPS = [0.85, 0.75, 0.67, 0.60] as const;

export class DensityGovernor {
  mode: DeviceModeName = 'Balanced';
  renderScale = DEVICE_BUDGETS.Balanced.initialRenderScale;
  clipmapN = DEVICE_BUDGETS.Balanced.clipmapN;
  clipmapRings = DEVICE_BUDGETS.Balanced.clipmapRings;
  beamSteps: 0 | 4 | 6 = DEVICE_BUDGETS.Balanced.beamSteps;
  snowCount = DEVICE_BUDGETS.Balanced.snowCount;
  caustics = DEVICE_BUDGETS.Balanced.caustics;
  targetFps = DEVICE_BUDGETS.Balanced.targetFps;

  tickHz = 60;
  emaFrameMs = 16.6;
  emaSubmitMs = 3.0;
  bottleneck: 'BALANCED' | 'CPU' | 'GPU' = 'BALANCED';
  throttled = false;
  frozen = false;

  private lastRafMs = 0;
  private rafSamples = 0;
  private rafIntervalEma = 16.67;
  private baselineFrameMs = 0;
  private warmupFrames = 0;
  private overBudgetFrames = 0;
  private underBudgetFrames = 0;
  private lastStepMs = 0;
  private measuredFps = 60;
  private fpsFrames = 0;
  private fpsWindowStart = 0;

  setMode(mode: DeviceModeName) {
    this.mode = mode;
    const b = DEVICE_BUDGETS[mode];
    this.targetFps = b.targetFps;
    this.renderScale = b.initialRenderScale;
    this.clipmapN = b.clipmapN;
    this.clipmapRings = b.clipmapRings;
    this.beamSteps = b.beamSteps;
    this.snowCount = b.snowCount;
    this.caustics = b.caustics;
    this.overBudgetFrames = 0;
    this.underBudgetFrames = 0;
    this.baselineFrameMs = 0;
    this.warmupFrames = 0;
    this.throttled = false;
  }

  setFrozen(frozen: boolean) {
    this.frozen = frozen;
  }

  recordRafTick(nowMs: number) {
    if (this.lastRafMs > 0) {
      const dt = nowMs - this.lastRafMs;
      if (dt > 4 && dt < 45) {
        this.rafIntervalEma = this.rafIntervalEma * 0.85 + dt * 0.15;
        this.rafSamples++;
        if (this.rafSamples >= 15) {
          if (this.rafIntervalEma < 9.5) this.tickHz = 120;
          else if (this.rafIntervalEma < 12.8) this.tickHz = 90;
          else this.tickHz = 60;
        }
      }
    }
    this.lastRafMs = nowMs;
  }

  getDivisor(): number {
    if (this.tickHz >= 110) {
      if (this.targetFps >= 60) return 2;
      if (this.targetFps >= 40) return 3;
      return 4;
    }
    if (this.tickHz >= 85) {
      if (this.targetFps >= 45) return 2;
      return 3;
    }
    if (this.targetFps <= 30) return 2;
    return 1;
  }

  recordFrame(frameMs: number, submitMs: number, nowMs: number) {
    const clampedFrame = Math.min(80, Math.max(1, frameMs));
    const clampedSubmit = Math.min(80, Math.max(0.1, submitMs));
    this.emaFrameMs = this.emaFrameMs * 0.9 + clampedFrame * 0.1;
    this.emaSubmitMs = this.emaSubmitMs * 0.9 + clampedSubmit * 0.1;

    if (this.fpsWindowStart === 0) this.fpsWindowStart = nowMs;
    this.fpsFrames++;
    if (nowMs - this.fpsWindowStart >= 500) {
      this.measuredFps = Math.round((this.fpsFrames * 1000) / Math.max(1, nowMs - this.fpsWindowStart));
      this.fpsFrames = 0;
      this.fpsWindowStart = nowMs;
    }

    const budgetMs = 1000 / Math.max(24, this.targetFps);
    if (this.emaSubmitMs > budgetMs * 0.52) {
      this.bottleneck = 'CPU';
    } else if (this.emaFrameMs > budgetMs * 0.95) {
      this.bottleneck = 'GPU';
    } else {
      this.bottleneck = 'BALANCED';
    }

    this.warmupFrames++;
    if (this.warmupFrames === 45) {
      this.baselineFrameMs = this.emaFrameMs;
    } else if (this.warmupFrames > 90 && this.baselineFrameMs > 0) {
      this.throttled = this.emaFrameMs > this.baselineFrameMs * 1.12 && this.emaFrameMs > budgetMs * 0.85;
    }

    if (this.frozen || nowMs - this.lastStepMs < 1500) return;

    if (this.emaFrameMs > budgetMs * 1.12) {
      this.overBudgetFrames++;
      this.underBudgetFrames = 0;
      if (this.overBudgetFrames >= 24) {
        this.stepDown();
        this.overBudgetFrames = 0;
        this.lastStepMs = nowMs;
      }
    } else if (this.emaFrameMs < budgetMs * 0.72) {
      this.underBudgetFrames++;
      this.overBudgetFrames = 0;
      if (this.underBudgetFrames >= 90) {
        this.stepUp();
        this.underBudgetFrames = 0;
        this.lastStepMs = nowMs;
      }
    } else {
      this.overBudgetFrames = Math.max(0, this.overBudgetFrames - 1);
      this.underBudgetFrames = Math.max(0, this.underBudgetFrames - 1);
    }
  }

  private stepDown() {
    const idx = RENDER_SCALE_STEPS.indexOf(this.renderScale as (typeof RENDER_SCALE_STEPS)[number]);
    if (idx >= 0 && idx < RENDER_SCALE_STEPS.length - 1) {
      this.renderScale = RENDER_SCALE_STEPS[idx + 1];
      return;
    }
    if (this.beamSteps === 6) {
      this.beamSteps = 4;
      return;
    }
    if (this.snowCount > 8000) {
      this.snowCount = 8000;
      return;
    }
    if (this.clipmapN > 128) {
      this.clipmapN = 128;
      return;
    }
    if (this.beamSteps === 4) {
      this.beamSteps = 0;
    }
  }

  private stepUp() {
    const budget = DEVICE_BUDGETS[this.mode];
    if (this.clipmapN < budget.clipmapN) {
      this.clipmapN = budget.clipmapN;
      return;
    }
    if (this.beamSteps < budget.beamSteps) {
      this.beamSteps = budget.beamSteps;
      return;
    }
    const idx = RENDER_SCALE_STEPS.indexOf(this.renderScale as (typeof RENDER_SCALE_STEPS)[number]);
    if (idx > 0 && RENDER_SCALE_STEPS[idx - 1] <= budget.initialRenderScale) {
      this.renderScale = RENDER_SCALE_STEPS[idx - 1];
      return;
    }
    if (this.snowCount < budget.snowCount) {
      this.snowCount = budget.snowCount;
    }
  }

  getTelemetry(extra: {
    triangles: number;
    calls: number;
    activeRings: number;
    visibleSectors: number;
    cell0Meters: number;
    reachOmni: number;
    reachCone: number;
  }): GovernorTelemetry {
    return {
      fps: this.measuredFps,
      targetFps: this.targetFps,
      tickHz: this.tickHz,
      bottleneck: this.bottleneck,
      mode: this.mode,
      renderScale: this.renderScale,
      emaFrameMs: this.emaFrameMs,
      emaSubmitMs: this.emaSubmitMs,
      throttled: this.throttled,
      triangles: extra.triangles,
      calls: extra.calls,
      clipmapN: this.clipmapN,
      activeRings: extra.activeRings,
      visibleSectors: extra.visibleSectors,
      cell0Meters: extra.cell0Meters,
      reachOmni: extra.reachOmni,
      reachCone: extra.reachCone,
    };
  }
}
