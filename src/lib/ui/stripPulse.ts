/**
 * stripPulse — the Strip's pulse-on-increase engine (eye-leading
 * pass, 2026-11-04; DESIGN.md §10). Pure and framework-free: the
 * ResourceBar feeds it the counted values it prints on every
 * authoritative sync, and it answers with the pulses that fire.
 *
 * The law, from the feedback-legibility pass (owner-approved):
 * when a counted value RISES, its digits flash the gain green and
 * pop once while a glow in the resource's own §5 wallet tint
 * blooms and dies behind them. The layout never changes — the
 * beat rides the existing number (transform + color + shadow
 * only). Two salience tiers keep the beat honest at idle-game
 * rates:
 *
 *  - FULL — a gain that matters: per-resource absolute floor
 *    (PULSE_FULL_DELTA), or ≥ 2% of the new balance for the two
 *    flow currencies (credits/scrap). The bigger pop, ~0.6s.
 *  - MICRO — the roaming drip (~every 3s, small change): a
 *    shorter, smaller pulse, ~0.4s. A full pulse within the
 *    900ms coalesce window after the last full one on the same
 *    counter is demoted to micro, so a burst of gains flashes
 *    once, not strobes.
 *
 * Decreases never pulse: spending is the player's own act,
 * already confirmed by the sheet in front of them, and a red
 * flash would read as punishment. Same-value syncs are silent.
 * The first real balance after profile load is the baseline and
 * never pulses — nothing was earned, the wallet just arrived.
 *
 * Fragments ride the key segment through a composite count
 * (keys × 1000 + fragments) built by the caller: a fragment
 * gain pulses the segment, five fragments rolling into a key
 * still nets positive, and spending a key nets negative
 * (silent).
 *
 * `still` is the reduced-motion collapse: the pulse becomes the
 * tint alone (green hold, no scale) — the gain still reads,
 * nothing travels (DESIGN.md §10's collapse rule).
 */

export type StripPulseId =
  | 'credits'
  | 'scrap'
  | 'cacheKey'
  | 'legendaryCore'
  | 'loot'
  | 'level';

export type PulseTier = 'micro' | 'full';

export interface ValuePulse {
  /** Monotonic render key — each fired pulse remounts its beat. */
  token: number;
  tier: PulseTier;
  /** The resource's §5 wallet tint, bloomed behind the digits. */
  tint: string;
  /** Reduced motion: tint-only pulse, no scale. */
  still: boolean;
}

export type StripPulseValues = Record<StripPulseId, number>;
export type StripPulseMap = Partial<Record<StripPulseId, ValuePulse>>;

/** Gain green — positive deltas only (DESIGN.md §5 data colors). */
export const GAIN_GREEN = '#5FD95F';
/** The Strip's digit ink at rest; the pulse decays back to it. */
export const STRIP_INK = '#F5ECDA';

/** §5 wallet tints, one per pulsed counter. */
export const PULSE_TINT: Record<StripPulseId, string> = {
  credits: '#FFD21F',
  scrap: '#FF8A3D',
  cacheKey: '#3FD6E8',
  legendaryCore: '#FFA01F',
  loot: '#5FD95F',
  level: '#FFA01F',
};

/** Absolute delta at/above which a gain earns the full beat. */
export const PULSE_FULL_DELTA: Record<StripPulseId, number> = {
  credits: 100,
  scrap: 50,
  cacheKey: 1,
  legendaryCore: 1,
  loot: 1,
  level: 1,
};

/** A full pulse inside this window after the last full demotes to micro. */
export const PULSE_COALESCE_MS = 900;

const PULSE_IDS = Object.keys(PULSE_TINT) as StripPulseId[];

/**
 * Stateful tracker — one per Strip mount. `observe` is called
 * with the authoritative values on every render-driving sync;
 * it returns the pulses fired by THIS observation (empty when
 * nothing rose). `reset` re-baselines (profile unload), so the
 * next loaded balance arrives silently again.
 */
export interface StripPulseTracker {
  observe: (values: StripPulseValues, now: number, still: boolean) => StripPulseMap;
  reset: () => void;
}

export function createStripPulseTracker(): StripPulseTracker {
  let prev: StripPulseValues | null = null;
  const lastFullAt: Partial<Record<StripPulseId, number>> = {};
  let token = 0;

  return {
    observe(values, now, still) {
      const baseline = prev;
      prev = { ...values };
      if (!baseline) return {};
      const fired: StripPulseMap = {};
      for (const id of PULSE_IDS) {
        const delta = values[id] - baseline[id];
        if (delta <= 0) continue;
        let full =
          delta >= PULSE_FULL_DELTA[id] ||
          ((id === 'credits' || id === 'scrap') && values[id] > 0 && delta / values[id] >= 0.02);
        if (full && now - (lastFullAt[id] ?? -Infinity) < PULSE_COALESCE_MS) full = false;
        if (full) lastFullAt[id] = now;
        token += 1;
        fired[id] = { token, tier: full ? 'full' : 'micro', tint: PULSE_TINT[id], still };
      }
      return fired;
    },
    reset() {
      prev = null;
    },
  };
}
