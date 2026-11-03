/**
 * Drop receipts (Activity Log slice AL-1, migration 0070).
 *
 * The engine computes an item's provenance and its drop odds at the
 * moment of generation and then discards them — AL-1 stamps them onto
 * the item payload instead, at generation, in the Chef (the only
 * place the facts exist). The stamp rides the payload forever:
 * through cc_store_chef_items (which also derives the item row's
 * source_id column from it — see migration 0070), through salvage
 * (the row persists, consumed), and through trade.
 *
 * Honesty rules (brief §3/§4.4): a stamp records only values the
 * engine actually held for THAT drop. Ambient roam drops are per-tick
 * rolls, not kill drops — their enemy relation is 'engaged' ("while
 * fighting"), never 'killed'. 'killed' is reserved for drops the kill
 * itself caused (named elite, bounty, boss, endless encounters).
 * Nothing here is back-computed after the fact; items generated
 * before AL-1 carry no stamp and stay unstamped.
 */

/** Where a generated item came from (brief G1's foundVia union). */
export type DropFoundVia = 'roam' | 'boss' | 'cache' | 'endless' | 'offline' | 'event';

/** How the stamped enemy relates to the drop — see the honesty note above. */
export type DropEnemyRelation = 'engaged' | 'killed';

export interface DropEnemyStamp {
  id: string;
  name: string;
  relation: DropEnemyRelation;
}

/**
 * The odds inputs actually in force for one drop, stamped verbatim.
 * Roam/offline drops carry the tick's gearChance that gated the roll;
 * kill-caused drops are guaranteed by the kill, so they carry the
 * shaping facts instead (floor / boost / luck / scalar). Boss drops
 * carry the dedicated-roll facts. Fields that did not apply to a drop
 * are absent — never zero-filled fiction.
 */
export interface DropOddsStamp {
  /** Roam/offline: the shaped gear-drop chance (0..1) that gated this roll. */
  gearChance?: number;
  /** The drop-kind that was rolled ('weapon', 'shield', 'vehicle', …). */
  kind?: string;
  /** The rarity weights the rarity roll drew from, as shaped. */
  rarityWeights?: Record<string, number>;
  /** Drop-luck buff fraction in force (0 when no buff). */
  luck?: number;
  /** Whether a quality boost shaped this roll. */
  boost?: boolean;
  /** Rarity floor in force for this roll (elite/bounty drops), when any. */
  floor?: string;
  /** Legendary scalar applied to this roll's weights (weapons; 1 = none). */
  scalar?: number;
  /** Boss drops: the claim-resolved dedicated-drop chance (lever + research). */
  dedicatedChance?: number;
  /** Boss drops: true only on the item the dedicated roll produced. */
  dedicatedHit?: boolean;
  /** Boss drops: the drop-luck buff fraction in force (also on the attempt). */
  dropLuckBonus?: number;
}

export interface DropReceipt {
  foundVia: DropFoundVia;
  /** Area id (roam/offline), boss id (boss), run depth (endless), event id (event). */
  foundContext?: string | number;
  foundEnemy?: DropEnemyStamp;
  dropOdds?: DropOddsStamp;
}

/** Stamp a receipt onto a generated item payload (mutates and returns it). */
export function stampDropReceipt<T extends object>(item: T, receipt: DropReceipt): T {
  const target = item as Record<string, unknown>;
  target.foundVia = receipt.foundVia;
  if (receipt.foundContext !== undefined) target.foundContext = receipt.foundContext;
  if (receipt.foundEnemy !== undefined) target.foundEnemy = receipt.foundEnemy;
  if (receipt.dropOdds !== undefined) target.dropOdds = receipt.dropOdds;
  return item;
}

/**
 * The item_instances.source_id value for a payload: derived from the
 * receipt's first two fields (cc_store_chef_items, migration 0070 —
 * the SQL twin builds the identical string). Unstamped payloads keep
 * NULL, exactly as before AL-1.
 */
export function sourceIdFromPayload(payload: Record<string, unknown>): string | null {
  const via = typeof payload.foundVia === 'string' ? payload.foundVia : '';
  if (!via) return null;
  const context =
    typeof payload.foundContext === 'string'
      ? payload.foundContext
      : typeof payload.foundContext === 'number'
        ? String(payload.foundContext)
        : '';
  return context ? `${via}:${context}` : via;
}
