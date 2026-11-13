import { useCallback, useState } from 'react';
import {
  needsUsernamePrompt,
  shouldShowUsernamePrompt,
  type AccountState,
} from './accountState';

/**
 * Hunter-name prompt orchestration (audit G-F5, owner ruling
 * 2026-11-12: "Definitely let players play before forcing them
 * to sign in [with a username]. Play first; prompt for a name
 * only when it matters (leaderboards/social).")
 *
 * Before this hook, App rendered the setup modal with `force`
 * the moment a signed-in account had no username: a full-screen
 * overlay with no dismiss control, over every tab, until a name
 * was claimed. The prompt is now an invitation with two doors:
 *
 * - Boot invitation: offered once per session, and only when the
 *   last deferral is at least 24h old (or never happened) — the
 *   verification reminder's cadence (shouldShowVerificationReminder).
 * - Surface prompt: requested when the player reaches a surface
 *   where a name actually matters — the Standings route and the
 *   Hunter tab (whose Standings stop and public profile are where
 *   a hunter appears under their name). Once per session, and it
 *   ignores the boot cadence: it is contextual, not a nag.
 *
 * Either prompt can be deferred with "Not now"; deferring records
 * a timestamp in localStorage (a client-only nag cadence — no
 * progression depends on it) and closes the modal, leaving every
 * tab reachable. Claiming a name ends eligibility entirely via
 * the account state itself (hasUsername), not via this hook.
 */

export const USERNAME_PROMPT_DEFERRED_AT_KEY = 'cybercache.usernamePrompt.deferredAt';

function readDeferredAt(): number | null {
  try {
    const raw = window.localStorage.getItem(USERNAME_PROMPT_DEFERRED_AT_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeDeferredAt(at: number): void {
  try {
    window.localStorage.setItem(USERNAME_PROMPT_DEFERRED_AT_KEY, String(at));
  } catch {
    // Storage unavailable (private mode / WebView quota): the
    // per-session settled flags still stop the re-ask this session.
  }
}

export type UsernamePromptSurface = 'boot' | 'surface';

export interface UsernamePrompt {
  /** Which prompt is currently open, if any. */
  prompt: UsernamePromptSurface | null;
  /** Ask at a moment it matters (Standings route / Hunter tab). Once per session. */
  requestSurfacePrompt: () => void;
  /** "Not now": close the prompt and record the deferral. */
  deferPrompt: () => void;
  /** The modal completed (a name was claimed): close the prompt. */
  completePrompt: () => void;
}

export function useUsernamePrompt(account: AccountState | null): UsernamePrompt {
  const needed = needsUsernamePrompt(account);
  const [prompt, setPrompt] = useState<UsernamePromptSurface | null>(null);
  const [bootSettled, setBootSettled] = useState(false);
  const [surfaceSettled, setSurfaceSettled] = useState(false);

  // The settled flags are per-account: a different account signing
  // in on the same device/session starts with a clean slate (the
  // cross-account residue class audit A-08 burned us on). This is
  // a render-phase adjustment, the shell's established pattern.
  const userId = account?.userId ?? null;
  const [seenUserId, setSeenUserId] = useState<string | null>(userId);
  if (userId !== seenUserId) {
    setSeenUserId(userId);
    setBootSettled(false);
    setSurfaceSettled(false);
    setPrompt(null);
  }

  // Boot invitation: decide once per session per account, as a
  // render-phase adjustment like the account reset above (an
  // effect that only mirrors this decision into state is the
  // cascading-render shape the hooks lint forbids). If a surface
  // prompt is already open it wins; the surface request also
  // settles the boot invitation, so the two never stack.
  if (needed && !bootSettled && !prompt) {
    setBootSettled(true);
    if (shouldShowUsernamePrompt(account, readDeferredAt())) {
      setPrompt('boot');
    }
  }

  const requestSurfacePrompt = useCallback(() => {
    if (!needed || surfaceSettled) return;
    setSurfaceSettled(true);
    setBootSettled(true);
    setPrompt((current) => current ?? 'surface');
  }, [needed, surfaceSettled]);

  const deferPrompt = useCallback(() => {
    writeDeferredAt(Date.now());
    setPrompt(null);
  }, []);

  const completePrompt = useCallback(() => {
    setPrompt(null);
  }, []);

  return {
    prompt: needed ? prompt : null,
    requestSurfacePrompt,
    deferPrompt,
    completePrompt,
  };
}
