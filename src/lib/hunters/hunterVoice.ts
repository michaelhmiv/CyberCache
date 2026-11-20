import type { HunterId } from './hunters';

/**
 * Hunter voice pools (Cache Hunters slice (c), brief §2.6).
 *
 * COPY STATUS: FINAL — owner-approved v2 (2026-11-15). The first
 * draft was vetoed on sight ("stupid — need to be more clever
 * and witty"); the rewrite (prep: cache-hunters/voice-lines-v2.md)
 * was approved as written ("That's good", no vetoes) and the
 * lines below are those mains verbatim. The file's legendary-drop
 * alternates are spares and are deliberately NOT wired — the
 * pools stay at one line per hunter × trigger. Any future copy
 * change must still pass the C7 census: fixed pools, 3–4 lines
 * per hunter, every line bound to exactly one trigger from the
 * closed list.
 *
 * The law the mechanism enforces (brief §2.6 + dosage floor 11):
 *  - FIXED pools. No generation, no rotation-in of new lines, no
 *    frequency scaling: a line fires when its triggering fact
 *    stands in decided state, and only then.
 *  - Closed trigger list: legendary drop · boss kill · near-death
 *    save · streak complete. Nothing fires on per-tick staples,
 *    common drops, or ordinary kills.
 *  - Silence at defeat and death: the callers gate on the decided
 *    state (a victory finish, a survival record that leaves the
 *    hunter alive); this module additionally refuses to fire a
 *    second line inside the moment window below.
 *  - No repeat within a session: for a hunter + trigger, a fired
 *    line does not repeat while an unfired line for that trigger
 *    remains (the vendor counter rotation in marlaVoice.ts is
 *    the house pattern: session state is module-level).
 *  - One moment never carries two lines: a fired moment key can
 *    never fire again (any trigger, any surface — the DOM and
 *    Pixi stages both mount voice watchers during the renderer
 *    cover window, and the moment key is derived from the shared
 *    decided state, so both watchers compute the SAME key and
 *    exactly one wins), and a second trigger inside
 *    VOICE_MOMENT_WINDOW_MS of a fired line is the same moment
 *    cluster (one claim batch, one beat) and stays silent.
 *
 * Presentation only — this module reads nothing and mutates no
 * gameplay state; the watchers in HunterVoiceChip.tsx feed it
 * facts the Chef already decided.
 */
export type HunterVoiceTrigger = 'legendaryDrop' | 'bossKill' | 'nearDeathSave' | 'streakComplete';

export const HUNTER_VOICE_TRIGGERS: readonly HunterVoiceTrigger[] = [
  'legendaryDrop',
  'bossKill',
  'nearDeathSave',
  'streakComplete',
];

/** One moment cluster: a second trigger landing inside this
 *  window of a fired line belongs to the same moment and does
 *  not carry a second line. Sized to the chip's own display
 *  lifetime (HunterVoiceChip shows a line for 3.4 s). */
export const VOICE_MOMENT_WINDOW_MS = 3000;

/**
 * The pools — owner-approved v2 copy (see header). One line per
 * hunter × trigger (4 lines per hunter, the C7 census bound);
 * the legendary-drop alternates in the v2 file are spares and
 * stay unwired.
 */
export const HUNTER_VOICE_POOLS: Record<HunterId, Record<HunterVoiceTrigger, readonly string[]>> = {
  vesper: {
    legendaryDrop: ['The cache owes her an arm. It pays in installments.'],
    bossKill: ['Long odds? She collects on those.'],
    nearDeathSave: ["Half of her is loot. Loot doesn't die, it drops."],
    streakComplete: ["Luck is just counting that hasn't been caught."],
  },
  silas: {
    legendaryDrop: ['It was ticking. He respects a colleague.'],
    bossKill: ['It had a fuse. To him, everything does.'],
    nearDeathSave: ['Almost defused. He took it personally.'],
    streakComplete: ["Controlled burn! Even the control's on fire!"],
  },
  josie: {
    legendaryDrop: ['Appraisal: priceless. Decision: bin.'],
    bossKill: ["It wouldn't fit in the bin. It does now."],
    nearDeathSave: ['She nearly became inventory. She hates competition.'],
    streakComplete: ["Streak complete. She's started a second bin."],
  },
  doc: {
    legendaryDrop: ['New part. He means the weapon. Probably.'],
    bossKill: ['Pre-existing conditions—he checked. Case closed!'],
    nearDeathSave: ['Self-repair complete. The patient is ungrateful.'],
    streakComplete: ["Production is up. He's the factory and the union."],
  },
};

// ── Session rotation state (module-level, per hunter + trigger) ──
const firedLineIndexes = new Map<string, Set<number>>();
const lastLineIndex = new Map<string, number>();
const firedMoments = new Set<string>();
let lastFiredAtMs: number | null = null;

function poolKey(hunterId: HunterId, trigger: HunterVoiceTrigger): string {
  return `${hunterId}:${trigger}`;
}

/** The next line for a hunter + trigger under the no-repeat
 *  rotation (no repeat while an unfired line remains; on
 *  exhaustion the pool resets, never immediately repeating the
 *  last line shown when the pool has more than one). Exported
 *  for the rotation unit tests; stage code fires through
 *  fireHunterVoiceLine. */
export function nextHunterVoiceLine(hunterId: HunterId, trigger: HunterVoiceTrigger): string {
  const pool = HUNTER_VOICE_POOLS[hunterId][trigger];
  const key = poolKey(hunterId, trigger);
  let fired = firedLineIndexes.get(key);
  if (!fired) {
    fired = new Set<number>();
    firedLineIndexes.set(key, fired);
  }
  if (fired.size >= pool.length) fired.clear();
  const last = lastLineIndex.get(key) ?? -1;
  const remaining = pool
    .map((_, i) => i)
    .filter((i) => !fired.has(i) && !(fired.size === 0 && pool.length > 1 && i === last));
  const pick = remaining[Math.floor(Math.random() * remaining.length)];
  fired.add(pick);
  lastLineIndex.set(key, pick);
  return pool[pick];
}

/**
 * Fire a voice line for a decided moment. Returns the line to
 * render, or null when the moment must stay silent:
 *  - the moment key already fired (any trigger, any surface), or
 *  - another line fired inside the moment window (one moment
 *    never carries two lines).
 * `momentKey` MUST be derived from the shared decided state (the
 * tick event id, the claim's grant key, the survival record's
 * adrenaline expiry, the fight's finish stamp) so every mounted
 * watcher computes the same key for the same moment.
 */
export function fireHunterVoiceLine(
  hunterId: HunterId,
  trigger: HunterVoiceTrigger,
  momentKey: string,
  nowMs: number,
): string | null {
  if (firedMoments.has(momentKey)) return null;
  if (lastFiredAtMs !== null && nowMs - lastFiredAtMs < VOICE_MOMENT_WINDOW_MS) return null;
  firedMoments.add(momentKey);
  lastFiredAtMs = nowMs;
  return nextHunterVoiceLine(hunterId, trigger);
}

/** Test hook: forget this session's rotation + moment state. */
export function resetHunterVoiceSession(): void {
  firedLineIndexes.clear();
  lastLineIndex.clear();
  firedMoments.clear();
  lastFiredAtMs = null;
}
