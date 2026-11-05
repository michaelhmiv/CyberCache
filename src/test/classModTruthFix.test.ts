/**
 * Class-mod truth fix — the client summary must price the build
 * the Chef actually pays.
 *
 * The claim (from the equip-comparison research memo) is that the
 * Chef derives skill bonuses over EFFECTIVE points — spends + the
 * equipped class mod's boosts — on every payout path, through
 * `skillBonusesFromRecords` (claim route, roaming handler, endless,
 * offline settlement). These tests PIN that claim instead of
 * assuming it: the client input assembled by
 * assembleStatSummaryInput must produce skill-derived numbers equal
 * to the Chef's own derivation from the same records, and the old
 * raw-spent assembly is shown to understate them — the exact lie
 * the fix closes.
 */
import { describe, expect, it } from 'vitest';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { buildCharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { assembleStatSummaryInput } from '@/lib/stats/assembleStatSummaryInput';
import { effectiveSkillPoints } from '@/lib/skills/skillBonuses';
import { computeStandardDps } from '@/lib/stats/dpsChain';
import {
  classModBoostsFromGear,
  skillBonusesFromRecords,
} from '@/server/gameplay/serverLoadout';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { ClassMod, GearItem, Weapon } from '@/types/items';
import type { PlayerProfile } from '@/types/player';

const player: PlayerProfile = {
  id: 'test-player',
  name: 'Test Hunter',
  level: 10,
  xp: 0,
  credits: 0,
  scrap: 0,
  cacheKeys: 0,
  cacheKeyFragments: 0,
  legendaryCores: 0,
  currentZoneId: 'zone-1',
  highestZoneId: 'zone-1',
  offlineCapHours: 8,
  lastClaimTime: 0,
  deathFeeInsurance: false,
  consumables: {},
  consumableBatches: [],
  materials: {},
  essences: {},
  workshopQueues: [],
  lastWorkshopTick: 0,
  lastClaimedTick: 0,
};

const primary: Weapon = {
  id: 'primary-gun', name: 'Primary Gun', level: 5, rarity: Rarity.Rare,
  weaponType: WeaponType.SMG, manufacturer: Manufacturer.HelixWorks,
  element: Element.Kinetic, rollQuality: 50, baseDamage: 50, attackSpeed: 2,
  critChance: 0.1, critDamage: 1.5, statusChance: 0.1, statusDamage: 0.5,
  bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0.5, armorDamageMod: 0.5,
  offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
  parts: [], affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
  pixelSeed: 1, combatPower: 100, bossPower: 100, farmPower: 100, economyScore: 0,
};

const wornMod: ClassMod = {
  id: 'worn-mod', name: 'Worn Mod', level: 5, rarity: Rarity.Rare,
  treeBonus: 'Scavenger',
  nodeBoosts: { scav_idle_1: 2, gs_dmg_1: 2 },
  affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
};

const spent = { scav_idle_1: 2, gs_dmg_1: 3 };
const equippedGear: GearItem[] = [primary, wornMod];

/** The Chef's own derivation from the same server records. */
const chefRecord = skillBonusesFromRecords(equippedGear, spent);

const assemblyState = {
  player,
  weapons: [primary],
  classMod: wornMod,
  spent,
  classModBoosts: { treeBonus: wornMod.treeBonus, nodeBoosts: { ...wornMod.nodeBoosts } },
};

describe('class-mod truth fix — client summary ≡ Chef derivation', () => {
  it('the Chef record itself carries the boosts (the premise, pinned)', () => {
    // scav_idle_1: (2 spent + 2 boost + 1 Scavenger treeBonus) × 0.15
    // = 0.75, plus the treeBonus fold grants scav_idle_2 a point it
    // never spent: another 0.15. Total 0.90.
    expect(chefRecord.offlineEarnings).toBeCloseTo(0.9, 10);
    // gs_dmg_1: (3 spent + 2 boost) × 0.05
    expect(chefRecord.weaponDamage).toBeCloseTo(0.25, 10);
  });

  it('the assembled input folds exactly the points the Chef folds', () => {
    const input = assembleStatSummaryInput(assemblyState);
    expect(input.spentSkills).toEqual(
      effectiveSkillPoints(spent, classModBoostsFromGear(equippedGear)),
    );
  });

  it('summary Offline equals the Chef offlineEarnings for the same records', () => {
    const summary = buildCharacterStatSummary(assembleStatSummaryInput(assemblyState));
    const offline = summary.all.find((m) => m.key === 'offline');
    expect(offline?.value).toBeCloseTo(chefRecord.offlineEarnings ?? 0, 10);
  });

  it('snapshot Offline equals the Chef offlineEarnings for the same records', () => {
    const snapshot = buildCharacterMechanicsSnapshot(assembleStatSummaryInput(assemblyState));
    expect(snapshot.offlineEarningModifier.value).toBeCloseTo(chefRecord.offlineEarnings ?? 0, 10);
  });

  it('summary DPS equals the standard chain scaled by the Chef skill record', () => {
    const summary = buildCharacterStatSummary(assembleStatSummaryInput(assemblyState));
    const dps = summary.all.find((m) => m.key === 'dps');
    const expected =
      computeStandardDps(primary) *
      (1 +
        (chefRecord.weaponDamage ?? 0) +
        (chefRecord.attackSpeed ?? 0) +
        (chefRecord.critChance ?? 0) * 0.5 +
        (chefRecord.critDamage ?? 0) * 0.5);
    expect(dps?.value).toBeCloseTo(expected, 6);
  });

  it('the OLD raw-spent assembly understated both — the gap the fix closes', () => {
    const rawSummary = buildCharacterStatSummary({
      player,
      weapons: [primary],
      classMod: wornMod,
      spentSkills: spent,
    });
    const rawOffline = rawSummary.all.find((m) => m.key === 'offline');
    // Raw assembly: 2 spent points × 0.15, no boosts, no tree fold.
    expect(rawOffline?.value).toBeCloseTo(0.3, 10);
    expect(rawOffline?.value).not.toBeCloseTo(chefRecord.offlineEarnings ?? 0, 10);
  });

  it('a class-mod swap to a boostless mod prices the skill LOSS (no more blind spot)', () => {
    const plainMod: ClassMod = { ...wornMod, id: 'plain-mod', name: 'Plain Mod', nodeBoosts: {} };
    const candidateInput = assembleStatSummaryInput(assemblyState, { slot: 'classMod', item: plainMod });
    const candidateSummary = buildCharacterStatSummary(candidateInput);
    const offline = candidateSummary.all.find((m) => m.key === 'offline');
    // Only the Scavenger treeBonus fold remains: scav_idle_1 prices
    // at 3 points (0.45) and scav_idle_2 at the folded 1 (0.15).
    expect(offline?.value).toBeCloseTo(0.6, 10);
    expect(offline?.value).toBeLessThan(chefRecord.offlineEarnings ?? 0);
  });
});
