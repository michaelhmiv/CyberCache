/**
 * Tuning slice T2 — consumable magnitudes (owner ruling D2, 2026-11-10;
 * economy tuning brief proposals P3, P4, P5).
 *
 * Pins, at the shipped seams:
 *   - P3: ammo DPS/break magnitudes at Q100 and their DELTA-mode quality
 *     slopes at the Q175 cap (Ammo Pack at Q175 = +17.5% is the brief's
 *     own worked check);
 *   - P4: survival heals/shield restores are %-of-pool now — the def
 *     fractions, their linear quality scaling (Q175 Med Kit = 35% of
 *     pool, the brief's worked check), the roaming engine resolving
 *     them against live pools (L1 pool 940 → a Q100 Med Kit heals 188,
 *     the brief's worked check), and the boss sim pricing them against
 *     the attempt's pools;
 *   - P5: ordnance flat riders ×4 (Forgeheart 25 → 120 at Q100, still
 *     quality-scaling flat);
 *   - vendor staple prices unchanged (magnitudes only).
 *
 * P4 expectation note (premise correction, 2026-11-10): the brief's P4
 * falsifier cited "P1's attrition model"; that model is invalid (the
 * shipped game has no shield-recharge mechanic — rechargeRate is a
 * displayed stat no engine consumes). These pins therefore assert
 * per-engagement pool math only: fights cost ~0.5–8% of pool over 1–3
 * ticks, so a 20%-of-pool Med Kit is a multi-fight belt item at every
 * level. The falsifier is to be rebaselined after the fleet measures
 * the new magnitudes.
 */
import { describe, expect, it } from 'vitest';
import { CONSUMABLES, getConsumableRuntimeEffects } from '../constants/consumables';
import {
  activateFromInventory,
  bufferHealPerUnit,
  getSurvivalState,
  isBufferConsumable,
  isRegenConsumable,
  isShieldRestoreConsumable,
  processTick,
} from '../lib/consumables/roamingConsumableEngine';
import { simulateBoss, type BossSimulationInput } from '../lib/simulation/bossSimulator';
import { REGION_1_BOSSES } from '../constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';

/** The brief's L1 pool: 700 + 60×1 hunter HP + ~180 shield capacity. */
const L1_POOLS = { maxHp: 760, shieldCapacity: 180 };

describe('P3 — ammo magnitudes (brief table, at Q100)', () => {
  it('generic and specialized ammo read the new base magnitudes', () => {
    expect(getConsumableRuntimeEffects('AmmoPack', 100).dpsMultiplier).toBeCloseTo(1.1, 10);
    expect(getConsumableRuntimeEffects('HighCapacityAmmoPack', 100).dpsMultiplier).toBeCloseTo(1.12, 10);
    expect(getConsumableRuntimeEffects('IncendiaryAmmo', 100).dpsMultiplier).toBeCloseTo(1.12, 10);
    expect(getConsumableRuntimeEffects('RedlineTonic', 100).dpsMultiplier).toBeCloseTo(1.14, 10);
    const elemental = getConsumableRuntimeEffects('ElementalCoating', 100);
    expect(elemental.shieldBreakMultiplier).toBeCloseTo(1.15, 10);
    expect(elemental.armorBreakMultiplier).toBeCloseTo(1.15, 10);
    const prism = getConsumableRuntimeEffects('PrismCoating', 100);
    expect(prism.shieldBreakMultiplier).toBeCloseTo(1.18, 10);
    expect(prism.armorBreakMultiplier).toBeCloseTo(1.18, 10);
  });

  it("the brief's unchanged set stays put", () => {
    expect(getConsumableRuntimeEffects('VoidAmmo', 100).dpsMultiplier).toBeCloseTo(1.22, 10);
    expect(getConsumableRuntimeEffects('TargetPainter', 100).dpsMultiplier).toBeCloseTo(1.15, 10);
    expect(getConsumableRuntimeEffects('OverchargeStim', 100).dpsMultiplier).toBeCloseTo(1.12, 10);
  });

  it('DELTA quality slopes double with the base deltas (Q175 worked checks)', () => {
    // Brief: "Ammo Pack at Q175 becomes +17.5%".
    expect(getConsumableRuntimeEffects('AmmoPack', 175).dpsMultiplier).toBeCloseTo(1.175, 10);
    expect(getConsumableRuntimeEffects('HighCapacityAmmoPack', 175).dpsMultiplier).toBeCloseTo(1.21, 10);
    expect(getConsumableRuntimeEffects('IncendiaryAmmo', 175).dpsMultiplier).toBeCloseTo(1.21, 10);
    expect(getConsumableRuntimeEffects('RedlineTonic', 175).dpsMultiplier).toBeCloseTo(1.245, 10);
    expect(getConsumableRuntimeEffects('ElementalCoating', 175).shieldBreakMultiplier).toBeCloseTo(1.2625, 10);
    expect(getConsumableRuntimeEffects('PrismCoating', 175).shieldBreakMultiplier).toBeCloseTo(1.315, 10);
  });
});

describe('P4 — survival family is %-of-pool (brief table, at Q100)', () => {
  it('defs declare fractions, not flat amounts', () => {
    expect(getConsumableRuntimeEffects('MedKit', 100).healHpPctOfPool).toBeCloseTo(0.2, 10);
    expect(getConsumableRuntimeEffects('MedKit', 100).healHp).toBeUndefined();
    expect(getConsumableRuntimeEffects('MedKitRefined', 100).healHpPctOfPool).toBeCloseTo(0.3, 10);
    const nano = getConsumableRuntimeEffects('NanoSwarm', 100);
    expect(nano.repairTotalHpPctOfPool).toBeCloseTo(0.35, 10);
    expect(nano.repairTotalHp).toBeUndefined();
    expect(nano.repairDurationSeconds).toBe(30);
    const cell = getConsumableRuntimeEffects('ShieldCell', 100);
    expect(cell.shieldRestorePctOfCapacity).toBeCloseTo(0.25, 10);
    expect(cell.shieldRestore).toBeUndefined();
    expect(cell.damageReductionPct).toBeCloseTo(0.15, 10);
    const shot = getConsumableRuntimeEffects('AdrenalineShot', 100);
    expect(shot.healHpPctOfPool).toBeCloseTo(0.1, 10);
    expect(shot.dpsMultiplier).toBeCloseTo(1.1, 10);
  });

  it('quality scales the fractions linearly — Q175 Med Kit = 35% of pool (brief check)', () => {
    expect(getConsumableRuntimeEffects('MedKit', 175).healHpPctOfPool).toBeCloseTo(0.35, 10);
    expect(getConsumableRuntimeEffects('MedKitRefined', 175).healHpPctOfPool).toBeCloseTo(0.525, 10);
    expect(getConsumableRuntimeEffects('ShieldCell', 175).shieldRestorePctOfCapacity).toBeCloseTo(0.4375, 10);
  });

  it('the behavior classifiers recognize the %-based defs', () => {
    expect(isBufferConsumable('MedKit')).toBe(true);
    expect(isBufferConsumable('MedKitRefined')).toBe(true);
    expect(isBufferConsumable('AdrenalineShot')).toBe(false); // reactive: carries a DPS burst
    expect(isRegenConsumable('NanoSwarm')).toBe(true);
    expect(isShieldRestoreConsumable('ShieldCell')).toBe(true);
  });

  it('roaming resolves the fractions against the live pools (L1 worked check: 188)', () => {
    expect(bufferHealPerUnit('MedKit', 100, L1_POOLS)).toBeCloseTo(188, 6);
    expect(bufferHealPerUnit('MedKitRefined', 100, L1_POOLS)).toBeCloseTo(282, 6);
    const state = activateFromInventory({ MedKit: 2, NanoSwarm: 1 }, 0, undefined, L1_POOLS);
    const medSlot = state.slots.find((s) => s.consumableId === 'MedKit');
    expect(medSlot?.remainingBuffer).toBeCloseTo(376, 6);
    const surv = getSurvivalState(state, L1_POOLS);
    expect(surv.medKitBuffer).toBeCloseTo(376, 6);
    // Nano Swarm: 35% of the 940 pool over 30s = 10 ticks.
    expect(surv.nanoSwarmHealThisTick).toBeCloseTo((0.35 * 940) / 10, 6);
  });

  it('a Shield Cell replenish restores 25% of shield capacity through processTick', () => {
    const inventory = { ShieldCell: 2 };
    let state = activateFromInventory(inventory, 0, undefined, L1_POOLS);
    let restored = 0;
    for (let tick = 1; tick <= 61; tick += 1) {
      const result = processTick(state, {
        tickIndex: tick,
        currentHp: L1_POOLS.maxHp,
        maxHp: L1_POOLS.maxHp,
        shieldCapacity: L1_POOLS.shieldCapacity,
        inventory,
        masteryLevels: {},
      });
      state = result.state;
      restored += result.shieldRestore;
    }
    expect(restored).toBeCloseTo(0.25 * L1_POOLS.shieldCapacity, 6);
  });

  it('without pool context a %-based unit resolves to 0 (flat units unaffected)', () => {
    expect(bufferHealPerUnit('MedKit', 100)).toBe(0);
  });
});

function weapon(): Weapon {
  return {
    id: 't2-test-gun', name: 'T2 Test Gun', level: 22, rarity: Rarity.Rare,
    weaponType: WeaponType.SMG, manufacturer: Manufacturer.Redline, element: Element.Fire,
    rollQuality: 100, baseDamage: 60, attackSpeed: 2, critChance: 0.2, critDamage: 1.5,
    statusChance: 0, statusDamage: 0, bossDamageMod: 0.2, waveDamageMod: 0,
    shieldDamageMod: 1, armorDamageMod: 1, offlineEarningsMod: 0, rareDropChanceMod: 0,
    scrapYieldMod: 0, parts: [], affixes: [], sourceTag: DropSource.WorldDrop,
    isLocked: false, pixelSeed: 1, combatPower: 0, bossPower: 0, farmPower: 0, economyScore: 0,
  } as Weapon;
}

describe('P4 — the boss sim prices %-of-pool heals against the attempt pool', () => {
  const base: BossSimulationInput = {
    primary: weapon(), secondary: null, heavy: null, ordnance: null, shield: null,
    classMod: null, relic: null, consumables: {},
    risk: RiskSetting.Balanced, boss: REGION_1_BOSSES[3], playerLevel: 22,
    skillBonuses: {}, pityCount: 0, playerCredits: 0,
  };

  it('a prepared Med Kit adds survival priced off the pool, and quality scales it', () => {
    const bare = simulateBoss(base);
    const kitted = simulateBoss({ ...base, consumables: { MedKit: 3 } });
    const crafted = simulateBoss({ ...base, consumables: { MedKit: 3 }, consumableQuality: { MedKit: 150 } });
    expect(kitted.survivalScore).toBeGreaterThan(bare.survivalScore);
    expect(crafted.survivalScore).toBeGreaterThan(kitted.survivalScore);
  });
});

describe('P5 — ordnance flat riders ×4 (Forgeheart 25 → 120)', () => {
  it('base riders read the new flat values at Q100', () => {
    expect(getConsumableRuntimeEffects('OrdnanceCharge', 100).ordnanceBonusDps).toBe(200);
    expect(getConsumableRuntimeEffects('EMPCharge', 100).ordnanceBonusDps).toBe(240);
    expect(getConsumableRuntimeEffects('CorrosiveCharge', 100).ordnanceBonusDps).toBe(280);
    expect(getConsumableRuntimeEffects('PhaseShiftGrenade', 100).ordnanceBonusDps).toBe(320);
    expect(getConsumableRuntimeEffects('MagnetizedPayload', 100).ordnanceBonusDps).toBe(360);
    expect(getConsumableRuntimeEffects('ForgeheartCharge', 100).ordnanceBonusDps).toBe(120);
  });

  it('Forgeheart keeps its flat quality scaling and its armor break', () => {
    expect(getConsumableRuntimeEffects('ForgeheartCharge', 150).ordnanceBonusDps).toBe(180);
    expect(getConsumableRuntimeEffects('ForgeheartCharge', 100).armorBreakMultiplier).toBeCloseTo(1.15, 10);
  });
});

describe('vendor staple prices are unchanged (magnitudes only)', () => {
  it('staple prices stand', () => {
    expect(CONSUMABLES['MedKit'].basePrice).toBe(250);
    expect(CONSUMABLES['ShieldCell'].basePrice).toBe(300);
    expect(CONSUMABLES['AmmoPack'].basePrice).toBe(150);
    expect(CONSUMABLES['OrdnanceCharge'].basePrice).toBe(400);
  });
});
