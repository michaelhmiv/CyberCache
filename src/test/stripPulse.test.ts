import { describe, expect, it } from 'vitest';
import {
  createStripPulseTracker,
  PULSE_TINT,
  type StripPulseValues,
} from '@/lib/ui/stripPulse';

const base: StripPulseValues = {
  credits: 1000,
  scrap: 500,
  cacheKey: 2003, // 2 keys + 3 fragments (composite)
  legendaryCore: 1,
  loot: 40,
  level: 12,
};

describe('stripPulse tracker (eye-leading pass, DESIGN.md §10)', () => {
  it('the first observed balance is the baseline and never pulses', () => {
    const tracker = createStripPulseTracker();
    expect(tracker.observe(base, 0, false)).toEqual({});
    // Even a huge first "gain" over nothing stays silent — the
    // wallet arrived; nothing was earned on screen.
    const fresh = createStripPulseTracker();
    expect(fresh.observe({ ...base, credits: 99999 }, 0, false)).toEqual({});
  });

  it('an increase fires a pulse on the changed counter only', () => {
    const tracker = createStripPulseTracker();
    tracker.observe(base, 0, false);
    const fired = tracker.observe({ ...base, scrap: 560 }, 1000, false);
    expect(Object.keys(fired)).toEqual(['scrap']);
    expect(fired.scrap?.tint).toBe(PULSE_TINT.scrap);
  });

  it('a decrease is silent, and a same-value sync is silent', () => {
    const tracker = createStripPulseTracker();
    tracker.observe(base, 0, false);
    expect(tracker.observe({ ...base, credits: 900 }, 1000, false)).toEqual({});
    // Re-observing the settled (lower) balance changes nothing.
    expect(tracker.observe({ ...base, credits: 900 }, 2000, false)).toEqual({});
    // A later real credit back up IS a gain and pulses — the
    // tracker compares against the last observed value, not a
    // high-water mark. (1000 − 900 = the credits floor → full.)
    expect(tracker.observe(base, 3000, false).credits?.tier).toBe('full');
  });

  it('tier selection: absolute floors earn the full beat', () => {
    const tracker = createStripPulseTracker();
    tracker.observe(base, 0, false);
    // +100 credits = the credits floor → full.
    expect(tracker.observe({ ...base, credits: 1100 }, 1000, false).credits?.tier).toBe('full');
    // +49 scrap at a 5,000 balance is under the scrap floor AND
    // under 2% of the new balance (49/5049 ≈ 0.97%) → micro.
    const t2 = createStripPulseTracker();
    t2.observe({ ...base, scrap: 5000 }, 0, false);
    expect(t2.observe({ ...base, scrap: 5049 }, 1000, false).scrap?.tier).toBe('micro');
    // +50 scrap = the scrap floor → full.
    const t3 = createStripPulseTracker();
    t3.observe(base, 0, false);
    expect(t3.observe({ ...base, scrap: 550 }, 1000, false).scrap?.tier).toBe('full');
    // Any key/core/loot/level gain is full by the floor of 1.
    const t4 = createStripPulseTracker();
    t4.observe(base, 0, false);
    const fired = t4.observe({ ...base, cacheKey: 2004, legendaryCore: 2, loot: 41, level: 13 }, 1000, false);
    expect(fired.cacheKey?.tier).toBe('full');
    expect(fired.legendaryCore?.tier).toBe('full');
    expect(fired.loot?.tier).toBe('full');
    expect(fired.level?.tier).toBe('full');
  });

  it('tier selection: ≥2% of the new balance earns full below the absolute floor', () => {
    const tracker = createStripPulseTracker();
    tracker.observe({ ...base, credits: 4000 }, 0, false);
    // +90 credits is under the 100 floor but 90/4090 ≈ 2.2% → full.
    expect(tracker.observe({ ...base, credits: 4090 }, 1000, false).credits?.tier).toBe('full');
    // +10 on 4000 is 0.25% → the roaming drip stays micro.
    const t2 = createStripPulseTracker();
    t2.observe({ ...base, credits: 4000 }, 0, false);
    expect(t2.observe({ ...base, credits: 4010 }, 1000, false).credits?.tier).toBe('micro');
  });

  it('coalescing: a full pulse within 900ms of the last full demotes to micro', () => {
    const tracker = createStripPulseTracker();
    tracker.observe(base, 0, false);
    expect(tracker.observe({ ...base, credits: 1500 }, 1000, false).credits?.tier).toBe('full');
    // 500ms later another full-sized gain → demoted, so bursts flash once.
    expect(tracker.observe({ ...base, credits: 2000 }, 1500, false).credits?.tier).toBe('micro');
    // After the window (from the last FULL, not the demoted one) full returns.
    expect(tracker.observe({ ...base, credits: 2500 }, 2000, false).credits?.tier).toBe('full');
  });

  it('per-counter independence: coalescing and baselines are per counter', () => {
    const tracker = createStripPulseTracker();
    tracker.observe(base, 0, false);
    tracker.observe({ ...base, credits: 1500 }, 1000, false); // credits full @1000
    // Scrap's first full is unaffected by credits' coalesce window.
    const fired = tracker.observe({ ...base, credits: 1500, scrap: 900 }, 1200, false);
    expect(fired.scrap?.tier).toBe('full');
    expect(fired.credits).toBeUndefined();
  });

  it('simultaneous gains each fire with distinct tokens', () => {
    const tracker = createStripPulseTracker();
    tracker.observe(base, 0, false);
    const fired = tracker.observe(
      { ...base, credits: 2000, cacheKey: 3000, scrap: 800 },
      1000,
      false,
    );
    expect(Object.keys(fired).sort()).toEqual(['cacheKey', 'credits', 'scrap']);
    const tokens = Object.values(fired).map((p) => p?.token);
    expect(new Set(tokens).size).toBe(3);
  });

  it('fragments ride the key composite: fragment gain pulses, key spend is silent', () => {
    const tracker = createStripPulseTracker();
    tracker.observe(base, 0, false);
    // 3 → 4 fragments (composite 2003 → 2004) pulses the key segment.
    expect(tracker.observe({ ...base, cacheKey: 2004 }, 1000, false).cacheKey).toBeDefined();
    // 5 fragments rolling into a key (2005 → 3000 net +995 composite) still positive.
    const t2 = createStripPulseTracker();
    t2.observe({ ...base, cacheKey: 2005 }, 0, false);
    expect(t2.observe({ ...base, cacheKey: 3000 }, 1000, false).cacheKey).toBeDefined();
    // Spending a key (3000 → 2000) is a decrease — silent.
    const t3 = createStripPulseTracker();
    t3.observe({ ...base, cacheKey: 3000 }, 0, false);
    expect(t3.observe({ ...base, cacheKey: 2000 }, 1000, false)).toEqual({});
  });

  it('reduced motion marks the pulse still (tint-only collapse)', () => {
    const tracker = createStripPulseTracker();
    tracker.observe(base, 0, false);
    const fired = tracker.observe({ ...base, credits: 1500 }, 1000, true);
    expect(fired.credits?.still).toBe(true);
  });

  it('reset re-baselines: the next balance arrives silently', () => {
    const tracker = createStripPulseTracker();
    tracker.observe(base, 0, false);
    tracker.reset();
    expect(tracker.observe({ ...base, credits: 5000 }, 1000, false)).toEqual({});
    // And gains after the new baseline pulse again.
    expect(tracker.observe({ ...base, credits: 5500 }, 2000, false).credits).toBeDefined();
  });
});
