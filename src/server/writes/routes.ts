/**
 * Chef write routes (Route B, slice B3) — the write half of the old
 * Supabase surface, served by the Chef over Postgres.
 *
 * Route → client service → old Supabase call:
 *   POST /api/ops/initial-bundle            verifiedOps.ensureInitialBundle     cc_initial_bundle(nonce)
 *   POST /api/ops/make-item                 verifiedOps.makeItem                cc_make_item(nonce, payment, ad_unit_id) — cache box lane (0037): daily budget, free-first payment (free / key / client-attested ad); the retired cc_claim_rewarded_cache_key route is gone
 *   POST /api/ops/vendor-buy                verifiedOps.vendorBuy               cc_vendor_buy(...)
 *   POST /api/ops/vendor-sell               verifiedOps.vendorSell*             cc_vendor_sell(...)
 *   POST /api/ops/claim-crafted-consumable  verifiedOps.claimCraftedConsumable  cc_claim_crafted_consumable(...)
 *   POST /api/ops/consume-consumable        verifiedOps.consumeConsumableItem   cc_consume_consumable(...)
 *   POST /api/ops/recycle-item              verifiedOps.recycleItem             cc_recycle_item(...)
 *   POST /api/ops/reforge-item              verifiedOps.reforgeItem             cc_reforge_item(...)
 *   POST /api/ops/slot-pull                 verifiedOps.slotPull                cc_slot_pull(...)
 *   POST /api/ops/item-lock                 verifiedOps.setItemLock             cc_item_lock(...)
 *   POST /api/ops/equip-item                verifiedOps.equipItem               cc_equip_item(...)
 *   POST /api/ops/unequip-slot              verifiedOps.unequipSlot             cc_unequip_slot(...)
 *   POST /api/ops/refuel-vehicle            verifiedOps.refuelVehicle           cc_refuel_vehicle(...)
 *   POST /api/ops/repair-enqueue            verifiedOps.enqueueRepairJob        cc_enqueue_repair_job(...)
 *   POST /api/ops/repair-post               verifiedOps.postRepairJob           cc_post_repair_job(...)
 *   POST /api/ops/repair-accept             verifiedOps.acceptRepairJob         cc_accept_repair_job(...)
 *   POST /api/ops/repair-finish             verifiedOps.finishRepairJob         cc_repair_job_finish(...)
 *   POST /api/ops/repair-cancel             verifiedOps.cancelRepairJob         cc_repair_job_cancel(...)
 *   POST /api/ops/repair-reclaim            verifiedOps.reclaimRepairJob        cc_repair_job_reclaim(...)
 *   GET  /api/repair/board                  verifiedOps.fetchRepairBoard        cc_settle_repair_jobs_for + board view
 *   POST /api/ops/shieldtech-enqueue        verifiedOps.enqueueShieldTechJob    cc_enqueue_shieldtech_job(...)
 *   POST /api/ops/shieldtech-post           verifiedOps.postShieldTechJob       cc_post_shieldtech_job(...)
 *   POST /api/ops/shieldtech-accept         verifiedOps.acceptShieldTechJob     cc_accept_shieldtech_job(...)
 *   POST /api/ops/shieldtech-finish         verifiedOps.finishShieldTechJob     cc_shieldtech_job_finish(...)
 *   POST /api/ops/shieldtech-cancel         verifiedOps.cancelShieldTechJob     cc_shieldtech_job_cancel(...)
 *   POST /api/ops/shieldtech-reclaim        verifiedOps.reclaimShieldTechJob    cc_shieldtech_job_reclaim(...)
 *   GET  /api/shieldtech/board              verifiedOps.fetchShieldTechBoard    cc_settle_shieldtech_jobs_for + board view
 *   POST /api/ops/idle-claim                verifiedOps.claimIdleRewards        cc_idle_claim(nonce)
 *   POST /api/ops/retrain                   verifiedOps.retrainSkills           cc_retrain(nonce)
 *   POST /api/ops/train-skill               verifiedOps.trainSkill              cc_train_skill(...)
 *   POST /api/ops/battle-result             verifiedOps.recordBattleResult      cc_battle_result(...)
 *   POST /api/ops/market-create             verifiedOps.createMarketListing     cc_market_create(...)
 *   POST /api/ops/market-create-consumable  verifiedOps.marketCreateConsumable  cc_market_create_consumable(...)
 *   POST /api/ops/market-create-material    verifiedOps.marketCreateMaterial    cc_market_create_material(...)
 *   POST /api/ops/market-create-fragment    verifiedOps.marketCreateFragment    cc_market_create_fragment(...)
 *   POST /api/ops/market-create-core        verifiedOps.marketCreateCore        cc_market_create_core(...)
 *   POST /api/ops/market-create-essence     verifiedOps.marketCreateEssence     cc_market_create_essence(...)
 *   POST /api/ops/market-cancel             verifiedOps.cancelMarketListing     cc_market_cancel(...)
 *   POST /api/ops/market-accept             verifiedOps.acceptMarketListing     cc_accept_listing(...)
 *   POST /api/ops/reset-progress            verifiedOps.resetProgress           cc_reset_progress(nonce)
 *   POST /api/push/register                 pushService                         cc_register_push_device(...)
 *   POST /api/push/disable                  pushService                         cc_disable_push_device(...)
 *   GET  /api/activity/me                   activityService.getMyActiveActivity  active_actions (own row)
 *   POST /api/activity/set                  activityService.setActiveAction     cc_set_active_action(...)
 *   POST /api/activity/clear                activityService.clearActiveAction   cc_clear_active_action(nonce)
 *   POST /api/activity/heartbeat            activityService.heartbeat           cc_active_action_heartbeat()
 *   POST /api/profile/set-username          usernameService.setUsername         cc_set_username(name)
 *   POST /api/profile/offline-cap           offlineCapService.setLimiter        cc_set_offline_cap_limiter(cap)
 *   POST /api/profile/mark-reminder-seen    verificationReminderService         cc_mark_reminder_seen()
 *   GET/PUT/DELETE /api/runtime/snapshot    runtimeStoreService                 player_runtime_snapshots (own row)
 *   GET/PUT /api/stats/combat               combatStatsService (B4)             combat_stats (own row; was a direct PostgREST table sync)
 *
 * Identity rules (hard): the caller's player id comes ONLY from the
 * verified Chef JWT (chefPlayerId). Body player ids are never read — the
 * ported cc_* functions take the JWT-derived id as p_player_id.
 * Responses are the functions' JSONB verbatim, matching today's RPC
 * result shapes so the B4 client cutover is a transport swap.
 */
import type { Express, Request, Response } from 'express';
import { chefPlayerId, type AuthConfig } from '../auth/routes';
import { WriteStoreError, type Json, type WriteStore } from './store';
import { discoveryEntriesForItem, type DiscoveryItemLike } from '../../content/collections';

/**
 * Collection discovery (0026): after a write op settles, record what
 * the RESULT's item proves (cache forge, market purchase). Entries
 * derive from the operation's own server-side result — never from
 * the request body. Log-and-continue: the op already settled.
 */
async function recordResultItemDiscoveries(
  store: WriteStore,
  playerId: string,
  result: Json,
  source: string,
): Promise<void> {
  try {
    const item = (result as Record<string, unknown> | null)?.item as DiscoveryItemLike | undefined;
    if (!item) return;
    const entries = discoveryEntriesForItem(item, source);
    if (entries.length > 0) await store.recordDiscoveries(playerId, entries);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[writes] Failed to record collection discoveries:', message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_BY_CODE: Record<string, number> = {
  unauthorized: 401,
  validation: 400,
  insufficient_funds: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

function unauthorized(res: Response): void {
  res.status(401).json({ error: 'unauthorized', message: 'A valid Chef access token is required' });
}

function validation(res: Response, message: string): void {
  res.status(400).json({ error: 'validation', message });
}

function fail(res: Response, err: unknown): void {
  if (err instanceof WriteStoreError) {
    res.status(STATUS_BY_CODE[err.code] ?? 400).json({ error: err.code, message: err.message });
    return;
  }
  console.error('[chef-writes] unexpected error', err);
  res.status(500).json({ error: 'internal', message: 'Something went wrong' });
}

/** Resolve the caller from the JWT or write the 401. Returns null if written. */
function caller(config: AuthConfig, req: Request, res: Response): string | null {
  const id = chefPlayerId(config, req);
  if (!id) {
    unauthorized(res);
    return null;
  }
  return id;
}

type Body = Record<string, unknown>;

function body(req: Request): Body {
  return (req.body ?? {}) as Body;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function uuidField(req: Request, res: Response, field: string, label: string): string | null {
  const value = str(body(req)[field]);
  if (!UUID_RE.test(value)) {
    validation(res, `A valid ${label} is required`);
    return null;
  }
  return value;
}

function numField(req: Request, res: Response, field: string, label: string): number | null {
  const value = num(body(req)[field]);
  if (value === null) {
    validation(res, `A valid ${label} is required`);
    return null;
  }
  return value;
}

export function mountWriteRoutes(app: Express, store: WriteStore, config: AuthConfig): void {
  const op = (path: string, run: (playerId: string, req: Request, res: Response) => Promise<Json | null>) => {
    app.post(path, async (req, res) => {
      const playerId = caller(config, req, res);
      if (!playerId) return;
      try {
        const result = await run(playerId, req, res);
        if (result !== null && !res.headersSent) res.json(result);
      } catch (err) {
        fail(res, err);
      }
    });
  };

  op('/api/ops/initial-bundle', async (playerId, req) => store.initialBundle(playerId, str(body(req).nonce)));
  op('/api/ops/make-item', async (playerId, req) => {
    const result = await store.makeItem(
      playerId,
      str(body(req).nonce),
      optStr(body(req).payment) ?? 'key',
      optStr(body(req).ad_unit_id) ?? null,
    );
    await recordResultItemDiscoveries(store, playerId, result, 'cache_forge');
    return result;
  });
  op('/api/ops/vendor-buy', async (playerId, req) =>
    store.vendorBuy(playerId, str(body(req).nonce), str(body(req).item_key), num(body(req).quantity) ?? 1),
  );
  op('/api/ops/vendor-sell', async (playerId, req, res) => {
    const kind = str(body(req).kind);
    if (kind === 'gear') {
      const itemId = uuidField(req, res, 'item_id', 'item id');
      if (!itemId) return null;
      return store.vendorSell(playerId, str(body(req).nonce), { kind, itemId });
    }
    if (kind === 'consumable') {
      const batchId = uuidField(req, res, 'batch_id', 'batch id');
      if (!batchId) return null;
      const quantity = numField(req, res, 'quantity', 'quantity value');
      if (quantity === null) return null;
      return store.vendorSell(playerId, str(body(req).nonce), { kind, batchId, quantity });
    }
    if (kind === 'material') {
      const quantity = numField(req, res, 'quantity', 'quantity value');
      if (quantity === null) return null;
      return store.vendorSell(playerId, str(body(req).nonce), {
        kind,
        materialId: str(body(req).material_id),
        quantity,
      });
    }
    validation(res, 'A valid sell kind is required');
    return null;
  });
  op('/api/ops/claim-crafted-consumable', async (playerId, req) =>
    store.claimCraftedConsumable(
      playerId,
      str(body(req).nonce),
      str(body(req).recipe_id),
      str(body(req).item_key),
      num(body(req).quantity) ?? 1,
    ),
  );
  // Crafting-as-occupation (0024): the server job model. The body
  // carries intent only (bench, recipe, units, rarity, catalyst/rush
  // toggles) — durations, quality bounds, XP and escrow are all
  // derived server-side from the catalog + profile + skill records.
  op('/api/ops/craft-enqueue', async (playerId, req, res) => {
    const bench = numField(req, res, 'bench', 'bench value');
    if (bench === null) return null;
    const units = numField(req, res, 'units', 'units value');
    if (units === null) return null;
    return store.enqueueCraftJob(playerId, str(body(req).nonce), {
      bench,
      recipeId: str(body(req).recipe_id),
      units,
      rarity: optStr(body(req).rarity),
      useCatalyst: body(req).use_catalyst === true,
      useCoreCatalyst: body(req).use_core_catalyst === true,
      useRushTicket: body(req).use_rush_ticket === true,
    });
  });
  op('/api/ops/craft-cancel', async (playerId, req, res) => {
    const jobId = uuidField(req, res, 'job_id', 'job id');
    if (!jobId) return null;
    return store.cancelCraftJob(playerId, str(body(req).nonce), jobId);
  });
  op('/api/ops/craft-unlock-bench', async (playerId, req) =>
    store.unlockCraftBench(playerId, str(body(req).nonce)),
  );
  op('/api/ops/craft-fit-tool', async (playerId, req, res) => {
    const bench = numField(req, res, 'bench', 'bench value');
    if (bench === null) return null;
    return store.fitWorkshopTool(
      playerId,
      str(body(req).nonce),
      bench,
      optStr(body(req).tool_id),
    );
  });
  // The Workshop state read: settles the player's jobs server-side,
  // then returns benches/tools/jobs/masteries in the one view shape.
  app.get('/api/workshop/me', async (req, res) => {
    const playerId = caller(config, req, res);
    if (!playerId) return;
    try {
      res.json(await store.getWorkshopState(playerId));
    } catch (err) {
      fail(res, err);
    }
  });
  // Mechanics & repair services (0025): self-repair is a timed job on
  // the craft machinery (the instant use-patch-kit op is retired);
  // the board is an open market — post at a set price with the full
  // price escrowed up front, any verified mechanic accepts and
  // supplies the kits. Bodies carry intent only; prices per point,
  // rates, restoration, fees and XP are all derived server-side.
  op('/api/ops/repair-enqueue', async (playerId, req, res) => {
    const itemId = uuidField(req, res, 'item_id', 'item id');
    if (!itemId) return null;
    const units = numField(req, res, 'units', 'units value');
    if (units === null) return null;
    return store.enqueueRepairJob(playerId, str(body(req).nonce), {
      itemId,
      kitType: str(body(req).item_key),
      units,
    });
  });
  op('/api/ops/repair-post', async (playerId, req, res) => {
    const itemId = uuidField(req, res, 'item_id', 'item id');
    if (!itemId) return null;
    const price = numField(req, res, 'price_credits', 'price_credits value');
    if (price === null) return null;
    const target = body(req).target_points;
    return store.postRepairJob(
      playerId,
      str(body(req).nonce),
      itemId,
      typeof target === 'number' && Number.isFinite(target) ? target : null,
      price,
    );
  });
  op('/api/ops/repair-accept', async (playerId, req, res) => {
    const jobId = uuidField(req, res, 'job_id', 'job id');
    if (!jobId) return null;
    return store.acceptRepairJob(playerId, str(body(req).nonce), jobId, str(body(req).item_key));
  });
  op('/api/ops/repair-finish', async (playerId, req, res) => {
    const jobId = uuidField(req, res, 'job_id', 'job id');
    if (!jobId) return null;
    return store.finishRepairJob(playerId, str(body(req).nonce), jobId);
  });
  op('/api/ops/repair-cancel', async (playerId, req, res) => {
    const jobId = uuidField(req, res, 'job_id', 'job id');
    if (!jobId) return null;
    return store.cancelRepairJob(playerId, str(body(req).nonce), jobId);
  });
  op('/api/ops/repair-reclaim', async (playerId, req, res) => {
    const jobId = uuidField(req, res, 'job_id', 'job id');
    if (!jobId) return null;
    return store.reclaimRepairJob(playerId, str(body(req).nonce), jobId);
  });
  // The repair board read: settles the caller's jobs (expiring stale
  // listings), then returns the shared board view.
  app.get('/api/repair/board', async (req, res) => {
    const playerId = caller(config, req, res);
    if (!playerId) return;
    try {
      res.json(await store.getRepairBoard(playerId));
    } catch (err) {
      fail(res, err);
    }
  });
  // Shield-tech services (0044): self-lane recalibration is a timed
  // job on the craft machinery; the board is an open market — post a
  // shield at a set price with the full price escrowed up front, any
  // verified tech accepts and supplies the Calibration Cores. The
  // accept body carries NO item_key: the core type is the server
  // constant 'CalibrationCore'. Bodies carry intent only; rates,
  // core counts, fees and XP are all derived server-side.
  op('/api/ops/shieldtech-enqueue', async (playerId, req, res) => {
    const itemId = uuidField(req, res, 'item_id', 'item id');
    if (!itemId) return null;
    return store.enqueueShieldTechJob(playerId, str(body(req).nonce), {
      itemId,
      toBehavior: str(body(req).to_behavior),
    });
  });
  op('/api/ops/shieldtech-post', async (playerId, req, res) => {
    const itemId = uuidField(req, res, 'item_id', 'item id');
    if (!itemId) return null;
    const price = numField(req, res, 'price_credits', 'price_credits value');
    if (price === null) return null;
    return store.postShieldTechJob(
      playerId,
      str(body(req).nonce),
      itemId,
      str(body(req).to_behavior),
      price,
    );
  });
  op('/api/ops/shieldtech-accept', async (playerId, req, res) => {
    const jobId = uuidField(req, res, 'job_id', 'job id');
    if (!jobId) return null;
    return store.acceptShieldTechJob(playerId, str(body(req).nonce), jobId);
  });
  op('/api/ops/shieldtech-finish', async (playerId, req, res) => {
    const jobId = uuidField(req, res, 'job_id', 'job id');
    if (!jobId) return null;
    return store.finishShieldTechJob(playerId, str(body(req).nonce), jobId);
  });
  op('/api/ops/shieldtech-cancel', async (playerId, req, res) => {
    const jobId = uuidField(req, res, 'job_id', 'job id');
    if (!jobId) return null;
    return store.cancelShieldTechJob(playerId, str(body(req).nonce), jobId);
  });
  op('/api/ops/shieldtech-reclaim', async (playerId, req, res) => {
    const jobId = uuidField(req, res, 'job_id', 'job id');
    if (!jobId) return null;
    return store.reclaimShieldTechJob(playerId, str(body(req).nonce), jobId);
  });
  // The shield-tech board read: settles the caller's jobs (expiring
  // stale listings), then returns the shared board view.
  app.get('/api/shieldtech/board', async (req, res) => {
    const playerId = caller(config, req, res);
    if (!playerId) return;
    try {
      res.json(await store.getShieldTechBoard(playerId));
    } catch (err) {
      fail(res, err);
    }
  });
  op('/api/ops/consume-consumable', async (playerId, req) =>
    store.consumeConsumable(
      playerId,
      str(body(req).nonce),
      str(body(req).item_key),
      num(body(req).quantity) ?? 1,
      optStr(body(req).activity_type),
      optStr(body(req).reason),
    ),
  );
  op('/api/ops/recycle-item', async (playerId, req, res) => {
    const itemId = uuidField(req, res, 'item_id', 'item id');
    if (!itemId) return null;
    const result = await store.recycleItem(playerId, str(body(req).nonce), itemId);
    // Salvaging proves the item was held: the collection log records
    // the salvaged item too (idempotent — most were already logged
    // when they dropped).
    await recordResultItemDiscoveries(store, playerId, result, 'salvage');
    return result;
  });
  // Reforge (0027): intent only — item + affix id. The store derives
  // the roll from the server item record through the shared affix
  // pools; the SQL applier prices, charges, and persists. No
  // discovery recording: reforging never changes an item's identity
  // (effect / frame), so the collection log is untouched by design.
  op('/api/ops/reforge-item', async (playerId, req, res) => {
    const itemId = uuidField(req, res, 'item_id', 'item id');
    if (!itemId) return null;
    return store.reforgeItem(playerId, str(body(req).nonce), itemId, str(body(req).affix_id));
  });
  // Data Slots (0049): intent only — a bet tier + nonce. The op
  // derives the levered bet, enforces the verified gate + daily
  // pull cap, draws server-side from the seeded slot_machine odds
  // table, and pays in the same transaction. The client animates
  // the returned outcome; it never rolls.
  op('/api/ops/slot-pull', async (playerId, req, res) => {
    const tier = numField(req, res, 'bet_tier', 'bet tier');
    if (tier === null) return null;
    return store.slotPull(playerId, str(body(req).nonce), tier);
  });
  op('/api/ops/item-lock', async (playerId, req, res) => {
    const itemId = uuidField(req, res, 'item_id', 'item id');
    if (!itemId) return null;
    return store.itemLock(playerId, str(body(req).nonce), itemId, body(req).locked === true);
  });
  op('/api/ops/equip-item', async (playerId, req, res) => {
    const itemId = uuidField(req, res, 'item_id', 'item id');
    if (!itemId) return null;
    return store.equipItem(playerId, str(body(req).nonce), itemId, str(body(req).slot_name));
  });
  op('/api/ops/unequip-slot', async (playerId, req) =>
    store.unequipSlot(playerId, str(body(req).nonce), str(body(req).slot_name)));
  op('/api/ops/refuel-vehicle', async (playerId, req, res) => {
    const cells = numField(req, res, 'cells', 'cells value');
    if (cells === null) return null;
    return store.refuelVehicle(
      playerId,
      str(body(req).nonce),
      cells,
      optStr(body(req).item_key) ?? undefined,
    );
  });
  op('/api/ops/idle-claim', async (playerId, req) => store.idleClaim(playerId, str(body(req).nonce)));
  // NOTE: /api/ops/claim-roaming (cc_claim_roaming_rewards) was removed
  // with the ticker's silent fallback — it paid stale flat rates and
  // existed only as that fallback's engine. Roaming claims go through
  // the Chef (/api/claim) only. The SQL function remains in the
  // database (migration 0004) as a deprecated, unrouted remnant.
  op('/api/ops/retrain', async (playerId, req) => store.retrain(playerId, str(body(req).nonce)));
  op('/api/ops/train-skill', async (playerId, req) =>
    store.trainSkill(playerId, str(body(req).nonce), str(body(req).node_id)),
  );
  op('/api/ops/battle-result', async (playerId, req) =>
    store.battleResult(playerId, str(body(req).nonce), str(body(req).target_id), optStr(body(req).stance) ?? 'balanced'),
  );
  op('/api/ops/market-create', async (playerId, req, res) => {
    const itemId = uuidField(req, res, 'item_id', 'item id');
    if (!itemId) return null;
    const price = numField(req, res, 'price_credits', 'price_credits value');
    if (price === null) return null;
    return store.marketCreate(playerId, str(body(req).nonce), itemId, price);
  });
  op('/api/ops/market-create-consumable', async (playerId, req, res) => {
    const batchId = uuidField(req, res, 'batch_id', 'batch id');
    if (!batchId) return null;
    const quantity = numField(req, res, 'quantity', 'quantity value');
    if (quantity === null) return null;
    const price = numField(req, res, 'price_credits', 'price_credits value');
    if (price === null) return null;
    return store.marketCreateConsumable(playerId, str(body(req).nonce), batchId, quantity, price);
  });
  op('/api/ops/market-create-material', async (playerId, req, res) => {
    const quantity = numField(req, res, 'quantity', 'quantity value');
    if (quantity === null) return null;
    const price = numField(req, res, 'price_credits', 'price_credits value');
    if (price === null) return null;
    return store.marketCreateMaterial(playerId, str(body(req).nonce), str(body(req).material_id), quantity, price);
  });
  op('/api/ops/market-create-fragment', async (playerId, req, res) => {
    const quantity = numField(req, res, 'quantity', 'quantity value');
    if (quantity === null) return null;
    const price = numField(req, res, 'price_credits', 'price_credits value');
    if (price === null) return null;
    return store.marketCreateFragment(playerId, str(body(req).nonce), quantity, price);
  });
  op('/api/ops/market-create-core', async (playerId, req, res) => {
    const quantity = numField(req, res, 'quantity', 'quantity value');
    if (quantity === null) return null;
    const price = numField(req, res, 'price_credits', 'price_credits value');
    if (price === null) return null;
    return store.marketCreateCore(playerId, str(body(req).nonce), quantity, price);
  });
  op('/api/ops/market-create-essence', async (playerId, req, res) => {
    const quantity = numField(req, res, 'quantity', 'quantity value');
    if (quantity === null) return null;
    const price = numField(req, res, 'price_credits', 'price_credits value');
    if (price === null) return null;
    return store.marketCreateEssence(playerId, str(body(req).nonce), str(body(req).essence_id), quantity, price);
  });
  op('/api/ops/market-cancel', async (playerId, req, res) => {
    const listingId = uuidField(req, res, 'listing_id', 'listing id');
    if (!listingId) return null;
    return store.marketCancel(playerId, str(body(req).nonce), listingId);
  });
  op('/api/ops/market-accept', async (playerId, req, res) => {
    const listingId = uuidField(req, res, 'listing_id', 'listing id');
    if (!listingId) return null;
    const result = await store.acceptListing(playerId, str(body(req).nonce), listingId);
    await recordResultItemDiscoveries(store, playerId, result, 'market_purchase');
    return result;
  });
  op('/api/ops/reset-progress', async (playerId, req) => store.resetProgress(playerId, str(body(req).nonce)));

  op('/api/push/register', async (playerId, req) =>
    store.registerPushDevice(playerId, str(body(req).token), optStr(body(req).platform) ?? 'android', optStr(body(req).app_version)),
  );
  op('/api/push/disable', async (playerId, req) => store.disablePushDevice(playerId, str(body(req).token)));

  app.get('/api/activity/me', async (req, res) => {
    const playerId = caller(config, req, res);
    if (!playerId) return;
    try {
      res.json(await store.getActiveActivity(playerId));
    } catch (err) {
      fail(res, err);
    }
  });
  op('/api/activity/set', async (playerId, req) =>
    store.setActiveAction(playerId, str(body(req).nonce), {
      activity_kind: str(body(req).activity_kind),
      target_type: optStr(body(req).target_type),
      target_id: optStr(body(req).target_id),
      target_label: optStr(body(req).target_label),
      scene_key: optStr(body(req).scene_key),
      notes: optStr(body(req).notes),
      expected_finish_at: optStr(body(req).expected_finish_at),
      activity_payload: (body(req).activity_payload as Json | undefined) ?? {},
      public_payload: (body(req).public_payload as Json | undefined) ?? {},
      public_visible: typeof body(req).public_visible === 'boolean' ? (body(req).public_visible as boolean) : undefined,
    }),
  );
  op('/api/activity/clear', async (playerId, req) => store.clearActiveAction(playerId, str(body(req).nonce)));
  op('/api/activity/heartbeat', async (playerId) => store.heartbeatActiveAction(playerId));

  // cc_set_username reports validation as data ({ok:false, error}), not an
  // exception — mirror the RPC: HTTP 200 with the payload either way.
  app.post('/api/profile/set-username', async (req, res) => {
    const playerId = caller(config, req, res);
    if (!playerId) return;
    try {
      res.json(await store.setUsername(playerId, str(body(req).username)));
    } catch (err) {
      fail(res, err);
    }
  });
  op('/api/profile/mark-reminder-seen', async (playerId) =>
    (await store.markReminderSeen(playerId)) as unknown as Json,
  );

  // cc_set_offline_cap_limiter (0023) also reports validation as data:
  // HTTP 200 with {ok:false, error} for an out-of-range limiter.
  // cap_hours may be null (clear the limiter) or an integer 1..24.
  app.post('/api/profile/offline-cap', async (req, res) => {
    const playerId = caller(config, req, res);
    if (!playerId) return;
    try {
      const raw = body(req).cap_hours;
      const capHours = raw === null || raw === undefined ? null : num(raw);
      res.json(await store.setOfflineCapLimiter(playerId, capHours));
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/runtime/snapshot', async (req, res) => {
    const playerId = caller(config, req, res);
    if (!playerId) return;
    try {
      res.json(await store.getRuntimeSnapshot(playerId));
    } catch (err) {
      fail(res, err);
    }
  });
  app.put('/api/runtime/snapshot', async (req, res) => {
    const playerId = caller(config, req, res);
    if (!playerId) return;
    const snapshot = body(req).snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      validation(res, 'A snapshot object is required');
      return;
    }
    try {
      await store.saveRuntimeSnapshot(playerId, snapshot as Json);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });
  app.delete('/api/runtime/snapshot', async (req, res) => {
    const playerId = caller(config, req, res);
    if (!playerId) return;
    try {
      await store.clearRuntimeSnapshot(playerId);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  // Combat stats (B4): the client's combatStats sync read/wrote the
  // combat_stats table directly through PostgREST. The row is the
  // caller's own (JWT-derived id; any user_id in the body is ignored)
  // and the column set is whitelisted here at the trust boundary.
  app.get('/api/stats/combat', async (req, res) => {
    const playerId = caller(config, req, res);
    if (!playerId) return;
    try {
      res.json(await store.getCombatStats(playerId));
    } catch (err) {
      fail(res, err);
    }
  });
  app.put('/api/stats/combat', async (req, res) => {
    const playerId = caller(config, req, res);
    if (!playerId) return;
    const b = body(req);
    const numMap = (value: unknown): Record<string, number> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      const out: Record<string, number> = {};
      for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const parsed = typeof raw === 'number' ? raw : Number(raw);
        if (Number.isFinite(parsed)) out[key] = parsed;
      }
      return out;
    };
    try {
      await store.saveCombatStats(playerId, {
        user_id: playerId,
        total_kills: num(b.total_kills) ?? 0,
        total_deaths: num(b.total_deaths) ?? 0,
        longest_kill_streak: num(b.longest_kill_streak) ?? 0,
        last_kill_at: optStr(b.last_kill_at),
        run_started_at: optStr(b.run_started_at),
        kills_by_area: numMap(b.kills_by_area),
        kills_by_weapon_type: numMap(b.kills_by_weapon_type),
        kills_by_boss: numMap(b.kills_by_boss),
        kills_by_element: numMap(b.kills_by_element),
        highest_boss_tier: num(b.highest_boss_tier) ?? 0,
        active_play_seconds: num(b.active_play_seconds) ?? 0,
        idle_play_seconds: num(b.idle_play_seconds) ?? 0,
        updated_at: optStr(b.updated_at) ?? new Date().toISOString(),
      });
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });
}
