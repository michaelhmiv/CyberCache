import React, { memo } from 'react';
import { CONSUMABLES, type ConsumableVisual } from '@/constants/consumables';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';
import { PixelGridCanvas, type PixelGridPalette } from '@/components/pixelArt/PixelGridCanvas';
import { buildConsumableRingGrid } from '@/lib/pixel/consumableRing';

const SLOT_ORDER: Array<keyof LoadoutConsumables> = ['PreFight', 'MidFight', 'Emergency'];

// The fallback below catches a `ConsumableVisual.accent` value that exists
// at runtime but isn't in this map (forward-compat safety). If the
// ConsumableVisual union grows, TypeScript will require this map to
// enumerate the new value — which is the correct behavior: a missing
// entry should fail at compile time, not silently fall through to a
// hard-coded colour.
const accentClass: Record<ConsumableVisual['accent'], string> = {
  green: '#7CFC00',
  red: '#FF4B5C',
  orange: '#FF9000',
  cyan: '#00E5FF',
  amber: '#FFB300',
  purple: '#B66BFF',
  blue: '#5AA7FF',
};

/* ------------------------------------------------------------------ */
/* Pixel conversion (2026-11-07, SVG closure). The ring was SVG paths */
/* (annulus slices, dashed pulse circle, SVG text count). It is now   */
/* rasterized onto a 28×28 texel grid and painted on canvas: slice    */
/* cells take the slot's accent, rim and seam cells are ink, the      */
/* pulse is a dashed texel ring, and the count is a 3×5 texel digit.  */
/* Same data, same aria summary, same size — only the form changed.   */
/* ------------------------------------------------------------------ */


export const ConsumableRing = memo(function ConsumableRing({
  consumables,
  onClick,
  size = 56,
  activeBuffs,
}: {
  consumables: LoadoutConsumables;
  onClick: () => void;
  size?: number;
  activeBuffs?: ActiveBuff[];
}) {
  const storeBuffs = useActiveBuffsStore((state) => state.buffs);
  const [now] = React.useState(Date.now);
  const visibleBuffs = activeBuffs ?? storeBuffs.filter((buff) => buff.expiresAt > now);
  const activeCount = visibleBuffs.filter((buff) => buff.displayState === 'active' || buff.displayState === 'recent').length;
  const loaded = SLOT_ORDER.map((slot) => {
    const id = consumables[slot];
    if (!id) return null;
    const def = CONSUMABLES[id];
    if (!def) return null;
    return { slot, def };
  }).filter(
    (entry): entry is { slot: keyof LoadoutConsumables; def: typeof CONSUMABLES[string] } => Boolean(entry)
  );

  const rows = buildConsumableRingGrid(loaded.length, activeCount > 0);
  const palette: PixelGridPalette = {
    K: { color: '#000000' },
    D: { color: '#050608' },
    P: { color: '#FFB300' },
    N: { color: '#FF9000' },
    R: { color: '#2A2F3A' },
  };
  loaded.forEach(({ def }, i) => {
    palette[String(i)] = { color: accentClass[def.visual.accent], alpha: 0.78 };
  });

  if (loaded.length === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-consumable-ring
        data-consumable-empty
        aria-label="No consumables loaded. Tap to manage."
        className="flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
      >
        <PixelGridCanvas rows={rows} palette={palette} style={{ width: size, height: size }} aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-consumable-ring
      aria-label={`${loaded.length} consumable${loaded.length === 1 ? '' : 's'} loaded${activeCount > 0 ? `, ${activeCount} active or recent` : ''}. Tap to manage.`}
      data-active-consumables={activeCount}
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <PixelGridCanvas
        rows={rows}
        palette={palette}
        style={{ width: size, height: size }}
        aria-hidden="true"
        data-consumable-slices={loaded.map(({ slot, def }) => `${slot}:${def.id}`).join(',')}
        {...(activeCount > 0 ? { 'data-consumable-active-pulse': 'true' } : {})}
      />
    </button>
  );
});
