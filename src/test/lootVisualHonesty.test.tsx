import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { lootRiseVisualForEvent } from '@/lib/pixel/lootMoment';
import { getRoamingArea, DEFAULT_ROAMING_AREA_ID } from '@/constants/roamingAreas';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { useTickFeedStore } from '@/store/slices/tickSlice';
import type { TickEvent } from '@/store/slices/tickSlice';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

/**
 * Loot-visual honesty (Michael's ruling, 2026-11-02): the roaming scene's
 * cache-crate rise previously fired for every loot-like non-gear tick —
 * in practice ordinary KILL ticks — while roaming grants only cache
 * fragments, materials, and the base credits/scrap/XP payout. Cache Boxes
 * live only in the Cache Box lane. These tests pin the honest mapping:
 * each grant rises as itself, and the crate rises only for a real cache
 * grant (tone 'cache' — no roaming producer emits one today).
 */

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
     
     
     
    />,
  );

const crateUrl = () => getPixelSprite('crate')?.url;
const cratePixelsOnStage = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('img')).filter((img) => img.getAttribute('src') === crateUrl());

beforeEach(() => {
  useTickFeedStore.getState().clear();
});

describe('lootRiseVisualForEvent — the grant drives the visual', () => {
  const ev = (partial: Partial<TickEvent>): TickEvent =>
    ({ id: 't-1', at: 1, tone: 'xp', label: '', detail: '', ...partial }) as TickEvent;

  it('a cache fragment tick maps to the key shard, not the crate', () => {
    expect(lootRiseVisualForEvent(ev({ tone: 'fragment', label: '+1 cache fragment', value: 1 }))).toBe('fragment');
  });

  it('material and essence finds map to their own icons', () => {
    expect(lootRiseVisualForEvent(ev({ tone: 'material', label: '+2 ScrapAlloy', value: 2 }))).toBe('material');
    expect(lootRiseVisualForEvent(ev({ tone: 'essence', label: '+1 Ember Essence', value: 1 }))).toBe('essence');
  });

  it('a kill tick (credits/scrap/XP payout) maps to the scrap rise', () => {
    expect(lootRiseVisualForEvent(ev({ tone: 'kill', label: '+12cr · +3 scrap · +8 XP', value: 12 }))).toBe('scrap');
    expect(lootRiseVisualForEvent(ev({ tone: 'kill', label: 'Raider down', value: 30 }))).toBe('scrap');
  });

  it('a cash tick maps by what it paid: scrap or credits', () => {
    expect(lootRiseVisualForEvent(ev({ tone: 'cash', label: '+4 scrap', value: 4 }))).toBe('scrap');
    expect(lootRiseVisualForEvent(ev({ tone: 'cash', label: '+25cr', value: 25 }))).toBe('credits');
  });

  it('only a real cache grant (tone cache) maps to the crate', () => {
    expect(lootRiseVisualForEvent(ev({ tone: 'cache', label: 'Cache key earned', value: 1 }))).toBe('crate');
  });

  it('gear drops and damage ticks get no rise — the LootMoment and the hit FX own them', () => {
    expect(lootRiseVisualForEvent(ev({ tone: 'loot', label: 'Volt Carbine', gear: makeWeapon() }))).toBeNull();
    expect(lootRiseVisualForEvent(ev({ tone: 'loot', label: '-45', value: 45 }))).toBeNull();
  });

  it('non-loot tones and the idle sentinel get no rise', () => {
    expect(lootRiseVisualForEvent(ev({ tone: 'xp', label: '+8 XP', value: 8 }))).toBeNull();
    expect(lootRiseVisualForEvent(ev({ tone: 'level', label: 'Level up', value: 6 }))).toBeNull();
    expect(lootRiseVisualForEvent(ev({ id: 'idle-loop-ready', tone: 'kill', label: 'x' }))).toBeNull();
    expect(lootRiseVisualForEvent(undefined)).toBeNull();
  });
});

describe('LiveTurfDiorama — honest loot rises on the pixel stage', () => {
  it('a fragment tick rises the key shard and NOT the crate (was: no tell for fragments, crate reserved)', () => {
    pushEvent({ tone: 'fragment', label: '+1 cache fragment', value: 1 });
    const { container } = renderDiorama();
    const rise = screen.getByTestId('diorama-loot-rise');
    expect(rise.getAttribute('data-loot-visual')).toBe('fragment');
    expect(screen.queryByTestId('diorama-crate-rise')).toBeNull();
    expect(cratePixelsOnStage(container)).toHaveLength(0);
  });

  it('a material tick rises the material icon and NOT the crate', () => {
    pushEvent({ tone: 'material', label: '+2 ScrapAlloy', value: 2 });
    const { container } = renderDiorama();
    expect(screen.getByTestId('diorama-loot-rise').getAttribute('data-loot-visual')).toBe('material');
    expect(screen.queryByTestId('diorama-crate-rise')).toBeNull();
    expect(cratePixelsOnStage(container)).toHaveLength(0);
  });

  it('an essence tick rises the essence icon and NOT the crate', () => {
    pushEvent({ tone: 'essence', label: '+1 Ember Essence', value: 1 });
    const { container } = renderDiorama();
    expect(screen.getByTestId('diorama-loot-rise').getAttribute('data-loot-visual')).toBe('essence');
    expect(screen.queryByTestId('diorama-crate-rise')).toBeNull();
    expect(cratePixelsOnStage(container)).toHaveLength(0);
  });

  it('a kill tick rises scrap and NOT the crate (regression: kill ticks were the constant false-crate case)', () => {
    pushEvent({ tone: 'kill', label: '+12cr · +3 scrap · +8 XP', value: 12 });
    const { container } = renderDiorama();
    expect(screen.getByTestId('diorama-loot-rise').getAttribute('data-loot-visual')).toBe('scrap');
    expect(screen.queryByTestId('diorama-crate-rise')).toBeNull();
    expect(cratePixelsOnStage(container)).toHaveLength(0);
    // The kill beat itself is untouched.
    expect(screen.getByTestId('fx-dust-ring')).toBeTruthy();
  });

  it('a real cache grant (tone cache) rises the crate sprite itself', () => {
    pushEvent({ tone: 'cache', label: 'Cache key earned', value: 1 });
    const { container } = renderDiorama();
    const rise = screen.getByTestId('diorama-crate-rise');
    expect(rise.tagName).toBe('IMG');
    expect(rise.getAttribute('src')).toBe(crateUrl());
    expect(screen.queryByTestId('diorama-loot-rise')).toBeNull();
    expect(cratePixelsOnStage(container)).toHaveLength(1);
  });

  it('a damage tick (tone loot, negative label) rises nothing — it is not loot', () => {
    pushEvent({ tone: 'loot', label: '-45', value: 45 });
    const { container } = renderDiorama();
    expect(screen.queryByTestId('diorama-loot-rise')).toBeNull();
    expect(screen.queryByTestId('diorama-crate-rise')).toBeNull();
    expect(cratePixelsOnStage(container)).toHaveLength(0);
  });

  it('a gear drop keeps its LootMoment and gets no rise of either kind', () => {
    pushEvent({ tone: 'loot', label: 'Volt Carbine', detail: 'Rare SMG', gear: makeWeapon() });
    renderDiorama();
    expect(screen.getByTestId('diorama-loot-moment')).toBeTruthy();
    expect(screen.queryByTestId('diorama-loot-rise')).toBeNull();
    expect(screen.queryByTestId('diorama-crate-rise')).toBeNull();
  });
});
