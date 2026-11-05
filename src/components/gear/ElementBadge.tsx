import { ELEMENTS as ELEMENT_DEFS } from '@/constants/elements';
import { Element } from '@/types/game';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';

/**
 * Element → sheet glyph for the thumbnail corner badge (owner
 * ruling 2026-11-04: information rides badges and color wherever a
 * badge says it as well as a word would — the element is never
 * spelled out on a compact row). Picks are the sheet's plainest
 * silhouettes, chosen to survive the 13px inline size on the
 * badge's element-color field: flame / bolt / droplet / snow (snow
 * is the sheet's own Cryo glyph, DESIGN.md §7) / ring-dot for
 * Void, and a plain dot for Kinetic, the neutral element.
 *
 * Shared primitive: born in the Gear inventory list row (PR #385),
 * built for the Market Buy/Sell rows to reuse unchanged — position
 * it at the bottom-left corner of a relatively-positioned thumb
 * wrapper.
 */
const ELEMENT_GLYPHS: Partial<Record<Element, PxIconName>> = {
  [Element.Kinetic]: 'dot',
  [Element.Fire]: 'flame',
  [Element.Shock]: 'bolt',
  [Element.Corrosive]: 'drop',
  [Element.Cryo]: 'snow',
  [Element.Void]: 'ringDot',
};

export function ElementBadge({ element }: { element: string | null | undefined }) {
  const def = element ? ELEMENT_DEFS[element as Element] : undefined;
  const glyph = element ? ELEMENT_GLYPHS[element as Element] : undefined;
  if (!def || !glyph) return null;
  return (
    <span
      className="absolute bottom-0 left-0 flex h-4 w-4 items-center justify-center border border-black/70"
      style={{ backgroundColor: def.color }}
      title={def.name}
      data-element-badge={def.id}
    >
      <PxIcon name={glyph} size={13} className="text-[#171008]" />
    </span>
  );
}
