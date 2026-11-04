/**
 * Home composition (redesign Wave C, DESIGN.md §4) — the merged
 * Home screen in its fixed composition order:
 *
 *  - the mode rail under the diorama carries exactly the six
 *    §2 stops (Area · Roam · Boss · Endless · Extract · Craft),
 *    and Endless / Extract / Craft open their workspaces from
 *    the rail at ONE tap (they sat at 2 via the mode sheet);
 *  - the consumable belt sits above the fold (after the lit
 *    workspace, before the deck);
 *  - the stage carries NO ribbon and prints NO mode word
 *    (Home consolidation, 2026-11-03): the hero rundown at the
 *    stage's foot carries two rows — DPS · Dmg/tick · Crit % ·
 *    Crit × over HP · Shield · Mit · Shield Break — once each;
 *  - the Next Move card is REMOVED (owner device review,
 *    2026-11-03): the weekly claimables below pin that it never
 *    renders, even under a live wait — the chip and its sheet
 *    are the weekly earnings' only Home surface;
 *  - the deck prints its two blocks in the fixed order
 *    (Launchers → Now) — Slots, the Loadout shortcut, the
 *    Weekly panel, and Hunter Totals all left the deck in the
 *    consolidation (rehoused, per DESIGN.md §4's notes);
 *  - the weekly Parts Crate + Signature Orders announce on the
 *    claim chip under the Strip and
 *    claim from Home through the Rep Desk's REAL wire ops
 *    (standingBuy / standingOrder with the view's own offer
 *    key); guests see the offers with the lock on the claim
 *    button;
 *  - the Return Sheet (§10) presents the recap with a totals
 *    row and the absence's best drop as a poster card; Collect
 *    acknowledges.
 *
 * Wire contracts are the real ones: the standing view is built
 * by the shipped buildStandingStateView from facts, and the
 * activity service mock echoes StartActivityInput the way the
 * audit-truth harness does.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'user-1' } as { id: string } | null,
    account: null as unknown,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false as boolean,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getContractsState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getStandingState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  standingBuy: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  standingOrder: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getEndlessMe: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getExtractionState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getResearchState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/api/activityService', () => {
  const idle = {
    kind: 'idle_standby', bossPhase: 'prep', startedAt: null, completesAt: null,
    targetType: null, targetId: null, targetLabel: null, sceneKey: null, notes: null,
    activityPayload: {}, publicPayload: {}, lastHeartbeatAt: null,
    publicVisible: true, schemaVersion: 1, updatedAt: null,
  };
  return {
    startActiveActivity: vi.fn(async (input: Record<string, unknown>) => ({
      ...idle,
      kind: input.kind,
      bossPhase: input.bossPhase ?? 'prep',
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      sceneKey: input.sceneKey ?? null,
      notes: input.notes ?? null,
      activityPayload: input.activityPayload ?? {},
      publicPayload: input.publicPayload ?? {},
      publicVisible: input.publicVisible ?? true,
    })),
    getMyActiveActivity: vi.fn(async () => idle),
    clearActiveActivity: vi.fn(async () => idle),
    heartbeatActiveActivity: vi.fn(async () => idle),
  };
});

vi.mock('@/lib/notifications/pushNotifications', () => ({
  checkPushPermission: vi.fn(async () => 'prompt'),
  requestPushNotifications: vi.fn(async () => true),
  syncPushRegistration: vi.fn(async () => {}),
}));

import { HomeScreen } from '@/screens/HomeScreen';
import { IDLE_ACTIVITY } from '@/types/activity';
import { getStandingState, standingBuy } from '@/lib/chef/chefClient';
import { usePlayerStore } from '@/store';
import { useActivityStore } from '@/store/slices/activitySlice';
import { useLoginStreakStore } from '@/store/slices/loginStreakSlice';
import { useContractsStore } from '@/store/slices/contractsSlice';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { usePushPrimerStore } from '@/store/slices/pushPrimerSlice';
import { useStandingStore } from '@/store/slices/standingSlice';
import { buildStandingStateView, type StandingFacts } from '@/content/manufacturerStanding';
import { Manufacturer, Rarity } from '@/types/game';
import type { SettlementRecap } from '@/lib/activity/activitySettlement';

const mockStanding = vi.mocked(getStandingState);
const mockBuy = vi.mocked(standingBuy);

/** Redline at rank 5: BOTH weekly offers are claimable (crate at
 *  rank ≥ 4, signature order at rank 5 with the lane enabled). */
function standingFacts(overrides: Partial<StandingFacts> = {}): StandingFacts {
  return {
    accountType: 'verified',
    canUsePlayerEconomy: true,
    credits: 500_000,
    playerLevel: 25,
    rows: [{ manufacturer: Manufacturer.Redline, standing: 20_000, rank: 5 }],
    weeklyPurchases: [],
    ...overrides,
  };
}

const roamingRecapWithDrops = {
  settled: true,
  areaId: 'dustwaste',
  areaName: 'Dustwaste',
  timeAway: '2h 5m',
  elapsedMs: 7_500_000,
  cappedMs: 7_500_000,
  capReached: false,
  capHours: 4,
  ticksSettled: 120,
  startTick: 0,
  endTick: 120,
  profile: {},
  rewards: {
    creditsAwarded: 4321,
    scrapAwarded: 87,
    xpAwarded: 640,
    cacheFragmentsAwarded: 2,
    materials: {},
    essences: {},
  },
  items: [
    {
      id: 'w-common', name: 'Scrap Pistol', rarity: Rarity.Common, level: 12,
      damagePerSecond: 42, affixes: [], isLocked: false,
    },
    {
      id: 's-legendary', name: 'Aegis of the Fallen Foundry', rarity: Rarity.Legendary, level: 25,
      affixes: [{ id: 'a1' }, { id: 'a2' }], isLocked: false,
    },
  ],
} as unknown as SettlementRecap;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  mockStanding.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
  mockBuy.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
  useLoginStreakStore.getState().reset();
  useContractsStore.getState().reset();
  useOfflineRecapStore.getState().reset();
  usePushPrimerStore.getState().reset();
  useStandingStore.getState().reset();
  usePlayerStore.setState({ level: 25, xp: 0, profileLoaded: true });
});

afterEach(() => {
  cleanup();
});

describe('Home composition — mode rail (§2/§4)', () => {
  it('renders exactly the six rail stops in order, under the Stage and above the belt and deck', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    const rail = await screen.findByTestId('home-mode-rail');
    const stops = within(rail).getAllByRole('button').map((b) => b.getAttribute('data-testid'));
    expect(stops).toEqual([
      'mode-rail-area', 'mode-rail-roam', 'mode-rail-boss',
      'mode-rail-endless', 'mode-rail-extract', 'mode-rail-craft',
    ]);
    // §4 order: claim row → Stage (rail inside it) → belt → deck.
    const topBar = screen.getByTestId('dashboard-top-bar');
    expect(topBar.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const belt = screen.getByTestId('consumable-belt');
    expect(rail.compareDocumentPosition(belt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const launchers = screen.getByText('Launchers');
    expect(belt.compareDocumentPosition(launchers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Endless opens its workspace from the rail at one tap', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-endless'));
    expect(await screen.findByTestId('endless-panel')).toBeTruthy();
    expect(screen.getByTestId('mode-rail-endless').getAttribute('aria-pressed')).toBe('true');
  });

  it('Extraction opens its workspace from the rail at one tap', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-extract'));
    expect(await screen.findByTestId('extraction-panel')).toBeTruthy();
    expect(screen.getByTestId('mode-rail-extract').getAttribute('aria-pressed')).toBe('true');
  });

  it('Craft starts the crafting activity from the rail at one tap', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-craft'));
    await waitFor(() => expect(useActivityStore.getState().current.kind).toBe('crafting'));
    // The lit workspace is the Craft panel (its Workshop door).
    expect(await screen.findByRole('button', { name: 'Open Workshop' })).toBeTruthy();
    expect(screen.getByTestId('mode-rail-craft').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Home composition — stage furniture + standby panel (drift-fix F2)', () => {
  beforeEach(() => {
    // The rail tests above leave the activity store in the Craft
    // mode they last opened; F2's standby assertions start from a
    // genuinely idle hunter.
    useActivityStore.setState({ current: IDLE_ACTIVITY, hydrated: true, pending: false, error: null });
  });

  it('the stage carries NO area plate and NO ribbon; the mode word prints nowhere; the rundown carries the state', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    // The "Area · …" banner is off the scene entirely (owner
    // ruling 2026-11-02), and the consolidation (2026-11-03)
    // retired the status ribbon with it: the stage's only text
    // furniture is the count plate and the icon controls. The
    // mode word ("Standby") prints NOWHERE on the screen — the
    // scene, the rail, and the workspace already say it — and
    // the weapon state reaches the player from the hero rundown
    // attached to the stage's foot.
    await screen.findByTestId('hero-rundown');
    expect(screen.queryByTestId('diorama-stage-plate')).toBeNull();
    expect(screen.queryByTestId('diorama-status-ribbon')).toBeNull();
    expect(screen.queryByText('Standby')).toBeNull();
    const rundown = screen.getByTestId('hero-rundown');
    expect(rundown.textContent).toContain('No weapon equipped');
    expect(rundown.textContent).toContain('HP');
    // The old poster headline ("No target selected") stays gone.
    expect(screen.queryByText('No target selected')).toBeNull();
  });

  it('standby workspace is the Roam panel: facts + Away cell, the one Start Roam bar, full-width Change Area, no ghost Loadout door', async () => {
    const onNavigate = vi.fn();
    render(<HomeScreen onNavigate={onNavigate} />);
    const panel = await screen.findByTestId('home-standby-panel');
    expect(panel.textContent).toContain('Roam — Dustwaste Frontier');
    expect(panel.textContent).toContain('+15/min');
    expect(panel.textContent).toContain('XP · gear');
    // F2 fix pin: the fact band gives Hostiles the wide final
    // track (fewer wrapped lines at the 11px floor) and centers
    // every label/value group, so the shorter facts do not sit
    // top-weighted in boxes stretched by the longest cell. The
    // consolidation adds the Away cell (the retired band's AFK
    // entry): the effective offline cap, in the same grammar.
    const facts = within(panel).getByTestId('home-standby-facts');
    expect(facts.className).toContain('grid-cols-[minmax(0,0.72fr)_minmax(0,0.72fr)_minmax(0,0.84fr)_minmax(0,0.84fr)_minmax(0,1.5fr)]');
    expect(facts.children).toHaveLength(5);
    for (const cell of facts.children) {
      expect(cell.className).toContain('flex');
      expect(cell.className).toContain('flex-col');
      expect(cell.className).toContain('items-center');
      expect(cell.className).toContain('justify-center');
    }
    expect(facts.textContent).toContain('Away');
    expect(facts.textContent).toMatch(/cap \d+h/);
    expect(facts.textContent).toContain('Raiders, scrap drones, and scavengers');
    // Exactly one Start Roam on the screen — the workspace bar
    // (the stage no longer carries a duplicate over the art).
    expect(screen.getAllByText('Start Roam')).toHaveLength(1);
    // The ghost Loadout door is gone from Home entirely (the
    // count plate carries the signal; Gear → Loadout is the
    // door), and Change Area takes the full row.
    expect(screen.queryByText(/Loadout · /)).toBeNull();
    const changeArea = within(panel).getByText('Change Area');
    expect(changeArea.className).toContain('w-full');
  });
});

describe('Home composition — the deck (§4 fixed order)', () => {
  it('prints Launchers → Now, and nothing else: the retired deck blocks stay retired', async () => {
    const onNavigate = vi.fn();
    render(<HomeScreen onNavigate={onNavigate} />);
    const launchers = await screen.findByText('Launchers');
    const now = screen.getByText('Now');
    expect(launchers.compareDocumentPosition(now) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The consolidation retirements: Hunter Totals (→ the hero
    // rundown + Hunter → Profile's Totals & Sources door), the
    // Weekly panel (→ claim chip + its sheet), the Slots launcher (→
    // the Market rail stop), the Loadout Bench shortcut (→ the
    // count plate + Gear → Loadout).
    expect(screen.queryByText('Hunter Totals')).toBeNull();
    expect(screen.queryByTestId('hunter-totals-sources-button')).toBeNull();
    expect(screen.queryByTestId('weekly-claimables-panel')).toBeNull();
    expect(screen.queryByText('Loadout Bench')).toBeNull();
    expect(screen.queryByText('Slots')).toBeNull();
    // The removed panels stay removed.
    expect(screen.queryByText('Hunter Notes')).toBeNull();
    expect(screen.queryByText('Action Board')).toBeNull();
    // Launcher deck contents: Dispatch + Crack Cache, the two
    // owner-kept Board orphans.
    expect(screen.getByText('Dispatch')).toBeTruthy();
    expect(screen.getByText('Crack Cache')).toBeTruthy();
  });
});

describe('Home composition — weekly claimables (§9)', () => {
  it('reads standing on mount (never behind a tap) and announces claimables on the chip', async () => {
    mockStanding.mockResolvedValue({ verified: true, standing: buildStandingStateView(standingFacts()) });
    render(<HomeScreen onNavigate={() => {}} />);
    await waitFor(() => expect(mockStanding).toHaveBeenCalledTimes(1));
    const chip = await screen.findByTestId('top-weekly-button');
    expect(chip.getAttribute('aria-label')).toContain('2 ready at the Rep Desk');
    // The claimable rows live in the claim sheet now (the deck
    // panel is retired): the chip opens it, both offers render.
    fireEvent.click(chip);
    expect(await screen.findByTestId('weekly-claimable-crate:Redline')).toBeTruthy();
    expect(screen.getByTestId('weekly-claimable-order:Redline')).toBeTruthy();
  });

  it('the weekly wait never renders a Next Move card — the chip and its sheet carry it alone', async () => {
    mockStanding.mockResolvedValue({ verified: true, standing: buildStandingStateView(standingFacts()) });
    render(<HomeScreen onNavigate={() => {}} />);
    // The chip announces the two ready earnings…
    const chip = await screen.findByTestId('top-weekly-button');
    expect(chip.getAttribute('aria-label')).toContain('2 ready at the Rep Desk');
    // …and no card exists anywhere on Home (removed 2026-11-03).
    expect(screen.queryByTestId('next-move-card')).toBeNull();
    // The chip's sheet still opens the same claim list.
    fireEvent.click(chip);
    expect(await screen.findByTestId('weekly-claimable-crate:Redline')).toBeTruthy();
  });

  it('claims the Parts Crate through the real standingBuy wire shape and the spent offer leaves the surfaces', async () => {
    mockStanding.mockResolvedValue({ verified: true, standing: buildStandingStateView(standingFacts()) });
    mockBuy.mockResolvedValue({
      verified: true,
      bought: { offerKey: 'crate:Redline', manufacturer: 'Redline', kind: 'crate', quantity: 1, consumableType: null, totalPrice: 1 },
      standing: buildStandingStateView(standingFacts({ weeklyPurchases: [{ manufacturer: 'Redline', kind: 'crate' }] })),
      profile: null,
    });
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('top-weekly-button'));
    const crateRow = await screen.findByTestId('weekly-claimable-crate:Redline');
    fireEvent.click(within(crateRow).getByRole('button'));

    await waitFor(() => expect(mockBuy).toHaveBeenCalledTimes(1));
    const request = mockBuy.mock.calls[0][0];
    expect(request.offerKey).toBe('crate:Redline');
    expect(request.quantity).toBe(1);
    expect(request.nonce).toMatch(/^standing-buy:/);

    // The fresh view rides the response: the crate is spent
    // everywhere at once, the order remains, the chip recounts.
    await waitFor(() => expect(screen.queryByTestId('weekly-claimable-crate:Redline')).toBeNull());
    expect(screen.getByTestId('weekly-claimable-order:Redline')).toBeTruthy();
    expect(screen.getByTestId('top-weekly-button').getAttribute('aria-label')).toContain('1 ready');
  });

  it('guests see the offers with the lock on the claim button, never on the sheet', async () => {
    mockStanding.mockResolvedValue({
      verified: true,
      standing: buildStandingStateView(standingFacts({ accountType: 'guest', canUsePlayerEconomy: false })),
    });
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('top-weekly-button'));
    const crateRow = await screen.findByTestId('weekly-claimable-crate:Redline');
    const claimButton = within(crateRow).getByRole('button');
    expect((claimButton as HTMLButtonElement).disabled).toBe(true);
    expect(claimButton.textContent).toContain('Sign in to claim');
  });

  it('no claimables: no chip announces — nothing waits', async () => {
    mockStanding.mockResolvedValue({
      verified: true,
      standing: buildStandingStateView(standingFacts({ rows: [], weeklyPurchases: [] })),
    });
    render(<HomeScreen onNavigate={() => {}} />);
    await screen.findByText('Launchers');
    await waitFor(() => expect(mockStanding).toHaveBeenCalled());
    expect(screen.queryByTestId('top-weekly-button')).toBeNull();
    expect(screen.queryByTestId('weekly-claimables-panel')).toBeNull();
    expect(screen.queryByTestId('next-move-card')).toBeNull();
  });
});

describe('Home composition — the Return Sheet (§10)', () => {
  it('presents totals + the best drop as a poster card; Collect acknowledges', async () => {
    useOfflineRecapStore.getState().setSettlement(roamingRecapWithDrops);
    render(<HomeScreen onNavigate={() => {}} />);
    // The level chip is the Return Sheet's door while a
    // settlement exists.
    fireEvent.click(screen.getByTestId('top-level-button'));
    expect(await screen.findByText('While You Were Away')).toBeTruthy();
    expect(screen.getByTestId('return-totals-row')).toBeTruthy();
    const poster = screen.getByTestId('return-best-drop');
    expect(poster.textContent).toContain('Aegis of the Fallen Foundry');
    expect(poster.textContent).toContain('Legendary');
    // The lesser drop is folded into the poster's "+N more".
    expect(poster.textContent).toContain('+1 more drop');

    // The Return Sheet behind the level chip is the
    // settlement's only Home door now (the Next Move card is
    // removed) — its Collect is the one this flow
    // acknowledges with.
    const sheetBody = screen.getByTestId('picker-sheet-body');
    fireEvent.click(within(sheetBody).getByRole('button', { name: 'Collect' }));
    await waitFor(() => expect(useOfflineRecapStore.getState().dismissed).toBe(true));
  });

  it('the level pop-up holds specifics only — the recap is not inside it', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId('top-level-button'));
    expect(await screen.findByText('XP into this level')).toBeTruthy();
    expect(screen.queryByText('While You Were Away')).toBeNull();
  });
});
