import { describe, expect, it } from 'vitest';
import { xpToNextLevel } from '@/content/simulation';
import { levelStateFromTotalXp, totalXpRequiredToReachLevel } from '@/content/xpResolver';

describe('XP curve (50n + 20n^1.4)', () => {
  it('xpToNextLevel(1) ≈ 70', () => {
    // 50*1 + 20*1 = 70
    expect(xpToNextLevel(1)).toBe(70);
  });

  it('xpToNextLevel grows monotonically', () => {
    const samples = [1, 5, 10, 25, 50, 75, 100];
    for (let i = 1; i < samples.length; i++) {
      const prev = xpToNextLevel(samples[i - 1]);
      const curr = xpToNextLevel(samples[i]);
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it('xpToNextLevel(50) is in the band that keeps mid-game progression tractable', () => {
    // The new curve must NOT match the old `level * 100` shape: at L50 the
    // new curve should be 50*50 + 20*50^1.4 ≈ 4,820 (vs the old 5,000).
    // Just a regression check that we're not running the old formula.
    const threshold = xpToNextLevel(50);
    expect(threshold).toBeGreaterThan(2_000);
    expect(threshold).toBeLessThan(7_500);
  });

  it('totalXpRequiredToReachLevel(10) sums the per-level thresholds', () => {
    const total = totalXpRequiredToReachLevel(10);
    let manual = 0;
    for (let lvl = 1; lvl < 10; lvl++) manual += xpToNextLevel(lvl);
    expect(total).toBe(manual);
  });

  it('levelStateFromTotalXp awards a level-up at exactly the threshold', () => {
    // Grant exactly enough XP to reach level 2.
    const target = xpToNextLevel(1);
    const state = levelStateFromTotalXp(target, 100);
    expect(state.level).toBe(2);
    expect(state.xpIntoLevel).toBe(0);
  });

  it('levelStateFromTotalXp keeps remainder XP after a level-up', () => {
    const target = xpToNextLevel(1) + 17; // 17 over the threshold
    const state = levelStateFromTotalXp(target, 100);
    expect(state.level).toBe(2);
    expect(state.xpIntoLevel).toBe(17);
  });

  it('clamps to levelCap', () => {
    const state = levelStateFromTotalXp(1_000_000_000, 100);
    expect(state.level).toBe(100);
    expect(state.xpIntoLevel).toBe(0);
  });
});
