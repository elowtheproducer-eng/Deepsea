/**
 * HUD Overlay (§9A) - L0 immersion, glance bar, depth readout, speed indicator,
 * and quick wheel toggle.
 */

import React, { useState, useEffect } from 'react';
import { CameraState, TorchState, SonarState, ViewState } from '../types';

interface HudOverlayProps {
  cameraState: CameraState;
  torchState: TorchState;
  sonarState: SonarState;
  viewState: ViewState;
  onOpenQuickWheel: () => void;
  onOpenExpeditionBoard: () => void;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  cameraState,
  torchState,
  sonarState,
  viewState,
  onOpenQuickWheel,
  onOpenExpeditionBoard,
}) => {
  const [showGlanceBar, setShowGlanceBar] = useState(false);
  const [idleSeconds, setIdleSeconds] = useState(0);

  useEffect(() => {
    let timer = window.setInterval(() => {
      setIdleSeconds((s) => s + 1);
    }, 1000);
    const handleActivity = () => {
      setIdleSeconds(0);
    };
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    return () => {
      clearInterval(timer);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
    };
  }, []);

  const depthM = Math.round(-cameraState.h);
  const speedVal = Math.round(cameraState.sliders[cameraState.speedMode] * 100);
  const alphaClass = idleSeconds > 4 ? 'opacity-30' : 'opacity-100';

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 select-none font-sans transition-opacity duration-500">
      {/* Top Bar (Glance Bar / L1) */}
      <div
        className={`pointer-events-auto flex items-center justify-between bg-slate-950/60 backdrop-blur-md border border-slate-800/80 rounded-xl px-5 py-3 transition-all ${
          showGlanceBar ? 'opacity-100 translate-y-0' : 'opacity-80 hover:opacity-100'
        } ${alphaClass}`}
      >
        <div className="flex items-center gap-6 text-xs font-mono text-slate-300">
          <div>
            <span className="text-slate-500">LAT:</span> {cameraState.lat.toFixed(4)}°
          </div>
          <div>
            <span className="text-slate-500">LON:</span> {cameraState.lon.toFixed(4)}°
          </div>
          <div>
            <span className="text-slate-500">DEPTH:</span> {depthM}m ({Math.round(depthM * 3.28084)}ft)
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-xs font-mono text-sky-400">
            {cameraState.speedMode} [{speedVal}%]
          </div>
          <button
            onClick={onOpenExpeditionBoard}
            className="px-3 py-1 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors pointer-events-auto"
          >
            Expedition Board
          </button>
          <button
            onClick={onOpenQuickWheel}
            className="px-3 py-1 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors pointer-events-auto"
          >
            Menu (Tab)
          </button>
        </div>
      </div>

      {/* Center crosshair / look area */}
      <div className="flex-1 flex items-center justify-center pointer-events-none">
        <div className="w-1.5 h-1.5 rounded-full bg-white/40 ring-1 ring-black/50" />
      </div>

      {/* Bottom Immersion Controls & Status */}
      <div className={`flex items-end justify-between pointer-events-auto ${alphaClass}`}>
        <div className="bg-slate-950/60 backdrop-blur-md border border-slate-800/80 rounded-xl p-4 text-xs font-mono text-slate-300 space-y-1">
          <div className="text-white font-semibold">DEEP OCEAN EXPLORER</div>
          <div>Torch: {torchState.on ? `${torchState.power} (${torchState.color})` : 'OFF'}</div>
          <div>FOV: {Math.round(cameraState.hFov)}° | Time: {viewState.timeOfDay.toFixed(1)}h</div>
        </div>

        <div className="bg-slate-950/60 backdrop-blur-md border border-slate-800/80 rounded-xl p-4 text-right text-xs font-mono text-slate-300">
          <div className="text-slate-500">CONTROLS</div>
          <div>WASD / Arrow Keys : Move</div>
          <div>Space / C : Up / Down</div>
          <div>Tab : Quick Wheel</div>
        </div>
      </div>
    </div>
  );
};
