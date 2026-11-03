/**
 * Compact event pop-ups (owner ruling, 2026-11-02, from device play):
 * the Home gain-toast cards carried a narrative detail line that
 * restated what the player is watching on the stage ("FIELD SWEEP
 * RECOVERED BALLISTICPARTS.", "SILT MARSHAL HIT YOU FOR 12 HP.") and
 * two of them walled off the lower screen. The ruling: keep the
 * numbers/outcomes (the label already carries them), cut the
 * narration, make the cards smaller, at most two visible, and only
 * briefly. Inside the headline the NUMBER is the hero (the owner's
 * numbers philosophy, same evening): gain values print in the
 * game's gain-green at full weight — the kill payout previously
 * printed gray — damage taken keeps its red, and the words beside
 * a value sit quieter. Loot carve-out: Epic/Legendary drops keep their full
 * two-line toast (their amplified presentation — the stage
 * LootMoment — is untouched by this slice); Rare drops stay clearly
 * visible inside the compact form via their rarity stamp.
 *
 * The full detail is NOT deleted from the game: the same events keep
 * rendering label + detail in the deck's Now rows (asserted below)
 * and in the workspace reward stream.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { DashboardDeck } from '@/components/dashboard/DashboardDeck';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useActivityStore } from '@/store/slices/activitySlice';
import { useBossStore } from '@/store/slices/bossSlice';
import { useTickFeedStore, type TickEvent } from '@/store/slices/tickSlice';
import { IDLE_ACTIVITY } from '@/types/activity';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

const makeWeapon = (overrides: Partial<Weapon> = {}): Weapon =>
  ({
    id: 'w-1',
    name: 'Volt Carbine',
    level: 7,
    rarity: Rarity.Rare,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Prismatek,
    element: Element.Shock,
    rollQuality: 62,
    baseDamage: 2847,
    attackSpeed: 6.2,
    critChance: 0.15,
    critDamage: 150,
    statusChance: 20,
    statusDamage: 45,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 0,
    armorDamageMod: 0,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 7,
    combatPower: 100,
    bossPower: 90,
    farmPower: 80,
    economyScore: 10,
    ...overrides,
  }) as Weapon;

let seq = 0;
const ev = (partial: Partial<TickEvent>): TickEvent =>
  ({
    id: `tick:test-${seq++}`,
    at: Date.now(),
    tone: 'xp',
    label: '',
    detail: '',
    ...partial,
  }) as TickEvent;

const seedEvents = (events: TickEvent[]) => {
  useTickFeedStore.setState({ events });
};

beforeEach(() => {
  useLoadoutStore.setState({
    slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({
    id: 'test',
    name: 'tester',
    level: 5,
    xp: 0,
    credits: 0,
    scrap: 0,
    cacheKeys: 0,
    cacheKeyFragments: 0,
    currentZoneId: 'dustwaste_1',
    highestZoneId: 'dustwaste_1',
    offlineCapHours: 2,
    lastClaimTime: 0,
    deathFeeInsurance: false,
    consumables: {},
    consumableBatches: [],
    materials: {},
    essences: {},
    workshopQueues: [],
    lastWorkshopTick: 0,
    lastClaimedTick: 0,
  });
  useInventoryStore.setState({ items: [] });
  useActivityStore.setState({ current: IDLE_ACTIVITY, hydrated: true, pending: false, error: null });
  useBossStore.setState({ currentBossId: null, defeatedBossIds: [] });
  useTickFeedStore.setState({ events: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Compact event pop-ups — routine events are headline-only', () => {
  it('a material find shows "+1 BallisticParts" and no narrative line in the toast', () => {
    seedEvents([ev({ tone: 'material', label: '+1 BallisticParts', detail: 'Field sweep recovered BallisticParts.', value: 1 })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    expect(toast.dataset.toastVariant).toBe('compact');
    // The label survives whole — it is split into hero + subject
    // spans, never shortened.
    expect(toast.textContent).toContain('+1 BallisticParts');
    expect(within(toast).queryByText(/Field sweep recovered/)).toBeNull();
    // The detail is not gone from the game — the deck's Now row for
    // the same event still carries it.
    expect(screen.getByText(/Field sweep recovered BallisticParts\./)).toBeInTheDocument();
  });

  it('a damage event shows "-12 HP" and no "hit you for" narration in the toast', () => {
    seedEvents([ev({ tone: 'damage', label: '-12 HP', detail: 'Silt Marshal hit you for 12 HP.', value: 12 })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    expect(toast.dataset.toastVariant).toBe('compact');
    expect(toast.textContent).toContain('-12 HP');
    expect(within(toast).queryByText(/hit you for/)).toBeNull();
  });

  it('a kill payout shows its combined credits · scrap · XP headline only', () => {
    seedEvents([ev({ tone: 'kill', label: '+12.5cr · +3 scrap · +16 XP', detail: 'Raiders routed in Dustwaste Frontier.' })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    expect(toast.dataset.toastVariant).toBe('compact');
    expect(toast.textContent).toContain('+12.5cr · +3 scrap · +16 XP');
    expect(within(toast).queryByText(/routed in/)).toBeNull();
  });
});

describe('Compact event pop-ups — the number is the hero (owner numbers philosophy)', () => {
  it('a gain value prints in the game gain-green at full weight, its subject quieter', () => {
    seedEvents([ev({ tone: 'material', label: '+1 BallisticParts', detail: 'Field sweep recovered BallisticParts.', value: 1 })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    const hero = within(toast).getByText('+1');
    expect(hero.className).toContain('text-green');
    expect(hero.className).toContain('font-black');
    const subject = within(toast).getByText('BallisticParts');
    expect(subject.className).toContain('text-text-secondary');
    expect(subject.className).not.toContain('text-green');
  });

  it('every value in a kill payout is a green hero — the kill tone no longer prints gray', () => {
    seedEvents([ev({ tone: 'kill', label: '+12.5cr · +3 scrap · +16 XP', detail: 'Raiders routed in Dustwaste Frontier.' })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    for (const head of ['+12.5', '+3', '+16']) {
      expect(within(toast).getByText(head).className).toContain('text-green');
    }
    for (const subject of ['cr', 'scrap']) {
      expect(within(toast).getByText(subject).className).toContain('text-text-secondary');
    }
    // The XP subject shares its text with the XP icon glyph; the
    // quieter rendering is the one carrying the secondary class.
    const xpSpans = within(toast).getAllByText('XP');
    expect(xpSpans.some((el) => el.className.includes('text-text-secondary'))).toBe(true);
  });

  it('damage taken keeps its red hero', () => {
    seedEvents([ev({ tone: 'damage', label: '-12 HP', detail: 'Silt Marshal hit you for 12 HP.', value: 12 })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    const hero = within(toast).getByText('-12');
    expect(hero.className).toContain('text-red');
    expect(hero.className).toContain('font-black');
    expect(within(toast).getByText('HP').className).toContain('text-text-secondary');
  });

  it('a shield heal prints its value as a green hero', () => {
    seedEvents([ev({ tone: 'heal', label: '+20 shield', detail: 'Patch rig restored 20 shield.' })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    expect(within(toast).getByText('+20').className).toContain('text-green');
    expect(within(toast).getByText('shield').className).toContain('text-text-secondary');
  });

  it('damage DEALT (a bare hit number on the loot tone) is a hero but not red — red is damage taken', () => {
    seedEvents([ev({ tone: 'loot', label: '-450', detail: 'Silt Marshal took 450.' })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    const hero = within(toast).getByText('-450');
    expect(hero.className).toContain('font-black');
    expect(hero.className).toContain('text-amber');
    expect(hero.className).not.toContain('text-red');
  });
});

describe('Compact event pop-ups — the loot carve-out', () => {
  it('a Common drop uses the compact card, name only', () => {
    const gear = makeWeapon({ name: 'Rusty Pistol', rarity: Rarity.Common });
    seedEvents([ev({ tone: 'loot', label: 'Rusty Pistol', detail: 'Common pistol · 40 Power', gear })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    expect(toast.dataset.toastVariant).toBe('compact');
    expect(within(toast).getByText('Rusty Pistol')).toBeInTheDocument();
    expect(within(toast).queryByText(/Common pistol/)).toBeNull();
  });

  it('a Rare drop stays clearly visible: compact card with its RARE stamp', () => {
    const gear = makeWeapon({ name: 'Volt Carbine', rarity: Rarity.Rare });
    seedEvents([ev({ tone: 'loot', label: 'Volt Carbine', detail: 'Rare smg · 100 Power · Shock · Prismatek', gear })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    expect(toast.dataset.toastVariant).toBe('compact');
    expect(within(toast).getByText('RARE')).toBeInTheDocument();
    expect(within(toast).getByText('Volt Carbine')).toBeInTheDocument();
    expect(within(toast).queryByText(/Rare smg/)).toBeNull();
  });

  it('an Epic drop keeps the full two-line toast, detail included', () => {
    const gear = makeWeapon({ name: 'Ember Herald', rarity: Rarity.Epic });
    seedEvents([ev({ tone: 'loot', label: 'Ember Herald', detail: 'Epic sniper · 210 Power · Fire · Helix', gear })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    expect(toast.dataset.toastVariant).toBe('amplified');
    expect(within(toast).getByText('Ember Herald')).toBeInTheDocument();
    expect(within(toast).getByText(/Epic sniper · 210 Power/)).toBeInTheDocument();
  });

  it('a Legendary drop keeps the full two-line toast, detail included', () => {
    const gear = makeWeapon({ name: 'Vortex Singularity', rarity: Rarity.Legendary });
    seedEvents([ev({ tone: 'loot', label: 'Vortex Singularity', detail: 'Legendary smg · 340 Power · Corrosive · Vortex', gear })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toast = screen.getByTestId('gain-toast');
    expect(toast.dataset.toastVariant).toBe('amplified');
    expect(within(toast).getByText(/Legendary smg · 340 Power/)).toBeInTheDocument();
  });
});

describe('Compact event pop-ups — stacking and transience', () => {
  it('never shows more than two cards, and they are the newest two', () => {
    seedEvents([
      ev({ tone: 'material', label: '+1 BallisticParts', detail: 'Field sweep recovered BallisticParts.' }),
      ev({ tone: 'damage', label: '-12 HP', detail: 'Silt Marshal hit you for 12 HP.' }),
      ev({ tone: 'fragment', label: '+1 cache fragment', detail: 'Patrol yielded a cache key fragment.' }),
      ev({ tone: 'xp', label: '+16 XP', detail: 'Raider patrol cleared.' }),
    ]);
    render(<DashboardDeck onNavigate={() => {}} />);
    const toasts = screen.getAllByTestId('gain-toast');
    expect(toasts).toHaveLength(2);
    expect(within(toasts[0]).getByText('+1')).toBeInTheDocument();
    expect(within(toasts[1]).getByText('-12')).toBeInTheDocument();
  });

  it('a card clears after its display window instead of parking on screen', async () => {
    vi.useFakeTimers();
    seedEvents([ev({ tone: 'material', label: '+1 BallisticParts', detail: 'Field sweep recovered BallisticParts.' })]);
    render(<DashboardDeck onNavigate={() => {}} />);
    expect(screen.getByTestId('gain-toast')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    // The display window has closed, so the deck stops rendering the
    // card. AnimatePresence still has to play the exit on the real
    // rAF clock (fake timers do not drive it) — hand it real time.
    vi.useRealTimers();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(screen.queryByTestId('gain-toast')).toBeNull();
  });
});
