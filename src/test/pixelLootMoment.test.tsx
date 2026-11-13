import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LootMoment } from '@/components/pixelArt/LootMoment';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { MOVEMENT } from '@/lib/pixel/movement';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Shield, Weapon } from '@/types/items';
import { pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import { resolveWeaponPainting, weaponPaintingShell } from '@/lib/pixel/weaponPaintingRender';

const makeShield = (overrides: Partial<Shield> = {}): Shield =>
  ({
    id: 's-1',
    name: 'Cryo Ironwood Shield',
    level: 30,
    rarity: Rarity.Epic,
    hp: 1757,
    rechargeRate: 40,
    // Real item contract: mitigation is a fraction — this is an 8% shield.
    mitigation: 0.08,
    element: Element.Cryo,
    affixes: [],
    sourceTag: DropSource.BossDrop,
    isLocked: false,
    pixelSeed: 3,
    ...overrides,
  }) as Shield;
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
  it('plays the item-moment reveal: the item rises and its deck lands staged', () => {
    render(<LootMoment items={[makeWeapon()]} surface="stage" testId="lm" />);
    expect(screen.getByTestId('lm').getAttribute('data-mode')).toBe('full');
    expect(screen.getByTestId('fx-loot-beam')).toBeTruthy();
    // The item itself rises at every rarity now (it never appeared for
    // a Rare before the reveal redesign).
    expect(screen.getByTestId('loot-risen-item')).toBeTruthy();
    expect(screen.getByTestId('loot-risen-weapon')).toBeTruthy();
    const hero = screen.getByTestId('loot-card-hero');
    expect(hero.textContent).toContain('Volt Carbine');
    // Deck stamp: rarity · type · element · level.
    expect(hero.textContent).toContain('RARE SMG · SHOCK · LV 7');
    // Hero figure + supports + the honest quality read.
    expect(hero.textContent).toContain('DAMAGE');
    expect(hero.textContent).toContain('2,847');
    expect(hero.textContent).toContain('6.20');
    expect(hero.textContent).toContain('15%');
    expect(hero.textContent).toContain('62');
    expect(hero.textContent).toContain('STRONG');
    // No legendary surplus for a Rare.
    expect(screen.queryByTestId('fx-god-rays')).toBeNull();
    expect(screen.queryByTestId('fx-shockwave-ring')).toBeNull();
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
    // The named legendary rises as its bespoke painting (painted
    // renderer, 2026-11-11 — name wins over the effect it carries:
    // Emberfall's painting, not Glass Sun's).
    const risen = screen.getByTestId('loot-risen-weapon');
    expect(risen.tagName).toBe('CANVAS');
    expect(risen.getAttribute('data-painted-sprite')).toBe('legendary-painting-emberfall');
    const input = pixelWeaponInputFromWeapon(emberfall);
    expect(risen.getAttribute('data-signature')).toBe(
      weaponPaintingShell(input, resolveWeaponPainting(input)!, 'card').signature,
    );
    const hero = screen.getByTestId('loot-card-hero');
    expect(hero.textContent).toContain('Emberfall');
    // Deck anatomy: the effect banner carries the effect, the stamp
    // line reads rarity · type · element · level.
    expect(hero.textContent).toContain('Glass Sun');
    expect(hero.textContent).toContain('LEGENDARY SNIPER · FIRE · LV 7');
    // P4 wave 2: the hand-written flavor override wins over the effect description.
    expect(hero.textContent).toContain('Sets the sky on fire. Literally.');
    expect(hero.textContent).toContain('2,847');
  });

  it('rises gear as its real plate, with the shield deck at true values', () => {
    render(<LootMoment items={[makeShield()]} surface="stage" propCache testId="lm" />);
    // Gear rises as itself — the plate, not the old crate stand-in.
    expect(screen.getByTestId('loot-risen-item')).toBeTruthy();
    expect(screen.getByTestId('loot-risen-gear')).toBeTruthy();
    expect(screen.queryByTestId('loot-risen-crate')).toBeNull();
    // The cache prop sits at the beam base for cache reveals.
    expect(screen.getByTestId('loot-cache-prop')).toBeTruthy();
    const hero = screen.getByTestId('loot-card-hero');
    expect(hero.textContent).toContain('Cryo Ironwood Shield');
    expect(hero.textContent).toContain('EPIC SHIELD · CRYO · LV 30');
    expect(hero.textContent).toContain('SHIELD HP');
    expect(hero.textContent).toContain('1,757');
    // The rider: an 8% shield reads 8% in the deck (never "0.1%").
    expect(hero.textContent).toContain('MITIGATION');
    expect(hero.textContent).toContain('8%');
    expect(hero.textContent).not.toContain('0.1%');
    // Gear carries no rollQuality — no quality chip.
    expect(hero.textContent).not.toContain('QUALITY');
  });

  it('ignites the cache prop: the opened crate frame rides the closed one (INT-7)', () => {
    render(<LootMoment items={[makeShield()]} surface="stage" propCache testId="lm" />);
    const closed = screen.getByTestId('loot-cache-prop');
    const opened = screen.getByTestId('loot-cache-prop-open');
    // One asset family, two states: closed = the lane/decrypt crate,
    // opened = the adopted ignition frame (wave §3.4, owner ruling
    // 2026-11-10). Both resolve through the manifest, never baked art.
    expect(closed.getAttribute('src')).toBe(getPixelSprite('prop-cache-crate')?.url);
    expect(opened.getAttribute('src')).toBe(getPixelSprite('prop-cache-crate-open')?.url);
    expect(closed.getAttribute('src')).not.toBe(opened.getAttribute('src'));
    // Painterly masters render smooth at the prop seat (the light
    // kit's scoped exception, PR #483) — no texel upscale.
    expect((closed as HTMLImageElement).style.imageRendering).not.toBe('pixelated');
    expect((opened as HTMLImageElement).style.imageRendering).not.toBe('pixelated');
    // The opened frame is bottom-seated on the same ground line as
    // the closed crate it replaces.
    expect(opened.className).toContain('absolute');
    expect(opened.className).toContain('bottom-0');
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

  it('rests settled after the ladder until the drop has been on stage LOOT_LIGHT_LINGER_MS (R2)', () => {
    vi.useFakeTimers();
    const common = makeWeapon({ id: 'w-common', name: 'Rusty Pistol', rarity: Rarity.Common });
    render(<LootMoment items={[common]} surface="feed" testId="lm" />);
    expect(screen.getByTestId('lm')).toBeTruthy();
    // The Common step ends at its law duration (the ladder is NOT
    // retimed)…
    act(() => {
      vi.advanceTimersByTime(MOVEMENT.LOOT_COMMON_MS + 10);
    });
    // …but the moment stays on stage in its settled state — beam
    // steady, card in place — instead of vanishing at 900 ms.
    expect(screen.getByTestId('lm')).toBeTruthy();
    expect(screen.getByTestId('fx-loot-beam')).toBeTruthy();
    expect(screen.getByTestId('loot-card-stack').textContent).toContain('Rusty Pistol');
    // It unmounts once the total on-stage time passes the linger floor.
    act(() => {
      vi.advanceTimersByTime(MOVEMENT.LOOT_LIGHT_LINGER_MS);
    });
    expect(screen.queryByTestId('lm')).toBeNull();
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
    expect(hero.textContent).toContain('2,847');
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
