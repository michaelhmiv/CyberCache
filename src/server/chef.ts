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
import { generateWeapon } from '../lib/generators/weaponGenerator';
import { generateShield } from '../lib/generators/shieldGenerator';
import { generateClassMod } from '../lib/generators/classModGenerator';
import { generateRelic } from '../lib/generators/relicGenerator';
import { generateOrdnance } from '../lib/generators/ordnanceGenerator';
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
import { DropSource } from '../types/game';
import {
  getBossConsumableUsage,
  getBossRiskModifiers,
  simulateBoss,
  type BossSimulationInput,
} from '../lib/simulation/bossSimulator';
import { applyBadDecisionBonus, applyLegendaryEffects, getInsuranceFraudRefundChance } from '../lib/legendaryEffects';
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
  /** Skill tree bonuses (Scavenger tree affects idle economy). */
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
   * Equipped gear IDs — enables future server-side re-derivation of
   * activity modifiers without a second DB round-trip.
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
    mitigation?: number;
  };
  /** @deprecated Slots removed — engine activates from inventory directly. */
  loadoutConsumables?: LoadoutConsumableSlots;
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
    scrapAwarded: number;
    xpAwarded: number;
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
}

export interface BossAttemptChefResult {
  actionType: 'cc_apply_boss_attempt';
  profile: Record<string, unknown>;
  result: BossAttemptResult;
  creditsDelta: number;
  xpAwarded: number;
  loot: GearItem[];
  items: GearItem[];
  consumedConsumables: Record<string, number>;
  extraLoot: boolean;
  bonusLootRolls: number;
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
const FRAGMENT_CHANCE = 0.03;
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

  // Skill bonuses are still client-supplied but the server re-derives
  // the DPS-relevant `dps` multiplier from equippedGear via
  // computeEffectiveDpsFromGear(). Other skill bonuses (offlineEarnings,
  // scrapYield, etc.) remain client-supplied for now — they only affect
  // economy rate, not combat outcomes, and the server profile is the
  // authoritative post-claim snapshot.
  const skillBonuses = request.skillBonuses ?? {};

  const area = getRoamingArea(areaId);
  const creditsPerTick = Math.round((area.idleCreditsPerMinute || 15) / 20);
  const scrapPerTick = Math.round((area.idleScrapPerMinute || 3) / 20);
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
  const activityXpMult = 1 + (effectiveActivityMods.xpBoostMod ?? 0);
  const activityRareDropBonus = effectiveActivityMods.rareDropChanceMod ?? 0;
  const activityFragmentBonus = effectiveActivityMods.cacheFragmentChance ?? 0;
  const activityMaterialBonus = effectiveActivityMods.materialFindChance ?? 0;

  const effectiveCreditsPerTick = Math.round(creditsPerTick * offlineMult * activityCreditsMult);
  const effectiveScrapPerTick = Math.round(scrapPerTick * scrapMult * activityScrapMult);
  const effectiveXpPerTick = Math.round(xpPerTick * activityXpMult);

  // Clamp ticks to maxTicks (foreground: 20; offline settlement: Infinity)
  const maxTicks = request.maxTicks ?? 20;
  const ticks = Math.max(1, Math.min(requestedTicks, maxTicks));

  let creditsAwarded = 0;
  let scrapAwarded = 0;
  let xpAwarded = 0;
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
    relic: (request.equippedGear ?? []).find((g) => 'affixes' in g && !('weaponType' in g) && !('damage' in g) && !('hp' in g)) ?? null,
    classMod: (request.equippedGear ?? []).find((g) => 'affixes' in g && !('weaponType' in g) && !('damage' in g) && !('hp' in g) && !('rechargeRate' in g)) ?? null,
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

  // --- Consumable engine initialization ---
  const consumableInventory = request.consumableInventory ?? {};
  const initialMedKitCount = consumableInventory['MedKit'] ?? 0;
  const masteryLevels = request.masteryLevels ?? {};
  let roamingState: RoamingConsumableState | undefined = request.roamingConsumableState;
  if (!roamingState) {
    // Activate ALL owned consumables from inventory (no slot gating).
    roamingState = activateFromInventory(consumableInventory, tickCount - ticks);
  }
  const consumedConsumables: Record<string, number> = {};
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
      const kind = rollAreaDropKind(area, rng);
      let gear: GearItem | undefined;

      switch (kind) {
        case 'weapon': {
          const opts = buildAreaWeaponDropOptions(area, playerLevel, rng);
          gear = generateWeapon(opts, rng);
          break;
        }
        case 'shield':
          gear = generateShield(playerLevel, rng);
          break;
        case 'classMod':
          gear = generateClassMod(playerLevel, rng);
          break;
        case 'relic':
          gear = generateRelic(playerLevel, rng);
          break;
        case 'ordnance':
          gear = generateOrdnance(playerLevel, rng);
          break;
      }

      if (gear) {
        generatedItems.push(gear);
        // Build a rich detail line: rarity, type, power, element, manufacturer
        const typeLabel = 'weaponType' in gear ? gear.weaponType : 'gear';
        const powerLabel = 'combatPower' in gear ? ` · ${gear.combatPower} Power` : '';
        const elemLabel = 'element' in gear ? ` · ${gear.element}` : '';
        const mfgLabel = 'manufacturer' in gear ? ` · ${gear.manufacturer}` : '';
        feedEvents.push({
          at: now - (ticks - 1 - tickIdx) * TICK_MS,
          tone: 'loot',
          label: gear.name,
          detail: `${gear.rarity} ${typeLabel}${powerLabel}${elemLabel}${mfgLabel}`,
          gear,
          areaId,
        });
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
        label: `+${effectiveCreditsPerTick}cr · +${effectiveScrapPerTick} scrap · +${effectiveXpPerTick} XP`,
        detail: `${area.enemyType} routed in ${area.name}.`,
        areaId,
        value: effectiveCreditsPerTick,
      });
    }

    // Every tick awards base resources (with idle mods + skill bonuses + activity mods + consumable mods)
    creditsAwarded += effectiveCreditsPerTick;
    scrapAwarded += Math.round(effectiveScrapPerTick * consumableMods.scrapYieldMultiplier);
    xpAwarded += Math.round(effectiveXpPerTick * consumableMods.xpMultiplier);

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

          if (kcTargetHp <= 0) {
            // Kill! Advance the cycle
            kcMonstersKilled += 1;
            kcTotalKills += 1;
            kcLastKilledId = kcTargetId;

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
        // Apply consumable damage reduction (Shield Cell resistance)
        const hunter: HunterSurvivalStats = {
          maxHp: survMaxHp,
          shieldHp: survShield,
          mitigation: Math.min(0.8, (request.survival?.mitigation ?? 0) + consumableMods.damageReductionPct),
        };
        const hit = computeMonsterDamageVsHunter(modifiedAttacker, hunter);
        if (!hit.missed) {
          survShield = Math.max(0, survShield - hit.shieldAbsorbed);

          // Med Kit buffer absorbs damage after shield, before HP
          let remainingHpDamage = hit.hpDamage;
          if (roamingState) {
            const survState = getSurvivalState(roamingState);
            if (survState.medKitBuffer > 0 && remainingHpDamage > 0) {
              const absorbed = Math.min(survState.medKitBuffer, remainingHpDamage);
              remainingHpDamage -= absorbed;
              // Update buffer in roaming state
              const medKitSlot = roamingState.slots.find(
                (s) => s.consumableId === 'MedKit' || s.consumableId === 'MedKitRefined'
              );
              if (medKitSlot) medKitSlot.remainingBuffer -= absorbed;
            }
          }

          survHp = Math.max(0, survHp - remainingHpDamage);
          if (survHp <= 0) {
            survDead = true;
          }
        }
      }
    }
  }

  // Compute MedKit consumption from buffer absorption (flat stacking model).
  // Each 150 HP of buffer absorbed = 1 medkit consumed.
  if (roamingState && initialMedKitCount > 0) {
    const medKitSlot = roamingState.slots.find(
      (s) => s.consumableId === 'MedKit' || s.consumableId === 'MedKitRefined'
    );
    if (medKitSlot) {
      const remainingFull = Math.floor(Math.max(0, medKitSlot.remainingBuffer) / 150);
      const consumed = initialMedKitCount - remainingFull;
      if (consumed > 0) {
        consumedConsumables['MedKit'] = (consumedConsumables['MedKit'] ?? 0) + consumed;
      }
    }
  }

  return {
    actionType: 'cc_claim_roaming_rewards',
    profile: {}, // populated by Supabase RPC
    rewards: {
      ticks,
      creditsAwarded,
      scrapAwarded,
      xpAwarded,
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

export function processBossAttempt(request: BossAttemptRequest): BossAttemptChefResult {
  const boss = REGION_1_BOSSES.find((entry) => entry.id === request.bossId);
  if (!boss) throw new Error(`Unknown boss: ${request.bossId}`);

  const input: BossSimulationInput = { ...request, boss };
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
  const creditsDelta = applyBadDecisionBonus(rawCreditsDelta, request.primary);

  let xpMult = 1;
  request.relic?.affixes.forEach((affix) => {
    if (affix.stat === 'xpBoostMod') xpMult += affix.value;
  });
  const xpAwarded = victory ? Math.round(boss.level * 20 * xpMult) : 0;

  const consumedConsumables = getBossConsumableUsage(request.consumables, victory, sim.survivalScore);
  const refundChance = getInsuranceFraudRefundChance(request.primary);
  if (refundChance > 0) {
    Object.keys(consumedConsumables).forEach((type) => {
      if (rng() < refundChance) delete consumedConsumables[type];
    });
  }

  const loot: GearItem[] = [];
  let unlockedBossId: string | undefined;
  if (victory) {
    const currentIndex = REGION_1_BOSSES.findIndex((entry) => entry.id === boss.id);
    unlockedBossId = REGION_1_BOSSES[currentIndex + 1]?.id;
    const guaranteedRolls = 1;
    const baseBonusRolls = rng() < 0.3 ? 1 : 0;
    const totalRolls = guaranteedRolls + baseBonusRolls + bonusLootRolls;
    for (let i = 0; i < totalRolls; i++) {
      loot.push(generateWeapon({ source: DropSource.BossDrop, level: boss.level, bossTier: boss.tier }, rng));
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
    creditsGained: victory ? Math.max(0, creditsDelta) : 0,
    creditsLost: victory ? 0 : deathFee,
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
    loot,
    items: loot,
    consumedConsumables,
    extraLoot: bonusLootRolls > 0,
    bonusLootRolls,
    unlockedBossId,
    telemetry: {
      serverRolled: true,
      adjustedWinChance,
      effectiveDps: sim.effectiveDPS,
      timeToKill: sim.timeToKill,
    },
  };
}
