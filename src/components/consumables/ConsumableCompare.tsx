/**
 * ConsumableCompare — shared inline comparison strip for consumable swaps.
 *
 * Shows per-effect deltas (green ↑ better, red ↓ worse) against the
 * currently slotted consumable. Mirrors the visual rules of GearCompare.
 */
import React from 'react';
import type { ConsumableRuntimeEffects } from '@/constants/consumables';
import { getConsumableRuntimeEffects } from '@/constants/consumables';
import { formatRuntimeValue, labelizeRuntimeKey } from '@/lib/consumables/formatRuntime';

// Effect keys where a LOWER candidate value is better for the player
// (e.g. incoming damage, enemy pressure, fatigue).
const LOWER_IS_BETTER = new Set<keyof ConsumableRuntimeEffects>([
  'incomingDpsMultiplier',
  'incomingAccuracyMultiplier',
  'enemyPressureMultiplier',
  'fatigueDamagePct',
  'repairSuppression',
  'mechanicReduction',
  'shieldRegenInterruptChance',
]);

interface ConsumableCompareProps {
  currentId: string;
  candidateId: string;
  currentQuality?: number;
  candidateQuality?: number;
  compact?: boolean;
}

export const ConsumableCompare: React.FC<ConsumableCompareProps> = ({
  currentId,
  candidateId,
  currentQuality,
  candidateQuality,
  compact = false,
}) => {
  if (currentId === candidateId) return null;

  const cur = getConsumableRuntimeEffects(currentId, currentQuality);
  const cand = getConsumableRuntimeEffects(candidateId, candidateQuality);
  const keys = Array.from(
    new Set([...Object.keys(cur), ...Object.keys(cand)]) as Array<keyof ConsumableRuntimeEffects>,
  );

  const deltas: Array<{ key: string; label: string; delta: string; better: boolean | null }> = [];

  for (const key of keys) {
    const c = cur[key] ?? 0;
    const t = cand[key] ?? 0;
    if (c === t) continue;
    const diff = t - c;
    const lowerBetter = LOWER_IS_BETTER.has(key);
    // lower-is-better: a candidate value < current is "better" (diff < 0)
    const better = lowerBetter ? diff < 0 : diff > 0;
    const arrow = better ? '↑' : '↓';
    const formatted = formatRuntimeValue(key, Math.abs(diff));
    deltas.push({
      key: key as string,
      label: labelizeRuntimeKey(key as string),
      delta: `${arrow}${diff > 0 ? '+' : ''}${diff < 0 ? '−' : ''}${formatted}`.replace('−−', '−'),
      better,
    });
  }

  if (deltas.length === 0) return null;
  const visible = compact ? deltas.slice(0, 3) : deltas;

  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
      {visible.map((d) => (
        <span
          key={d.key}
          className={`text-[9px] font-black inline-flex items-center gap-0.5 ${
            d.better ? 'text-green' : 'text-red'
          }`}
        >
          <span className="text-[8px] text-text-muted/70">{d.label}</span>
          {d.delta}
        </span>
      ))}
    </div>
  );
};
