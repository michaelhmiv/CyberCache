/**
 * Bench seat resolution (Motion M4b + V2, 2026-11-07) — what sits
 * on the bench, derived truthfully from state the client already
 * holds. Pure functions; the scenes render the plan, never invent
 * it.
 *
 * THE TRUTHFULNESS CONTRACT (Motion Audit, Intent 2):
 * - A running job's output is resolved from its recipe
 *   (WorkshopJobView.recipeId → the recipe catalog): consumables,
 *   materials, cosmetic parts, and named relics are fully known
 *   before they exist — the recipe IS the item's identity.
 * - A NAMED RELIC is known almost whole: name + fixed rarity are
 *   set at enqueue; only the instance seed is minted at
 *   completion. The seat renders the name's relic-grammar form at
 *   its fixed rarity with a per-job deterministic seed — the form
 *   is the truth; the wear the seed drives is a preview.
 * - A GENERIC GEAR job's item DOES NOT EXIST mid-job — the server
 *   rolls it at the completion instant. The seat shows the honest
 *   maximum: a slot + rarity frame (the rarity was snapshotted at
 *   enqueue), never a fabricated item.
 * - SERVICE jobs (repair / shield-tech) work on an item that
 *   already exists — the seat resolves the target record itself.
 * - COMPLETIONS rise as themselves: the completion entry's own
 *   output fields resolve consumable / material / cosmetic part /
 *   the minted inventory item of ANY gear kind. Only a completion
 *   with no picture of its own (service work, or an item already
 *   moved out of the inventory) falls back to the glow beat.
 * - SALVAGE pays Scrap on every recycle — the rise pictures the
 *   yield, never the destroyed item.
 */
import { craftRelicByName, getCraftRecipe, type CraftRecipe } from '@/content/crafting';
import type { GearComposeInput } from '@/lib/pixel/gearCardCompositor';
import { relicFormRowForName } from '@/lib/pixel/relicGrammar';
import { skinPartDef } from '@/lib/pixel/skinParts';
import { hashString } from '@/lib/utils/rng';
import type { SalvageFeedEntry } from '@/store/slices/salvageFeedSlice';
import type { WorkshopCompletionView, WorkshopJobView } from '@/store/slices/workshopSlice';
import { MaterialType, Rarity } from '@/types/game';
import type { GearItem } from '@/types/items';
import type { PxIconName } from '@/lib/pixel/icons';

export type GearSlotId = NonNullable<CraftRecipe['gearSlot']>;

/** Slot → glyph for the gear-frame placeholder. Data, keyed by the
 *  recipe's slot id (flexibility law: a new slot adds a row). */
export const GEAR_SLOT_ICONS: Record<GearSlotId, PxIconName> = {
  weapon: 'gun',
  shield: 'shield',
  classMod: 'nodes',
  relic: 'gem',
  ordnance: 'frag',
};

export type BenchSeatPlan =
  | { kind: 'consumable'; consumableType: string }
  | { kind: 'material'; materialId: string }
  | { kind: 'cosmeticPart'; partId: string; spriteId: string }
  | { kind: 'namedRelic'; name: string; input: GearComposeInput }
  | { kind: 'gearFrame'; slot: GearSlotId; rarity: Rarity }
  | { kind: 'serviceItem'; itemId: string };

export type BenchRisePlan =
  | { kind: 'consumable'; consumableType: string }
  | { kind: 'material'; materialId: string }
  | { kind: 'cosmeticPart'; partId: string; spriteId: string }
  | { kind: 'item'; item: GearItem }
  | { kind: 'glow' };

const RARITY_VALUES = new Set<string>(Object.values(Rarity));

const asRarity = (value: string | null | undefined): Rarity | null =>
  value && RARITY_VALUES.has(value) ? (value as Rarity) : null;

/**
 * The relic-grammar compose input for a named relic that has not
 * been minted yet: the name's form row + colorway, the fixed
 * rarity, the fixed affix count as pips, the crafted treatment
 * (what the minted record will carry), and a seed hashed from the
 * job id — stable for the job's whole life, never a claim about
 * the minted instance's own seed.
 */
export function namedRelicSeatInput(name: string, rarity: Rarity, jobId: string): GearComposeInput | null {
  const def = craftRelicByName(name);
  const row = relicFormRowForName(name);
  if (!def || !row) return null;
  return {
    kind: 'relic',
    rarity,
    element: null,
    seed: hashString(`bench-seat|${jobId}`),
    pips: def.effects.length,
    baseColor: row.baseColor,
    variant: `${row.formId}/crafted`,
  };
}

/** What sits on the bench for a job — null when nothing truthful
 *  can be pictured (no running job, an unknown recipe, a tint job
 *  whose target the mirror view does not carry). */
export function benchSeatPlanForJob(job: WorkshopJobView | null | undefined): BenchSeatPlan | null {
  if (!job || job.state !== 'running') return null;
  if (job.kind === 'repair') {
    return job.repairItemId ? { kind: 'serviceItem', itemId: job.repairItemId } : null;
  }
  if (job.kind === 'shieldtech') {
    return job.shieldtechItemId ? { kind: 'serviceItem', itemId: job.shieldtechItemId } : null;
  }
  const recipe = getCraftRecipe(job.recipeId);
  if (!recipe) return null;
  if (recipe.consumableType) return { kind: 'consumable', consumableType: recipe.consumableType };
  if (recipe.outputMaterial) return { kind: 'material', materialId: recipe.outputMaterial };
  if (recipe.cosmeticPartId) {
    const def = skinPartDef(recipe.cosmeticPartId);
    return def ? { kind: 'cosmeticPart', partId: recipe.cosmeticPartId, spriteId: def.spriteId } : null;
  }
  if (recipe.namedRelic) {
    const rarity = asRarity(job.gearRarity) ?? recipe.fixedRarity ?? Rarity.Epic;
    const input = namedRelicSeatInput(recipe.namedRelic, rarity, job.id);
    return input ? { kind: 'namedRelic', name: recipe.namedRelic, input } : null;
  }
  if (recipe.gearSlot) {
    const rarity = asRarity(job.gearRarity) ?? recipe.fixedRarity ?? Rarity.Common;
    return { kind: 'gearFrame', slot: recipe.gearSlot, rarity };
  }
  return null;
}

/** What rises off the bench for a settled unit. Resolution order
 *  matters: a cosmetic completion carries BOTH cosmeticPartId and
 *  the minted itemId — the part sprite is the part's own render,
 *  while the generic gear dispatcher would misclassify the
 *  cosmetic record, so the part wins over the item lookup. */
export function benchRisePlanForEntry(
  entry: WorkshopCompletionView,
  items: readonly GearItem[],
): BenchRisePlan {
  if (typeof entry.consumableType === 'string') {
    return { kind: 'consumable', consumableType: entry.consumableType };
  }
  if (typeof entry.outputMaterial === 'string') {
    return { kind: 'material', materialId: entry.outputMaterial };
  }
  if (typeof entry.cosmeticPartId === 'string') {
    const def = skinPartDef(entry.cosmeticPartId);
    if (def) return { kind: 'cosmeticPart', partId: entry.cosmeticPartId, spriteId: def.spriteId };
  }
  if (typeof entry.itemId === 'string') {
    const item = items.find((i) => i.id === entry.itemId);
    if (item) return { kind: 'item', item };
  }
  return { kind: 'glow' };
}

/** The salvage completion beat: a settled recycle (per-item or one
 *  batch summary) rises as the yield every recycle pays — Scrap.
 *  A failed batch settled nothing and earns no beat. */
export function salvageRisePlanForEntry(entry: SalvageFeedEntry): BenchRisePlan | null {
  if (entry.kind === 'batchFailed') return null;
  return { kind: 'material', materialId: MaterialType.Scrap };
}
