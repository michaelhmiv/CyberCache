import { describe, expect, it } from 'vitest';
import { xpToNextLevel } from '@/content/simulation';
import { levelStateFromTotalXp, totalXpRequiredToReachLevel } from '@/content/xpResolver';

// RE-PINNED for the pacing-baseline tuning pass (owner directive,
// 2026-10-30): the launch curve (50n + 20n^1.4, 766,955 XP to 100)
// capped a regular player in ~45 days. The stretched curve is
// Torn-shaped — floor(100·L^1.72) below 25, then
// floor(25377·(L/25)^0.5 · 1.048^max(0, L−45)) — solved against the
// lifecycle evaluation's faucet model so regulars reach L25 in ~17
// days, L45 in ~51 days, and L100 in ~24 months. Every numeric pin
// below is the new curve's exact output; the SQL mirror lives in
// migration 0016.
describe('XP curve (stretched: 100n^1.72, then sqrt + 1.048 tail)', () => {
  it('xpToNextLevel(1) = 100', () => {
    // floor(100 * 1^1.72) = 100 — the first level still lands in minutes.
    expect(xpToNextLevel(1)).toBe(100);
  });

  it('xpToNextLevel grows monotonically', () => {
    const samples = [1, 5, 10, 25, 50, 75, 100];
    for (let i = 1; i < samples.length; i++) {
      const prev = xpToNextLevel(samples[i - 1]);
      const curr = xpToNextLevel(samples[i]);
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it('is continuous at the L25 segment joint', () => {
    // Segment 2's constant is segment 1 evaluated at 25.
    expect(xpToNextLevel(25)).toBe(Math.floor(100 * Math.pow(25, 1.72)));
    expect(xpToNextLevel(25)).toBe(25377);
    expect(xpToNextLevel(24)).toBe(23657);
  });

  it('pins the milestone thresholds of the stretched curve', () => {
    expect(xpToNextLevel(45)).toBe(34046);
    expect(xpToNextLevel(50)).toBe(45369);
    expect(xpToNextLevel(99)).toBe(635034);
  });

  it('total XP to reach the milestones matches the pacing model', () => {
    // Lifecycle faucet model (best-area XP/hr by band): at these totals
    // a regular (6 roaming-h/day) reaches L25 in ~17 days, L45 in ~51
    // days, and the cap in ~726 days (~24 months); a casual (2.5 h/day)
    // needs ~4.8 years for the cap.
    expect(totalXpRequiredToReachLevel(25)).toBe(220_699);
    expect(totalXpRequiredToReachLevel(45)).toBe(814_797);
    expect(totalXpRequiredToReachLevel(100)).toBe(12_480_235);
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
