/**
 * Cache Hunters slice (e) — onboarding: the starting-hunter pick
 * (APPROVAL-BRIEF §4(e), checks E1–E4).
 *
 * The G-F5 pattern (PR #554) applied to hunter choice: play
 * first, the invitation defers, the completion surface is a
 * place the player already goes — never a wall and never a
 * modal that re-interrupts play.
 *
 * Evidence split, stated honestly:
 * - E1/E2/E4 run end-to-end in the e2e-browser lane's
 *   `hunter-pick-slice-e` case (fresh guest, real shell). This
 *   suite pins the mechanics those assertions stand on: the
 *   eligibility truth table, the 24h deferral cadence, the
 *   sheet, and the Roster stop's completion.
 * - E3 (guest→Google upgrade keeps hunter, pools, arsenal) is
 *   pinned HERE at every layer a unit test can reach: the
 *   profile→account-state mapping across an account-type flip,
 *   the account-sync trigger's field census (it physically
 *   cannot touch the hunter state), and the memory store twin's
 *   preservation across a switch. The live linking leg on a
 *   real account is the owner's Pixel pass (named in the PR).
 * - E4 also carries a server-shape pin: cc_set_active_hunter's
 *   body contains no level reference and no account-type gate,
 *   and its profile stamp is unconditional — fielding even the
 *   already-defaulted hunter completes the pick.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  refreshAccount: vi.fn(async () => {}),
  setActiveHunter: vi.fn(),
}));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ refreshAccount: hoisted.refreshAccount }),
}));

vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  setActiveHunter: hoisted.setActiveHunter,
}));

vi.mock('@/lib/api/runtimeStateService', () => ({
  syncRuntimeItemsForUser: vi.fn(async () => {}),
}));

import {
  needsHunterPick,
  shouldShowHunterPick,
  type AccountState,
} from '../auth/accountState';
import {
  useHunterPick,
  HUNTER_PICK_DEFERRED_AT_KEY,
} from '../auth/useHunterPick';
import { profileRowToAccountState, type ProfileRow } from '../lib/api/profileService';
import { HunterPickSheet } from '../components/profile/HunterPickSheet';
import { RosterPanel } from '../components/profile/RosterPanel';
import { usePlayerStore, useSkillStore } from '@/store';
import { activeHunterId } from '../lib/hunters/hunters';
import { InMemoryChefGameplayStore, type InMemoryProfile } from '../server/gameplay/memory';

function makeAccount(overrides: Partial<AccountState> = {}): AccountState {
  return {
    userId: '00000000-0000-0000-0000-000000000001',
    accountType: 'guest',
    username: null,
    hasUsername: false,
    email: null,
    emailVerifiedAt: null,
    verificationGraceExpiresAt: null,
    verificationReminderLastSeenAt: null,
    isAnonymous: true,
    activeHunterId: null,
    hasHunterPick: false,
    ...overrides,
  };
}

const pendingGuest = makeAccount();
const stampedGuest = makeAccount({ activeHunterId: 'doc', hasHunterPick: true });
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/** Mirrors App's wiring: hook + sheet, one invitation at a time. */
function Probe({ account }: { account: AccountState | null }) {
  const pick = useHunterPick(account);
  return (
    <div>
      <div data-testid="play-surface">The Board — play happens here</div>
      {pick.prompt && (
        <HunterPickSheet onPicked={pick.completePrompt} onClose={pick.deferPrompt} />
      )}
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.setActiveHunter.mockResolvedValue({
    verified: true,
    activeHunterId: 'doc',
    actionSkill: null,
    profile: { active_hunter_id: 'doc' },
  });
  window.localStorage.clear();
  usePlayerStore.setState({ level: 1, xp: 0, credits: 0, scrap: 0, cacheKeys: 0, legendaryCores: 0 });
  useSkillStore.setState({ spent: {}, activeHunterId: 'vesper', classModBoosts: { nodeBoosts: {} } });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('pick eligibility + cadence (accountState)', () => {
  it('addresses any signed-in account that has never fielded a hunter — guests included', () => {
    expect(needsHunterPick(pendingGuest)).toBe(true);
    expect(needsHunterPick(makeAccount({ accountType: 'verified', isAnonymous: false, email: 'hunter@example.com' }))).toBe(true);
    expect(needsHunterPick(stampedGuest)).toBe(false);
    expect(needsHunterPick(null)).toBe(false);
  });

  it('treats an account state without the pick fields as unknown, never pending', () => {
    const bare = makeAccount();
    delete bare.activeHunterId;
    delete bare.hasHunterPick;
    expect(needsHunterPick(bare)).toBe(false);
    expect(shouldShowHunterPick(bare, null)).toBe(false);
  });

  it('mirrors the G-F5 cadence: quiet for 24h after a deferral, then eligible again', () => {
    const now = Date.now();
    expect(shouldShowHunterPick(pendingGuest, null, now)).toBe(true);
    expect(shouldShowHunterPick(pendingGuest, now - ONE_HOUR_MS, now)).toBe(false);
    expect(shouldShowHunterPick(pendingGuest, now - ONE_DAY_MS + ONE_HOUR_MS, now)).toBe(false);
    expect(shouldShowHunterPick(pendingGuest, now - ONE_DAY_MS, now)).toBe(true);
    expect(shouldShowHunterPick(stampedGuest, null, now)).toBe(false);
  });
});

describe('the profile read carries the raw pick state (profileService)', () => {
  function makeRow(overrides: Partial<ProfileRow> = {}): ProfileRow {
    return {
      id: '00000000-0000-0000-0000-000000000001',
      username: 'guest_ab12cd34',
      display_name: null,
      player_level: 1,
      player_xp: 0,
      credits: 5000,
      scrap: 500,
      cache_tokens: 3,
      materials: { Scrap: 500 },
      essences: {},
      consumables: {},
      skill_spends: {},
      active_hunter_id: null,
      hunter_loadouts: {},
      boss_state: {},
      last_idle_claim_at: '2026-11-16T00:00:00.000Z',
      last_claimed_tick: 0,
      created_at: '2026-11-16T00:00:00.000Z',
      updated_at: '2026-11-16T00:00:00.000Z',
      account_type: 'guest',
      email: null,
      email_verified_at: null,
      verification_grace_expires_at: null,
      verification_reminder_last_seen_at: null,
      ...overrides,
    };
  }

  it('a fresh profile (NULL column) maps to a pending pick — the column is never resolved away', () => {
    const state = profileRowToAccountState(makeRow());
    expect(state.activeHunterId).toBeNull();
    expect(state.hasHunterPick).toBe(false);
  });

  it('a stamped profile maps to a completed pick', () => {
    const state = profileRowToAccountState(makeRow({ active_hunter_id: 'doc' }));
    expect(state.activeHunterId).toBe('doc');
    expect(state.hasHunterPick).toBe(true);
  });

  it('E3: the guest→verified flip of the same row leaves the pick state identical', () => {
    const asGuest = profileRowToAccountState(makeRow({ active_hunter_id: 'silas' }));
    const asVerified = profileRowToAccountState(makeRow({
      active_hunter_id: 'silas',
      account_type: 'verified',
      email: 'hunter@example.com',
      email_verified_at: '2026-11-16T01:00:00.000Z',
    }));
    expect(asVerified.activeHunterId).toBe(asGuest.activeHunterId);
    expect(asVerified.hasHunterPick).toBe(asGuest.hasHunterPick);

    const pendingAsGuest = profileRowToAccountState(makeRow());
    const pendingAsVerified = profileRowToAccountState(makeRow({
      account_type: 'verified',
      email: 'hunter@example.com',
      email_verified_at: '2026-11-16T01:00:00.000Z',
    }));
    expect(pendingAsVerified.hasHunterPick).toBe(false);
    expect(pendingAsVerified.activeHunterId).toBe(pendingAsGuest.activeHunterId);
  });
});

describe('E3/E4 server-shape pins (migration census)', () => {
  const migrationsDir = resolve(__dirname, '..', '..', 'db', 'migrations');
  const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8');

  it('the account-sync trigger exists only in 0005 and cannot touch hunter state', () => {
    const definers = readdirSync(migrationsDir).filter((f) =>
      readFileSync(resolve(migrationsDir, f), 'utf8').includes('chef_sync_profile_account'),
    );
    expect(definers).toEqual(['0005_profile_bootstrap.sql']);

    const sql = readMigration('0005_profile_bootstrap.sql');
    const start = sql.indexOf('create or replace function public.chef_sync_profile_account()');
    const body = sql.slice(start, sql.indexOf('$$;', start));
    expect(body).toContain('account_type');
    expect(body).not.toContain('active_hunter_id');
    expect(body).not.toContain('skill_spends');
    expect(body).not.toContain('hunter_loadouts');
  });

  it('cc_set_active_hunter stamps unconditionally and carries no level or account-type gate', () => {
    const sql = readMigration('0097_cache_hunters.sql');
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.cc_set_active_hunter');
    const body = sql.slice(start, sql.indexOf('$function$;', start));
    // The loadout swap is guarded; the profile stamp is not — it
    // lands after the guard's end if, so fielding the hunter you
    // already field still completes the pick.
    const guardStart = body.indexOf('if v_current <> v_hunter then');
    const guardEnd = body.indexOf('end if;', guardStart);
    const stamp = body.indexOf('set active_hunter_id = v_hunter');
    expect(guardStart).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(guardEnd);
    // E4 at the server: no level is ever consulted, and guests
    // are never gated out of the switch.
    expect(body).not.toContain('player_level');
    expect(body).not.toContain('account_type');
  });
});

describe('the memory store twin (E3 preservation, E4 stamp)', () => {
  function makeMemoryProfile(overrides: Partial<InMemoryProfile> = {}): InMemoryProfile {
    return {
      id: 'player-e',
      player_level: 1,
      player_xp: 0,
      credits: 5000,
      scrap_remainder: 0,
      credits_remainder: 0,
      xp_remainder: 0,
      cache_tokens: 3,
      cache_token_parts: 0,
      cache_key_remainder: 0,
      vehicle_fuel: 0,
      legendary_cores: 0,
      cache_rank_tokens: 0,
      cache_rank_grant_level: 0,
      cache_rank_spends: {},
      action_skill_charge: 0,
      action_skill_selection: null,
      active_hunter_id: null,
      hunter_loadouts: {},
      materials: { Scrap: 500 },
      essences: {},
      consumables: {},
      roaming_consumable_state: null,
      skill_spends: { steady_hand: 2 },
      boss_state: {},
      death_state: {},
      death_log: [],
      last_idle_claim_at: null,
      last_claimed_tick: 0,
      last_roaming_settled_at: null,
      last_settlement_nonce: null,
      offline_cap_hours: null,
      dispatch_board_index: 0,
      dispatch_board_rerolls_used: 0,
      dispatch_board_day: null,
      ...overrides,
    } as InMemoryProfile;
  }

  it('a fresh profile resolves to Vesper while its raw column stays NULL (pick pending)', () => {
    const p = makeMemoryProfile();
    expect(p.active_hunter_id).toBeNull();
    expect(activeHunterId(p)).toBe('vesper');
  });

  it('fielding the already-defaulted hunter still stamps the column — the pick completes', async () => {
    const store = new InMemoryChefGameplayStore();
    const p = makeMemoryProfile();
    store.profiles.set(p.id, p);
    await store.setActiveHunter(p.id, 'nonce-vesper-confirm', 'vesper');
    expect(p.active_hunter_id).toBe('vesper');
  });

  it('a switch preserves the spends, the arsenal, and records the outgoing loadout', async () => {
    const store = new InMemoryChefGameplayStore();
    const p = makeMemoryProfile();
    store.profiles.set(p.id, p);
    store.items.set('item-1', {
      id: 'item-1',
      owner_user_id: p.id,
      kind: 'weapon',
      runtime_state: 'equipped',
      is_locked: false,
      rarity: 'Rare',
      item_level: 1,
      estimated_value: 100,
      supply_mode: 'drop',
      tradeable: true,
      equipped_slot: 'primary',
      payload: { weaponType: 'Pistol' },
    });

    await store.setActiveHunter(p.id, 'nonce-field-doc-1', 'doc');

    expect(p.active_hunter_id).toBe('doc');
    expect(p.skill_spends).toEqual({ steady_hand: 2 });
    const item = store.items.get('item-1');
    expect(item?.owner_user_id).toBe(p.id);
    const loadouts = p.hunter_loadouts as { vesper?: { primary?: string | null } };
    expect(loadouts.vesper?.primary).toBe('item-1');
  });
});

describe('the deferrable pick (App wiring)', () => {
  it('greets a fresh guest with the four hunters and a Not now door, not a wall', async () => {
    render(<Probe account={pendingGuest} />);
    expect(await screen.findByTestId('hunter-pick-sheet')).toBeInTheDocument();
    for (const id of ['vesper', 'silas', 'josie', 'doc']) {
      expect(screen.getByTestId(`hunter-pick-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('hunter-pick-not-now')).toBeInTheDocument();
    expect(screen.getByTestId('play-surface')).toBeInTheDocument();
  });

  it('Not now closes the sheet, leaves play reachable, and stamps the deferral', async () => {
    render(<Probe account={pendingGuest} />);
    fireEvent.click(await screen.findByTestId('hunter-pick-not-now'));

    await waitFor(() => expect(screen.queryByTestId('hunter-pick-sheet')).not.toBeInTheDocument());
    expect(screen.getByTestId('play-surface')).toBeInTheDocument();

    const stamped = Number(window.localStorage.getItem(HUNTER_PICK_DEFERRED_AT_KEY));
    expect(Number.isFinite(stamped)).toBe(true);
    expect(Math.abs(Date.now() - stamped)).toBeLessThan(60_000);
  });

  it('does not re-ask on the next boot inside the deferral day', async () => {
    const first = render(<Probe account={pendingGuest} />);
    fireEvent.click(await screen.findByTestId('hunter-pick-not-now'));
    await waitFor(() => expect(screen.queryByTestId('hunter-pick-sheet')).not.toBeInTheDocument());
    first.unmount();

    render(<Probe account={pendingGuest} />);
    expect(screen.queryByTestId('hunter-pick-sheet')).not.toBeInTheDocument();
    expect(screen.getByTestId('play-surface')).toBeInTheDocument();
  });

  it('asks again at boot once the deferral is a day old', async () => {
    window.localStorage.setItem(HUNTER_PICK_DEFERRED_AT_KEY, String(Date.now() - ONE_DAY_MS - ONE_HOUR_MS));
    render(<Probe account={pendingGuest} />);
    expect(await screen.findByTestId('hunter-pick-sheet')).toBeInTheDocument();
  });

  it('never prompts a stamped account or a signed-out shell', () => {
    const { unmount } = render(<Probe account={stampedGuest} />);
    expect(screen.queryByTestId('hunter-pick-sheet')).not.toBeInTheDocument();
    unmount();
    render(<Probe account={null} />);
    expect(screen.queryByTestId('hunter-pick-sheet')).not.toBeInTheDocument();
  });

  it('a different pending account signing in gets its own invitation', async () => {
    const view = render(<Probe account={stampedGuest} />);
    expect(screen.queryByTestId('hunter-pick-sheet')).not.toBeInTheDocument();
    view.rerender(<Probe account={makeAccount({ userId: '00000000-0000-0000-0000-000000000002' })} />);
    expect(await screen.findByTestId('hunter-pick-sheet')).toBeInTheDocument();
  });
});

describe('the sheet completes the pick', () => {
  it('fielding Doc from the sheet runs the switch and closes the invitation', async () => {
    render(<Probe account={pendingGuest} />);
    fireEvent.click(await screen.findByTestId('hunter-pick-doc'));

    await waitFor(() => expect(hoisted.setActiveHunter).toHaveBeenCalledWith(
      expect.objectContaining({ hunterId: 'doc' }),
    ));
    await waitFor(() => expect(hoisted.refreshAccount).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('hunter-pick-sheet')).not.toBeInTheDocument());
  });

  it('confirming Vesper — the default herself — still runs the switch that stamps the pick', async () => {
    render(<Probe account={pendingGuest} />);
    fireEvent.click(await screen.findByTestId('hunter-pick-vesper'));

    await waitFor(() => expect(hoisted.setActiveHunter).toHaveBeenCalledWith(
      expect.objectContaining({ hunterId: 'vesper' }),
    ));
    await waitFor(() => expect(screen.queryByTestId('hunter-pick-sheet')).not.toBeInTheDocument());
  });
});

describe('the Roster stop completes a deferred pick (E2)', () => {
  it('carries the pick head while pending, and fielding retires it via onPickComplete', async () => {
    const onPickComplete = vi.fn();
    render(<RosterPanel onOpenTrees={() => {}} pickPending onPickComplete={onPickComplete} />);
    expect(screen.getByTestId('roster-pick-head')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('roster-hunter-doc'));
    await waitFor(() => expect(hoisted.setActiveHunter).toHaveBeenCalledWith(
      expect.objectContaining({ hunterId: 'doc' }),
    ));
    await waitFor(() => expect(onPickComplete).toHaveBeenCalled());
  });

  it('the fielded default plate is confirmable while pending — and a level-1 account fields anyone', async () => {
    const onPickComplete = vi.fn();
    render(<RosterPanel onOpenTrees={() => {}} pickPending onPickComplete={onPickComplete} />);
    // Player store is level 1 (beforeEach): no plate is locked.
    const vesper = screen.getByTestId('roster-hunter-vesper');
    expect(vesper).not.toBeDisabled();
    fireEvent.click(vesper);
    await waitFor(() => expect(hoisted.setActiveHunter).toHaveBeenCalledWith(
      expect.objectContaining({ hunterId: 'vesper' }),
    ));
    await waitFor(() => expect(onPickComplete).toHaveBeenCalled());
  });

  it('without a pending pick there is no pick head and the fielded plate rests disabled', () => {
    render(<RosterPanel onOpenTrees={() => {}} />);
    expect(screen.queryByTestId('roster-pick-head')).not.toBeInTheDocument();
    expect(screen.getByTestId('roster-hunter-vesper')).toBeDisabled();
  });
});

describe('the App seam (source pin)', () => {
  const app = readFileSync(resolve(__dirname, '..', 'App.tsx'), 'utf8');

  it('wires the pick hook and the defer door', () => {
    expect(app).toContain('useHunterPick(account)');
    expect(app).toContain('onClose={hunterPick.deferPrompt}');
    expect(app).toContain('onPicked={hunterPick.completePrompt}');
  });

  it('never stacks the pick over the hunter-name invitation', () => {
    expect(app).toContain('hunterPick.prompt && !usernamePrompt.prompt');
  });
});
