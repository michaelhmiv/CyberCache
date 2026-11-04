/**
 * Material sources for Workshop shortfall lines (Direction A, the
 * G1 fix: a shortage names where the thing comes from, with doors).
 *
 * Sources derive ONLY from live content owners:
 *   - roaming areas (src/constants/roamingAreas.ts materialBias /
 *     essenceBias — the pools the find roller actually draws from),
 *   - signature-material homes + essence homes
 *     (src/content/roamingEvents.ts),
 *   - the refining catalog (a material that is another recipe's
 *     outputMaterial is made HERE, in the Workshop),
 *   - the vendor catalog (src/lib/vendor/catalog.ts — four base
 *     materials and five essences rotate through the NPC vendor;
 *     Scrap is not among them since economy ruling 6),
 *   - the player market (every material and essence id is listable —
 *     src/lib/market/identityKey.ts).
 *
 * NOT used: src/content/gameContent.ts `sourceTags`. That corpus is
 * design-only (its own header says the professions system it
 * describes is not implemented) and its ids are legacy snake_case
 * that match no live recipe input — building player-facing source
 * lines from it would print sources for a game that does not exist.
 *
 * Salvage is deliberately NOT a general source line: the live
 * verified recycle path (cc_recycle_item) pays Scrap, legendary
 * cores for Legendaries, and — only for Common items with the King
 * of Scrap keystone — ONE bonus material. It is not a dependable
 * way to stock a specific material, so no card claims it is.
 */
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { ESSENCE_HOMES, SIGNATURE_MATERIALS } from '@/content/roamingEvents';
import { ALL_CRAFT_RECIPES } from '@/content/crafting';
import { VENDOR_MATERIALS } from '@/lib/vendor/catalog';
import { inputLabel } from './readiness';

export type MaterialSource =
  | { kind: 'refine'; recipeId: string; recipeName: string; station: 'crusher' | 'furnace' }
  | { kind: 'roam'; areaId: string; areaName: string; home: boolean }
  | { kind: 'vendor' }
  | { kind: 'market' };

const areaName = (areaId: string): string =>
  ROAMING_AREAS.find((a) => a.id === areaId)?.name ?? areaId;

/**
 * Where one unit of `inputId` comes from, best source first:
 * refine-it-here, its home roaming area, other biased areas, the
 * vendor rotation (catalog materials/essences only), the market.
 */
export function sourcesForInput(inputId: string): MaterialSource[] {
  // Econ 5: Scrap is an ordinary material — it derives its sources
  // like every other input (the old currency-line special case is
  // gone; there is no second scrap). Econ 6: the vendor door below
  // derives from VENDOR_MATERIALS, which no longer lists Scrap
  // (ruling 6) — a Scrap shortfall now offers roam + market only,
  // which is the ruling's whole point.
  const sources: MaterialSource[] = [];

  // Refined here: this input is another recipe's output.
  const producer = ALL_CRAFT_RECIPES.find((r) => r.kind === 'refine' && r.outputMaterial === inputId);
  if (producer) {
    sources.push({
      kind: 'refine',
      recipeId: producer.id,
      recipeName: producer.name,
      station: producer.station === 'furnace' ? 'furnace' : 'crusher',
    });
  }

  // Roam: home area first (signature materials + essence homes),
  // then every area whose find pool actually carries the input.
  const roamAreas: Array<{ areaId: string; home: boolean }> = [];
  const signature = SIGNATURE_MATERIALS.find((s) => s.materialId === inputId);
  if (signature) roamAreas.push({ areaId: signature.homeAreaId, home: true });
  const essenceHome = ESSENCE_HOMES[inputId];
  if (essenceHome && !roamAreas.some((a) => a.areaId === essenceHome)) {
    roamAreas.push({ areaId: essenceHome, home: true });
  }
  for (const area of ROAMING_AREAS) {
    const biased = area.materialBias.includes(inputId) || area.essenceBias.includes(inputId);
    if (biased && !roamAreas.some((a) => a.areaId === area.id)) {
      roamAreas.push({ areaId: area.id, home: false });
    }
  }
  // One roam door is enough on a card line: the home area when the
  // input has one, else the first biased area.
  const roam = roamAreas.find((a) => a.home) ?? roamAreas[0];
  if (roam) sources.push({ kind: 'roam', areaId: roam.areaId, areaName: areaName(roam.areaId), home: roam.home });

  // Vendor: only the catalog's priced materials/essences rotate in.
  if (VENDOR_MATERIALS.some((m) => m.id === inputId)) sources.push({ kind: 'vendor' });

  // Market: every live material and essence id is listable.
  sources.push({ kind: 'market' });

  return sources;
}

/** One-line human rendering of a source list (doors render separately). */
export function sourceSummary(inputId: string): string {
  const label = inputLabel(inputId);
  const parts = sourcesForInput(inputId).map((s) => {
    switch (s.kind) {
      case 'refine':
        return `Refine here — the ${s.station === 'furnace' ? 'furnace' : 'crusher'}`;
      case 'roam':
        return s.home ? `Roam ${s.areaName} — its home area` : `Roam ${s.areaName}`;
      case 'vendor':
        return 'Vendor rotation';
      case 'market':
        return 'Market';
    }
  });
  return `${label}: ${parts.join(' · ')}`;
}
