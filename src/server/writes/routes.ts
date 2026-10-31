/**
 * Chef write routes (Route B, slice B3) — the write half of the old
 * Supabase surface, served by the Chef over Postgres.
 *
 * Route → client service → old Supabase call:
 *   POST /api/ops/initial-bundle            verifiedOps.ensureInitialBundle     cc_initial_bundle(nonce)
 *   POST /api/ops/make-item                 verifiedOps.makeItem                cc_make_item(nonce)
 *   POST /api/ops/claim-rewarded-cache-key  verifiedOps.claimRewardedCacheKey   cc_claim_rewarded_cache_key(...)
 *   POST /api/ops/vendor-buy                verifiedOps.vendorBuy               cc_vendor_buy(...)
 *   POST /api/ops/vendor-sell               verifiedOps.vendorSell*             cc_vendor_sell(...)
 *   POST /api/ops/claim-crafted-consumable  verifiedOps.claimCraftedConsumable  cc_claim_crafted_consumable(...)
 *   POST /api/ops/consume-consumable        verifiedOps.consumeConsumableItem   cc_consume_consumable(...)
 *   POST /api/ops/recycle-item              verifiedOps.recycleItem             cc_recycle_item(...)
 *   POST /api/ops/item-lock                 verifiedOps.setItemLock             cc_item_lock(...)
 *   POST /api/ops/equip-item                verifiedOps.equipItem               cc_equip_item(...)
 *   POST /api/ops/unequip-slot              verifiedOps.unequipSlot             cc_unequip_slot(...)
 *   POST /api/ops/refuel-vehicle            verifiedOps.refuelVehicle           cc_refuel_vehicle(...)
 *   POST /api/ops/use-patch-kit             verifiedOps.usePatchKit             cc_use_patch_kit(...)
 *   POST /api/ops/idle-claim                verifiedOps.claimIdleRewards        cc_idle_claim(nonce)
 *   POST /api/ops/retrain                   verifiedOps.retrainSkills           cc_retrain(nonce)
 *   POST /api/ops/train-skill               verifiedOps.trainSkill              cc_train_skill(...)
 *   POST /api/ops/battle-result             verifiedOps.recordBattleResult      cc_battle_result(...)
 *   POST /api/ops/market-create             verifiedOps.createMarketListing     cc_market_create(...)
 *   POST /api/ops/market-create-consumable  verifiedOps.marketCreateConsumable  cc_market_create_consumable(...)
 *   POST /api/ops/market-create-material    verifiedOps.marketCreateMaterial    cc_market_create_material(...)
 *   POST /api/ops/market-cancel             verifiedOps.cancelMarketListing     cc_market_cancel(...)
 *   POST /api/ops/market-accept             verifiedOps.acceptMarketListing     cc_accept_listing(...)
 *   POST /api/ops/service-request           verifiedOps.requestItemService      cc_item_service_request(...)
 *   POST /api/ops/service-accept            verifiedOps.acceptItemService       cc_item_service_accept(...)
 *   POST /api/ops/service-finish            verifiedOps.finishItemService       cc_item_job_finish(...)
 *   POST /api/ops/reset-progress            verifiedOps.resetProgress           cc_reset_progress(nonce)
 *   POST /api/push/register                 pushService                         cc_register_push_device(...)
 *   POST /api/push/disable                  pushService                         cc_disable_push_device(...)
 *   GET  /api/activity/me                   activityService.getMyActiveActivity  active_actions (own row)
 *   POST /api/activity/set                  activityService.setActiveAction     cc_set_active_action(...)
 *   POST /api/activity/clear                activityService.clearActiveAction   cc_clear_active_action(nonce)
 *   POST /api/activity/heartbeat            activityService.heartbeat           cc_active_action_heartbeat()
 *   POST /api/profile/set-username          usernameService.setUsername         cc_set_username(name)
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
  op('/api/ops/make-item', async (playerId, req) => store.makeItem(playerId, str(body(req).nonce)));
  op('/api/ops/claim-rewarded-cache-key', async (playerId, req) =>
    store.claimRewardedCacheKey(
      playerId,
      str(body(req).nonce),
      str(body(req).ad_unit_id),
      optStr(body(req).reward_source) ?? 'admob_rewarded',
    ),
  );
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
    return store.recycleItem(playerId, str(body(req).nonce), itemId);
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
    return store.refuelVehicle(playerId, str(body(req).nonce), cells);
  });
  op('/api/ops/use-patch-kit', async (playerId, req, res) => {
    const itemId = uuidField(req, res, 'item_id', 'item id');
    if (!itemId) return null;
    return store.usePatchKit(playerId, str(body(req).nonce), itemId);
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
  op('/api/ops/market-cancel', async (playerId, req, res) => {
    const listingId = uuidField(req, res, 'listing_id', 'listing id');
    if (!listingId) return null;
    return store.marketCancel(playerId, str(body(req).nonce), listingId);
  });
  op('/api/ops/market-accept', async (playerId, req, res) => {
    const listingId = uuidField(req, res, 'listing_id', 'listing id');
    if (!listingId) return null;
    return store.acceptListing(playerId, str(body(req).nonce), listingId);
  });
  op('/api/ops/service-request', async (playerId, req, res) => {
    const itemId = uuidField(req, res, 'item_id', 'item id');
    if (!itemId) return null;
    return store.requestItemService(playerId, str(body(req).nonce), itemId, optStr(body(req).service_id) ?? 'repair');
  });
  op('/api/ops/service-accept', async (playerId, req, res) => {
    const jobId = uuidField(req, res, 'job_id', 'job id');
    if (!jobId) return null;
    const price = numField(req, res, 'price_credits', 'price_credits value');
    if (price === null) return null;
    return store.acceptItemService(playerId, str(body(req).nonce), jobId, price, num(body(req).duration_minutes) ?? 60);
  });
  op('/api/ops/service-finish', async (playerId, req, res) => {
    const jobId = uuidField(req, res, 'job_id', 'job id');
    if (!jobId) return null;
    return store.finishItemService(playerId, str(body(req).nonce), jobId);
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
