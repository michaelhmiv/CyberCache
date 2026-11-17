/**
 * Drop color identity (Stage Iteration R2) — one home for the colors a
 * drop rise speaks: the painted master's tint and the corpse beam under
 * it must always agree, on the DOM diorama and the Pixi stage alike.
 */
import { MATERIAL_VISUALS, ESSENCE_VISUALS, RESOURCE_VISUALS, getConsumableVisual } from '@/constants/visualAssets';
import { CONSUMABLES } from '@/constants/consumables';

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

/**
 * Resolve which consumable a roaming feed event names.
 *
 * Roaming consumable feed events (tone 'consumable') carry labels authored
 * by the roaming engine in three shapes:
 *   - the def id first ("MedKit expired", "Grenade fired"),
 *   - the def name first ("Nano Swarm expired", "Adrenaline Shot"),
 *   - a name fragment ("Adrenaline burst ended").
 *
 * Resolution is conservative:
 *   (a) if the label's first whitespace-separated token is a key of CONSUMABLES, return it;
 *   (b) else if a def's name equals the label or the label starts with the def name followed by a space, return that def's id (prefer the longest name when several match);
 *   (c) else if the label's first word is the first word of exactly one def's name, return that def's id;
 *   (d) otherwise return null.
 */
export const parseConsumableDropId = (label: string): string | null => {
  const firstToken = label.trim().split(/\s+/)[0] ?? '';

  // (a) def id first: "MedKit expired", "Grenade fired"
  if (firstToken && Object.prototype.hasOwnProperty.call(CONSUMABLES, firstToken)) {
    return firstToken;
  }

  // (b) def name first: "Nano Swarm expired", "Adrenaline Shot"
  const defs = Object.values(CONSUMABLES);
  let best: (typeof defs)[number] | null = null;
  for (const def of defs) {
    if (label === def.name || label.startsWith(`${def.name} `)) {
      if (!best || def.name.length > best.name.length) {
        best = def;
      }
    }
  }
  if (best) return best.id;

  // (c) name fragment: "Adrenaline burst ended"
  if (firstToken) {
    const matches = defs.filter((def) => def.name.split(/\s+/)[0] === firstToken);
    if (matches.length === 1) return matches[0].id;
  }

  // (d) unresolved
  return null;
};

/** The drop rise's beam color for a rise visual + event label — the
 *  same identity DropRiseIcon paints its master with: the beam speaks
 *  the drop's own color. */
export const dropRiseBeamColor = (visual: string, label: string): string => {
  if (visual === 'consumable') {
    const id = parseConsumableDropId(label);
    return id ? getConsumableVisual(id).color : '#A5A7B5';
  }
  return visual === 'fragment'
    ? '#2196F3'
    : visual === 'scrap'
      ? '#FF5722'
      : visual === 'credits' || visual === 'crate'
        ? '#FFD700'
        : dropAssetColor(parseDropType(label));
};
