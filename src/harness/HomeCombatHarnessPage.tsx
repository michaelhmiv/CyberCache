/**
 * Home combat harness page (store-screenshots round,
 * dash/store-shots — dev only) — the FULL Home screen at phone
 * width for the App Store screenshot set: the real HomeScreen
 * inside the real ScreenWrapper scroller with the real BottomNav
 * under it (Home active), exactly the shell App composes, caught
 * MID-ROAM-COMBAT: Vesper Cole fielded, a Shock SMG equipped, a
 * Dustwaste Raider on the stage at 64/100 HP, and the capture
 * plan lands a hit beat (window.__seedHit, the RoamHarnessPage
 * seam ported here) a beat before the shutter.
 *
 * The seed follows the proven home-harness pattern (player /
 * activity / loadout / survival settled directly; workshop
 * refresh stubbed to a no-op) plus the roam stage's own stores:
 * killCycle holding the target and the tick feed the diorama's
 * beat classifier reads. The activity kind matches the frame's
 * mode — 'roaming_loot' with targetType 'roaming_area' and
 * targetId = the idle store's selected area, the exact triple
 * ActionScreenContextual's canTick gate checks.
 *
 * Auth resolves through the harness stub (vite.shots.config.ts);
 * Chef reads are answered offline by homeCombatMain's fetch
 * backstop. Nothing here is imported by the app bundle;
 * home-combat-harness.html is served by the Vite dev server only.
 */
import React, { useEffect } from 'react';
import { HomeScreen } from '@/screens/HomeScreen';
import { BottomNav } from '@/components/layout/BottomNav';
import { ScreenWrapper } from '@/components/layout/ScreenWrapper';
import { IDLE_ACTIVITY } from '@/types/activity';
import { DEFAULT_ROAMING_AREA_ID } from '@/constants/roamingAreas';
import {
  useActivityStore,
  useIdleStore,
  useInventoryStore,
  useKillCycleStore,
  useLoadoutStore,
  usePlayerStore,
  useSkillStore,
  useSurvivalStore,
  useTickFeedStore,
  useWorkshopStore,
} from '@/store';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { Shield, Weapon } from '@/types/items';

const COMBAT_WEAPON: Weapon = {
  id: 'shots-combat-weapon',
  name: 'Volt Carbine',
  level: 7,
  rarity: Rarity.Epic,
  weaponType: WeaponType.SMG,
  manufacturer: Manufacturer.Prismatek,
  element: Element.Shock,
  rollQuality: 62,
  baseDamage: 85,
  attackSpeed: 2.4,
  critChance: 0.15,
  critDamage: 1.9,
  statusChance: 0.2,
  statusDamage: 8,
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

const COMBAT_SHIELD: Shield = {
  id: 'shots-combat-shield',
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

function seedStores() {
  usePlayerStore.setState({
    id: 'p1',
    level: 18,
    xp: 12837,
    credits: 72900,
    scrap: 198000,
    cacheKeys: 3,
    materials: { Scrap: 42 },
    essences: {},
    consumables: { AmmoPack: 82 },
    profileLoaded: true,
  } as never);
  useSkillStore.setState({
    spent: {},
    activeHunterId: 'vesper',
  } as never);
  useInventoryStore.setState({
    items: [COMBAT_WEAPON, COMBAT_SHIELD],
  } as never);
  useLoadoutStore.setState((s) => ({
    slots: { ...s.slots, primary: COMBAT_WEAPON.id, shield: COMBAT_SHIELD.id },
    consumables: { PreFight: 'AmmoPack', MidFight: null, Emergency: null },
  }));
  useSurvivalStore.setState({
    currentHp: 1240,
    maxHp: 1780,
    shieldHp: 120,
    isDead: false,
  } as never);
  useIdleStore.setState({
    selectedRoamingAreaId: DEFAULT_ROAMING_AREA_ID,
  } as never);
  useActivityStore.setState({
    current: {
      ...IDLE_ACTIVITY,
      kind: 'roaming_loot',
      targetType: 'roaming_area',
      targetId: DEFAULT_ROAMING_AREA_ID,
      targetLabel: 'Dustwaste Frontier',
      startedAt: new Date().toISOString(),
    },
    hydrated: true,
    pending: false,
    error: null,
  } as never);
  useKillCycleStore.setState({
    currentTargetId: 'dustwaste_raider',
    currentTargetHp: 64,
    currentTargetHpMax: 100,
  });
  useTickFeedStore.setState({ events: [] });
  useWorkshopStore.setState({
    refresh: async () => undefined,
  } as never);
}

seedStores();

let beatSeq = 0;

/** The RoamHarnessPage hit seam: seed the verbatim production
 * hit shape into the tick feed and apply the kill-cycle sync a
 * claim applies, so the stage plays the shot beat against synced
 * HP. The capture plan calls this a beat before the shutter. */
function installBeatSeam() {
  const w = window as unknown as Record<string, unknown>;
  w.__seedHit = (value: number) => {
    beatSeq += 1;
    const event = {
      id: `shots-beat-${beatSeq}`,
      at: Date.now(),
      tone: 'hit',
      label: `-${value} HP`,
      detail: `Hit dustwaste_raider for ${value} HP.`,
      value,
    } as TickEvent;
    useTickFeedStore.setState({ events: [event] });
    const { currentTargetHp } = useKillCycleStore.getState();
    useKillCycleStore.setState({ currentTargetHp: Math.max(0, currentTargetHp - value) });
  };
}

export const HomeCombatHarnessPage: React.FC = () => {
  useEffect(() => {
    installBeatSeam();
  }, []);
  return (
    <div
      style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0B10' }}
      data-testid="home-combat-harness-root"
    >
      <ScreenWrapper hidden={false}>
        <HomeScreen onNavigate={() => {}} />
      </ScreenWrapper>
      <BottomNav activeTab="home" onChange={() => {}} />
    </div>
  );
};
