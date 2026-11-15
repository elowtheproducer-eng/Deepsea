/**
 * Debug & Tuning Panel (§20.3) - Live constants tuning, telemetry, teleports, and test overrides.
 */

import React, { useState } from 'react';
import { CameraState, ViewState, TorchState } from '../types';

interface DebugTuningPanelProps {
  isOpen: boolean;
  onClose: () => void;
  cameraState: CameraState;
  setCameraState: React.Dispatch<React.SetStateAction<CameraState>>;
  viewState: ViewState;
  setViewState: React.Dispatch<React.SetStateAction<ViewState>>;
  torchState: TorchState;
  setTorchState: React.Dispatch<React.SetStateAction<TorchState>>;
}

export const DebugTuningPanel: React.FC<DebugTuningPanelProps> = ({
  isOpen,
  onClose,
  cameraState,
  setCameraState,
  viewState,
  setViewState,
  torchState,
  setTorchState,
}) => {
  if (!isOpen) return null;

  const [activeTab, setActiveTab] = useState<'tuning' | 'teleport' | 'telemetry'>('tuning');
  const [teleportLat, setTeleportLat] = useState(cameraState.lat.toString());
  const [teleportLon, setTeleportLon] = useState(cameraState.lon.toString());
  const [teleportDepth, setTeleportDepth] = useState((-cameraState.h).toString());

  const handleTeleport = () => {
    const lat = parseFloat(teleportLat);
    const lon = parseFloat(teleportLon);
    const depth = parseFloat(teleportDepth);
    if (!isNaN(lat) && !isNaN(lon) && !isNaN(depth)) {
      setCameraState((s) => ({
        ...s,
        lat: Math.max(-90, Math.min(90, lat)),
        lon: Math.max(-180, Math.min(180, lon)),
        h: -depth,
      }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6 text-slate-100">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Debug & Tuning Panel (§20.3)</h2>
            <p className="text-xs text-slate-400 mt-0.5">Live tuning constants, telemetry, and teleports.</p>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 py-4 border-b border-slate-800">
          {(['tuning', 'teleport', 'telemetry'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-semibold rounded-lg capitalize transition-colors ${
                activeTab === tab
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'bg-slate-950/60 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto py-4 space-y-6">
          {activeTab === 'tuning' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-sky-400">Flight & Physics Tuning</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>Camera Inertia (Damping)</span>
                  <span>{cameraState.inertia.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={cameraState.inertia}
                  onChange={(e) =>
                    setCameraState((s) => ({ ...s, inertia: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-sky-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>Sea Level Offset ({viewState.seaLevel}m)</span>
                  <span>{viewState.seaLevel}m</span>
                </div>
                <input
                  type="range"
                  min="-130"
                  max="70"
                  step="5"
                  value={viewState.seaLevel}
                  onChange={(e) =>
                    setViewState((s) => ({ ...s, seaLevel: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-sky-500"
                />
              </div>
            </div>
          )}

          {activeTab === 'teleport' && (
            <div className="space-y-4 max-w-md">
              <h3 className="text-sm font-semibold text-sky-400">Coordinates Teleport</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Latitude (-90 to 90)</label>
                  <input
                    type="text"
                    value={teleportLat}
                    onChange={(e) => setTeleportLat(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Longitude (-180 to 180)</label>
                  <input
                    type="text"
                    value={teleportLon}
                    onChange={(e) => setTeleportLon(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Depth (meters below sea level)</label>
                  <input
                    type="text"
                    value={teleportDepth}
                    onChange={(e) => setTeleportDepth(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                  />
                </div>
                <button
                  onClick={handleTeleport}
                  className="w-full py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs rounded-lg transition-colors"
                >
                  Teleport Now
                </button>
              </div>
            </div>
          )}

          {activeTab === 'telemetry' && (
            <div className="space-y-4 font-mono text-xs text-slate-300">
              <h3 className="text-sm font-semibold text-sky-400 font-sans">Live System Telemetry</h3>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div>Latitude: {cameraState.lat.toFixed(6)}°</div>
                <div>Longitude: {cameraState.lon.toFixed(6)}°</div>
                <div>Altitude/Depth: {cameraState.h.toFixed(2)}m</div>
                <div>Speed Mode: {cameraState.speedMode}</div>
                <div>Current Slider: {(cameraState.sliders[cameraState.speedMode] * 100).toFixed(1)}%</div>
                <div>Torch: {torchState.on ? 'ACTIVE' : 'OFF'}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
