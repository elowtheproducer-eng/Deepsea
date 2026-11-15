/**
 * QuickWheel (§9A.2 & v2.1 §2.7)
 * - Glance bar (L1) at top with lat/lon/depth/pressure/temp/speed/FOV
 * - 6 spokes >= 56dp tap targets: LIGHT, SONAR, SPEED, VIEW, DISCOVER, SYSTEM
 * - Zero backdrop-blur (v2.2 §4.6), touch-scrollable, 48dp sliders + +/- steppers
 */

import React, { useState, useSyncExternalStore } from 'react';
import { Minus, Plus, X, Download } from 'lucide-react';
import {
  governor,
  getHudSnapshot,
  notifyHudImmediate,
  STATE,
  subscribeHud,
} from '../core/state';
import { DeviceModeName, SpeedModeName, WaterType } from '../types';
import { triggerHaptic } from '../input/touchControls';
import { usePWAInstall } from './usePWAInstall';

export type SpokeName = 'LIGHT' | 'SONAR' | 'SPEED' | 'VIEW' | 'DISCOVER' | 'SYSTEM';

interface QuickWheelProps {
  isOpen: boolean;
  initialSpoke?: SpokeName;
  onClose: () => void;
  onOpenExpeditionBoard: () => void;
  onOpenDebug: () => void;
  onTriggerSonar: () => void;
  onDropGlowStick: () => void;
  onTakePhoto: () => void;
}

export const QuickWheel: React.FC<QuickWheelProps> = ({
  isOpen,
  initialSpoke = 'LIGHT',
  onClose,
  onOpenExpeditionBoard,
  onOpenDebug,
  onTriggerSonar,
  onDropGlowStick,
  onTakePhoto,
}) => {
  const [activeSpoke, setActiveSpoke] = useState<SpokeName>(initialSpoke);
  const [, forceUpdate] = useState(0);
  const hud = useSyncExternalStore(subscribeHud, getHudSnapshot, getHudSnapshot);
  const pwa = usePWAInstall();

  React.useEffect(() => {
    if (isOpen) setActiveSpoke(initialSpoke);
  }, [isOpen, initialSpoke]);

  if (!isOpen) return null;

  const refresh = () => {
    notifyHudImmediate();
    forceUpdate((n) => n + 1);
  };

  const spokes: SpokeName[] = ['LIGHT', 'SONAR', 'SPEED', 'VIEW', 'DISCOVER', 'SYSTEM'];

  return (
    <div
      data-ui-interactive="true"
      className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4 text-slate-100"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* L1 Glance Bar */}
      <div className="w-full max-w-3xl mb-3 bg-slate-950 border border-white/15 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono-tabular">
        <div>
          <span className="text-slate-400">POS </span>
          {hud.lat.toFixed(4)}°, {hud.lon.toFixed(4)}°
        </div>
        <div>
          <span className="text-slate-400">DEPTH </span>
          {Math.round(hud.depthM)} m ({Math.round(hud.depthM * 3.28084)} ft)
        </div>
        <div>
          <span className="text-slate-400">PRESS </span>
          {hud.pressureAtm.toFixed(1)} atm · {hud.waterTempC.toFixed(1)}°C
        </div>
        <div>
          <span className="text-slate-400">FOV </span>
          {Math.round(hud.hFov)}°
        </div>
      </div>

      {/* Main Quick Wheel Card */}
      <div className="bg-slate-950 border border-white/15 rounded-2xl max-w-3xl w-full p-4 sm:p-5 flex flex-col max-h-[82dvh]">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <h2 className="text-base font-bold text-white">Dive Controls</h2>
          <button
            aria-label="Close menu"
            onClick={onClose}
            className="min-w-[48px] min-h-[48px] px-3 rounded-xl bg-slate-900 border border-white/10 text-slate-200 flex items-center gap-1.5 text-xs font-semibold"
          >
            <X className="w-4 h-4" />
            <span>Close</span>
          </button>
        </div>

        {/* 6 Spokes (>= 56dp tap targets) */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 my-3">
          {spokes.map((spoke) => (
            <button
              key={spoke}
              onClick={() => {
                triggerHaptic(8);
                setActiveSpoke(spoke);
              }}
              className={`min-h-[56px] px-2 text-xs font-semibold rounded-xl border transition-colors ${
                activeSpoke === spoke
                  ? 'bg-sky-600 border-sky-400 text-white'
                  : 'bg-slate-900 border-white/10 text-slate-300'
              }`}
            >
              {spoke}
            </button>
          ))}
        </div>

        {/* Scrollable Spoke Drawer */}
        <div className="scrollable-modal flex-1 overflow-y-auto bg-black border border-white/10 rounded-xl p-4 space-y-4">
          {activeSpoke === 'LIGHT' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-200">Torch</span>
                <button
                  onClick={() => {
                    STATE.torch.on = !STATE.torch.on;
                    triggerHaptic(12);
                    refresh();
                  }}
                  className={`min-h-[48px] px-5 rounded-xl text-xs font-semibold ${
                    STATE.torch.on ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-400 border border-white/10'
                  }`}
                >
                  {STATE.torch.on ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-slate-400">Power</span>
                <div className="grid grid-cols-4 gap-2">
                  {(['Low', 'Std', 'Search', 'Flood'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        STATE.torch.power = p;
                        STATE.torch.on = true;
                        refresh();
                      }}
                      className={`min-h-[48px] rounded-xl text-xs font-semibold ${
                        STATE.torch.power === p
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-900 text-slate-300 border border-white/10'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-slate-400">Spectrum</span>
                <div className="grid grid-cols-3 gap-2">
                  {(['White', 'Blue-Green', 'Red'] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        STATE.torch.color = c;
                        refresh();
                      }}
                      className={`min-h-[48px] rounded-xl text-xs font-semibold ${
                        STATE.torch.color === c
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-900 text-slate-300 border border-white/10'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>Beam Focus (Narrow ↔ Wide)</span>
                  <span className="font-mono-tabular">{Math.round(STATE.torch.focus * 100)}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      STATE.torch.focus = Math.max(0, STATE.torch.focus - 0.1);
                      refresh();
                    }}
                    className="min-w-[48px] min-h-[48px] rounded-xl bg-slate-900 flex items-center justify-center"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={STATE.torch.focus}
                    onChange={(e) => {
                      STATE.torch.focus = parseFloat(e.target.value);
                      refresh();
                    }}
                    className="touch-slider flex-1"
                  />
                  <button
                    onClick={() => {
                      STATE.torch.focus = Math.min(1, STATE.torch.focus + 0.1);
                      refresh();
                    }}
                    className="min-w-[48px] min-h-[48px] rounded-xl bg-slate-900 flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <button
                onClick={() => {
                  onDropGlowStick();
                  refresh();
                }}
                className="w-full min-h-[48px] rounded-xl bg-slate-900 border border-white/10 text-xs font-semibold text-emerald-300"
              >
                Drop Chemical Glow-Stick ({STATE.torch.glowSticksCount} remaining)
              </button>
            </div>
          )}

          {activeSpoke === 'SONAR' && (
            <div className="space-y-4">
              <button
                onClick={() => {
                  onTriggerSonar();
                  onClose();
                }}
                className="w-full min-h-[48px] rounded-xl bg-sky-600 text-white text-sm font-semibold"
              >
                Emit Sonar Pulse
              </button>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-white">Honest Map (Survey View)</div>
                  <div className="text-xs text-slate-400">Tint surveyed vs satellite-predicted bathymetry</div>
                </div>
                <button
                  onClick={() => {
                    STATE.sonar.surveyView = !STATE.sonar.surveyView;
                    refresh();
                  }}
                  className={`min-h-[48px] px-4 rounded-xl text-xs font-semibold ${
                    STATE.sonar.surveyView ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-400 border border-white/10'
                  }`}
                >
                  {STATE.sonar.surveyView ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          )}

          {activeSpoke === 'SPEED' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {(['CRAWL', 'CRUISE', 'WARP'] as SpeedModeName[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      STATE.speedMode = m;
                      refresh();
                    }}
                    className={`min-h-[48px] rounded-xl text-xs font-semibold ${
                      STATE.speedMode === m
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-900 text-slate-300 border border-white/10'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>{STATE.speedMode} Slider</span>
                  <span className="font-mono-tabular">
                    {Math.round(STATE.sliders[STATE.speedMode] * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      STATE.sliders[STATE.speedMode] = Math.max(0, STATE.sliders[STATE.speedMode] - 0.05);
                      refresh();
                    }}
                    className="min-w-[48px] min-h-[48px] rounded-xl bg-slate-900 flex items-center justify-center"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={STATE.sliders[STATE.speedMode]}
                    onChange={(e) => {
                      STATE.sliders[STATE.speedMode] = parseFloat(e.target.value);
                      refresh();
                    }}
                    className="touch-slider flex-1"
                  />
                  <button
                    onClick={() => {
                      STATE.sliders[STATE.speedMode] = Math.min(1, STATE.sliders[STATE.speedMode] + 0.05);
                      refresh();
                    }}
                    className="min-w-[48px] min-h-[48px] rounded-xl bg-slate-900 flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-200">Proximity Brake (Ease near seabed)</span>
                <button
                  onClick={() => {
                    STATE.proximityBrake = !STATE.proximityBrake;
                    refresh();
                  }}
                  className={`min-h-[48px] px-4 rounded-xl text-xs font-semibold ${
                    STATE.proximityBrake ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-400 border border-white/10'
                  }`}
                >
                  {STATE.proximityBrake ? 'ON' : 'GHOST'}
                </button>
              </div>
            </div>
          )}

          {activeSpoke === 'VIEW' && (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>Horizontal FOV (80°–120°)</span>
                  <span className="font-mono-tabular">{Math.round(STATE.cam.hFov)}°</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      STATE.cam.hFov = Math.max(80, STATE.cam.hFov - 5);
                      refresh();
                    }}
                    className="min-w-[48px] min-h-[48px] rounded-xl bg-slate-900 flex items-center justify-center"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="range"
                    min="80"
                    max="120"
                    step="1"
                    value={STATE.cam.hFov}
                    onChange={(e) => {
                      STATE.cam.hFov = parseFloat(e.target.value);
                      refresh();
                    }}
                    className="touch-slider flex-1"
                  />
                  <button
                    onClick={() => {
                      STATE.cam.hFov = Math.min(120, STATE.cam.hFov + 5);
                      refresh();
                    }}
                    className="min-w-[48px] min-h-[48px] rounded-xl bg-slate-900 flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>Time of Day</span>
                  <span className="font-mono-tabular">{STATE.view.timeOfDay.toFixed(1)} h</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="24"
                  step="0.5"
                  value={STATE.view.timeOfDay}
                  onChange={(e) => {
                    STATE.view.timeOfDay = parseFloat(e.target.value);
                    refresh();
                  }}
                  className="touch-slider w-full"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>Sea-Level Time Machine (-130 m to +70 m)</span>
                  <span className="font-mono-tabular">{STATE.view.seaLevel} m</span>
                </div>
                <input
                  type="range"
                  min="-130"
                  max="70"
                  step="5"
                  value={STATE.view.seaLevel}
                  onChange={(e) => {
                    STATE.view.seaLevel = parseFloat(e.target.value);
                    refresh();
                  }}
                  className="touch-slider w-full"
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-slate-400">Water Clarity</span>
                <div className="grid grid-cols-3 gap-2">
                  {(['Clear', 'Coastal', 'Murky'] as WaterType[]).map((wt) => (
                    <button
                      key={wt}
                      onClick={() => {
                        STATE.view.waterType = wt;
                        refresh();
                      }}
                      className={`min-h-[48px] rounded-xl text-xs font-semibold ${
                        STATE.view.waterType === wt
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-900 text-slate-300 border border-white/10'
                      }`}
                    >
                      {wt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeSpoke === 'DISCOVER' && (
            <div className="space-y-3">
              <button
                onClick={() => {
                  onClose();
                  onOpenExpeditionBoard();
                }}
                className="w-full min-h-[48px] rounded-xl bg-sky-600 text-white text-sm font-semibold"
              >
                Open Expedition Board
              </button>
              <button
                onClick={() => {
                  onTakePhoto();
                  onClose();
                }}
                className="w-full min-h-[48px] rounded-xl bg-slate-900 border border-white/10 text-slate-200 text-sm font-semibold"
              >
                Capture Snapshot (with Lat/Lon/Depth)
              </button>
            </div>
          )}

          {activeSpoke === 'SYSTEM' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <span className="text-xs text-slate-400">Redmi Note 13 Pro+ Performance Mode</span>
                <div className="grid grid-cols-4 gap-2">
                  {(['Balanced', 'Detail', 'Max', 'Cool'] as DeviceModeName[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        governor.setMode(m);
                        refresh();
                      }}
                      className={`min-h-[48px] rounded-xl text-xs font-semibold ${
                        governor.mode === m
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-900 text-slate-300 border border-white/10'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    STATE.settings.leftHanded = !STATE.settings.leftHanded;
                    refresh();
                  }}
                  className="min-h-[48px] px-3 rounded-xl bg-slate-900 border border-white/10 text-xs font-semibold text-slate-200"
                >
                  Layout: {STATE.settings.leftHanded ? 'Left-Handed' : 'Right-Handed'}
                </button>
                <button
                  onClick={() => {
                    STATE.settings.levelFlight = !STATE.settings.levelFlight;
                    refresh();
                  }}
                  className="min-h-[48px] px-3 rounded-xl bg-slate-900 border border-white/10 text-xs font-semibold text-slate-200"
                >
                  Stick: {STATE.settings.levelFlight ? 'Level Flight' : '3D Look-Fly'}
                </button>
                <button
                  onClick={() => {
                    STATE.view.units = STATE.view.units === 'metric' ? 'imperial' : 'metric';
                    refresh();
                  }}
                  className="min-h-[48px] px-3 rounded-xl bg-slate-900 border border-white/10 text-xs font-semibold text-slate-200"
                >
                  Units: {STATE.view.units === 'metric' ? 'Metres' : 'Feet'}
                </button>
                <button
                  onClick={() => {
                    STATE.settings.haptics = !STATE.settings.haptics;
                    refresh();
                  }}
                  className="min-h-[48px] px-3 rounded-xl bg-slate-900 border border-white/10 text-xs font-semibold text-slate-200"
                >
                  Haptics: {STATE.settings.haptics ? 'ON' : 'OFF'}
                </button>
              </div>

              <button
                onClick={() => {
                  onClose();
                  onOpenDebug();
                }}
                className="w-full min-h-[48px] rounded-xl bg-slate-900 border border-amber-500/40 text-amber-300 text-xs font-semibold"
              >
                Open Tuning, Overlays & Soak Export
              </button>

              {pwa.isInstallable && !pwa.isInstalled && (
                <button
                  onClick={() => pwa.install()}
                  className="w-full min-h-[48px] rounded-xl bg-sky-600/20 border border-sky-400/50 text-sky-300 text-xs font-semibold flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Install App (Fullscreen PWA)</span>
                </button>
              )}

              <p className="text-[11px] text-slate-400 pt-1">
                Thermal tip: Unplug or use bypass charging if frames dip during long dives.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
