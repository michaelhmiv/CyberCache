/**
 * First-screen fix R3 — inspect-sheet order pins (owner-ruled
 * 2026-11-17, trade-first; renderings in
 * cybercache-prep/cache-hunters/first-screen-fix/inspect-render):
 *
 *  - a legendary weapon's effect prints inside the header card,
 *    ahead of The Trade, exactly once — the standalone Legendary
 *    Effect tape is retired;
 *  - for weapons, The Trade precedes the Stat Poster (the poster
 *    follows whole);
 *  - non-weapons keep the shipped poster-first order and gain no
 *    effect block;
 *  - in Market context the Market Intelligence tape lifts ahead
 *    of The Trade (directly under the header card); in Gear
 *    context it keeps its shipped place below The Trade.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  useActiveBuffsStore,
  useBossStore,
  useInventoryStore,
  useLoadoutStore,
  useMarketStore,
  usePlayerStore,
  useSkillStore,
  useSurvivalStore,
} from '@/store';
import { GearInspectSheet } from '@/components/gear/GearInspectSheet';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Shield, Weapon } from '@/types/items';
import type { Listing } from '@/types/market';

function weapon(id: string, overrides: Partial<Weapon> = {}): Weapon {
  return {
    id, name: id, level: 5, rarity: Rarity.Rare,
    weaponType: WeaponType.SMG, manufacturer: Manufacturer.HelixWorks,
    element: Element.Kinetic, rollQuality: 50, baseDamage: 50, attackSpeed: 2,
    critChance: 0.1, critDamage: 1.5, statusChance: 0.1, statusDamage: 0.5,
    bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0.5, armorDamageMod: 0.5,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [], affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: 1, combatPower: 100, bossPower: 100, farmPower: 100, economyScore: 0,
    ...overrides,
  };
}

function shield(id: string, overrides: Partial<Shield> = {}): Shield {
  return {
    id, name: id, level: 5, rarity: Rarity.Rare,
    hp: 120, rechargeRate: 10, mitigation: 0.1, element: Element.Kinetic,
    affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 1,
    ...overrides,
  };
}

const wornGun = weapon('worn-gun', { legendaryEffectId: 'ricochet_gospel' });
const legendGun = weapon('legend-gun', {
  rarity: Rarity.Legendary, baseDamage: 90, legendaryEffectId: 'ricochet_gospel',
});
const wornShield = shield('worn-shield');
const candidateShield = shield('candidate-shield', { hp: 200 });

const similarListing: Listing = {
  id: 'listing-similar', sellerId: 'seller-9', sellerName: '', sellerType: 'player',
  kind: 'gear', itemId: 'other-gun', itemSnapshot: weapon('other-gun', { rarity: Rarity.Legendary }),
  vehicleSnapshot: null, category: 'weapon', displayName: 'other-gun', quantity: 1,
  qualityPercent: null, consumableType: null, materialId: null, essenceId: null,
  partId: null, tintPaletteId: null, skinId: null, identityKey: null,
  weaponType: 'SMG', element: 'Kinetic', rarity: 'Legendary', itemLevel: 5,
  price: 48500, unitPrice: 48500, listedAt: Date.now(), feePaid: 0,
};

function seed() {
  useInventoryStore.setState({ items: [wornGun, legendGun, wornShield, candidateShield] });
  useLoadoutStore.setState({
    slots: {
      primary: wornGun.id, secondary: null, heavy: null, ordnance: null,
      shield: wornShield.id, classMod: null, relic: null, vehicle: null,
    },
  });
  useSkillStore.setState({ spent: {}, classModBoosts: { nodeBoosts: {} }, activeHunterId: 'vesper' });
  usePlayerStore.setState({ level: 10, consumables: {} });
  useSurvivalStore.setState({ medKitBuffer: 0 });
  useActiveBuffsStore.setState({ buffs: [] });
  useBossStore.setState({ currentBossId: null });
  useMarketStore.setState({ listings: [similarListing], history: [] });
}

beforeEach(seed);

const bodyText = () => document.body.textContent ?? '';
const idx = (needle: string) => bodyText().indexOf(needle);

describe('GearInspectSheet first-screen order (R3)', () => {
  it('a legendary weapon: the effect leads inside the header, The Trade prices before the poster', () => {
    render(<GearInspectSheet item={legendGun} open onClose={() => {}} contextLabel="Inventory Inspect" />);
    // The effect block is present, labeled, and ahead of The Trade.
    expect(idx('Legendary Effect')).toBeGreaterThanOrEqual(0);
    expect(idx('Ricochet Gospel')).toBeGreaterThan(idx('Legendary Effect'));
    expect(idx('Legendary Effect')).toBeLessThan(idx('The Trade'));
    // Exactly one effect label — the standalone tape is retired.
    expect(bodyText().split('Legendary Effect').length - 1).toBe(1);
    // Trade-first: the whole Trade tape precedes the Stat Poster.
    expect(idx('The Trade')).toBeGreaterThanOrEqual(0);
    expect(idx('Stat Poster')).toBeGreaterThan(idx('The Trade'));
    // Gear context: Market Intelligence keeps its shipped place
    // below The Trade.
    expect(idx('Market Intelligence')).toBeGreaterThan(idx('The Trade'));
  });

  it('a non-weapon keeps the shipped poster-first order and gains no effect block', () => {
    render(<GearInspectSheet item={candidateShield} open onClose={() => {}} contextLabel="Inventory Inspect" />);
    expect(idx('Stat Poster')).toBeGreaterThanOrEqual(0);
    expect(idx('The Trade')).toBeGreaterThan(idx('Stat Poster'));
    expect(idx('Legendary Effect')).toBe(-1);
  });

  it('Market context: Market Intelligence lifts to directly under the header card', () => {
    render(<GearInspectSheet item={legendGun} open onClose={() => {}} contextLabel="Market Inspect" />);
    expect(idx('Market Intelligence')).toBeGreaterThanOrEqual(0);
    expect(idx('Market Intelligence')).toBeLessThan(idx('The Trade'));
    // The effect still leads, ahead of the lifted intel.
    expect(idx('Legendary Effect')).toBeLessThan(idx('Market Intelligence'));
  });
});
