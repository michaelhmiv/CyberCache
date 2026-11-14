/**
 * Loot harness page (Stage Iteration R2, dev only) — serves the
 * drop / reward-moment surfaces that the roam and bench harnesses
 * cannot reach, for measured capture rounds at phone size:
 *
 *   mode=boss     the boss victory moment exactly as
 *                 BossEncounterPanel mounts it (full-viewport
 *                 dim, LootMoment surface="stage", anchor 50/72,
 *                 a 3-item ladder ending in a Legendary).
 *   mode=gear     one roaming gear drop (LootMoment surface=
 *                 "feed", light mode) inside a 390px stage box,
 *                 anchored at a corpse's feet. ?rarity= picks the
 *                 drop's rarity (Common default).
 *   mode=salvage  the Home stage in salvaging mode; a history
 *                 batch is seeded before mount (never replays)
 *                 and a fresh batch settles ~1.5 s after load,
 *                 firing the crusher's completion rise.
 *   mode=extract  the Home stage in extraction mode; a settled
 *                 pass with four find types is pushed ~1.5 s
 *                 after load, firing the sift-rig rises.
 *
 * Nothing here is imported by the app bundle; loot-harness.html
 * is served by the Vite dev server only.
 */
import React, { useEffect } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { LootMoment } from '@/components/pixelArt/LootMoment';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useExtractionFeedStore, useSalvageFeedStore } from '@/store';
import type { ChefExtractionPass } from '@/lib/chef/chefClient';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Shield, Weapon } from '@/types/items';

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') ?? 'boss';
const rarityParam = (params.get('rarity') ?? 'Common') as Rarity;

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

const makeShield = (overrides: Partial<Shield> = {}): Shield =>
  ({
    id: 's-1',
    name: 'Cryo Ironwood Shield',
    level: 30,
    rarity: Rarity.Epic,
    hp: 1757,
    rechargeRate: 40,
    mitigation: 0.08,
    element: Element.Cryo,
    affixes: [],
    sourceTag: DropSource.BossDrop,
    isLocked: false,
    pixelSeed: 3,
    ...overrides,
  }) as Shield;

const DIORAMA_WEAPON: Weapon = {
  id: 'loot-harness-weapon',
  name: 'Harness Carbine',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  rarity: Rarity.Epic,
  element: Element.Fire,
  level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } },
    { slot: 'Grip', modifier: { handling: 1.04 } },
    { slot: 'Core', modifier: { baseDamage: 1.02 } },
    { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
    { slot: 'Sight', modifier: { critChance: 1.06 } },
    { slot: 'Chamber', modifier: { fireRate: 0.98 } },
  ],
  pixelSeed: 42,
} as unknown as Weapon;

const BOSS_ITEMS = [
  { item: makeWeapon({ id: 'bw-1', name: 'Rustpicker', rarity: Rarity.Common, weaponType: WeaponType.Pistol, element: Element.Kinetic }), isNew: true },
  { item: makeShield(), isNew: false },
  {
    item: makeWeapon({
      id: 'bw-3',
      name: 'Volt Widow',
      rarity: Rarity.Legendary,
      weaponType: WeaponType.Sniper,
      baseDamage: 5200,
      sourceTag: DropSource.BossDrop,
    }),
    isNew: true,
  },
];

const FIXTURE_PASS: ChefExtractionPass = {
  index: 7,
  areaId: 'dustwaste_frontier',
  method: 'surface',
  draws: 32,
  gearFactor: 1,
  deepDegraded: false,
  xpAwarded: 120,
  materials: { TechFragments: 14, BallisticParts: 9, Dustglass: 4 },
  essences: { IgnitionFluid: 6 },
  signatureUnits: 0,
};

// Salvage history: seeded before mount so the stage's seen-set
// discipline swallows it; the fresh batch in the effect is the
// one that earns the rise.
if (mode === 'salvage') {
  useSalvageFeedStore.getState().pushBatch({
    maxRarity: 'Common',
    totalItems: 2,
    countsByRarity: { Common: 2 },
    scrap: 40,
    cores: 0,
    bonusMaterials: {},
  });
}

export const LootHarnessPage: React.FC = () => {
  useEffect(() => {
    if (mode === 'salvage') {
      const t = window.setTimeout(() => {
        useSalvageFeedStore.getState().pushBatch({
          maxRarity: 'Rare',
          totalItems: 3,
          countsByRarity: { Rare: 1, Common: 2 },
          scrap: 140,
          cores: 2,
          bonusMaterials: {},
        });
      }, 1500);
      return () => window.clearTimeout(t);
    }
    if (mode === 'extract') {
      const t = window.setTimeout(() => {
        useExtractionFeedStore.getState().pushPass(FIXTURE_PASS);
      }, 1500);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, []);

  if (mode === 'boss') {
    return (
      <div className="fixed inset-0 z-[110] bg-black/55" data-testid="loot-harness-boss">
        <LootMoment items={BOSS_ITEMS.map((entry) => entry.item)} surface="stage" anchorXPct={50} groundYPct={72} onDone={() => undefined} testId="boss-loot-moment" />
      </div>
    );
  }

  if (mode === 'gear') {
    const item = makeWeapon({ id: 'gw-1', rarity: rarityParam, sourceTag: DropSource.WorldDrop });
    return (
      <div style={{ minHeight: '100vh', background: '#0B0B10', padding: 12, boxSizing: 'border-box' }}>
        <div style={{ width: 390, margin: '0 auto' }}>
          <div className="relative" style={{ height: 300, background: '#14101D' }} data-testid="loot-harness-stage">
            <LootMoment items={[item]} surface="feed" anchorXPct={66} groundYPct={82} testId="gear-loot-moment" />
          </div>
        </div>
      </div>
    );
  }

  const activityKind = mode === 'extract' ? 'extraction' : 'salvaging';
  return (
    <div style={{ minHeight: '100vh', background: '#0B0B10', padding: 12, boxSizing: 'border-box' }}>
      <div style={{ width: 390, margin: '0 auto' }} data-testid="loot-harness-root">
        <LiveTurfDiorama
          area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
          weapon={DIORAMA_WEAPON}
          playerLevel={5}
          equippedCount={1}
          activityKind={activityKind as never}
        />
      </div>
    </div>
  );
};
