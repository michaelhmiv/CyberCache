/**
 * CAPTURE-ONLY harness (branch dash/hunters-probe — NEVER merged).
 * Style probe: drives the REAL LiveTurfDiorama roam stage with the
 * ?painting= figure swap (renderer=dom|pixi chosen by the app's own
 * production switch; huntersMain hides WebGL for renderer=dom).
 * Fixture state matches the round-2 hunters package exactly
 * (Wraith Scavenger at 80%, hunter HP 72/100) so stills compare.
 */
import React, { useEffect } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

const WEAPON: Weapon = {
  id: 'roam-harness-weapon', name: 'Harness Carbine', weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood, rarity: Rarity.Epic, element: Element.Fire, level: 5,
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

export const HuntersCapturePage: React.FC = () => {
  useEffect(() => {
    useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 80, currentTargetHpMax: 100 });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
  }, []);
  return (
    <LiveTurfDiorama
      area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
      weapon={WEAPON}
      playerLevel={5}
      equippedCount={4}
      activityKind="roaming_loot"
    />
  );
};
