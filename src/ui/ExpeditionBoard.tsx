/**
 * Expedition Board (§9B & v2.1 §2.7 / v2.2 §4.6).
 * Opaque full-screen start & destination selector (zero backdrop-blur),
 * touch-scrollable, >= 48dp touch targets, swipe-down close on header,
 * and memorial respect notices on registered war graves.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Compass, Download, Shuffle, Waves, X } from 'lucide-react';
import destinationsData from '../data/destinations.json';
import { Destination, DestinationCategory } from '../types';
import { triggerHaptic } from '../input/touchControls';
import { usePWAInstall } from './usePWAInstall';

const DESTINATIONS = destinationsData as Destination[];

const CATEGORIES: Array<{ id: 'all' | DestinationCategory; label: string }> = [
  { id: 'all', label: 'All Sites' },
  { id: 'caves', label: 'Blue Holes & Caves' },
  { id: 'wrecks', label: 'Shipwrecks' },
  { id: 'canyon_trench', label: 'Trenches' },
  { id: 'reefs', label: 'Reefs' },
  { id: 'vents', label: 'Vents' },
  { id: 'south_africa', label: 'South Africa' },
  { id: 'open_ocean', label: 'Open Ocean' },
];

interface ExpeditionBoardProps {
  isOpen: boolean;
  canClose: boolean;
  onClose: () => void;
  onSelectDestination: (dest: Destination, startAtSurface: boolean) => void;
}

export const ExpeditionBoard: React.FC<ExpeditionBoardProps> = ({
  isOpen,
  canClose,
  onClose,
  onSelectDestination,
}) => {
  const [category, setCategory] = useState<'all' | DestinationCategory>('all');
  const [surfaceDrop, setSurfaceDrop] = useState(false);
  const swipeStartY = useRef<number | null>(null);
  const surpriseIdxRef = useRef(0);
  const pwa = usePWAInstall();

  const filtered = useMemo(() => {
    if (category === 'all') return DESTINATIONS;
    return DESTINATIONS.filter((d) => d.category === category);
  }, [category]);

  if (!isOpen) return null;

  const handleSurprise = () => {
    triggerHaptic(12);
    surpriseIdxRef.current = (surpriseIdxRef.current + 3) % DESTINATIONS.length;
    onSelectDestination(DESTINATIONS[surpriseIdxRef.current], surfaceDrop);
  };

  const formatLight = (light: Destination['lightLevel']) => {
    if (light === 'sunlit') return 'Sunlit';
    if (light === 'twilight') return 'Twilight';
    return 'Midnight';
  };

  return (
    <div
      data-ui-interactive="true"
      className="fixed inset-0 z-50 bg-black text-slate-100 flex flex-col"
      style={{
        paddingTop: 'max(14px, env(safe-area-inset-top))',
        paddingBottom: 'max(14px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(16px, env(safe-area-inset-left))',
        paddingRight: 'max(16px, env(safe-area-inset-right))',
      }}
    >
      {/* Header (swipe down to close when resuming mid-dive) */}
      <header
        onPointerDown={(e) => {
          swipeStartY.current = e.clientY;
        }}
        onPointerUp={(e) => {
          if (canClose && swipeStartY.current !== null && e.clientY - swipeStartY.current > 70) {
            onClose();
          }
          swipeStartY.current = null;
        }}
        className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10"
      >
        <div className="flex items-center gap-3">
          <svg
            viewBox="0 0 36 36"
            className="w-9 h-9 shrink-0"
            aria-hidden="true"
          >
            <rect width="36" height="36" rx="10" fill="#071a2f" stroke="#38bdf8" strokeWidth="1.5" />
            <path d="M6 21 Q12 16 18 21 T30 20" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M8 26 Q14 22 20 26 T29 25" fill="none" stroke="#7dd3fc" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
            <circle cx="18" cy="11" r="2.5" fill="#e0f2fe" />
          </svg>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white leading-tight">
              Deep Ocean Explorer
            </h1>
            <p className="text-xs text-slate-400">
              Free-roam bathymetry · Touch flight · Select a dive site
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              triggerHaptic(8);
              setSurfaceDrop((s) => !s);
            }}
            className={`min-h-[48px] px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-colors ${
              surfaceDrop
                ? 'bg-sky-600 border-sky-400 text-white'
                : 'bg-slate-900 border-white/15 text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Waves className="w-4 h-4" />
            <span>Start at Surface (100 ft): {surfaceDrop ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={handleSurprise}
            className="min-h-[48px] px-3.5 rounded-xl bg-slate-900 border border-white/15 text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2 whitespace-nowrap"
          >
            <Shuffle className="w-4 h-4 text-sky-400" />
            <span>Surprise Me</span>
          </button>

          {pwa.isInstallable && !pwa.isInstalled && (
            <button
              onClick={() => pwa.install()}
              className="min-h-[48px] px-3.5 rounded-xl bg-sky-600/20 border border-sky-400/50 text-sky-300 text-xs font-semibold flex items-center gap-2 whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>Install PWA</span>
            </button>
          )}

          {canClose && (
            <button
              aria-label="Resume dive"
              onClick={() => {
                triggerHaptic(8);
                onClose();
              }}
              className="min-w-[48px] min-h-[48px] px-3.5 rounded-xl bg-slate-900 border border-white/15 text-slate-100 flex items-center gap-1.5 text-xs font-semibold"
            >
              <X className="w-4 h-4" />
              <span>Resume</span>
            </button>
          )}
        </div>
      </header>

      {/* Category Filter Tabs */}
      <nav
        aria-label="Dive site categories"
        className="flex items-center gap-1.5 overflow-x-auto py-3 border-b border-white/10"
      >
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => {
              triggerHaptic(6);
              setCategory(cat.id);
            }}
            className={`min-h-[44px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              category === cat.id
                ? 'bg-sky-600 text-white'
                : 'bg-slate-900 text-slate-300 border border-white/10 hover:text-white'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </nav>

      {/* Scrollable Expedition Cards */}
      <div className="scrollable-modal flex-1 overflow-y-auto py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 max-w-6xl mx-auto">
          {filtered.map((dest, idx) => {
            const startLabel =
              surfaceDrop || dest.startDepthM <= 0
                ? `${Math.round(Math.abs(surfaceDrop ? -30.48 : dest.startDepthM))} m above`
                : `${Math.round(dest.startDepthM)} m depth`;
            return (
              <article
                key={dest.id}
                className="bg-slate-950 border border-white/12 rounded-2xl p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold text-white leading-snug">
                        {dest.title}
                      </h2>
                      <p className="text-xs text-slate-400">{dest.region}</p>
                    </div>
                    <div
                      className="flex items-center gap-1 pt-1 shrink-0"
                      aria-label={`Dread level ${dest.dreadLevel} of 5`}
                    >
                      {[1, 2, 3, 4, 5].map((dot) => (
                        <span
                          key={dot}
                          className={`w-2 h-2 rounded-full ${
                            dot <= dest.dreadLevel ? 'bg-sky-400' : 'bg-white/15'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Clean unboxed metadata row */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono-tabular text-sky-300">
                    <span>{startLabel}</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span>Seabed {dest.seabedDepthM.toLocaleString()} m</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span>{formatLight(dest.lightLevel)}</span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {dest.subtitle}
                  </p>

                  {dest.note && (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-200">
                      {dest.note}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] font-mono-tabular text-slate-500 flex items-center gap-1">
                    <Compass className="w-3.5 h-3.5" />
                    {dest.lat.toFixed(2)}°, {dest.lon.toFixed(2)}°
                  </span>

                  <button
                    data-start={idx === 0 ? 'true' : undefined}
                    onClick={() => {
                      triggerHaptic(14);
                      onSelectDestination(dest, surfaceDrop);
                    }}
                    className="min-h-[48px] px-5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold whitespace-nowrap transition-colors"
                  >
                    Dive Here
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
};
