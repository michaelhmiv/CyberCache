/**
 * InMemoryChefGameplayStore — the test double behind ChefGameplayStore.
 *
 * Mirrors the observable semantics of the five Chef gameplay appliers
 * (db/migrations/0007_chef_gameplay_appliers.sql) and cc_recycle_item
 * (db/migrations/0004_write_apis.sql) the way the B2/B3 in-memory
 * stores mirror their SQL: same ledger keys, same replay behavior,
 * same profile mutations, same result payloads, same error messages.
 * The one deliberate simplification is consumable batches: the boss
 * applier tracks quality batches behind the profiles.consumables
 * totals (cc_add_consumable_batch / cc_consume_consumable_batch); the
 * routes only ever observe the totals and the profile snapshot, so
 * this double tracks the totals and returns an empty consumed_batches
 * list.
 *
 * State (profiles, items, ledger) is plain data so tests can seed and
 * inspect it directly. The clock is injectable so offline settlement
 * can be exercised at exact elapsed times.
 */
import { randomUUID } from 'node:crypto';
import { applyXp, computeItemEstimatedValue, salvageScrap, type Json } from '../writes/store';
import {
  GameplayStoreError,
  type ActiveActionRow,
  type BossProfileRow,
  type ChefBossAttemptInput,
  type ChefGameplayStore,
  type ChefRewardsInput,
  type RoamingProfileRow,
  type SettlementProfileRow,
} from './store';

export interface InMemoryProfile {
  id: string;
  player_level: number;
  player_xp: number;
  credits: number;
  scrap: number;
  cache_tokens: number;
  cache_token_parts: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
  consumables: Record<string, number>;
  skill_spends: Json;
  boss_state: Record<string, unknown>;
  last_idle_claim_at: string | null;
  last_claimed_tick: number;
  last_roaming_settled_at: string | null;
  last_settlement_nonce: string | null;
  offline_cap_hours: number | null;
  [key: string]: unknown;
}

export interface InMemoryItem {
  id: string;
  owner_user_id: string;
  kind: string;
  runtime_state: string;
  is_locked: boolean;
  rarity: string | null;
  item_level: number;
  estimated_value: number;
  supply_mode: string;
  tradeable: boolean;
  equipped_slot: string | null;
  payload: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InMemoryActiveAction {
  user_id: string;
  active_action: string;
  target_id: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  activity_payload: Record<string, unknown>;
}

export interface ConsumableEvent {
  user_id: string;
  consumable_type: string;
  quantity_delta: number;
  event_type: string;
  activity_type: string;
  reason: string;
}

const TICK_MS = 3000;

function asRecord(value: unknown): Record<string, number> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = Math.trunc(Number(v) || 0);
    return out;
  }
  return {};
}

/** Item kind derivation — cc_store_chef_items' payload-key cascade. */
function itemKind(payload: Record<string, unknown>): string {
  if ('weaponType' in payload) return 'weapon';
  if ('mitigation' in payload) return 'shield';
  if ('treeBonus' in payload) return 'classMod';
  if ('damage' in payload) return 'ordnance';
  if ('affixes' in payload) return 'relic';
  return 'gear';
}

export class InMemoryChefGameplayStore implements ChefGameplayStore {
  readonly profiles = new Map<string, InMemoryProfile>();
  readonly items = new Map<string, InMemoryItem>();
  readonly activeActions = new Map<string, InMemoryActiveAction>();
  readonly ledger = new Map<string, Json>();
  readonly consumableEvents: ConsumableEvent[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Test helper: insert a profile row with June defaults. */
  seedProfile(overrides: Partial<InMemoryProfile> & { id: string }): InMemoryProfile {
    const profile: InMemoryProfile = {
      player_level: 1,
      player_xp: 0,
      credits: 0,
      scrap: 0,
      cache_tokens: 0,
      cache_token_parts: 0,
      materials: {},
      essences: {},
      consumables: {},
      skill_spends: {},
      boss_state: {},
      last_idle_claim_at: null,
      last_claimed_tick: 0,
      last_roaming_settled_at: null,
      last_settlement_nonce: null,
      offline_cap_hours: null,
      ...overrides,
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  /** Test helper: insert an item instance. */
  seedItem(overrides: Partial<InMemoryItem> & { id: string; owner_user_id: string }): InMemoryItem {
    const item: InMemoryItem = {
      kind: 'weapon',
      runtime_state: 'available',
      is_locked: false,
      rarity: 'Common',
      item_level: 1,
      estimated_value: 0,
      supply_mode: 'verified_action',
      tradeable: true,
      equipped_slot: null,
      payload: {},
      ...overrides,
    };
    this.items.set(item.id, item);
    return item;
  }

  /** Test helper: set the player's active action row. */
  seedActiveAction(action: InMemoryActiveAction): InMemoryActiveAction {
    this.activeActions.set(action.user_id, action);
    return action;
  }

  /** cc_profile_snapshot's key set (final June definition, ported in 0004). */
  private snapshot(p: InMemoryProfile): Json {
    return {
      id: p.id,
      player_level: p.player_level,
      player_xp: p.player_xp,
      credits: p.credits,
      scrap: p.scrap,
      cache_tokens: p.cache_tokens,
      cache_token_parts: p.cache_token_parts,
      materials: { ...p.materials },
      essences: { ...p.essences },
      consumables: { ...p.consumables },
      consumable_batches: [],
      skill_spends: p.skill_spends,
      boss_state: JSON.parse(JSON.stringify(p.boss_state)) as Json,
      last_idle_claim_at: p.last_idle_claim_at,
    };
  }

  private requireProfile(playerId: string): InMemoryProfile {
    const profile = this.profiles.get(playerId);
    if (!profile) throw new GameplayStoreError('Profile not found');
    return profile;
  }

  /**
   * The reward application shared by cc_apply_chef_rewards and
   * cc_settle_offline_roaming: XP curve, raw credit/scrap adds,
   * material/essence merges, and the 5-fragments-to-1-token roll-up.
   * Returns the SQL functions' rewards echo.
   */
  private applyRewardBundle(p: InMemoryProfile, rewards: ChefRewardsInput): Json {
    const leveled = applyXp(p.player_level, p.player_xp, rewards.xp);
    p.player_level = leveled.player_level;
    p.player_xp = leveled.player_xp;
    p.credits += Math.trunc(rewards.credits);
    p.scrap += Math.trunc(rewards.scrap);
    for (const [k, v] of Object.entries(asRecord(rewards.materials))) p.materials[k] = (p.materials[k] ?? 0) + v;
    for (const [k, v] of Object.entries(asRecord(rewards.essences))) p.essences[k] = (p.essences[k] ?? 0) + v;
    let parts = p.cache_token_parts + Math.trunc(rewards.fragments);
    let tokens = p.cache_tokens;
    while (parts >= 5) {
      parts -= 5;
      tokens += 1;
    }
    p.cache_token_parts = parts;
    p.cache_tokens = tokens;
    return {
      credits_awarded: Math.trunc(rewards.credits),
      scrap_awarded: Math.trunc(rewards.scrap),
      xp_awarded: Math.trunc(rewards.xp),
      cache_fragments_awarded: Math.trunc(rewards.fragments),
      materials: rewards.materials,
      essences: rewards.essences,
      kills_recorded: Math.trunc(rewards.kills),
    };
  }

  async getRoamingProfile(playerId: string): Promise<RoamingProfileRow | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    return { last_claimed_tick: p.last_claimed_tick, consumables: { ...p.consumables } };
  }

  async getBossProfile(playerId: string): Promise<BossProfileRow | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    return {
      player_level: p.player_level,
      credits: p.credits,
      consumables: { ...p.consumables },
      boss_state: JSON.parse(JSON.stringify(p.boss_state)) as Json,
    };
  }

  async getSettlementProfile(playerId: string): Promise<SettlementProfileRow | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    return {
      player_level: p.player_level,
      consumables: { ...p.consumables },
      last_claimed_tick: p.last_claimed_tick,
      last_roaming_settled_at: p.last_roaming_settled_at,
      last_settlement_nonce: p.last_settlement_nonce,
      offline_cap_hours: p.offline_cap_hours,
    };
  }

  async getActiveAction(playerId: string): Promise<ActiveActionRow | null> {
    const a = this.activeActions.get(playerId);
    if (!a) return null;
    return { ...a, activity_payload: { ...a.activity_payload } };
  }

  async applyChefRewards(
    playerId: string,
    rewards: ChefRewardsInput,
    tickCount: number,
    _areaId: string,
  ): Promise<Json> {
    const p = this.requireProfile(playerId);
    const nonceKey = `${playerId}:chef:${tickCount}`;
    const prior = this.ledger.get(nonceKey);
    if (prior) return prior;
    if (tickCount <= p.last_claimed_tick) {
      throw new GameplayStoreError(
        `tick_count ${tickCount} is not after last claimed tick ${p.last_claimed_tick}`,
      );
    }
    const echo = this.applyRewardBundle(p, rewards);
    p.last_claimed_tick = tickCount;
    p.last_roaming_settled_at = this.now().toISOString();

    const action = this.activeActions.get(playerId);
    if (action) {
      action.last_heartbeat_at = this.now().toISOString();
      action.activity_payload = {
        ...action.activity_payload,
        last_claim_ticks: 1,
        last_claim_at: this.now().getTime(),
      };
    }

    const result: Json = {
      action_type: 'cc_apply_chef_rewards',
      profile: this.snapshot(p),
      rewards: echo,
    };
    this.ledger.set(nonceKey, result);
    return result;
  }

  async storeChefItems(playerId: string, items: unknown[]): Promise<Json> {
    let inserted = 0;
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const payload = { ...(raw as Record<string, unknown>) };
      const kind = itemKind(payload);
      const rarity = typeof payload.rarity === 'string' ? payload.rarity : null;
      const itemLevel = Math.trunc(Number(payload.level) || 1);
      const id = randomUUID();
      this.items.set(id, {
        id,
        owner_user_id: playerId,
        kind,
        runtime_state: 'available',
        is_locked: false,
        rarity,
        item_level: itemLevel,
        estimated_value: computeItemEstimatedValue(payload as Json, kind, rarity ?? '', itemLevel),
        supply_mode: 'verified_action',
        tradeable: true,
        equipped_slot: null,
        payload,
      });
      inserted += 1;
    }
    return { inserted };
  }

  async consumeRoamingConsumables(
    playerId: string,
    consumed: Json,
    areaId: string,
    tickCount: number,
  ): Promise<Json> {
    const p = this.profiles.get(playerId);
    if (!p) return { consumables: {} };
    const next = { ...p.consumables };
    for (const [itemKey, rawQty] of Object.entries(asRecord(consumed))) {
      if (rawQty <= 0) continue;
      const applied = Math.min(rawQty, Math.max(0, Math.trunc(next[itemKey] ?? 0)));
      if (applied <= 0) continue;
      next[itemKey] = Math.trunc(next[itemKey] ?? 0) - applied;
      this.consumableEvents.push({
        user_id: playerId,
        consumable_type: itemKey,
        quantity_delta: -applied,
        event_type: 'used',
        activity_type: 'roaming_loot',
        reason: `Consumed during roaming tick ${tickCount} in ${areaId}`,
      });
    }
    p.consumables = next;
    return { consumables: { ...next } };
  }

  async applyChefBossAttempt(playerId: string, attempt: ChefBossAttemptInput): Promise<Json> {
    const p = this.requireProfile(playerId);
    const nonceKey = `${playerId}:chef-boss:${attempt.bossId}:${attempt.attemptNonce}`;
    const prior = this.ledger.get(nonceKey);
    if (prior) return prior;

    const leveled = applyXp(p.player_level, p.player_xp, Math.max(0, Math.trunc(attempt.xp)));
    p.player_level = leveled.player_level;
    p.player_xp = leveled.player_xp;

    const nextConsumables = { ...p.consumables };
    for (const [itemKey, rawQty] of Object.entries(asRecord(attempt.consumables))) {
      const current = Math.trunc(nextConsumables[itemKey] ?? 0);
      if (current < rawQty) {
        throw new GameplayStoreError(`Insufficient consumable quantity for ${itemKey}`);
      }
      nextConsumables[itemKey] = Math.max(0, current - rawQty);
    }
    p.consumables = nextConsumables;

    const bossState = JSON.parse(JSON.stringify(p.boss_state)) as Record<string, unknown>;
    const defeated = Array.isArray(bossState.defeatedBossIds) ? [...(bossState.defeatedBossIds as string[])] : [];
    const unlocked = Array.isArray(bossState.unlockedBossIds)
      ? [...(bossState.unlockedBossIds as string[])]
      : ['dune_tyrant'];
    const pity = { ...((bossState.pityCounters as Record<string, number> | undefined) ?? {}) };
    if (attempt.victory) {
      if (!defeated.includes(attempt.bossId)) defeated.push(attempt.bossId);
      if (attempt.unlockedBossId && !unlocked.includes(attempt.unlockedBossId)) {
        unlocked.push(attempt.unlockedBossId);
      }
      pity[attempt.bossId] = 0;
    } else {
      pity[attempt.bossId] = (pity[attempt.bossId] ?? 0) + 1;
    }
    bossState.defeatedBossIds = defeated;
    bossState.unlockedBossIds = unlocked;
    bossState.pityCounters = pity;
    bossState.lastBossAttempt = attempt.attempt;
    p.boss_state = bossState;

    p.credits = Math.max(0, p.credits + Math.trunc(attempt.creditsDelta));

    const result: Json = {
      action_type: 'cc_apply_boss_attempt',
      profile: this.snapshot(p),
      boss_id: attempt.bossId,
      attempt: attempt.attempt,
      consumed_batches: [],
    };
    this.ledger.set(nonceKey, result);
    return result;
  }

  async settleOfflineRoaming(playerId: string, settlementNonce: string, rewards: ChefRewardsInput): Promise<Json> {
    if (!settlementNonce || settlementNonce.trim().length < 8) {
      throw new GameplayStoreError('settlement_nonce is required (min 8 chars)');
    }
    const nonceKey = `${playerId}:offline_settle:${settlementNonce}`;
    const prior = this.ledger.get(nonceKey);
    if (prior) return prior;

    const p = this.requireProfile(playerId);
    const action = this.activeActions.get(playerId);
    if (!action || action.active_action !== 'roaming_loot') {
      return { settled: false, reason: 'not_roaming', active_action: action?.active_action ?? 'none' };
    }
    const settleFrom = p.last_roaming_settled_at ?? action.started_at;
    if (!settleFrom) {
      return { settled: false, reason: 'no_elapsed', detail: 'No settlement start timestamp available' };
    }
    const nowTs = this.now();
    const rawElapsedMs = Math.max(0, nowTs.getTime() - new Date(settleFrom).getTime());
    const capMs = Math.floor(Math.max(0.25, p.offline_cap_hours ?? 2) * 3_600_000);
    const capReached = rawElapsedMs > capMs;
    const elapsedMs = Math.min(rawElapsedMs, capMs);
    const ticksRequested = Math.floor(elapsedMs / TICK_MS);
    if (ticksRequested <= 0) {
      return { settled: false, reason: 'no_elapsed', elapsed_ms: elapsedMs };
    }

    const newTickCount = p.last_claimed_tick + ticksRequested;
    const echo = this.applyRewardBundle(p, rewards);
    p.last_claimed_tick = newTickCount;
    p.last_roaming_settled_at = nowTs.toISOString();
    p.last_settlement_nonce = settlementNonce;

    action.last_heartbeat_at = nowTs.toISOString();
    action.activity_payload = {
      ...action.activity_payload,
      last_offline_settle_at: nowTs.getTime(),
      last_offline_settle_ticks: ticksRequested,
    };

    const result: Json = {
      settled: true,
      atomic: true,
      area_id: action.target_id,
      settle_from: new Date(settleFrom).toISOString(),
      settled_at: nowTs.toISOString(),
      raw_elapsed_ms: rawElapsedMs,
      elapsed_ms: elapsedMs,
      capped_ms: capMs,
      cap_reached: capReached,
      cap_hours: p.offline_cap_hours ?? 2,
      ticks_requested: ticksRequested,
      ticks_settled: ticksRequested,
      new_tick_count: newTickCount,
      start_tick: newTickCount - ticksRequested,
      end_tick: newTickCount,
      profile: this.snapshot(p),
      rewards: { ...echo, ticks: ticksRequested },
    };
    this.ledger.set(nonceKey, result);
    return result;
  }

  async recycleItem(playerId: string, nonce: string, itemId: string): Promise<Json> {
    if (!nonce || nonce.trim().length < 8) {
      throw new GameplayStoreError('nonce is required');
    }
    const prior = this.ledger.get(nonce);
    if (prior) return prior;
    const p = this.profiles.get(playerId);
    const item = this.items.get(itemId);
    if (!p || !item || item.owner_user_id !== playerId) {
      throw new GameplayStoreError('Item not found');
    }
    if (item.is_locked) throw new GameplayStoreError('Locked item');
    if (!['available', 'equipped'].includes(item.runtime_state)) {
      throw new GameplayStoreError('Item state invalid');
    }
    const award = salvageScrap(item.rarity ?? '', item.item_level);
    item.runtime_state = 'consumed';
    item.tradeable = false;
    item.equipped_slot = null;
    p.scrap += award;
    const result: Json = {
      action_type: 'cc_recycle_item',
      profile: this.snapshot(p),
      item: {
        id: item.id,
        owner_user_id: item.owner_user_id,
        kind: item.kind,
        runtime_state: item.runtime_state,
        is_locked: item.is_locked,
        rarity: item.rarity,
        item_level: item.item_level,
        payload: item.payload,
      },
      scrap_award: award,
      loadout: null,
    };
    this.ledger.set(nonce, result);
    return result;
  }
}
