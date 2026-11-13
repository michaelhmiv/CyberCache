/**
 * Audit G-F5 — the forced hunter-name modal (owner ruling
 * 2026-11-12: "Definitely let players play before forcing them
 * to sign in [with a username]. Play first; prompt for a name
 * only when it matters (leaderboards/social).")
 *
 * Before: App rendered <UsernameSetupModal force /> for every
 * signed-in account without a username — a full-screen overlay
 * with no dismiss control over every tab until a name was
 * claimed. The audit's CI assertion: "render with a verified
 * no-username account; assert at least one tab is reachable or
 * a defer control exists."
 *
 * The Probe below mirrors App's wiring exactly (same hook, same
 * modal props): the boot invitation appears with a "Not now"
 * door; deferring closes it, stamps the deferral, and leaves
 * the play surface reachable; the boot ask stays quiet for 24h
 * after a deferral; the contextual ask fires once per session
 * when the player reaches a surface where a name matters (the
 * probe's standings button stands in for the Standings route /
 * Hunter tab triggers App calls).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ refreshAccount: vi.fn(async () => {}) }),
}));

const setUsernameMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
vi.mock('@/lib/api/usernameService', () => ({
  isUsernameAvailable: vi.fn(async () => true),
  setUsername: setUsernameMock,
}));

import {
  needsUsernamePrompt,
  shouldShowUsernamePrompt,
  type AccountState,
} from '../auth/accountState';
import {
  useUsernamePrompt,
  USERNAME_PROMPT_DEFERRED_AT_KEY,
} from '../auth/useUsernamePrompt';
import { UsernameSetupModal } from '../components/profile/UsernameSetupModal';

function makeAccount(overrides: Partial<AccountState> = {}): AccountState {
  return {
    userId: '00000000-0000-0000-0000-000000000001',
    accountType: 'verified',
    username: null,
    hasUsername: false,
    email: 'hunter@example.com',
    emailVerifiedAt: new Date().toISOString(),
    verificationGraceExpiresAt: null,
    verificationReminderLastSeenAt: null,
    isAnonymous: false,
    ...overrides,
  };
}

const nameless = makeAccount();
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function Probe({ account }: { account: AccountState | null }) {
  const prompt = useUsernamePrompt(account);
  return (
    <div>
      <div data-testid="play-surface">The Board — play happens here</div>
      <button type="button" onClick={prompt.requestSurfacePrompt}>
        open-standings
      </button>
      {prompt.prompt && (
        <UsernameSetupModal
          dismissLabel="Not now"
          onComplete={prompt.completePrompt}
          onClose={prompt.deferPrompt}
        />
      )}
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  setUsernameMock.mockClear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('prompt eligibility + cadence (accountState)', () => {
  it('addresses signed-in, non-anonymous accounts without a username', () => {
    expect(needsUsernamePrompt(nameless)).toBe(true);
    expect(needsUsernamePrompt(makeAccount({ username: 'cacheking', hasUsername: true }))).toBe(false);
    expect(needsUsernamePrompt(makeAccount({ accountType: 'guest', isAnonymous: true }))).toBe(false);
    expect(needsUsernamePrompt(null)).toBe(false);
  });

  it('shows the boot invitation when never deferred, then stays quiet for 24h', () => {
    const now = Date.now();
    expect(shouldShowUsernamePrompt(nameless, null, now)).toBe(true);
    expect(shouldShowUsernamePrompt(nameless, now - ONE_HOUR_MS, now)).toBe(false);
    expect(shouldShowUsernamePrompt(nameless, now - ONE_DAY_MS + ONE_HOUR_MS, now)).toBe(false);
    expect(shouldShowUsernamePrompt(nameless, now - ONE_DAY_MS, now)).toBe(true);
  });

  it('never shows for ineligible accounts, however old the deferral', () => {
    const now = Date.now();
    expect(shouldShowUsernamePrompt(makeAccount({ hasUsername: true, username: 'cacheking' }), null, now)).toBe(false);
    expect(shouldShowUsernamePrompt(makeAccount({ accountType: 'guest', isAnonymous: true }), null, now)).toBe(false);
  });
});

describe('the deferrable name prompt (App wiring)', () => {
  it('greets a verified no-username account with a defer control, not a wall', async () => {
    render(<Probe account={nameless} />);
    expect(await screen.findByText('Choose Your Handle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('Not now closes the prompt, leaves play reachable, and stamps the deferral', async () => {
    render(<Probe account={nameless} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(screen.queryByText('Choose Your Handle')).not.toBeInTheDocument());
    expect(screen.getByTestId('play-surface')).toBeInTheDocument();

    const stamped = Number(window.localStorage.getItem(USERNAME_PROMPT_DEFERRED_AT_KEY));
    expect(Number.isFinite(stamped)).toBe(true);
    expect(Math.abs(Date.now() - stamped)).toBeLessThan(60_000);
  });

  it('does not re-ask on the next boot inside the deferral day', async () => {
    const first = render(<Probe account={nameless} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByText('Choose Your Handle')).not.toBeInTheDocument());
    first.unmount();

    render(<Probe account={nameless} />);
    expect(screen.queryByText('Choose Your Handle')).not.toBeInTheDocument();
    expect(screen.getByTestId('play-surface')).toBeInTheDocument();
  });

  it('asks again at boot once the deferral is a day old', async () => {
    window.localStorage.setItem(USERNAME_PROMPT_DEFERRED_AT_KEY, String(Date.now() - ONE_DAY_MS - ONE_HOUR_MS));
    render(<Probe account={nameless} />);
    expect(await screen.findByText('Choose Your Handle')).toBeInTheDocument();
  });

  it('re-asks once at the surface where a name matters, even inside the deferral day', async () => {
    window.localStorage.setItem(USERNAME_PROMPT_DEFERRED_AT_KEY, String(Date.now()));
    render(<Probe account={nameless} />);
    // Boot invitation suppressed by the fresh deferral…
    expect(screen.queryByText('Choose Your Handle')).not.toBeInTheDocument();

    // …but reaching the standings asks, once.
    fireEvent.click(screen.getByRole('button', { name: 'open-standings' }));
    expect(await screen.findByText('Choose Your Handle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByText('Choose Your Handle')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'open-standings' }));
    expect(screen.queryByText('Choose Your Handle')).not.toBeInTheDocument();
  });

  it('claiming a name from the prompt still works and closes it', async () => {
    render(<Probe account={nameless} />);
    const input = await screen.findByPlaceholderText('Your hunter name');
    fireEvent.change(input, { target: { value: 'cacheking' } });
    const claim = screen.getByRole('button', { name: 'Claim Handle' });
    await waitFor(() => expect(claim).not.toBeDisabled());
    fireEvent.click(claim);

    await waitFor(() => expect(setUsernameMock).toHaveBeenCalledWith('cacheking'));
    await waitFor(() => expect(screen.queryByText('Choose Your Handle')).not.toBeInTheDocument());
  });

  it('never prompts guests or named accounts', async () => {
    const guest = makeAccount({ accountType: 'guest', isAnonymous: true, email: null });
    const { unmount } = render(<Probe account={guest} />);
    fireEvent.click(screen.getByRole('button', { name: 'open-standings' }));
    expect(screen.queryByText('Choose Your Handle')).not.toBeInTheDocument();
    unmount();

    render(<Probe account={makeAccount({ username: 'cacheking', hasUsername: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'open-standings' }));
    expect(screen.queryByText('Choose Your Handle')).not.toBeInTheDocument();
  });
});

describe('the App seam (source pin)', () => {
  // The full App shell does not render in jsdom in this repo's
  // suite (no existing test mounts it), so the seam is pinned at
  // the source, in the repo's readSource style: the shell must
  // never again mount the modal forced, and must wire the hook's
  // defer + surface triggers.
  const app = readFileSync(resolve(__dirname, '..', 'App.tsx'), 'utf8');

  it('never mounts the username modal forced', () => {
    expect(app).not.toContain('<UsernameSetupModal force');
    expect(app).not.toMatch(/<UsernameSetupModal[^>]*\bforce\b/);
  });

  it('wires the defer door and both surface triggers', () => {
    expect(app).toContain('dismissLabel="Not now"');
    expect(app).toContain('onClose={usernamePrompt.deferPrompt}');
    expect(app).toContain('useUsernamePrompt(account)');
    // Standings route + Hunter tab entry request the prompt.
    expect(app).toContain("screen === 'standings'");
    expect(app).toContain('usernamePrompt.requestSurfacePrompt()');
    expect(app).toContain("if (tab === 'hunter') usernamePrompt.requestSurfacePrompt();");
  });
});

describe('the modal itself', () => {
  it('force still means forced: no dismiss control', () => {
    render(<UsernameSetupModal force />);
    expect(screen.getByText('Choose Your Handle')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('without a dismiss label the dismiss control keeps its Cancel wording', () => {
    render(<UsernameSetupModal onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});
