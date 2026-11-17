/**
 * Hunter head variants as PARTS (M2).
 *
 * The head-variant catalog used to live in the segmented rig
 * (rig.ts) and swapped a segment sprite on the baked whole hunter.
 * In the parts system a variant is simply a different head PART in
 * the Standard Issue set: every shipped variant sprite shares the
 * visor head's geometry (86×88, same neck-seat pivot, same 9px
 * collar skirt), so one seat serves all of them.
 *
 * The catalog survives as DATA (the manufacturer variants are the
 * Standing rank-3 cosmetics and feed the craftable head parts in
 * skinParts.ts). The PICK retired 2026-11-17 (device-pass
 * Batch 4): the Settings picker, the 'cc-head-variant' device
 * preference, and the server selection write are all gone — the
 * hunters are paintings now, and no surface reads a head pick.
 */
import type { PartDef } from './parts';
import { STANDARD_ISSUE } from './standardIssue';
import type { PartSetDef } from './parts';

export interface HunterHeadVariantDef {
  id: string;
  label: string;
  spriteId: string;
  /**
   * Manufacturer Standing (0043): set when this variant is that
   * manufacturer's rank-3 cosmetic. The unlock is server state (the
   * granted rank); the cosmetics state view lists the variant as
   * wearable for owners. (The Settings selection list retired with
   * the pick in the 2026-11-17 fix round.)
   */
  standingManufacturer?: string;
}

export const HUNTER_HEAD_VARIANTS: HunterHeadVariantDef[] = [
  { id: 'visor', label: 'Visor', spriteId: 'rig-hunter-head' },
  { id: 'optic', label: 'Optic', spriteId: 'hunter-head-optic' },
  { id: 'hood', label: 'Hood', spriteId: 'hunter-head-hood' },
  { id: 'fin', label: 'Fin', spriteId: 'hunter-head-fin' },
  { id: 'mfr-redline', label: 'Redline', spriteId: 'hunter-head-redline', standingManufacturer: 'Redline' },
  { id: 'mfr-ironwood', label: 'Ironwood', spriteId: 'hunter-head-ironwood', standingManufacturer: 'Ironwood' },
  { id: 'mfr-blastforge', label: 'BlastForge', spriteId: 'hunter-head-blastforge', standingManufacturer: 'BlastForge' },
  { id: 'mfr-prismatek', label: 'Prismatek', spriteId: 'hunter-head-prismatek', standingManufacturer: 'Prismatek' },
  { id: 'mfr-throwtech', label: 'ThrowTech', spriteId: 'hunter-head-throwtech', standingManufacturer: 'ThrowTech' },
  { id: 'mfr-helixworks', label: 'HelixWorks', spriteId: 'hunter-head-helixworks', standingManufacturer: 'HelixWorks' },
];

export type HunterHeadVariantId = string;

/** Whether a stored device-local pick names a shipped variant. */
export function isHunterHeadVariantId(value: unknown): value is HunterHeadVariantId {
  return typeof value === 'string' && HUNTER_HEAD_VARIANTS.some((v) => v.id === value);
}

/** The head PART for a variant: the Standard Issue head re-skinned
 *  with the variant's sprite (identical geometry — see header). */
export function headPartForVariant(variantId: HunterHeadVariantId): PartDef {
  const variant = HUNTER_HEAD_VARIANTS.find((v) => v.id === variantId) ?? HUNTER_HEAD_VARIANTS[0];
  const base = STANDARD_ISSUE.parts.head!;
  if (variant.spriteId === base.spriteId) return base;
  return { ...base, id: `head-${variant.id}`, spriteId: variant.spriteId };
}

/** The Standard Issue part set wearing the given head variant.
 *  Parts-system data only since the paintings conversion: no live
 *  surface renders a part set anymore (the look record resolves
 *  through lookResolution for the record's own consumers). */
export function hunterPartSet(variantId: HunterHeadVariantId = 'visor'): PartSetDef {
  const head = headPartForVariant(variantId);
  if (head === STANDARD_ISSUE.parts.head) return STANDARD_ISSUE;
  return { ...STANDARD_ISSUE, parts: { ...STANDARD_ISSUE.parts, head } };
}
