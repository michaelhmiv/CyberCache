import { useCallback, useState } from 'react';
import {
  needsHunterPick,
  shouldShowHunterPick,
  type AccountState,
} from './accountState';

/**
 * Starting-hunter pick orchestration (Cache Hunters slice (e),
 * brief §4(e) — the audit G-F5 pattern: play first, prompt when
 * it matters, never wall the player out of the game).
 *
 * A new account fields the resolved default hunter (Vesper
 * Cole) from its first tick — the pick is an invitation, not a
 * gate. The invitation has exactly two doors:
 *
 * - Boot invitation: offered once per session, and only when
 *   the last deferral is at least 24h old (or never happened) —
 *   the hunter-name invitation's cadence, mirrored.
 * - The Roster stop: a deferred pick resurfaces IN PLACE at the
 *   Hunter tab's Roster door (the pick head on RosterPanel) and
 *   completes there by fielding any hunter. No modal ever
 *   re-interrupts play to ask again.
 *
 * Deferring ("Not now") records a timestamp in localStorage — a
 * client-only nag cadence; no progression depends on it.
 * Completing the pick ends eligibility through the account
 * state itself: fielding stamps profiles.active_hunter_id
 * server-side, the refreshed account state carries
 * hasHunterPick, and needsHunterPick goes false for good —
 * on every device, and across a guest→Google upgrade (E3).
 */

export const HUNTER_PICK_DEFERRED_AT_KEY = 'cybercache.hunterPick.deferredAt';

function readDeferredAt(): number | null {
  try {
    const raw = window.localStorage.getItem(HUNTER_PICK_DEFERRED_AT_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeDeferredAt(at: number): void {
  try {
    window.localStorage.setItem(HUNTER_PICK_DEFERRED_AT_KEY, String(at));
  } catch {
    // Storage unavailable (private mode / WebView quota): the
    // per-session settled flag still stops the re-ask this session.
  }
}

export interface HunterPick {
  /** Whether the boot invitation is currently open. */
  prompt: boolean;
  /** "Not now": close the invitation and record the deferral. */
  deferPrompt: () => void;
  /** The pick completed (a hunter was fielded): close the invitation. */
  completePrompt: () => void;
}

export function useHunterPick(account: AccountState | null): HunterPick {
  const needed = needsHunterPick(account);
  const [prompt, setPrompt] = useState(false);
  const [bootSettled, setBootSettled] = useState(false);

  // The settled flag is per-account: a different account signing
  // in on the same device/session starts with a clean slate (the
  // cross-account residue class audit A-08 burned us on). This is
  // a render-phase adjustment, the shell's established pattern.
  const userId = account?.userId ?? null;
  const [seenUserId, setSeenUserId] = useState<string | null>(userId);
  if (userId !== seenUserId) {
    setSeenUserId(userId);
    setBootSettled(false);
    setPrompt(false);
  }

  // Boot invitation: decide once per session per account, as a
  // render-phase adjustment like the account reset above (an
  // effect that only mirrors this decision into state is the
  // cascading-render shape the hooks lint forbids).
  if (needed && !bootSettled && !prompt) {
    setBootSettled(true);
    if (shouldShowHunterPick(account, readDeferredAt())) {
      setPrompt(true);
    }
  }

  const deferPrompt = useCallback(() => {
    writeDeferredAt(Date.now());
    setPrompt(false);
  }, []);

  const completePrompt = useCallback(() => {
    setPrompt(false);
  }, []);

  return {
    prompt: needed ? prompt : false,
    deferPrompt,
    completePrompt,
  };
}
