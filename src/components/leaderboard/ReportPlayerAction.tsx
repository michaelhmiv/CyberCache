/**
 * ReportPlayerAction — the leaderboard rows' Report control
 * (Build 7 — App Review hardening, Guideline 1.2 insurance).
 *
 * A small flag + label action riding at the row's trailing edge
 * (44dp target, 11px floor, console register). Two taps by design:
 * the first arms the control ("Confirm?"), the second posts
 * POST /api/reports via leaderboardService.reportPlayer with the
 * row's account id — the `player_id` every board payload already
 * carries — and lands the "Reported — thanks." toast. An un-tapped
 * arm falls back to idle on its own. A failed post swaps the label
 * to a plain retry state; no raw server text ever renders here.
 * The viewer's own row never mounts this control (the Chef rejects
 * self-reports anyway; the button simply isn't offered).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, Flag } from 'lucide-react';
import { SheetPortal } from '@/components/common/SheetPortal';
import { reportPlayer } from '@/lib/api/leaderboardService';
import { FAINT, MUT, RED, monoStyle } from './standingsConsoleTokens';

type ReportState = 'idle' | 'confirming' | 'sending' | 'reported' | 'failed';

const ARM_TIMEOUT_MS = 4000;
const FAILED_TIMEOUT_MS = 3000;
const TOAST_MS = 2600;

export const ReportPlayerAction: React.FC<{
  /** The reported account's id — the board entry's `player_id`. */
  reportedAccountId: string;
  username: string | null;
}> = ({ reportedAccountId, username }) => {
  const [state, setState] = useState<ReportState>('idle');
  const [toastVisible, setToastVisible] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const stash = timers.current;
    return () => {
      stash.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const handleTap = () => {
    if (state === 'idle' || state === 'failed') {
      setState('confirming');
      later(() => {
        setState((s) => (s === 'confirming' ? 'idle' : s));
      }, ARM_TIMEOUT_MS);
      return;
    }
    if (state !== 'confirming') return;
    setState('sending');
    reportPlayer(reportedAccountId)
      .then(() => {
        setState('reported');
        setToastVisible(true);
        later(() => setToastVisible(false), TOAST_MS);
      })
      .catch(() => {
        setState('failed');
        later(() => {
          setState((s) => (s === 'failed' ? 'idle' : s));
        }, FAILED_TIMEOUT_MS);
      });
  };

  const label =
    state === 'confirming'
      ? 'Confirm?'
      : state === 'sending'
        ? 'Sending…'
        : state === 'reported'
          ? 'Reported'
          : state === 'failed'
            ? 'Retry?'
            : 'Report';

  return (
    <>
      <button
        type="button"
        data-testid={`standings-report-${reportedAccountId}`}
        aria-label={
          state === 'confirming'
            ? `Confirm report of ${username ?? 'this hunter'}`
            : `Report ${username ?? 'this hunter'}`
        }
        disabled={state === 'sending' || state === 'reported'}
        onClick={(event) => {
          event.stopPropagation();
          handleTap();
        }}
        className="flex min-h-[44px] shrink-0 items-center gap-1 px-2 disabled:opacity-70"
        style={{
          ...monoStyle,
          fontSize: 11,
          color: state === 'confirming' || state === 'failed' ? RED : state === 'reported' ? MUT : FAINT,
        }}
      >
        {state === 'reported' ? <Check size={13} /> : <Flag size={13} />}
        {label}
      </button>
      {toastVisible && (
        <SheetPortal>
          <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex justify-center px-4">
            <div
              role="status"
              data-testid="report-toast"
              className="border-2 border-border bg-bg px-4 py-2.5 text-xs font-black text-text-primary"
            >
              Reported — thanks.
            </div>
          </div>
        </SheetPortal>
      )}
    </>
  );
};
