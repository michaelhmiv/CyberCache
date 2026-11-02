import React, { useEffect } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';
import { formatLoginStreakReward, type LoginStreakReward } from '@/content/loginStreak';
import { useLoginStreakStore } from '@/store/slices/loginStreakSlice';

const STREAK_ACCENT = '#FF8A3D';

/** Reward parts as stacked micro-lines (never ellipsized).
 *  Audit COPY-02: units spelled out — this panel is a first-run
 *  surface and "cr"/"frag" are never defined for a new player. */
function rewardLines(reward: LoginStreakReward): string[] {
  const lines: string[] = [];
  if (reward.credits > 0) lines.push(`${reward.credits} ${reward.credits === 1 ? 'credit' : 'credits'}`);
  if (reward.fragments > 0) lines.push(`${reward.fragments} ${reward.fragments === 1 ? 'fragment' : 'fragments'}`);
  if (reward.cacheKeys > 0) lines.push(reward.cacheKeys === 1 ? 'cache key' : `${reward.cacheKeys} cache keys`);
  return lines;
}

/**
 * Login streak panel — the daily check-in surface (0036).
 *
 * The daily flow in this game is session start → offline
 * settlement → Dashboard; there is no daily claim button. The
 * check-in is the state read itself: GET /api/login-streak/me
 * records the first authenticated check-in of the UTC day
 * server-side and grants the ladder reward exactly once.
 *
 * Dashboard-top redesign (2026-11-01): the read lives in the
 * shared login-streak store now, because the Dashboard's streak
 * ICON performs it on Dashboard mount — the check-in must never
 * be gated on opening this panel's pop-up — and this panel (in
 * the pop-up, and on the Leaderboards guest preview) renders
 * the store's state. Mounting here still triggers the load when
 * nothing has loaded yet (the Leaderboards preview path), and
 * the grant's profile sync happens once, in the store's load.
 * Everything rendered is the Chef's state view — the client
 * computes no streak, no day, and no amount. Renders nothing
 * until the Chef answers, so an unreachable Chef simply omits
 * the panel.
 */
export const LoginStreakPanel: React.FC = () => {
  const result = useLoginStreakStore((s) => s.result);
  const load = useLoginStreakStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (!result) return null;
  const view = result.loginStreak;
  const granted = result.granted;
  const justClaimed = !granted.alreadyClaimed && granted.streakLength !== null;

  return (
    <MobileCard className="space-y-3" rarityColor={STREAK_ACCENT} glow={view.currentStreak > 0}>
      <div className="flex items-center gap-2">
        <PxIcon name="flame" size={17} style={{ color: STREAK_ACCENT }} />
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Login Streak</div>
        <div className="ml-auto flex items-baseline gap-1">
          <span className="text-lg font-black" style={{ color: STREAK_ACCENT }}>{view.currentStreak}</span>
          <span className="text-[10px] font-bold uppercase text-text-muted">
            {view.currentStreak === 1 ? 'day' : 'days'}
          </span>
        </div>
      </div>

      {justClaimed && (
        <div
          className="rounded px-2 py-1.5 text-[11px] font-bold"
          style={{ backgroundColor: `${STREAK_ACCENT}22`, color: STREAK_ACCENT }}
        >
          Day {granted.streakLength} claimed: {formatLoginStreakReward({
            cycleDay: granted.cycleDay ?? view.cycleDay,
            tier: granted.tier ?? view.tier,
            credits: granted.creditsAwarded,
            fragments: granted.fragmentsAwarded,
            cacheKeys: granted.cacheKeysAwarded,
          })}
        </div>
      )}

      <div className="flex justify-between text-[10px] text-text-muted">
        <span>
          {view.todayState === 'earned'
            ? `Day ${view.cycleDay} of ${view.tier > 1 ? `Tier ${view.tier} ` : ''}claimed today`
            : 'Today’s reward is waiting — it lands on check-in'}
        </span>
        <span>Best {view.longestStreak}</span>
      </div>

      <div className="grid grid-cols-7 gap-1" aria-label="Seven day streak ladder">
        {view.ladder.map((day) => {
          const isToday = day.state === 'today';
          const earned = day.state === 'earned';
          return (
            <div
              key={day.cycleDay}
              className="rounded px-1 py-1.5 text-center"
              style={{
                backgroundColor: isToday
                  ? STREAK_ACCENT
                  : earned
                    ? `${STREAK_ACCENT}33`
                    : 'rgba(255,255,255,0.05)',
                color: isToday ? '#1A1206' : undefined,
              }}
            >
              <div
                className="text-[9px] font-black uppercase"
                style={{ color: isToday ? '#1A1206' : '#9CA3AF' }}
              >
                Day {day.cycleDay}
              </div>
              {rewardLines(day).map((line) => (
                <div
                  key={line}
                  className="text-[10px] font-bold leading-tight"
                  style={{ color: isToday ? '#1A1206' : earned ? STREAK_ACCENT : '#D1D5DB' }}
                >
                  {line}
                </div>
              ))}
              {day.state === 'earned' && (
                <div className="flex" style={{ color: STREAK_ACCENT }}><PxIcon name="check" size={13} /></div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-between text-[10px] text-text-muted">
        <span>
          Next: streak day {view.nextStreakLength} — {formatLoginStreakReward(view.nextReward)}
        </span>
        {view.tier > 1 && <span>Tier {view.tier} cycle</span>}
      </div>
      <div className="text-[10px] text-text-muted">{view.missRule}</div>
    </MobileCard>
  );
};
