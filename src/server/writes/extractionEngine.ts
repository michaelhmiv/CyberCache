/**
 * extractionEngine — the in-memory twin of migration 0033's SQL
 * (extraction_state + cc_settle_extraction_time + cc_apply_extraction),
 * shared by the two in-memory stores exactly as craftEngine.ts is:
 * the gameplay memory store settles/reads through it, and the writes
 * memory store runs the transition accrual hook + start gates
 * through it. The Pg stores run the SQL; behavior parity between
 * this file and 0033 is pinned by the extraction tests + the slice's
 * embedded-Postgres harness.
 *
 * The split the brief fixes: ACCRUAL is pure time accounting (fold
 * the settlement window into completed passes, remembering each
 * pass's site/method terms), FINALIZATION prices and pays completed
 * passes (draws from the shipped pool, XP at the peg, mastery) —
 * priced at finalization from the player's CURRENT server records,
 * so gear swapped mid-pass reprices the unfinished pass.
 */
import { getRoamingArea } from '../../constants/roamingAreas';
import { createTickRng } from '../../lib/rng/tickRng';
import { skillBonusesFromRecords } from '../gameplay/serverLoadout';
import { cacheRankBonuses } from '../../content/cacheRank';
import {
  EXTRACTION_MASTERY_TRACK,
  EXTRACTION_MASTERY_XP_PER_PASS,
  EXTRACTION_PASS_MS,
  extractionGearFactor,
  extractionPassDraws,
  extractionPassXp,
  rollExtractionPass,
  type ExtractionLeverValues,
  type ExtractionMethod,
  type ExtractionShieldFacts,
} from '../../content/extraction';
import { earnedOfflineCapHours } from '../../content/offlineCap';
import type { EquippedItemEntry } from '../gameplay/store';
import type { GearItem, Shield } from '../../types/items';

/** A completed pass awaiting finalization, with the terms it started on. */
export interface PendingExtractionPass {
  index: number;
  areaId: string;
  method: ExtractionMethod;
}

/** extraction_state row mirror (migration 0033). */
export interface ExtractionStateRecord {
  user_id: string;
  /** Standing selection (adopts into the next pass at a boundary). */
  area_id: string;
  method: ExtractionMethod;
  /** Terms of the in-progress pass. */
  pass_area_id: string;
  pass_method: ExtractionMethod;
  /** Progress inside the in-progress pass, ms [0, EXTRACTION_PASS_MS). */
  accrued_ms: number;
  /** Completed passes not yet finalized, oldest first. */
  pending_passes: PendingExtractionPass[];
  /** Count of passes finalized (the next finalized index is +1). */
  finalized_passes: number;
  total_xp_awarded: number;
  /** Accrual anchor — every accrual rebases it, so paused or capped
   *  time can never be claimed later (the craft settler's rule). */
  last_settled_ms: number;
  created_ms: number;
  updated_ms: number;
}

export function newExtractionState(userId: string, nowMs: number, areaId: string, method: ExtractionMethod): ExtractionStateRecord {
  return {
    user_id: userId,
    area_id: areaId,
    method,
    pass_area_id: areaId,
    pass_method: method,
    accrued_ms: 0,
    pending_passes: [],
    finalized_passes: 0,
    total_xp_awarded: 0,
    last_settled_ms: nowMs,
    created_ms: nowMs,
    updated_ms: nowMs,
  };
}

/** Profile facts the engine reads — always the player's own records. */
export interface ExtractionProfileFacts {
  level: number;
  skillSpends: Record<string, number>;
  cacheRankSpends: Record<string, number>;
  /** {} (or empty) = alive; a non-empty record blocks extraction starts. */
  deathState: Record<string, unknown>;
  offlineCapHours: number | null;
  /** can_use_player_economy: verified, non-guest account. */
  verified: boolean;
}

export interface ExtractionAdapter {
  nowMs(): number;
  profile(playerId: string): ExtractionProfileFacts | null;
  activeAction(playerId: string): {
    kind: string;
    targetId: string | null;
    payload: Record<string, unknown>;
    lastHeartbeatMs: number | null;
    startedMs: number | null;
  } | null;
  equippedItems(playerId: string): EquippedItemEntry[];
  masteryLevel(playerId: string, track: string): number;
  addMasteryXp(playerId: string, track: string, xp: number): void;
  /** The player's Cache Rank Fast Learner XP fraction (0031),
   *  derived by the store from the player's own cache_rank_spends
   *  under the store's levers. Optional: adapters that predate the
   *  wiring read through cacheRankBonuses at default levers. */
  cacheRankXpBonus?(playerId: string): number;
  state(playerId: string): ExtractionStateRecord | null;
  saveState(playerId: string, state: ExtractionStateRecord): void;
  /** Apply player XP (level-ups included); returns the new level. */
  applyPlayerXp(playerId: string, xp: number): number;
  creditFinds(playerId: string, materials: Record<string, number>, essences: Record<string, number>): void;
  addStat(playerId: string, key: string, amount: number): void;
  /** Mirror of the cc_apply_extraction ledger row (metrics + tests). */
  recordSettle(playerId: string, payload: Record<string, unknown>): void;
}

/** The equipped shield's factor facts from server item records. */
export function extractionShieldFromItems(items: EquippedItemEntry[]): ExtractionShieldFacts | null {
  const entry = items.find((e) => e.slot === 'shield');
  if (!entry) return null;
  const shield = entry.item as Shield;
  if (!shield || typeof shield.hp !== 'number') return null;
  return {
    hp: shield.hp,
    mitigation: typeof shield.mitigation === 'number' ? shield.mitigation : 0,
    element: shield.element ?? null,
  };
}

/** The away cap the lazy settler applies (0024's internal formula,
 *  verbatim): min(earned tier, limiter when set), floored at 1h —
 *  WITHOUT the Scavenger keystone bonus (explicit offline settlement
 *  passes its cap in as maxAdvanceMs instead). */
export function extractionAwayCapMs(level: number, limiterHours: number | null): number {
  const earned = earnedOfflineCapHours(level);
  const limiter = limiterHours != null && limiterHours > 0 ? limiterHours : earned;
  return Math.max(1, Math.min(earned, limiter)) * 3_600_000;
}

/**
 * Accrue extraction time (cc_settle_extraction_time twin). Folds the
 * settlement window into the state: whole passes complete into
 * pending_passes ON THE TERMS THEY STARTED, and the in-progress pass
 * then adopts the standing selection. The anchor rebases on EVERY
 * call — time while extraction is not the active action, and time
 * past the away cap, is gone for good.
 */
export function accrueExtractionTime(
  adapter: ExtractionAdapter,
  playerId: string,
  opts: { maxAdvanceMs?: number | null } = {},
): { advancedMs: number; passesCompleted: number } {
  const state = adapter.state(playerId);
  if (!state) return { advancedMs: 0, passesCompleted: 0 };
  const now = adapter.nowMs();
  const action = adapter.activeAction(playerId);
  const startMs = state.last_settled_ms;
  const raw = Math.max(0, now - startMs);
  state.last_settled_ms = now;
  state.updated_ms = now;

  let advance = 0;
  if (action?.kind === 'extraction' && raw > 0) {
    if (opts.maxAdvanceMs != null) {
      advance = Math.min(raw, Math.max(0, opts.maxAdvanceMs));
    } else {
      const profile = adapter.profile(playerId);
      const heartbeatMs = action.lastHeartbeatMs ?? action.startedMs ?? startMs;
      const attended = Math.min(raw, Math.max(0, heartbeatMs + 300_000 - startMs));
      const awayCap = extractionAwayCapMs(profile?.level ?? 1, profile?.offlineCapHours ?? null);
      advance = attended + Math.min(raw - attended, awayCap);
    }
  }

  let passesCompleted = 0;
  if (advance > 0) {
    state.accrued_ms += advance;
    while (state.accrued_ms >= EXTRACTION_PASS_MS) {
      state.accrued_ms -= EXTRACTION_PASS_MS;
      state.pending_passes.push({
        index: state.finalized_passes + state.pending_passes.length + 1,
        areaId: state.pass_area_id,
        method: state.pass_method,
      });
      passesCompleted += 1;
      // The next pass adopts the standing selection.
      state.pass_area_id = state.area_id;
      state.pass_method = state.method;
    }
  }
  adapter.saveState(playerId, state);
  return { advancedMs: advance, passesCompleted };
}

/** Sync the standing selection from a recorded extraction action
 *  (cc_set_active_action's 0033 hook twin): creates the state row on
 *  first start; the in-progress pass keeps its starting terms. */
export function syncExtractionSelection(
  adapter: ExtractionAdapter,
  playerId: string,
  areaId: string,
  method: ExtractionMethod,
): ExtractionStateRecord {
  const now = adapter.nowMs();
  const existing = adapter.state(playerId);
  if (!existing) {
    const created = newExtractionState(playerId, now, areaId, method);
    adapter.saveState(playerId, created);
    return created;
  }
  existing.area_id = areaId;
  existing.method = method;
  existing.updated_ms = now;
  adapter.saveState(playerId, existing);
  return existing;
}

/** The start gates (0033's cc_set_active_action hook twin). Throws
 *  with the SQL twin's messages. */
export function assertExtractionStartAllowed(
  adapter: ExtractionAdapter,
  playerId: string,
  areaId: string,
  method: ExtractionMethod,
): void {
  const profile = adapter.profile(playerId);
  if (!profile) throw new Error('Profile not found');
  if (!profile.verified) throw new Error('Verified account required');
  if (profile.deathState && Object.keys(profile.deathState).length > 0) {
    throw new Error('Character is dead — resurrect before extracting');
  }
  const area = getRoamingArea(areaId);
  if (area.id !== areaId) throw new Error('Unknown extraction area');
  if (profile.level < area.unlockLevel) throw new Error('Area locked for this hunter level');
  if (method === 'deep' && adapter.masteryLevel(playerId, EXTRACTION_MASTERY_TRACK) < 5) {
    throw new Error('Deep Delve requires Extraction mastery 5');
  }
}

export interface ExtractionPassResult {
  index: number;
  areaId: string;
  method: ExtractionMethod;
  draws: number;
  gearFactor: number;
  deepDegraded: boolean;
  xpAwarded: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
  signatureUnits: number;
}

export interface ExtractionSettleResult {
  passes: ExtractionPassResult[];
  xpAwarded: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
  advancedMs: number;
}

/**
 * Finalize every pending pass, oldest first (cc_apply_extraction
 * twin). Each pass prices from the records as they stand WHEN IT
 * FINALIZES: level and mastery are re-read per pass (a batch that
 * levels the player reprices its later passes, exactly like craft
 * units), the gear factor uses the CURRENT loadout, and Cache Rank's
 * Fast Learner multiplies each pass's XP exactly once
 * (round(xp x (1 + fraction)) — the 0031 composition).
 */
export function finalizeExtractionPasses(
  adapter: ExtractionAdapter,
  playerId: string,
  levers: ExtractionLeverValues,
  facts: { isHot: (areaId: string) => boolean; hotAreaMaterialBonus: number },
): ExtractionSettleResult {
  const state = adapter.state(playerId);
  const result: ExtractionSettleResult = { passes: [], xpAwarded: 0, materials: {}, essences: {}, advancedMs: 0 };
  if (!state || state.pending_passes.length === 0) return result;
  const profile = adapter.profile(playerId);
  if (!profile) return result;

  const pending = [...state.pending_passes];
  for (const pass of pending) {
    const fresh = adapter.profile(playerId) ?? profile;
    const items = adapter.equippedItems(playerId);
    const gear = items.map((e) => e.item as GearItem);
    const skillBonuses = skillBonusesFromRecords(gear, fresh.skillSpends);
    const lootQuantity = Math.max(0, skillBonuses.lootQuantity ?? 0);
    const masteryLevel = adapter.masteryLevel(playerId, EXTRACTION_MASTERY_TRACK);
    const area = getRoamingArea(pass.areaId);
    const shield = extractionShieldFromItems(items);
    const gearFactor = extractionGearFactor({ level: fresh.level, shield, area, levers });
    const math = extractionPassDraws({
      method: pass.method,
      masteryLevel,
      gearFactor,
      isHot: facts.isHot(pass.areaId),
      levers,
      hotAreaMaterialBonus: facts.hotAreaMaterialBonus,
    });
    const finds = rollExtractionPass(
      area,
      math.draws,
      {
        main: createTickRng(playerId, 'extract', pass.index),
        signature: createTickRng(playerId, 'extract:signature', pass.index),
        lootQuantity: createTickRng(playerId, 'extract:loot', pass.index),
      },
      levers,
      lootQuantity,
    );
    const cacheRankXp = adapter.cacheRankXpBonus
      ? adapter.cacheRankXpBonus(playerId)
      : cacheRankBonuses(fresh.cacheRankSpends).xp;
    const xpAwarded = Math.round(extractionPassXp(fresh.level, levers) * (1 + cacheRankXp));

    adapter.creditFinds(playerId, finds.materials, finds.essences);
    if (xpAwarded > 0) adapter.applyPlayerXp(playerId, xpAwarded);
    adapter.addMasteryXp(playerId, EXTRACTION_MASTERY_TRACK, EXTRACTION_MASTERY_XP_PER_PASS);
    adapter.addStat(playerId, 'extraction_passes', 1);

    state.finalized_passes += 1;
    state.total_xp_awarded += xpAwarded;
    state.pending_passes = state.pending_passes.filter((p) => p.index !== pass.index);

    for (const [k, v] of Object.entries(finds.materials)) result.materials[k] = (result.materials[k] ?? 0) + v;
    for (const [k, v] of Object.entries(finds.essences)) result.essences[k] = (result.essences[k] ?? 0) + v;
    result.xpAwarded += xpAwarded;
    result.passes.push({
      index: pass.index,
      areaId: pass.areaId,
      method: pass.method,
      draws: math.draws,
      gearFactor,
      deepDegraded: math.deepDegraded,
      xpAwarded,
      materials: finds.materials,
      essences: finds.essences,
      signatureUnits: finds.signatureUnits,
    });
  }
  state.updated_ms = adapter.nowMs();
  adapter.saveState(playerId, state);

  if (result.passes.length > 0) {
    adapter.recordSettle(playerId, {
      action_type: 'cc_apply_extraction',
      passes_completed: result.passes.length,
      xp_awarded: result.xpAwarded,
      finds_materials: result.materials,
      finds_essences: result.essences,
      passes: result.passes.map((p) => ({
        index: p.index, area_id: p.areaId, method: p.method, draws: p.draws,
        gear_factor: p.gearFactor, deep_degraded: p.deepDegraded, xp: p.xpAwarded,
        signature_units: p.signatureUnits,
      })),
    });
  }
  return result;
}

/** Accrue + finalize — the standard settle entry point. */
export function settleExtraction(
  adapter: ExtractionAdapter,
  playerId: string,
  levers: ExtractionLeverValues,
  facts: { isHot: (areaId: string) => boolean; hotAreaMaterialBonus: number; maxAdvanceMs?: number | null },
): ExtractionSettleResult {
  const accrued = accrueExtractionTime(adapter, playerId, { maxAdvanceMs: facts.maxAdvanceMs ?? null });
  const settled = finalizeExtractionPasses(adapter, playerId, levers, facts);
  settled.advancedMs = accrued.advancedMs;
  return settled;
}
