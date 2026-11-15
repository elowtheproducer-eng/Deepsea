/**
 * Pre-dive Expedition Board (Launch menu & DISCOVER spoke destination browser)
 */

import React, { useState } from 'react';
import { Destination } from '../types';
import destinationsData from '../data/destinations.json';

interface ExpeditionBoardProps {
  onSelectDestination: (dest: Destination) => void;
  onClose?: () => void;
  isOpen: boolean;
}

export const ExpeditionBoard: React.FC<ExpeditionBoardProps> = ({
  onSelectDestination,
  onClose,
  isOpen,
}) => {
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const destinations = destinationsData as Destination[];

  if (!isOpen) return null;

  const tags = ['all', 'surface', 'wrecks', 'caves', 'reef', 'trench', 'wildlife'];

  const filtered = destinations.filter((d) => {
    if (selectedTag === 'all') return true;
    if (selectedTag === 'wrecks') return d.tags.includes('wreck');
    if (selectedTag === 'caves') return d.tags.includes('blue_hole');
    if (selectedTag === 'reef') return d.tags.includes('reef');
    if (selectedTag === 'trench') return d.tags.includes('trench');
    if (selectedTag === 'wildlife') return d.tags.includes('wildlife');
    return d.tags.includes(selectedTag);
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col p-6 text-slate-100 overflow-y-auto">
      <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-6 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white font-sans">
              Expedition Board
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Choose your dive starting point across real ocean bathymetry.
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
            >
              Resume Dive
            </button>
          )}
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-2 py-6 overflow-x-auto">
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(tag)}
              className={`px-4 py-2 text-xs font-medium rounded-lg capitalize transition-colors whitespace-nowrap ${
                selectedTag === tag
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
          {filtered.map((dest) => (
            <div
              key={dest.id}
              className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 flex flex-col justify-between hover:border-slate-700 transition-all group"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                  <span>Depth: {Math.abs(dest.stats.depthM)}m</span>
                  <span>Dread: {'●'.repeat(dest.stats.dread)}{'○'.repeat(5 - dest.stats.dread)}</span>
                </div>
                <h3 className="text-lg font-semibold text-white group-hover:text-sky-400 transition-colors">
                  {dest.title}
                </h3>
                <p className="text-xs text-sky-300 font-medium mt-1 mb-3">
                  {dest.hook}
                </p>
                <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                  {dest.expect}
                </p>
              </div>

              <div className="pt-6 mt-6 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">{dest.stats.scale}</span>
                <button
                  onClick={() => {
                    onSelectDestination(dest);
                    if (onClose) onClose();
                  }}
                  className="px-4 py-2 text-xs font-semibold bg-white text-slate-950 rounded-lg hover:bg-sky-400 hover:text-white transition-colors"
                >
                  Dive Here
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
