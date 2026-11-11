/**
 * Viewport-deferred gear art (Gear cold-load fix, 2026-11-05).
 *
 * Pins the deferral contract for list surfaces:
 *  1. A deferred illustration mounts its canvas at FINAL geometry
 *     immediately, with NO composition yet (no data-signature).
 *  2. When the element comes near the viewport, the art activates
 *     and the composed signature is IDENTICAL to the signature the
 *     same item renders without deferral — deferral changes WHEN
 *     art composes, never WHAT composes.
 *  3. Without the defer prop, composition is immediate (on-screen
 *     surfaces: loadout, inspect — unchanged behavior).
 *  4. Without IntersectionObserver (jsdom default), deferred art
 *     activates immediately — deferral never gates the art.
 *  5. A GearHub list mount with a non-intersecting observer renders
 *     every row while composing NONE of them.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { GearHub } from '@/components/gear/GearHub';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Shield, Weapon } from '@/types/items';

// ── IntersectionObserver mock (the ChipRail test pattern) ──────────

type IOCallback = (entries: Array<{ isIntersecting: boolean }>, observer: unknown) => void;

class MockIO {
  static instances: MockIO[] = [];
  callback: IOCallback;
  elements = new Set<Element>();
  constructor(callback: IOCallback) {
    this.callback = callback;
    MockIO.instances.push(this);
  }
  observe(el: Element) { this.elements.add(el); }
  unobserve(el: Element) { this.elements.delete(el); }
  disconnect() { this.elements.clear(); }
  fireAll(isIntersecting: boolean) {
    const entries = [...this.elements].map((target) => ({ isIntersecting, target }));
    this.callback(entries as never, this);
  }
}

let originalIO: typeof globalThis.IntersectionObserver | undefined;

function installIO() {
  MockIO.instances = [];
  globalThis.IntersectionObserver = MockIO as unknown as typeof IntersectionObserver;
}
function removeIO() {
  if (originalIO) globalThis.IntersectionObserver = originalIO;
  else delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
}
async function fireAllObservers(isIntersecting: boolean) {
  act(() => {
    for (const io of MockIO.instances) io.fireAll(isIntersecting);
  });
  // Activation runs through the rAF/setTimeout activation queue and
  // lands as a React state update; flush both inside act.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

function makeWeapon(id: string, name: string): Weapon {
  return {
    id, name, level: 5, rarity: Rarity.Rare,
    weaponType: WeaponType.Pistol, manufacturer: Manufacturer.Ironwood,
    element: Element.Kinetic, rollQuality: 50, baseDamage: 25, attackSpeed: 2,
    critChance: 0.1, critDamage: 1.5, statusChance: 0, statusDamage: 0,
    bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0, armorDamageMod: 0,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [], affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: 7, combatPower: 50, bossPower: 50, farmPower: 50, economyScore: 0,
  };
}

function makeShield(id: string, name: string): Shield {
  return {
    id, name, level: 4, rarity: Rarity.Rare, hp: 220, rechargeRate: 12,
    mitigation: 0.2, element: Element.Kinetic, affixes: [],
    sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 3,
  };
}

beforeEach(() => {
  originalIO = globalThis.IntersectionObserver;
  useInventoryStore.setState({ items: [] });
  useLoadoutStore.setState({
    slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, vehicle: null },
  });
});

afterEach(() => {
  removeIO();
});

describe('deferred gear art', () => {
  it('mounts at final geometry with no composition before intersection', () => {
    installIO();
    const weapon = makeWeapon('w-1', 'Deferred Pistol');
    const { container } = render(<GearIllustration item={weapon} size={46} weaponDensity="stage" defer />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas!.getAttribute('data-deferred-art')).toBe('pending');
    expect(canvas!.getAttribute('data-signature')).toBeNull();
    // Stage grid 120x44 at paint scale 3 — the exact box the
    // painted canvas will occupy.
    expect(canvas!.width).toBe(360);
    expect(canvas!.height).toBe(132);
    expect(canvas!.style.width).toBe('46px');
    expect(canvas!.style.height).toBe('17px');
  });

  it('activates on intersection with art identical to the immediate render', async () => {
    installIO();
    const weapon = makeWeapon('w-2', 'Twin Pistol');
    const immediate = render(<GearIllustration item={weapon} size={46} weaponDensity="stage" />);
    const immediateSig = immediate.container.querySelector('canvas')!.getAttribute('data-signature');
    expect(immediateSig).toBeTruthy();
    immediate.unmount();

    const deferred = render(<GearIllustration item={weapon} size={46} weaponDensity="stage" defer />);
    expect(deferred.container.querySelector('canvas')!.getAttribute('data-signature')).toBeNull();
    await fireAllObservers(true);
    const canvas = deferred.container.querySelector('canvas')!;
    expect(canvas.getAttribute('data-deferred-art')).toBeNull();
    expect(canvas.getAttribute('data-signature')).toBe(immediateSig);
    // Same backing store, same CSS box — no layout shift.
    expect(canvas.width).toBe(360);
    expect(canvas.height).toBe(132);
  });

  it('painted gear ignores deferral — the painting mounts at final geometry at once', async () => {
    // INT-2 (2026-11-11): shields render their adopted Top-Choice
    // painting, which never composes — there is nothing for the
    // deferral queue to defer. The painted placeholder canvas mounts
    // immediately at the sprite's own geometry, deferred or not, and
    // carries the painting's identity instead of a signature.
    installIO();
    const shield = makeShield('s-1', 'Deferred Aegis');
    const immediate = render(<GearIllustration item={shield} size={46} />);
    const immediateCanvas = immediate.container.querySelector('canvas')!;
    expect(immediateCanvas.getAttribute('data-painted-sprite')).toBe('gear-shield-standard');
    const box = { w: immediateCanvas.width, h: immediateCanvas.height };
    immediate.unmount();

    const deferred = render(<GearIllustration item={shield} size={46} defer />);
    const pending = deferred.container.querySelector('canvas')!;
    expect(pending.getAttribute('data-painted-sprite')).toBe('gear-shield-standard');
    expect(pending.width).toBe(box.w);
    expect(pending.height).toBe(box.h);
    await fireAllObservers(true);
    const canvas = deferred.container.querySelector('canvas')!;
    expect(canvas.getAttribute('data-painted-sprite')).toBe('gear-shield-standard');
  });

  it('does not activate while off-screen', async () => {
    installIO();
    const weapon = makeWeapon('w-3', 'Hidden Pistol');
    const { container } = render(<GearIllustration item={weapon} size={46} weaponDensity="stage" defer />);
    await fireAllObservers(false);
    expect(container.querySelector('canvas')!.getAttribute('data-deferred-art')).toBe('pending');
    expect(container.querySelector('canvas')!.getAttribute('data-signature')).toBeNull();
  });

  it('activates immediately when IntersectionObserver is unavailable', () => {
    removeIO();
    const weapon = makeWeapon('w-4', 'Fallback Pistol');
    const { container } = render(<GearIllustration item={weapon} size={46} weaponDensity="stage" defer />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas.getAttribute('data-deferred-art')).toBeNull();
    expect(canvas.getAttribute('data-signature')).toBeTruthy();
  });

  it('GearHub list mount renders all rows while composing none of them', async () => {
    installIO();
    const items = Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0 ? makeShield(`it-${i}`, `Aegis ${i}`) : makeWeapon(`it-${i}`, `Pistol ${i}`));
    useInventoryStore.setState({ items });
    render(<GearHub />);
    const rows = screen.getAllByTestId('gear-list-row');
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.querySelector('canvas[data-signature]')).toBeNull();
      // INT-2: painted shields mount their painting placeholder at
      // once (nothing composes, nothing defers); grammar-rendered
      // weapons still mount the deferred placeholder.
      const shieldRow = row.querySelector('[data-painted-sprite]') !== null;
      if (!shieldRow) expect(row.querySelector('[data-deferred-art="pending"]')).not.toBeNull();
    }
    await fireAllObservers(true);
    for (const row of rows) {
      const settled = row.querySelector('canvas[data-signature]')
        ?? row.querySelector('[data-painted-sprite]');
      expect(settled).not.toBeNull();
    }
  });
});
