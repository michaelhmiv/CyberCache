import React from 'react';
import { motion } from 'framer-motion';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';

/**
 * Gear rail (redesign Wave D, DESIGN.md §2/§3/§6/§11-F1).
 *
 * The Gear tab's table of contents: exactly the five stops the
 * language specifies — Loadout · Grid · Items · Workshop · Garage —
 * in the §2 order. The Garage is a stop in its own right (F1): the
 * audit promoted it out of its old framing as a section inside the
 * Loadout tab, and this rail is its canonical door.
 *
 * Geometry follows the Home mode rail (Wave C): one bordered bar,
 * one stop height (48px — a real tap target), icons on the §7 rail
 * size (17px), labels at the §5 floor (11px). The bar scrolls
 * horizontally rather than shrinking its stops (§6
 * scroll-don't-shrink); at the reference width the five stops fit,
 * and narrower viewports get the edge fade.
 */
export type GearStop = 'loadout' | 'grid' | 'items' | 'workshop' | 'garage';

interface GearStopDef {
  stop: GearStop;
  label: string;
  icon: PxIconName;
  ariaLabel: string;
}

const GEAR_STOPS: GearStopDef[] = [
  { stop: 'loadout', label: 'Loadout', icon: 'armor', ariaLabel: 'Loadout — your seven gear slots and the slot picker' },
  { stop: 'grid', label: 'Grid', icon: 'grid', ariaLabel: 'Item Grid — browse, compare, and salvage your items' },
  { stop: 'items', label: 'Items', icon: 'vial', ariaLabel: 'Items — your belt, consumable stacks, materials, and essences' },
  { stop: 'workshop', label: 'Workshop', icon: 'anvil', ariaLabel: 'Workshop — the crafting bench: recipes and the job queue' },
  { stop: 'garage', label: 'Garage', icon: 'wheel', ariaLabel: 'Garage — vehicles, fuel, condition, and patch-kit repair' },
];

export interface GearRailProps {
  activeStop: GearStop;
  onSelect: (stop: GearStop) => void;
  /** Active workshop jobs (running/queued/paused) — badged on the Workshop stop. */
  workshopJobs?: number;
}

export const GearRail: React.FC<GearRailProps> = ({ activeStop, onSelect, workshopJobs = 0 }) => (
  <div
    data-testid="gear-rail"
    role="tablist"
    aria-label="Gear sections"
    className="relative border border-border bg-bg/70"
  >
    <div className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {GEAR_STOPS.map((def) => {
        const lit = def.stop === activeStop;
        return (
          <motion.button
            key={def.stop}
            type="button"
            role="tab"
            aria-selected={lit}
            aria-label={def.ariaLabel}
            data-testid={`gear-stop-${def.stop}`}
            whileTap={{ scale: 0.96 }}
            onClick={() => onSelect(def.stop)}
            className={`flex min-h-[48px] min-w-[68px] flex-1 flex-col items-center justify-center gap-1 border-r border-border px-2 py-1.5 last:border-r-0 ${
              lit ? 'bg-accent/15 text-accent' : 'text-text-secondary'
            }`}
            style={lit ? { boxShadow: 'inset 0 2px 0 #FFC44D' } : undefined}
          >
            <span className="relative inline-flex">
              <PxIcon name={def.icon} size={17} />
              {def.stop === 'workshop' && workshopJobs > 0 && (
                <span
                  data-testid="gear-workshop-badge"
                  className="absolute -right-3.5 -top-1.5 border border-amber/60 bg-amber/25 px-1 text-[11px] font-black leading-tight text-amber"
                >
                  {workshopJobs}
                </span>
              )}
            </span>
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
