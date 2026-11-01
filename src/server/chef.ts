/**
 * Chef Worker — Authoritative Gameplay Engine
 *
 * The Chef is the SINGLE source of truth for all gameplay outcomes.
 * It runs on Railway (your server), not in the player's browser.
 *
 * What the Chef owns:
 *   - Tick claim processing (probabilities, rewards)
 *   - Item generation (weapons, shields, classMods, relics, ordnance)
 *   - Survival damage computation
 *   - Kill cycle resolution
 *   - Boss fight verification
 *
 * What the Chef does NOT own:
 *   - UI rendering (that's the React app)
 *   - Animation display
 *   - Cosmetic previews
 *
 * The Chef imports the same TypeScript generators as the client
 * (src/lib/generators/*) — ONE source of truth, zero code drift.
 */

import { createTickRng } from '../lib/rng/tickRng';
import { generateWeapon } from './lib/generators/weaponGenerator';
import { generateShield } from './lib/generators/shieldGenerator';
import { generateClassMod } from './lib/generators/classModGenerator';
import { generateRelic } from './lib/generators/relicGenerator';
import { generateOrdnance } from './lib/generators/ordnanceGenerator';
import { generateVehicle } from './lib/generators/vehicleGenerator';
import {
  VEHICLE_DROP_SHARE,
  conditionFraction,
  effectiveVehicleYield,
  vehicleAffixTotals,
  vehicleBurnPerTick,
  vehicleDecayPerTick,
  vehicleMaterialBonusChance,
} from '../lib/vehicles/vehicles';
import type { Vehicle } from '../types/items';
import {
  ROAMING_AREAS,
  getRoamingArea,
  rollAreaDropKind,
  rollAreaMaterialFind,
  buildAreaWeaponDropOptions,
} from '../constants/roamingAreas';
import type { GearItem } from '../types/items';
import { REGION_1_BOSSES } from '../constants/bosses';
import { sumActivityModifier } from '../lib/stats/activityModifiers';
import type { ActivityKind } from '../types/activity';
import { ConsumableType, DropSource, Element, MaterialType, Rarity } from '../types/game';
import { RARITIES } from '../constants/rarities';
import { CONSUMABLES } from '../constants/consumables';
import {
  ELITE_ESCALATION_CHANCE,
  ELITE_FRAGMENT_BONUS,
  ELITE_HP_MULTIPLIER,
  ELITE_RARITY_FLOOR,
  EVENT_CHANCE_BASE,
  EVENT_CHANCE_MAX,
  SIGNATURE_MATERIAL_FIND_CHANCE,
  pickRoamingEvent,
  peekRoamingEvent,
  signatureMaterialForArea,
  type RoamingEventDef,
} from '../content/roamingEvents';
import { CACHE_FRAGMENT_CHANCE, GEAR_DROP_CHANCE, MATERIAL_FIND_CHANCE } from '../content/roamingRates';
import { HOT_AREA_DANGER_MULTIPLIER, HOT_AREA_MATERIAL_BONUS, HOT_AREA_YIELD_BONUS } from '../content/hotArea';
import {
  endlessEncounterForDepth,
  endlessMilestoneRarityWeights,
  endlessRewardsForDepth,
  isEndlessMilestoneDepth,
  type EndlessEncounterDef,
  type EndlessLeverValues,
} from '../content/endless';
import type { CacheRankBonuses } from '../content/cacheRank';
import {
  ACTION_SKILL_DEFS,
  type ActionSkillFirePlan,
} from '../content/actionSkills';
import { getEligibleLegendaryEffects } from '../constants/legendaryEffects';
import {
  getBossConsumableUsage,
  getBossRiskModifiers,
  simulateBoss,
  type BossSimulationInput,
} from '../lib/simulation/bossSimulator';
import {
  applyBadDecisionBonus,
  applyLegendaryEffects,
  getInsuranceFraudRefundChance,
  getSalvageRightsScrapMult,
  hasJackpot,
  hasSecondOpinion,
} from '../lib/legendaryEffects';
import { salvageScrap } from './writes/store';
import type { BossAttemptResult } from '../types/boss';
import { resolveAreaMonsters, pickAreaMonster } from '../lib/combat/areaMonsterSelector';
import { pickNextTarget } from '../lib/combat/killCycleHelpers';
import { computePlayerDamageVsMonster } from '../lib/combat/damageContract';
import { computeMonsterDamageVsHunter, type HunterSurvivalStats } from '../lib/combat/damageContract';
import {
  SHIELD_BEHAVIOR_TUNING,
  ampDamageMultiplier,
  shieldBehaviorOf,
} from '../lib/combat/shieldBehaviors';
import { computeEffectiveDpsFromGear } from '../lib/combat/loadoutSurvival';
import {
  activateFromInventory,
  processTick,
  getSurvivalState,
  buildActiveBuffs,
  isBufferConsumable,
  bufferHealPerUnit,
  type RoamingConsumableState,
  type LoadoutConsumableSlots,
} from '../lib/consumables/roamingConsumableEngine';

// --- Types ---

export interface ClaimRequest {
  playerId: string;
  areaId: string;
  ticks: number;
  tickCount: number; // monotonically increasing nonce
  playerLevel: number;
  /** Idle economy modifiers from equipped gear. */
  idleMods?: {
    offlineEarningsMod: number;
    scrapYieldMod: number;
    rareDropChanceMod: number;
  };
  /**
   * Skill tree bonuses (Scavenger tree affects idle economy). Routes
   * populate this from server records (skillBonusesFromRecords over
   * profiles.skill_spends + the equipped class mod); a request body's
   * copy is overridden by the claim route and never reaches here.
   */
  skillBonuses?: Record<string, number>;
  /**
   * Cache Rank bonuses (Cache Rank slice, 0031): resolved by the
   * claim routes from profiles.cache_rank_spends through
   * src/content/cacheRank.ts — never from the client body. Applied
   * LAST in each multiplier stack (after gear/skill/activity/hot
   * multipliers). Absent = all-zero (direct engine calls in tests).
   */
  cacheRankBonuses?: CacheRankBonuses;
  /**
   * Maximum ticks to process. Foreground live claims use 20;
   * offline settlement uses Infinity (capped by elapsed time only).
   * Default: 20 for backward compatibility.
   */
  maxTicks?: number;
  /**
   * Activity modifiers computed by the client from equipped gear via
   * `sumActivityModifier`. The Chef applies these to roaming rewards.
   * In a future enforcement pass the Chef will re-derive them from
   * player inventory for server-authoritative verification.
   */
  activityMods?: Record<string, number>;
  /**
   * Equipped gear objects. Routes populate this from the server's
   * equipped item_instances records (ChefGameplayStore.getEquippedGear);
   * a request body's copy is overridden by the claim route and never
   * reaches the engine (trust hardening, Phase 0 Slice 6).
   */
  equippedGear?: GearItem[];
  /** Effective DPS from the client's loadout (for kill cycle simulation). */
  effectiveDps?: number;
  /** Current kill cycle state from the client (for server-authoritative simulation). */
  killCycle?: {
    currentTargetId: string | null;
    currentTargetHp: number;
    currentTargetHpMax: number;
    monstersKilledCount: number;
    totalKills: number;
    lastKilledMonsterId: string | null;
  };
  /** Current survival HP and shield from the client. */
  survival?: {
    currentHp: number;
    shieldHp: number;
    maxHp: number;
    /**
     * Nova arm state (Phase 2c): false after a burst fired, until the
     * shield is restored above the re-arm threshold. Round-tripped
     * through the claim result; when absent, the engine derives it
     * from the shield's charge vs the threshold.
     */
    shieldNovaArmed?: boolean;
    /**
     * @deprecated Ignored by the engine: mitigation is re-derived
     * server-side from the equipped shield in equippedGear (the
     * ticker never sent this field, which is why roaming mitigation
     * was silently 0 while the snapshot displayed it).
     */
    mitigation?: number;
  };
  /** @deprecated Slots removed — engine activates from inventory directly. */
  loadoutConsumables?: LoadoutConsumableSlots;
  /**
   * Banked fractional scrap from the profile (0 <= x < 1). Set by the
   * claim routes from the DB (profiles.scrap_remainder, migration 0009);
   * never trusted from the client body — the routes overwrite it.
   */
  scrapRemainder?: number;
  /** Banked fractional credits from the profile (migration 0010); routes set it, never the client. */
  creditsRemainder?: number;
  /** Banked fractional XP from the profile (migration 0010); routes set it, never the client. */
  xpRemainder?: number;
  /** Consumable inventory count map (server-authoritative, read from DB by claim route). */
  consumableInventory?: Record<string, number>;
  /**
   * Unit quality profile per consumable type (crafting §2.4): built
   * by the claim routes from the player's batch rows via
   * buildConsumableQualityProfile — never from the client body. The
   * roaming engine prices every consumable effect at the quality of
   * the units actually drawn; absent (direct engine calls) every unit
   * reads 100, the pre-slice behavior.
   */
  consumableQualityProfile?: Record<string, number[]>;
  /** Prior roaming consumable state (carried from previous claim). */
  roamingConsumableState?: RoamingConsumableState;
  /** Mastery levels for interval reductions. */
  masteryLevels?: Record<string, number>;
  /**
   * Live economy levers (economy observability slice, 0018): resolved
   * by the claim routes from the EconomyConfig accessor — never from
   * the client body — and applied over the shipped constants below.
   * Absent fields fall back to FRAGMENT_CHANCE and a 1.0 scalar, so
   * direct engine calls (tests, determinism pins) are unchanged.
   */
  economy?: {
    /** Per-tick cache fragment chance before activity mods. */
    fragmentChance?: number;
    /** Multiplier on the Legendary weight of area drop tables. */
    roamingLegendaryScalar?: number;
    /** Multiplier on the equipped vehicle's yield bonus (vehicleYieldScalar lever). */
    vehicleYieldScalar?: number;
    /** Base per-tick roaming event chance (eventChanceBase lever). */
    eventChanceBase?: number;
    /** Named-elite escalation chance (eliteEscalationChance lever). */
    eliteEscalationChance?: number;
    /** Material-find chance bonus when the claim's area is the daily hot area. */
    hotAreaMaterialBonus?: number;
    /** Credits/XP yield bonus when the claim's area is the daily hot area. */
    hotAreaYieldBonus?: number;
  };
  /**
   * True when the claim's area is today's daily hot area — derived by
   * the routes from the SERVER's UTC date (src/content/hotArea.ts),
   * never from the request body. The engine applies the yield/material
   * bonuses and the danger multiplier; the client derives the same
   * value from the date for display only.
   */
  hotArea?: boolean;
  /**
   * The equipped vehicle, derived by the claim routes from the
   * server's own records (the equipped item_instances row's payload
   * + condition columns, and profiles.vehicle_fuel) — never from the
   * request body. Absent/null = roaming on foot at ×1.0. Boss
   * attempts never carry this: vehicles do not affect boss sims.
   */
  vehicle?: {
    vehicle: Vehicle;
    conditionCurrent: number;
    conditionMax: number;
    /** Fuel units in the tank at claim start (profiles.vehicle_fuel). */
    fuelUnits: number;
  } | null;
}

export interface ClaimResult {
  actionType: 'cc_claim_roaming_rewards';
  profile: Record<string, unknown>;
  rewards: {
    ticks: number;
    creditsAwarded: number;
    /** Fractional credits left banked on the profile after this claim (0 <= x < 1). */
    creditsRemainder: number;
    scrapAwarded: number;
    /** Fractional scrap left banked on the profile after this claim (0 <= x < 1). */
    scrapRemainder: number;
    xpAwarded: number;
    /** Fractional XP left banked on the profile after this claim (0 <= x < 1). */
    xpRemainder: number;
    cacheFragmentsAwarded: number;
    materials: Record<string, number>;
    essences: Record<string, number>;
    killsRecorded: number;
  };
  /** Generated drops: gear, plus vehicle instances (kind 'vehicle' when stored). */
  items: Array<GearItem | Vehicle>;
  feedEvents: unknown[];
  /** Server-authoritative kill cycle state for client synchronization. */
  killCycle: {
    currentTargetId: string | null;
    currentTargetHp: number;
    currentTargetHpMax: number;
    monstersKilledCount: number;
    totalKills: number;
    lastKilledMonsterId: string | null;
  };
  /** Server-authoritative survival HP for client synchronization. */
  survival: {
    currentHp: number;
    shieldHp: number;
    isDead: boolean;
    /**
     * The monster whose hit killed the hunter DURING this claim, with
     * the area it happened in — null when this claim did not kill
     * (including when the hunter was already dead on entry). The claim
     * route persists this as the server death record
     * (profiles.death_state, migration 0013) and the client feeds it
     * to the survival slice's die()/death log.
     */
    killedBy: { monsterId: string; monsterName: string; areaId: string } | null;
    /** Epoch ms of the killing tick (feed-event clock), null when killedBy is null. */
    diedAt: number | null;
    /** Nova arm state at claim end (Phase 2c) — the client round-trips it. */
    shieldNovaArmed: boolean;
    medKitBuffer: number;
    nanoSwarmTicksRemaining: number;
    adrenalineActive: boolean;
    shieldCellResistance: number;
  };
  /**
   * Vehicle outcome for this claim (Phase 2b). The routes persist
   * fuelUnitsRemaining + conditionCurrent through cc_apply_vehicle_
   * usage; the client renders status from it. equipped=false means
   * the whole claim ran on foot.
   */
  vehicle: {
    equipped: boolean;
    vehicleClassId: string | null;
    /** Ticks the yield bonus was active (fueled) during this claim. */
    activeTicks: number;
    ticks: number;
    fuelUnitsStart: number;
    fuelUnitsRemaining: number;
    fuelConsumed: number;
    conditionStart: number;
    conditionCurrent: number;
    conditionMax: number;
    /** Why the bonus was off for the whole claim, when it was. */
    inactiveReason: 'no_vehicle' | 'out_of_fuel' | null;
  };
  /**
   * Roaming events that fired during this claim (overhaul): the routes
   * persist these to the verified action ledger as `roaming.event`
   * rows so realized event EV is measurable, and `eliteKills` as
   * `roaming.elite_kill` rows for mastery credit. Payouts themselves
   * already flow through the ordinary rewards/items channels.
   */
  eventsFired: Array<{ eventId: string; name: string; family: string; tick: number }>;
  /** Escalated named-elite kills during this claim. */
  eliteKills: number;
  /** Consumables consumed during this claim batch (for inventory decrement). */
  consumedConsumables: Record<string, number>;
  /** Updated roaming consumable state (for next claim's input). */
  roamingConsumableState?: RoamingConsumableState;
  /** Active buff display data (for client UI). */
  activeBuffs?: Array<{
    consumableId: string;
    slot: string;
    remainingMs: number;
    remainingBuffer?: number;
    remainingTicks?: number;
    armed?: boolean;
    remainingBurstSeconds?: number;
    ordnanceNextFireSeconds?: number;
  }>;
}

export interface BossAttemptRequest extends Omit<BossSimulationInput, 'boss'> {
  playerId: string;
  bossId: string;
  attemptNonce: number;
  /**
   * Entry fee for this attempt, derived SERVER-SIDE by the verify-boss
   * route from the boss def (entryCost, or rematchCost when the boss
   * was already defeated) — never trusted from the request body. The
   * Chef folds it into the attempt's net credits delta; the applier
   * records it and guards affordability. 0 when unset (direct engine
   * calls in tests).
   */
  entryFee?: number;
  /**
   * Live economy levers (economy observability slice, 0018): resolved
   * by the verify-boss route from the EconomyConfig accessor — never
   * from the client body. Absent = BOSS_DEDICATED_DROP_CHANCE.
   */
  economy?: {
    /** Probability the guaranteed victory roll is a dedicated drop. */
    bossDedicatedChance?: number;
  };
  /**
   * Action skill fire plan (Action Skill slice, 0030): resolved by
   * the verify-boss route from the player's OWN server records
   * (recorded selection + keystone qualification) and the live
   * levers — never from the client body, which carries only a boolean
   * fire intent. The applier re-validates selection, qualification,
   * and charge under the row lock before spending the pool. Absent =
   * no fire this attempt.
   */
  actionSkillFire?: ActionSkillFirePlan | null;
  /**
   * Cache Rank bonuses (Cache Rank slice, 0031): resolved by the
   * verify-boss route from profiles.cache_rank_spends — never from
   * the client body. XP/credits/scrap apply to the victory rewards
   * last; damage/max HP reach the sim through the merged
   * skillBonuses keys (cacheRankDamageBonus / cacheRankMaxHpBonus).
   * Absent = all-zero.
   */
  cacheRankBonuses?: CacheRankBonuses;
}

export interface BossAttemptChefResult {
  actionType: 'cc_apply_boss_attempt';
  profile: Record<string, unknown>;
  result: BossAttemptResult;
  creditsDelta: number;
  xpAwarded: number;
  /** Scrap credited by Second Opinion's auto-scrapped twin roll (0 otherwise). */
  scrapAwarded: number;
  /** Second Opinion detail when it fired: the discarded twin and its scrap value. */
  secondOpinionScrap: {
    name: string;
    rarity: string;
    combatPower: number;
    scrapAwarded: number;
  } | null;
  loot: GearItem[];
  items: GearItem[];
  consumedConsumables: Record<string, number>;
  extraLoot: boolean;
  bonusLootRolls: number;
  /** Entry fee charged for this attempt (server-derived; see BossAttemptRequest). */
  entryFee: number;
  /** True when the guaranteed victory roll landed on a dedicated drop. */
  dedicatedDropAwarded: boolean;
  unlockedBossId?: string;
  telemetry: {
    serverRolled: true;
    adjustedWinChance: number;
    effectiveDps: number;
    timeToKill: number;
  };
}

// --- Constants ---

const TICK_MS = 3000;
// The roaming faucet's base rates live in ONE owner —
// src/content/roamingRates.ts — shared with the client displays so a
// tuning change can never again leave the UI promising a stale rate.
// Chest odds (the 60/32/8 displayed to players) are a separate table
// and do not move.
const GEAR_THRESHOLD = GEAR_DROP_CHANCE;
export const FRAGMENT_CHANCE = CACHE_FRAGMENT_CHANCE;
const MATERIAL_CHANCE = MATERIAL_FIND_CHANCE;

function clampChance(value: number): number {
  return Math.max(0, Math.min(0.98, value));
}

function bossAttemptId(playerId: string, bossId: string, nonce: number): string {
  return `boss_${playerId}_${bossId}_${nonce}`;
}

// --- Chef Implementation ---

/**
 * Process a single roaming tick claim.
 *
 * This is the authoritative engine. It:
 *   1. Seeds the deterministic RNG from (playerId, areaId, tickCount)
 *   2. For each tick, rolls the cumulative probability:
 *      - gear (22%): generates the actual item using the TypeScript generators
 *      - fragment (3%): awards cache key fragments
 *      - material/essence (8%): awards materials/essences
 *      - kill (67%): awards base credits/XP/scrap
 *   3. Returns complete results for Supabase persistence
 *
 * The client NEVER generates items. The client sends a claim, the Chef
 * processes it, and the client receives the canonical result.
 */
export function processRoamingClaim(
  request: ClaimRequest,
): ClaimResult {
  const { playerId, areaId, ticks: requestedTicks, tickCount, playerLevel, equippedGear } = request;

  // Server-authoritative idle mods: re-derive from equippedGear instead of
  // trusting client-supplied idleMods. This prevents a buggy/malicious
  // client from inflating credits/scrap by reporting higher modifiers
  // than their gear actually provides.
  const serverIdleMods = { offlineEarningsMod: 0, scrapYieldMod: 0, rareDropChanceMod: 0 };
  for (const gear of equippedGear ?? []) {
    if ('offlineEarningsMod' in gear) serverIdleMods.offlineEarningsMod += (gear.offlineEarningsMod ?? 0);
    if ('scrapYieldMod' in gear) serverIdleMods.scrapYieldMod += (gear.scrapYieldMod ?? 0);
    if ('rareDropChanceMod' in gear) serverIdleMods.rareDropChanceMod += (gear.rareDropChanceMod ?? 0);
    if ('affixes' in gear && Array.isArray(gear.affixes)) {
      for (const affix of gear.affixes as Array<{ stat?: string; value?: number }>) {
        if (affix.stat === 'offlineEarningsMod') serverIdleMods.offlineEarningsMod += affix.value ?? 0;
        if (affix.stat === 'scrapYieldMod') serverIdleMods.scrapYieldMod += affix.value ?? 0;
        if (affix.stat === 'rareDropChanceMod') serverIdleMods.rareDropChanceMod += affix.value ?? 0;
      }
    }
  }

  // The primary weapon for legendary-effect purposes. The client builds
  // equippedGear in loadout slot order (primary, secondary, heavy, then
  // the other slots — see idleTickerSlice's claim submission), so the
  // first weapon in the array is the primary-slot weapon. Salvage Rights
  // and Jackpot key off it ("kills with this weapon").
  const primaryWeapon =
    (equippedGear ?? []).find((g): g is import('../types/items').Weapon => 'weaponType' in g) ?? null;

  // Slot identification from the flat equippedGear array. The item
  // types are structurally distinct: a ClassMod is the only affix
  // carrier with `treeBonus`; a Relic is the affix carrier with no
  // weaponType/damage/hp/treeBonus; a Shield is the only item with
  // `mitigation`. The previous predicates keyed the "relic" lookup on
  // "affixes and no damage/hp fields", which matches the CLASS MOD
  // first in slot order (primary, secondary, heavy, shield, classMod,
  // relic, ordnance) — so roaming silently read the class mod as the
  // relic and the real relic's affixes (bossDamageMod, xpBoostMod,
  // idle mods) never reached this engine. The boss path never had the
  // bug: it receives explicit slots.
  const slotClassMod =
    (equippedGear ?? []).find((g) => 'treeBonus' in g) ?? null;
  const slotRelic =
    (equippedGear ?? []).find(
      (g) =>
        'affixes' in g &&
        !('weaponType' in g) &&
        !('damage' in g) &&
        !('hp' in g) &&
        !('treeBonus' in g) &&
        // A vehicle payload carries affixes too — it is never a relic.
        // (Routes keep vehicles out of equippedGear entirely; this is
        // the engine-level guard for direct callers.)
        !('vehicleClassId' in g),
    ) ?? null;
  const slotShield =
    (equippedGear ?? []).find((g): g is import('../types/items').Shield => 'mitigation' in g) ?? null;
  // Shield mitigation, re-derived server-side from the equipped shield
  // — the same value the mechanics snapshot displays. The claim body
  // carries no mitigation (the ticker never sent one, so roaming
  // mitigation was always 0 while the snapshot advertised it).
  const serverMitigation = slotShield?.mitigation ?? 0;
  // Shield behavior (Phase 2c), re-derived server-side from the same
  // equipped shield — never from the claim body. Legacy shields (no
  // behavior field) resolve to Standard and the claim runs exactly as
  // before. Definitions live in shieldBehaviors.ts, shared with the
  // boss sim.
  const shieldBehavior = shieldBehaviorOf(slotShield);
  const shieldCapacity = slotShield?.hp ?? 0;

  // Skill bonuses arrive already server-derived: the claim and
  // settlement routes rebuild them from profiles.skill_spends + the
  // equipped class mod (skillBonusesFromRecords) and override any
  // body copy, so this record is the player's earned bonuses — the
  // trust hardening (Phase 0 Slice 6) closed the era where this was
  // whatever the client claimed, economy rates included.
  const skillBonuses = request.skillBonuses ?? {};

  const area = getRoamingArea(areaId);
  // Credits accrue unrounded too (fractional accumulation, migration
  // 0010): the old Math.round(0.75) = 1 per tick overpaid the designed
  // 15/min rate by a third. Whole credits pay out at claim end.
  const creditsPerTick = (area.idleCreditsPerMinute || 15) / 20;
  // Scrap accrues UNROUNDED (fractional accumulation): at the real area
  // rates (3-5/min) the old Math.round(rate / 20) was 0, so roaming paid
  // no scrap and every scrap multiplier multiplied zero. Whole scrap is
  // paid out at claim end; the fraction banks on the profile (0009).
  const scrapPerTick = (area.idleScrapPerMinute || 3) / 20;
  const xpPerTick = area.idleXpPerTick || 1.0;

  // Merge idle economy modifiers from gear + skill tree.
  const gearOfflineMult = 1 + serverIdleMods.offlineEarningsMod;
  const skillOfflineBonus = skillBonuses.offlineEarnings || 0;
  const offlineMult = gearOfflineMult + skillOfflineBonus;

  const gearScrapMult = 1 + serverIdleMods.scrapYieldMod;
  const skillScrapBonus = skillBonuses.scrapYield || 0;
  const scrapMult = gearScrapMult + skillScrapBonus;

  // rareDropChance from gear + skills (structural wiring — threshold adjustment deferred)
  const totalRareDropMod = serverIdleMods.rareDropChanceMod + (skillBonuses.rareDropChance || 0);

  // Activity modifiers from equipped gear (procedural — Borderlands-style).
  // Re-derived server-side from the equippedGear array to prevent
  // client-supplied activityMods from inflating rewards.
  const effectiveActivityMods = sumActivityModifier(equippedGear ?? [], 'roaming_loot' as ActivityKind);
  const activityCreditsMult = 1 + (effectiveActivityMods.creditsPerKill ?? 0);
  const activityScrapMult = 1 + (effectiveActivityMods.scrapYieldMod ?? 0);
  // Plain xpBoostMod affixes on the relic and class mod (the relic
  // generator emits them at category 'idle', so sumActivityModifier —
  // activity-category only — never sees them). The boss path and the
  // mechanics snapshot both count these; roaming used to ignore them,
  // so a "+% XP Gain" relic paid out everywhere except while roaming.
  let gearXpBoostMod = 0;
  for (const slotItem of [slotRelic, slotClassMod]) {
    if (!slotItem || !('affixes' in slotItem) || !Array.isArray(slotItem.affixes)) continue;
    for (const affix of slotItem.affixes as Array<{ stat?: string; value?: number }>) {
      if (affix.stat === 'xpBoostMod') gearXpBoostMod += affix.value ?? 0;
    }
  }
  const activityXpMult = 1 + (effectiveActivityMods.xpBoostMod ?? 0) + gearXpBoostMod + (skillBonuses.xpBoostMod ?? 0);
  const activityRareDropBonus = effectiveActivityMods.rareDropChanceMod ?? 0;
  const activityFragmentBonus = effectiveActivityMods.cacheFragmentChance ?? 0;
  const activityMaterialBonus = effectiveActivityMods.materialFindChance ?? 0;

  // Salvage Rights (legendary): +50% scrap while the primary weapon
  // carries the effect — a real factor in the same multiplier stack as
  // gear/skill/activity scrap modifiers. (This field used to be set on
  // applyLegendaryEffects' return value, which no caller ever read.)
  const legendaryScrapMult = getSalvageRightsScrapMult(primaryWeapon);

  // Hot area (src/content/hotArea.ts): the routes derived
  // request.hotArea from the server's UTC date. The yield bonus folds
  // into the per-tick credit/XP rates here; the material-find bonus
  // and the danger multiplier apply inside the loop. The event table
  // itself is unchanged — a hot area changes yield, not luck.
  const isHotAreaClaim = request.hotArea === true;
  const hotYieldMult = isHotAreaClaim ? 1 + (request.economy?.hotAreaYieldBonus ?? HOT_AREA_YIELD_BONUS) : 1;
  const hotMaterialMult = isHotAreaClaim ? 1 + (request.economy?.hotAreaMaterialBonus ?? HOT_AREA_MATERIAL_BONUS) : 1;

  // Cache Rank (0031): the resolved bonuses multiply LAST, after the
  // gear/skill/activity/hot stacks — the fixed composition order.
  const cacheRank = request.cacheRankBonuses;
  const effectiveCreditsPerTick = creditsPerTick * offlineMult * activityCreditsMult * hotYieldMult * (1 + (cacheRank?.credits ?? 0));
  const effectiveScrapPerTick = scrapPerTick * scrapMult * activityScrapMult * legendaryScrapMult * (1 + (cacheRank?.scrap ?? 0));
  // XP likewise (0010): rates like 1.2/tick used to round down to 1.
  const effectiveXpPerTick = xpPerTick * activityXpMult * hotYieldMult * (1 + (cacheRank?.xp ?? 0));

  // Clamp ticks to maxTicks (foreground: 20; offline settlement: Infinity)
  const maxTicks = request.maxTicks ?? 20;
  const ticks = Math.max(1, Math.min(requestedTicks, maxTicks));

  // Fractional credits accumulator, seeded from the profile bank (0010).
  let creditsFraction = Math.min(Math.max(request.creditsRemainder ?? 0, 0), 0.999999);
  // Fractional scrap accumulator, seeded from the profile's banked
  // remainder so fractions carry across claims (clamped to [0, 1)).
  let scrapFraction = Math.min(Math.max(request.scrapRemainder ?? 0, 0), 0.999999);
  // Fractional XP accumulator, seeded from the profile bank (0010).
  let xpFraction = Math.min(Math.max(request.xpRemainder ?? 0, 0), 0.999999);
  let fragmentsAwarded = 0;
  let killsRecorded = 0;
  const materials: Record<string, number> = {};
  const essences: Record<string, number> = {};
  const generatedItems: Array<GearItem | Vehicle> = [];
  const feedEvents: unknown[] = [];

  const now = Date.now();

  // --- Combat state initialization ---
  // Seed from the request's optional killCycle and survival state.
  // The client sends its current state; the Chef simulates forward and
  // returns authoritative state that the client syncs to.
  //
  // Server-authoritative DPS: re-derive from the equippedGear array
  // instead of trusting the client's effectiveDps value. This prevents
  // a malicious/buggy client from inflating killsRecorded by reporting
  // a higher DPS than their gear actually produces.
  const serverDerivedDps = computeEffectiveDpsFromGear({
    weapons: (request.equippedGear ?? []).filter((g): g is import('../types/items').Weapon => 'weaponType' in g),
    ordnance: (request.equippedGear ?? []).find((g) => 'damage' in g && !('weaponType' in g)) ?? null,
    relic: slotRelic,
    classMod: slotClassMod,
    skillDpsMult: 1 + (request.skillBonuses?.dps ?? 0) + (cacheRank?.damage ?? 0),
    skillStatusChance: request.skillBonuses?.statusChance ?? 0,
  });
  const effectiveDps = serverDerivedDps;
  const roster = resolveAreaMonsters(area);

  // Kill cycle state
  let kcTargetId: string | null = request.killCycle?.currentTargetId ?? null;
  let kcTargetHp = request.killCycle?.currentTargetHp ?? 0;
  let kcTargetHpMax = request.killCycle?.currentTargetHpMax ?? 0;
  let kcMonstersKilled = request.killCycle?.monstersKilledCount ?? 0;
  let kcTotalKills = request.killCycle?.totalKills ?? 0;
  let kcLastKilledId: string | null = request.killCycle?.lastKilledMonsterId ?? null;

  // Survival state
  let survHp = request.survival?.currentHp ?? 0;
  let survShield = request.survival?.shieldHp ?? 0;
  const survMaxHp = request.survival?.maxHp ?? 700;
  let survDead = survHp <= 0;
  // Death attribution for THIS claim: set only when the sim's own hit
  // takes the hunter from alive to dead (a hunter who enters the claim
  // already dead has no new killer — the standing death record, if
  // any, remains the truth).
  let survKilledBy: ClaimResult['survival']['killedBy'] = null;
  let survDiedAt: number | null = null;
  // Nova arm state for this claim (Phase 2c): the client's round-trip
  // wins; when absent, a shield charged at or above the re-arm
  // threshold is presumed armed (it either never fired or has since
  // recharged past the threshold — the two are indistinguishable
  // without the flag, and the threshold rule is the standing law).
  let shieldNovaArmed =
    request.survival?.shieldNovaArmed ??
    (shieldCapacity > 0 &&
      survShield >= SHIELD_BEHAVIOR_TUNING.novaRearmThreshold * shieldCapacity);

  // --- Consumable engine initialization ---
  // Local copy: the Wounded Scavenger event can spend a carried
  // survival consumable mid-claim, and the request object is not ours
  // to mutate.
  const consumableInventory: Record<string, number> = { ...(request.consumableInventory ?? {}) };
  // Initial owned counts for every buffer-type consumable (the Med Kit
  // line), keyed by type — claim-end consumption is derived per type
  // from how much of each type's buffer pool was absorbed.
  const initialBufferCounts: Record<string, number> = {};
  for (const [id, count] of Object.entries(consumableInventory)) {
    if (count > 0 && isBufferConsumable(id)) initialBufferCounts[id] = count;
  }
  const masteryLevels = request.masteryLevels ?? {};
  let roamingState: RoamingConsumableState | undefined = request.roamingConsumableState;
  if (!roamingState) {
    // Activate ALL owned consumables from inventory (no slot gating).
    roamingState = activateFromInventory(consumableInventory, tickCount - ticks, request.consumableQualityProfile);
  }
  const consumedConsumables: Record<string, number> = {};

  // Vehicle state for this claim (Phase 2b): fuel and condition are
  // claim-start snapshots from the server's records; the per-tick
  // loop below advances them and the result block reports the end
  // state for the routes to persist. No vehicle (or an empty tank)
  // leaves every yield at the on-foot baseline.
  const vehicleInput = request.vehicle ?? null;
  const vehicleStartFuel = vehicleInput ? Math.max(0, vehicleInput.fuelUnits) : 0;
  const vehicleStartCondition = vehicleInput ? vehicleInput.conditionCurrent : 0;
  let vehicleFuel = vehicleStartFuel;
  let vehicleCondition = vehicleStartCondition;
  let vehicleActiveTicks = 0;

  // ── Roaming event state (overhaul, src/content/roamingEvents.ts) ──
  // Event windows and objectives are CLAIM-LOCAL: they live for the
  // rest of this claim's tick loop and are never persisted, so a
  // claim boundary always starts clean. The event roll itself runs
  // on a separate ':event' RNG stream (the vehicle-stream precedent)
  // so claims without events stay bit-identical to pre-overhaul ones.
  const eventsFired: ClaimResult['eventsFired'] = [];
  let eliteKills = 0;
  let evStormTicks = 0;
  let evOverheatTicks = 0;
  let evBreakTicks = 0;
  let evSurgeTicks = 0;
  let evSurgeElement: Element | null = null;
  let evSurgeMatched = false;
  const evStreakBox: { value: { ticksLeft: number; kills: number } | null } = { value: null };
  const evWeakpointBox: { value: { targetId: string; ticksLeft: number } | null } = { value: null };
  let evPendingWeakpoint = false;
  let evNextDropQualityBoost = false;
  let evPendingEliteSpawn = false;
  let evEliteEncounter: { targetId: string; name: string } | null = null;
  let evPendingBounty: { archetype: string; hpMult: number; payout: 'gear' | 'gearQuality' | 'materials' | 'xp'; name: string } | null = null;
  let evBounty: { targetId: string; payout: 'gear' | 'gearQuality' | 'materials' | 'xp'; name: string } | null = null;
  let evWallsShifted = false;

  const RARITY_SEQUENCE: Rarity[] = [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary];
  // Rarity weights for the non-weapon generators, with an optional
  // floor (elite drops: nothing below the floor can roll — the honest
  // implementation of "Epic rarity floor") and an optional quality
  // boost (weakpoint/surge/bounty shifts toward Rare/Epic/Legendary).
  const shapedRarityWeights = (opts?: { floor?: Rarity; boost?: boolean }): Partial<Record<Rarity, number>> => {
    const floorIdx = opts?.floor ? RARITY_SEQUENCE.indexOf(opts.floor) : 0;
    const out: Partial<Record<Rarity, number>> = {};
    for (let i = 0; i < RARITY_SEQUENCE.length; i++) {
      const r = RARITY_SEQUENCE[i];
      let w = i < floorIdx ? 0 : RARITIES[r].dropWeight;
      if (opts?.boost) {
        if (r === Rarity.Rare) w *= 1.5;
        if (r === Rarity.Epic || r === Rarity.Legendary) w *= 2;
      }
      out[r] = w;
    }
    return out;
  };
  const shapedZoneWeights = (
    base: Partial<Record<Rarity, number>>,
    opts?: { floor?: Rarity; boost?: boolean },
  ): Partial<Record<Rarity, number>> => {
    const floorIdx = opts?.floor ? RARITY_SEQUENCE.indexOf(opts.floor) : 0;
    const out: Partial<Record<Rarity, number>> = { ...base };
    for (let i = 0; i < RARITY_SEQUENCE.length; i++) {
      const r = RARITY_SEQUENCE[i];
      if (out[r] === undefined) continue;
      if (i < floorIdx) out[r] = 0;
      else if (opts?.boost) {
        if (r === Rarity.Rare) out[r] = (out[r] ?? 0) * 1.5;
        if (r === Rarity.Epic || r === Rarity.Legendary) out[r] = (out[r] ?? 0) * 2;
      }
    }
    return out;
  };

  // Generate one area gear drop (drop-kind roll + shared generators).
  // Used by the primary loot roll and by Data Skimmer's extra roll.
  // Overhaul options: rarityFloor (elite kills — the whole drop,
  // vehicles included, is replaced by a floored gear roll) and
  // qualityBoost (weakpoint contract / matched surge / quality bounty:
  // the next drop rolls hot). With no options the streams consumed are
  // exactly the pre-overhaul ones.
  const rollGearDrop = (
    dropRng: () => number,
    tickNumber: number,
    opts?: { rarityFloor?: Rarity; qualityBoost?: boolean },
  ): GearItem | Vehicle | undefined => {
    const boost = (opts?.qualityBoost ?? false) || evNextDropQualityBoost || (evSurgeTicks > 0 && evSurgeMatched);
    if (evNextDropQualityBoost) evNextDropQualityBoost = false;
    if (!opts?.rarityFloor) {
      // Vehicle drops (Phase 2b): a share of gear drops are vehicles
      // instead. The decision rolls on a SEPARATE deterministic stream
      // (seeded ':vehicle') so the main tick stream — and every
      // determinism pin built on it — is bit-identical to pre-vehicle
      // claims when the roll misses.
      const vehicleRng = createTickRng(playerId, `${areaId}:vehicle`, tickNumber);
      if (vehicleRng() < VEHICLE_DROP_SHARE) {
        return generateVehicle(
          { level: playerLevel, areaUnlockLevel: area.unlockLevel, rarityWeights: area.dropPoolRarityWeights },
          vehicleRng,
        );
      }
    }
    // Shifting Walls (HelixWorks): weapon and ordnance drop-kind
    // weights swap for the rest of the claim.
    const kindArea = evWallsShifted
      ? {
          ...area,
          gearDropWeights: {
            ...area.gearDropWeights,
            weapon: area.gearDropWeights.ordnance,
            ordnance: area.gearDropWeights.weapon,
          },
        }
      : area;
    const kind = rollAreaDropKind(kindArea, dropRng);
    const shape = opts?.rarityFloor || boost ? { floor: opts?.rarityFloor, boost } : undefined;
    switch (kind) {
      case 'weapon': {
        const options = buildAreaWeaponDropOptions(area, playerLevel, dropRng);
        // Live lever (0018): scale the Legendary entry of the area's
        // drop-pool weights at claim time. The area tables themselves
        // are constants and are never mutated — the scalar lands on a
        // copy, and 1.0 (the default) leaves the weights bit-identical.
        const scalar = request.economy?.roamingLegendaryScalar ?? 1;
        if (scalar !== 1 && options.zoneWeights) {
          options.zoneWeights = {
            ...options.zoneWeights,
            [Rarity.Legendary]:
              (options.zoneWeights[Rarity.Legendary] ?? 0) * scalar,
          };
        }
        if (shape && options.zoneWeights) {
          options.zoneWeights = shapedZoneWeights(options.zoneWeights, shape);
        }
        return generateWeapon(options, dropRng);
      }
      case 'shield':
        return generateShield(playerLevel, dropRng, shape ? shapedRarityWeights(shape) : undefined);
      case 'classMod':
        return generateClassMod(playerLevel, dropRng, shape ? shapedRarityWeights(shape) : undefined);
      case 'relic':
        return generateRelic(playerLevel, dropRng, shape ? shapedRarityWeights(shape) : undefined);
      case 'ordnance':
        return generateOrdnance(playerLevel, dropRng, shape ? shapedRarityWeights(shape) : undefined);
      default:
        return undefined;
    }
  };

  // Rich detail line for a gear drop: rarity, type, power, element, manufacturer.
  const gearFeedDetail = (gear: GearItem | Vehicle): string => {
    if ('vehicleClassId' in gear) {
      return `${gear.rarity} vehicle · ${gear.name}`;
    }
    const typeLabel = 'weaponType' in gear ? gear.weaponType : 'gear';
    const powerLabel = 'combatPower' in gear ? ` · ${gear.combatPower} Power` : '';
    const elemLabel = 'element' in gear ? ` · ${gear.element}` : '';
    const mfgLabel = 'manufacturer' in gear ? ` · ${gear.manufacturer}` : '';
    return `${gear.rarity} ${typeLabel}${powerLabel}${elemLabel}${mfgLabel}`;
  };

  // ── Event-aware target spawning ──────────────────────────────────
  // Every kill-cycle spawn routes through here so bounty targets,
  // Elite Patrol spawns, elite escalation, and weakpoint marking apply
  // uniformly — weapon kills, nova kills, and detonation kills all
  // advance through the same door.
  const spawnNextTarget = (tickIdx: number, tickNumber: number): void => {
    const at = now - (ticks - 1 - tickIdx) * TICK_MS;
    let next: (typeof roster)[number] | null = null;
    let hpMult = 1;
    let forceElite = false;
    if (evPendingBounty) {
      const pending = evPendingBounty;
      evPendingBounty = null;
      next =
        roster.find((m) => m.archetype === pending.archetype) ??
        roster.find((m) => m.archetype !== 'elite') ??
        null;
      if (next) {
        evBounty = { targetId: next.id, payout: pending.payout, name: pending.name };
        hpMult = pending.hpMult;
      }
    }
    if (!next && evPendingEliteSpawn) {
      evPendingEliteSpawn = false;
      next = roster.find((m) => m.archetype === 'elite') ?? null;
      forceElite = next !== null;
    }
    if (!next) next = pickNextTarget(roster, kcLastKilledId);
    if (!next) {
      kcTargetId = null;
      kcTargetHp = 0;
      kcTargetHpMax = 0;
      return;
    }
    // Named-elite escalation: an elite rotating into the cycle has a
    // seeded chance to escalate into the area's named elite (HP ×3,
    // Epic-floor drop on kill); an Elite Patrol event forces it. The
    // escalation roll uses its own stream so ordinary spawns consume
    // exactly the pre-overhaul streams.
    if (next.archetype === 'elite' && evEliteEncounter?.targetId !== next.id) {
      const escRng = createTickRng(playerId, `${areaId}:elite`, tickNumber * 100003 + kcTotalKills);
      if (forceElite || escRng() < (request.economy?.eliteEscalationChance ?? ELITE_ESCALATION_CHANCE)) {
        hpMult *= ELITE_HP_MULTIPLIER;
        evEliteEncounter = { targetId: next.id, name: next.name };
        feedEvents.push({
          at,
          tone: 'event_major',
          label: `${next.name} — named elite`,
          detail: `A named elite stalks ${area.name}: ${next.name} at triple strength. Its drop cannot roll below ${ELITE_RARITY_FLOOR}.`,
          areaId,
          eventId: 'elite_spawn',
          family: 'fight',
        });
      }
    }
    kcTargetId = next.id;
    kcTargetHp = Math.max(1, Math.round(next.hp * hpMult));
    kcTargetHpMax = kcTargetHp;
    if (evPendingWeakpoint) {
      evWeakpointBox.value = { targetId: next.id, ticksLeft: 15 };
      evPendingWeakpoint = false;
    }
  };

  // Kill payouts keyed to the event state: escalated elites pay the
  // floored drop + fragment bonus; bounty targets pay their contract;
  // a weakpoint kill arms the next-drop quality boost.
  const onTargetKilled = (
    killed: (typeof roster)[number],
    dropRng: () => number,
    tickIdx: number,
    tickNumber: number,
  ): void => {
    const at = now - (ticks - 1 - tickIdx) * TICK_MS;
    if (evEliteEncounter && killed.id === evEliteEncounter.targetId) {
      evEliteEncounter = null;
      eliteKills += 1;
      fragmentsAwarded += ELITE_FRAGMENT_BONUS;
      const drop = rollGearDrop(dropRng, tickNumber, { rarityFloor: ELITE_RARITY_FLOOR });
      if (drop) {
        generatedItems.push(drop);
        feedEvents.push({
          at,
          tone: 'loot',
          label: drop.name,
          detail: `${gearFeedDetail(drop)} · named-elite drop (${ELITE_RARITY_FLOOR} floor)`,
          gear: drop,
          areaId,
        });
      }
      feedEvents.push({
        at,
        tone: 'event_major',
        label: `Elite down — ${killed.name}`,
        detail: `${killed.name} eliminated. +${ELITE_FRAGMENT_BONUS} cache fragment and a guaranteed ${ELITE_RARITY_FLOOR}-or-better drop.`,
        areaId,
        eventId: 'elite_kill',
        family: 'fight',
      });
    }
    if (evBounty && killed.id === evBounty.targetId) {
      const bounty = evBounty;
      evBounty = null;
      if (bounty.payout === 'gear' || bounty.payout === 'gearQuality') {
        const drop = rollGearDrop(dropRng, tickNumber, {
          qualityBoost: bounty.payout === 'gearQuality',
        });
        if (drop) {
          generatedItems.push(drop);
          feedEvents.push({
            at,
            tone: 'loot',
            label: drop.name,
            detail: `${gearFeedDetail(drop)} · bounty payout`,
            gear: drop,
            areaId,
          });
        }
      } else if (bounty.payout === 'materials') {
        materials[MaterialType.ScrapAlloy] = (materials[MaterialType.ScrapAlloy] || 0) + 6;
        materials[MaterialType.BallisticParts] = (materials[MaterialType.BallisticParts] || 0) + 4;
        feedEvents.push({
          at,
          tone: 'material',
          label: '+6 ScrapAlloy · +4 BallisticParts',
          detail: 'Turret nest stripped for parts.',
          areaId,
          value: 10,
        });
      } else {
        xpFraction += 30;
      }
      feedEvents.push({
        at,
        tone: 'event',
        label: `Bounty complete — ${bounty.name}`,
        detail: 'The marked target is down; the contract pays out.',
        areaId,
        eventId: 'bounty_complete',
        family: 'fight',
      });
    }
    if (evWeakpointBox.value && killed.id === evWeakpointBox.value.targetId) {
      evWeakpointBox.value = null;
      evNextDropQualityBoost = true;
      feedEvents.push({
        at,
        tone: 'event',
        label: 'Weakpoint contract complete',
        detail: 'Marked target dropped inside the window — the next gear drop rolls hot.',
        areaId,
        eventId: 'weakpoint_complete',
        family: 'objective',
      });
    }
  };

  // Environmental event damage (detonation splash, minefield,
  // overheat attrition): shield absorbs first, Med Kit buffers second,
  // HP last — the same routing as a monster hit, minus mitigation and
  // shield behaviors (the environment does not proc your shield tech).
  const applyEventDamage = (amount: number, sourceName: string, sourceId: string, tickIdx: number): void => {
    if (survDead || amount <= 0) return;
    const at = now - (ticks - 1 - tickIdx) * TICK_MS;
    let remaining = amount;
    const absorbed = Math.min(survShield, remaining);
    survShield -= absorbed;
    remaining -= absorbed;
    if (remaining > 0 && roamingState) {
      for (const slot of roamingState.slots) {
        if (remaining <= 0) break;
        if (!isBufferConsumable(slot.consumableId) || slot.remainingBuffer <= 0) continue;
        const soaked = Math.min(slot.remainingBuffer, remaining);
        slot.remainingBuffer -= soaked;
        remaining -= soaked;
      }
    }
    feedEvents.push({
      at,
      tone: 'damage',
      label: absorbed > 0 ? `-${absorbed} shield${remaining > 0 ? ` · -${remaining} HP` : ''}` : `-${remaining} HP`,
      detail: `${sourceName} hit you for ${amount} damage.`,
      areaId,
      value: remaining,
    });
    if (remaining > 0) {
      survHp = Math.max(0, survHp - remaining);
      if (survHp <= 0) {
        survDead = true;
        survKilledBy = { monsterId: sourceId, monsterName: sourceName, areaId };
        survDiedAt = at;
        feedEvents.push({
          at,
          tone: 'death',
          label: 'Hunter Down',
          detail: `Killed by ${sourceName} in ${area.name}.`,
          areaId,
          value: 0,
        });
      }
    }
  };

  // Resolve one fired roaming event. Payouts fold into the claim's
  // ordinary channels (materials/essences maps, fraction banks,
  // generatedItems) — there is no event side-channel for the routes
  // to reconcile. Returns false only for the Wounded Scavenger skip
  // (no survival consumable carried: nothing fires, nothing is paid).
  const resolveRoamingEvent = (
    def: RoamingEventDef,
    eventRng: () => number,
    tickIdx: number,
    tickNumber: number,
    tickEffectiveDps: number,
  ): boolean => {
    const at = now - (ticks - 1 - tickIdx) * TICK_MS;
    const res = def.resolution;
    const pushEventFeed = (detail: string, major = def.major === true): void => {
      feedEvents.push({
        at,
        tone: major ? 'event_major' : 'event',
        label: def.name,
        detail,
        areaId,
        eventId: def.id,
        family: def.family,
        propId: def.propId,
      });
    };
    const pushGearFeed = (gear: GearItem | Vehicle, source: string): void => {
      feedEvents.push({
        at,
        tone: 'loot',
        label: gear.name,
        detail: `${gearFeedDetail(gear)} · ${source}`,
        gear,
        areaId,
      });
    };
    switch (res.kind) {
      case 'cacheFind': {
        pushEventFeed(def.blurb);
        const gear = rollGearDrop(eventRng, tickNumber);
        if (gear) {
          generatedItems.push(gear);
          pushGearFeed(gear, def.name);
        }
        if (eventRng() < 0.5) fragmentsAwarded += 1;
        break;
      }
      case 'salvageFind': {
        pushEventFeed(def.blurb);
        for (const entry of res.entries) {
          let qty = entry.min + Math.floor(eventRng() * (entry.max - entry.min + 1));
          if (entry.kind === 'material' && consumableMods.materialEventYieldBonus > 0) {
            qty = Math.max(1, Math.round(qty * (1 + consumableMods.materialEventYieldBonus)));
          }
          if (entry.kind === 'material') materials[entry.type] = (materials[entry.type] || 0) + qty;
          else essences[entry.type] = (essences[entry.type] || 0) + qty;
          feedEvents.push({
            at,
            tone: entry.kind === 'material' ? 'material' : 'essence',
            label: `+${qty} ${entry.type}`,
            detail: `${def.name} salvage.`,
            areaId,
            value: qty,
          });
        }
        if (res.credits) creditsFraction += res.credits[0] + eventRng() * (res.credits[1] - res.credits[0]);
        if (res.restoreShield && shieldCapacity > 0 && survShield < shieldCapacity) {
          survShield = Math.min(shieldCapacity, survShield + res.restoreShield);
          feedEvents.push({
            at,
            tone: 'heal',
            label: `+${res.restoreShield} shield`,
            detail: `${def.name}: coolant charge restored shield.`,
            areaId,
            value: res.restoreShield,
          });
        }
        break;
      }
      case 'gearFind': {
        pushEventFeed(def.blurb);
        const gear = rollGearDrop(eventRng, tickNumber, { qualityBoost: true });
        if (gear) {
          generatedItems.push(gear);
          pushGearFeed(gear, def.name);
        }
        break;
      }
      case 'stormWindow':
        evStormTicks = 10;
        pushEventFeed(`${def.blurb} Enemy pressure +50% and fragment finds double for 10 ticks.`);
        break;
      case 'aidObjective': {
        const aidId = Object.keys(consumableInventory).find(
          (id) => (consumableInventory[id] ?? 0) > 0 && CONSUMABLES[id as ConsumableType]?.family === 'survival',
        );
        if (!aidId) return false;
        consumableInventory[aidId] = (consumableInventory[aidId] ?? 0) - 1;
        consumedConsumables[aidId] = (consumedConsumables[aidId] ?? 0) + 1;
        pushEventFeed(def.blurb);
        if (eventRng() < 0.35) {
          const gear = rollGearDrop(eventRng, tickNumber);
          if (gear) {
            generatedItems.push(gear);
            pushGearFeed(gear, 'grateful scavenger');
          }
        } else {
          creditsFraction += 12 + eventRng() * 8;
        }
        break;
      }
      case 'overheatWindow':
        evOverheatTicks = 10;
        pushEventFeed(`${def.blurb} Credits +50% for 10 ticks — but the heat bites for 3 HP a tick.`);
        break;
      case 'streakObjective':
        evStreakBox.value = { ticksLeft: 20, kills: 0 };
        pushEventFeed(def.blurb);
        break;
      case 'weakpointContract':
        if (kcTargetId) evWeakpointBox.value = { targetId: kcTargetId, ticksLeft: 15 };
        else evPendingWeakpoint = true;
        pushEventFeed(def.blurb);
        break;
      case 'elitePatrol':
        evPendingEliteSpawn = true;
        pushEventFeed(def.blurb, true);
        break;
      case 'bountyTarget': {
        const bountySpec: Record<string, { archetype: string; hpMult: number }> = {
          redline_pursuit_pack: { archetype: 'runner', hpMult: 1 },
          ironwood_sentry_nest: { archetype: 'sniper', hpMult: 2 },
          throwtech_turret_nest: { archetype: 'sniper', hpMult: 2 },
          helixworks_prototype_escape: { archetype: 'brute', hpMult: 1.5 },
          helixworks_specimen_release: { archetype: 'runner', hpMult: 1.5 },
        };
        const spec = bountySpec[def.id] ?? { archetype: 'runner', hpMult: 1.5 };
        evPendingBounty = { archetype: spec.archetype, hpMult: spec.hpMult, payout: res.payout, name: def.name };
        pushEventFeed(def.blurb);
        break;
      }
      case 'detonate': {
        pushEventFeed(def.blurb);
        if (kcTargetId) {
          const target = roster.find((m) => m.id === kcTargetId);
          if (target) {
            const dmg = Math.round(tickEffectiveDps * 3);
            kcTargetHp -= dmg;
            feedEvents.push({
              at,
              tone: 'hit',
              label: `-${dmg} HP`,
              detail: `${def.name}: the munitions cook off into ${target.name} for ${dmg} damage.`,
              areaId,
              value: dmg,
            });
            if (kcTargetHp <= 0) {
              kcMonstersKilled += 1;
              kcTotalKills += 1;
              kcLastKilledId = kcTargetId;
              feedEvents.push({
                at,
                tone: 'kill',
                label: `Killed ${target.name}`,
                detail: `${target.name} caught in the blast in ${area.name}.`,
                areaId,
                value: 0,
              });
              onTargetKilled(target, eventRng, tickIdx, tickNumber);
              spawnNextTarget(tickIdx, tickNumber);
            }
          }
        }
        applyEventDamage(4, def.name, def.id, tickIdx);
        break;
      }
      case 'breakWindow':
        evBreakTicks = 10;
        pushEventFeed(`${def.blurb} Brute targets take double damage for 10 ticks.`);
        break;
      case 'elementSurge': {
        const elements = Object.values(Element);
        evSurgeElement = elements[Math.floor(eventRng() * elements.length)] ?? Element.Kinetic;
        evSurgeTicks = 10;
        evSurgeMatched = !!primaryWeapon && primaryWeapon.element === evSurgeElement;
        pushEventFeed(
          evSurgeMatched
            ? `${def.blurb} Your ${evSurgeElement} weapon resonates — drops roll hot for 10 ticks.`
            : `${def.blurb} ${evSurgeElement} surge: enemy pressure +30% for 10 ticks (your weapon does not match).`,
        );
        break;
      }
      case 'signalTrap': {
        pushEventFeed(def.blurb);
        if (consumableMods.eventFindWeightBonus > 0 || consumableMods.eventChanceBonus > 0) {
          const gear = rollGearDrop(eventRng, tickNumber);
          if (gear) {
            generatedItems.push(gear);
            pushGearFeed(gear, 'signal trap spoils');
          }
        } else {
          fragmentsAwarded += 1;
        }
        break;
      }
      case 'wallsShift':
        evWallsShifted = true;
        pushEventFeed(`${def.blurb} Weapon and ordnance drop odds swap for the rest of this roam.`);
        break;
      case 'resonanceTrial': {
        pushEventFeed(def.blurb);
        if (primaryWeapon && (area.elementBias ?? []).includes(primaryWeapon.element)) {
          const gear = rollGearDrop(eventRng, tickNumber);
          if (gear) {
            generatedItems.push(gear);
            pushGearFeed(gear, 'resonance attuned');
          }
        } else {
          xpFraction += 20;
        }
        break;
      }
      case 'minefield':
        pushEventFeed(def.blurb);
        applyEventDamage(8, def.name, def.id, tickIdx);
        if (!survDead) fragmentsAwarded += 2;
        break;
      default:
        break;
    }
    eventsFired.push({ eventId: def.id, name: def.name, family: def.family, tick: tickNumber });
    return true;
  };

  // Import emptyMods lazily to avoid circular deps in client imports
  let consumableMods = {
    dpsMultiplier: 1, damageReductionPct: 0, bonusLootChance: 0,
    extraLootRollChance: 0, scrapYieldMultiplier: 1, rareDropChanceMod: 0,
    eventChanceBonus: 0, eventFindWeightBonus: 0, eventForeshadow: false,
    materialEventYieldBonus: 0, cacheEventWeightBonus: 0,
    enemyPressureMultiplier: 1, xpMultiplier: 1,
    incomingDpsMultiplier: 1, incomingAccuracyMultiplier: 1, ordnanceBonusDps: 0,
  };

  for (let tickIdx = 0; tickIdx < ticks; tickIdx++) {
    // Deterministic RNG — same tuple, same stream as the client preview
    const rng = createTickRng(playerId, areaId, tickCount - ticks + tickIdx + 1);
    const tickNumber = tickCount - ticks + tickIdx + 1;
    // Tick-start snapshots for the event objectives: the Streak Run
    // reads "kills without taking a hit" off these at end of tick.
    const tickStartKills = kcMonstersKilled;
    const tickStartHp = survHp;
    const tickStartShield = survShield;

    // --- Consumable engine tick ---
    if (roamingState) {
      const currentTickIndex = tickCount - ticks + tickIdx;
      const tickResult = processTick(roamingState, {
        tickIndex: currentTickIndex,
        currentHp: survHp,
        maxHp: survMaxHp,
        inventory: consumableInventory,
        masteryLevels,
        consumableQualityProfile: request.consumableQualityProfile,
      });
      roamingState = tickResult.state;
      consumableMods = tickResult.mods;

      // Track consumed consumables
      for (const c of tickResult.consumed) {
        consumedConsumables[c.id] = (consumedConsumables[c.id] ?? 0) + c.count;
      }

      // Push consumable feed events
      for (const ev of tickResult.feedEvents) {
        feedEvents.push({
          at: now - (ticks - 1 - tickIdx) * TICK_MS,
          tone: ev.tone,
          label: ev.label,
          detail: ev.detail,
          areaId,
        });
      }

      // Apply Shield Cell shield restore
      if (tickResult.shieldRestore > 0) {
        survShield += tickResult.shieldRestore;
      }

      // Apply Nano Swarm regen
      const survState = getSurvivalState(roamingState);
      if (survState.nanoSwarmHealThisTick > 0 && survHp > 0 && !survDead) {
        survHp = Math.min(survMaxHp, survHp + survState.nanoSwarmHealThisTick);
      }
    }

    // --- Vehicle yield for this tick (Phase 2b) ---
    // A fueled tick multiplies the tick's yields by the vehicle's
    // effective factor (condition read at tick start, then wear and
    // burn apply). An unfueled or unequipped tick is exactly the
    // on-foot baseline — roaming never blocks on the vehicle.
    let tickVehicleFactor = 1;
    let tickVehicleScanner = 0;
    let tickVehicleMaterialBonus = 0;
    // Fuel dust (float residue after the last full burn, ~1e-16)
    // does not start a fueled tick — a fueled tick needs real fuel.
    if (vehicleInput && vehicleFuel > 1e-9) {
      // Fixer vehicle terms (migration 0029) ride the same derived
      // skillBonuses record as every other Chef consumer — the routes
      // rebuilt it from the claim owner's records, so the online
      // claim and the offline settlement (both through this function)
      // price vehicles identically.
      const burn = vehicleBurnPerTick(vehicleInput.vehicle, skillBonuses.vehicleFuelBonus ?? 0);
      tickVehicleFactor = effectiveVehicleYield(
        vehicleInput.vehicle,
        conditionFraction(vehicleCondition, vehicleInput.conditionMax),
        request.economy?.vehicleYieldScalar ?? 1,
        skillBonuses.vehicleYieldBonus ?? 0,
      );
      tickVehicleScanner = vehicleAffixTotals(vehicleInput.vehicle).scannerPct;
      tickVehicleMaterialBonus = vehicleMaterialBonusChance(vehicleInput.vehicle);
      vehicleFuel = Math.max(0, vehicleFuel - Math.min(burn, vehicleFuel));
      vehicleCondition = Math.max(
        0,
        vehicleCondition - vehicleDecayPerTick(
          vehicleInput.vehicle,
          area.dangerRating,
          skillBonuses.vehicleDecayReduction ?? 0,
        ),
      );
      vehicleActiveTicks++;
    }
    // Overheat Vent window (event): credits run +50% while it lasts.
    const tickCredits = effectiveCreditsPerTick * tickVehicleFactor * (evOverheatTicks > 0 ? 1.5 : 1);
    const tickScrap = effectiveScrapPerTick * tickVehicleFactor;
    const tickXp = effectiveXpPerTick * tickVehicleFactor;

    // Single cumulative roll (Phase 1a: no if/else-if probability distortion).
    // rareDropChance mod increases the gear threshold linearly.
    // Activity modifiers add on top: rareDropChanceMod + materialFindChance.
    // Consumable mods add: bonusLootChance (Luck Booster) + rareDropChanceMod.
    // Vehicle: the loot-roll chances scale by the yield factor (more
    // ground covered per tick = more finds), plus the scanner affix.
    const gearChance = clampChance(
      GEAR_THRESHOLD * (1 + totalRareDropMod + activityRareDropBonus + consumableMods.rareDropChanceMod)
        * tickVehicleFactor * (1 + tickVehicleScanner)
      + consumableMods.bonusLootChance
    );
    const fragmentChance = Math.max(
      0,
      (request.economy?.fragmentChance ?? FRAGMENT_CHANCE) * (1 + activityFragmentBonus)
        * tickVehicleFactor * (1 + tickVehicleScanner),
    );
    const materialChance = Math.max(0, MATERIAL_CHANCE * (1 + activityMaterialBonus) * tickVehicleFactor * hotMaterialMult);
    const gearThreshold = gearChance;
    const fragmentThreshold = Math.min(0.99, gearThreshold + fragmentChance);
    const materialThreshold = Math.min(0.99, fragmentThreshold + materialChance);
    const roll = rng();

    if (roll < gearThreshold) {
      // Gear drop — generate the actual item server-side
      const gear = rollGearDrop(rng, tickCount - ticks + tickIdx + 1);

      if (gear) {
        generatedItems.push(gear);
        feedEvents.push({
          at: now - (ticks - 1 - tickIdx) * TICK_MS,
          tone: 'loot',
          label: gear.name,
          detail: gearFeedDetail(gear),
          gear,
          areaId,
        });

        // Data Skimmer (extraLootRollChance): one bonus loot roll per
        // gear drop, rolled on the same tick RNG stream. This is the
        // roaming consumer for the def's extra-roll effect — before the
        // consumable contract repair the mod was produced every tick
        // and never read.
        if (consumableMods.extraLootRollChance > 0 && rng() < consumableMods.extraLootRollChance) {
          const bonusGear = rollGearDrop(rng, tickCount - ticks + tickIdx + 1);
          if (bonusGear) {
            generatedItems.push(bonusGear);
            feedEvents.push({
              at: now - (ticks - 1 - tickIdx) * TICK_MS,
              tone: 'loot',
              label: bonusGear.name,
              detail: `${gearFeedDetail(bonusGear)} · Data Skimmer extra roll`,
              gear: bonusGear,
              areaId,
            });
          }
        }
      }
    } else if (roll < fragmentThreshold) {
      // Silt Storm window (event): fragment finds double while it lasts.
      const fragGain = evStormTicks > 0 ? 2 : 1;
      fragmentsAwarded += fragGain;
      feedEvents.push({
        at: now - (ticks - 1 - tickIdx) * TICK_MS,
        tone: 'fragment',
        label: `+${fragGain} cache fragment${fragGain > 1 ? 's' : ''}`,
        detail: evStormTicks > 0
          ? 'The storm shakes loose a doubled fragment find.'
          : `${area.enemyType} patrol yielded a cache key fragment.`,
        areaId,
        value: fragGain,
      });
    } else if (roll < materialThreshold) {
      let find = rollAreaMaterialFind(area, rng);
      if (find && find.kind === 'material') {
        // Tier-2 signature substitution (brief §2.5): a slice of
        // base-material finds in an area come up as the area's
        // signature material instead. Rolled on its own stream so
        // the main tick stream is untouched.
        const signature = signatureMaterialForArea(area.id);
        if (signature) {
          const sigRng = createTickRng(playerId, `${areaId}:signature`, tickNumber);
          if (sigRng() < SIGNATURE_MATERIAL_FIND_CHANCE) {
            find = { type: signature.materialId, kind: 'material' };
          }
        }
      }
      if (find) {
        // Vehicle yield on finds: the factor's fractional part and
        // the cargo bonus each give a chance at a bonus unit.
        let quantity = 1;
        if (tickVehicleFactor > 1 || tickVehicleMaterialBonus > 0) {
          const bonusChance = (tickVehicleFactor - 1) + tickVehicleMaterialBonus;
          if (rng() < bonusChance) quantity += 1;
          if (rng() < bonusChance - 1) quantity += 1;
        }
        // Loot Quantity (Scavenger small nodes, Phase 2d): a bonus
        // unit of the find with probability equal to the skill total.
        // The roll is gated on the bonus being positive so claims by
        // players without the nodes consume the exact same RNG stream
        // as before this wiring.
        const skillLootQuantity = skillBonuses.lootQuantity || 0;
        if (skillLootQuantity > 0 && rng() < skillLootQuantity) {
          quantity += 1;
        }
        if (find.kind === 'material') {
          materials[find.type] = (materials[find.type] || 0) + quantity;
        } else {
          essences[find.type] = (essences[find.type] || 0) + quantity;
        }
        feedEvents.push({
          at: now - (ticks - 1 - tickIdx) * TICK_MS,
          tone: find.kind === 'material' ? 'material' : 'essence',
          label: `+${quantity} ${find.type}`,
          detail: `Field sweep recovered ${find.type}.`,
          areaId,
          value: quantity,
        });
      }
    } else {
      // Kill — base rewards. Show the actual per-tick amounts.
      killsRecorded++;
      feedEvents.push({
        at: now - (ticks - 1 - tickIdx) * TICK_MS,
        tone: 'kill',
        label: `+${parseFloat(tickCredits.toFixed(2))}cr · +${parseFloat(tickScrap.toFixed(2))} scrap · +${parseFloat(tickXp.toFixed(2))} XP`,
        detail: `${area.enemyType} routed in ${area.name}.`,
        areaId,
        value: tickCredits,
      });
    }

    // Every tick awards base resources (with idle mods + skill bonuses + activity mods + consumable mods + vehicle yield)
    creditsFraction += tickCredits;
    scrapFraction += tickScrap * consumableMods.scrapYieldMultiplier;
    xpFraction += tickXp * consumableMods.xpMultiplier;

    // --- Kill cycle simulation (player → monster damage) ---
    // Amp behavior (Phase 2c): outgoing damage is multiplied while
    // the shield sits at full capacity, evaluated at the moment the
    // hunter deals damage (before this tick's incoming hit lands).
    const tickAmpMult = ampDamageMultiplier(shieldBehavior, survShield, shieldCapacity);
    const tickEffectiveDps =
      (effectiveDps * consumableMods.dpsMultiplier + consumableMods.ordnanceBonusDps) * tickAmpMult;
    if (!survDead && tickEffectiveDps > 0 && roster.length > 0) {
      // Spawn a target if none exists (event-aware: bounties, elite
      // patrols, escalation, and weakpoint marking all apply here)
      if (!kcTargetId) {
        spawnNextTarget(tickIdx, tickNumber);
      }

      // Apply damage to current target
      if (kcTargetId) {
        const monster = roster.find((m) => m.id === kcTargetId);
        if (monster) {
          let dmg = computePlayerDamageVsMonster({ effectiveDps: tickEffectiveDps }, monster);
          // Armor-Break Window (event): brutes take double damage.
          if (evBreakTicks > 0 && monster.archetype === 'brute') dmg *= 2;
          kcTargetHp -= dmg;

          // Feed event: hunter damaged the enemy
          if (dmg > 0) {
            feedEvents.push({
              at: now - (ticks - 1 - tickIdx) * TICK_MS,
              tone: 'hit',
              label: `-${dmg} HP`,
              detail: `Hit ${monster.name} for ${dmg} HP.`,
              areaId,
              value: dmg,
            });
          }

          if (kcTargetHp <= 0) {
            // Kill! Advance the cycle
            kcMonstersKilled += 1;
            kcTotalKills += 1;
            kcLastKilledId = kcTargetId;

            // Feed event: hunter killed the enemy
            feedEvents.push({
              at: now - (ticks - 1 - tickIdx) * TICK_MS,
              tone: 'kill',
              label: `Killed ${monster.name}`,
              detail: `${monster.name} eliminated in ${area.name}.`,
              areaId,
              value: 0,
            });

            // Jackpot (legendary): every 150th kill with this weapon as
            // primary drops a Cache Key fragment. kcTotalKills is the
            // server-advanced kill-cycle counter returned to the client
            // each claim, so the every-150th cadence survives across
            // claims. The fragment flows through the normal rewards
            // bundle into cc_apply_chef_rewards.
            if (hasJackpot(primaryWeapon) && kcTotalKills % 150 === 0) {
              fragmentsAwarded++;
              feedEvents.push({
                at: now - (ticks - 1 - tickIdx) * TICK_MS,
                tone: 'fragment',
                label: '+1 cache fragment',
                detail: `Jackpot! Kill #${kcTotalKills} with ${primaryWeapon?.name ?? 'your weapon'} dropped a cache key fragment.`,
                areaId,
                value: 1,
              });
            }

            onTargetKilled(monster, rng, tickIdx, tickNumber);
            spawnNextTarget(tickIdx, tickNumber);
          }
        }
      }
    }

    // --- Survival simulation (monster → player damage) ---
    if (!survDead && roster.length > 0) {
      const attacker = pickAreaMonster(area);
      if (attacker) {
        // Apply consumable mods: incoming DPS multiplier (Cryo), enemy pressure (Loot Beacon)
        const modifiedAttacker = {
          ...attacker,
          attackPower: Math.round(
            attacker.attackPower * consumableMods.incomingDpsMultiplier * consumableMods.enemyPressureMultiplier
            // Event pressure windows + the hot-area danger band: the
            // storm and an unmatched surge press the hunter harder;
            // the hot area's danger is up one band by design.
            * (evStormTicks > 0 ? 1.5 : 1)
            * (evSurgeTicks > 0 && !evSurgeMatched ? 1.3 : 1)
            * (isHotAreaClaim ? HOT_AREA_DANGER_MULTIPLIER : 1)
          ),
          accuracy: (attacker.accuracy ?? 0.85) * consumableMods.incomingAccuracyMultiplier,
        };
        // Nova re-arm (Phase 2c): a spent nova re-arms once the
        // shield has been restored above the threshold — checked
        // here, after this tick's consumable restore has landed.
        if (
          shieldBehavior === 'nova' &&
          !shieldNovaArmed &&
          shieldCapacity > 0 &&
          survShield >= SHIELD_BEHAVIOR_TUNING.novaRearmThreshold * shieldCapacity
        ) {
          shieldNovaArmed = true;
        }
        // Mitigation comes from the equipped shield, re-derived
        // server-side above (serverMitigation) — never from the claim
        // body — plus consumable damage reduction (Shield Cell
        // resistance). This is the value the snapshot's Effective HP
        // math advertises; display and engine now agree.
        const hunter: HunterSurvivalStats = {
          maxHp: survMaxHp,
          shieldHp: survShield,
          mitigation: Math.min(0.8, serverMitigation + consumableMods.damageReductionPct),
          shieldBehavior,
          shieldCapacity,
          shieldNovaArmed,
        };
        const hit = computeMonsterDamageVsHunter(modifiedAttacker, hunter);
        if (!hit.missed) {
          // Feed event: monster damaged the hunter
          if (hit.hpDamage > 0 || hit.shieldAbsorbed > 0) {
            const damageLabel = hit.shieldAbsorbed > 0
              ? `-${hit.shieldAbsorbed} shield${hit.hpDamage > 0 ? ` · -${hit.hpDamage} HP` : ''}`
              : `-${hit.hpDamage} HP`;
            feedEvents.push({
              at: now - (ticks - 1 - tickIdx) * TICK_MS,
              tone: 'damage',
              label: damageLabel,
              detail: `${modifiedAttacker.name} hit you for ${hit.hpDamage} HP${hit.shieldAbsorbed > 0 ? ` (${hit.shieldAbsorbed} absorbed by shield)` : ''}.`,
              areaId,
              value: hit.hpDamage,
            });
          }
          survShield = Math.max(0, survShield - hit.shieldAbsorbed);

          // Shield behaviors (Phase 2c): the contract resolved the
          // behavior for this hit; apply its outcomes. Absorb negated
          // the hit outright (shieldAbsorbed/hpDamage are both 0) and
          // restores shield; Nova's arm state carries forward.
          if (typeof hit.novaArmed === 'boolean') {
            shieldNovaArmed = hit.novaArmed;
          }
          if (hit.behaviorAbsorbed) {
            const restored = hit.behaviorShieldRestore ?? 0;
            if (restored > 0) {
              survShield = Math.min(shieldCapacity, survShield + restored);
            }
            feedEvents.push({
              at: now - (ticks - 1 - tickIdx) * TICK_MS,
              tone: 'heal',
              label: 'Absorbed the hit',
              detail: `${slotShield?.name ?? 'Your shield'} absorbed ${modifiedAttacker.name}'s hit${restored > 0 ? ` and restored ${restored} shield` : ''}.`,
              areaId,
              value: restored,
            });
          }

          // Med Kit buffer absorbs damage after shield, before HP.
          // Buffer pools stack across the Med Kit line (base + refined);
          // drain each pool in slot order so per-type consumption can be
          // derived from each pool's remainder at claim end.
          let remainingHpDamage = hit.hpDamage;
          if (roamingState && remainingHpDamage > 0) {
            for (const slot of roamingState.slots) {
              if (remainingHpDamage <= 0) break;
              if (!isBufferConsumable(slot.consumableId) || slot.remainingBuffer <= 0) continue;
              const absorbed = Math.min(slot.remainingBuffer, remainingHpDamage);
              slot.remainingBuffer -= absorbed;
              remainingHpDamage -= absorbed;
            }
          }

          survHp = Math.max(0, survHp - remainingHpDamage);
          if (survHp <= 0) {
            survDead = true;
            survKilledBy = { monsterId: modifiedAttacker.id, monsterName: modifiedAttacker.name, areaId };
            survDiedAt = now - (ticks - 1 - tickIdx) * TICK_MS;
            // Feed event: hunter died
            feedEvents.push({
              at: now - (ticks - 1 - tickIdx) * TICK_MS,
              tone: 'death',
              label: 'Hunter Down',
              detail: `Killed by ${modifiedAttacker.name} in ${area.name}.`,
              areaId,
              value: 0,
            });
          }

          // Nova burst (Phase 2c): the breaking hit erupts back at
          // the kill cycle's current target — even if the hit also
          // downed the hunter, the burst is simultaneous with the
          // break. A nova kill advances the cycle exactly like a
          // weapon kill (counters, rotation, feed), except the
          // weapon-bound Jackpot fragment never keys off it.
          if (hit.novaDamage && hit.novaDamage > 0) {
            feedEvents.push({
              at: now - (ticks - 1 - tickIdx) * TICK_MS,
              tone: 'hit',
              label: `Nova burst — ${hit.novaDamage} damage`,
              detail: `${slotShield?.name ?? 'Your shield'} erupted as it broke, blasting ${kcTargetId ? (roster.find((m) => m.id === kcTargetId)?.name ?? modifiedAttacker.name) : modifiedAttacker.name} for ${hit.novaDamage} damage.`,
              areaId,
              value: hit.novaDamage,
            });
            if (kcTargetId) {
              const novaTarget = roster.find((m) => m.id === kcTargetId);
              if (novaTarget) {
                kcTargetHp -= hit.novaDamage;
                if (kcTargetHp <= 0) {
                  kcMonstersKilled += 1;
                  kcTotalKills += 1;
                  kcLastKilledId = kcTargetId;
                  feedEvents.push({
                    at: now - (ticks - 1 - tickIdx) * TICK_MS,
                    tone: 'kill',
                    label: `Killed ${novaTarget.name}`,
                    detail: `${novaTarget.name} eliminated by a nova burst in ${area.name}.`,
                    areaId,
                    value: 0,
                  });
                  onTargetKilled(novaTarget, rng, tickIdx, tickNumber);
                  spawnNextTarget(tickIdx, tickNumber);
                }
              }
            }
          }
        }
      }
    }

    // --- Roaming events: objective bookkeeping, windows, the roll ---
    // Streak Run objective: this tick's kills count only if the hunter
    // took no hit (HP or shield) during it.
    const streakNow = evStreakBox.value;
    if (streakNow) {
      const tookHit = survHp < tickStartHp || survShield < tickStartShield;
      if (tookHit) {
        feedEvents.push({
          at: now - (ticks - 1 - tickIdx) * TICK_MS,
          tone: 'event',
          label: 'Streak broken',
          detail: 'A hit landed — the Streak Run contract lapses unpaid.',
          areaId,
          eventId: 'streak_broken',
          family: 'objective',
        });
        evStreakBox.value = null;
      } else {
        streakNow.kills += kcMonstersKilled - tickStartKills;
        if (streakNow.kills >= 5) {
          xpFraction += 25;
          fragmentsAwarded += 2;
          feedEvents.push({
            at: now - (ticks - 1 - tickIdx) * TICK_MS,
            tone: 'event',
            label: 'Streak complete',
            detail: 'Five kills without a scratch — the Streak Run pays +25 XP and +2 cache fragments.',
            areaId,
            eventId: 'streak_complete',
            family: 'objective',
          });
          evStreakBox.value = null;
        } else {
          streakNow.ticksLeft -= 1;
          if (streakNow.ticksLeft <= 0) evStreakBox.value = null;
        }
      }
    }
    const weakpointNow = evWeakpointBox.value;
    if (weakpointNow) {
      weakpointNow.ticksLeft -= 1;
      if (weakpointNow.ticksLeft <= 0) evWeakpointBox.value = null;
    }
    // Overheat attrition bites for windows carried INTO this tick; a
    // window lit by this tick's own resolution starts biting next tick.
    if (evOverheatTicks > 0 && !survDead) {
      applyEventDamage(3, 'Overheat Vent', 'redline_overheat_vent', tickIdx);
    }
    // Window decay: windows set on earlier ticks count down here; a
    // window set by this tick's resolution (below) starts at full.
    if (evStormTicks > 0) evStormTicks -= 1;
    if (evOverheatTicks > 0) evOverheatTicks -= 1;
    if (evBreakTicks > 0) evBreakTicks -= 1;
    if (evSurgeTicks > 0) evSurgeTicks -= 1;

    // The event roll: one roll per tick on the ':event' stream, after
    // the kill cycle and survival have resolved (brief §2.1 placement).
    // Chance = economy base + Loot Beacon (consumable) + the vehicle's
    // scanner affix total, clamped to the [0, EVENT_CHANCE_MAX]
    // envelope. The roll is NOT gated on survival: the shipped ticker
    // never stopped paying for death (death gates the kill cycle, not
    // the reward roll), and offline settlement carries no survival
    // input at all — gating here would silently diverge claim and
    // settlement payouts on identical state. Event DAMAGE still
    // no-ops on a downed hunter (applyEventDamage), and kill-cycle
    // event state (bounties, elites, streaks) simply never resolves
    // without kills.
    {
      const eventChance = Math.min(
        EVENT_CHANCE_MAX,
        Math.max(
          0,
          (request.economy?.eventChanceBase ?? EVENT_CHANCE_BASE)
            + consumableMods.eventChanceBonus
            + tickVehicleScanner,
        ),
      );
      const pickMods = {
        findWeightMult: 1 + consumableMods.eventFindWeightBonus,
        cacheWeightMult: 1 + consumableMods.cacheEventWeightBonus,
      };
      const eventRng = createTickRng(playerId, `${areaId}:event`, tickNumber);
      if (eventRng() < eventChance) {
        const def = pickRoamingEvent(areaId, eventRng, pickMods);
        if (def) resolveRoamingEvent(def, eventRng, tickIdx, tickNumber, tickEffectiveDps);
      } else if (consumableMods.eventForeshadow && tickIdx < ticks - 1) {
        // Data Skimmer foreshadow: peek at next tick's stream and hint
        // the family of whatever is coming — information only, the
        // future tick still rolls its own stream when it arrives.
        const peekRng = createTickRng(playerId, `${areaId}:event`, tickNumber + 1);
        const peeked = peekRoamingEvent(areaId, peekRng, eventChance, pickMods);
        if (peeked) {
          const flavor =
            peeked.family === 'find'
              ? 'something buried'
              : peeked.family === 'hazard'
                ? 'something dangerous'
                : peeked.family === 'fight'
                  ? 'something hostile'
                  : 'something unusual';
          feedEvents.push({
            at: now - (ticks - 1 - tickIdx) * TICK_MS,
            tone: 'event',
            label: 'Signal spike',
            detail: `The skimmer pings ${flavor} ahead…`,
            areaId,
            eventId: 'foreshadow',
            family: peeked.family,
            hint: true,
          });
        }
      }
    }
  }

  // Compute buffer consumption from absorption (flat stacking model),
  // per type: each full def-healHp of a type's pool absorbed = 1 unit of
  // that type consumed. (The pre-repair code lumped both Med Kit types
  // into the base type's count at a hard-coded 150/unit, so Refined
  // absorption was charged as base Med Kits — or not at all, since
  // Refined never activated.)
  if (roamingState) {
    for (const slot of roamingState.slots) {
      if (!isBufferConsumable(slot.consumableId)) continue;
      const initialCount = initialBufferCounts[slot.consumableId] ?? 0;
      if (initialCount <= 0) continue;
      const perUnit = bufferHealPerUnit(slot.consumableId, slot.qualityPercent ?? 100);
      if (perUnit <= 0) continue;
      const remainingFull = Math.floor(Math.max(0, slot.remainingBuffer) / perUnit);
      const consumed = initialCount - remainingFull;
      if (consumed > 0) {
        consumedConsumables[slot.consumableId] =
          (consumedConsumables[slot.consumableId] ?? 0) + consumed;
      }
    }
  }

  // Settle the fractional banks: pay the whole amounts, bank the rest.
  // (Math.max also normalizes a float-dust -0 bank to 0.)
  const scrapPaid = Math.floor(scrapFraction + 1e-9);
  const scrapBanked = Math.max(0, Math.round((scrapFraction - scrapPaid) * 1e6) / 1e6);
  const creditsPaid = Math.floor(creditsFraction + 1e-9);
  const creditsBanked = Math.max(0, Math.round((creditsFraction - creditsPaid) * 1e6) / 1e6);
  const xpPaid = Math.floor(xpFraction + 1e-9);
  const xpBanked = Math.max(0, Math.round((xpFraction - xpPaid) * 1e6) / 1e6);

  return {
    actionType: 'cc_claim_roaming_rewards',
    profile: {}, // populated by Supabase RPC
    rewards: {
      ticks,
      creditsAwarded: creditsPaid,
      creditsRemainder: creditsBanked,
      scrapAwarded: scrapPaid,
      scrapRemainder: scrapBanked,
      xpAwarded: xpPaid,
      xpRemainder: xpBanked,
      cacheFragmentsAwarded: fragmentsAwarded,
      materials,
      essences,
      killsRecorded,
    },
    items: generatedItems,
    feedEvents,
    // Server-authoritative kill cycle state for client synchronization
    killCycle: {
      currentTargetId: kcTargetId,
      currentTargetHp: Math.max(0, kcTargetHp),
      currentTargetHpMax: kcTargetHpMax,
      monstersKilledCount: kcMonstersKilled,
      totalKills: kcTotalKills,
      lastKilledMonsterId: kcLastKilledId,
    },
    // Server-authoritative survival HP for client synchronization
    survival: (() => {
      const ss = roamingState ? getSurvivalState(roamingState) : null;
      return {
        currentHp: survHp,
        shieldHp: survShield,
        isDead: survDead,
        killedBy: survKilledBy,
        diedAt: survDiedAt,
        shieldNovaArmed,
        medKitBuffer: ss?.medKitBuffer ?? 0,
        nanoSwarmTicksRemaining: ss?.nanoSwarmTicksRemaining ?? 0,
        adrenalineActive: ss?.adrenalineActive ?? false,
        shieldCellResistance: ss?.shieldCellResistance ?? 0,
      };
    })(),
    // Vehicle outcome (Phase 2b): end-of-claim fuel/condition for
    // the routes to persist; inactiveReason explains an off bonus.
    vehicle: {
      equipped: vehicleInput !== null,
      vehicleClassId: vehicleInput?.vehicle.vehicleClassId ?? null,
      activeTicks: vehicleActiveTicks,
      ticks,
      fuelUnitsStart: vehicleStartFuel,
      fuelUnitsRemaining: Math.round(vehicleFuel * 10000) / 10000,
      fuelConsumed: Math.round((vehicleStartFuel - vehicleFuel) * 10000) / 10000,
      conditionStart: vehicleStartCondition,
      conditionCurrent: Math.round(vehicleCondition * 10000) / 10000,
      conditionMax: vehicleInput?.conditionMax ?? 0,
      inactiveReason: !vehicleInput
        ? 'no_vehicle'
        : vehicleActiveTicks === 0
          ? 'out_of_fuel'
          : null,
    },
    // Roaming events fired this claim + escalated elite kills
    // (overhaul): the routes persist these to the verified action
    // ledger for EV measurement and mastery credit.
    eventsFired,
    eliteKills,
    // Consumables consumed during this claim batch
    consumedConsumables,
    // Updated roaming consumable state for next claim
    roamingConsumableState: roamingState,
    // Active buff display data for client UI
    activeBuffs: roamingState ? buildActiveBuffs(roamingState, tickCount) : [],
  };
}

/**
 * Chance that a boss victory's guaranteed loot roll lands on one of
 * the boss's dedicated drops (boss.dedicatedDrops). The boss defs
 * declare the dedicated pools but no rates, so the rate is a Chef
 * constant — documented in MECHANICS.md §10 (Boss Combat).
 * Pacing-baseline tuning (lifecycle evaluation): 0.25 → 0.10, the
 * Borderlands-standard dedicated rate, so named legendaries stay
 * chase items instead of arriving every fourth kill.
 */
export const BOSS_DEDICATED_DROP_CHANCE = 0.1;

export function processBossAttempt(request: BossAttemptRequest): BossAttemptChefResult {
  const boss = REGION_1_BOSSES.find((entry) => entry.id === request.bossId);
  if (!boss) throw new Error(`Unknown boss: ${request.bossId}`);

  const entryFee = Math.max(0, Math.trunc(request.entryFee ?? 0));

  const input: BossSimulationInput = { ...request, boss };
  // Action skill (0030): the route-resolved fire plan's sim effect
  // joins the sim input. The Fixer plan instead pre-scaled
  // request.consumableQuality (already in the spread); the Scavenger
  // plan resolves in the loot block below.
  if (request.actionSkillFire?.simEffect) {
    input.actionSkill = request.actionSkillFire.simEffect;
  }

  // Telemetry DPS, re-derived from the gear objects. Since the trust
  // hardening (Phase 0 Slice 6) those objects are themselves derived
  // by the verify-boss route from the server's equipped-item records,
  // and skillBonuses is rebuilt there from profiles.skill_spends —
  // the request body no longer supplies either. This figure is
  // telemetry only; the sim below consumes the same derived inputs.
  const serverGearEffectiveDps = computeEffectiveDpsFromGear({
    weapons: [request.primary, request.secondary, request.heavy].filter(
      (w): w is import('../types/items').Weapon => !!w && 'weaponType' in w,
    ),
    ordnance: request.ordnance,
    relic: request.relic,
    classMod: request.classMod,
    skillDpsMult: 1 + (request.skillBonuses?.dps ?? 0),
    skillStatusChance: request.skillBonuses?.statusChance ?? 0,
  });

  const sim = simulateBoss(input);
  const rng = createTickRng(request.playerId, boss.id, request.attemptNonce);
  const rm = getBossRiskModifiers(request.risk);
  const chaosRoll = (rng() - 0.5) * 0.1 + rm.chaos;
  const adjustedWinChance = Math.max(0.02, Math.min(0.98, sim.winChance + chaosRoll));
  const victory = rng() < adjustedWinChance;
  const legendary = applyLegendaryEffects(request.primary, request.pityCount || 0);

  const bonusLootRolls = victory
    ? (rng() < sim.bonusLootChance ? 1 : 0) + (rng() < sim.extraLootRollChance ? 1 : 0)
    : 0;

  const deathFee = victory ? 0 : sim.deathFee;
  // Cache Rank Greed (0031): victory credits scale last; the death
  // fee never does.
  const rawCreditsDelta = victory
    ? Math.round(boss.level * 150 * legendary.creditMult * (1 + (request.cacheRankBonuses?.credits ?? 0)))
    : -deathFee;
  // The entry fee is charged on every resolved attempt, win or lose —
  // it is part of the net delta the applier persists.
  const creditsDelta = applyBadDecisionBonus(rawCreditsDelta, request.primary) - entryFee;

  let xpMult = 1;
  // Relic affixes with xpBoostMod
  request.relic?.affixes.forEach((affix) => {
    if (affix.stat === 'xpBoostMod') xpMult += affix.value;
  });
  // Class mod affixes with xpBoostMod
  request.classMod?.affixes.forEach((affix) => {
    if (affix.stat === 'xpBoostMod') xpMult += affix.value;
  });
  // Skill tree xpBoostMod (previously ignored in boss path)
  xpMult += request.skillBonuses?.xpBoostMod ?? 0;
  // Pacing-baseline tuning: boss XP is boss.level × 50 (was × 20) so the
  // boss ladder stays a meaningful XP source under the stretched curve.
  // Cache Rank Fast Learner (0031) multiplies last.
  const xpAwarded = victory ? Math.round(boss.level * 50 * xpMult * (1 + (request.cacheRankBonuses?.xp ?? 0))) : 0;

  const consumedConsumables = getBossConsumableUsage(request.consumables, victory, sim.survivalScore);
  const refundChance = getInsuranceFraudRefundChance(request.primary);
  if (refundChance > 0) {
    Object.keys(consumedConsumables).forEach((type) => {
      if (rng() < refundChance) delete consumedConsumables[type];
    });
  }
  // Insurance Fraud (Scavenger major skill, Phase 2d): on victory,
  // each used consumable type has the recovery chance to be refunded
  // instead of charged — the skill twin of the legendary refund
  // above. skillBonuses is the server-rebuilt record (verify-boss
  // route), never the request body's copy.
  const recoveryChance = victory ? (request.skillBonuses?.consumableRecovery ?? 0) : 0;
  if (recoveryChance > 0) {
    Object.keys(consumedConsumables).forEach((type) => {
      if (rng() < recoveryChance) delete consumedConsumables[type];
    });
  }

  const loot: GearItem[] = [];
  let scrapAwarded = 0;
  let secondOpinionScrap: BossAttemptChefResult['secondOpinionScrap'] = null;
  let unlockedBossId: string | undefined;
  let dedicatedDropAwarded = false;
  const surgeLootIds: string[] = [];
  if (victory) {
    const currentIndex = REGION_1_BOSSES.findIndex((entry) => entry.id === boss.id);
    unlockedBossId = REGION_1_BOSSES[currentIndex + 1]?.id;
    const guaranteedRolls = 1;
    const baseBonusRolls = rng() < 0.3 ? 1 : 0;
    const totalRolls = guaranteedRolls + baseBonusRolls + bonusLootRolls;
    // Dedicated drops: the guaranteed roll can land on the boss's own
    // declared legendary pool (boss.dedicatedDrops ⊆ boss.dropTable,
    // enforced by the content validator). The pool is filtered to
    // effects actually eligible for BossDrop at this boss's tier.
    const eligibleEffects = getEligibleLegendaryEffects(DropSource.BossDrop, boss.tier);
    const dedicatedPool = boss.dedicatedDrops.filter((id) => eligibleEffects.some((eff) => eff.id === id));
    for (let i = 0; i < totalRolls; i++) {
      if (
        i === 0 &&
        dedicatedPool.length > 0 &&
        rng() < (request.economy?.bossDedicatedChance ?? BOSS_DEDICATED_DROP_CHANCE)
      ) {
        const pick = dedicatedPool[Math.floor(rng() * dedicatedPool.length)];
        loot.push(
          generateWeapon(
            {
              source: DropSource.BossDrop,
              // Dedicated drops generate at the PLAYER's level once the
              // player outlevels the boss (pacing-baseline tuning):
              // boss levels stop at 45 while roaming legendaries scale
              // to 100, so a boss-level dedicated drop lost the power
              // race for any high-level farmer. Generic rolls below
              // keep boss.level.
              level: Math.max(boss.level, Math.max(1, Math.trunc(request.playerLevel) || boss.level)),
              bossTier: boss.tier,
              forcedRarity: Rarity.Legendary,
              forcedLegendaryEffectId: pick,
            },
            rng,
          ),
        );
        dedicatedDropAwarded = true;
      } else {
        loot.push(generateWeapon({ source: DropSource.BossDrop, level: boss.level, bossTier: boss.tier }, rng));
      }
    }

    // Second Opinion (legendary): the guaranteed loot roll happens
    // twice. The boss attempt is atomic — there is no interactive
    // mid-attempt choice anywhere in the game — so the Chef keeps the
    // higher-combatPower weapon (the pick the description promises,
    // automated) and auto-scraps the other at the standard salvage
    // rate (salvageScrap, the TS mirror of cc_salvage_scrap). The
    // scrapped twin is never stored as an item; its scrap is credited
    // through cc_apply_chef_boss_attempt's scrap delta. Bonus rolls
    // (base/consumable) are not part of the pair.
    if (hasSecondOpinion(request.primary) && loot.length > 0) {
      const twin = generateWeapon({ source: DropSource.BossDrop, level: boss.level, bossTier: boss.tier }, rng);
      const first = loot[0] as import('../types/items').Weapon;
      const kept = twin.combatPower > first.combatPower ? twin : first;
      const scrapped = kept === twin ? first : twin;
      // Cache Rank Salvage Hound (0031): the twin's scrap scales last.
      scrapAwarded = Math.round(
        salvageScrap(scrapped.rarity, scrapped.level) * (1 + (request.cacheRankBonuses?.scrap ?? 0)),
      );
      secondOpinionScrap = {
        name: scrapped.name,
        rarity: scrapped.rarity,
        combatPower: scrapped.combatPower,
        scrapAwarded,
      };
      loot[0] = kept;
    }

    // Cache Surge (Scavenger action skill, 0030): extra rolls on
    // victory through the SAME generator the normal rolls use, with
    // the surge rarity weights (content-owned, hard-clamped). The
    // surge never touches the dedicated roll above and mints nothing
    // outside the drop pipeline — these are ordinary boss-drop rolls
    // with bent odds, stored and metered exactly like normal loot.
    const surgePlan = request.actionSkillFire;
    if (surgePlan?.tree === 'Scavenger' && (surgePlan.surgeRolls ?? 0) > 0) {
      for (let i = 0; i < (surgePlan.surgeRolls ?? 0); i++) {
        const surgeItem = generateWeapon(
          {
            source: DropSource.BossDrop,
            level: boss.level,
            bossTier: boss.tier,
            zoneWeights: surgePlan.surgeWeights,
          },
          rng,
        );
        loot.push(surgeItem);
        surgeLootIds.push(surgeItem.id);
      }
    }
  }

  const projectedPhase = sim.projectedFailurePhase;
  let phaseFailed: string | undefined;
  let bossHpRemaining: number | undefined;
  if (!victory) {
    if (projectedPhase) phaseFailed = projectedPhase.phaseName;
    else if (sim.survivalScore < sim.breakScore && sim.survivalScore < sim.dpsScore) phaseFailed = 'survival';
    else if (sim.breakScore < sim.dpsScore) phaseFailed = 'break';
    else phaseFailed = 'dps';
    bossHpRemaining = Math.round((1 - rng() * 0.6) * 100);
  }

  const resultReasons = victory
    ? [
        projectedPhase?.currentAnswers[0]
          ? `Victory: ${projectedPhase.phaseName} cleared with ${projectedPhase.currentAnswers[0]}.`
          : `Victory: ${boss.name} defeated with current prep.`,
        ...sim.reasons,
      ]
    : [
        projectedPhase
          ? `Defeat: Failed ${projectedPhase.phaseName}. ${projectedPhase.explanation}`
          : `Defeat: ${boss.name} outlasted your current prep.`,
        ...sim.reasons,
      ];

  const result: BossAttemptResult = {
    id: bossAttemptId(request.playerId, boss.id, request.attemptNonce),
    bossId: boss.id,
    timestamp: Date.now(),
    victory,
    winChance: sim.winChance,
    phaseFailed,
    bossHpRemaining,
    consumablesUsed: consumedConsumables,
    consumablesLost: consumedConsumables,
    entryFee,
    creditsGained: victory ? Math.max(0, creditsDelta) : 0,
    creditsLost: victory ? Math.max(0, -creditsDelta) : deathFee + entryFee,
    loot: loot.map((item) => item.id),
    reasons: Array.from(new Set(resultReasons)),
    recommendations: sim.recommendations,
    ...(request.actionSkillFire
      ? {
          actionSkill: {
            tree: request.actionSkillFire.tree,
            name: ACTION_SKILL_DEFS[request.actionSkillFire.tree].name,
            fired: true,
            ...(surgeLootIds.length > 0
              ? {
                  surgeRolls: request.actionSkillFire.surgeRolls ?? 0,
                  surgeLoot: surgeLootIds,
                }
              : {}),
            ...(request.actionSkillFire.qualityMultiplier !== undefined
              ? { qualityMultiplier: request.actionSkillFire.qualityMultiplier }
              : {}),
          },
        }
      : {}),
  };

  return {
    actionType: 'cc_apply_boss_attempt',
    profile: {},
    result,
    creditsDelta,
    xpAwarded,
    scrapAwarded,
    secondOpinionScrap,
    loot,
    items: loot,
    consumedConsumables,
    extraLoot: bonusLootRolls > 0,
    bonusLootRolls,
    entryFee,
    dedicatedDropAwarded,
    unlockedBossId,
    telemetry: {
      serverRolled: true,
      adjustedWinChance,
      effectiveDps: serverGearEffectiveDps,
      timeToKill: sim.timeToKill,
    },
  };
}

// --- Endless mode (the Chaos Chamber, 0028) ---

export interface EndlessEncounterRequest extends Omit<BossSimulationInput, 'boss'> {
  playerId: string;
  /** The server-owned run row id (from cc_start_endless_run). */
  runId: string;
  /** The run's anchor level (profile level at run start). */
  startLevel: number;
  /**
   * The depth being resolved. The ROUTE derives this from the run
   * row (depthReached + 1) — it is never read from the request body.
   */
  depth: number;
  /**
   * Live economy levers resolved by the route from the EconomyConfig
   * accessor — never from the client body. Absent = content defaults
   * (direct engine calls in tests).
   */
  economy?: Partial<EndlessLeverValues>;
  /**
   * Action skill fire plan (0030): route-resolved from server
   * records + levers, exactly like the boss attempt's — see
   * BossAttemptRequest.actionSkillFire. Absent = no fire.
   */
  actionSkillFire?: ActionSkillFirePlan | null;
  /**
   * Cache Rank bonuses (Cache Rank slice, 0031): resolved by the
   * endless route from profiles.cache_rank_spends — never from the
   * client body. Applied to the escrow deltas last; damage/max HP
   * reach the sim through the merged skillBonuses keys. Absent =
   * all-zero.
   */
  cacheRankBonuses?: CacheRankBonuses;
}

export interface EndlessEncounterChefResult {
  actionType: 'cc_apply_endless_encounter';
  /** Public facts about the resolved encounter (no player-readiness data). */
  encounter: Omit<EndlessEncounterDef, 'def'> & {
    weaknesses: string[];
    resistances: string[];
    mechanicName: string;
  };
  result: {
    id: string;
    depth: number;
    bossId: string;
    victory: boolean;
    winChance: number;
    phaseFailed?: string;
    bossHpRemaining?: number;
    reasons: string[];
    recommendations: string[];
    /** Action skill fired in this encounter (0030; player's own data). */
    actionSkill?: {
      tree: string;
      name: string;
      fired: boolean;
      surgeRolls?: number;
      surgeLoot?: string[];
      qualityMultiplier?: number;
    };
  };
  /** Escrow deltas for THIS encounter (paid at run end, not now). */
  rewards: { xp: number; credits: number; scrap: number };
  milestone: boolean;
  /** Milestone gear drop (stored immediately by the route, boss-loot pattern). */
  items: GearItem[];
  /** Cache Surge drops (0030): extra rolls on a victorious fired encounter, stored like milestone items. */
  surgeItems: GearItem[];
  /** True when this victory reached the depth cap — the run banks in full. */
  capReached: boolean;
  telemetry: {
    serverRolled: true;
    adjustedWinChance: number;
    effectiveDps: number;
    timeToKill: number;
  };
}

/**
 * Resolve ONE endless encounter. The run itself (depth, escrow, state)
 * is owned by the SQL appliers; this engine only resolves the fight
 * and the escrow deltas, exactly like processBossAttempt resolves an
 * attempt while cc_apply_chef_boss_attempt persists it.
 *
 * Differences from a boss attempt (all deliberate, see
 * src/content/endless.ts):
 *  - the prepared belt was burned at run start, so no consumables
 *    are consumed here — the belt still PRICES into the sim;
 *  - currency rewards go to escrow (the applier pays at run end);
 *  - milestone depths drop ONE gear item through the shipped
 *    generators with depth-shaped rarity weights;
 *  - no pity, no unlocks, no boss death fee — losing ends the run
 *    and the applier settles escrow at the death fraction.
 */
export function processEndlessEncounter(request: EndlessEncounterRequest): EndlessEncounterChefResult {
  const levers = request.economy;
  const encounter = endlessEncounterForDepth(request.depth, request.startLevel, levers);
  const boss = encounter.def;

  const input: BossSimulationInput = { ...request, boss };
  // Action skill (0030): sim-native signatures join the sim input;
  // the Fixer plan pre-scaled request.consumableQuality in the route;
  // the Scavenger plan resolves after the victory roll below.
  if (request.actionSkillFire?.simEffect) {
    input.actionSkill = request.actionSkillFire.simEffect;
  }

  const serverGearEffectiveDps = computeEffectiveDpsFromGear({
    weapons: [request.primary, request.secondary, request.heavy].filter(
      (w): w is import('../types/items').Weapon => !!w && 'weaponType' in w,
    ),
    ordnance: request.ordnance,
    relic: request.relic,
    classMod: request.classMod,
    skillDpsMult: 1 + (request.skillBonuses?.dps ?? 0),
    skillStatusChance: request.skillBonuses?.statusChance ?? 0,
  });

  const sim = simulateBoss(input);
  // One RNG stream per (player, run, depth) — replays re-derive the
  // same fight, and the applier's ledger makes them free.
  const rng = createTickRng(request.playerId, `endless:${request.runId}`, request.depth);
  const rm = getBossRiskModifiers(request.risk);
  const chaosRoll = (rng() - 0.5) * 0.1 + rm.chaos;
  const adjustedWinChance = Math.max(0.02, Math.min(0.98, sim.winChance + chaosRoll));
  const victory = rng() < adjustedWinChance;
  const legendary = applyLegendaryEffects(request.primary, 0);

  const baseRewards = victory ? endlessRewardsForDepth(request.depth, encounter.level, levers) : { xp: 0, credits: 0, scrap: 0 };
  let xpMult = 1;
  request.relic?.affixes.forEach((affix) => {
    if (affix.stat === 'xpBoostMod') xpMult += affix.value;
  });
  request.classMod?.affixes.forEach((affix) => {
    if (affix.stat === 'xpBoostMod') xpMult += affix.value;
  });
  xpMult += request.skillBonuses?.xpBoostMod ?? 0;
  // Cache Rank (0031): escrow deltas scale last, per currency.
  const endlessCacheRank = request.cacheRankBonuses;
  const rewards = {
    xp: Math.round(baseRewards.xp * xpMult * (1 + (endlessCacheRank?.xp ?? 0))),
    credits: Math.round(baseRewards.credits * legendary.creditMult * (1 + (endlessCacheRank?.credits ?? 0))),
    scrap: Math.round(baseRewards.scrap * (1 + (endlessCacheRank?.scrap ?? 0))),
  };

  const milestone = victory && isEndlessMilestoneDepth(request.depth);
  const items: GearItem[] = [];
  if (milestone) {
    const area = ROAMING_AREAS.find((entry) => entry.id === encounter.areaId) ?? ROAMING_AREAS[0];
    const weights = endlessMilestoneRarityWeights(request.depth, levers);
    const kind = rollAreaDropKind(area, rng);
    let drop: GearItem | null = null;
    switch (kind) {
      case 'weapon':
        drop = generateWeapon(
          { source: DropSource.BossDrop, level: encounter.level, bossTier: boss.tier, zoneWeights: weights },
          rng,
        );
        break;
      case 'shield':
        drop = generateShield(encounter.level, rng, weights);
        break;
      case 'classMod':
        drop = generateClassMod(encounter.level, rng, weights);
        break;
      case 'relic':
        drop = generateRelic(encounter.level, rng, weights);
        break;
      case 'ordnance':
        drop = generateOrdnance(encounter.level, rng, weights);
        break;
      default:
        break;
    }
    // Provenance: the non-weapon generators stamp WorldDrop (their
    // roaming home); a milestone drop's source is the Chamber's
    // boss-tier encounter, so the tag is restamped here — the
    // legendaries-by-source meters count milestone legendaries as
    // boss-sourced, which is what they are.
    if (drop) items.push({ ...drop, sourceTag: DropSource.BossDrop });
  }

  // Cache Surge (Scavenger action skill, 0030): extra rolls on a
  // victorious fired encounter through the shipped generator with
  // the surge rarity weights — ordinary Chamber drops with bent
  // odds, stored and metered like milestone drops. Nothing is minted
  // outside the drop pipeline.
  const surgeItems: GearItem[] = [];
  const surgePlan = request.actionSkillFire;
  if (victory && surgePlan?.tree === 'Scavenger' && (surgePlan.surgeRolls ?? 0) > 0) {
    for (let i = 0; i < (surgePlan.surgeRolls ?? 0); i++) {
      const surgeDrop = generateWeapon(
        {
          source: DropSource.BossDrop,
          level: encounter.level,
          bossTier: boss.tier,
          zoneWeights: surgePlan.surgeWeights,
        },
        rng,
      );
      surgeItems.push({ ...surgeDrop, sourceTag: DropSource.BossDrop });
    }
  }

  const projectedPhase = sim.projectedFailurePhase;
  let phaseFailed: string | undefined;
  let bossHpRemaining: number | undefined;
  if (!victory) {
    if (projectedPhase) phaseFailed = projectedPhase.phaseName;
    else if (sim.survivalScore < sim.breakScore && sim.survivalScore < sim.dpsScore) phaseFailed = 'survival';
    else if (sim.breakScore < sim.dpsScore) phaseFailed = 'break';
    else phaseFailed = 'dps';
    bossHpRemaining = Math.round((1 - rng() * 0.6) * 100);
  }

  const resultReasons = victory
    ? [
        projectedPhase?.currentAnswers[0]
          ? `Depth ${request.depth} cleared: ${projectedPhase.phaseName} cleared with ${projectedPhase.currentAnswers[0]}.`
          : `Depth ${request.depth} cleared: ${encounter.name} defeated.`,
        ...sim.reasons,
      ]
    : [
        projectedPhase
          ? `The run ends at depth ${request.depth}: Failed ${projectedPhase.phaseName}. ${projectedPhase.explanation}`
          : `The run ends at depth ${request.depth}: ${encounter.name} outlasted the hunter.`,
        ...sim.reasons,
      ];

  const maxDepth = levers?.endlessMaxDepth ?? 250;

  return {
    actionType: 'cc_apply_endless_encounter',
    encounter: {
      depth: encounter.depth,
      kind: encounter.kind,
      id: encounter.id,
      name: encounter.name,
      areaId: encounter.areaId,
      level: encounter.level,
      health: encounter.health,
      shield: encounter.shield,
      armor: encounter.armor,
      dps: encounter.dps,
      weaknesses: [...boss.weaknesses],
      resistances: [...boss.resistances],
      mechanicName: boss.mechanic.name,
    },
    result: {
      id: `endless_${request.playerId}_${request.runId}_${request.depth}`,
      depth: request.depth,
      bossId: encounter.id,
      victory,
      winChance: sim.winChance,
      phaseFailed,
      bossHpRemaining,
      reasons: Array.from(new Set(resultReasons)),
      recommendations: sim.recommendations,
      ...(request.actionSkillFire
        ? {
            actionSkill: {
              tree: request.actionSkillFire.tree,
              name: ACTION_SKILL_DEFS[request.actionSkillFire.tree].name,
              fired: true,
              ...(surgeItems.length > 0
                ? {
                    surgeRolls: request.actionSkillFire.surgeRolls ?? 0,
                    surgeLoot: surgeItems.map((item) => item.name),
                  }
                : {}),
              ...(request.actionSkillFire.qualityMultiplier !== undefined
                ? { qualityMultiplier: request.actionSkillFire.qualityMultiplier }
                : {}),
            },
          }
        : {}),
    },
    rewards,
    milestone,
    items,
    surgeItems,
    capReached: victory && request.depth >= maxDepth,
    telemetry: {
      serverRolled: true,
      adjustedWinChance,
      effectiveDps: serverGearEffectiveDps,
      timeToKill: sim.timeToKill,
    },
  };
}
