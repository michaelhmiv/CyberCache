import { describe, it, expect } from 'vitest';
import {
  activateLoadout,
  processTick,
  getSurvivalState,
  buildActiveBuffs,
} from '../lib/consumables/roamingConsumableEngine';
import { ConsumableType } from '../types/game';

// Engine constants are module-private; mirror the documented values here so
// the assertions read clearly. (1 tick = 3s.)
const MEDKIT_BUFFER_AMOUNT = 150;
const NANO_SWARM_TICKS = 30;
const ADRENALINE_BURST_TICKS = 7; // ~20s burst once triggered
const BASE_ORDNANCE_INTERVAL = 20; // ticks (60s), reduced by combat.ordnance mastery
const ORDNANCE_CHARGE_DPS = 50;
const AMMO_PACK_DPS_MULT = 1.05;
const SHIELD_CELL_REDUCTION = 0.15;
const LUCK_BOOSTER_LOOT = 0.25;
const ADRENALINE_DPS_MULT = 1.1;
const TICK_MS = 3000;
const AMMO_PACK_DURATION = 200;
const SHIELD_CELL_DURATION = 60;

/** Empty 3-slot loadout to spread + override per-test. */
const EMPTY_LOADOUT = {
  PreFight: null,
  MidFight: null,
  Emergency: null,
};

/** Build a TickContext with sensible defaults. */
function ctx(overrides: Partial<{
  tickIndex: number;
  currentHp: number;
  maxHp: number;
  inventory: Record<string, number>;
  masteryLevels: Record<string, number>;
}> = {}) {
  return {
    tickIndex: 0,
    currentHp: 100,
    maxHp: 100,
    inventory: {},
    masteryLevels: {},
    ...overrides,
  };
}

describe('roamingConsumableEngine', () => {
  // ─── activateLoadout ───────────────────────────────────────────────

  describe('activateLoadout', () => {
    it('activates every slot that has inventory stock', () => {
      const loadout = {
        PreFight: ConsumableType.MedKit,
        MidFight: ConsumableType.AmmoPack,
        Emergency: ConsumableType.OrdnanceCharge,
      };
      const inventory = {
        [ConsumableType.MedKit]: 3,
        [ConsumableType.AmmoPack]: 2,
        [ConsumableType.OrdnanceCharge]: 1,
      };
      const state = activateLoadout(loadout, inventory, 0);

      expect(state.slots).toHaveLength(3);
      expect(state.slots.map((s) => s.consumableId).sort()).toEqual(
        [ConsumableType.AmmoPack, ConsumableType.MedKit, ConsumableType.OrdnanceCharge].sort(),
      );
      expect(state.tickIndex).toBe(0);
    });

    it('does NOT activate slots with 0 inventory', () => {
      const loadout = {
        PreFight: ConsumableType.MedKit,
        MidFight: ConsumableType.AmmoPack,
        Emergency: null,
      };
      const inventory = { [ConsumableType.MedKit]: 0, [ConsumableType.AmmoPack]: 2 };
      const state = activateLoadout(loadout, inventory, 0);

      expect(state.slots).toHaveLength(1);
      expect(state.slots[0].consumableId).toBe(ConsumableType.AmmoPack);
    });

    it('initializes Med Kit buffer, Nano Swarm ticks, and Adrenaline armed flag', () => {
      const loadout = {
        PreFight: ConsumableType.MedKit,
        MidFight: ConsumableType.NanoSwarm,
        Emergency: ConsumableType.AdrenalineShot,
      };
      const inventory = {
        [ConsumableType.MedKit]: 1,
        [ConsumableType.NanoSwarm]: 1,
        [ConsumableType.AdrenalineShot]: 1,
      };
      const state = activateLoadout(loadout, inventory, 0);
      const byId = Object.fromEntries(state.slots.map((s) => [s.consumableId, s]));

      expect(byId[ConsumableType.MedKit].remainingBuffer).toBe(MEDKIT_BUFFER_AMOUNT);
      expect(byId[ConsumableType.NanoSwarm].remainingRegenTicks).toBe(NANO_SWARM_TICKS);
      expect(byId[ConsumableType.AdrenalineShot].armed).toBe(true);
      // Adrenaline is reactive: no duration, not bursting yet.
      expect(byId[ConsumableType.AdrenalineShot].remainingBurstTicks).toBe(0);
      expect(byId[ConsumableType.AdrenalineShot].expiresAtTick).toBe(0);
    });

    it('stacks Med Kit buffer from inventory count', () => {
      const loadout = {
        PreFight: ConsumableType.MedKit,
        MidFight: null,
        Emergency: null,
      };
      const inventory = { [ConsumableType.MedKit]: 5 };
      const state = activateLoadout(loadout, inventory, 0);
      expect(state.slots[0].remainingBuffer).toBe(5 * MEDKIT_BUFFER_AMOUNT); // 750
    });

    it('sets ordnanceNextFireTick based on start tick', () => {
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.OrdnanceCharge },
        { [ConsumableType.OrdnanceCharge]: 1 },
        5,
      );
      const slot = state.slots[0];
      expect(slot.ordnanceNextFireTick).toBe(5 + BASE_ORDNANCE_INTERVAL);
      expect(slot.expiresAtTick).toBe(0); // interval-based, no duration
    });
  });

  // ─── processTick — duration expiry ─────────────────────────────────

  describe('processTick — duration expiry', () => {
    it('expires a duration consumable past its expiresAtTick and auto-replenishes from inventory', () => {
      const inventory = { [ConsumableType.AmmoPack]: 2 };
      // AmmoPack duration is 200 ticks → activated at tick 0, expires at tick 200.
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.AmmoPack },
        inventory,
        0,
      );
      expect(state.slots[0].expiresAtTick).toBe(AMMO_PACK_DURATION);

      const result = processTick(state, ctx({ tickIndex: 200, inventory }));

      // Expired → consumed one charge.
      expect(result.consumed).toHaveLength(1);
      expect(result.consumed[0].id).toBe(ConsumableType.AmmoPack);

      // Auto-replenished: slot survives with a fresh duration window.
      expect(result.state.slots).toHaveLength(1);
      expect(result.state.slots[0].expiresAtTick).toBe(200 + AMMO_PACK_DURATION);
      // The replenished consumable still contributes its modifier this tick.
      expect(result.mods.dpsMultiplier).toBeCloseTo(AMMO_PACK_DPS_MULT);
    });

    it('removes the slot when no stock remains after expiry', () => {
      const inventory = { [ConsumableType.AmmoPack]: 1 };
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.AmmoPack },
        inventory,
        0,
      );
      const result = processTick(state, ctx({ tickIndex: 200, inventory }));

      expect(result.consumed).toHaveLength(1);
      expect(result.state.slots).toHaveLength(0);
    });
  });

  // ─── processTick — Med Kit buffer ──────────────────────────────────

  describe('processTick — Med Kit buffer', () => {
    it('preserves remaining buffer through ticks (no per-tick consumption)', () => {
      const inventory = { [ConsumableType.MedKit]: 5 };
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.MedKit },
        inventory,
        0,
      );
      // Simulate 200 damage absorbed by Chef's damage loop
      state.slots[0].remainingBuffer = 550; // 750 - 200

      const result = processTick(state, ctx({ tickIndex: 5, inventory }));

      // Buffer preserved — Chef handles absorption, processTick doesn't touch it
      expect(result.state.slots[0].remainingBuffer).toBe(550);
      // No consumption from processTick
      expect(result.consumed.filter((c) => c.id === ConsumableType.MedKit)).toHaveLength(0);
      // Slot survives
      expect(result.state.slots).toHaveLength(1);
    });
  });

  // ─── processTick — Adrenaline trigger ──────────────────────────────

  describe('processTick — Adrenaline trigger', () => {
    it('stays armed while HP is above the 20% threshold', () => {
      const inventory = { [ConsumableType.AdrenalineShot]: 1 };
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.AdrenalineShot },
        inventory,
        0,
      );
      // 100/100 = 100% — well above threshold.
      const result = processTick(state, ctx({ tickIndex: 5, currentHp: 100, maxHp: 100 }));

      const slot = result.state.slots[0];
      expect(slot.armed).toBe(true);
      expect(slot.remainingBurstTicks).toBe(0);
      // No active burst → no DPS modifier.
      expect(result.mods.dpsMultiplier).toBe(1);
    });

    it('triggers a burst when HP drops below the threshold', () => {
      const inventory = { [ConsumableType.AdrenalineShot]: 1 };
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.AdrenalineShot },
        inventory,
        0,
      );
      // 15/100 = 15% < 20% threshold.
      const result = processTick(
        state,
        ctx({ tickIndex: 5, currentHp: 15, maxHp: 100 }),
      );

      const slot = result.state.slots[0];
      expect(slot.armed).toBe(false);
      // Burst is set to ADRENALINE_BURST_TICKS then immediately decremented
      // once within the same tick.
      expect(slot.remainingBurstTicks).toBe(ADRENALINE_BURST_TICKS - 1);
      // Active burst applies the +10% DPS modifier.
      expect(result.mods.dpsMultiplier).toBeCloseTo(ADRENALINE_DPS_MULT);
      expect(getSurvivalState(result.state).adrenalineActive).toBe(true);
    });

    it('consumes and re-arms after the burst expires when stock remains', () => {
      const inventory = { [ConsumableType.AdrenalineShot]: 2 };
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.AdrenalineShot },
        inventory,
        0,
      );
      // Simulate the burst being one tick from expiring.
      state.slots[0].armed = false;
      state.slots[0].remainingBurstTicks = 1;

      const result = processTick(
        state,
        ctx({ tickIndex: 20, currentHp: 100, maxHp: 100, inventory }),
      );

      expect(result.consumed).toHaveLength(1);
      expect(result.consumed[0].id).toBe(ConsumableType.AdrenalineShot);
      const slot = result.state.slots[0];
      expect(slot.armed).toBe(true);
      expect(slot.remainingBurstTicks).toBe(0);
    });
  });

  // ─── processTick — Ordnance interval ───────────────────────────────

  describe('processTick — Ordnance interval', () => {
    it('does not fire before the interval elapses', () => {
      const inventory = { [ConsumableType.OrdnanceCharge]: 5 };
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.OrdnanceCharge },
        inventory,
        0,
      );
      // Next fire scheduled at tick 20; tick 19 is still early.
      const result = processTick(state, ctx({ tickIndex: 19, inventory }));

      expect(result.mods.ordnanceBonusDps).toBe(0);
      expect(result.consumed).toHaveLength(0);
      expect(result.state.slots[0].ordnanceNextFireTick).toBe(BASE_ORDNANCE_INTERVAL);
    });

    it('fires on the interval and adds ordnanceBonusDps to mods', () => {
      const inventory = { [ConsumableType.OrdnanceCharge]: 5 };
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.OrdnanceCharge },
        inventory,
        0,
      );
      const result = processTick(state, ctx({ tickIndex: 20, inventory }));

      expect(result.mods.ordnanceBonusDps).toBe(ORDNANCE_CHARGE_DPS);
      expect(result.consumed).toHaveLength(1);
      expect(result.consumed[0].id).toBe(ConsumableType.OrdnanceCharge);
      // Next fire pushed forward by the base interval (mastery 0).
      expect(result.state.slots[0].ordnanceNextFireTick).toBe(20 + BASE_ORDNANCE_INTERVAL);
    });

    it('reduces the interval using combat.ordnance mastery (level 10 → 15 ticks)', () => {
      const inventory = { [ConsumableType.OrdnanceCharge]: 5 };
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.OrdnanceCharge },
        inventory,
        0,
      );
      const result = processTick(
        state,
        ctx({ tickIndex: 20, inventory, masteryLevels: { 'combat.ordnance': 10 } }),
      );

      // effectiveInterval = max(10, 20 - floor(10/2)) = max(10, 15) = 15
      expect(result.state.slots[0].ordnanceNextFireTick).toBe(20 + 15);
      expect(result.mods.ordnanceBonusDps).toBe(ORDNANCE_CHARGE_DPS);
    });
  });

  // ─── processTick — modifier accumulation ───────────────────────────

  describe('processTick — modifier accumulation', () => {
    it('Ammo Pack adds a dpsMultiplier', () => {
      const inventory = { [ConsumableType.AmmoPack]: 1 };
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.AmmoPack },
        inventory,
        0,
      );
      const result = processTick(state, ctx({ tickIndex: 5, inventory }));
      expect(result.mods.dpsMultiplier).toBeCloseTo(AMMO_PACK_DPS_MULT);
    });

    it('Shield Cell adds damageReductionPct', () => {
      const inventory = { [ConsumableType.ShieldCell]: 1 };
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.ShieldCell },
        inventory,
        0,
      );
      const result = processTick(state, ctx({ tickIndex: 5, inventory }));
      expect(result.mods.damageReductionPct).toBeCloseTo(SHIELD_CELL_REDUCTION);
    });

    it('Luck Booster adds bonusLootChance', () => {
      const inventory = { [ConsumableType.LuckBooster]: 1 };
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.LuckBooster },
        inventory,
        0,
      );
      const result = processTick(state, ctx({ tickIndex: 5, inventory }));
      expect(result.mods.bonusLootChance).toBeCloseTo(LUCK_BOOSTER_LOOT);
    });

    it('stacks modifiers from multiple active consumables', () => {
      const inventory = {
        [ConsumableType.AmmoPack]: 1,
        [ConsumableType.ShieldCell]: 1,
        [ConsumableType.LuckBooster]: 1,
      };
      const state = activateLoadout(
        {
          PreFight: ConsumableType.AmmoPack,
          MidFight: ConsumableType.ShieldCell,
          Emergency: ConsumableType.LuckBooster,
        },
        inventory,
        0,
      );
      expect(state.slots).toHaveLength(3);

      const result = processTick(state, ctx({ tickIndex: 5, inventory }));
      expect(result.mods.dpsMultiplier).toBeCloseTo(AMMO_PACK_DPS_MULT);
      expect(result.mods.damageReductionPct).toBeCloseTo(SHIELD_CELL_REDUCTION);
      expect(result.mods.bonusLootChance).toBeCloseTo(LUCK_BOOSTER_LOOT);
    });
  });

  // ─── buildActiveBuffs ──────────────────────────────────────────────

  describe('buildActiveBuffs', () => {
    it('reports remaining duration for duration-based consumables (Shield Cell)', () => {
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.ShieldCell },
        { [ConsumableType.ShieldCell]: 1 },
        0,
      );
      // Shield Cell duration is 60 ticks; viewed at tick 10 → 50 ticks left.
      const buffs = buildActiveBuffs(state, 10);
      expect(buffs).toHaveLength(1);
      expect(buffs[0].remainingMs).toBe((SHIELD_CELL_DURATION - 10) * TICK_MS);
    });

    it('reports remaining buffer for Med Kit', () => {
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.MedKit },
        { [ConsumableType.MedKit]: 1 },
        0,
      );
      const buffs = buildActiveBuffs(state, 0);
      expect(buffs[0].remainingBuffer).toBe(MEDKIT_BUFFER_AMOUNT);
      expect(buffs[0].remainingMs).toBe(0); // buffer-based, no duration
    });

    it('reports armed state and burst seconds for Adrenaline', () => {
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.AdrenalineShot },
        { [ConsumableType.AdrenalineShot]: 1 },
        0,
      );
      const buffs = buildActiveBuffs(state, 0);
      expect(buffs[0].armed).toBe(true);
      expect(buffs[0].remainingBurstSeconds).toBe(0); // not triggered yet
    });

    it('reports seconds until next fire for Ordnance', () => {
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.OrdnanceCharge },
        { [ConsumableType.OrdnanceCharge]: 1 },
        0,
      );
      const buffs = buildActiveBuffs(state, 5);
      expect(buffs[0].ordnanceNextFireSeconds).toBe((BASE_ORDNANCE_INTERVAL - 5) * 3);
    });

    it('reports remaining regen ticks for Nano Swarm', () => {
      const state = activateLoadout(
        { ...EMPTY_LOADOUT, PreFight: ConsumableType.NanoSwarm },
        { [ConsumableType.NanoSwarm]: 1 },
        0,
      );
      const buffs = buildActiveBuffs(state, 0);
      expect(buffs[0].remainingTicks).toBe(NANO_SWARM_TICKS);
    });
  });
});
