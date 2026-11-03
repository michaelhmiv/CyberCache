/**
 * QC fix slice D — affordances, collections masking, landing honesty
 * (final QC playtest 2026-11-02, items A7 / A11 / B3-copy / C1-garage).
 *
 * Web-platform variants live here (Capacitor reports 'web' under
 * jsdom, which is exactly the guest-preview build the QC walked);
 * the native variants are pinned in qcNativeCopy.test.tsx.
 *
 * Boundaries, per the repo's client-test convention: the Chef
 * transport (chefClient) and verifiedOps are mocked; the research
 * view fed to the panel is built by the SHIPPED derivation
 * (researchStateView over literal server facts), so the panel is
 * tested against the real wire contract, not a hand-invented shape.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Rarity } from '@/types/game';
import {
  researchStateView,
  resolveResearchLevers,
  type ResearchFacts,
} from '@/content/research';
import { useLoadoutStore, usePlayerStore, useSkillStore } from '@/store';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';

// ─── Transport mocks ────────────────────────────────────────────────

const researchTransport = vi.hoisted(() => ({
  facts: null as ResearchFacts | null,
  enrollCalls: [] as Array<{ nonce: string; courseId: string }>,
}));

vi.mock('@/lib/chef/chefClient', () => ({
  getResearchState: vi.fn(async () => ({
    verified: true,
    research: researchStateView(researchTransport.facts as ResearchFacts, resolveResearchLevers({})),
  })),
  enrollResearch: vi.fn(async (req: { nonce: string; courseId: string }) => {
    researchTransport.enrollCalls.push(req);
    return {
      verified: true,
      enrolled: {},
      research: researchStateView(researchTransport.facts as ResearchFacts, resolveResearchLevers({})),
      profile: null,
    };
  }),
  cancelResearch: vi.fn(async () => ({ verified: true, cancelled: {}, research: null })),
  newResearchEnrollNonce: () => 'research-enroll:test-nonce',
  newResearchCancelNonce: () => 'research-cancel:test-nonce',
  getActionSkillState: vi.fn(async () => ({
    verified: true,
    actionSkill: {
      charge: 0, chargeMax: 100, charged: false,
      selection: null, selected: null, qualified: [], signatures: [],
      noKeystoneNote: 'No action skill yet.',
    },
  })),
  newActionSkillNonce: () => 'action-skill:test-nonce',
  selectActionSkill: vi.fn(async () => ({ verified: true, actionSkill: null })),
}));

const collectionsTransport = vi.hoisted(() => ({
  payload: {
    legendary_cores: 3,
    discoveries: [
      { family: 'boss', entry_key: 'dune_tyrant', source: 'Boss victory', discovered_at: '2026-11-01T00:00:00.000Z' },
    ],
  },
}));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    trainSkill: vi.fn(async () => ({})),
    retrain: vi.fn(async () => ({})),
    equipItem: vi.fn(async () => ({})),
    unequipSlot: vi.fn(async () => ({})),
    refuelVehicle: vi.fn(async () => ({})),
    enqueueRepairJob: vi.fn(async () => ({})),
    itemLock: vi.fn(async () => ({})),
    recycleItem: vi.fn(async () => ({})),
    claimCraftedConsumable: vi.fn(async () => ({})),
  },
  fetchCollections: vi.fn(async () => collectionsTransport.payload),
  fetchWorkshopState: vi.fn(async () => ({
    benches: 1, tools: {}, jobs: [], masteries: {}, activeActionKind: null, recentCompletions: [],
  })),
}));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    account: { accountType: 'guest' },
    authError: null,
    authMessage: null,
    authDiagnostic: null,
    signInWithGoogle: vi.fn(),
    continueAsGuest: vi.fn(),
    actionLoading: false,
  }),
}));

import { ResearchPanel } from '@/components/profile/ResearchPanel';
import { SkillTreeScreen } from '@/screens/SkillTreeScreen';
import { CollectionsScreen } from '@/screens/CollectionsScreen';
import { GaragePanel } from '@/components/gear/GaragePanel';
import { AuthScreen } from '@/screens/AuthScreen';
import { SignInLockPrompt } from '@/auth/SignInLockPrompt';
import { verifiedOps } from '@/lib/api/verifiedOps';

const facts = (overrides: Partial<ResearchFacts> = {}): ResearchFacts => ({
  workshopBenches: 1,
  credits: 100,
  completed: [],
  activeEnrollment: null,
  nowMs: Date.now(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  researchTransport.enrollCalls = [];
  researchTransport.facts = facts();
});

afterEach(() => {
  cleanup();
});

// ─── A7: Research course cards open a course detail ─────────────────

describe('ResearchPanel — course detail (QC A7)', () => {
  it('tapping a course card opens its brief: gates, fee, unlock', async () => {
    render(<ResearchPanel />);
    const card = await screen.findByTestId('research-course-shop_fundamentals');
    fireEvent.click(card);

    const detail = await screen.findByTestId('research-course-detail');
    expect(within(detail).getByText('Shop Fundamentals')).toBeTruthy();
    expect(within(detail).getByText(/Craft quality shift \+2/)).toBeTruthy();
    // Gate-removal step 3 (0059): courses carry no level requirement —
    // the brief never prints one.
    expect(within(detail).queryByText(/Requires level/)).toBeNull();
    // Available but unaffordable: the detail mirrors the card's gating —
    // the requirement and the real balance print, no enroll button.
    expect(within(detail).getByText(/Requires 2,500 cr — your balance is 100 cr/)).toBeTruthy();
    expect(within(detail).queryByRole('button', { name: /Enroll/ })).toBeNull();
  });

  it('a locked course detail lists what is still needed', async () => {
    render(<ResearchPanel />);
    const card = await screen.findByTestId('research-course-powertrain_systems');
    fireEvent.click(card);

    const detail = await screen.findByTestId('research-course-detail');
    expect(within(detail).getByText('Still needed')).toBeTruthy();
    // Gate-removal step 3 (0059): Powertrain Systems (was L20) is
    // gated only by its prerequisite now — the level never prints.
    expect(within(detail).queryByText(/Requires level/)).toBeNull();
    expect(within(detail).getByText('Requires Wrench Basics')).toBeTruthy();
  });

  it('an affordable course enrolls from its detail through the real op shape', async () => {
    researchTransport.facts = facts({ workshopBenches: 3, credits: 500_000 });
    render(<ResearchPanel />);
    const card = await screen.findByTestId('research-course-shop_fundamentals');
    fireEvent.click(card);

    const detail = await screen.findByTestId('research-course-detail');
    fireEvent.click(within(detail).getByRole('button', { name: /Enroll · 2,500 cr/ }));
    await waitFor(() => expect(researchTransport.enrollCalls).toHaveLength(1));
    expect(researchTransport.enrollCalls[0].courseId).toBe('shop_fundamentals');
    expect(researchTransport.enrollCalls[0].nonce).toContain('research-enroll:');
  });
});

// ─── A7: Skill node detail always shows the spend affordance ────────

describe('SkillTreeScreen — spend affordance (QC A7)', () => {
  it('a player with no points sees the Spend button, disabled, with the reason', async () => {
    usePlayerStore.setState({ level: 1, credits: 0 });
    useSkillStore.setState({ spent: {}, classModBoosts: { nodeBoosts: {} } });
    render(<SkillTreeScreen embedded />);

    // Calibrated Iron is the default inspected node (Gunslinger, tier 1).
    const unavailable = await screen.findByTestId('skill-spend-unavailable');
    expect((unavailable as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Needs 1 point — you have 0/)).toBeTruthy();
    expect(screen.getByText(/Skill points come from levels: 1 per level/)).toBeTruthy();
    // The board's tree sigil carries an accessible name (the
    // unexplained red glyph at the board's top-right).
    expect(screen.getByLabelText('Gunslinger tree sigil')).toBeTruthy();
  });

  it('a player with points gets the live Spend button and trains through the verified op', async () => {
    usePlayerStore.setState({ level: 30, credits: 100_000 });
    useSkillStore.setState({ spent: {}, classModBoosts: { nodeBoosts: {} } });
    render(<SkillTreeScreen embedded />);

    const spend = await screen.findByRole('button', { name: 'Spend 1 Point' });
    expect((spend as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(spend);
    await waitFor(() =>
      expect(vi.mocked(verifiedOps.trainSkill)).toHaveBeenCalledWith('gs_dmg_1'),
    );
  });
});

// ─── A11: undiscovered Collections entries are masked ───────────────

describe('CollectionsScreen — undiscovered masking (QC A11)', () => {
  it('discovered entries print their name; undiscovered print neither name nor drops', async () => {
    render(<CollectionsScreen />);
    // The one discovery in the payload renders in full.
    expect(await screen.findByText('Dune Tyrant')).toBeTruthy();
    expect(screen.getByText(/Logged · Boss victory/)).toBeTruthy();

    // Undiscovered bosses: name hidden, dedicated-drop names hidden.
    expect(screen.queryByText('The Siltstalker')).toBeNull();
    expect(screen.queryByText('Gromm, the Heap Guard')).toBeNull();
    expect(screen.queryByText(/Bad Decision/)).toBeNull();
    expect(screen.queryByText(/Glass Sun/)).toBeNull();

    const siltstalker = screen.getByTestId('collection-entry-boss-siltstalker');
    expect(within(siltstalker).getByText('Undiscovered')).toBeTruthy();
    expect(within(siltstalker).getByText(/An undefeated boss/)).toBeTruthy();
    expect(siltstalker.getAttribute('data-found')).toBe('false');

    // Undiscovered legendary effects and named elites are masked too.
    expect(screen.queryByText('Emberfall')).toBeNull();
    expect(screen.queryByText('Silt Marshal')).toBeNull();
  });
});

// ─── C1: Garage fuel hint ───────────────────────────────────────────

const scrapBike = (overrides: Partial<VehicleDisplay> = {}): VehicleDisplay => ({
  id: 'veh-1', name: 'Scrap Bike', vehicleClassId: 'scrap_bike', level: 1,
  rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
  isLocked: false, pixelSeed: 1, conditionCurrent: 100, conditionMax: 100,
  ...overrides,
});

describe('GaragePanel — fuel hint (QC C1)', () => {
  const seedGarage = (consumables: Record<string, number>) => {
    useLoadoutStore.setState({
      slots: {
        primary: null, secondary: null, heavy: null, ordnance: null,
        shield: null, classMod: null, relic: null, vehicle: 'veh-1',
      },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    usePlayerStore.setState({ level: 30, consumables, vehicleFuel: 0 });
    useVehicleStore.setState({ vehicles: [scrapBike()], lastClaimStatus: null });
  };

  it('with no fuel cells, the disabled Load buttons carry the earning hint', async () => {
    seedGarage({});
    render(<GaragePanel />);
    const hint = await screen.findByTestId('garage-fuel-hint');
    expect(hint.textContent).toContain('Vendor in the Market sells them');
    expect(hint.textContent).toContain('each cell adds 100 fuel units');
    const loadOne = screen.getByRole('button', { name: /Load 1 cell/ });
    expect((loadOne as HTMLButtonElement).disabled).toBe(true);
  });

  it('with cells in inventory, no hint and the Load buttons are live', async () => {
    seedGarage({ GenericFuelCell: 2 });
    render(<GaragePanel />);
    await screen.findByText(/Generic Fuel Cells in inventory/);
    expect(screen.queryByTestId('garage-fuel-hint')).toBeNull();
    const loadOne = screen.getByRole('button', { name: /Load 1 cell/ });
    expect((loadOne as HTMLButtonElement).disabled).toBe(false);
  });
});

// ─── B3: web landing + lock prompt honesty ──────────────────────────

describe('Landing honesty on the web build (QC B3)', () => {
  it('AuthScreen web copy calls the web build a guest preview, no sign-in promise', () => {
    render(<AuthScreen />);
    expect(screen.getByText(/This web build is a guest preview/)).toBeTruthy();
    expect(screen.getByText(/Signing in lives in the CyberCache app/)).toBeTruthy();
    expect(screen.queryByText(/vendor yard is open to everyone/)).toBeNull();
  });

  it('the sign-in lock prompt on web names the app instead of dead-ending on a button', () => {
    render(<SignInLockPrompt heading="Sign in to buy — your guest progress carries over" />);
    const note = screen.getByTestId('signin-lock-web-note');
    expect(note.textContent).toContain('Sign-in happens in the CyberCache app');
    expect(screen.queryByRole('button', { name: /Sign in with Google/ })).toBeNull();
  });
});
