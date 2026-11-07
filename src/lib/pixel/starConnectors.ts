// Star connectors (pixel conversion, 2026-11-07): the loadout
// constellation's dashed connector lines, rasterized onto a
// 100×100 texel grid (dash pattern walked along each line:
// 2 units on, 4 off). Lives in lib so the lint test can verify
// the shipped rasterizer without importing a component file.

const STAR_LINES: Array<[number, number, number, number]> = [
  [2,2,1,2], [2,2,2,3], [2,2,3,3], [2,2,3,2], [2,2,2,1], [2,2,1,3],
  [1,2,2,1], [1,2,1,3], [2,1,3,2], [2,3,3,3], [1,3,2,3], [3,2,3,3],
];

function gridPct(row: number, col: number): [number, number] {
  const xPct = ((col - 1) / 2) * 100;
  const yPct = ((row - 1) / 2) * 100;
  return [xPct, yPct];
}

/** Rasterize the connector lines to a 100×100 grid ('S' = line cell).
 *  Exported so the lint test verifies the shipped rasterizer. */
export function buildStarConnectorGrid(): string[] {
  const grid: string[][] = Array.from({ length: 100 }, () => Array(100).fill('.'));
  for (const [r1, c1, r2, c2] of STAR_LINES) {
    const [x1, y1] = gridPct(r1, c1);
    const [x2, y2] = gridPct(r2, c2);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(len * 2);
    for (let s = 0; s <= steps; s++) {
      const d = (s / steps) * len;
      if (d % 6 >= 2) continue; // dash gap (2 on, 4 off — as the SVG)
      const x = Math.floor(x1 + ((x2 - x1) * s) / steps);
      const y = Math.floor(y1 + ((y2 - y1) * s) / steps);
      if (x >= 0 && x < 100 && y >= 0 && y < 100) grid[y][x] = 'S';
    }
  }
  return grid.map((r) => r.join(''));
}
