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

import { SupabaseClient } from '@supabase/supabase-js';
import { createTickRng } from '../lib/rng/tickRng';
import { generateWeapon } from '../lib/generators/weaponGenerator';
import { generateShield } from '../lib/generators/shieldGenerator';
import { generateClassMod } from '../lib/generators/classModGenerator';
import { generateRelic } from '../lib/generators/relicGenerator';
import { generateOrdnance } from '../lib/generators/ordnanceGenerator';
import {
  ROAMING_AREAS,
  getRoamingArea,
  rollAreaDropKind,
  rollAreaMaterialFind,
  buildAreaWeaponDropOptions,
  type GearDropKind,
} from '../constants/roamingAreas';
import { DropSource } from '../types/game';
import type { GearItem } from '../types/items';

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
}

// --- Constants ---

const TICK_MS = 3000;
const DROP_CHANCE = 0.22;
const FRAGMENT_CHANCE = 0.03;
const MATERIAL_FIND_CHANCE = 0.08;
const GEAR_THRESHOLD = 0.22;
const FRAGMENT_THRESHOLD = 0.25; // 0.22 + 0.03
const MATERIAL_THRESHOLD = 0.33; // 0.22 + 0.03 + 0.08

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
  supabase: SupabaseClient,
): ClaimResult {
  const { playerId, areaId, ticks: requestedTicks, tickCount, playerLevel, idleMods, skillBonuses } = request;

  const area = getRoamingArea(areaId);
  const creditsPerTick = Math.round((area.idleCreditsPerMinute || 15) / 20);
  const scrapPerTick = Math.round((area.idleScrapPerMinute || 3) / 20);
  const xpPerTick = area.idleXpPerTick || 1.0;

  // Merge idle economy modifiers from gear + skill tree.
  const gearOfflineMult = 1 + (idleMods?.offlineEarningsMod ?? 0);
  const skillOfflineBonus = skillBonuses?.offlineEarnings || 0;
  const offlineMult = gearOfflineMult + skillOfflineBonus;

  const gearScrapMult = 1 + (idleMods?.scrapYieldMod ?? 0);
  const skillScrapBonus = skillBonuses?.scrapYield || 0;
  const scrapMult = gearScrapMult + skillScrapBonus;

  // rareDropChance from gear + skills (structural wiring — threshold adjustment deferred)
  const totalRareDropMod = (idleMods?.rareDropChanceMod ?? 0) + (skillBonuses?.rareDropChance || 0);

  const effectiveCreditsPerTick = Math.round(creditsPerTick * offlineMult);
  const effectiveScrapPerTick = Math.round(scrapPerTick * scrapMult);

  // Clamp ticks to prevent abuse
  const ticks = Math.max(1, Math.min(requestedTicks, 20));

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

  for (let tickIdx = 0; tickIdx < ticks; tickIdx++) {
    // Deterministic RNG — same tuple, same stream as the client preview
    const rng = createTickRng(playerId, areaId, tickCount - ticks + tickIdx + 1);

    // Single cumulative roll (Phase 1a: no if/else-if probability distortion).
    // rareDropChance mod increases the gear threshold linearly.
    const gearThreshold = GEAR_THRESHOLD * (1 + totalRareDropMod);
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
        feedEvents.push({
          at: now - (ticks - 1 - tickIdx) * TICK_MS,
          tone: 'loot',
          label: gear.name,
          detail: `${gear.rarity} ${'weaponType' in gear ? gear.weaponType : 'gear'}`,
          gear,
          areaId,
        });
      }
    } else if (roll < FRAGMENT_THRESHOLD) {
      fragmentsAwarded++;
      feedEvents.push({
        at: now - (ticks - 1 - tickIdx) * TICK_MS,
        tone: 'fragment',
        label: '+1 cache fragment',
        detail: `${area.enemyType} patrol yielded a cache key fragment.`,
        areaId,
        value: 1,
      });
    } else if (roll < MATERIAL_THRESHOLD) {
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
      // Kill — base rewards
      killsRecorded++;
      feedEvents.push({
        at: now - (ticks - 1 - tickIdx) * TICK_MS,
        tone: 'kill',
        label: 'Enemy swept',
        detail: `${area.enemyType} routed. Credits, scrap, and XP recovered.`,
        areaId,
      });
    }

    // Every tick awards base resources (with idle mods + skill bonuses applied)
    creditsAwarded += effectiveCreditsPerTick;
    scrapAwarded += effectiveScrapPerTick;
    xpAwarded += Math.round(xpPerTick);
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
  };
}
