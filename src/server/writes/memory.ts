/**
 * InMemoryWriteStore: test double for the B3 write surface.
 *
 * Mirrors the observable semantics of the SQL functions in
 * db/migrations/0004_write_apis.sql — validation order and error messages,
 * nonce replay from the verified-action ledger, ledger-trigger side
 * effects (stat counters / mastery XP / net worth), and result shapes.
 * Random outcomes use an injectable RNG; the real-Postgres harness is the
 * authority for SQL-exact behavior.
 */
import type { ProfileRowData } from '../reads/store.js';
import {
  MARKET_FEE_RATE,
  isFoundSource,
  marketFeeForSeller,
  type MarketFeeBreakdown,
} from '../../lib/market/marketFee.js';
import type { ClassModBoosts } from '../../lib/skills/skillBonuses.js';
import {
  applyXp,
  computeItemEstimatedValue,
  drawOdds,
  emptyWriteSeed,
  generateWeaponPayload,
  itemAcceptsSlot,
  masteryLevelForXp,
  newUuid,
  recipeMaterials,
  recipeQualityBounds,
  salvageScrap,
  skillSpendTotal,
  validateUsername,
  vendorPrice,
  writeError,
  type ActiveActionData,
  type CombatStatsData,
  type ConsumableBatchData,
  type Json,
  type LedgerEntryData,
  type ProfessionData,
  type PushDeviceData,
  type RuntimeSnapshotData,
  type ServiceJobData,
  type SetActiveActionInput,
  type SkillNodeData,
  type WriteItemData,
  type WriteListingData,
  type WriteSeed,
  type WriteStore,
} from './store.js';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const LOADOUT_SLOTS = ['primary', 'secondary', 'heavy', 'ordnance', 'shield', 'classMod', 'relic'] as const;
const ACTIVE_KINDS = [
  'none',
  'idle_standby',
  'roaming_loot',
  'boss_prep',
  'boss_fight',
  'crafting',
  'salvaging',
  'workshop_service',
  'market_listing',
] as const;
const MATERIAL_KEYS = ['ScrapAlloy', 'BallisticParts', 'ReactiveComponents', 'TechFragments', 'VoidDust'] as const;

export interface InMemoryWriteOptions {
  now?: () => Date;
  rng?: () => number;
  uuid?: () => string;
  /**
   * Live market fee-rate lever (economy_config 'marketFeeRate',
   * 0018), resolved per purchase — the mirror of cc_accept_listing
   * reading the table inside its transaction. Defaults to
   * MARKET_FEE_RATE. Production purchases run the SQL path; this
   * provider exists so tests exercise the lever through the mirror.
   */
  feeRateProvider?: () => number | Promise<number>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function asNumberMap(value: unknown): Record<string, number> {
  return value && typeof value === 'object' ? { ...(value as Record<string, number>) } : {};
}

export class InMemoryWriteStore implements WriteStore {
  readonly seed: WriteSeed;
  private readonly nowFn: () => Date;
  private readonly rng: () => number;
  private readonly uuid: () => string;
  private readonly feeRateProvider: () => number | Promise<number>;

  private profiles = new Map<string, ProfileRowData>();
  private items = new Map<string, WriteItemData>();
  private listings = new Map<string, WriteListingData>();
  private jobs = new Map<string, ServiceJobData>();
  private activities = new Map<string, ActiveActionData>();
  private snapshots = new Map<string, RuntimeSnapshotData>();
  private combatStats = new Map<string, CombatStatsData>();
  private devices = new Map<string, PushDeviceData>();
  private ledger = new Map<string, LedgerEntryData>();

  constructor(seed: WriteSeed = emptyWriteSeed(), opts: InMemoryWriteOptions = {}) {
    this.seed = clone(seed);
    this.nowFn = opts.now ?? (() => new Date());
    this.rng = opts.rng ?? Math.random;
    this.uuid = opts.uuid ?? newUuid;
    this.feeRateProvider = opts.feeRateProvider ?? (() => MARKET_FEE_RATE);
    // Maps hold the seed's own objects so test-visible state stays in sync.
    for (const p of this.seed.profiles) this.profiles.set(p.id, p);
    for (const i of this.seed.items) this.items.set(i.id, i);
    for (const l of this.seed.listings) this.listings.set(l.id, l);
    for (const j of this.seed.serviceJobs) this.jobs.set(j.id, j);
    for (const a of this.seed.activeActions) this.activities.set(a.user_id, a);
    for (const s of this.seed.runtimeSnapshots) this.snapshots.set(s.user_id, s);
    for (const s of this.seed.combatStats) this.combatStats.set(s.user_id, s);
    for (const d of this.seed.pushDevices) this.devices.set(d.token, d);
    for (const e of this.seed.ledger) this.ledger.set(`${e.user_id}:${e.idempotency_key}`, e);
  }

  // -- shared internals -----------------------------------------------------

  private nowIso(): string {
    return this.nowFn().toISOString();
  }

  private cleanNonce(nonce: string | null | undefined): string {
    const cleaned = (nonce ?? '').trim();
    if (!cleaned || cleaned.length < 8) throw writeError('nonce is required');
    return cleaned;
  }

  private prior(playerId: string, key: string): Json | null {
    const entry = this.ledger.get(`${playerId}:${key}`);
    return entry ? clone(entry.result_payload) : null;
  }

  private record(playerId: string, actionType: string, key: string, result: Json): Json {
    this.ledger.set(`${playerId}:${key}`, {
      user_id: playerId,
      action_type: actionType,
      idempotency_key: key,
      result_payload: clone(result),
    });
    this.seed.ledger = [...this.ledger.values()].map((e) => clone(e));
    this.applyLedgerSideEffects(playerId, actionType, result);
    return clone(result);
  }

  private profile(playerId: string): ProfileRowData {
    const p = this.profiles.get(playerId);
    if (!p) throw writeError('Profile not found');
    return p;
  }

  private profileOrNull(playerId: string): ProfileRowData | null {
    return this.profiles.get(playerId) ?? null;
  }

  /** The SQL touch_updated_at trigger bumps profiles.updated_at on update. */
  private touch(p: ProfileRowData): void {
    p.updated_at = this.nowIso();
  }

  private touchItem(item: WriteItemData): void {
    item.updated_at = this.nowIso();
  }

  private canUseEconomy(p: ProfileRowData): boolean {
    return p.account_type === 'verified' && p.email_verified_at != null;
  }

  private requireEconomy(playerId: string): void {
    const p = this.profileOrNull(playerId);
    if (!p || !this.canUseEconomy(p)) throw writeError('Verified account required');
  }

  // Ledger-trigger side effects (cc_apply_mastery_for_verified_action).
  private addStat(userId: string, key: string, amount: number): void {
    if (amount === 0) return;
    const existing = this.seed.statCounters.find((s) => s.user_id === userId && s.stat_key === key);
    if (existing) existing.stat_value += amount;
    else this.seed.statCounters.push({ user_id: userId, stat_key: key, stat_value: amount });
  }

  private setStat(userId: string, key: string, value: number): void {
    const existing = this.seed.statCounters.find((s) => s.user_id === userId && s.stat_key === key);
    if (existing) existing.stat_value = value;
    else this.seed.statCounters.push({ user_id: userId, stat_key: key, stat_value: value });
  }

  private addMasteryXp(userId: string, masteryId: string, amount: number): void {
    if (amount === 0) return;
    const existing = this.seed.masteries.find((m) => m.user_id === userId && m.mastery_id === masteryId);
    if (existing) {
      existing.mastery_xp = Math.max(0, existing.mastery_xp + amount);
      existing.mastery_level = masteryLevelForXp(existing.mastery_xp);
    } else {
      const xp = Math.max(0, amount);
      this.seed.masteries.push({ user_id: userId, mastery_id: masteryId, mastery_xp: xp, mastery_level: masteryLevelForXp(xp) });
    }
  }

  private setMasteryXp(userId: string, masteryId: string, amount: number): void {
    const xp = Math.max(0, amount);
    const existing = this.seed.masteries.find((m) => m.user_id === userId && m.mastery_id === masteryId);
    if (existing) {
      existing.mastery_xp = xp;
      existing.mastery_level = masteryLevelForXp(xp);
    } else {
      this.seed.masteries.push({ user_id: userId, mastery_id: masteryId, mastery_xp: xp, mastery_level: masteryLevelForXp(xp) });
    }
  }

  /** Item-trigger net worth: credits + scrap + owned item values. */
  private recalcNetWorth(userId: string): void {
    const p = this.profileOrNull(userId);
    if (!p) return;
    let itemsValue = 0;
    for (const item of this.items.values()) {
      if (item.owner_user_id === userId) itemsValue += item.estimated_value;
    }
    const total = Math.max(0, p.credits + p.scrap + itemsValue);
    this.setStat(userId, 'account.net_worth', total);
    this.setMasteryXp(userId, 'account.net_worth', total);
  }

  private applyLedgerSideEffects(userId: string, action: string, result: Json): void {
    this.addStat(userId, 'actions.total', 1);
    this.addStat(userId, `actions.${action}`, 1);
    const profilePayload = (result.profile ?? null) as Json | null;
    if (action === 'cc_make_item' || action === 'cc_draw_item') {
      this.addStat(userId, 'inventory.cache_draws', 1);
      this.addMasteryXp(userId, 'inventory.cache_draws', 30);
    } else if (action === 'cc_recycle_item' || action === 'cc_salvage_item') {
      const amount = Math.max(0, Number(result.scrap_award ?? 0) || 0);
      this.addStat(userId, 'inventory.recycle.count', 1);
      this.addStat(userId, 'inventory.scrap_generated', amount);
      this.addMasteryXp(userId, 'inventory.recycle', 25);
      this.addMasteryXp(userId, 'inventory.scrap_generated', amount);
    } else if (action === 'cc_vendor_buy') {
      const amount = Math.max(1, Number(result.quantity ?? 1) || 1);
      this.addStat(userId, 'economy.vendor_buys', amount);
      this.addMasteryXp(userId, 'economy.vendor_buys', amount * 15);
    } else if (action === 'cc_market_create') {
      this.addStat(userId, 'economy.market_listings', 1);
      this.addMasteryXp(userId, 'economy.market_listings', 20);
    } else if (action === 'cc_accept_listing' || action === 'cc_market_transfer') {
      const listing = (result.listing ?? {}) as Json;
      const amount = Math.max(0, Number(listing.price_credits ?? 0) || 0);
      this.addStat(userId, 'economy.market_sales', 1);
      this.addStat(userId, 'economy.trade_volume', amount);
      this.addMasteryXp(userId, 'economy.market_sales', 50);
      this.addMasteryXp(userId, 'economy.trade_volume', amount);
    } else if (action === 'cc_item_service_request' || action === 'cc_item_service_accept') {
      this.addStat(userId, 'services.jobs_touched', 1);
      this.addMasteryXp(userId, 'services.repair', 10);
    } else if (action === 'cc_item_job_finish') {
      const amount = Math.max(0, Number(result.price_credits ?? 0) || 0);
      this.addStat(userId, 'services.completed', 1);
      this.addStat(userId, 'services.revenue', amount);
      this.addMasteryXp(userId, 'services.repair', 50 + amount);
    } else if (action === 'cc_battle_result' || action === 'cc_boss_attempt') {
      const draw = (result.draw ?? {}) as Json;
      const won = draw.outcome === 'victory';
      this.addStat(userId, 'combat.boss_attempts', 1);
      this.addMasteryXp(userId, 'combat.boss_attempts', 20);
      this.addMasteryXp(userId, 'locations.dustwaste', 25);
      if (won) {
        this.addStat(userId, 'combat.boss_defeats', 1);
        this.addMasteryXp(userId, 'combat.boss_defeats', 100);
      }
    } else if (action === 'cc_retrain' || action === 'cc_skill_reset') {
      this.addStat(userId, 'skills.retrain', 1);
      this.addMasteryXp(userId, 'skills.training', 25);
    } else if (action === 'cc_idle_claim') {
      const rewards = (result.rewards ?? {}) as Json;
      const amount = Math.max(0, Number(rewards.xp ?? 0) || 0);
      this.addStat(userId, 'combat.idle_xp_claimed', amount);
      this.addMasteryXp(userId, 'locations.dustwaste', Math.max(1, amount));
    }
    if (profilePayload && profilePayload.credits !== null && profilePayload.credits !== undefined) {
      const netWorth = Math.max(0, Number(profilePayload.credits) || 0) + Math.max(0, Number(profilePayload.scrap) || 0);
      this.setStat(userId, 'account.net_worth', netWorth);
      this.setMasteryXp(userId, 'account.net_worth', netWorth);
    }
  }

  // Snapshots (cc_profile_snapshot / cc_loadout_snapshot / cc_active_action_snapshot).
  private profileSnapshot(p: ProfileRowData): Json {
    const batches = this.seed.consumableBatches
      .filter((b) => b.owner_user_id === p.id && b.quantity > 0)
      .sort(
        (a, b) =>
          a.consumable_type.localeCompare(b.consumable_type) ||
          b.quality_percent - a.quality_percent ||
          a.created_at.localeCompare(b.created_at),
      )
      .map((b) => ({
        id: b.id,
        consumable_type: b.consumable_type,
        quality_percent: b.quality_percent,
        quantity: b.quantity,
        origin: b.origin,
        creator_user_id: b.creator_user_id,
        source_recipe_id: b.source_recipe_id,
        metadata: clone(b.metadata),
        created_at: b.created_at,
        updated_at: b.updated_at,
      }));
    return {
      id: p.id,
      player_level: p.player_level,
      player_xp: p.player_xp,
      credits: p.credits,
      scrap: p.scrap,
      cache_tokens: p.cache_tokens,
      cache_token_parts: p.cache_token_parts,
      materials: clone(p.materials),
      essences: clone(p.essences),
      consumables: clone(p.consumables),
      consumable_batches: batches,
      skill_spends: clone(p.skill_spends),
      boss_state: clone(p.boss_state),
      last_idle_claim_at: p.last_idle_claim_at,
    };
  }

  private loadoutSnapshot(playerId: string): Json {
    const loadout: Json = {
      primary: null,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
    };
    for (const item of this.items.values()) {
      if (
        item.owner_user_id === playerId &&
        item.runtime_state === 'equipped' &&
        item.equipped_slot &&
        (LOADOUT_SLOTS as readonly string[]).includes(item.equipped_slot)
      ) {
        loadout[item.equipped_slot] = item.id;
      }
    }
    return loadout;
  }

  private activitySnapshot(row: ActiveActionData): Json {
    return {
      user_id: row.user_id,
      active_action: row.active_action,
      started_at: row.started_at,
      completes_at: row.completes_at,
      target_type: row.target_type,
      target_id: row.target_id,
      target_label: row.target_label,
      scene_key: row.scene_key,
      notes: row.notes,
      activity_payload: clone(row.activity_payload ?? {}),
      public_payload: clone(row.public_payload ?? {}),
      last_heartbeat_at: row.last_heartbeat_at,
      public_visible: row.public_visible,
      schema_version: row.schema_version,
      updated_at: row.updated_at,
    };
  }

  private itemJson(item: WriteItemData): Json {
    return clone(item) as unknown as Json;
  }

  private listingJson(listing: WriteListingData): Json {
    return clone(listing) as unknown as Json;
  }

  private jobJson(job: ServiceJobData): Json {
    return clone(job) as unknown as Json;
  }

  private ownItem(playerId: string, itemId: string): WriteItemData {
    const item = this.items.get(itemId);
    if (!item || item.owner_user_id !== playerId) throw writeError('Item not found');
    return item;
  }

  /** cc_add_consumable_batch: merge into a matching batch or create one. */
  private addConsumableBatch(
    owner: string,
    itemKey: string,
    quantity: number,
    qualityPercent: number,
    origin: string,
    creator: string | null,
    recipeId: string | null,
    metadata: Json,
  ): string {
    const creatorKey = creator ?? NIL_UUID;
    const recipeKey = recipeId ?? '';
    const existing = this.seed.consumableBatches.find(
      (b) =>
        b.owner_user_id === owner &&
        b.consumable_type === itemKey &&
        b.quality_percent === qualityPercent &&
        b.origin === origin &&
        (b.creator_user_id ?? NIL_UUID) === creatorKey &&
        (b.source_recipe_id ?? '') === recipeKey,
    );
    if (existing) {
      existing.quantity += quantity;
      existing.metadata = { ...existing.metadata, ...clone(metadata) };
      existing.updated_at = this.nowIso();
      return existing.id;
    }
    const batch: ConsumableBatchData = {
      id: this.uuid(),
      owner_user_id: owner,
      consumable_type: itemKey,
      quality_percent: qualityPercent,
      quantity,
      origin,
      creator_user_id: creator,
      source_recipe_id: recipeId,
      metadata: clone(metadata),
      created_at: this.nowIso(),
      updated_at: this.nowIso(),
    };
    this.seed.consumableBatches.push(batch);
    return batch.id;
  }

  /** cc_consume_consumable_batch: FIFO by quality asc, then created_at asc. */
  private consumeBatchesFifo(owner: string, itemKey: string, quantity: number): Json {
    let remaining = quantity;
    const consumed: Json[] = [];
    const ordered = this.seed.consumableBatches
      .filter((b) => b.owner_user_id === owner && b.consumable_type === itemKey && b.quantity > 0)
      .sort((a, b) => a.quality_percent - b.quality_percent || a.created_at.localeCompare(b.created_at));
    const originals = ordered.map((b) => b.quantity);
    for (const batch of ordered) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, batch.quantity);
      batch.quantity -= take;
      batch.updated_at = this.nowIso();
      remaining -= take;
      consumed.push({
        batch_id: batch.id,
        consumable_type: batch.consumable_type,
        quality_percent: batch.quality_percent,
        quantity: take,
      });
    }
    if (remaining > 0) {
      // The SQL function raises, rolling the whole op back — restore.
      ordered.forEach((b, i) => {
        b.quantity = originals[i];
      });
    }
    return { consumed, requested_quantity: quantity, remaining_shortfall: remaining };
  }

  private insertItem(item: WriteItemData): void {
    this.items.set(item.id, item);
    this.seed.items.push(item);
  }

  private insertListing(listing: WriteListingData): void {
    this.listings.set(listing.id, listing);
    this.seed.listings.push(listing);
  }

  private insertJob(job: ServiceJobData): void {
    this.jobs.set(job.id, job);
    this.seed.serviceJobs.push(job);
  }

  // -- verified ops ---------------------------------------------------------

  async initialBundle(playerId: string, nonce: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    if (String(p.boss_state?.initial_bundle_claimed ?? 'false') === 'true') {
      throw writeError('Initial bundle already claimed');
    }
    p.credits += 5000;
    p.scrap += 500;
    p.cache_tokens += 3;
    p.boss_state = { ...p.boss_state, initial_bundle_claimed: true };
    this.touch(p);
    const result: Json = { action_type: 'cc_initial_bundle', profile: this.profileSnapshot(p) };
    return this.record(playerId, 'cc_initial_bundle', key, result);
  }

  async makeItem(playerId: string, nonce: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    if (p.cache_tokens < 1) throw writeError('Not enough tokens');
    const outcomes = this.seed.oddsOutcomes.filter((o) => o.table_id === 'cache_primary_rarity');
    if (!outcomes.length) throw writeError('No outcomes configured for cache_primary_rarity');
    const draw = drawOdds('cache_primary_rarity', outcomes, this.rng());
    const rarity = draw.outcome;
    p.cache_tokens -= 1;
    this.touch(p);
    const itemLevel = Math.max(1, p.player_level);
    // SQL computes the value from {'odds': ...} (no combatPower) — faithful.
    const estimated = computeItemEstimatedValue({ odds: draw as unknown as Json }, 'weapon', rarity, itemLevel);
    const now = this.nowIso();
    const item: WriteItemData = {
      id: this.uuid(),
      owner_user_id: playerId,
      kind: 'weapon',
      static_item_id: null,
      item_level: itemLevel,
      rarity,
      quality: null,
      material_tier: null,
      condition_state: null,
      condition_current: null,
      condition_max: null,
      supply_mode: 'verified_action',
      source_id: null,
      creator_user_id: null,
      tradeable: true,
      account_bound: false,
      locked_until: null,
      payload: generateWeaponPayload(itemLevel, rarity, this.rng),
      runtime_state: 'available',
      is_locked: false,
      equipped_slot: null,
      estimated_value: estimated,
      created_at: now,
      updated_at: now,
    };
    this.insertItem(item);
    this.recalcNetWorth(playerId);
    const result: Json = {
      action_type: 'cc_make_item',
      profile: this.profileSnapshot(p),
      odds: draw as unknown as Json,
      item: this.itemJson(item),
    };
    return this.record(playerId, 'cc_make_item', key, result);
  }

  // _rewardSource is accepted for signature parity with the SQL op (which
  // records it on the grant row); the mirror's grant rows don't carry it.
  async claimRewardedCacheKey(playerId: string, nonce: string, adUnitId: string, _rewardSource: string): Promise<Json> {
    const cleanAdUnit = (adUnitId ?? '').trim();
    if (!cleanAdUnit) throw writeError('ad_unit_id is required');
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const nowMs = this.nowFn().getTime();
    const startOfDay = new Date(this.nowFn());
    startOfDay.setUTCHours(0, 0, 0, 0);
    const todays = this.seed.adGrants.filter(
      (g) =>
        g.user_id === playerId &&
        g.reward_type === 'cache_key' &&
        g.status === 'granted' &&
        new Date(g.granted_at).getTime() >= startOfDay.getTime(),
    );
    if (todays.length >= 3) throw writeError('Daily rewarded cache key limit reached');
    const cooldown = this.seed.adGrants.some(
      (g) => g.user_id === playerId && g.reward_type === 'cache_key' && nowMs - new Date(g.granted_at).getTime() < 5 * 60 * 1000,
    );
    if (cooldown) throw writeError('Rewarded cache key cooldown active');
    const p = this.profile(playerId);
    p.cache_tokens += 1;
    this.touch(p);
    this.seed.adGrants.push({ user_id: playerId, reward_type: 'cache_key', status: 'granted', granted_at: this.nowIso() });
    const result: Json = {
      action_type: 'cc_claim_rewarded_cache_key',
      profile: this.profileSnapshot(p),
      reward_type: 'cache_key',
      reward_amount: 1,
      daily_grants_used: todays.length + 1,
    };
    return this.record(playerId, 'cc_claim_rewarded_cache_key', key, result);
  }

  async registerPushDevice(playerId: string, token: string, platform: string, appVersion: string | null): Promise<Json> {
    const cleanToken = (token ?? '').trim();
    if (cleanToken.length < 16) throw writeError('token is required');
    const cleanPlatform = ['android', 'ios', 'web'].includes((platform ?? '').toLowerCase())
      ? (platform as string).toLowerCase()
      : 'android';
    const now = this.nowIso();
    let device = this.devices.get(cleanToken);
    if (device) {
      device.user_id = playerId;
      device.platform = cleanPlatform;
      device.app_version = appVersion;
      device.enabled = true;
      device.last_registered_at = now;
      device.last_seen_at = now;
      device.disabled_at = null;
    } else {
      device = {
        id: this.uuid(),
        user_id: playerId,
        token: cleanToken,
        platform: cleanPlatform,
        app_version: appVersion,
        enabled: true,
        last_registered_at: now,
        last_seen_at: now,
        disabled_at: null,
        metadata: {},
      };
      this.devices.set(cleanToken, device);
      this.seed.pushDevices.push(device);
    }
    if (!this.seed.notificationSettingsUsers.includes(playerId)) {
      this.seed.notificationSettingsUsers.push(playerId);
    }
    // No ledger row: the SQL function is not nonce-idempotent.
    return { action_type: 'cc_register_push_device', device: clone(device) as unknown as Json };
  }

  async disablePushDevice(playerId: string, token: string): Promise<Json> {
    const cleanToken = (token ?? '').trim();
    if (cleanToken.length < 16) throw writeError('token is required');
    const device = this.devices.get(cleanToken);
    if (device && device.user_id === playerId) {
      device.enabled = false;
      device.disabled_at = this.nowIso();
      device.last_seen_at = this.nowIso();
    }
    return { action_type: 'cc_disable_push_device' };
  }

  async vendorBuy(playerId: string, nonce: string, itemKey: string, quantity: number): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    const unitPrice = vendorPrice(itemKey);
    if (unitPrice === null) throw writeError('Unknown vendor item');
    const qty = Math.max(1, Math.floor(quantity) || 1);
    const total = unitPrice * qty;
    if (p.credits < total) throw writeError('Insufficient credits');
    p.credits -= total;
    const consumables = asNumberMap(p.consumables);
    consumables[itemKey] = (consumables[itemKey] ?? 0) + qty;
    p.consumables = consumables;
    this.touch(p);
    const batchId = this.addConsumableBatch(playerId, itemKey, qty, 100, 'vendor', null, null, {
      unit_price: unitPrice,
      total_price: total,
    });
    const result: Json = {
      action_type: 'cc_vendor_buy',
      profile: this.profileSnapshot(p),
      item_key: itemKey,
      quantity: qty,
      quality_percent: 100,
      batch_id: batchId,
      total_price: total,
    };
    return this.record(playerId, 'cc_vendor_buy', key, result);
  }

  async claimCraftedConsumable(
    playerId: string,
    nonce: string,
    recipeId: string,
    itemKey: string,
    quantity: number,
  ): Promise<Json> {
    if (!recipeId || !itemKey) throw writeError('recipe_id and item_key are required');
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    const mats = recipeMaterials(recipeId);
    if (!mats) throw writeError('Unknown consumable recipe');
    const bounds = recipeQualityBounds(itemKey);
    if (!bounds) throw writeError('Unknown craftable consumable');
    const qty = Math.max(1, Math.floor(quantity) || 1);
    const materials = asNumberMap(p.materials);
    const essences = asNumberMap(p.essences);
    // SQL charges the recipe's materials ONCE per craft, not per unit.
    for (const [mat, needed] of Object.entries(mats)) {
      if ((MATERIAL_KEYS as readonly string[]).includes(mat)) {
        if ((materials[mat] ?? 0) < needed) throw writeError(`Insufficient material ${mat}`);
      } else if ((essences[mat] ?? 0) < needed) {
        throw writeError(`Insufficient essence ${mat}`);
      }
    }
    let masteryLevel = 1;
    for (const m of this.seed.masteries) {
      if (
        m.user_id === playerId &&
        ['crafting_consumables', 'workshop_consumables', 'consumable_crafting'].includes(m.mastery_id)
      ) {
        masteryLevel = Math.max(masteryLevel, m.mastery_level);
      }
    }
    const qMin = Math.min(bounds.max, bounds.min + Math.min(20, Math.max(0, masteryLevel - 1) * 1.5));
    const qMax = Math.min(175, bounds.max + Math.min(25, Math.max(0, masteryLevel - 1) * 2));
    const rolled = Math.round((qMin + this.rng() * Math.max(0, qMax - qMin)) * 100) / 100;
    for (const [mat, needed] of Object.entries(mats)) {
      if ((MATERIAL_KEYS as readonly string[]).includes(mat)) materials[mat] = (materials[mat] ?? 0) - needed;
      else essences[mat] = (essences[mat] ?? 0) - needed;
    }
    p.materials = materials;
    p.essences = essences;
    const consumables = asNumberMap(p.consumables);
    consumables[itemKey] = (consumables[itemKey] ?? 0) + qty;
    p.consumables = consumables;
    this.touch(p);
    const batchId = this.addConsumableBatch(playerId, itemKey, qty, rolled, 'crafted', playerId, recipeId, {
      recipe_id: recipeId,
      mastery_level: masteryLevel,
      quality_min: qMin,
      quality_max: qMax,
    });
    const stat = this.seed.statCounters.find((s) => s.user_id === playerId && s.stat_key === 'consumables_crafted');
    if (stat) stat.stat_value += qty;
    else this.seed.statCounters.push({ user_id: playerId, stat_key: 'consumables_crafted', stat_value: qty });
    const mastery = this.seed.masteries.find((m) => m.user_id === playerId && m.mastery_id === 'crafting_consumables');
    if (mastery) {
      mastery.mastery_xp += qty * 10;
      mastery.mastery_level = Math.max(1, Math.floor(Math.sqrt(mastery.mastery_xp / 100)) + 1);
    } else {
      // SQL inserts new mastery rows at level 1 regardless of the xp grant.
      this.seed.masteries.push({
        user_id: playerId,
        mastery_id: 'crafting_consumables',
        mastery_xp: qty * 10,
        mastery_level: 1,
      });
    }
    const result: Json = {
      action_type: 'cc_claim_crafted_consumable',
      profile: this.profileSnapshot(p),
      recipe_id: recipeId,
      item_key: itemKey,
      quantity: qty,
      quality_percent: rolled,
      batch_id: batchId,
    };
    return this.record(playerId, 'cc_claim_crafted_consumable', key, result);
  }

  async consumeConsumable(
    playerId: string,
    nonce: string,
    itemKey: string,
    quantity: number,
    _activityType: string | null,
    _reason: string | null,
  ): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    const qty = Math.max(1, Math.floor(quantity) || 1);
    const consumables = asNumberMap(p.consumables);
    const current = consumables[itemKey] ?? 0;
    if (current < qty) throw writeError(`Insufficient consumable quantity for ${itemKey}`);
    const hasBatch = this.seed.consumableBatches.some(
      (b) => b.owner_user_id === playerId && b.consumable_type === itemKey && b.quantity > 0,
    );
    if (!hasBatch && current > 0) {
      this.addConsumableBatch(playerId, itemKey, current, 100, 'vendor', null, null, {});
    }
    const consumed = this.consumeBatchesFifo(playerId, itemKey, qty);
    if (Number(consumed.remaining_shortfall) > 0) {
      throw writeError(`Insufficient consumable quantity for ${itemKey}`);
    }
    consumables[itemKey] = Math.max(current - qty, 0);
    p.consumables = consumables;
    this.touch(p);
    const result: Json = {
      action_type: 'cc_consume_consumable',
      profile: this.profileSnapshot(p),
      item_key: itemKey,
      quantity: qty,
      consumed_batches: consumed,
    };
    return this.record(playerId, 'cc_consume_consumable', key, result);
  }

  async recycleItem(playerId: string, nonce: string, itemId: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    const item = this.ownItem(playerId, itemId);
    if (item.is_locked) throw writeError('Locked item');
    if (!['available', 'equipped'].includes(item.runtime_state)) throw writeError('Item state invalid');
    // Market Crash (legendary): 4x scrap when recycling this weapon —
    // mirrors cc_recycle_item as amended by 0008_legendary_honesty.sql.
    const baseAward = salvageScrap(item.rarity, item.item_level);
    const payload = (item.payload ?? {}) as { legendaryEffectId?: string };
    const award = payload.legendaryEffectId === 'market_crash' ? baseAward * 4 : baseAward;
    item.runtime_state = 'consumed';
    item.tradeable = false;
    item.equipped_slot = null;
    this.touchItem(item);
    this.recalcNetWorth(playerId);
    p.scrap += award;
    this.touch(p);
    const result: Json = {
      action_type: 'cc_recycle_item',
      profile: this.profileSnapshot(p),
      item: this.itemJson(item),
      scrap_award: award,
      loadout: this.loadoutSnapshot(playerId),
    };
    return this.record(playerId, 'cc_recycle_item', key, result);
  }

  async itemLock(playerId: string, nonce: string, itemId: string, locked: boolean): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    const item = this.ownItem(playerId, itemId);
    if (['listed', 'consumed', 'salvaged'].includes(item.runtime_state)) throw writeError('Item state invalid');
    item.is_locked = locked;
    item.runtime_state = locked ? 'locked' : 'available';
    this.touchItem(item);
    this.recalcNetWorth(playerId);
    const result: Json = {
      action_type: 'cc_item_lock',
      profile: this.profileSnapshot(p),
      item: this.itemJson(item),
      loadout: this.loadoutSnapshot(playerId),
    };
    return this.record(playerId, 'cc_item_lock', key, result);
  }

  async equipItem(playerId: string, nonce: string, itemId: string, slotName: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    if (!(LOADOUT_SLOTS as readonly string[]).includes(slotName)) throw writeError('Invalid slot');
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    const item = this.ownItem(playerId, itemId);
    if (!['available', 'locked', 'equipped'].includes(item.runtime_state)) throw writeError('Item state invalid');
    if (!itemAcceptsSlot(item.payload, slotName)) throw writeError('Item type does not match loadout slot');
    const changed: WriteItemData[] = [];
    for (const other of this.items.values()) {
      if (other.owner_user_id === playerId && other.id !== item.id && other.equipped_slot === slotName) {
        other.equipped_slot = null;
        other.runtime_state = other.is_locked ? 'locked' : 'available';
        this.touchItem(other);
        changed.push(other);
      }
    }
    item.equipped_slot = slotName;
    item.runtime_state = 'equipped';
    this.touchItem(item);
    changed.push(item);
    const result: Json = {
      action_type: 'cc_equip_item',
      profile: this.profileSnapshot(p),
      item: this.itemJson(item),
      items: changed.map((i) => this.itemJson(i)),
      loadout: this.loadoutSnapshot(playerId),
    };
    return this.record(playerId, 'cc_equip_item', key, result);
  }

  async unequipSlot(playerId: string, nonce: string, slotName: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    if (!(LOADOUT_SLOTS as readonly string[]).includes(slotName)) throw writeError('Invalid slot');
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profileOrNull(playerId);
    let found: WriteItemData | null = null;
    for (const item of this.items.values()) {
      if (item.owner_user_id === playerId && item.equipped_slot === slotName) {
        item.equipped_slot = null;
        item.runtime_state = item.is_locked ? 'locked' : 'available';
        this.touchItem(item);
        if (!found) found = item;
      }
    }
    const profilePayload: Json = p
      ? this.profileSnapshot(p)
      : {
          id: null,
          player_level: null,
          player_xp: null,
          credits: null,
          scrap: null,
          cache_tokens: null,
          cache_token_parts: null,
          materials: null,
          essences: null,
          consumables: null,
          consumable_batches: [],
          skill_spends: null,
          boss_state: null,
          last_idle_claim_at: null,
        };
    const result: Json = {
      action_type: 'cc_unequip_slot',
      profile: profilePayload,
      item: found ? this.itemJson(found) : null,
      slot_name: slotName,
      loadout: this.loadoutSnapshot(playerId),
    };
    return this.record(playerId, 'cc_unequip_slot', key, result);
  }

  async idleClaim(playerId: string, nonce: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    const elapsedSec = Math.min(
      7200,
      Math.max(0, Math.floor((this.nowFn().getTime() - new Date(p.last_idle_claim_at).getTime()) / 1000)),
    );
    const xpAward = Math.floor(elapsedSec / 60);
    const creditAward = xpAward * 10;
    const next = applyXp(p.player_level, p.player_xp, xpAward);
    p.player_level = next.player_level;
    p.player_xp = next.player_xp;
    p.credits += creditAward;
    p.last_idle_claim_at = this.nowIso();
    this.touch(p);
    const result: Json = {
      action_type: 'cc_idle_claim',
      profile: this.profileSnapshot(p),
      rewards: { xp: xpAward, credits: creditAward },
    };
    return this.record(playerId, 'cc_idle_claim', key, result);
  }

  async retrain(playerId: string, nonce: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    const total = skillSpendTotal(p.skill_spends as Json);
    const cost = total * 100;
    if (p.credits < cost) throw writeError('Insufficient credits');
    p.credits -= cost;
    p.skill_spends = {};
    this.touch(p);
    const result: Json = { action_type: 'cc_retrain', profile: this.profileSnapshot(p), total_price: cost };
    return this.record(playerId, 'cc_retrain', key, result);
  }

  async trainSkill(playerId: string, nonce: string, nodeId: string): Promise<Json> {
    const cleanNode = (nodeId ?? '').trim();
    if (!cleanNode) throw writeError('node_id is required');
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    const node: SkillNodeData | undefined = this.seed.skillNodes.find((n) => n.id === cleanNode);
    if (!node) throw writeError('Unknown skill node');
    const spends = asNumberMap(p.skill_spends);
    const current = spends[cleanNode] ?? 0;
    if (current >= node.max_points) throw writeError(`Skill node ${cleanNode} is already maxed`);
    const missing = node.requires.filter((req) => (spends[req] ?? 0) < 1);
    if (missing.length) throw writeError(`Missing prerequisites: ${missing.join(', ')}`);
    const budget = Math.max(0, p.player_level - 1);
    const totalAfter = skillSpendTotal(spends as Json) + 1;
    if (totalAfter > budget) throw writeError(`Insufficient skill points: have ${budget}, need ${totalAfter}`);
    spends[cleanNode] = current + 1;
    p.skill_spends = spends;
    this.touch(p);
    const result: Json = {
      action_type: 'cc_train_skill',
      profile: this.profileSnapshot(p),
      node_id: cleanNode,
      node_points: current + 1,
      total_spent: totalAfter,
    };
    return this.record(playerId, 'cc_train_skill', key, result);
  }

  async battleResult(playerId: string, nonce: string, targetId: string, stance: string): Promise<Json> {
    const cleanTarget = (targetId ?? '').trim();
    if (!cleanTarget) throw writeError('target_id is required');
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    const cleanStance = (stance ?? '').trim() || 'balanced';
    const tableId = cleanStance === 'aggressive' || cleanStance === 'defensive' ? `boss_attempt_${cleanStance}` : 'boss_attempt_balanced';
    const outcomes = this.seed.oddsOutcomes.filter((o) => o.table_id === tableId);
    if (!outcomes.length) throw writeError(`No outcomes configured for ${tableId}`);
    const draw = drawOdds(tableId, outcomes, this.rng());
    const payload = draw.payload ?? {};
    // SQL reads payload xp_mult / credit_mult; a missing key makes the
    // product NULL and greatest() falls back to the floor (1 xp, 0 credits).
    const xpMult = typeof payload.xp_mult === 'number' ? payload.xp_mult : null;
    const creditMult = typeof payload.credit_mult === 'number' ? payload.credit_mult : null;
    const xpAward = xpMult === null ? 1 : Math.max(1, Math.round(Math.max(10, p.player_level * 15) * xpMult));
    const creditAward = creditMult === null ? 0 : Math.max(0, Math.round(Math.max(50, p.player_level * 25) * creditMult));
    const partAward = Math.max(0, Math.floor(Number(payload.fragment_reward ?? 0) || 0));
    const next = applyXp(p.player_level, p.player_xp, xpAward);
    p.player_level = next.player_level;
    p.player_xp = next.player_xp;
    p.credits += creditAward;
    let parts = p.cache_token_parts + partAward;
    let tokens = p.cache_tokens;
    while (parts >= 5) {
      parts -= 5;
      tokens += 1;
    }
    p.cache_token_parts = parts;
    p.cache_tokens = tokens;
    p.boss_state = { ...p.boss_state, last_target_id: cleanTarget, last_draw: draw as unknown as Json };
    this.touch(p);
    const result: Json = {
      action_type: 'cc_battle_result',
      profile: this.profileSnapshot(p),
      target_id: cleanTarget,
      stance: cleanStance,
      draw: draw as unknown as Json,
      rewards: { xp: xpAward, credits: creditAward, parts: partAward },
    };
    return this.record(playerId, 'cc_battle_result', key, result);
  }

  async marketCreate(playerId: string, nonce: string, itemId: string, priceCredits: number): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const price = Math.floor(priceCredits);
    if (!Number.isFinite(price) || price <= 0) throw writeError('price_credits must be positive');
    this.requireEconomy(playerId);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profileOrNull(playerId);
    const item = this.ownItem(playerId, itemId);
    if (item.account_bound || !item.tradeable || ['listed', 'equipped', 'salvaged', 'consumed'].includes(item.runtime_state)) {
      throw writeError('Item not listable');
    }
    const listing: WriteListingData = {
      id: this.uuid(),
      seller_user_id: playerId,
      item_instance_id: item.id,
      price_credits: price,
      status: 'active',
      listed_at: this.nowIso(),
      sold_at: null,
    };
    this.insertListing(listing);
    item.runtime_state = 'listed';
    this.touchItem(item);
    this.recalcNetWorth(playerId);
    const result: Json = {
      action_type: 'cc_market_create',
      profile: p ? this.profileSnapshot(p) : null,
      listing: this.listingJson(listing),
      item: this.itemJson(item),
    };
    return this.record(playerId, 'cc_market_create', key, result);
  }

  async marketCancel(playerId: string, nonce: string, listingId: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profileOrNull(playerId);
    const listing = this.listings.get(listingId);
    if (!listing || listing.seller_user_id !== playerId) throw writeError('Listing not found');
    if (listing.status !== 'active') throw writeError('Listing not active');
    listing.status = 'cancelled';
    const item = this.items.get(listing.item_instance_id);
    if (item) {
      item.runtime_state = item.is_locked ? 'locked' : 'available';
      this.touchItem(item);
    }
    const result: Json = {
      action_type: 'cc_market_cancel',
      profile: p ? this.profileSnapshot(p) : null,
      listing: this.listingJson(listing),
      item: item ? this.itemJson(item) : null,
    };
    return this.record(playerId, 'cc_market_cancel', key, result);
  }

  async acceptListing(playerId: string, nonce: string, listingId: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    this.requireEconomy(playerId);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const buyer = this.profile(playerId);
    const listing = this.listings.get(listingId);
    if (!listing || listing.status !== 'active') throw writeError('Active listing not found');
    if (listing.seller_user_id === playerId) throw writeError('Cannot accept own listing');
    if (buyer.credits < listing.price_credits) throw writeError('Insufficient credits');
    buyer.credits -= listing.price_credits;
    this.touch(buyer);
    const seller = this.profileOrNull(listing.seller_user_id);
    const soldItem = this.items.get(listing.item_instance_id);
    // Market sale fee (0017): MARKET_FEE_RATE of the price is
    // destroyed; the seller is credited price − fee. NPC-seeded
    // listings (supply_mode 'npc_market') are exempt — the NPC payout
    // is unchanged. The seller's fee reduction is derived from their
    // own records (skill_spends + equipped class mod), never the body.
    let feeBreakdown: MarketFeeBreakdown = {
      price: listing.price_credits,
      feeRate: MARKET_FEE_RATE,
      feeReduction: 0,
      effectiveRate: 0,
      fee: 0,
      sellerProceeds: listing.price_credits,
    };
    let foundBySeller = false;
    if (seller && soldItem && soldItem.supply_mode !== 'npc_market') {
      foundBySeller = this.sellerFoundItem(seller.id, soldItem);
      feeBreakdown = marketFeeForSeller({
        price: listing.price_credits,
        skillSpends: seller.skill_spends ?? {},
        classModBoosts: this.classModBoostsFor(seller.id),
        foundBySeller,
        feeRate: await this.feeRateProvider(),
      });
    }
    if (seller) {
      seller.credits += feeBreakdown.sellerProceeds;
      this.touch(seller);
    }
    listing.status = 'sold';
    listing.sold_at = this.nowIso();
    const item = soldItem;
    if (item) {
      const previousOwner = item.owner_user_id;
      item.owner_user_id = playerId;
      item.runtime_state = 'available';
      item.is_locked = false;
      item.equipped_slot = null;
      this.touchItem(item);
      this.recalcNetWorth(previousOwner);
      this.recalcNetWorth(playerId);
    }
    const result: Json = {
      action_type: 'cc_accept_listing',
      profile: this.profileSnapshot(buyer),
      listing: this.listingJson(listing),
      item: item ? this.itemJson(item) : null,
      market_fee: {
        fee_credits: feeBreakdown.fee,
        seller_proceeds: feeBreakdown.sellerProceeds,
        fee_rate: feeBreakdown.feeRate,
        fee_reduction: feeBreakdown.feeReduction,
        found_item: foundBySeller,
      },
    };
    return this.record(playerId, 'cc_accept_listing', key, result);
  }

  /**
   * Whether the seller personally found this item (Market Manipulator
   * gate): the item's payload carries a find drop source AND the
   * seller has no ledger record of acquiring this item from another
   * player via cc_accept_listing. Mirrors the SQL check in 0017.
   */
  private sellerFoundItem(sellerId: string, item: WriteItemData): boolean {
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    if (!isFoundSource(payload.sourceTag)) return false;
    for (const entry of this.ledger.values()) {
      if (entry.user_id !== sellerId || entry.action_type !== 'cc_accept_listing') continue;
      const bought = (entry.result_payload as Record<string, unknown> | null)?.item as
        | Record<string, unknown>
        | undefined;
      if (bought && bought.id === item.id) return false;
    }
    return true;
  }

  /**
   * The seller's equipped class mod boosts, from their own item
   * records — mirrors classModBoostsFromGear's predicate (the equipped
   * gear whose payload carries treeBonus) over raw payloads.
   */
  private classModBoostsFor(sellerId: string): ClassModBoosts {
    for (const item of this.items.values()) {
      if (item.owner_user_id !== sellerId || item.runtime_state !== 'equipped') continue;
      const payload = (item.payload ?? {}) as Record<string, unknown>;
      if (!('treeBonus' in payload)) continue;
      const nodeBoosts = (payload.nodeBoosts ?? {}) as Record<string, number>;
      return {
        treeBonus: typeof payload.treeBonus === 'string' ? payload.treeBonus : undefined,
        nodeBoosts: { ...nodeBoosts },
      };
    }
    return { nodeBoosts: {} };
  }

  async requestItemService(playerId: string, nonce: string, itemId: string, serviceId: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    this.requireEconomy(playerId);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profileOrNull(playerId);
    const item = this.ownItem(playerId, itemId);
    if (['listed', 'consumed', 'salvaged'].includes(item.runtime_state)) throw writeError('Item state invalid');
    const job: ServiceJobData = {
      id: this.uuid(),
      owner_user_id: playerId,
      provider_user_id: null,
      profession_id: 'repair',
      status: 'listed',
      target_item_instance_id: item.id,
      requested_service_id: serviceId,
      quoted_price_credits: null,
      quoted_duration_minutes: null,
      owner_supplied_material_ids: [],
      provider_supplied_material_ids: [],
      escrow_id: null,
      created_at: this.nowIso(),
      accepted_at: null,
      completed_at: null,
    };
    this.insertJob(job);
    item.runtime_state = 'locked';
    item.is_locked = true;
    this.touchItem(item);
    this.recalcNetWorth(playerId);
    const result: Json = {
      action_type: 'cc_item_service_request',
      profile: p ? this.profileSnapshot(p) : null,
      job: this.jobJson(job),
      item: this.itemJson(item),
    };
    return this.record(playerId, 'cc_item_service_request', key, result);
  }

  async acceptItemService(playerId: string, nonce: string, jobId: string, priceCredits: number, durationMinutes: number): Promise<Json> {
    const key = this.cleanNonce(nonce);
    this.requireEconomy(playerId);
    const price = Math.floor(priceCredits);
    if (!Number.isFinite(price) || price < 0) throw writeError('Invalid price');
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'listed') throw writeError('Service job not available');
    if (job.owner_user_id === playerId) throw writeError('Cannot accept own job');
    job.provider_user_id = playerId;
    job.status = 'accepted';
    job.quoted_price_credits = price;
    job.quoted_duration_minutes = Math.floor(durationMinutes) || 60;
    job.accepted_at = this.nowIso();
    const result: Json = { action_type: 'cc_item_service_accept', job: this.jobJson(job) };
    return this.record(playerId, 'cc_item_service_accept', key, result);
  }

  async finishItemService(playerId: string, nonce: string, jobId: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const job = this.jobs.get(jobId);
    if (!job || job.provider_user_id !== playerId) throw writeError('Job not found');
    if (job.status !== 'accepted') throw writeError('Job state invalid');
    const price = job.quoted_price_credits ?? 0;
    const owner = this.profileOrNull(job.owner_user_id);
    if (!owner || owner.credits < price) throw writeError('Insufficient credits');
    owner.credits -= price;
    this.touch(owner);
    const provider = this.profile(playerId);
    provider.credits += price;
    this.touch(provider);
    const item = this.items.get(job.target_item_instance_id);
    if (item) {
      item.runtime_state = 'available';
      item.is_locked = false;
      item.condition_current = item.condition_max;
      this.touchItem(item);
      this.recalcNetWorth(item.owner_user_id);
    }
    job.status = 'completed';
    job.completed_at = this.nowIso();
    const profession = this.seed.professions.find(
      (pr: ProfessionData) => pr.user_id === playerId && pr.profession_id === job.profession_id,
    );
    if (profession) {
      profession.xp += 50;
      profession.total_services_completed += 1;
      profession.reputation_score += 1;
      profession.updated_at = this.nowIso();
    } else {
      this.seed.professions.push({
        user_id: playerId,
        profession_id: job.profession_id,
        level: 1,
        xp: 50,
        total_crafts: 0,
        total_services_completed: 1,
        reputation_score: 1,
        updated_at: this.nowIso(),
      });
    }
    const result: Json = {
      action_type: 'cc_item_job_finish',
      profile: this.profileSnapshot(provider),
      owner_profile: this.profileSnapshot(owner),
      job: this.jobJson(job),
      item: item ? this.itemJson(item) : null,
      price_credits: price,
    };
    return this.record(playerId, 'cc_item_job_finish', key, result);
  }

  async resetProgress(playerId: string, nonce: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const p = this.profile(playerId);
    const ownItemIds = new Set([...this.items.values()].filter((i) => i.owner_user_id === playerId).map((i) => i.id));
    this.seed.serviceJobs = this.seed.serviceJobs.filter((j) => j.owner_user_id !== playerId && j.provider_user_id !== playerId);
    for (const j of [...this.jobs.values()]) {
      if (j.owner_user_id === playerId || j.provider_user_id === playerId) this.jobs.delete(j.id);
    }
    this.seed.listings = this.seed.listings.filter((l) => l.seller_user_id !== playerId && !ownItemIds.has(l.item_instance_id));
    for (const l of [...this.listings.values()]) {
      if (l.seller_user_id === playerId || ownItemIds.has(l.item_instance_id)) this.listings.delete(l.id);
    }
    this.seed.items = this.seed.items.filter((i) => i.owner_user_id !== playerId);
    for (const id of ownItemIds) this.items.delete(id);
    this.seed.consumableBatches = this.seed.consumableBatches.filter((b) => b.owner_user_id !== playerId);
    this.seed.professions = this.seed.professions.filter((pr) => pr.user_id !== playerId);
    this.activities.delete(playerId);
    this.seed.activeActions = this.seed.activeActions.filter((a) => a.user_id !== playerId);
    this.seed.statCounters = this.seed.statCounters.filter((s) => s.user_id !== playerId);
    this.seed.masteries = this.seed.masteries.filter((m) => m.user_id !== playerId);
    this.snapshots.delete(playerId);
    this.seed.runtimeSnapshots = this.seed.runtimeSnapshots.filter((s) => s.user_id !== playerId);
    p.player_level = 1;
    p.player_xp = 0;
    p.credits = 5000;
    p.scrap = 500;
    p.cache_tokens = 3;
    p.cache_token_parts = 0;
    p.materials = {};
    p.essences = {};
    p.consumables = {};
    p.skill_spends = {};
    p.boss_state = { initial_bundle_claimed: true };
    p.last_idle_claim_at = this.nowIso();
    this.touch(p);
    const result: Json = { action_type: 'cc_reset_progress', profile: this.profileSnapshot(p) };
    return this.record(playerId, 'cc_reset_progress', key, result);
  }

  // -- activity ---------------------------------------------------------------

  async getActiveActivity(playerId: string): Promise<ActiveActionData | null> {
    const row = this.activities.get(playerId);
    return row ? clone(row) : null;
  }

  private upsertActivity(row: ActiveActionData): void {
    this.activities.set(row.user_id, row);
    const idx = this.seed.activeActions.findIndex((a) => a.user_id === row.user_id);
    if (idx >= 0) this.seed.activeActions[idx] = row;
    else this.seed.activeActions.push(row);
  }

  async setActiveAction(playerId: string, nonce: string, input: SetActiveActionInput): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const kind = (input.activity_kind ?? '').trim() || 'idle_standby';
    if (!(ACTIVE_KINDS as readonly string[]).includes(kind)) {
      throw writeError(`Unsupported active action: ${kind}`);
    }
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const now = this.nowIso();
    const emptyToNull = (v: string | null | undefined) => (v === '' || v === undefined ? null : v);
    const row: ActiveActionData = {
      user_id: playerId,
      active_action: kind,
      started_at: now,
      completes_at: input.expected_finish_at ?? null,
      target_type: emptyToNull(input.target_type),
      target_id: emptyToNull(input.target_id),
      target_label: emptyToNull(input.target_label),
      scene_key: emptyToNull(input.scene_key),
      notes: emptyToNull(input.notes),
      activity_payload: clone(input.activity_payload ?? {}),
      public_payload: clone(input.public_payload ?? {}),
      last_heartbeat_at: now,
      public_visible: input.public_visible ?? true,
      schema_version: 1,
      updated_at: now,
    };
    this.upsertActivity(row);
    const result: Json = { action_type: 'cc_set_active_action', activity: this.activitySnapshot(row) };
    return this.record(playerId, 'cc_set_active_action', key, result);
  }

  async clearActiveAction(playerId: string, nonce: string): Promise<Json> {
    const key = this.cleanNonce(nonce);
    const prior = this.prior(playerId, key);
    if (prior) return prior;
    const now = this.nowIso();
    const row: ActiveActionData = {
      user_id: playerId,
      active_action: 'idle_standby',
      started_at: now,
      completes_at: null,
      target_type: null,
      target_id: null,
      target_label: null,
      scene_key: null,
      notes: null,
      activity_payload: {},
      public_payload: {},
      last_heartbeat_at: now,
      public_visible: true,
      schema_version: 1,
      updated_at: now,
    };
    this.upsertActivity(row);
    const result: Json = { action_type: 'cc_clear_active_action', activity: this.activitySnapshot(row) };
    return this.record(playerId, 'cc_clear_active_action', key, result);
  }

  async heartbeatActiveAction(playerId: string): Promise<Json> {
    const now = this.nowIso();
    let row = this.activities.get(playerId);
    if (row) {
      row.last_heartbeat_at = now;
      row.updated_at = now;
    } else {
      row = {
        user_id: playerId,
        active_action: 'idle_standby',
        started_at: now,
        completes_at: null,
        target_type: null,
        target_id: null,
        target_label: null,
        scene_key: null,
        notes: null,
        activity_payload: {},
        public_payload: {},
        last_heartbeat_at: now,
        public_visible: true,
        schema_version: 1,
        updated_at: now,
      };
      this.upsertActivity(row);
    }
    return { action_type: 'cc_active_action_heartbeat', activity: this.activitySnapshot(row) };
  }

  // -- profile ----------------------------------------------------------------

  async setUsername(playerId: string, username: string): Promise<{ ok: boolean; error?: string }> {
    const validationError = validateUsername(username);
    if (validationError) return { ok: false, error: validationError };
    const cleaned = (username ?? '').trim();
    const normalized = cleaned.toLowerCase();
    const p = this.profileOrNull(playerId);
    if (p?.username && p.username.trim().toLowerCase() === normalized) return { ok: true };
    if (p?.username && p.username_updated_at) {
      const cooldownEnd = new Date(new Date(p.username_updated_at).getTime() + 7 * 24 * 60 * 60 * 1000);
      if (this.nowFn().getTime() < cooldownEnd.getTime()) {
        return { ok: false, error: `You can rename again after ${cooldownEnd.toISOString()}.` };
      }
    }
    const taken =
      this.seed.usernameReservations.includes(normalized) ||
      [...this.profiles.values()].some(
        (other) => other.id !== playerId && other.username != null && other.username.trim().toLowerCase() === normalized,
      );
    if (taken) return { ok: false, error: 'That username is already taken.' };
    if (!p) return { ok: false, error: 'Profile not found.' };
    p.username = cleaned;
    p.username_updated_at = this.nowIso();
    p.username_change_count += 1;
    this.touch(p);
    return { ok: true };
  }

  async markReminderSeen(playerId: string): Promise<ProfileRowData> {
    const p = this.profile(playerId);
    p.verification_reminder_last_seen_at = this.nowIso();
    this.touch(p);
    return clone(p);
  }

  // -- runtime snapshots --------------------------------------------------------

  async getRuntimeSnapshot(playerId: string): Promise<Json | null> {
    const row = this.snapshots.get(playerId);
    return row ? clone(row.snapshot) : null;
  }

  async saveRuntimeSnapshot(playerId: string, snapshot: Json): Promise<void> {
    const now = this.nowIso();
    const existing = this.snapshots.get(playerId);
    if (existing) {
      existing.schema_version = 1;
      existing.snapshot = clone(snapshot);
      existing.updated_at = now;
    } else {
      const row: RuntimeSnapshotData = { user_id: playerId, schema_version: 1, snapshot: clone(snapshot), created_at: now, updated_at: now };
      this.snapshots.set(playerId, row);
      this.seed.runtimeSnapshots.push(row);
    }
  }

  async clearRuntimeSnapshot(playerId: string): Promise<void> {
    this.snapshots.delete(playerId);
    this.seed.runtimeSnapshots = this.seed.runtimeSnapshots.filter((s) => s.user_id !== playerId);
  }

  // -- combat stats -------------------------------------------------------------

  async getCombatStats(playerId: string): Promise<CombatStatsData | null> {
    const row = this.combatStats.get(playerId);
    return row ? clone(row) : null;
  }

  async saveCombatStats(playerId: string, row: CombatStatsData): Promise<void> {
    const stored: CombatStatsData = { ...clone(row), user_id: playerId };
    this.combatStats.set(playerId, stored);
    const idx = this.seed.combatStats.findIndex((s) => s.user_id === playerId);
    if (idx >= 0) this.seed.combatStats[idx] = stored;
    else this.seed.combatStats.push(stored);
  }
}
