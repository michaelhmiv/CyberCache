import React from 'react';
import { motion } from 'framer-motion';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';

/**
 * Gear rail (redesign Wave D, DESIGN.md §2/§3/§6; merged page
 * amendment, Exec C, 2026-11-03).
 *
 * The Gear tab's table of contents: exactly two stops — Loadout ·
 * Workshop — in the §2 order. The Loadout stop is now ONE merged
 * page (the Split doll zone, the vehicle/Garage section, the
 * Inventory grid, and Belt & Stacks as its scroll sections): the
 * Grid and Items stops retired into it (INVENTORY.md P2 — their
 * content moved onto the page, nothing was removed). The Garage
 * was never a stop: DESIGN.md §11 F1 originally promoted it to
 * one, but the owner overruled that decision (2026-11-02) — the
 * Garage folds into the Loadout page as its expanding vehicle
 * section, per the approved mock.
 *
 * Geometry follows the Home mode rail (Wave C): one bordered bar,
 * one stop height (48px — a real tap target), icons on the §7 rail
 * size (17px), labels at the §5 floor (11px). The bar scrolls
 * horizontally rather than shrinking its stops (§6
 * scroll-don't-shrink); at the reference width the stops fit, and
 * narrower viewports get the edge fade.
 */
export type GearStop = 'loadout' | 'workshop';

interface GearStopDef {
  stop: GearStop;
  label: string;
  icon: PxIconName;
  ariaLabel: string;
}

const GEAR_STOPS: GearStopDef[] = [
  { stop: 'loadout', label: 'Loadout', icon: 'armor', ariaLabel: 'Loadout — the merged gear page: your seven gear slots and the slot picker, the Garage, your Inventory, and your belt and stacks' },
  { stop: 'workshop', label: 'Workshop', icon: 'anvil', ariaLabel: 'Workshop — the crafting bench: recipes and the job queue' },
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
