/**
 * Roaming Consumable Engine — Server-Authoritative
 *
 * Pure functions imported by the Chef. No React, no Zustand, no Supabase.
 * The Chef passes in state; the engine returns mutated state + modifier map.
 *
 * ## Source of truth
 *
 * Every effect magnitude, duration, threshold, and scope decision in this
 * engine is derived from the shared consumable definitions in
 * `src/constants/consumables.ts` (`CONSUMABLES`) — the same module the
 * client renders from. The engine keeps NO private value tables: if a
 * number matters to roaming math, it lives in the def (baseEffects,
 * activityRules.roaming, runtime.threshold) or it does not exist.
 * Activation is scope-driven: only defs whose `runtime.activityScopes`
 * include `'roaming'` activate from inventory, and `processTick` drops
 * carried slots whose defs are not roaming-scoped.
 *
 * ## Lifecycle
 *
 * 1. `activateFromInventory()` — called on the first tick of a claim batch
 *    if no prior state exists. Activates ALL owned roaming-scoped
 *    consumables (no slot gating) and initializes `ActiveSlotState` for
 *    each. (`activateLoadout()` is the deprecated slot-based variant, kept
 *    for backward compatibility with existing roaming states.)
 * 2. `processTick()` — called every tick inside `processRoamingClaim()`.
 *    Advances durations, expires depleted slots, auto-replenishes from
 *    inventory, fires ordnance on interval, and returns a modifier map.
 * 3. The Chef reads the modifier map and applies it to DPS, loot, survival,
 *    and economy calculations. The Chef manages the actual damage/heal
 *    numbers using the slot state (medKitBuffer, nanoSwarmTicks, etc.).
 *
 * ## Behavior families (keyed off def fields, not item ids)
 *
 * | Behavior | Def signature | Roaming model |
 * |---|---|---|
 * | Buffer (Med Kit line) | survival + healHp, no dpsMultiplier | buffer = count × healHp, absorbed before HP |
 * | Shield restore | shieldRestore (+ damageReductionPct) | restore on (re)activation; resistance window from activityRules.roaming.durationSeconds |
 * | Regen (Nano Swarm) | repairTotalHp + repairDurationSeconds | healPerTick = total ÷ duration ticks |
 * | Reactive (Adrenaline) | dpsMultiplier + runtime.threshold (hpBelowThreshold) | burst of repairDurationSeconds when HP < threshold |
 * | Coverage (ammo/tactical/economy) | ammoCoveredSeconds or roaming durationSeconds | modifier window, auto-renewed while stock lasts |
 * | Ordnance | family 'ordnance' + ordnanceBonusDps | interval burst, consumed per fire |
 *
 * Ordnance interval: base 20 ticks (60s), reduced by `combat.ordnance`
 * mastery level: `max(10, 20 - floor(level / 2))`. The interval is an
 * engine cadence rule, not a per-item value.
 */

import { ConsumableType } from '@/types/game';
import { CONSUMABLES, type ConsumableDef, type ConsumableFamily } from '@/constants/consumables';

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
  /** Event table re-weighting toward find/material events (Data Skimmer). */
  eventFindWeightBonus: number;
  /** Signal hint active: the next event's family is foreshadowed (Data Skimmer). */
  eventForeshadow: boolean;
  /** Material-find events pay this fraction more (Salvage Contract). */
  materialEventYieldBonus: number;
  /** Buried-cache / convoy event weight bonus (Magnetized Payload). */
  cacheEventWeightBonus: number;
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
    eventFindWeightBonus: 0,
    eventForeshadow: false,
    materialEventYieldBonus: 0,
    cacheEventWeightBonus: 0,
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

// ─── Definition-derived profiles ─────────────────────────────────────
//
// Everything below reads the shared defs (src/constants/consumables.ts).
// There is deliberately no per-item numeric table in this module.

const TICK_SECONDS = 3;
const BASE_ORDNANCE_INTERVAL = 20; // ticks (60s) — engine cadence rule

/** The shared definition for a consumable id, if one exists. */
export function consumableDef(id: string): ConsumableDef | undefined {
  return CONSUMABLES[id];
}

function classifyFamily(id: string): ConsumableFamily {
  return CONSUMABLES[id]?.family ?? 'economy'; // safe default for legacy ids
}

/** True when the def declares the consumable usable while roaming. */
export function isRoamingConsumable(id: string): boolean {
  return CONSUMABLES[id]?.runtime.activityScopes.includes('roaming') ?? false;
}

/** Buffer behavior (Med Kit line): HP pool = owned count × def healHp. */
export function isBufferConsumable(id: string): boolean {
  const def = CONSUMABLES[id];
  return (
    !!def &&
    def.family === 'survival' &&
    typeof def.runtime.baseEffects.healHp === 'number' &&
    def.runtime.baseEffects.dpsMultiplier === undefined
  );
}

/** Per-unit HP buffer from the def (0 for non-buffer consumables). */
export function bufferHealPerUnit(id: string): number {
  return isBufferConsumable(id) ? (CONSUMABLES[id]?.runtime.baseEffects.healHp ?? 0) : 0;
}

/** Regen behavior (Nano Swarm): repairTotalHp spread over repairDurationSeconds. */
export function isRegenConsumable(id: string): boolean {
  const def = CONSUMABLES[id];
  return (
    !!def &&
    typeof def.runtime.baseEffects.repairTotalHp === 'number' &&
    typeof def.runtime.baseEffects.repairDurationSeconds === 'number' &&
    def.runtime.baseEffects.dpsMultiplier === undefined
  );
}

function regenTicks(id: string): number {
  const seconds = CONSUMABLES[id]?.runtime.baseEffects.repairDurationSeconds ?? 0;
  return Math.max(1, Math.round(seconds / TICK_SECONDS));
}

function regenHealPerTick(id: string): number {
  const def = CONSUMABLES[id];
  if (!def || !isRegenConsumable(id)) return 0;
  return (def.runtime.baseEffects.repairTotalHp ?? 0) / regenTicks(id);
}

/** Reactive behavior (Adrenaline Shot): DPS burst below the def HP threshold. */
export function isReactiveConsumable(id: string): boolean {
  const def = CONSUMABLES[id];
  return (
    !!def &&
    def.runtime.trigger === 'hpBelowThreshold' &&
    typeof def.runtime.baseEffects.dpsMultiplier === 'number' &&
    typeof def.runtime.threshold === 'number'
  );
}

function reactiveBurstTicks(id: string): number {
  const seconds = CONSUMABLES[id]?.runtime.baseEffects.repairDurationSeconds ?? 0;
  return Math.max(1, Math.round(seconds / TICK_SECONDS));
}

function reactiveThreshold(id: string): number {
  return CONSUMABLES[id]?.runtime.threshold ?? 0;
}

/** Shield-restore behavior (Shield Cell): shieldRestore on (re)activation. */
export function isShieldRestoreConsumable(id: string): boolean {
  return typeof CONSUMABLES[id]?.runtime.baseEffects.shieldRestore === 'number';
}

function shieldRestoreFor(id: string): number {
  return CONSUMABLES[id]?.runtime.baseEffects.shieldRestore ?? 0;
}

/** Ordnance behavior: interval burst damage from the def. */
export function isOrdnanceConsumable(id: string): boolean {
  return CONSUMABLES[id]?.family === 'ordnance';
}

function ordnanceBonusDps(id: string): number {
  return CONSUMABLES[id]?.runtime.baseEffects.ordnanceBonusDps ?? 0;
}

/**
 * Expiry window (ticks) for a consumable's active slot. Buffer, regen,
 * reactive, and ordnance behaviors are not duration-based (0). Coverage
 * items derive their window from the def: the roaming activity rule's
 * durationSeconds when present, else the def's coverage seconds
 * (ammoCoveredSeconds).
 */
function durationTicksFor(id: string): number {
  const def = CONSUMABLES[id];
  if (!def) return 0;
  if (def.family === 'ordnance') return 0;
  if (isBufferConsumable(id) || isRegenConsumable(id) || isReactiveConsumable(id)) return 0;
  const seconds =
    def.runtime.activityRules?.roaming?.durationSeconds ?? def.runtime.baseEffects.ammoCoveredSeconds;
  return seconds ? Math.max(1, Math.round(seconds / TICK_SECONDS)) : 0;
}

/** Initialize the behavior fields of an active slot from the def. */
function initializeSlotFields(slot: ActiveSlotState, startTick: number, ownedCount: number): void {
  const id = slot.consumableId;
  const duration = durationTicksFor(id);
  slot.activatedAtTick = startTick;
  slot.expiresAtTick = duration > 0 ? startTick + duration : 0;
  slot.remainingBuffer = isBufferConsumable(id) ? ownedCount * bufferHealPerUnit(id) : 0;
  slot.remainingRegenTicks = isRegenConsumable(id) ? regenTicks(id) : 0;
  slot.armed = isReactiveConsumable(id);
  slot.remainingBurstTicks = 0;
  slot.ordnanceNextFireTick = isOrdnanceConsumable(id) ? startTick + BASE_ORDNANCE_INTERVAL : 0;
}

// ─── Activation ──────────────────────────────────────────────────────

/**
 * Activate ALL owned roaming-scoped consumables from inventory (no slot
 * gating). Replaces the old 3-slot loadout model. Any roaming-scoped
 * consumable the player owns contributes its def effect: survival buffers
 * stack, durations auto-renew, ordnance fires on interval. Consumables
 * whose defs are not roaming-scoped (boss-only, crafting, scrapping…)
 * never activate here.
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

    // Scope gate: the def decides whether this item exists in roaming.
    if (!isRoamingConsumable(id)) continue;

    const activeSlot: ActiveSlotState = {
      slot: 'active' as ConsumableSlotName, // loaded, active consumable
      consumableId: id,
      family: classifyFamily(id),
      activatedAtTick: startTick,
      expiresAtTick: 0,
      remainingBuffer: 0,
      remainingRegenTicks: 0,
      armed: false,
      remainingBurstTicks: 0,
      ordnanceNextFireTick: 0,
    };
    initializeSlotFields(activeSlot, startTick, count);

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

    const activeSlot: ActiveSlotState = {
      slot: slotName,
      consumableId: id as ConsumableType,
      family: classifyFamily(id),
      activatedAtTick: startTick,
      expiresAtTick: 0,
      remainingBuffer: 0,
      remainingRegenTicks: 0,
      armed: false,
      remainingBurstTicks: 0,
      ordnanceNextFireTick: 0,
    };
    initializeSlotFields(activeSlot, startTick, inventory[id] ?? 0);

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

  // Scope enforcement on carried state: the state blob round-trips
  // through the client between claims, so a slot whose def is not
  // roaming-scoped (stale pre-contract state, or a forged one) is
  // dropped here rather than honored. Unknown legacy ids (no def) are
  // inert — they derive no effects — and are left alone.
  state.slots = state.slots.filter(
    (s) => !CONSUMABLES[s.consumableId] || isRoamingConsumable(s.consumableId),
  );

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
        // Reactivate with a fresh def-derived window
        initializeSlotFields(slot, ctx.tickIndex, 1);

        if (isShieldRestoreConsumable(slot.consumableId)) {
          shieldCellJustActivated = true;
          shieldRestoreAmount = shieldRestoreFor(slot.consumableId);
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

    // ── Regen tick (Nano Swarm) ──
    if (isRegenConsumable(slot.consumableId) && slot.remainingRegenTicks > 0) {
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
          slot.remainingRegenTicks = regenTicks(slot.consumableId);
          slot.activatedAtTick = ctx.tickIndex;
          feedEvents.push({
            tone: 'consumable',
            label: 'Nano Swarm replenished',
            detail: `+${regenHealPerTick(slot.consumableId)} HP/tick for ${regenTicks(slot.consumableId)} ticks.`,
          });
        } else {
          state.slots.splice(i, 1);
          i--;
          continue;
        }
      }
    }

    // ── Reactive trigger (Adrenaline Shot) ──
    if (isReactiveConsumable(slot.consumableId)) {
      if (slot.armed && ctx.currentHp > 0 && ctx.maxHp > 0 &&
          ctx.currentHp / ctx.maxHp < reactiveThreshold(slot.consumableId)) {
        // Trigger the burst!
        slot.armed = false;
        slot.remainingBurstTicks = reactiveBurstTicks(slot.consumableId);
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
    if (isOrdnanceConsumable(slot.consumableId)) {
      // Calculate effective interval with mastery
      const ordnanceMastery = ctx.masteryLevels['combat.ordnance'] ?? 0;
      const effectiveInterval = Math.max(10, BASE_ORDNANCE_INTERVAL - Math.floor(ordnanceMastery / 2));

      if (ctx.tickIndex >= slot.ordnanceNextFireTick) {
        // Check if we have stock
        const currentStock = ctx.inventory[slot.consumableId] ?? 0;
        if (currentStock > 0) {
          // Fire!
          const bonusDps = ordnanceBonusDps(slot.consumableId);
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

    // ── Accumulate modifiers from this slot (def baseEffects) ──
    const effects = CONSUMABLES[slot.consumableId]?.runtime.baseEffects ?? {};

    // DPS multiplier (reactive consumables only while their burst runs)
    if (effects.dpsMultiplier) {
      if (isReactiveConsumable(slot.consumableId)) {
        if (slot.remainingBurstTicks > 0) {
          mods.dpsMultiplier *= effects.dpsMultiplier;
        }
      } else {
        mods.dpsMultiplier *= effects.dpsMultiplier;
      }
    }

    if (effects.damageReductionPct) mods.damageReductionPct = Math.max(mods.damageReductionPct, effects.damageReductionPct);
    if (effects.bonusLootChance) mods.bonusLootChance += effects.bonusLootChance;
    if (effects.extraLootRollChance) mods.extraLootRollChance += effects.extraLootRollChance;
    // Roaming event system (overhaul): the Loot Beacon's eventChanceBonus
    // was declared in the mods map from the start but never accumulated —
    // its def had no event system to feed. It accumulates now, with the
    // Data Skimmer / Salvage Contract / Magnetized Payload event effects.
    if (effects.eventChanceBonus) mods.eventChanceBonus += effects.eventChanceBonus;
    if (effects.eventFindWeightBonus) mods.eventFindWeightBonus += effects.eventFindWeightBonus;
    if (effects.eventForeshadow) mods.eventForeshadow = true;
    if (effects.materialEventYieldBonus) mods.materialEventYieldBonus += effects.materialEventYieldBonus;
    if (effects.cacheEventWeightBonus) mods.cacheEventWeightBonus += effects.cacheEventWeightBonus;
    if (effects.yieldMultiplier) mods.scrapYieldMultiplier *= effects.yieldMultiplier;
    if (effects.enemyPressureMultiplier) mods.enemyPressureMultiplier *= effects.enemyPressureMultiplier;
    if (effects.incomingDpsMultiplier) mods.incomingDpsMultiplier *= effects.incomingDpsMultiplier;
    if (effects.incomingAccuracyMultiplier) mods.incomingAccuracyMultiplier *= effects.incomingAccuracyMultiplier;
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
    if (isBufferConsumable(slot.consumableId)) {
      // Buffer pools stack across the Med Kit line (base + refined).
      medKitBuffer += slot.remainingBuffer;
    } else if (isRegenConsumable(slot.consumableId)) {
      nanoSwarmTicksRemaining = slot.remainingRegenTicks;
      nanoSwarmHealThisTick = slot.remainingRegenTicks > 0 ? regenHealPerTick(slot.consumableId) : 0;
    } else if (isReactiveConsumable(slot.consumableId)) {
      adrenalineActive = slot.remainingBurstTicks > 0;
    } else if (isShieldRestoreConsumable(slot.consumableId)) {
      shieldCellResistance =
        CONSUMABLES[slot.consumableId]?.runtime.baseEffects.damageReductionPct ?? 0;
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

    if (isBufferConsumable(slot.consumableId)) {
      buff.remainingBuffer = slot.remainingBuffer;
    } else if (isRegenConsumable(slot.consumableId)) {
      buff.remainingTicks = slot.remainingRegenTicks;
    } else if (isReactiveConsumable(slot.consumableId)) {
      buff.armed = slot.armed;
      buff.remainingBurstSeconds = slot.remainingBurstTicks * 3;
    } else if (isOrdnanceConsumable(slot.consumableId)) {
      const remainingTicks = Math.max(0, slot.ordnanceNextFireTick - currentTickIndex);
      buff.ordnanceNextFireSeconds = remainingTicks * 3;
    }

    return buff;
  });
}
