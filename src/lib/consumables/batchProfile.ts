/**
 * Consumable batch quality profiles — the read side of the crafting
 * slice's quality wiring (brief §2.4).
 *
 * The engines never read batch rows directly. The Chef routes build a
 * per-type UNIT QUALITY PROFILE from the player's batch rows: unit
 * qualities in burn order (quality ascending, then oldest first — the
 * cc_consume_consumable_batch order), expanded to one entry per unit
 * and reconciled against the authoritative profiles.consumables count:
 *
 *   - units with no batch record read as quality 100 (the shipped
 *     fallback — legacy counts predate batches, and roaming
 *     consumption decrements counts without burning batch rows, so
 *     batch rows can also overstate the count; the profile truncates
 *     to the count so the engines always price exactly the units the
 *     profile says the player owns);
 *   - a type whose batches are all quality 100 produces a profile of
 *     pure 100s, and every consumer of this module is the identity at
 *     quality 100 — a 100% batch is bit-identical to pre-slice play.
 *
 * The engines then compute each resolution window's effect input as
 * the quantity-weighted average quality of the units actually drawn
 * in that window (see roamingConsumableEngine / bossSimulator).
 */

export interface ConsumableBatchRow {
  consumable_type: string;
  quality_percent: number;
  quantity: number;
  created_at?: string;
}

/** Sort comparator for burn order: quality asc, stable for ties. */
export function compareBatchBurnOrder(
  a: { quality_percent: number; created_at?: string },
  b: { quality_percent: number; created_at?: string },
): number {
  if (a.quality_percent !== b.quality_percent) return a.quality_percent - b.quality_percent;
  return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
}

/**
 * Build the per-type unit-quality profile. `batches` may arrive in
 * any order; rows are grouped by type and sorted into burn order
 * here. `counts` is the authoritative owned count per type
 * (profiles.consumables).
 */
export function buildConsumableQualityProfile(
  batches: readonly ConsumableBatchRow[],
  counts: Record<string, number>,
): Record<string, number[]> {
  const byType = new Map<string, ConsumableBatchRow[]>();
  for (const batch of batches) {
    if (batch.quantity <= 0) continue;
    const list = byType.get(batch.consumable_type) ?? [];
    list.push(batch);
    byType.set(batch.consumable_type, list);
  }
  const profile: Record<string, number[]> = {};
  const types = new Set<string>([...Object.keys(counts), ...byType.keys()]);
  for (const type of types) {
    const count = Math.max(0, Math.floor(counts[type] ?? 0));
    const rows = (byType.get(type) ?? []).slice().sort(compareBatchBurnOrder);
    const units: number[] = [];
    for (const row of rows) {
      for (let i = 0; i < row.quantity && units.length < count; i++) {
        units.push(row.quality_percent);
      }
    }
    while (units.length < count) units.push(100);
    if (units.length > 0) profile[type] = units;
  }
  return profile;
}

/**
 * The quantity-weighted average quality of the first `count` units of
 * a profile (the units a window draws, in burn order). Falls back to
 * 100 when the profile has no record of the type — the same fallback
 * every engine used before quality wiring existed.
 */
export function weightedQualityForUnits(
  units: readonly number[] | undefined,
  count: number,
): number {
  if (!units || units.length === 0 || count <= 0) return 100;
  const drawn = units.slice(0, count);
  if (drawn.length === 0) return 100;
  let sum = 0;
  for (const q of drawn) sum += q;
  return sum / drawn.length;
}
