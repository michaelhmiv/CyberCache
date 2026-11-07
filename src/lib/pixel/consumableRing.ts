// Consumable ring rasterizer (pixel conversion, 2026-11-07):
// the 28x28 texel ring grids, moved out of the component file
// so the lint test verifies the shipped rasterizer without
// importing a component module.

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
