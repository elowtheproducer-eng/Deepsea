/**
 * Quick Wheel (§9A.2) - Radial menu with 6 spokes (Light, Sonar, Speed, View, Discover, System)
 * and sub-item drawers.
 */

import React, { useState } from 'react';
import { CameraState, TorchState, SonarState, ViewState, SpeedModeName } from '../types';

interface QuickWheelProps {
  isOpen: boolean;
  onClose: () => void;
  torchState: TorchState;
  setTorchState: React.Dispatch<React.SetStateAction<TorchState>>;
  sonarState: SonarState;
  setSonarState: React.Dispatch<React.SetStateAction<SonarState>>;
  viewState: ViewState;
  setViewState: React.Dispatch<React.SetStateAction<ViewState>>;
  cameraState: CameraState;
  setCameraState: React.Dispatch<React.SetStateAction<CameraState>>;
  onOpenExpeditionBoard: () => void;
  onOpenDebug: () => void;
}

type SpokeName = 'LIGHT' | 'SONAR' | 'SPEED' | 'VIEW' | 'DISCOVER' | 'SYSTEM';

export const QuickWheel: React.FC<QuickWheelProps> = ({
  isOpen,
  onClose,
  torchState,
  setTorchState,
  sonarState,
  setSonarState,
  viewState,
  setViewState,
  cameraState,
  setCameraState,
  onOpenExpeditionBoard,
  onOpenDebug,
}) => {
  const [activeSpoke, setActiveSpoke] = useState<SpokeName>('SPEED');

  if (!isOpen) return null;

  const spokes: SpokeName[] = ['LIGHT', 'SONAR', 'SPEED', 'VIEW', 'DISCOVER', 'SYSTEM'];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6 text-slate-100">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white tracking-tight">Quick Navigation Wheel</h2>
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
          >
            Close (Tab / Esc)
          </button>
        </div>

        {/* Spokes Selector */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 my-6">
          {spokes.map((spoke) => (
            <button
              key={spoke}
              onClick={() => setActiveSpoke(spoke)}
              className={`py-3 px-2 text-xs font-semibold rounded-xl transition-all ${
                activeSpoke === spoke
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'bg-slate-950/60 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {spoke}
            </button>
          ))}
        </div>

        {/* Spoke Sub-item Drawer */}
        <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-5 min-h-[220px] flex flex-col justify-between">
          {activeSpoke === 'LIGHT' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-sky-400">Lighting Controls</h3>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">Torch Power</span>
                <div className="flex gap-1">
                  {(['Low', 'Std', 'Search', 'Flood'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setTorchState((s) => ({ ...s, power: p, on: true }))}
                      className={`px-3 py-1 text-xs rounded-md ${
                        torchState.power === p && torchState.on
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">Torch Color</span>
                <div className="flex gap-1">
                  {(['White', 'Blue-Green', 'Red'] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setTorchState((s) => ({ ...s, color: c }))}
                      className={`px-3 py-1 text-xs rounded-md ${
                        torchState.color === c
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">Torch State</span>
                <button
                  onClick={() => setTorchState((s) => ({ ...s, on: !s.on }))}
                  className={`px-4 py-1 text-xs font-medium rounded-md ${
                    torchState.on ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {torchState.on ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          )}

          {activeSpoke === 'SONAR' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-sky-400">Sonar & Mapping</h3>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">Sonar Pulse (F)</span>
                <button
                  onClick={() => setSonarState((s) => ({ ...s, active: !s.active }))}
                  className={`px-4 py-1 text-xs font-medium rounded-md ${
                    sonarState.active ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {sonarState.active ? 'PINGING' : 'READY'}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">Honest Map (Survey View)</span>
                <button
                  onClick={() => setSonarState((s) => ({ ...s, surveyView: !s.surveyView }))}
                  className={`px-4 py-1 text-xs font-medium rounded-md ${
                    sonarState.surveyView ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {sonarState.surveyView ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>
            </div>
          )}

          {activeSpoke === 'SPEED' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-sky-400">Flight Speed Modes</h3>
              <div className="flex gap-2">
                {(['CRAWL', 'CRUISE', 'WARP'] as SpeedModeName[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setCameraState((s) => ({ ...s, speedMode: mode }))}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg ${
                      cameraState.speedMode === mode
                        ? 'bg-sky-600 text-white shadow-md'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div className="space-y-1 pt-2">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Speed Slider ({cameraState.speedMode})</span>
                  <span>{Math.round(cameraState.sliders[cameraState.speedMode] * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={cameraState.sliders[cameraState.speedMode]}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setCameraState((s) => ({
                      ...s,
                      sliders: { ...s.sliders, [s.speedMode]: val },
                    }));
                  }}
                  className="w-full accent-sky-500"
                />
              </div>
            </div>
          )}

          {activeSpoke === 'VIEW' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-sky-400">Optics & Field of View</h3>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Horizontal FOV</span>
                  <span>{Math.round(cameraState.hFov)}°</span>
                </div>
                <input
                  type="range"
                  min="80"
                  max="120"
                  step="1"
                  value={cameraState.hFov}
                  onChange={(e) =>
                    setCameraState((s) => ({ ...s, hFov: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-sky-500"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Time of Day</span>
                  <span>{viewState.timeOfDay.toFixed(1)}h</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="24"
                  step="0.5"
                  value={viewState.timeOfDay}
                  onChange={(e) =>
                    setViewState((s) => ({ ...s, timeOfDay: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-sky-500"
                />
              </div>
            </div>
          )}

          {activeSpoke === 'DISCOVER' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-sky-400">Discovery & Expedition</h3>
              <p className="text-xs text-slate-400">
                Browse wrecks, blue holes, trenches, and wildlife starting points.
              </p>
              <button
                onClick={() => {
                  onClose();
                  onOpenExpeditionBoard();
                }}
                className="px-4 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors"
              >
                Open Expedition Board
              </button>
            </div>
          )}

          {activeSpoke === 'SYSTEM' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-sky-400">System & Tuning</h3>
              <p className="text-xs text-slate-400">
                Access debug tools, live tuning constants, telemetry, and camera snapshots.
              </p>
              <button
                onClick={() => {
                  onClose();
                  onOpenDebug();
                }}
                className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
              >
                Open Debug & Tuning Panel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
