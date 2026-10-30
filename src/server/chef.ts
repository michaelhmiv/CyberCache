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
import {
  getRoamingArea,
  rollAreaDropKind,
  rollAreaMaterialFind,
  buildAreaWeaponDropOptions,
} from '../constants/roamingAreas';
import type { GearItem } from '../types/items';
import { REGION_1_BOSSES } from '../constants/bosses';
import { sumActivityModifier } from '../lib/stats/activityModifiers';
import type { ActivityKind } from '../types/activity';
import { DropSource, Rarity } from '../types/game';
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
  /** Prior roaming consumable state (carried from previous claim). */
  roamingConsumableState?: RoamingConsumableState;
  /** Mastery levels for interval reductions. */
  masteryLevels?: Record<string, number>;
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
  items: GearItem[];
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
    medKitBuffer: number;
    nanoSwarmTicksRemaining: number;
    adrenalineActive: boolean;
    shieldCellResistance: number;
  };
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
const GEAR_THRESHOLD = 0.22;
/**
 * Cache-key fragment faucet: chance per roaming tick (before activity
 * bonuses). Pacing-baseline tuning (lifecycle evaluation): 0.03 → 0.008 —
 * the launch rate minted ~7 keys/hour of roaming; fragments now trickle
 * at ~2 keys/hour while the jackpot legendary's guaranteed fragment and
 * the 5-fragments-per-key conversion are unchanged. Chest odds (the
 * 60/32/8 displayed to players) are a separate table and do not move.
 */
export const FRAGMENT_CHANCE = 0.008;
const MATERIAL_CHANCE = 0.08;

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
        !('treeBonus' in g),
    ) ?? null;
  const slotShield =
    (equippedGear ?? []).find((g): g is import('../types/items').Shield => 'mitigation' in g) ?? null;
  // Shield mitigation, re-derived server-side from the equipped shield
  // — the same value the mechanics snapshot displays. The claim body
  // carries no mitigation (the ticker never sent one, so roaming
  // mitigation was always 0 while the snapshot advertised it).
  const serverMitigation = slotShield?.mitigation ?? 0;

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

  const effectiveCreditsPerTick = creditsPerTick * offlineMult * activityCreditsMult;
  const effectiveScrapPerTick = scrapPerTick * scrapMult * activityScrapMult * legendaryScrapMult;
  // XP likewise (0010): rates like 1.2/tick used to round down to 1.
  const effectiveXpPerTick = xpPerTick * activityXpMult;

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
  const generatedItems: GearItem[] = [];
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
    skillDpsMult: 1 + (request.skillBonuses?.dps ?? 0),
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

  // --- Consumable engine initialization ---
  const consumableInventory = request.consumableInventory ?? {};
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
    roamingState = activateFromInventory(consumableInventory, tickCount - ticks);
  }
  const consumedConsumables: Record<string, number> = {};

  // Generate one area gear drop (drop-kind roll + shared generators).
  // Used by the primary loot roll and by Data Skimmer's extra roll.
  const rollGearDrop = (dropRng: () => number): GearItem | undefined => {
    const kind = rollAreaDropKind(area, dropRng);
    switch (kind) {
      case 'weapon':
        return generateWeapon(buildAreaWeaponDropOptions(area, playerLevel, dropRng), dropRng);
      case 'shield':
        return generateShield(playerLevel, dropRng);
      case 'classMod':
        return generateClassMod(playerLevel, dropRng);
      case 'relic':
        return generateRelic(playerLevel, dropRng);
      case 'ordnance':
        return generateOrdnance(playerLevel, dropRng);
      default:
        return undefined;
    }
  };

  // Rich detail line for a gear drop: rarity, type, power, element, manufacturer.
  const gearFeedDetail = (gear: GearItem): string => {
    const typeLabel = 'weaponType' in gear ? gear.weaponType : 'gear';
    const powerLabel = 'combatPower' in gear ? ` · ${gear.combatPower} Power` : '';
    const elemLabel = 'element' in gear ? ` · ${gear.element}` : '';
    const mfgLabel = 'manufacturer' in gear ? ` · ${gear.manufacturer}` : '';
    return `${gear.rarity} ${typeLabel}${powerLabel}${elemLabel}${mfgLabel}`;
  };

  // Import emptyMods lazily to avoid circular deps in client imports
  let consumableMods = {
    dpsMultiplier: 1, damageReductionPct: 0, bonusLootChance: 0,
    extraLootRollChance: 0, scrapYieldMultiplier: 1, rareDropChanceMod: 0,
    eventChanceBonus: 0, enemyPressureMultiplier: 1, xpMultiplier: 1,
    incomingDpsMultiplier: 1, incomingAccuracyMultiplier: 1, ordnanceBonusDps: 0,
  };

  for (let tickIdx = 0; tickIdx < ticks; tickIdx++) {
    // Deterministic RNG — same tuple, same stream as the client preview
    const rng = createTickRng(playerId, areaId, tickCount - ticks + tickIdx + 1);

    // --- Consumable engine tick ---
    if (roamingState) {
      const currentTickIndex = tickCount - ticks + tickIdx;
      const tickResult = processTick(roamingState, {
        tickIndex: currentTickIndex,
        currentHp: survHp,
        maxHp: survMaxHp,
        inventory: consumableInventory,
        masteryLevels,
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

    // Single cumulative roll (Phase 1a: no if/else-if probability distortion).
    // rareDropChance mod increases the gear threshold linearly.
    // Activity modifiers add on top: rareDropChanceMod + materialFindChance.
    // Consumable mods add: bonusLootChance (Luck Booster) + rareDropChanceMod.
    const gearChance = clampChance(
      GEAR_THRESHOLD * (1 + totalRareDropMod + activityRareDropBonus + consumableMods.rareDropChanceMod)
      + consumableMods.bonusLootChance
    );
    const fragmentChance = Math.max(0, FRAGMENT_CHANCE * (1 + activityFragmentBonus));
    const materialChance = Math.max(0, MATERIAL_CHANCE * (1 + activityMaterialBonus));
    const gearThreshold = gearChance;
    const fragmentThreshold = Math.min(0.99, gearThreshold + fragmentChance);
    const materialThreshold = Math.min(0.99, fragmentThreshold + materialChance);
    const roll = rng();

    if (roll < gearThreshold) {
      // Gear drop — generate the actual item server-side
      const gear = rollGearDrop(rng);

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
          const bonusGear = rollGearDrop(rng);
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
      fragmentsAwarded++;
      feedEvents.push({
        at: now - (ticks - 1 - tickIdx) * TICK_MS,
        tone: 'fragment',
        label: '+1 cache fragment',
        detail: `${area.enemyType} patrol yielded a cache key fragment.`,
        areaId,
        value: 1,
      });
    } else if (roll < materialThreshold) {
      const find = rollAreaMaterialFind(area, rng);
      if (find) {
        if (find.kind === 'material') {
          materials[find.type] = (materials[find.type] || 0) + 1;
        } else {
          essences[find.type] = (essences[find.type] || 0) + 1;
        }
        feedEvents.push({
          at: now - (ticks - 1 - tickIdx) * TICK_MS,
          tone: find.kind === 'material' ? 'material' : 'essence',
          label: `+1 ${find.type}`,
          detail: `Field sweep recovered ${find.type}.`,
          areaId,
          value: 1,
        });
      }
    } else {
      // Kill — base rewards. Show the actual per-tick amounts.
      killsRecorded++;
      feedEvents.push({
        at: now - (ticks - 1 - tickIdx) * TICK_MS,
        tone: 'kill',
        label: `+${parseFloat(effectiveCreditsPerTick.toFixed(2))}cr · +${parseFloat(effectiveScrapPerTick.toFixed(2))} scrap · +${parseFloat(effectiveXpPerTick.toFixed(2))} XP`,
        detail: `${area.enemyType} routed in ${area.name}.`,
        areaId,
        value: effectiveCreditsPerTick,
      });
    }

    // Every tick awards base resources (with idle mods + skill bonuses + activity mods + consumable mods)
    creditsFraction += effectiveCreditsPerTick;
    scrapFraction += effectiveScrapPerTick * consumableMods.scrapYieldMultiplier;
    xpFraction += effectiveXpPerTick * consumableMods.xpMultiplier;

    // --- Kill cycle simulation (player → monster damage) ---
    const tickEffectiveDps = effectiveDps * consumableMods.dpsMultiplier + consumableMods.ordnanceBonusDps;
    if (!survDead && tickEffectiveDps > 0 && roster.length > 0) {
      // Spawn a target if none exists
      if (!kcTargetId) {
        const next = pickNextTarget(roster, kcLastKilledId);
        if (next) {
          kcTargetId = next.id;
          kcTargetHp = next.hp;
          kcTargetHpMax = next.hp;
        }
      }

      // Apply damage to current target
      if (kcTargetId) {
        const monster = roster.find((m) => m.id === kcTargetId);
        if (monster) {
          const dmg = computePlayerDamageVsMonster({ effectiveDps: tickEffectiveDps }, monster);
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

            const next = pickNextTarget(roster, kcLastKilledId);
            if (next) {
              kcTargetId = next.id;
              kcTargetHp = next.hp;
              kcTargetHpMax = next.hp;
            } else {
              kcTargetId = null;
              kcTargetHp = 0;
              kcTargetHpMax = 0;
            }
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
          ),
          accuracy: (attacker.accuracy ?? 0.85) * consumableMods.incomingAccuracyMultiplier,
        };
        // Mitigation comes from the equipped shield, re-derived
        // server-side above (serverMitigation) — never from the claim
        // body — plus consumable damage reduction (Shield Cell
        // resistance). This is the value the snapshot's Effective HP
        // math advertises; display and engine now agree.
        const hunter: HunterSurvivalStats = {
          maxHp: survMaxHp,
          shieldHp: survShield,
          mitigation: Math.min(0.8, serverMitigation + consumableMods.damageReductionPct),
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
      const perUnit = bufferHealPerUnit(slot.consumableId);
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
        medKitBuffer: ss?.medKitBuffer ?? 0,
        nanoSwarmTicksRemaining: ss?.nanoSwarmTicksRemaining ?? 0,
        adrenalineActive: ss?.adrenalineActive ?? false,
        shieldCellResistance: ss?.shieldCellResistance ?? 0,
      };
    })(),
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
  const rawCreditsDelta = victory ? Math.round(boss.level * 150 * legendary.creditMult) : -deathFee;
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
  const xpAwarded = victory ? Math.round(boss.level * 50 * xpMult) : 0;

  const consumedConsumables = getBossConsumableUsage(request.consumables, victory, sim.survivalScore);
  const refundChance = getInsuranceFraudRefundChance(request.primary);
  if (refundChance > 0) {
    Object.keys(consumedConsumables).forEach((type) => {
      if (rng() < refundChance) delete consumedConsumables[type];
    });
  }

  const loot: GearItem[] = [];
  let scrapAwarded = 0;
  let secondOpinionScrap: BossAttemptChefResult['secondOpinionScrap'] = null;
  let unlockedBossId: string | undefined;
  let dedicatedDropAwarded = false;
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
      if (i === 0 && dedicatedPool.length > 0 && rng() < BOSS_DEDICATED_DROP_CHANCE) {
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
      scrapAwarded = salvageScrap(scrapped.rarity, scrapped.level);
      secondOpinionScrap = {
        name: scrapped.name,
        rarity: scrapped.rarity,
        combatPower: scrapped.combatPower,
        scrapAwarded,
      };
      loot[0] = kept;
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
