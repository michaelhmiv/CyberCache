/**
 * Look resolution (M4) — the ONE function that answers "what does
 * this hunter look like" (skins brief §5.5). Every stage consumes
 * its result; no surface resolves skin/head state on its own (the
 * ActionScenes 'visor' hard-code is what happens without one).
 *
 * Inputs are FACTS: the server selection record + the owned part
 * items (for the local player), or a HunterLookView (for other
 * hunters on public surfaces). Resolution:
 *  - start from Standard Issue;
 *  - each equipped slot's part REPLACES the stock part (SPEC §1);
 *  - the head slot falls back to the head-variant pick when no head
 *    part is equipped;
 *  - each equipped part's render palette is its tint adjusted by
 *    its finish (content/skins.ts effectivePartPalette).
 *
 * With an empty selection the result is exactly the pre-M4
 * hunterPartSet() behavior — the same set object for the stock
 * visor, so existing surfaces and tests see no change until a
 * player actually wears something.
 */
import type { PaletteSpec } from './paletteSwap';
import type { PartSetDef, PartSlot } from './parts';
import { STANDARD_ISSUE } from './standardIssue';
import { headPartForVariant, isHunterHeadVariantId } from './headParts';
import { SKIN_PART_DEFS } from './skinParts';
import {
  effectivePartPalette,
  isCosmeticSlot,
  type CosmeticPartItemView,
  type CosmeticSelection,
  type HunterLookView,
} from '../../content/skins';

export interface ResolvedLook {
  set: PartSetDef;
  partPalettes: Partial<Record<PartSlot, { paletteId: string; spec: PaletteSpec }>>;
}

interface PartChoice {
  partId: string;
  tintPaletteId: string | null;
  quality: number;
}

function buildLook(headVariant: string, choices: Partial<Record<PartSlot, PartChoice>>): ResolvedLook {
  const parts: PartSetDef['parts'] = { ...STANDARD_ISSUE.parts };
  const partPalettes: ResolvedLook['partPalettes'] = {};
  const applied = new Set<string>();
  let replaced = false;

  for (const [slotRaw, choice] of Object.entries(choices)) {
    if (!choice || !isCosmeticSlot(slotRaw)) continue;
    const slot = slotRaw as PartSlot;
    const def = SKIN_PART_DEFS[choice.partId];
    if (!def || def.slot !== slot) continue;
    parts[slot] = def;
    applied.add(slot);
    replaced = true;
    const palette = effectivePartPalette(choice.tintPaletteId, choice.quality);
    if (palette) partPalettes[slot] = palette;
  }

  if (!applied.has('head')) {
    const variant = isHunterHeadVariantId(headVariant) ? headVariant : 'visor';
    parts.head = headPartForVariant(variant);
    if (variant !== 'visor') replaced = true;
  }

  if (!replaced) return { set: STANDARD_ISSUE, partPalettes };
  return { set: { ...STANDARD_ISSUE, id: 'hunter-look', parts }, partPalettes };
}

/** The local player's look from the server cosmetics state. */
export function resolveOwnLook(args: {
  selection: CosmeticSelection | null;
  partsById: ReadonlyMap<string, CosmeticPartItemView>;
  fallbackHeadVariant: string;
}): ResolvedLook {
  const choices: Partial<Record<PartSlot, PartChoice>> = {};
  const equipped = args.selection?.equipped ?? {};
  for (const [slot, itemId] of Object.entries(equipped)) {
    if (!itemId) continue;
    const item = args.partsById.get(itemId);
    if (!item) continue;
    choices[slot as PartSlot] = {
      partId: item.partId,
      tintPaletteId: item.tintPaletteId,
      quality: item.quality,
    };
  }
  return buildLook(args.selection?.headVariant ?? args.fallbackHeadVariant, choices);
}

/** Another hunter's look from the public look view (Standings). */
export function resolveLookView(view: HunterLookView): ResolvedLook {
  const choices: Partial<Record<PartSlot, PartChoice>> = {};
  for (const [slot, part] of Object.entries(view.parts)) {
    if (!part) continue;
    choices[slot as PartSlot] = {
      partId: part.partId,
      tintPaletteId: part.tintPaletteId,
      quality: part.quality,
    };
  }
  return buildLook(view.headVariant, choices);
}
