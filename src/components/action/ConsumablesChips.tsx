/**
 * ConsumablesChips — three little chips rendered in the action tab
 * header that show the player's current MedKit / ShieldCell /
 * ReviveToken counts. Reads the loadout slot→type mapping and the
 * player store's consumable count via the pure helpers in
 * `consumableSlotMap.ts`.
 *
 * The chips are color-toned by count:
 *   - green  ≥ 5
 *   - amber  1-4
 *   - red    0 (the slot is "empty" from the player's perspective)
 *
 * A null/empty loadout slot renders a dashed-bordered "Empty" chip
 * so the player can see *which* slots are configured and *which*
 * are not.
 *
 * The component subscribes to the player store and loadout store
 * with narrow selectors. The chip data itself is read on render
 * via `readConsumableSlots()` which is a pure store-read.
 */
import React from 'react';
import { usePlayerStore, useLoadoutStore } from '@/store';
import { readConsumableSlots, type ConsumableSlotView } from '@/lib/combat/consumableSlotMap';

export interface ConsumablesChipsProps {
  /** Optional className for the outer row. */
  className?: string;
  /** Show the ReviveToken chip even if count is 0. Default true. */
  showToken?: boolean;
}

const chipClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

function toneForCount(count: number): 'green' | 'amber' | 'red' {
  if (count <= 0) return 'red';
  if (count < 5) return 'amber';
  return 'green';
}

const TONE_CLASSES: Record<'green' | 'amber' | 'red', string> = {
  green: 'border-green/60 bg-green/15 text-green',
  amber: 'border-amber/60 bg-amber/15 text-amber',
  red: 'border-red/40 bg-red/10 text-red/80',
};

const ConsumableChip: React.FC<{ view: ConsumableSlotView }> = ({ view }) => {
  const tone = toneForCount(view.count);
  const empty = view.consumableType === null;
  return (
    <div
      data-testid="consumables-chip"
      data-slot={view.slot}
      data-consumable-type={view.consumableType ?? 'empty'}
      data-count={view.count}
      className={`flex items-center gap-1.5 border-2 px-2 py-1 text-[10px] font-black uppercase tracking-wider ${
        empty ? 'border-dashed border-border bg-bg/50 text-text-muted' : TONE_CLASSES[tone]
      }`}
      style={chipClip}
    >
      <span aria-hidden className="text-sm leading-none">
        {view.icon}
      </span>
      <span className="truncate">{empty ? 'Empty' : view.label}</span>
      <span className="ml-1 text-text-primary">×{view.count}</span>
    </div>
  );
};

export const ConsumablesChips: React.FC<ConsumablesChipsProps> = ({ className, showToken = true }) => {
  // Narrow selectors — re-render only when credits/consumables change.
  // These subscriptions guarantee we re-render when the loadout
  // consumable mapping or the player's consumable counts change.
  // readConsumableSlots() then reads the latest values on render.
  usePlayerStore((s) => s.consumables);
  useLoadoutStore((s) => s.consumables);

  const views = readConsumableSlots();

  // If the Emergency slot holds a ReviveToken, show it. Otherwise
  // optionally show a synthetic ReviveToken chip from player inventory.
  const reviveTokenCount = usePlayerStore.getState().getConsumableCount('ReviveToken');
  const emergencyIsToken = views[2]?.consumableType === 'ReviveToken';

  return (
    <div data-testid="consumables-chips" className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      {views.map((v) => (
        <ConsumableChip key={v.slot} view={v} />
      ))}
      {showToken && !emergencyIsToken && reviveTokenCount > 0 && (
        <div
          data-testid="consumables-chip-token"
          data-count={reviveTokenCount}
          className={`flex items-center gap-1.5 border-2 px-2 py-1 text-[10px] font-black uppercase tracking-wider ${TONE_CLASSES[toneForCount(reviveTokenCount)]}`}
          style={chipClip}
        >
          <span aria-hidden className="text-sm leading-none">🎟</span>
          <span>Revive</span>
          <span className="ml-1 text-text-primary">×{reviveTokenCount}</span>
        </div>
      )}
    </div>
  );
};
