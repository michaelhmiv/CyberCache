/**
 * Cache Hunters slice (b) — the Hunter tab (APPROVAL-BRIEF §B).
 *
 * The acceptance checks, at the vitest level (the e2e-browser lane
 * carries B2/B3/B5 against the real app shell; B1's device leg is
 * the owner's Pixel pass):
 * - B1: the hero plate is the ACTIVE hunter — painting, name, tree
 *   line — and the trees door gauge prints that hunter's unspent
 *   points (per-hunter pools, slice (a) law).
 * - B2: switching hunters at the Roster swaps the trees stop to the
 *   new hunter's tree with its own pool; respec remains on the stop;
 *   a failed switch rolls back.
 * - B3: the Wardrobe wears WHOLES — whole skins with worn/owned
 *   counts, wear/remove works, and no part-wearing surface remains
 *   reachable on the stop.
 * - B5: a guest sees roster, trees, and wardrobe with real data —
 *   no lock on any of the three stops.
 * Plus the shared asset contract slice (c) builds against: the
 * four Cast B paintings in the pixel manifest under
 * hunter-{vesper-cole,silas-boone,josie-lode,doc-sutter} at file
 * dimensions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'user-1' } as { id: string } | null,
    account: null as import('@/auth/accountState').AccountState | null,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false as boolean,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
  setActiveHunter: vi.fn(),
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getCacheRankState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getResearchState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getActionSkillState: vi.fn(async () => null),
  setActiveHunter: hoisted.setActiveHunter,
}));

vi.mock('@/lib/api/runtimeStateService', () => ({
  syncRuntimeItemsForUser: vi.fn(async () => {}),
}));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    trainSkill: vi.fn(async () => ({})),
    retrain: vi.fn(async () => ({})),
    recycleItem: vi.fn(),
    equipItem: vi.fn(),
  },
  fetchProfileLifetime: vi.fn(),
  fetchCollections: vi.fn(),
}));

vi.mock('@/lib/api/leaderboardService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/leaderboardService')>()),
  getLeaderboard: vi.fn(async () => []),
  getMyLeaderboardRank: vi.fn(async () => null),
  getWeeklyLeaderboards: vi.fn(async () => ({
    week: { key: '2026-10-26', start: '2026-10-26T00:00:00.000Z', ends_at: '2026-11-02T00:00:00.000Z' },
    races: [],
    previous_week: {
      key: '2026-10-19', start: '2026-10-19T00:00:00.000Z', ends_at: '2026-10-26T00:00:00.000Z',
      settled: false, settled_at: null, races: [],
    },
    my_drop_buff: null,
  })),
}));

vi.mock('@/lib/api/publicProfileService', () => ({ getPublicProfile: vi.fn(async () => null) }));
vi.mock('@/lib/api/statsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/statsService')>()),
  getMyStatsSummary: vi.fn(async () => null),
}));
vi.mock('@/lib/api/usernameService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/usernameService')>()),
  getMyProfileSummary: vi.fn(async () => null),
}));
vi.mock('@/lib/api/progressionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/progressionService')>()),
  getMyProgressionSnapshots: vi.fn(async () => []),
}));
vi.mock('@/lib/api/masteryService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/masteryService')>()),
  getMyMasterySummary: vi.fn(async () => []),
}));

import { ProfileScreen } from '@/screens/ProfileScreen';
import { usePlayerStore, useSkillStore } from '@/store';
import { PIXEL_HUNTER_SPRITES, getPixelSprite, pixelHunterSpriteForHunter } from '@/lib/pixel/manifest';
import { HUNTER_SKINS, baseSkinForHunter, skinsForHunter, wardrobeCountsForHunter } from '@/lib/hunters/hunterSkins';
import { useHunterWardrobeStore, defaultWornSkins, wornSkinSpriteId } from '@/store/slices/hunterWardrobeSlice';
import type { AccountState } from '@/auth/accountState';

const guestAccount: AccountState = {
  userId: 'user-1',
  accountType: 'guest',
  username: null,
  hasUsername: false,
  email: null,
  emailVerifiedAt: null,
  verificationGraceExpiresAt: null,
  verificationReminderLastSeenAt: null,
  isAnonymous: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.auth.account = null;
  hoisted.setActiveHunter.mockResolvedValue({
    verified: true,
    activeHunterId: 'doc',
    actionSkill: null,
    profile: { active_hunter_id: 'doc' },
  });
  window.localStorage.clear();
  usePlayerStore.setState({ level: 20, xp: 0, credits: 0, scrap: 0, cacheKeys: 0, legendaryCores: 0 });
  useSkillStore.setState({ spent: {}, activeHunterId: 'vesper', classModBoosts: { nodeBoosts: {} } });
  useHunterWardrobeStore.setState({ wornByHunter: defaultWornSkins() });
});

describe('shared asset contract — the Cast B paintings', () => {
  it('registers the four hunters in the pixel manifest at file dimensions', () => {
    expect(PIXEL_HUNTER_SPRITES).toEqual({
      vesper: 'hunter-vesper-cole',
      silas: 'hunter-silas-boone',
      josie: 'hunter-josie-lode',
      doc: 'hunter-doc-sutter',
    });
    const dims: Record<string, [number, number]> = {
      vesper: [221, 384],
      silas: [182, 384],
      josie: [197, 384],
      doc: [163, 384],
    };
    for (const [hunterId, [w, h]] of Object.entries(dims)) {
      const spriteId = pixelHunterSpriteForHunter(hunterId);
      expect(spriteId).toBeTruthy();
      const sprite = getPixelSprite(spriteId!);
      expect(sprite?.kind).toBe('character');
      expect(sprite?.width).toBe(w);
      expect(sprite?.height).toBe(h);
    }
    expect(pixelHunterSpriteForHunter('roamer')).toBeUndefined();
    expect(pixelHunterSpriteForHunter(undefined)).toBeUndefined();
  });
});

describe('whole-skin catalog + wardrobe store', () => {
  it('carries exactly one base skin per hunter, wearing the contract painting', () => {
    expect(HUNTER_SKINS).toHaveLength(4);
    for (const hunterId of ['vesper', 'silas', 'josie', 'doc'] as const) {
      const skins = skinsForHunter(hunterId);
      expect(skins).toHaveLength(1);
      expect(skins[0].name).toBe('Standard Issue');
      expect(skins[0].base).toBe(true);
      expect(skins[0].spriteId).toBe(PIXEL_HUNTER_SPRITES[hunterId]);
      expect(wardrobeCountsForHunter(hunterId, skins[0].id)).toEqual({ worn: 1, owned: 1 });
      expect(wardrobeCountsForHunter(hunterId, null)).toEqual({ worn: 0, owned: 1 });
    }
  });

  it('defaults to the base skin worn; remove falls back to the base painting, never unpainted', () => {
    const store = useHunterWardrobeStore.getState();
    expect(store.wornByHunter.vesper).toBe(baseSkinForHunter('vesper').id);
    store.removeSkin('vesper');
    const after = useHunterWardrobeStore.getState();
    expect(after.wornByHunter.vesper).toBeNull();
    // Removed ≠ unpainted: the seen painting is still the base.
    expect(wornSkinSpriteId(after.wornByHunter, 'vesper')).toBe('hunter-vesper-cole');
    // A skin can only be worn by its own hunter.
    after.wearSkin('vesper', baseSkinForHunter('silas').id);
    expect(useHunterWardrobeStore.getState().wornByHunter.vesper).toBeNull();
    after.wearSkin('vesper', baseSkinForHunter('vesper').id);
    expect(useHunterWardrobeStore.getState().wornByHunter.vesper).toBe(baseSkinForHunter('vesper').id);
    // The selection persists device-locally.
    const saved = JSON.parse(window.localStorage.getItem('cc-hunter-wardrobe') ?? '{}') as Record<string, unknown>;
    expect(saved.vesper).toBe(baseSkinForHunter('vesper').id);
  });
});

describe('B1 — the hero plate is the active hunter', () => {
  it('headlines the fielded hunter with painting + tree line; the gauge reads their pool', () => {
    // Level 20 → 19 earned; Silas (Demolition) has 2 budget spent.
    useSkillStore.setState({ activeHunterId: 'silas', spent: { demo_ord_1: 2, gs_dmg_1: 4 } });
    render(<ProfileScreen onNavigate={() => {}} />);

    const hero = screen.getByTestId('hunter-hero');
    expect(hero.textContent).toContain('Silas Boone');
    expect(screen.getByTestId('hunter-hero-line').textContent).toBe("Demolition · Demolitionist's Stance");
    const figure = screen.getByTestId('hunter-hero-figure') as HTMLImageElement;
    expect(figure.src).toContain('hunter-silas-boone');
    // The roster door names the same fielded hunter.
    expect(screen.getByTestId('hub-door-roster').textContent).toContain('Fielding Silas Boone · Demolition');
    // Gauge = Silas's pool: 19 − 2 = 17 (Vesper's 4 spent are hers).
    expect(screen.getByTestId('hub-door-trees').textContent).toContain('17 points unspent');
    expect(screen.getByTestId('hunter-announce-points').textContent).toContain('17 skill points to spend');
  });
});

describe('B2 — roster switch swaps the tree', () => {
  it('fields the tapped hunter through the server op and the trees stop follows', async () => {
    render(<ProfileScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId('hub-door-roster'));

    for (const id of ['vesper', 'silas', 'josie', 'doc']) {
      expect(screen.getByTestId(`roster-hunter-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId('roster-hunter-vesper').textContent).toContain('Fielded');

    fireEvent.click(screen.getByTestId('roster-hunter-doc'));
    expect(hoisted.setActiveHunter).toHaveBeenCalledTimes(1);
    expect(hoisted.setActiveHunter.mock.calls[0][0].hunterId).toBe('doc');

    await waitFor(() => {
      expect(useSkillStore.getState().activeHunterId).toBe('doc');
    });
    await waitFor(() => {
      expect(screen.getByTestId('roster-hunter-doc').textContent).toContain('Fielded');
    });

    // The trees stop now shows Doc's tree, with respec still on it.
    fireEvent.click(screen.getByTestId('roster-open-trees'));
    expect(screen.getByText('Fixer Board')).toBeTruthy();
    expect(screen.getByText(/Doc Sutter's tree/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /respec/i })).toBeTruthy();
  });

  it('rolls back and reports when the switch fails', async () => {
    hoisted.setActiveHunter.mockRejectedValue(new Error('Chef unreachable'));
    render(<ProfileScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId('hub-door-roster'));
    fireEvent.click(screen.getByTestId('roster-hunter-silas'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Chef unreachable');
    });
    expect(useSkillStore.getState().activeHunterId).toBe('vesper');
  });
});

describe('B3 — the wardrobe wears wholes', () => {
  it('lists whole skins with worn/owned counts; wear/remove works; no part surface remains', () => {
    render(<ProfileScreen onNavigate={() => {}} />);
    // The hub door prints whole-skin counts for the fielded hunter.
    expect(screen.getByTestId('hub-door-wardrobe').textContent).toContain('1 worn · 1 owned');

    fireEvent.click(screen.getByTestId('hub-door-wardrobe'));
    expect(screen.getByTestId('wardrobe-console')).toBeTruthy();
    // The parts fitting console is gone from the stop.
    expect(screen.queryByTestId('wardrobe-channels')).toBeNull();
    expect(screen.queryByTestId('wardrobe-guest-note')).toBeNull();

    const row = screen.getByTestId('wardrobe-skin-vesper-standard-issue');
    expect(row.textContent).toContain('Standard Issue');
    expect(row.textContent).toContain('Worn');
    expect(screen.getByTestId('wardrobe-showcase-painting')).toBeTruthy();

    fireEvent.click(screen.getByTestId('wardrobe-remove-vesper-standard-issue'));
    expect(useHunterWardrobeStore.getState().wornByHunter.vesper).toBeNull();
    expect(screen.getByTestId('wardrobe-wear-vesper-standard-issue')).toBeTruthy();

    fireEvent.click(screen.getByTestId('wardrobe-wear-vesper-standard-issue'));
    expect(useHunterWardrobeStore.getState().wornByHunter.vesper).toBe('vesper-standard-issue');
    expect(screen.getByTestId('wardrobe-skin-vesper-standard-issue').textContent).toContain('Worn');
  });
});

describe('B5 — guests see it all', () => {
  it('a fresh guest sees roster, trees, and wardrobe with real data and no locks', async () => {
    hoisted.auth.account = guestAccount;
    render(<ProfileScreen onNavigate={() => {}} />);

    fireEvent.click(screen.getByTestId('hub-door-roster'));
    expect(screen.getByTestId('roster-hunter-josie').textContent).toContain('Josie Lode');
    expect(screen.getByTestId('roster-hunter-doc').textContent).toContain('Doc Sutter');

    fireEvent.click(screen.getByTestId('hunter-back-menu'));
    fireEvent.click(screen.getByTestId('hub-door-trees'));
    expect(screen.getByText('Gunslinger Board')).toBeTruthy();

    fireEvent.click(screen.getByTestId('hunter-back-menu'));
    fireEvent.click(screen.getByTestId('hub-door-wardrobe'));
    const console_ = screen.getByTestId('wardrobe-console');
    expect(console_.textContent).toContain('Standard Issue');
    expect(console_.textContent).not.toContain('Sign in');
    // Wearing is open to the guest too — it is not a transaction.
    expect(screen.getByTestId('wardrobe-remove-vesper-standard-issue')).toBeTruthy();
  });
});
