/**
 * Roaming Consumable Engine — Server-Authoritative
 *
 * Pure functions imported by the Chef. No React, no Zustand, no Supabase.
 * The Chef passes in state; the engine returns mutated state + modifier map.
 *
 * ## Lifecycle
 *
 * 1. `activateLoadout()` — called once when roaming starts (or on the first
 *    tick of a claim batch if no prior state exists). Reads the 3 loadout
 *    slots + inventory and initializes `ActiveSlotState` for each.
 * 2. `processTick()` — called every tick inside `processRoamingClaim()`.
 *    Advances durations, expires depleted slots, auto-replenishes from
 *    inventory, fires ordnance on interval, and returns a modifier map.
 * 3. The Chef reads the modifier map and applies it to DPS, loot, survival,
 *    and economy calculations. The Chef manages the actual damage/heal
 *    numbers using the slot state (medKitBuffer, nanoSwarmTicks, etc.).
 *
 * ## Slot families
 *
 * | Family | Activation | Duration | Auto-replenish |
 * |---|---|---|---|
 * | Med Kit | proactive buffer | until 150 dmg absorbed | yes |
 * | Shield Cell | shield restore + resistance | 60 ticks (180s) | yes |
 * | Nano Swarm | per-tick regen | 30 ticks (90s) | yes |
 * | Adrenaline Shot | reactive (HP < 20%) | 7 ticks (20s burst) | yes (re-arms) |
 * | Ammo | DPS multiplier | 200 ticks (600s) | yes |
 * | Tactical | incoming DPS / accuracy mods | 200 ticks (600s) | yes |
 * | Economy | loot / event / scrap mods | 200 ticks (600s) | yes |
 * | Ordnance | interval burst | every N ticks | yes (per fire) |
 *
 * Ordnance interval: base 20 ticks (60s), reduced by `combat.ordnance`
 * mastery level: `max(10, 20 - floor(level / 2))`.
 */

import { ConsumableType } from '@/types/game';
import type { ConsumableFamily } from '@/constants/consumables';

// ─── Types ───────────────────────────────────────────────────────────

export type ConsumableSlotName = 'PreFight' | 'MidFight' | 'Emergency';

export interface LoadoutConsumableSlots {
  PreFight: string | null;
  MidFight: string | null;
  Emergency: string | null;
}

/** Per-slot active state tracked across ticks. */
export interface ActiveSlotState {
  slot: ConsumableSlotName;
  consumableId: ConsumableType;
  family: ConsumableFamily;
  activatedAtTick: number;
  /** Tick index when this slot expires (0 for reactive / buffer-based). */
  expiresAtTick: number;
  /** Med Kit: remaining HP buffer. */
  remainingBuffer: number;
  /** Nano Swarm: remaining regen ticks. */
  remainingRegenTicks: number;
  /** Adrenaline: true while armed (waiting for HP threshold). */
  armed: boolean;
  /** Adrenaline: remaining burst ticks once triggered. */
  remainingBurstTicks: number;
  /** Ordnance: next tick this should fire. */
  ordnanceNextFireTick: number;
}

/** Serializable state carried between claim batches. */
export interface RoamingConsumableState {
  slots: ActiveSlotState[];
  /** Monotonic tick counter for this roaming session. */
  tickIndex: number;
}

/** Modifier map — applied by the Chef to tick calculations. */
export interface RoamingConsumableMods {
  /** Multiplicative DPS modifier (ammo, adrenaline, tactical). */
  dpsMultiplier: number;
  /** Damage reduction 0-1 applied to monster attackPower (Shield Cell). */
  damageReductionPct: number;
  /** Bonus loot chance 0-1 added to gear drop threshold. */
  bonusLootChance: number;
  /** Extra loot roll chance 0-1 (Data Skimmer). */
  extraLootRollChance: number;
  /** Multiplicative scrap yield modifier. */
  scrapYieldMultiplier: number;
  /** Rare drop chance modifier 0-1. */
  rareDropChanceMod: number;
  /** Event chance bonus 0-1 (Loot Beacon). */
  eventChanceBonus: number;
  /** Enemy pressure multiplier (Loot Beacon drawback). */
  enemyPressureMultiplier: number;
  /** Multiplicative XP modifier. */
  xpMultiplier: number;
  /** Incoming DPS multiplier (Cryo Ammo reduces monster damage). */
  incomingDpsMultiplier: number;
  /** Incoming accuracy multiplier (Signal Scrambler). */
  incomingAccuracyMultiplier: number;
  /** Flat bonus DPS applied this tick from ordnance fire. */
  ordnanceBonusDps: number;
}

/** Zero-value modifier map (no consumables active). */
export function emptyMods(): RoamingConsumableMods {
  return {
    dpsMultiplier: 1,
    damageReductionPct: 0,
    bonusLootChance: 0,
    extraLootRollChance: 0,
    scrapYieldMultiplier: 1,
    rareDropChanceMod: 0,
    eventChanceBonus: 0,
    enemyPressureMultiplier: 1,
    xpMultiplier: 1,
    incomingDpsMultiplier: 1,
    incomingAccuracyMultiplier: 1,
    ordnanceBonusDps: 0,
  };
}

export interface ConsumedEntry {
  id: string;
  count: number;
  reason: string;
}

export interface FeedEventLike {
  tone: string;
  label: string;
  detail: string;
}

export interface TickResult {
  state: RoamingConsumableState;
  mods: RoamingConsumableMods;
  consumed: ConsumedEntry[];
  feedEvents: FeedEventLike[];
  /** Shield Cell: shield restored this tick (on activation/replenish). */
  shieldRestore: number;
}

// ─── Family classification ───────────────────────────────────────────

const SURVIVAL_TYPES = new Set<string>([
  ConsumableType.MedKit,
  ConsumableType.ShieldCell,
  ConsumableType.NanoSwarm,
  ConsumableType.AdrenalineShot,
]);

const AMMO_TYPES = new Set<string>([
  ConsumableType.AmmoPack,
  ConsumableType.ArmorPiercingAmmo,
  ConsumableType.IncendiaryAmmo,
  ConsumableType.ShockAmmo,
  ConsumableType.CorrosiveAmmo,
  ConsumableType.CryoAmmo,
  ConsumableType.VoidAmmo,
]);

const ORDNANCE_TYPES = new Set<string>([
  ConsumableType.OrdnanceCharge,
  ConsumableType.EMPCharge,
  ConsumableType.CorrosiveCharge,
  ConsumableType.MagnetizedPayload,
  ConsumableType.PhaseShiftGrenade,
]);

const TACTICAL_TYPES = new Set<string>([
  ConsumableType.SignalScrambler,
  ConsumableType.Jammer,
  ConsumableType.TargetPainter,
  ConsumableType.OverchargeStim,
  ConsumableType.BossScanner,
]);

const ECONOMY_TYPES = new Set<string>([
  ConsumableType.LootBeacon,
  ConsumableType.LuckBooster,
  ConsumableType.DataSkimmer,
  ConsumableType.InsuranceToken,
  ConsumableType.SalvageContract,
  ConsumableType.WorkshopRushTicket,
]);

function classifyFamily(id: string): ConsumableFamily {
  if (SURVIVAL_TYPES.has(id)) return 'survival';
  if (AMMO_TYPES.has(id)) return 'ammo';
  if (ORDNANCE_TYPES.has(id)) return 'ordnance';
  if (TACTICAL_TYPES.has(id)) return 'tactical';
  if (ECONOMY_TYPES.has(id)) return 'economy';
  return 'economy'; // safe default
}

// ─── Duration constants (in ticks; 1 tick = 3s) ──────────────────────

const _TICKS_PER_MINUTE = 20;

const DURATION_TICKS: Record<string, number> = {
  // Survival
  [ConsumableType.MedKit]: 0,          // buffer-based, not duration
  [ConsumableType.ShieldCell]: 60,     // 180s
  [ConsumableType.NanoSwarm]: 30,      // 90s
  [ConsumableType.AdrenalineShot]: 0,  // reactive
  // Ammo
  [ConsumableType.AmmoPack]: 200,           // 600s
  [ConsumableType.ArmorPiercingAmmo]: 200,
  [ConsumableType.IncendiaryAmmo]: 200,
  [ConsumableType.ShockAmmo]: 200,
  [ConsumableType.CorrosiveAmmo]: 200,
  [ConsumableType.CryoAmmo]: 200,
  [ConsumableType.VoidAmmo]: 200,
  // Tactical
  [ConsumableType.SignalScrambler]: 200,
  [ConsumableType.Jammer]: 200,
  [ConsumableType.TargetPainter]: 200,
  [ConsumableType.OverchargeStim]: 200,
  [ConsumableType.BossScanner]: 200,
  // Economy
  [ConsumableType.LootBeacon]: 200,
  [ConsumableType.LuckBooster]: 200,
  [ConsumableType.DataSkimmer]: 200,
  // Ordnance — interval-based, not duration
  [ConsumableType.OrdnanceCharge]: 0,
  [ConsumableType.EMPCharge]: 0,
  [ConsumableType.CorrosiveCharge]: 0,
  [ConsumableType.MagnetizedPayload]: 0,
  [ConsumableType.PhaseShiftGrenade]: 0,
};

// ─── Effect magnitudes per consumable ────────────────────────────────

const EFFECT_VALUES: Record<string, {
  dpsMult?: number;
  damageReduce?: number;
  bonusLoot?: number;
  extraRoll?: number;
  scrapMult?: number;
  rareDrop?: number;
  eventBonus?: number;
  enemyPressure?: number;
  incomingDpsMult?: number;
  incomingAccMult?: number;
}> = {
  // Survival
  [ConsumableType.MedKit]: {},
  [ConsumableType.ShieldCell]: { damageReduce: 0.15 },
  [ConsumableType.NanoSwarm]: {},
  [ConsumableType.AdrenalineShot]: { dpsMult: 1.1 },
  // Ammo — flat DPS multipliers
  [ConsumableType.AmmoPack]: { dpsMult: 1.05 },
  [ConsumableType.ArmorPiercingAmmo]: { dpsMult: 1.25 },
  [ConsumableType.IncendiaryAmmo]: { dpsMult: 1.08 },
  [ConsumableType.ShockAmmo]: { dpsMult: 1.30 },
  [ConsumableType.CorrosiveAmmo]: { dpsMult: 1.30 },
  [ConsumableType.CryoAmmo]: { dpsMult: 1.11, incomingDpsMult: 0.90 },
  [ConsumableType.VoidAmmo]: { dpsMult: 1.22 },
  // Tactical
  [ConsumableType.SignalScrambler]: { incomingDpsMult: 0.90, incomingAccMult: 0.85 },
  [ConsumableType.Jammer]: { incomingAccMult: 0.80 },
  [ConsumableType.TargetPainter]: { dpsMult: 1.15 },
  [ConsumableType.OverchargeStim]: { dpsMult: 1.12 },
  [ConsumableType.BossScanner]: {},
  // Economy
  [ConsumableType.LootBeacon]: { eventBonus: 0.10, enemyPressure: 1.05 },
  [ConsumableType.LuckBooster]: { bonusLoot: 0.25 },
  [ConsumableType.DataSkimmer]: { extraRoll: 0.25 },
  // Ordnance — handled by ordnanceBonusDps, not multiplier
  [ConsumableType.OrdnanceCharge]: {},
  [ConsumableType.EMPCharge]: {},
  [ConsumableType.CorrosiveCharge]: {},
  [ConsumableType.MagnetizedPayload]: {},
  [ConsumableType.PhaseShiftGrenade]: {},
};

// ─── Med Kit / Nano Swarm constants ──────────────────────────────────

const MEDKIT_BUFFER_AMOUNT = 150;
const MEDKIT_REFINED_BUFFER = 260;
const NANO_SWARM_HEAL_PER_TICK = 10;
const NANO_SWARM_TICKS = 30;
const ADRENALINE_BURST_TICKS = 7; // ~20s
const ADRENALINE_HP_THRESHOLD = 0.20;
const SHIELD_CELL_RESTORE = 100;
const BASE_ORDNANCE_INTERVAL = 20; // ticks (60s)

/**
 * Ordnance bonus damage per fire, by type.
 * Applied as flat bonus DPS for one tick.
 */
const ORDNANCE_BONUS_DPS: Record<string, number> = {
  [ConsumableType.OrdnanceCharge]: 50,
  [ConsumableType.EMPCharge]: 60,
  [ConsumableType.CorrosiveCharge]: 70,
  [ConsumableType.MagnetizedPayload]: 90,
  [ConsumableType.PhaseShiftGrenade]: 80,
};

// ─── Activation ──────────────────────────────────────────────────────

/**
 * Activate ALL owned consumables from inventory (no slot gating).
 * Replaces the old 3-slot loadout model. Any consumable the player owns
 * contributes its effect: survival buffers stack, durations auto-renew,
 * ordnance fires on interval.
 *
 * Called on the first tick of a roaming claim when no prior state exists.
 */
export function activateFromInventory(
  inventory: Record<string, number>,
  startTick: number,
): RoamingConsumableState {
  const slots: ActiveSlotState[] = [];

  for (const [consumableId, count] of Object.entries(inventory)) {
    if (count <= 0) continue;
    const id = consumableId as ConsumableType;
    const family = classifyFamily(id);
    const duration = DURATION_TICKS[id] ?? 0;

    // Skip consumables that aren't classified (unknown types)
    if (!family || !DURATION_TICKS[id] === undefined) continue;

    const activeSlot: ActiveSlotState = {
      slot: 'PreFight' as ConsumableSlotName, // placeholder — slots are irrelevant now
      consumableId: id,
      family,
      activatedAtTick: startTick,
      expiresAtTick: duration > 0 ? startTick + duration : 0,
      remainingBuffer: 0,
      remainingRegenTicks: 0,
      armed: false,
      remainingBurstTicks: 0,
      ordnanceNextFireTick: 0,
    };

    // Family-specific initialization
    if (id === ConsumableType.MedKit) {
      activeSlot.remainingBuffer = count * MEDKIT_BUFFER_AMOUNT;
    } else if (id === 'MedKitRefined') {
      activeSlot.remainingBuffer = count * MEDKIT_REFINED_BUFFER;
    } else if (id === ConsumableType.NanoSwarm) {
      activeSlot.remainingRegenTicks = NANO_SWARM_TICKS;
    } else if (id === ConsumableType.AdrenalineShot) {
      activeSlot.armed = true;
    } else if (id === ConsumableType.ShieldCell) {
      // Shield Cell grants instant shield restore on activation.
    } else if (ORDNANCE_TYPES.has(id)) {
      activeSlot.ordnanceNextFireTick = startTick + BASE_ORDNANCE_INTERVAL;
    }

    slots.push(activeSlot);
  }

  return { slots, tickIndex: startTick };
}

/**
 * Initialize roaming consumable state from loadout + inventory.
 * @deprecated Use activateFromInventory instead — slots are removed.
 * Kept for backward compatibility with existing roaming states.
 */
export function activateLoadout(
  loadout: LoadoutConsumableSlots,
  inventory: Record<string, number>,
  startTick: number,
): RoamingConsumableState {
  const slots: ActiveSlotState[] = [];
  const slotNames: ConsumableSlotName[] = ['PreFight', 'MidFight', 'Emergency'];

  for (const slotName of slotNames) {
    const id = loadout[slotName];
    if (!id) continue;
    // Only activate if player has at least 1 in inventory
    if ((inventory[id] ?? 0) <= 0) continue;

    const family = classifyFamily(id);
    const duration = DURATION_TICKS[id] ?? 0;

    const activeSlot: ActiveSlotState = {
      slot: slotName,
      consumableId: id as ConsumableType,
      family,
      activatedAtTick: startTick,
      expiresAtTick: duration > 0 ? startTick + duration : 0,
      remainingBuffer: 0,
      remainingRegenTicks: 0,
      armed: false,
      remainingBurstTicks: 0,
      ordnanceNextFireTick: 0,
    };

    // Family-specific initialization
    if (id === ConsumableType.MedKit) {
      activeSlot.remainingBuffer = (inventory[id] ?? 0) * MEDKIT_BUFFER_AMOUNT;
    } else if (id === 'MedKitRefined') {
      activeSlot.remainingBuffer = (inventory[id] ?? 0) * MEDKIT_REFINED_BUFFER;
    } else if (id === ConsumableType.NanoSwarm) {
      activeSlot.remainingRegenTicks = NANO_SWARM_TICKS;
    } else if (id === ConsumableType.AdrenalineShot) {
      activeSlot.armed = true;
    } else if (id === ConsumableType.ShieldCell) {
      // Shield Cell grants instant shield restore on activation.
      // The resistance duration is tracked via expiresAtTick.
      // Shield restore is handled via the mods/tick result.
    } else if (ORDNANCE_TYPES.has(id)) {
      activeSlot.ordnanceNextFireTick = startTick + BASE_ORDNANCE_INTERVAL;
    }

    slots.push(activeSlot);
  }

  return { slots, tickIndex: startTick };
}

// ─── Per-tick processing ─────────────────────────────────────────────

export interface TickContext {
  /** Current tick index (monotonic for this claim batch). */
  tickIndex: number;
  /** Player's current HP (for Adrenaline threshold check). */
  currentHp: number;
  /** Player's max HP. */
  maxHp: number;
  /** Consumable inventory count map (server-authoritative from DB). */
  inventory: Record<string, number>;
  /** Mastery levels for interval reduction. */
  masteryLevels: Record<string, number>;
}

/**
 * Process one tick of the roaming consumable engine.
 *
 * This function:
 * 1. Increments the tick counter
 * 2. For each active slot:
 *    a. Checks expiry → if expired, consume from inventory, auto-replenish
 *    b. Handles reactive triggers (Adrenaline)
 *    c. Fires ordnance if interval elapsed
 *    d. Accumulates modifiers
 * 3. Returns updated state, modifier map, consumed list, and feed events
 *
 * The Chef reads the modifier map and applies it to the tick calculations.
 * The Chef manages actual damage/heal numbers using the slot state directly
 * (e.g., reading `slot.remainingBuffer` for Med Kit damage absorption).
 */
export function processTick(
  prevState: RoamingConsumableState,
  ctx: TickContext,
): TickResult {
  const state: RoamingConsumableState = {
    slots: prevState.slots.map((s) => ({ ...s })),
    tickIndex: ctx.tickIndex,
  };
  const consumed: ConsumedEntry[] = [];
  const feedEvents: FeedEventLike[] = [];
  const mods = emptyMods();

  // Track whether shield cell just activated (for restore effect)
  let shieldCellJustActivated = false;
  let shieldRestoreAmount = 0;

  for (let i = 0; i < state.slots.length; i++) {
    const slot = state.slots[i];

    // ── Check expiry for duration-based consumables ──
    if (slot.expiresAtTick > 0 && ctx.tickIndex >= slot.expiresAtTick) {
      // Expired — consume from inventory
      consumed.push({ id: slot.consumableId, count: 1, reason: `${slot.consumableId} duration expired` });
      feedEvents.push({
        tone: 'consumable',
        label: `${slot.consumableId} expired`,
        detail: `${slot.consumableId} duration timer elapsed.`,
      });

      // Auto-replenish: check if we have more in inventory (minus the one just consumed)
      const remainingAfterConsume = Math.max(0, (ctx.inventory[slot.consumableId] ?? 0) - 1);
      if (remainingAfterConsume > 0) {
        // Reactivate with fresh duration
        const duration = DURATION_TICKS[slot.consumableId] ?? 0;
        slot.activatedAtTick = ctx.tickIndex;
        slot.expiresAtTick = duration > 0 ? ctx.tickIndex + duration : 0;
        slot.remainingBuffer = slot.consumableId === ConsumableType.MedKit ? MEDKIT_BUFFER_AMOUNT : 0;
        slot.remainingRegenTicks = slot.consumableId === ConsumableType.NanoSwarm ? NANO_SWARM_TICKS : 0;
        slot.armed = slot.consumableId === ConsumableType.AdrenalineShot;
        slot.remainingBurstTicks = 0;

        if (slot.consumableId === ConsumableType.ShieldCell) {
          shieldCellJustActivated = true;
          shieldRestoreAmount = SHIELD_CELL_RESTORE;
        }
        feedEvents.push({
          tone: 'consumable',
          label: `${slot.consumableId} replenished`,
          detail: `Auto-loaded next ${slot.consumableId} from inventory.`,
        });
      } else {
        // No stock — deactivate this slot
        state.slots.splice(i, 1);
        i--;
        continue;
      }
    }

    // ── Nano Swarm regen tick ──
    if (slot.consumableId === ConsumableType.NanoSwarm && slot.remainingRegenTicks > 0) {
      slot.remainingRegenTicks--;
      if (slot.remainingRegenTicks <= 0) {
        consumed.push({ id: slot.consumableId, count: 1, reason: 'Nano Swarm regen exhausted' });
        feedEvents.push({
          tone: 'consumable',
          label: 'Nano Swarm expired',
          detail: 'Repair cloud dissipated.',
        });

        const remainingAfterConsume = Math.max(0, (ctx.inventory[slot.consumableId] ?? 0) - 1);
        if (remainingAfterConsume > 0) {
          slot.remainingRegenTicks = NANO_SWARM_TICKS;
          slot.activatedAtTick = ctx.tickIndex;
          feedEvents.push({
            tone: 'consumable',
            label: 'Nano Swarm replenished',
            detail: `+${NANO_SWARM_HEAL_PER_TICK} HP/tick for ${NANO_SWARM_TICKS} ticks.`,
          });
        } else {
          state.slots.splice(i, 1);
          i--;
          continue;
        }
      }
    }

    // ── Adrenaline reactive trigger ──
    if (slot.consumableId === ConsumableType.AdrenalineShot) {
      if (slot.armed && ctx.currentHp > 0 && ctx.maxHp > 0 &&
          ctx.currentHp / ctx.maxHp < ADRENALINE_HP_THRESHOLD) {
        // Trigger the burst!
        slot.armed = false;
        slot.remainingBurstTicks = ADRENALINE_BURST_TICKS;
        feedEvents.push({
          tone: 'consumable',
          label: 'Adrenaline Shot',
          detail: `Emergency DPS burst! +10% DPS for ~20s.`,
        });
      }

      // Decrement burst timer
      if (slot.remainingBurstTicks > 0) {
        slot.remainingBurstTicks--;
        if (slot.remainingBurstTicks <= 0) {
          // Burst expired — consume and re-arm
          consumed.push({ id: slot.consumableId, count: 1, reason: 'Adrenaline burst expired' });
          feedEvents.push({
            tone: 'consumable',
            label: 'Adrenaline burst ended',
            detail: 'DPS burst expired.',
          });

          const remainingAfterConsume = Math.max(0, (ctx.inventory[slot.consumableId] ?? 0) - 1);
          if (remainingAfterConsume > 0) {
            slot.armed = true;
            slot.activatedAtTick = ctx.tickIndex;
            feedEvents.push({
              tone: 'consumable',
              label: 'Adrenaline re-armed',
              detail: 'Waiting for HP threshold.',
            });
          } else {
            state.slots.splice(i, 1);
            i--;
            continue;
          }
        }
      }
    }

    // ── Ordnance interval fire ──
    if (ORDNANCE_TYPES.has(slot.consumableId)) {
      // Calculate effective interval with mastery
      const ordnanceMastery = ctx.masteryLevels['combat.ordnance'] ?? 0;
      const effectiveInterval = Math.max(10, BASE_ORDNANCE_INTERVAL - Math.floor(ordnanceMastery / 2));

      if (ctx.tickIndex >= slot.ordnanceNextFireTick) {
        // Check if we have stock
        const currentStock = ctx.inventory[slot.consumableId] ?? 0;
        if (currentStock > 0) {
          // Fire!
          const bonusDps = ORDNANCE_BONUS_DPS[slot.consumableId] ?? 50;
          mods.ordnanceBonusDps += bonusDps;
          slot.ordnanceNextFireTick = ctx.tickIndex + effectiveInterval;
          feedEvents.push({
            tone: 'consumable',
            label: `${slot.consumableId} fired`,
            detail: `Ordnance burst: +${bonusDps} DPS this tick.`,
          });
          // We don't consume here — consumption happens when the Chef
          // processes the consumed list. But we need to track it.
          // Actually, ordnance is consumed PER FIRE. Add to consumed.
          consumed.push({ id: slot.consumableId, count: 1, reason: 'Ordnance fired during roaming' });

          // If no more stock after this fire, remove the slot
          if (currentStock <= 1) {
            state.slots.splice(i, 1);
            i--;
            continue;
          }
        } else {
          // No stock — remove slot
          state.slots.splice(i, 1);
          i--;
          continue;
        }
      }
    }

    // ── Accumulate modifiers from this slot ──
    const effects = EFFECT_VALUES[slot.consumableId] ?? {};

    // DPS multiplier (only if Adrenaline is actively bursting)
    if (effects.dpsMult) {
      if (slot.consumableId === ConsumableType.AdrenalineShot) {
        if (slot.remainingBurstTicks > 0) {
          mods.dpsMultiplier *= effects.dpsMult;
        }
      } else {
        mods.dpsMultiplier *= effects.dpsMult;
      }
    }

    if (effects.damageReduce) mods.damageReductionPct = Math.max(mods.damageReductionPct, effects.damageReduce);
    if (effects.bonusLoot) mods.bonusLootChance += effects.bonusLoot;
    if (effects.extraRoll) mods.extraLootRollChance += effects.extraRoll;
    if (effects.scrapMult) mods.scrapYieldMultiplier *= effects.scrapMult;
    if (effects.rareDrop) mods.rareDropChanceMod += effects.rareDrop;
    if (effects.eventBonus) mods.eventChanceBonus += effects.eventBonus;
    if (effects.enemyPressure) mods.enemyPressureMultiplier *= effects.enemyPressure;
    if (effects.incomingDpsMult) mods.incomingDpsMultiplier *= effects.incomingDpsMult;
    if (effects.incomingAccMult) mods.incomingAccuracyMultiplier *= effects.incomingAccMult;
  }

  // Shield Cell instant restore on activation/replenishment
  if (shieldCellJustActivated) {
    feedEvents.push({
      tone: 'heal',
      label: 'Shield Cell',
      detail: `+${shieldRestoreAmount} shield restored.`,
    });
  }

  return { state, mods, consumed, feedEvents, shieldRestore: shieldRestoreAmount };
}

// ─── Helper: get survival state from slots ───────────────────────────

/**
 * Extract survival-relevant state from active slots for the Chef to use
 * in damage calculations.
 */
export function getSurvivalState(state: RoamingConsumableState) {
  let medKitBuffer = 0;
  let nanoSwarmHealThisTick = 0;
  let nanoSwarmTicksRemaining = 0;
  let adrenalineActive = false;
  let shieldCellResistance = 0;
  const shieldRestore = 0;

  for (const slot of state.slots) {
    if (slot.consumableId === ConsumableType.MedKit || slot.consumableId === 'MedKitRefined') {
      medKitBuffer = slot.remainingBuffer;
    } else if (slot.consumableId === ConsumableType.NanoSwarm) {
      nanoSwarmTicksRemaining = slot.remainingRegenTicks;
      nanoSwarmHealThisTick = slot.remainingRegenTicks > 0 ? NANO_SWARM_HEAL_PER_TICK : 0;
    } else if (slot.consumableId === ConsumableType.AdrenalineShot) {
      adrenalineActive = slot.remainingBurstTicks > 0;
    } else if (slot.consumableId === ConsumableType.ShieldCell) {
      shieldCellResistance = 0.15;
    }
  }

  return {
    medKitBuffer,
    nanoSwarmHealThisTick,
    nanoSwarmTicksRemaining,
    adrenalineActive,
    shieldCellResistance,
    shieldRestore,
  };
}

// ─── Helper: build active buffs for client display ───────────────────

export interface ActiveBuffDisplay {
  consumableId: string;
  slot: string;
  /** Remaining duration in milliseconds (0 for reactive/buffer-based). */
  remainingMs: number;
  /** Med Kit: remaining buffer HP. */
  remainingBuffer?: number;
  /** Nano Swarm: remaining regen ticks. */
  remainingTicks?: number;
  /** Adrenaline: true while armed (waiting for trigger). */
  armed?: boolean;
  /** Adrenaline: remaining burst seconds. */
  remainingBurstSeconds?: number;
  /** Ordnance: seconds until next fire. */
  ordnanceNextFireSeconds?: number;
}

export function buildActiveBuffs(
  state: RoamingConsumableState,
  currentTickIndex: number,
): ActiveBuffDisplay[] {
  const TICK_MS = 3000;

  return state.slots.map((slot) => {
    const buff: ActiveBuffDisplay = {
      consumableId: slot.consumableId,
      slot: slot.slot,
      remainingMs: 0,
    };

    if (slot.expiresAtTick > 0) {
      const remainingTicks = Math.max(0, slot.expiresAtTick - currentTickIndex);
      buff.remainingMs = remainingTicks * TICK_MS;
    }

    if (slot.consumableId === ConsumableType.MedKit || slot.consumableId === 'MedKitRefined') {
      buff.remainingBuffer = slot.remainingBuffer;
    } else if (slot.consumableId === ConsumableType.NanoSwarm) {
      buff.remainingTicks = slot.remainingRegenTicks;
    } else if (slot.consumableId === ConsumableType.AdrenalineShot) {
      buff.armed = slot.armed;
      buff.remainingBurstSeconds = slot.remainingBurstTicks * 3;
    } else if (ORDNANCE_TYPES.has(slot.consumableId)) {
      const remainingTicks = Math.max(0, slot.ordnanceNextFireTick - currentTickIndex);
      buff.ordnanceNextFireSeconds = remainingTicks * 3;
    }

    return buff;
  });
}
