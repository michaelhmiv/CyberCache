/**
 * Gear harness page (fix-round review, capture-swap branch only —
 * dev only) — serves the Gear tab's loadout doll (ActionLoadout in
 * manage mode, the exact component SyncedLoadoutScreen mounts on
 * the Gear tab) with seeded stores, for phone-width captures of
 * the painted figure. Driven by URL params:
 *
 *   hunter  vesper (default) | silas | josie | doc — the fielded
 *           hunter whose painting the doll must show.
 *   width   stage width px (default 412).
 *
 * The loadout is seeded the way the gear-composition tests seed
 * it: a real-shaped weapon + shield in the inventory store,
 * equipped through the loadout store's slots. Nothing here is
 * imported by the app bundle; gear-harness.html is served by the
 * Vite dev server only.
 */
import React from 'react';
import { ActionLoadout } from '@/components/action/ActionLoadout';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSkillStore } from '@/store/slices/skillSlice';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Shield, Weapon } from '@/types/items';

const params = new URLSearchParams(window.location.search);
const harnessWidth = Number(params.get('width') ?? 412) || 412;

const FIXTURE_WEAPON: Weapon = {
  id: 'gear-harness-weapon',
  name: 'Volt Carbine',
  level: 7,
  rarity: Rarity.Epic,
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
} as unknown as Weapon;

const FIXTURE_SHIELD: Shield = {
  id: 'gear-harness-shield',
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
} as unknown as Shield;

// Seed before first render (the bench/roam harness pattern): the
// fielded hunter + an equipped primary and shield, so the doll
// zone renders the painting over a real, populated loadout.
const hunter = params.get('hunter');
if (hunter === 'vesper' || hunter === 'silas' || hunter === 'josie' || hunter === 'doc') {
  useSkillStore.setState({ activeHunterId: hunter });
} else {
  useSkillStore.setState({ activeHunterId: 'vesper' });
}
useInventoryStore.setState({ items: [FIXTURE_WEAPON, FIXTURE_SHIELD] });
useLoadoutStore.setState((s) => ({
  slots: { ...s.slots, primary: FIXTURE_WEAPON.id, shield: FIXTURE_SHIELD.id },
}));
usePlayerStore.setState({ consumables: {}, vehicleFuel: 0 });

export const GearHarnessPage: React.FC = () => (
  <div style={{ minHeight: '100vh', background: '#0B0B10', padding: 12, boxSizing: 'border-box' }}>
    <div style={{ width: harnessWidth, margin: '0 auto' }} data-testid="gear-harness-root">
      <ActionLoadout />
    </div>
  </div>
);
