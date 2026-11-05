import React, { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  formatLoginStreakReward,
  loginStreakPositionFor,
  loginStreakTierMultiplier,
  type LoginStreakReward,
  type LoginStreakStateView,
} from '@/content/loginStreak';
import {
  loginStreakAnnouncement,
  useLoginStreakStore,
} from '@/store/slices/loginStreakSlice';

const STREAK_ACCENT = '#FF8A3D';
const CTA_FILL = '#FF8A00';
const GOLD = '#FFD21F';
const TEAL = '#3FD6E8';
const DARK_TEXT = '#1A1206';

/**
 * The announcement glow (DESIGN.md §10 reclassification): the
 * streak's pulse is NEWS, not a claim signal — it lives on the
 * fresh sheet's medal (and its CTA) only until acknowledged.
 * Same cadence as the claim row's PulseGlow; reduced motion
 * gets the static ring.
 */
function MedalGlow() {
  const reduceMotion = useReducedMotion();
  const shadow = `0 0 14px ${STREAK_ACCENT}99, inset 0 0 0 1px ${STREAK_ACCENT}`;
  if (reduceMotion) {
    return (
      <span
        data-testid="streak-medal-glow"
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: shadow }}
      />
    );
  }
  return (
    <motion.span
      data-testid="streak-medal-glow"
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ boxShadow: shadow }}
      animate={{ opacity: [1, 0.35, 1] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

interface RewardRow {
  icon: 'coin' | 'frag' | 'key';
  tint: string;
  amount: number;
  unit: string;
  tag: string;
  flare: boolean;
}

/** Poster rows for a reward: one row per resource actually in
 *  it, icon at door size, amount as the hero number, the word
 *  Banked riding every line (the money already moved) — the
 *  cache key's tag is the design's one line of ceremony. */
function rewardRows(reward: { credits: number; cacheKeys: number }): RewardRow[] {
  const rows: RewardRow[] = [];
  if (reward.credits > 0) {
    rows.push({ icon: 'coin', tint: GOLD, amount: reward.credits, unit: 'Credits', tag: 'Banked', flare: false });
  }
  if (reward.cacheKeys > 0) {
    rows.push({ icon: 'key', tint: TEAL, amount: reward.cacheKeys, unit: 'Cache key', tag: 'Cycle prize', flare: true });
  }
  return rows;
}

/** "+500 credits · +1 cache key" — past-tense
 *  amounts for the claimed state's fact lines, each amount in
 *  the gain green (the mock's fact-line language). */
function plusReward(reward: LoginStreakReward): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const push = (amount: number, unit: string) =>
    parts.push(
      <span key={unit}>
        <span className="text-green">+{amount}</span> {unit}
      </span>,
    );
  if (reward.credits > 0) push(reward.credits, reward.credits === 1 ? 'credit' : 'credits');
  if (reward.cacheKeys > 0) push(reward.cacheKeys, reward.cacheKeys === 1 ? 'cache key' : 'cache keys');
  return parts.flatMap((part, i) => (i === 0 ? [part] : [' · ', part]));
}

/** Ladder cell reward lines in the track's short stacked form
 *  ("500 cr" / "3 frag" / "KEY") — stacked, never shrunk, so a
 *  multi-part reward fits its cell at the 11px floor (D5). */
function ladderLines(day: LoginStreakReward): string[] {
  const lines: string[] = [];
  if (day.credits > 0) lines.push(`${day.credits} cr`);
  if (day.cacheKeys > 0) lines.push('KEY');
  return lines;
}

/** The 7-day ladder as a track: earned days checked, today
 *  filled solid, every reward line at the type floor. */
function StreakLadder({ view }: { view: LoginStreakStateView }) {
  return (
    <div className="grid grid-cols-7 gap-1.5" aria-label="Seven day streak ladder">
      {view.ladder.map((day) => {
        const isToday = day.state === 'today';
        const earned = day.state === 'earned';
        return (
          <div
            key={day.cycleDay}
            className="flex min-h-[68px] flex-col items-center border-2 border-border-light bg-surface px-0.5 py-1.5 text-center"
            style={{
              backgroundColor: isToday ? STREAK_ACCENT : earned ? 'rgba(255,138,61,0.17)' : undefined,
              borderColor: isToday ? STREAK_ACCENT : earned ? 'rgba(255,138,61,0.4)' : undefined,
              color: isToday ? DARK_TEXT : undefined,
            }}
          >
            <div
              className="text-[11px] font-bold uppercase leading-tight"
              style={{ color: isToday ? DARK_TEXT : '#9A8A6E' }}
            >
              Day {day.cycleDay}
            </div>
            {ladderLines(day).map((line) => (
              <div
                key={line}
                className="text-[11px] font-semibold leading-[1.45]"
                style={{ color: isToday ? DARK_TEXT : earned ? '#F5ECDA' : '#C2B096' }}
              >
                {line}
              </div>
            ))}
            {earned && (
              <div className="mt-auto flex justify-center pt-0.5" style={{ color: STREAK_ACCENT }}>
                <PxIcon name="check" size={13} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A fact line in the sheet's Next/Today form: dim key at the
 *  left, the fact set bold at the right. */
function FactLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-2 border-border-light bg-surface px-2.5 py-2">
      <span className="shrink-0 text-[11px] font-bold uppercase text-text-muted">{label}</span>
      <span className="text-right text-xs font-bold text-text-primary">{children}</span>
    </div>
  );
}

/**
 * Login streak panel — the daily check-in sheet (0036),
 * rebuilt as the Poster Plate (impeccable direction A, owner
 * pick 2026-11-03) with the streak audit's defects D1–D7
 * answered in the same slice.
 *
 * The flow truth has not changed: there is NO claim action.
 * The check-in is the state read itself — GET /api/login-streak/me
 * records the first authenticated check-in of the UTC day
 * server-side and banks the ladder reward exactly once, before
 * this sheet is ever opened. Everything rendered is the Chef's
 * state view; the client computes no streak, no day, no amount.
 *
 * What the rebuild changes is the sheet's honesty and hierarchy:
 *
 *  - FRESH GRANT (this session's read created today's grant,
 *    not yet acknowledged): the celebration — DAY poster plate,
 *    reward rows at hero size tagged Banked, the medal and the
 *    CTA carrying the announcement glow, reward rows landing
 *    staggered with the key row flaring once. The CTA is the
 *    acknowledgement: "Back to the hunt" claims nothing — it
 *    says *seen*, ends the celebration, and kills the pill's
 *    announcement for the session (D1, D2, D7).
 *  - ALREADY CLAIMED (or the fresh grant, acknowledged): the
 *    quiet sheet — the plate turns forward, two fact lines
 *    (Tomorrow / Today banked), the same ladder, a quiet CTA.
 *    Zero pulses, zero badges: there is nothing to announce
 *    and nothing to do.
 *  - CHEF UNREACHABLE: renders nothing — absence by design.
 *
 * There is no 'pending' presentation (D6): the shipped route
 * records before it reads, so a held result is always earned.
 * The day boundary is stated in words on the sheet — a new
 * streak day starts at 00:00 UTC.
 *
 * The read lives in the shared login-streak store: the
 * Dashboard mount performs it (the check-in is never gated on
 * opening this sheet), this panel's mount revalidates it when
 * a live session has crossed the UTC boundary (D3), and the
 * grant's profile sync happens once, in the store.
 */
export const LoginStreakPanel: React.FC<{ onDone?: () => void }> = ({ onDone }) => {
  const result = useLoginStreakStore((s) => s.result);
  const resultDay = useLoginStreakStore((s) => s.resultDay);
  const seenGrantKey = useLoginStreakStore((s) => s.seenGrantKey);
  const acknowledge = useLoginStreakStore((s) => s.acknowledge);
  const load = useLoginStreakStore((s) => s.load);
  const revalidate = useLoginStreakStore((s) => s.revalidate);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    void load();
    void revalidate();
  }, [load, revalidate]);

  if (!result) return null;
  const view = result.loginStreak;
  const granted = result.granted;
  const fresh = loginStreakAnnouncement(result, resultDay, seenGrantKey);

  const nextPosition = loginStreakPositionFor(view.nextStreakLength);
  const opensTier = nextPosition.tier > view.tier;
  const cycleComplete = view.cycleDay >= 7;

  const heroDay = fresh || !cycleComplete ? (granted.cycleDay ?? view.cycleDay) : null;
  const rows = rewardRows({
    credits: granted.creditsAwarded,
    cacheKeys: granted.cacheKeysAwarded,
  });

  const handleDone = () => {
    if (fresh) acknowledge();
    onDone?.();
  };

  return (
    <div data-testid="streak-panel" className="space-y-3">
      {/* The poster plate: medal, the day as headline, the
          streak count as the poster numeral. In the claimed
          state at cycle's end the plate turns forward to the
          tier that opens next. */}
      <div
        data-testid="streak-hero"
        className="flex items-center gap-3.5 border-2 bg-surface-raised px-3.5 py-3"
        style={{ borderColor: fresh ? STREAK_ACCENT : 'rgba(255,138,61,0.4)' }}
      >
        <div
          className="relative shrink-0 border-2 border-border-light bg-black/50 p-2"
          style={{ color: STREAK_ACCENT }}
        >
          <PxIcon name="flame" size={40} />
          {fresh && <MedalGlow />}
        </div>
        <div className="min-w-0">
          {!fresh && cycleComplete ? (
            <>
              <div className="bl-title text-[46px] leading-[0.95] text-text-primary">
                Tier {nextPosition.tier}
              </div>
              <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-text-muted">
                Opens on streak day {view.nextStreakLength}
              </div>
            </>
          ) : (
            <>
              <div className="bl-title text-[46px] leading-[0.95] text-text-primary">
                Day {heroDay}
              </div>
              {fresh ? (
                cycleComplete ? (
                  <span
                    className="mt-1 inline-block px-1.5 py-0.5 text-[11px] font-bold uppercase leading-none text-black"
                    style={{ backgroundColor: STREAK_ACCENT }}
                  >
                    Cycle complete
                  </span>
                ) : (
                  <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-text-muted">
                    Granted on arrival
                  </div>
                )
              ) : (
                <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-text-muted">
                  Banked today
                </div>
              )}
            </>
          )}
        </div>
        <div className="ml-auto shrink-0 text-right">
          <div className="bl-title text-[40px] leading-none" style={{ color: STREAK_ACCENT }}>
            {view.currentStreak}
          </div>
          <div className="text-[11px] font-bold uppercase text-text-muted">Day streak</div>
        </div>
      </div>

      {fresh ? (
        <>
          {/* The reward, at the size the numbers law demands:
              rows land one at a time (~120ms apart), the key
              row flares once — a tier below the loot moment. */}
          <div data-testid="streak-reward-rows">
            {rows.map((row, i) => (
              <motion.div
                key={row.unit}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.12, duration: 0.25 }}
                className="relative flex items-center gap-3 border-b border-border-light/60 px-1 py-2.5 last:border-b-0"
              >
                <PxIcon name={row.icon} size={26} style={{ color: row.tint }} />
                <span className="text-[34px] font-bold leading-none tabular-nums text-green">
                  +{row.amount}
                </span>
                <span className="text-[13px] font-semibold uppercase tracking-wide text-text-primary">
                  {row.unit}
                </span>
                <span className="ml-auto text-[11px] font-bold uppercase text-text-muted">
                  {row.tag}
                </span>
                {row.flare && !reduceMotion && (
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute inset-0"
                    initial={{ boxShadow: 'inset 0 0 0 0 rgba(63,214,232,0)' }}
                    animate={{
                      boxShadow: [
                        'inset 0 0 0 0 rgba(63,214,232,0)',
                        'inset 0 0 0 2px rgba(63,214,232,0.9)',
                        'inset 0 0 0 2px rgba(63,214,232,0)',
                      ],
                    }}
                    transition={{ delay: 0.15 + rows.length * 0.12 + 0.1, duration: 0.9, times: [0, 0.35, 1] }}
                  />
                )}
              </motion.div>
            ))}
          </div>

          <StreakLadder view={view} />

          <FactLine label="Next">
            {opensTier ? (
              <>
                Streak day {view.nextStreakLength} opens{' '}
                <span className="text-green">Tier {nextPosition.tier}</span> —{' '}
                {formatLoginStreakReward(view.nextReward)}
              </>
            ) : (
              <>Streak day {view.nextStreakLength} — {formatLoginStreakReward(view.nextReward)}</>
            )}
          </FactLine>
        </>
      ) : (
        <>
          <FactLine label="Tomorrow">
            Day {view.nextStreakLength} — {plusReward(view.nextReward)}
            {opensTier && <> · ladder pays ×{loginStreakTierMultiplier(nextPosition.tier)}</>}
          </FactLine>
          {view.todayReward && (
            <FactLine label="Today">Banked {plusReward(view.todayReward)}</FactLine>
          )}

          <StreakLadder view={view} />
        </>
      )}

      {/* The exit is the acknowledgement: in the fresh state it
          carries the announcement glow because tapping it is
          what ends the announcement. It claims nothing — the
          reward banked before this sheet opened. */}
      {fresh ? (
        <motion.button
          type="button"
          data-testid="streak-done-button"
          onClick={handleDone}
          className="w-full px-4 py-3 text-[15px] font-bold uppercase tracking-wide text-black"
          style={{ backgroundColor: CTA_FILL, boxShadow: '0 0 16px rgba(255,138,0,0.6), inset 0 0 0 2px #FFA01F' }}
          animate={
            reduceMotion
              ? undefined
              : {
                  boxShadow: [
                    '0 0 16px rgba(255,138,0,0.6), inset 0 0 0 2px #FFA01F',
                    '0 0 6px rgba(255,138,0,0.25), inset 0 0 0 2px #FFA01F',
                    '0 0 16px rgba(255,138,0,0.6), inset 0 0 0 2px #FFA01F',
                  ],
                }
          }
          transition={reduceMotion ? undefined : { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          Back to the hunt
        </motion.button>
      ) : (
        <button
          type="button"
          data-testid="streak-done-button"
          onClick={handleDone}
          className="w-full bg-transparent px-4 py-3 text-[15px] font-bold uppercase tracking-wide text-amber"
          style={{ boxShadow: 'inset 0 0 0 2px #453218' }}
        >
          Back to the hunt
        </button>
      )}

      <div className="text-center text-[11px] leading-snug text-text-muted">
        <div>{view.missRule}</div>
        <div>A new streak day starts at 00:00 UTC.</div>
      </div>
    </div>
  );
};
