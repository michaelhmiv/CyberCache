/**
 * ActivityModifierPanel — shows the current activity's procedural gear modifiers.
 *
 * Reads equipped gear from the loadout store, computes modifiers for the active
 * activity kind, and renders a compact summary. Each contributing gear piece is
 * shown with its sub-stat breakdown.
 */
import React, { useMemo } from 'react';
import { getActivityVisual } from '@/constants/activityVisuals';
import { useLoadoutStore, useInventoryStore } from '@/store';
import { sumActivityModifier } from '@/lib/stats/activityModifiers';
import { PRODUCTIVE_ACTIVITY_LABELS, type ActivityKind } from '@/types/activity';
import type { GearItem } from '@/types/items';
import { getActivityModuleStatLabel } from '@/lib/activity/activityStatMetadata';

// ── Icons per activity ────────────────────────────────────────────

const ACTIVITY_GLYPHS: Partial<Record<ActivityKind, string>> = {
  crafting: getActivityVisual('crafting').glyph,
  salvaging: getActivityVisual('salvaging').glyph,
  market_listing: getActivityVisual('market_listing').glyph,
  workshop_service: getActivityVisual('workshop_service').glyph,
  roaming_loot: getActivityVisual('roaming_loot').glyph,
  idle_standby: getActivityVisual('idle_standby').glyph,
  endless_run: getActivityVisual('endless_run').glyph,
};


// ── Slot order for display ────────────────────────────────────────

const SLOT_ORDER: Array<keyof ReturnType<typeof useLoadoutStore.getState>['slots']> = [
  'primary', 'secondary', 'heavy', 'shield', 'ordnance', 'relic', 'classMod',
];

// ── Helpers ───────────────────────────────────────────────────────

function getEquippedGear(
  loadout: ReturnType<typeof useLoadoutStore.getState>,
  inventory: ReturnType<typeof useInventoryStore.getState>,
): GearItem[] {
  const items: GearItem[] = [];
  for (const slot of SLOT_ORDER) {
    const itemId = loadout.slots[slot];
    if (!itemId) continue;
    const item = inventory.getById(itemId);
    if (item) items.push(item);
  }
  return items;
}

function formatModValue(value: number, isInteger = false): string {
  if (isInteger) return `${Math.round(value)}`;
  const pct = (value * 100).toFixed(0);
  return `+${pct}%`;
}

function shortStatLabel(activityKind: ActivityKind, key: string): string {
  return getActivityModuleStatLabel(activityKind, key);
}

// ── Component ─────────────────────────────────────────────────────

export const ActivityModifierPanel: React.FC<{
  activityKind: ActivityKind;
  className?: string;
}> = ({ activityKind, className }) => {
  const loadout = useLoadoutStore();
  const inventory = useInventoryStore();

  const mods = useMemo(() => {
    const gear = getEquippedGear(loadout, inventory);
    return sumActivityModifier(gear, activityKind);
  }, [loadout, inventory, activityKind]);

  const contributingGear = useMemo(() => {
    const gear = getEquippedGear(loadout, inventory);
    return gear.filter((item) => {
      if (!('affixes' in item) || !Array.isArray(item.affixes)) return false;
      const affixes = item.affixes as Array<{ category?: string; stat?: string; subStats?: Record<string, number> }>;
      return affixes.some((a) => a.category === 'activity' && a.stat === `${activityKind}Module` && a.subStats);
    });
  }, [loadout, inventory, activityKind]);

  const entries = Object.entries(mods).filter(([, v]) => v > 0);

  // Don't render if there are no modifiers
  if (entries.length === 0 && contributingGear.length === 0) return null;

  const activityGlyph = ACTIVITY_GLYPHS[activityKind] ?? '○';
  const label = PRODUCTIVE_ACTIVITY_LABELS[activityKind] ?? activityKind;

  return (
    <div className={`relative overflow-hidden border-2 border-border bg-surface/95 p-3 ${className ?? ''}`}
      style={{ clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' }}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="font-black text-amber shrink-0" style={{ fontSize: '14px' }}>{activityGlyph}</span>
        <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">{label} Modifiers</div>
      </div>

      {/* Modifier summary chips */}
      {entries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {entries.map(([key, val]) => (
            <div key={key}
              className="border border-amber/30 bg-amber/5 px-2 py-0.5 text-[10px] font-black text-amber"
              style={{ clipPath: 'polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%)' }}>
              {shortStatLabel(activityKind, key)} {formatModValue(val, key === 'bulkListingSlots' || key === 'parallelQueueSlots')}
            </div>
          ))}
        </div>
      )}

      {/* Contributing gear */}
      {contributingGear.length > 0 && (
        <div className="mt-2 space-y-1">
          {contributingGear.map((item) => {
            const activityAffix = (item.affixes as Array<{ category?: string; stat?: string; value?: number; subStats?: Record<string, number>; displayText?: string }>)
              .find((a) => a.category === 'activity' && a.stat === `${activityKind}Module`);
            if (!activityAffix?.subStats) return null;
            const quality = activityAffix.value != null ? Math.round(activityAffix.value * 100) : null;
            const subEntries = Object.entries(activityAffix.subStats).filter(([, v]) => v > 0);
            return (
              <div key={item.id}
                className="flex items-center gap-2 border border-border/60 bg-bg/50 px-2 py-1"
                style={{ clipPath: 'polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%)' }}>
                <div className="text-[9px] font-black text-text-primary truncate max-w-[120px]">
                  {item.name}
                </div>
                {quality != null && (
                  <div className="text-[8px] font-black text-text-muted">
                    Q{quality}
                  </div>
                )}
                <div className="flex-1" />
                <div className="flex gap-1 text-[8px]">
                  {subEntries.slice(0, 3).map(([key, val]) => (
                    <span key={key} className="text-amber font-black">
                      {shortStatLabel(activityKind, key)} {formatModValue(val)}
                    </span>
                  ))}
                  {subEntries.length > 3 && (
                    <span className="text-text-muted">+{subEntries.length - 3}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
