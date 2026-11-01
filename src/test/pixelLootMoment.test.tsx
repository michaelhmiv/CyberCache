import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LootMoment } from '@/components/pixelArt/LootMoment';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { MOVEMENT } from '@/lib/pixel/movement';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { getRoamingArea, DEFAULT_ROAMING_AREA_ID } from '@/constants/roamingAreas';
import { useTickFeedStore } from '@/store/slices/tickSlice';
import type { TickEvent } from '@/store/slices/tickSlice';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

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
    // Real item contract: critChance is a fraction (the card renders
    // ×100). This fixture carried 15 — the percent-scale value the old
    // buggy celebration formatter was written against (DISP-03).
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
    parts: [
      { slot: 'Barrel', modifier: { baseDamage: 1.05 } },
      { slot: 'Grip', modifier: {} },
      { slot: 'Core', modifier: {} },
      { slot: 'Magazine', modifier: {} },
      { slot: 'Sight', modifier: {} },
      { slot: 'Chamber', modifier: {} },
    ],
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

const SEEN_KEY = 'cybercache:loot-moment-seen';

beforeEach(() => {
  localStorage.removeItem(SEEN_KEY);
  useTickFeedStore.getState().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LootMoment — full mode (stage surface)', () => {
  it('plays a beam + hero card with the drop’s real name, stamp, and stats', () => {
    render(<LootMoment items={[makeWeapon()]} surface="stage" testId="lm" />);
    expect(screen.getByTestId('lm').getAttribute('data-mode')).toBe('full');
    expect(screen.getByTestId('fx-loot-beam')).toBeTruthy();
    const hero = screen.getByTestId('loot-card-hero');
    expect(hero.textContent).toContain('Volt Carbine');
    expect(hero.textContent).toContain('RARE SMG');
    expect(hero.textContent).toContain('Dmg 2,847 · Spd 6.20 · Crit 15.0%');
    // No legendary treatment for a Rare.
    expect(screen.queryByTestId('fx-god-rays')).toBeNull();
    expect(screen.queryByTestId('loot-risen-item')).toBeNull();
  });

  it('gives a legendary the full treatment: dim, rays, risen weapon, gold card with flavor + stats', () => {
    const emberfall = makeWeapon({
      id: 'leg-1',
      name: 'Emberfall',
      rarity: Rarity.Legendary,
      weaponType: WeaponType.Sniper,
      element: Element.Fire,
      legendaryEffectId: 'glass_sun',
    });
    render(<LootMoment items={[emberfall]} surface="stage" testId="lm" />);
    expect(screen.getByTestId('loot-dim')).toBeTruthy();
    expect(screen.getByTestId('fx-god-rays')).toBeTruthy();
    expect(screen.getByTestId('fx-shockwave-ring')).toBeTruthy();
    expect(screen.getByTestId('fx-twinkles')).toBeTruthy();
    expect(screen.getByTestId('loot-risen-item')).toBeTruthy();
    // Bespoke sprite, not the compositor, for the named legendary.
    expect(screen.getByTestId('loot-risen-weapon').getAttribute('data-pixel-sprite')).toBe('legendary-emberfall');
    const hero = screen.getByTestId('loot-card-hero');
    expect(hero.textContent).toContain('Emberfall');
    expect(hero.textContent).toContain('★ LEGENDARY SNIPER');
    // P4 wave 2: the hand-written flavor override wins over the effect description.
    expect(hero.textContent).toContain('Sets the sky on fire. Literally.');
    expect(hero.textContent).toContain('Dmg 2,847');
  });

  it('climbs the ladder: earlier drops stack as plain cards under the current hero', () => {
    vi.useFakeTimers();
    const common = makeWeapon({ id: 'c-1', name: 'Scrap Rifle', rarity: Rarity.Common });
    const epic = makeWeapon({ id: 'e-1', name: 'Hexweaver', rarity: Rarity.Epic, weaponType: WeaponType.Beam });
    render(<LootMoment items={[epic, common]} surface="stage" testId="lm" />);
    // Ladder order is ascending regardless of input order: Common first.
    expect(screen.getByTestId('loot-card-hero').textContent).toContain('Scrap Rifle');
    expect(screen.queryByText('Hexweaver')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(MOVEMENT.LOOT_COMMON_MS + 10);
    });
    expect(screen.getByTestId('loot-card-hero').textContent).toContain('Hexweaver');
    // The earlier drop stays in the stack as a plain (non-hero) card.
    const stacked = screen.getAllByTestId('loot-card').map((el) => el.textContent).join(' ');
    expect(stacked).toContain('Scrap Rifle');
  });

  it('finishes on schedule and marks the moment seen', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<LootMoment items={[makeWeapon({ rarity: Rarity.Common })]} surface="stage" onDone={onDone} testId="lm" />);
    act(() => {
      vi.advanceTimersByTime(MOVEMENT.LOOT_COMMON_MS + 10);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SEEN_KEY)).toBe('1');
    expect(screen.queryByTestId('lm')).toBeNull();
  });

  it('tap does not skip on the first-ever view, but skips once seen', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const items = [
      makeWeapon({ id: 'a', rarity: Rarity.Common }),
      makeWeapon({ id: 'b', name: 'Second Drop', rarity: Rarity.Epic }),
    ];
    const { rerender } = render(<LootMoment items={items} surface="stage" onDone={onDone} testId="lm" />);
    // First view: tap is ignored — the moment keeps playing.
    fireEvent.pointerDown(screen.getByTestId('lm'));
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId('lm').getAttribute('data-step')).toBe('0');

    // After a completed view (seen flag set), a tap settles immediately.
    // (Advance per step: each step's timer is scheduled by an effect that
    // flushes between act() blocks.)
    act(() => {
      vi.advanceTimersByTime(MOVEMENT.LOOT_COMMON_MS + 10);
    });
    act(() => {
      vi.advanceTimersByTime(MOVEMENT.LOOT_EPIC_MS + 10);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    onDone.mockClear();
    rerender(<LootMoment key="second" items={items} surface="stage" onDone={onDone} testId="lm" />);
    fireEvent.pointerDown(screen.getByTestId('lm'));
    // Settled: the completed stack (both cards) is on screen…
    expect(screen.getByTestId('loot-card-stack').textContent).toContain('Second Drop');
    act(() => {
      vi.advanceTimersByTime(MOVEMENT.LOOT_SKIP_LINGER_MS + 10);
    });
    // …and the moment ends after the skip linger.
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('LootMoment — light mode (feed surface)', () => {
  it('is pointer-transparent, shows beam + compact card, never dims', () => {
    render(<LootMoment items={[makeWeapon()]} surface="feed" testId="lm" />);
    const root = screen.getByTestId('lm');
    expect(root.getAttribute('data-mode')).toBe('light');
    expect(root.className).toContain('pointer-events-none');
    expect(screen.getByTestId('fx-loot-beam')).toBeTruthy();
    // Light mode never dims and never shows the legendary layers.
    expect(screen.queryByTestId('loot-dim')).toBeNull();
    expect(screen.queryByTestId('fx-god-rays')).toBeNull();
  });
});

describe('LootMoment — reduced motion', () => {
  it('keeps beam + card + all info, drops rays/shockwave/twinkles', () => {
    const emberfall = makeWeapon({ id: 'leg-2', name: 'Emberfall', rarity: Rarity.Legendary, legendaryEffectId: 'glass_sun' });
    render(<LootMoment items={[emberfall]} surface="stage" reduced testId="lm" />);
    expect(screen.getByTestId('fx-loot-beam')).toBeTruthy();
    const hero = screen.getByTestId('loot-card-hero');
    expect(hero.textContent).toContain('Emberfall');
    expect(hero.textContent).toContain('Sets the sky on fire. Literally.');
    expect(hero.textContent).toContain('Dmg 2,847');
    expect(screen.getByTestId('loot-risen-item')).toBeTruthy();
    expect(screen.queryByTestId('fx-shockwave-ring')).toBeNull();
    expect(screen.queryByTestId('fx-twinkles')).toBeNull();
  });
});

describe('LootMoment — diorama wiring (real tick drops)', () => {
  const pushEvent = (event: Partial<TickEvent>) => {
    useTickFeedStore.getState().push([
      {
        id: `tick:${Math.random().toString(36).slice(2)}`,
        at: Date.now(),
        tone: 'xp',
        label: '',
        detail: '',
        ...event,
      } as TickEvent,
    ]);
  };
  const renderDiorama = () =>
    render(
      <LiveTurfDiorama
        area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
        activityKind="roaming_loot"
        playerLevel={5}
        equippedCount={3}
        cacheKeys={1}
        onFight={() => {}}
        onSecondary={() => {}}
      />,
    );

  it('a gear-drop tick event celebrates in the pixel scene', () => {
    pushEvent({ tone: 'loot', label: 'Volt Carbine', detail: 'Rare SMG', gear: makeWeapon() });
    renderDiorama();
    expect(screen.getByTestId('diorama-loot-moment')).toBeTruthy();
    expect(screen.getByTestId('diorama-loot-moment').textContent).toContain('Volt Carbine');
  });

  it('a hit tick event (tone loot, no gear) does not celebrate', () => {
    pushEvent({ tone: 'loot', label: '-45', value: 45 });
    renderDiorama();
    expect(screen.queryByTestId('diorama-loot-moment')).toBeNull();
  });

  it('a legendary drop in the feed escalates to the full treatment in-scene', () => {
    pushEvent({
      tone: 'loot',
      label: 'Emberfall',
      detail: 'Legendary Sniper',
      gear: makeWeapon({ id: 'leg-3', name: 'Emberfall', rarity: Rarity.Legendary, legendaryEffectId: 'glass_sun' }),
    });
    renderDiorama();
    const moment = screen.getByTestId('diorama-loot-moment');
    expect(moment.getAttribute('data-mode')).toBe('full');
    expect(screen.getByTestId('fx-god-rays')).toBeTruthy();
    expect(screen.getByTestId('loot-risen-item')).toBeTruthy();
  });
});
