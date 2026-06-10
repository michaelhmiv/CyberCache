/**
 * Activity Modifiers — centralized modifier aggregation for equipped gear.
 *
 * `sumActivityModifier(gear, activity)` walks the equipped gear set, finds all
 * activity module affixes (category: 'activity'), and sums their subStats into
 * a flat modifier record.
 *
 * ARCHITECTURE:
 *   - Client: Action tab calls this to display current modifiers per activity.
 *   - Chef: Imports and calls this to apply modifiers to claim outcomes.
 *   - The function does NOT import the module definitions — it only reads the
 *     already-generated subStats from affixes. This keeps it decoupled from the
 *     generator and safe for both client and server.
 */

import type { GearItem } from '@/types/items';
import type { ActivityKind } from '@/types/activity';

/**
 * Flat modifier record. Keys are sub-stat names from the module definitions
 * (craftingSpeed, salvageYield, etc.). Values are summed totals from all
 * equipped gear's activity affixes for the given activity.
 */
export interface ActivityModifiers {
  [statKey: string]: number;
}

/** Empty modifier record — used as default when no gear contributes. */
const EMPTY: ActivityModifiers = {};

/**
 * Sum all activity modifiers contributed by equipped gear for a specific
 * activity kind.
 *
 * Walks each gear item's affixes. For every affix with `category === 'activity'`
 * whose `stat` matches the activity kind (e.g., stat === 'craftingModule' when
 * activity === 'crafting'), adds its `subStats` entries to the total.
 *
 * @param gear - All equipped gear items (from loadout store).
 * @param activity - The activity to compute modifiers for.
 * @returns A flat record of stat key → total modifier value.
 */
export function sumActivityModifier(
  gear: GearItem[],
  activity: ActivityKind,
): ActivityModifiers {
  const mods: ActivityModifiers = {};

  // The stat string pattern for activity modules: '{activityKind}Module'
  const activityStat = `${activity}Module`;

  for (const item of gear) {
    if (!('affixes' in item) || !Array.isArray(item.affixes)) continue;

    for (const affix of item.affixes as Array<{
      category?: string;
      stat?: string;
      subStats?: Record<string, number>;
    }>) {
      // Skip non-activity affixes
      if (affix.category !== 'activity') continue;
      // Skip modules for other activities
      if (affix.stat !== activityStat) continue;
      // No sub-stats → nothing to contribute
      if (!affix.subStats) continue;

      for (const [key, value] of Object.entries(affix.subStats)) {
        mods[key] = (mods[key] ?? 0) + value;
      }
    }
  }

  return mods;
}

/**
 * Sum activity modifiers for ALL activity kinds at once.
 * Used by the Action tab to show which activities are boosted.
 *
 * Returns a Map of ActivityKind → ActivityModifiers. Activities with no
 * contributions still get an entry (empty object).
 */
export function sumAllActivityModifiers(
  gear: GearItem[],
): Map<ActivityKind, ActivityModifiers> {
  const activities: ActivityKind[] = [
    'crafting', 'salvaging', 'market_listing', 'workshop_service',
    'roaming_loot', 'idle_standby', 'boss_prep', 'boss_fight',
  ];
  const result = new Map<ActivityKind, ActivityModifiers>();
  for (const act of activities) {
    result.set(act, sumActivityModifier(gear, act));
  }
  return result;
}

/**
 * Get a human-readable summary line for an activity's modifiers.
 * e.g., "Crafting +22% Speed · +8% Eff · +4% Crit"
 */
export function describeActivityModifiers(
  mods: ActivityModifiers,
  primaryKey?: string,
): string {
  const entries = Object.entries(mods).filter(([, v]) => v > 0);
  if (entries.length === 0) return '';

  // Sort: primary key first, then by value descending
  entries.sort(([ak], [bk]) => {
    if (ak === primaryKey) return -1;
    if (bk === primaryKey) return 1;
    return 0;
  });

  return entries
    .map(([key, val]) => {
      const pct = (val * 100).toFixed(0);
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
      return `+${pct}% ${label}`;
    })
    .join(' · ');
}
