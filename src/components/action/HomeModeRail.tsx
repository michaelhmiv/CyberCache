import React from 'react';
import { motion } from 'framer-motion';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';

/**
 * Home mode rail (redesign Wave C, DESIGN.md §2/§3/§4).
 *
 * The stage's mode strip: exactly the six stops the language
 * specifies — Area · Roam · Boss · Endless · Extract · Craft —
 * rendered under the diorama so the whole mode vocabulary is
 * one tap from the stage. Endless, Extraction, and Crafting
 * were promoted here from the stage's mode sheet (2 taps → 1);
 * the sheet paths still work and are untouched — this rail is
 * the first-class door, not a replacement control set. Salvage
 * is NOT a Home rail stop by design (§2): it stays on the mode
 * sheet and the Gear rail.
 *
 * The lit stop is the current mode (the one live workspace
 * below). The rail scrolls horizontally rather than shrinking
 * its stops (§6 scroll-don't-shrink) — at 390px the six stops
 * fit, and narrower viewports get the scroll affordance.
 */

export type HomeModeRailStop = 'area' | 'roam' | 'boss' | 'endless' | 'extract' | 'craft';

interface RailStopDef {
  stop: HomeModeRailStop;
  label: string;
  icon: PxIconName;
  ariaLabel: string;
}

const RAIL_STOPS: RailStopDef[] = [
  { stop: 'area', label: 'Area', icon: 'pin', ariaLabel: 'Change area' },
  { stop: 'roam', label: 'Roam', icon: 'crosshair', ariaLabel: 'Roam — let the hunter roam the current area' },
  { stop: 'boss', label: 'Boss', icon: 'skull', ariaLabel: 'Boss — choose a boss to fight' },
  { stop: 'endless', label: 'Endless', icon: 'infinity', ariaLabel: 'Endless — open the endless descent' },
  { stop: 'extract', label: 'Extract', icon: 'pick', ariaLabel: 'Extract — open the extraction runs' },
  { stop: 'craft', label: 'Craft', icon: 'hammer', ariaLabel: 'Craft — start a timed crafting job' },
];

export interface HomeModeRailProps {
  /** The lit stop, or null when no workspace mode is active. */
  activeStop: Exclude<HomeModeRailStop, 'area'> | null;
  onSelect: (stop: HomeModeRailStop) => void;
}

export const HomeModeRail: React.FC<HomeModeRailProps> = ({ activeStop, onSelect }) => (
  <div
    data-testid="home-mode-rail"
    role="group"
    aria-label="Hunter modes"
    className="relative border border-border bg-bg/70"
  >
    <div className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {RAIL_STOPS.map((def) => {
        const lit = def.stop === activeStop;
        return (
          <motion.button
            key={def.stop}
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => onSelect(def.stop)}
            aria-label={def.ariaLabel}
            aria-pressed={def.stop === 'area' ? undefined : lit}
            data-testid={`mode-rail-${def.stop}`}
            className={`flex min-h-[48px] flex-1 flex-col items-center justify-center gap-1 border-r border-border px-2 py-1.5 last:border-r-0 ${
              lit ? 'bg-accent/15 text-accent' : 'text-text-secondary'
            }`}
            style={lit ? { boxShadow: 'inset 0 2px 0 #FFC44D' } : undefined}
          >
            <PxIcon name={def.icon} size={17} />
            <span className="text-[11px] font-black uppercase tracking-[0.08em]">{def.label}</span>
          </motion.button>
        );
      })}
    </div>
    {/* Scroll affordance (§6): the fade marks that the row can
        travel on narrow viewports instead of shrinking. */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-bg/80 to-transparent sm:hidden"
    />
  </div>
);
