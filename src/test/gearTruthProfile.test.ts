/**
 * Gear-truth slice — Profile number honesty pins.
 *
 *  - K/D derives from the kills/deaths ledger numbers themselves:
 *    12 kills / 0 deaths is NOT "0.00" (the summary's ratio field
 *    is null at zero deaths and the old render coerced it); it is
 *    '—', no ratio yet. With deaths present it is plain arithmetic.
 *  - The Wardrobe craftable-parts cost line reads the recipe's
 *    real duration field: the pre-fix line read two fields that do
 *    not exist on CraftRecipe and printed "undefined min · Bench
 *    undefined" on every row. Pinned across the WHOLE skin-part
 *    catalog, not one row.
 */
import { describe, expect, it } from 'vitest';
import { formatKillDeathRatio, killDeathRatio } from '@/lib/stats/statsHelpers';
import { formatCraftTime, recipeCostLine } from '@/components/profile/WardrobePanel';
import { SKIN_PARTS } from '@/content/skins';

describe('K/D derivation', () => {
  it('zero deaths yields no ratio — never 0.00', () => {
    expect(killDeathRatio(12, 0)).toBeNull();
    expect(formatKillDeathRatio(12, 0)).toBe('—');
    expect(formatKillDeathRatio(0, 0)).toBe('—');
  });

  it('with deaths it is the ledger arithmetic', () => {
    expect(killDeathRatio(12, 3)).toBe(4);
    expect(formatKillDeathRatio(12, 3)).toBe('4.00');
    expect(formatKillDeathRatio(7, 2)).toBe('3.50');
    expect(formatKillDeathRatio(0, 5)).toBe('0.00');
  });
});

describe('Wardrobe craftable-parts cost line', () => {
  it('formats durations in the Workshop grammar', () => {
    expect(formatCraftTime(5 * 60_000)).toBe('5m');
    expect(formatCraftTime(45_000)).toBe('45s');
  });

  it('every catalog row prints real inputs + a real duration — no undefined, no bench segment', () => {
    expect(SKIN_PARTS.length).toBeGreaterThan(0);
    for (const part of SKIN_PARTS) {
      const line = recipeCostLine(part.recipeId);
      expect(line, part.id).not.toContain('undefined');
      expect(line, part.id).not.toContain('Bench');
      expect(line, part.id).toMatch(/· \d+(m|s)$/);
    }
  });
});
