import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import type { StandingsBadge } from './standingsBadge';

/**
 * Standings door (redesign v2, DESIGN.md §3 Hunter) — the badged
 * door on the Hunter Profile stop that replaces the retired Rank
 * tab's ambient visibility. The badge itself (settled race
 * earnings, ends-soon, active drop-luck buff) derives from the real
 * weekly payload in standingsBadge.ts; this component only prints
 * what it is given — no pills without data behind them.
 *
 * The earnings pill is a NOTICE, not a claim prompt: weekly race
 * rewards pay out automatically at settlement, so the pill speaks
 * in the past tense ("race rewards earned") and carries NO claim
 * pulse — the pulse is reserved for actions the player can actually
 * take (§10). It prints only while the earnings are unseen; the
 * "Your Weekly Earnings" panel at the top of Standings is its
 * destination, and viewing the panel clears it.
 */

const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const StandingsDoor: React.FC<{
  badge: StandingsBadge;
  onOpen: () => void;
}> = ({ badge, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    data-testid="standings-door"
    className="bl-card flex w-full items-center gap-3 p-3 text-left transition-transform active:scale-[0.98]"
    style={{ borderLeftColor: '#FF9000', borderLeftWidth: 5 }}
  >
    <div className="bl-icon-plate flex h-11 w-11 shrink-0 items-center justify-center bg-amber/15 text-amber">
      <PxIcon name="flag" size={26} />
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-[15px] font-black uppercase tracking-wide text-text-primary">
        Standings
      </div>
      <div className="text-[11px] leading-snug text-text-muted">
        Weekly races · all-time leaderboards
        {badge.endsAt && !badge.endsSoon && <> · week closes {shortDay(badge.endsAt)}</>}
      </div>
      {(badge.unseenEarningsCount > 0 || badge.endsSoon || badge.buff) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {badge.unseenEarningsCount > 0 && (
            <span
              data-testid="standings-earnings-pill"
              className="relative inline-flex items-center gap-1 border border-amber/60 bg-amber/15 px-1.5 py-0.5 text-[11px] font-black text-amber"
            >
              <PxIcon name="trophy" size={13} />
              {badge.unseenEarningsCount} race {badge.unseenEarningsCount === 1 ? 'reward' : 'rewards'} earned
            </span>
          )}
          {badge.endsSoon && badge.endsAt && (
            <span
              data-testid="standings-ends-soon-pill"
              className="inline-flex items-center gap-1 border border-red/60 bg-red/10 px-1.5 py-0.5 text-[11px] font-black text-red"
            >
              <PxIcon name="clock" size={13} />
              Ends soon · {shortDay(badge.endsAt)}
            </span>
          )}
          {badge.buff && (
            <span
              data-testid="standings-buff-pill"
              className="inline-flex items-center gap-1 border border-green/50 bg-green/10 px-1.5 py-0.5 text-[11px] font-black text-green"
            >
              <PxIcon name="burst" size={13} />
              Drop luck +{Math.round(badge.buff.bonus * 100)}%
            </span>
          )}
        </div>
      )}
    </div>
    <PxIcon name="chevR" size={17} className="shrink-0 text-text-muted" />
  </button>
);
