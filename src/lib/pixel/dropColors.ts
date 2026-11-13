/**
 * Drop color identity (Stage Iteration R2) — one home for the colors a
 * drop rise speaks: the painted master's tint and the corpse beam under
 * it must always agree, on the DOM diorama and the Pixi stage alike.
 */
import { MATERIAL_VISUALS, ESSENCE_VISUALS, RESOURCE_VISUALS } from '@/constants/visualAssets';

/** Parse material type from event label (e.g. "+1 TechFragments" → "TechFragments") */
export const parseDropType = (label: string): string => {
  const match = label.match(/^\+?\d+\s+(.+)$/);
  return match ? match[1] : label;
};

/** Resolve visual asset color for a material or essence drop */
export const dropAssetColor = (typeName: string): string => {
  const mat = (MATERIAL_VISUALS as Record<string, { color: string }>)[typeName];
  if (mat) return mat.color;
  const ess = (ESSENCE_VISUALS as Record<string, { color: string }>)[typeName];
  if (ess) return ess.color;
  // Resource colors
  const res = (RESOURCE_VISUALS as Record<string, { color: string }>)[typeName];
  if (res) return res.color;
  return '#A5A7B5'; // fallback gray
};

/** The drop rise's beam color for a rise visual + event label — the
 *  same identity DropRiseIcon paints its master with: the beam speaks
 *  the drop's own color. */
export const dropRiseBeamColor = (visual: string, label: string): string =>
  visual === 'fragment'
    ? '#2196F3'
    : visual === 'scrap'
      ? '#FF5722'
      : visual === 'credits' || visual === 'crate'
        ? '#FFD700'
        : dropAssetColor(parseDropType(label));
