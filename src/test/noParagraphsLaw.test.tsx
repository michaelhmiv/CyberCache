/**
 * THE NO-PARAGRAPHS LAW, mechanically enforced (owner ruling
 * 2026-11-05; DESIGN.md Standing laws). This slice's machine-check
 * promotion: prose laws used to live only in comments and review —
 * this test makes the law executable on the screen that provoked
 * it, the Gear Loadout.
 *
 * Audit X-05 (2026-11-12): the scan's scope was ONE screen while
 * the law is general — violations lived unscanned on Home
 * (HeroRundown's buff-line suffixes) and Gear (the GearHub tagline
 * and the expanded Garage's paragraphs, G-F7). The same detector,
 * unchanged, now also scans Home (standby, standby mod active) and
 * the merged Gear page (InventoryScreen — Loadout + Garage
 * expanded + GearHub in one scroll). The violating copy was
 * trimmed in the same change.
 *
 * The law: a screen carries no explanatory sentences/paragraphs.
 * A section gets its label, its controls, and a "?" beside the
 * label; explanations live in the pop-up behind the "?".
 *
 * The check renders the Loadout in the exact state that used to
 * print all three offending blocks at once (vehicle equipped and
 * out of fuel → the out-of-fuel paragraph; belt slots empty → the
 * remedy line; plus the always-printed belt caption), walks every
 * VISIBLE direct text node, and fails on anything shaped like
 * explanatory prose. Prose shape, pragmatically: item names, stat
 * lines, labels, and state words never end in sentence punctuation
 * after 6+ words, never carry two sentence terminators, and never
 * run 120+ characters — the retired blocks did all three (55–190
 * chars, 1–3 sentences each). Screen-reader-only text (sr-only)
 * is not screen text and is exempt, as is anything inside the
 * help pop-up — that is where prose is FOR.
 *
 * Teeth: this file imports nothing the pre-change screen didn't
 * have, and its first test FAILS on the pre-change tree (verified
 * against origin/master: the scan names the out-of-fuel
 * paragraph, the belt caption, and the remedy line).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import {
  useActivityStore,
  useBossStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSurvivalStore,
  useTickFeedStore,
  useWorkshopStore,
} from '@/store';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { SyncedLoadoutScreen } from '@/screens/SyncedLoadoutScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { InventoryScreen } from '@/screens/InventoryScreen';
import { IDLE_ACTIVITY } from '@/types/activity';
import type { Weapon } from '@/types/items';

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
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/api/leaderboardService', () => ({
  getLeaderboard: vi.fn(),
  getWeeklyLeaderboards: vi.fn(() => Promise.resolve({
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
vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getCacheRankState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getResearchState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getStandingState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getContractsState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getActionSkillState: vi.fn(async () => null),
}));
vi.mock('@/lib/api/statsService', () => ({ getMyStatsSummary: vi.fn(async () => null) }));
vi.mock('@/lib/api/usernameService', () => ({ getMyProfileSummary: vi.fn(async () => null) }));
vi.mock('@/lib/api/progressionService', () => ({
  getMyProgressionSnapshots: vi.fn(async () => []),
  extractMetricSeries: () => [],
}));
vi.mock('@/lib/api/masteryService', () => ({
  getMyMasterySummary: vi.fn(async () => []),
  masteryLevelProgress: () => ({ level: 1, current: 0, next: 100, pct: 0 }),
}));
vi.mock('@/lib/ads/rewardedCacheAd', () => ({
  canUseRewardedCacheAds: () => false,
  showRewardedCacheAd: vi.fn(async () => { throw new Error('ads unavailable in tests'); }),
}));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: IntersectionObserverCallback) {
  return {
    observe: (target: Element) => callback([{ isIntersecting: false, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: () => undefined,
    disconnect: () => undefined,
  };
}) as unknown as typeof IntersectionObserver;

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    equipItem: vi.fn(async () => ({})),
    unequipSlot: vi.fn(async () => ({})),
    refuelVehicle: vi.fn(async () => ({})),
    enqueueRepairJob: vi.fn(async () => ({})),
  },
  fetchWorkshopState: vi.fn(async () => ({
    benches: 1, tools: {}, jobs: [], masteries: {},
    activeActionKind: null, recentCompletions: [],
  })),
  fetchRepairBoard: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchShieldTechBoard: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchCollections: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchProfileLifetime: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

const scrapBike = (overrides: Partial<VehicleDisplay> = {}): VehicleDisplay => ({
  id: 'veh-1', name: 'Scrap Bike', vehicleClassId: 'scrap_bike', level: 1,
  rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
  isLocked: false, pixelSeed: 1, conditionCurrent: 100, conditionMax: 100,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLoadoutStore.setState({
    slots: {
      primary: null, secondary: null, heavy: null, ordnance: null,
      shield: null, classMod: null, relic: null, vehicle: 'veh-1',
    },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({ consumables: {}, vehicleFuel: 0 });
  useVehicleStore.setState({ vehicles: [scrapBike()], lastClaimStatus: null });
});

/** Every visible direct-text block under root, minus the exempt
 *  zones (the help pop-up's subtree, screen-reader-only text).
 *  The text check runs first and the (expensive, cached) computed-
 *  style visibility walk only touches text-bearing elements —
 *  the pixel actor's DOM is thousands of textless nodes. */
function visibleDirectTexts(root: HTMLElement, { includePopUp = false } = {}): string[] {
  const out: string[] = [];
  const styleCache = new Map<globalThis.Element, CSSStyleDeclaration>();
  const styleOf = (el: globalThis.Element) => {
    let s = styleCache.get(el);
    if (!s) {
      s = window.getComputedStyle(el);
      styleCache.set(el, s);
    }
    return s;
  };
  root.querySelectorAll('*').forEach((el) => {
    let text = '';
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? '';
    });
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (!includePopUp && el.closest('[data-testid="help-hint-sheet"]')) return;
    // A CLOSED <details> disclosure is prose's other sanctioned home
    // (DESIGN.md §1: rules prose sits behind a disclosure, e.g. the
    // belt rules). Real browsers hide a closed disclosure's content
    // (display:none — this walk would skip it); jsdom does not
    // implement that hiding, so emulate the browser truth here.
    if (!includePopUp && el.closest('details:not([open])')) return;
    if (el.classList.contains('sr-only') || el.closest('.sr-only')) return;
    let node: globalThis.Element | null = el;
    let hidden = false;
    while (node && node !== root) {
      const s = styleOf(node);
      if (s.display === 'none' || s.visibility === 'hidden') { hidden = true; break; }
      node = node.parentElement;
    }
    if (!hidden) out.push(text);
  });
  return out;
}

/** Explanatory-prose shape — see the header for the thresholds. */
function isParagraph(text: string): boolean {
  const terminators = (text.match(/[.!?…]/g) ?? []).length;
  const words = text.split(' ').filter(Boolean).length;
  if (terminators >= 2) return true;
  if (text.length >= 120 && terminators >= 1) return true;
  if (words >= 6 && /[.!?]$/.test(text)) return true;
  return false;
}

describe('no-paragraphs law — the Loadout screen', () => {
  // A full-screen render + DOM scan; the timeout is sized for a
  // loaded CI runner, the same reason heavy suites in this repo
  // carry explicit timeouts.
  it('no visible text on the Loadout is explanatory prose', () => {
    const { container } = render(<SyncedLoadoutScreen />);
    const offenders = visibleDirectTexts(container).filter(isParagraph);
    expect(offenders).toEqual([]);
  }, 30000);

  it('the pop-up is the prose\'s home — the scan sees it there, and only there', async () => {
    const { container } = render(<SyncedLoadoutScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'About Consumable Belt' }));
    const sheet = await screen.findByTestId('help-hint-sheet');
    // Non-vacuity: pointed INSIDE the pop-up, the same detector
    // finds the explanation's sentences — it can see prose when
    // prose exists; the screen scan above is not passing blind.
    const inside = visibleDirectTexts(sheet, { includePopUp: true }).filter(isParagraph);
    expect(inside.length).toBeGreaterThanOrEqual(3);
    // And with the pop-up open, the screen behind it is still clean.
    const offenders = visibleDirectTexts(container).filter(isParagraph);
    expect(offenders).toEqual([]);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Audit X-05 — the same scan, unchanged, over Home and the Gear page.
// Both renders failed this scan on the pre-fix tree: Home carried
// HeroRundown's two explanatory suffixes; the Gear page carried the
// GearHub tagline and the expanded Garage's paragraphs (G-F7).
// ---------------------------------------------------------------------------

const standbyWeapon: Weapon = {
  id: 'weapon-1',
  name: 'Test Weapon',
  level: 1,
  rarity: Rarity.Common,
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Redline,
  element: Element.Kinetic,
  rollQuality: 50,
  baseDamage: 10,
  attackSpeed: 1,
  critChance: 0.1,
  critDamage: 1.5,
  statusChance: 0,
  statusDamage: 0,
  bossDamageMod: 0,
  waveDamageMod: 0,
  shieldDamageMod: 0,
  armorDamageMod: 0,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  parts: [],
  affixes: [{
    id: 'standby-mod', category: 'activity', stat: 'idle_standbyModule',
    value: 1, displayText: 'Standby Module',
    subStats: { offlineEarningsMod: 0.06 },
  }],
  legendaryEffectId: undefined,
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 0,
  combatPower: 0,
  bossPower: 0,
  farmPower: 0,
  economyScore: 0,
};

describe('no-paragraphs law — Home (audit X-05)', () => {
  beforeEach(() => {
    hoisted.auth.account = {
      userId: 'user-1', accountType: 'verified', username: 'hunter', hasUsername: true,
      email: 'hunter@example.com', emailVerifiedAt: '2026-11-01T00:00:00.000Z',
      verificationGraceExpiresAt: null, verificationReminderLastSeenAt: null, isAnonymous: false,
    } as never;
    usePlayerStore.setState({ profileLoaded: true, level: 10, xp: 0, credits: 500, consumables: {}, vehicleFuel: 0 });
    useInventoryStore.setState({ items: [standbyWeapon] });
    useLoadoutStore.setState({
      slots: {
        primary: 'weapon-1', secondary: null, heavy: null, ordnance: null,
        shield: null, classMod: null, relic: null, vehicle: 'veh-1',
      },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    useActivityStore.setState({ current: IDLE_ACTIVITY, hydrated: true, pending: false, error: null });
    useBossStore.setState({ currentBossId: null, defeatedBossIds: [], preparedConsumables: {} });
    useTickFeedStore.setState({ events: [] });
    useSurvivalStore.setState({ currentHp: 800, shieldHp: 0, isDead: false, medKitBuffer: 0 });
    useWorkshopStore.setState({ server: null, loading: false, error: null });
    useOfflineRecapStore.getState().reset();
  });

  it('no visible text on Home is explanatory prose (standby, standby mod active)', async () => {
    const { container } = render(<HomeScreen onNavigate={() => {}} />);
    // The standby buff line must actually be on screen — the state
    // that carried the offending suffixes — or the scan is blind.
    const buffLine = await screen.findByTestId('hero-buff-line');
    expect(buffLine.textContent).toContain('Offline Earnings +6%');
    const offenders = visibleDirectTexts(container).filter(isParagraph);
    expect(offenders).toEqual([]);
  }, 30000);
});

describe('no-paragraphs law — the Gear page (audit X-05 + G-F7)', () => {
  it('no visible text on the Gear page is explanatory prose (Garage expanded, out of fuel)', async () => {
    const { container } = render(
      <InventoryScreen onNavigate={() => {}} tabIntent={{ tab: 'loadout', seq: 1, expandVehicle: true }} />,
    );
    // The expanded Garage must actually be on screen — the state
    // whose paragraphs escaped the old one-screen scan.
    expect(await screen.findByTestId('garage-panel')).toBeTruthy();
    expect(screen.getByTestId('garage-out-of-fuel')).toBeTruthy();
    const offenders = visibleDirectTexts(container).filter(isParagraph);
    expect(offenders).toEqual([]);
  }, 30000);
});
