import React, { memo } from 'react';
import { CONSUMABLES, type ConsumableVisual } from '@/constants/consumables';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';
import { PixelGridCanvas, type PixelGridPalette } from '@/components/pixelArt/PixelGridCanvas';

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

const RING_GRID = 28;

/** 3×5 texel digits for the loaded count (the ring holds at most 3). */
export const RING_DIGIT_GRIDS: Record<string, string[]> = {
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
};

/**
 * Rasterize the ring to grid rows. Keys: slice index chars '0'..'2',
 * 'K' ink (rims + seams), 'D' center disc, 'P' active pulse,
 * 'N' count digit, 'R' empty-state ring grey.
 * Exported so the lint test verifies the shipped rasterizer.
 */
export function buildConsumableRingGrid(sliceCount: number, active: boolean): string[] {
  const grid: string[][] = Array.from({ length: RING_GRID }, () => Array(RING_GRID).fill('.'));
  const put = (x: number, y: number, key: string) => {
    grid[y][x] = key;
  };

  if (sliceCount === 0) {
    // Empty state: two plain rings, as the SVG drew them.
    for (let y = 0; y < RING_GRID; y++) {
      for (let x = 0; x < RING_GRID; x++) {
        const d = Math.hypot(x - 13.5, y - 13.5);
        if (Math.abs(d - 12) <= 0.8 || Math.abs(d - 8) <= 0.6) put(x, y, 'R');
      }
    }
    return grid.map((r) => r.join(''));
  }

  const sliceAngle = 360 / sliceCount;
  for (let y = 0; y < RING_GRID; y++) {
    for (let x = 0; x < RING_GRID; x++) {
      const dx = x - 13.5;
      const dy = y - 13.5;
      const d = Math.hypot(dx, dy);
      if (d < 7) {
        put(x, y, 'D');
        continue;
      }
      if (d < 8 || d > 12) continue;
      const angleDeg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const rel = (angleDeg + 90) % 360;
      const idx = Math.min(sliceCount - 1, Math.floor(rel / sliceAngle));
      const toBoundary = Math.min(rel % sliceAngle, sliceAngle - (rel % sliceAngle));
      const boundaryArc = (toBoundary * Math.PI) / 180 * d;
      if (d > 11.4 || d < 8.6 || boundaryArc < 0.8) put(x, y, 'K');
      else put(x, y, String(idx));
    }
  }

  if (active) {
    // Pulse ring inside the disc (was an SVG dashed circle): eight
    // 2×2 texel dash blocks on the r=5.5 circle — deliberate
    // clusters, never a 1-px line.
    for (let k = 0; k < 8; k++) {
      const a = ((k * 45 + 22.5) * Math.PI) / 180;
      const cx = Math.floor(13.5 + 5.5 * Math.cos(a));
      const cy = Math.floor(13.5 + 5.5 * Math.sin(a));
      put(cx, cy, 'P');
      put(cx + 1, cy, 'P');
      put(cx, cy + 1, 'P');
      put(cx + 1, cy + 1, 'P');
    }
  }

  const digit = RING_DIGIT_GRIDS[String(sliceCount)];
  if (digit) {
    digit.forEach((row, dy) => {
      row.split('').forEach((cell, dx) => {
        if (cell === '#') put(12 + dx, 11 + dy, 'N');
      });
    });
  }

  return grid.map((r) => r.join(''));
}

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
