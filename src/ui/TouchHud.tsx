/**
 * TouchHud (§2.2 & v2.2 §4.6 / §7)
 * Strictly <= 5 persistent elements in landscape:
 *  1) Top-left Depth Ribbon
 *  2) Top-right Menu button (tap = Quick Wheel, 1.5s long-press = Debug)
 *  3) Floating Move Stick visual (left zone, >=32dp from edge)
 *  4) Vertical Lever (right edge, >=32dp from edge, double-tap latch)
 *  5) Bottom Speed Strip (Torch tap/long-press + Crawl/Cruise/Warp + 48dp slider + +/- steppers)
 * Zero backdrop-blur over WebGL, fades to 30% after 4s idle.
 */

import React, { useRef, useSyncExternalStore } from 'react';
import { Flashlight, Menu, Minus, Plus, Compass } from 'lucide-react';
import {
  getHudSnapshot,
  notifyHudImmediate,
  STATE,
  subscribeHud,
} from '../core/state';
import { SPEED_MODES } from '../core/config';
import { SpeedModeName } from '../types';
import { triggerHaptic } from '../input/touchControls';

interface TouchHudProps {
  onOpenQuickWheel: () => void;
  onOpenTorchQuick: () => void;
  onOpenDebug: () => void;
  onOpenExpeditionBoard: () => void;
}

export const TouchHud: React.FC<TouchHudProps> = ({
  onOpenQuickWheel,
  onOpenTorchQuick,
  onOpenDebug,
  onOpenExpeditionBoard,
}) => {
  const hud = useSyncExternalStore(subscribeHud, getHudSnapshot, getHudSnapshot);
  const menuTimerRef = useRef<number | null>(null);
  const menuLongPressedRef = useRef(false);
  const torchTimerRef = useRef<number | null>(null);
  const torchLongPressedRef = useRef(false);
  const lastThumbTapRef = useRef(0);

  const isIdle = hud.idleSeconds > 4.0;
  const fadeStyle = isIdle ? 'opacity-30' : 'opacity-100';

  const formatDepth = () => {
    const absM = Math.round(Math.abs(hud.depthM));
    if (hud.depthM < 0) {
      return hud.units === 'imperial' ? `+${Math.round(absM * 3.28084)} ft` : `+${absM} m`;
    }
    return hud.units === 'imperial' ? `${Math.round(absM * 3.28084)} ft` : `${absM} m`;
  };

  const handleMenuDown = () => {
    menuLongPressedRef.current = false;
    menuTimerRef.current = window.setTimeout(() => {
      menuLongPressedRef.current = true;
      triggerHaptic([16, 40, 16]);
      onOpenDebug();
    }, 1500);
  };

  const handleMenuUp = () => {
    if (menuTimerRef.current) {
      clearTimeout(menuTimerRef.current);
      menuTimerRef.current = null;
    }
    if (!menuLongPressedRef.current) {
      triggerHaptic(10);
      onOpenQuickWheel();
    }
  };

  const handleTorchDown = () => {
    torchLongPressedRef.current = false;
    torchTimerRef.current = window.setTimeout(() => {
      torchLongPressedRef.current = true;
      triggerHaptic(18);
      onOpenTorchQuick();
    }, 550);
  };

  const handleTorchUp = () => {
    if (torchTimerRef.current) {
      clearTimeout(torchTimerRef.current);
      torchTimerRef.current = null;
    }
    if (!torchLongPressedRef.current) {
      STATE.torch.on = !STATE.torch.on;
      triggerHaptic(12);
      notifyHudImmediate();
    }
  };

  const selectMode = (mode: SpeedModeName) => {
    STATE.speedMode = mode;
    if (mode === 'WARP') triggerHaptic([14, 30, 14]);
    else triggerHaptic(10);
    notifyHudImmediate();
  };

  const stepSlider = (delta: number) => {
    const mode = STATE.speedMode;
    STATE.sliders[mode] = Math.max(0, Math.min(1, STATE.sliders[mode] + delta));
    notifyHudImmediate();
  };

  const handleSliderDoubleTap = () => {
    const now = performance.now();
    if (now - lastThumbTapRef.current < 300) {
      STATE.sliders[STATE.speedMode] = SPEED_MODES[STATE.speedMode].defaultSlider;
      triggerHaptic(12);
      notifyHudImmediate();
    }
    lastThumbTapRef.current = now;
  };

  return (
    <div
      className={`fixed inset-0 pointer-events-none select-none transition-opacity duration-300 ${fadeStyle}`}
      style={{
        paddingTop: 'max(16px, env(safe-area-inset-top))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(16px, env(safe-area-inset-left))',
        paddingRight: 'max(16px, env(safe-area-inset-right))',
      }}
    >
      {/* 1. Tiny Top-Left Depth Ribbon */}
      <div
        data-ui-interactive="true"
        className="pointer-events-auto inline-flex items-center gap-3 px-3.5 py-2 rounded-xl bg-black/80 border border-white/10"
        style={{ position: 'absolute', top: 'max(16px, env(safe-area-inset-top))', left: 'max(20px, env(safe-area-inset-left))' }}
      >
        <div className="flex flex-col">
          <span className="font-mono-tabular text-lg font-semibold leading-none text-white">
            {formatDepth()}
          </span>
          <span className="text-[11px] text-sky-300/90 mt-0.5 leading-none">
            {hud.zoneName}
          </span>
        </div>
        <div className="h-6 w-px bg-white/15" />
        <div className="flex items-center gap-1.5 text-[11px] font-mono-tabular text-slate-300">
          <Compass className="w-3.5 h-3.5 text-slate-400" />
          <span>{Math.round(hud.yawDeg)}°</span>
        </div>
      </div>

      {/* Contextual Nearby Feature Chip (only underwater when within 1.5 km) */}
      {hud.nearFeatureName && hud.depthM > 2 && (
        <button
          data-ui-interactive="true"
          onClick={onOpenExpeditionBoard}
          className="pointer-events-auto absolute left-1/2 -translate-x-1/2 px-3.5 py-2 rounded-xl bg-black/85 border border-sky-500/40 text-xs text-slate-100 flex items-center gap-2 min-h-[40px]"
          style={{ top: 'max(16px, env(safe-area-inset-top))' }}
        >
          <span className="font-medium text-sky-300">{hud.nearFeatureName}</span>
          {hud.nearFeatureDistM !== null && (
            <span className="font-mono-tabular text-slate-400">
              {Math.round(hud.nearFeatureDistM)} m
            </span>
          )}
        </button>
      )}

      {/* 2. Top-Right Menu Button (tap = Quick Wheel, 1.5s long-press = Debug) */}
      <button
        data-ui-interactive="true"
        aria-label="Open menu or long-press for debug"
        onPointerDown={handleMenuDown}
        onPointerUp={handleMenuUp}
        onPointerCancel={() => {
          if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
        }}
        className="pointer-events-auto absolute min-w-[48px] min-h-[48px] px-3.5 rounded-xl bg-black/80 border border-white/15 text-white flex items-center justify-center gap-2 active:scale-95 transition-transform"
        style={{
          top: 'max(16px, env(safe-area-inset-top))',
          right: 'max(20px, env(safe-area-inset-right))',
        }}
      >
        <Menu className="w-5 h-5" />
        <span className="text-xs font-semibold">Menu</span>
      </button>

      {/* 3. Floating Move Stick Visual */}
      {hud.stickActive ? (
        <div className="pointer-events-none fixed inset-0">
          <div
            className="absolute rounded-full border-2 border-sky-400/50 bg-black/40"
            style={{
              width: 112,
              height: 112,
              left: hud.stickBaseX - 56,
              top: hud.stickBaseY - 56,
            }}
          />
          <div
            className="absolute rounded-full bg-sky-400/80 border-2 border-white/80"
            style={{
              width: 44,
              height: 44,
              left: hud.stickKnobX - 22,
              top: hud.stickKnobY - 22,
            }}
          />
        </div>
      ) : (
        <div
          className="pointer-events-none absolute w-24 h-24 rounded-full border border-dashed border-white/15 flex items-center justify-center"
          style={{
            bottom: 92,
            left: hud.leftHanded ? 'auto' : 52,
            right: hud.leftHanded ? 52 : 'auto',
          }}
        >
          <span className="text-[10px] text-white/35 font-medium">MOVE</span>
        </div>
      )}

      {/* 4. Fixed Edge Vertical Lever Visual (>= 36px from screen edge) */}
      <div
        className="pointer-events-none absolute flex flex-col items-center justify-between py-2 rounded-2xl bg-black/60 border border-white/15"
        style={{
          width: 52,
          height: 'min(200px, 44dvh)',
          top: '50%',
          transform: 'translateY(-50%)',
          right: hud.leftHanded ? 'auto' : 'max(36px, env(safe-area-inset-right))',
          left: hud.leftHanded ? 'max(36px, env(safe-area-inset-left))' : 'auto',
        }}
      >
        <span className="text-[10px] text-slate-300 font-semibold">▲</span>
        <div className="relative flex-1 w-1.5 bg-white/15 rounded-full my-1.5">
          <div
            className={`absolute left-1/2 -translate-x-1/2 w-6 h-6 rounded-full border-2 ${
              hud.vertLatched ? 'bg-amber-400 border-white' : 'bg-sky-400 border-black'
            }`}
            style={{
              top: `${50 - hud.vertInput * 42}%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        </div>
        <span className="text-[10px] text-slate-300 font-semibold">
          {hud.vertLatched ? 'LOCK' : '▼'}
        </span>
      </div>

      {/* 5. Bottom Speed Strip: Torch + CRAWL|CRUISE|WARP + 48dp Slider + Steppers */}
      <div
        data-ui-interactive="true"
        className="pointer-events-auto absolute flex items-center gap-2 bg-black/85 border border-white/15 rounded-2xl px-2.5 py-1.5 max-w-[92vw]"
        style={{
          bottom: 'max(12px, env(safe-area-inset-bottom))',
          left: hud.leftHanded ? 'auto' : 'max(20px, env(safe-area-inset-left))',
          right: hud.leftHanded ? 'max(20px, env(safe-area-inset-right))' : 'auto',
        }}
      >
        {/* Torch toggle (tap) / quick settings (long press) */}
        <button
          aria-label="Toggle torch or long-press for torch settings"
          onPointerDown={handleTorchDown}
          onPointerUp={handleTorchUp}
          onPointerCancel={() => {
            if (torchTimerRef.current) clearTimeout(torchTimerRef.current);
          }}
          className={`min-w-[48px] min-h-[48px] rounded-xl flex items-center justify-center border transition-colors ${
            hud.torchOn
              ? 'bg-sky-500/25 border-sky-400 text-sky-300'
              : 'bg-slate-900 border-white/10 text-slate-400'
          }`}
        >
          <Flashlight className="w-5 h-5" />
        </button>

        {/* Speed Mode Chips */}
        <div className="flex items-center gap-1 bg-slate-950 rounded-xl p-1 border border-white/10">
          {(['CRAWL', 'CRUISE', 'WARP'] as SpeedModeName[]).map((mode) => (
            <button
              key={mode}
              onClick={() => selectMode(mode)}
              className={`min-h-[40px] px-2.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
                hud.speedMode === mode
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Speed Slider + Steppers */}
        <div className="flex items-center gap-1">
          <button
            aria-label="Decrease speed"
            onClick={() => stepSlider(-0.08)}
            className="min-w-[40px] min-h-[48px] flex items-center justify-center rounded-lg text-slate-300 hover:bg-white/10"
          >
            <Minus className="w-4 h-4" />
          </button>
          <input
            aria-label="Speed slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={hud.speedSlider}
            onPointerDown={handleSliderDoubleTap}
            onChange={(e) => {
              STATE.sliders[STATE.speedMode] = parseFloat(e.target.value);
              notifyHudImmediate();
            }}
            className="touch-slider w-24 sm:w-36"
          />
          <button
            aria-label="Increase speed"
            onClick={() => stepSlider(0.08)}
            className="min-w-[40px] min-h-[48px] flex items-center justify-center rounded-lg text-slate-300 hover:bg-white/10"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="hidden sm:flex flex-col pr-1 text-right">
          <span className="font-mono-tabular text-xs font-semibold text-white whitespace-nowrap">
            {hud.speedMs >= 1000
              ? `${(hud.speedMs / 1000).toFixed(1)} km/s`
              : `${hud.speedMs.toFixed(1)} m/s`}
          </span>
          <span className="text-[10px] text-slate-400 whitespace-nowrap">
            {hud.speedComparison}
          </span>
        </div>
      </div>

      {/* Optional Live Performance & Photon-Budget Overlay (§6 / v2.2 §8) */}
      {hud.overlays.perfGraph && (
        <div
          className="pointer-events-none absolute left-5 px-3 py-2 rounded-lg bg-black/85 border border-emerald-500/30 font-mono-tabular text-[10px] text-emerald-300 space-y-0.5"
          style={{ top: 'max(72px, calc(env(safe-area-inset-top) + 60px))' }}
        >
          <div>
            {hud.governor.fps} fps (target {hud.governor.targetFps} @ {hud.governor.tickHz}Hz) ·{' '}
            {hud.governor.bottleneck} · {hud.governor.mode} (scale {hud.governor.renderScale})
          </div>
          <div>
            frame {hud.governor.emaFrameMs.toFixed(1)}ms · submit {hud.governor.emaSubmitMs.toFixed(1)}ms
            {hud.governor.throttled ? ' · THROTTLED' : ''}
          </div>
          <div>
            tris {hud.governor.triangles.toLocaleString()} · calls {hud.governor.calls} · N={hud.governor.clipmapN} ·
            rings {hud.governor.activeRings} · sectors {hud.governor.visibleSectors}
          </div>
          <div>
            cell0 {(hud.governor.cell0Meters * 100).toFixed(1)}cm · omni {hud.governor.reachOmni.toFixed(0)}m · cone{' '}
            {hud.governor.reachCone.toFixed(0)}m
          </div>
        </div>
      )}

      {/* Optional Pointer Visualiser (§6) */}
      {hud.overlays.pointerVis &&
        hud.pointers.map((pt) => (
          <div
            key={pt.id}
            className="pointer-events-none fixed w-8 h-8 -ml-4 -mt-4 rounded-full border-2 border-amber-400 flex items-center justify-center text-[9px] font-mono text-amber-300 bg-black/60"
            style={{ left: pt.x, top: pt.y }}
          >
            {pt.role[0].toUpperCase()}
          </div>
        ))}
    </div>
  );
};
