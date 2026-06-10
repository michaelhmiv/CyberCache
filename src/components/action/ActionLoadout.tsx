/**
 * ActionLoadout — star-pattern loadout display for the Action tab.
 *
 * Renders all 7 gear slots in a hexagonal constellation centered on
 * the primary weapon, with SVG connector lines giving it a "star chart"
 * feel. DPS readout and consumable chips sit beneath.
 *
 * Layout (3-column grid):
 *   Row 1:   (empty)    Secondary      Heavy
 *   Row 2:   Shield     ★PRIMARY★    Class Mod
 *   Row 3:   (empty)    Relic         Ordnance
 */
import React from 'react';
import { Crosshair, Shield, Zap, Diamond, Gem } from 'lucide-react';
import { useLoadoutStore, usePlayerStore } from '@/store';
import { ConsumablesChips } from '@/components/action/ConsumablesChips';
import { loadoutEffectiveDps } from '@/lib/combat/loadoutSurvival';
import type { Weapon, Shield as ShieldItem, ClassMod, Relic, Ordnance } from '@/types/items';

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const SLOT_CONFIG: Array<{
  slot: 'primary' | 'secondary' | 'heavy' | 'shield' | 'classMod' | 'relic' | 'ordnance';
  label: string;
  icon: React.ElementType;
  row: number;
  col: number;
  isCenter?: boolean;
}> = [
  { slot: 'secondary',  label: 'Secondary', icon: Crosshair, row: 1, col: 2 },
  { slot: 'heavy',      label: 'Heavy',     icon: Crosshair, row: 1, col: 3 },
  { slot: 'shield',     label: 'Shield',    icon: Shield,    row: 2, col: 1 },
  { slot: 'primary',    label: 'Primary',   icon: Crosshair, row: 2, col: 2, isCenter: true },
  { slot: 'classMod',   label: 'Mod',       icon: Diamond,   row: 2, col: 3 },
  { slot: 'relic',      label: 'Relic',     icon: Gem,       row: 3, col: 2 },
  { slot: 'ordnance',   label: 'Ordnance',  icon: Zap,       row: 3, col: 3 },
];

const rarityAccent: Record<string, string> = {
  Common:    '#A5A7B5',
  Uncommon:  '#7CFC00',
  Rare:      '#5AA7FF',
  Epic:      '#FF9DF5',
  Legendary: '#FFEA3A',
};

function slotItem(
  loadout: ReturnType<typeof useLoadoutStore.getState>,
  slot: string,
): Weapon | ShieldItem | ClassMod | Relic | Ordnance | null {
  switch (slot) {
    case 'primary':   return loadout.getWeapon('primary');
    case 'secondary': return loadout.getWeapon('secondary');
    case 'heavy':     return loadout.getWeapon('heavy');
    case 'shield':    return loadout.getShield();
    case 'classMod':  return loadout.getClassMod();
    case 'relic':     return loadout.getRelic();
    case 'ordnance':  return loadout.getOrdnance();
    default:          return null;
  }
}

// ── SVG star connectors between the 7 slots ──────────────────────

const STAR_LINES: Array<[number, number, number, number]> = [
  // Center (primary) → each of the 6 surrounding slots
  [2, 2, 1, 2], // primary → secondary (top)
  [2, 2, 2, 3], // primary → classMod (right)
  [2, 2, 3, 3], // primary → ordnance (bottom-right)
  [2, 2, 3, 2], // primary → relic (bottom)
  [2, 2, 2, 1], // primary → shield (left)
  [2, 2, 1, 3], // primary → heavy (top-right)
  // Ring connections for the star shape
  [1, 2, 2, 1], // secondary → shield
  [1, 2, 1, 3], // secondary → heavy
  [2, 1, 3, 2], // shield → relic
  [2, 3, 3, 3], // classMod → ordnance
  [1, 3, 2, 3], // heavy → classMod
  [3, 2, 3, 3], // relic → ordnance
];

function gridCenter(row: number, col: number): [number, number] {
  // Each cell is width=33.33%, the connectors need pixel coords relative to the SVG viewport
  // We use percentage-based viewBox on the SVG for responsiveness
  const cols = 3;
  const rows = 3;
  const xPct = ((col - 1) / (cols - 1)) * 100;
  const yPct = ((row - 1) / (rows - 1)) * 100;
  return [xPct, yPct];
}

const StarConnectors: React.FC = () => {
  // SVG viewBox 0 0 100 100 maps to the grid percentage space
  const lines = STAR_LINES.map(([r1, c1, r2, c2]) => {
    const [x1, y1] = gridCenter(r1, c1);
    const [x2, y2] = gridCenter(r2, c2);
    return { x1, y1, x2, y2 };
  });

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-0"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {lines.map((line, i) => (
        <line
          key={i}
          x1={line.x1} y1={line.y1}
          x2={line.x2} y2={line.y2}
          stroke="#FF9000"
          strokeOpacity="0.18"
          strokeWidth="0.5"
          strokeDasharray="2 4"
        />
      ))}
    </svg>
  );
};

// ── Individual slot chip ─────────────────────────────────────────

const SlotChip: React.FC<{
  label: string;
  icon: React.ElementType;
  item: Weapon | ShieldItem | ClassMod | Relic | Ordnance | null;
  isCenter?: boolean;
}> = ({ label, icon: Icon, item, isCenter }) => {
  const filled = !!item;
  const accent = item?.rarity ? rarityAccent[item.rarity] ?? '#7B756D' : '#7B756D';
  const name = item?.name ?? (isCenter ? 'No weapon' : 'Open');

  return (
    <div
      className={`relative z-10 flex flex-col items-center justify-center gap-0.5 border-2 p-1.5 text-center transition-all ${
        isCenter
          ? 'border-amber/60 bg-amber/10 shadow-[0_0_18px_rgba(255,144,0,0.18)]'
          : filled
            ? 'border-border bg-bg/70'
            : 'border-border bg-bg/40 opacity-55'
      }`}
      style={{
        ...signClip,
        ...(filled && !isCenter ? { borderColor: `${accent}55`, boxShadow: `inset 0 0 0 1px ${accent}20` } : {}),
      }}
    >
      <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-text-muted">
        <Icon size={isCenter ? 13 : 10} style={{ color: filled ? accent : undefined }} />
        <span>{label}</span>
      </div>
      <div
        className={`text-[10px] font-black leading-tight truncate max-w-full ${
          isCenter ? 'text-sm' : ''
        }`}
        style={{ color: filled ? accent : '#7B756D' }}
      >
        {name}
      </div>
      {filled && (
        <div
          className="text-[7px] font-black uppercase tracking-wider"
          style={{ color: accent }}
        >
          {item.rarity}
        </div>
      )}
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────

export const ActionLoadout: React.FC<{ className?: string }> = ({ className }) => {
  // Narrow subscriptions — re-render only when loadout slots change
  const loadout = useLoadoutStore();
  // Player credits/consumables subscription needed for ConsumablesChips
  usePlayerStore((s) => s.consumables);

  const dps = loadoutEffectiveDps();

  return (
    <section
      data-testid="action-loadout"
      className={`relative overflow-hidden border-2 border-border bg-surface/95 p-3 ${className ?? ''}`}
      style={{
        clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)',
      }}
    >
      {/* Section header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Crosshair size={15} className="text-amber" />
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">Loadout</div>
            <div className="text-sm font-black text-text-primary">Gear Constellation</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">DPS</div>
          <div className={`text-lg font-black ${dps > 0 ? 'text-amber' : 'text-text-muted'}`}>
            {dps > 0 ? dps.toFixed(0) : '—'}
          </div>
        </div>
      </div>

      {/* Star connector lines */}
      <div className="relative mb-2" style={{ paddingTop: '75%' /* 4:3-ish aspect for the grid */ }}>
        <StarConnectors />

        {/* The 3×3 grid of slot chips */}
        <div
          className="absolute inset-0 grid gap-1.5 z-10"
          style={{ gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr' }}
        >
          {SLOT_CONFIG.map(({ slot, label, icon, row, col, isCenter }) => {
            const item = slotItem(loadout, slot);
            return (
              <div
                key={slot}
                style={{ gridRow: row, gridColumn: col }}
              >
                <SlotChip
                  label={label}
                  icon={icon}
                  item={item}
                  isCenter={isCenter}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Consumables row */}
      <div className="pt-2 border-t border-border/50">
        <ConsumablesChips />
      </div>
    </section>
  );
};
