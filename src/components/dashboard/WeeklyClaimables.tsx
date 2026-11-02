import React, { useEffect } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { motion } from 'framer-motion';
import {
  useStandingStore,
  weeklyClaimables,
  type WeeklyClaimable,
} from '@/store/slices/standingSlice';

/**
 * Weekly claimables (redesign Wave C, DESIGN.md §4/§9) — the
 * weekly Parts Crate + Signature Orders' claim surface on Home.
 *
 * The offers' canonical home is the Rep Desk (Market rail stop);
 * these are the secondary surfaces the surfacing spec assigns to
 * Home: the Weekly panel in the deck (rendered only in its
 * claimable states) and the claim sheet the Strip's weekly chip
 * opens. Both render THIS list from the shared standing mirror —
 * one claim path, the Rep Desk's real ops (standingBuy /
 * standingOrder through the standing slice), never a local award.
 *
 * Guest law: the offers stay VISIBLE to guests with real prices;
 * the lock sits on the claim button itself, never on the panel.
 */

const WEEKLY_ACCENT = '#3FD6E8';

const ClaimRow: React.FC<{ claimable: WeeklyClaimable; guest: boolean }> = ({ claimable, guest }) => {
  const busyKey = useStandingStore((s) => s.busyKey);
  const claim = useStandingStore((s) => s.claim);
  const key = `${claimable.kind}:${claimable.manufacturer}`;
  const busy = busyKey === key;
  const anyBusy = busyKey !== null;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 24, stiffness: 260 }}
      className="flex items-center justify-between gap-2 border border-border bg-bg/70 px-2 py-2"
      data-testid={`weekly-claimable-${key}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 shrink-0" style={{ backgroundColor: claimable.color }} />
          <span className="truncate text-[11px] font-black text-text-primary">
            {claimable.kind === 'crate' ? 'Parts Crate' : 'Signature Order'} — {claimable.makerName}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-text-muted">{claimable.detail}</div>
      </div>
      <button
        type="button"
        disabled={guest || anyBusy}
        onClick={() => void claim(claimable)}
        aria-label={
          guest
            ? `Sign in with Google to claim the ${claimable.makerName} ${claimable.kind === 'crate' ? 'Parts Crate' : 'Signature Order'}`
            : `Claim the ${claimable.makerName} ${claimable.kind === 'crate' ? 'Parts Crate' : 'Signature Order'} for ${claimable.priceCredits} credits`
        }
        className="flex shrink-0 items-center gap-1.5 border border-cyan/50 bg-cyan/10 px-2.5 py-2 text-[11px] font-black text-cyan transition-transform active:scale-[0.97] disabled:opacity-50"
      >
        {guest && <PxIcon name="lock" size={13} />}
        {busy
          ? 'Claiming…'
          : guest
            ? 'Sign in to claim'
            : `Claim • ${claimable.priceCredits.toLocaleString()}cr`}
      </button>
    </motion.div>
  );
};

export const WeeklyClaimablesList: React.FC = () => {
  const view = useStandingStore((s) => s.view);
  const flash = useStandingStore((s) => s.flash);
  const claimables = weeklyClaimables(view);
  const guest = Boolean(view && (view.isGuest || !view.canUsePlayerEconomy));

  if (!view) {
    return <div className="text-[11px] text-text-muted">The Rep Desk has not answered yet.</div>;
  }
  return (
    <div className="space-y-1.5">
      {claimables.length === 0 && (
        <div className="text-[11px] text-text-muted">
          Nothing weekly is waiting right now — claimed crates and orders reset each week at the Rep Desk.
        </div>
      )}
      {claimables.map((claimable) => (
        <ClaimRow
          key={`${claimable.kind}:${claimable.manufacturer}`}
          claimable={claimable}
          guest={guest}
        />
      ))}
      {guest && claimables.length > 0 && (
        <div className="text-[11px] leading-snug text-text-muted">
          Guests can see the weekly offers — claiming one needs Google sign-in, and your guest progress carries over.
        </div>
      )}
      {flash && (
        <div
          className="border px-2 py-1.5 text-[11px]"
          style={{
            borderColor: flash.error ? '#FF5566' : '#5FD95F',
            color: flash.error ? '#FF5566' : '#5FD95F',
          }}
          role="status"
        >
          {flash.text}
        </div>
      )}
    </div>
  );
};

/**
 * The deck panel form: renders ONLY in its claimable states
 * (DESIGN.md §4 — the Weekly panel exists when a crate or order
 * is waiting; an empty week leaves no husk in the deck). Mounting
 * it also performs the session's standing read (deduped by the
 * slice with the claim chip's mount).
 */
export const WeeklyClaimablesPanel: React.FC = () => {
  const view = useStandingStore((s) => s.view);
  const load = useStandingStore((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  if (weeklyClaimables(view).length === 0) return null;
  return (
    <section
      data-testid="weekly-claimables-panel"
      className="relative overflow-hidden border-2 bg-surface/95 p-2 shadow-[0_8px_18px_rgba(0,0,0,0.55)]"
      style={{ borderColor: `${WEEKLY_ACCENT}66` }}
    >
      <div className="relative mb-1.5 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">
        <span className="h-px flex-1 bg-border-light" />
        <span className="flex items-center gap-1.5" style={{ color: WEEKLY_ACCENT }}>
          <PxIcon name="crate" size={13} />
          Weekly Claimables
        </span>
        <span className="h-px flex-1 bg-border-light" />
      </div>
      <WeeklyClaimablesList />
    </section>
  );
};
