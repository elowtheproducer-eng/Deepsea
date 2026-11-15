/**
 * Hidden Debug & Tuning Panel (§20.3 & v2.1 §6 / v2.2 §8).
 * Reached via 1.5s long-press on the top-right Menu button or Quick Wheel -> SYSTEM.
 * Zero backdrop-blur (opaque surface over WebGL), touch-scrollable.
 */

import React, { useState, useSyncExternalStore } from 'react';
import { Download, RotateCcw, X, Copy, Check } from 'lucide-react';
import { CONFIG, resetConfig } from '../core/config';
import {
  getHudSnapshot,
  governor,
  notifyHudImmediate,
  STATE,
  subscribeHud,
  teleportTo,
} from '../core/state';
import { DeviceModeName } from '../types';
import { triggerHaptic } from '../input/touchControls';

type DebugTab = 'overlays' | 'tuning' | 'teleport' | 'soak';

interface DebugTuningPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyTerrainWireframe: (wireframe: boolean) => void;
}

export const DebugTuningPanel: React.FC<DebugTuningPanelProps> = ({
  isOpen,
  onClose,
  onApplyTerrainWireframe,
}) => {
  const [tab, setTab] = useState<DebugTab>('overlays');
  const [, bump] = useState(0);
  const [copied, setCopied] = useState(false);
  const hud = useSyncExternalStore(subscribeHud, getHudSnapshot, getHudSnapshot);

  const [tpLat, setTpLat] = useState(hud.lat.toFixed(5));
  const [tpLon, setTpLon] = useState(hud.lon.toFixed(5));
  const [tpDepth, setTpDepth] = useState(Math.round(hud.depthM).toString());

  if (!isOpen) return null;

  const refresh = () => {
    notifyHudImmediate();
    bump((n) => n + 1);
  };

  const toggleOverlay = (key: keyof typeof STATE.overlays) => {
    STATE.overlays[key] = !STATE.overlays[key];
    if (key === 'wireframe') {
      onApplyTerrainWireframe(STATE.overlays.wireframe);
    }
    triggerHaptic(8);
    refresh();
  };

  const downloadJson = (filename: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyStateJson = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ config: CONFIG, hud, soakLog: STATE.soakLog }, null, 2)
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked on insecure context
    }
  };

  const tuningSliders: Array<{
    key: keyof typeof CONFIG;
    label: string;
    min: number;
    max: number;
    step: number;
  }> = [
    { key: 'absorbR', label: 'Red Absorption (absorbR)', min: 0.05, max: 0.9, step: 0.01 },
    { key: 'absorbG', label: 'Green Absorption (absorbG)', min: 0.02, max: 0.4, step: 0.005 },
    { key: 'absorbB', label: 'Blue Absorption (absorbB)', min: 0.01, max: 0.2, step: 0.002 },
    { key: 'kdClear', label: 'Clear Water Multiplier', min: 0.4, max: 2.5, step: 0.05 },
    { key: 'torchLumensStd', label: 'Torch Lumens (Std)', min: 15, max: 220, step: 5 },
    { key: 'backscatterStrength', label: 'Beam Backscatter', min: 0, max: 0.25, step: 0.005 },
    { key: 'snowDensity', label: 'Marine Snow Density', min: 0, max: 2.0, step: 0.05 },
    { key: 'waveSteepness', label: 'Wave Steepness', min: 0.05, max: 0.75, step: 0.02 },
    { key: 'detailAmplitude', label: 'Terrain Relief Scale', min: 0.2, max: 2.0, step: 0.05 },
    { key: 'verticalExag', label: 'Vertical Exaggeration', min: 0.5, max: 2.5, step: 0.1 },
    { key: 'darknessFidelity', label: 'Abyss Darkness Fidelity', min: 0, max: 1.0, step: 0.05 },
  ];

  return (
    <div
      data-ui-interactive="true"
      className="fixed inset-0 z-50 bg-black/95 text-slate-100 flex flex-col p-4"
      style={{
        paddingTop: 'max(14px, env(safe-area-inset-top))',
        paddingBottom: 'max(14px, env(safe-area-inset-bottom))',
      }}
    >
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0 bg-slate-950 border border-white/15 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div>
            <h2 className="text-base font-bold text-white">Engineering Tuning & Diagnostics</h2>
            <p className="text-xs font-mono-tabular text-slate-400">
              {hud.governor.fps} fps · {hud.governor.mode} · scale {hud.governor.renderScale} · N={hud.governor.clipmapN}
            </p>
          </div>
          <button
            aria-label="Close diagnostics"
            onClick={onClose}
            className="min-w-[48px] min-h-[48px] px-3 rounded-xl bg-slate-900 border border-white/10 text-slate-100 flex items-center gap-1.5 text-xs font-semibold"
          >
            <X className="w-4 h-4" />
            <span>Close</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/10 overflow-x-auto">
          {(
            [
              { id: 'overlays', label: 'Overlays & Modes' },
              { id: 'tuning', label: 'Optics & Terrain' },
              { id: 'teleport', label: 'Teleport' },
              { id: 'soak', label: 'Soak & Export' },
            ] as Array<{ id: DebugTab; label: string }>
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`min-h-[44px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap ${
                tab === t.id
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-900 text-slate-300 border border-white/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="scrollable-modal flex-1 overflow-y-auto p-4 space-y-4">
          {tab === 'overlays' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(
                  [
                    { key: 'perfGraph', label: 'Perf & Photon Overlay' },
                    { key: 'scaleCubes', label: '1m / 10m Scale Cubes' },
                    { key: 'torchGizmo', label: 'Torch Cone Gizmo' },
                    { key: 'pointerVis', label: 'Touch Pointer Vis' },
                    { key: 'wireframe', label: 'Terrain Wireframe' },
                    { key: 'disableMicroDetail', label: 'Disable Micro Detail' },
                    { key: 'disableSnow', label: 'Disable Marine Snow' },
                    { key: 'disableTorchVolume', label: 'Disable Torch Volume' },
                    { key: 'disableActors', label: 'Disable Fauna Actors' },
                  ] as Array<{ key: keyof typeof STATE.overlays; label: string }>
                ).map((item) => (
                  <button
                    key={item.key}
                    onClick={() => toggleOverlay(item.key)}
                    className={`min-h-[48px] px-3 rounded-xl border text-xs font-semibold text-left ${
                      STATE.overlays[item.key]
                        ? 'bg-sky-600 border-sky-400 text-white'
                        : 'bg-slate-900 border-white/10 text-slate-300'
                    }`}
                  >
                    {item.label}: {STATE.overlays[item.key] ? 'ON' : 'OFF'}
                  </button>
                ))}
              </div>

              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="text-xs font-semibold text-slate-300">Force Redmi Device Budget Mode</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
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
                  <button
                    onClick={() => {
                      governor.setFrozen(!governor.frozen);
                      refresh();
                    }}
                    className={`min-h-[48px] rounded-xl text-xs font-semibold ${
                      governor.frozen
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-900 text-slate-300 border border-white/10'
                    }`}
                  >
                    {governor.frozen ? 'Governor FROZEN' : 'Governor AUTO'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/10">
                <button
                  onClick={() => {
                    STATE.settings.fixedStick = !STATE.settings.fixedStick;
                    refresh();
                  }}
                  className="min-h-[48px] px-3 rounded-xl bg-slate-900 border border-white/10 text-xs font-semibold"
                >
                  Fixed Stick: {STATE.settings.fixedStick ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => {
                    STATE.settings.pinchFov = !STATE.settings.pinchFov;
                    refresh();
                  }}
                  className="min-h-[48px] px-3 rounded-xl bg-slate-900 border border-white/10 text-xs font-semibold"
                >
                  Pinch FOV: {STATE.settings.pinchFov ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => {
                    STATE.settings.gyroLook = !STATE.settings.gyroLook;
                    refresh();
                  }}
                  className="min-h-[48px] px-3 rounded-xl bg-slate-900 border border-white/10 text-xs font-semibold"
                >
                  Gyro Look: {STATE.settings.gyroLook ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => {
                    STATE.settings.audio = !STATE.settings.audio;
                    refresh();
                  }}
                  className="min-h-[48px] px-3 rounded-xl bg-slate-900 border border-white/10 text-xs font-semibold"
                >
                  Audio: {STATE.settings.audio ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          )}

          {tab === 'tuning' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    resetConfig();
                    refresh();
                  }}
                  className="min-h-[44px] px-3.5 rounded-xl bg-slate-900 border border-white/10 text-xs font-semibold text-amber-300 flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Defaults</span>
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {tuningSliders.map((s) => (
                  <div key={s.key} className="bg-black border border-white/10 rounded-xl p-3 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">{s.label}</span>
                      <span className="font-mono-tabular text-sky-300">
                        {Number(CONFIG[s.key]).toFixed(3)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      value={CONFIG[s.key]}
                      onChange={(e) => {
                        (CONFIG[s.key] as number) = parseFloat(e.target.value);
                        refresh();
                      }}
                      className="touch-slider w-full"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'teleport' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Latitude (°)</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={tpLat}
                    onChange={(e) => setTpLat(e.target.value)}
                    className="w-full min-h-[48px] px-3 rounded-xl bg-black border border-white/15 text-white font-mono-tabular"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Longitude (°)</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={tpLon}
                    onChange={(e) => setTpLon(e.target.value)}
                    className="w-full min-h-[48px] px-3 rounded-xl bg-black border border-white/15 text-white font-mono-tabular"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Depth (m below sea level)</span>
                  <input
                    type="number"
                    step="1"
                    value={tpDepth}
                    onChange={(e) => setTpDepth(e.target.value)}
                    className="w-full min-h-[48px] px-3 rounded-xl bg-black border border-white/15 text-white font-mono-tabular"
                  />
                </label>
              </div>
              <button
                onClick={() => {
                  const lat = parseFloat(tpLat);
                  const lon = parseFloat(tpLon);
                  const depth = parseFloat(tpDepth);
                  if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(depth)) {
                    teleportTo(lat, lon, depth);
                    onClose();
                  }
                }}
                className="min-h-[48px] px-5 rounded-xl bg-sky-600 text-white text-xs font-semibold"
              >
                Teleport Now
              </button>

              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="text-xs text-slate-400">Quick Presets</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { name: "Dean's Surface", lat: 23.10639, lon: -75.00861, depth: -30.48 },
                    { name: "Dean's 150m Shaft", lat: 23.10639, lon: -75.00861, depth: 150 },
                    { name: 'Challenger Deep', lat: 11.373, lon: 142.591, depth: 10840 },
                    { name: 'RMS Titanic', lat: 41.73, lon: -49.95, depth: 3765 },
                    { name: 'Great Barrier Reef', lat: -18.287, lon: 147.699, depth: 6 },
                  ].map((p) => (
                    <button
                      key={p.name}
                      onClick={() => {
                        teleportTo(p.lat, p.lon, p.depth);
                        onClose();
                      }}
                      className="min-h-[44px] px-3 rounded-xl bg-slate-900 border border-white/10 text-xs text-slate-200"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'soak' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => downloadJson('deep-ocean-soak-log.json', STATE.soakLog)}
                  className="min-h-[48px] px-4 rounded-xl bg-sky-600 text-white text-xs font-semibold flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Export Soak Log JSON ({STATE.soakLog.length} min)</span>
                </button>
                <button
                  onClick={() =>
                    downloadJson('deep-ocean-state.json', { config: CONFIG, hud, soakLog: STATE.soakLog })
                  }
                  className="min-h-[48px] px-4 rounded-xl bg-slate-900 border border-white/10 text-slate-200 text-xs font-semibold flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Export Config & State JSON</span>
                </button>
                <button
                  onClick={copyStateJson}
                  className="min-h-[48px] px-4 rounded-xl bg-slate-900 border border-white/10 text-slate-200 text-xs font-semibold flex items-center gap-2"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copied JSON' : 'Copy State JSON'}</span>
                </button>
              </div>

              <div className="bg-black border border-white/10 rounded-xl p-3 font-mono-tabular text-[11px] text-slate-300 space-y-1">
                <div>Session elapsed: {Math.round((performance.now() - STATE.sessionStartMs) / 1000)} s</div>
                <div>
                  Bottleneck: {hud.governor.bottleneck} · EMA frame: {hud.governor.emaFrameMs.toFixed(2)} ms ·
                  Submit: {hud.governor.emaSubmitMs.toFixed(2)} ms
                </div>
                {STATE.soakLog.length === 0 ? (
                  <div className="text-slate-500 pt-1">
                    1-minute soak entries appear automatically after each minute of continuous flight.
                  </div>
                ) : (
                  <div className="pt-2 space-y-1 max-h-48 overflow-y-auto">
                    {STATE.soakLog.map((entry) => (
                      <div key={entry.minute} className="text-emerald-300">
                        min {entry.minute}: {entry.fpsAvg} fps · frame {entry.emaFrameMs.toFixed(1)}ms · scale{' '}
                        {entry.renderScale} · N={entry.clipmapN} · depth {Math.round(entry.depthM)}m
                        {entry.throttled ? ' · THROTTLED' : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
