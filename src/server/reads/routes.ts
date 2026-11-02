/**
 * Chef read routes (Route B, slice B2) — the read half of the old
 * Supabase surface, served by the Chef over Postgres.
 *
 * Route → client service → old Supabase call:
 *   GET /api/profile/me                  profileService.getProfile            profiles select * (own, RLS)
 *   GET /api/profile/summary             usernameService.getMyProfileSummary  cc_my_profile_summary()
 *   GET /api/progression/snapshots       progressionService.getMyProgressionSnapshots  player_progression_snapshots (own, RLS)
 *   GET /api/mastery/summary             masteryService.getMyMasterySummary   cc_my_mastery_summary()
 *   GET /api/mastery/leaderboard         masteryService.getMasteryLeaderboard cc_mastery_leaderboard(id, limit)
 *   GET /api/leaderboard                 leaderboardService.getLeaderboard    cc_get_leaderboard(metric, period, limit)
 *   GET /api/leaderboard/me              leaderboardService.getMyLeaderboardRank  cc_get_my_leaderboard_rank(metric, period)
 *   GET /api/players/:playerId/public-profile  publicProfileService.getPublicProfile  cc_get_public_profile(id)
 *   GET /api/stats/me                    statsService.getMyStatsSummary       cc_my_stats_summary()
 *   GET /api/players/:playerId/public-stats    statsService.getPublicStats    cc_public_stats(id)
 *   GET /api/usernames/availability      usernameService.isUsernameAvailable  cc_is_username_available(name)
 *   GET /api/market/listings             marketListings.fetchMarketListings  market_listings + item_instances embed (active, server browse query 0019)
 *   GET /api/market/price-stats          marketListings.fetchPriceStats     completed-sales stats per identity key (0019)
 *   GET /api/runtime/items               runtimeStateService.syncRuntimeItemsForUser  item_instances (own, RLS)
 *   GET /api/collections/me              CollectionsScreen                    collection_discoveries (own) + profiles.legendary_cores (0026)
 *   GET /api/caches/me                   ChestScreen (cache surface)          cache_box_openings (own, today) + profiles.cache_tokens (0037)
 *   GET /api/slots/me                    VendorScreen (Data Slots panel)      profiles.slot_pulls_* (own, today) + economy_config levers (0049)
 *   GET /api/profile/stats               ProfileScreen (trophy shelf)       lifetime fold over server records only (0034)
 *   GET /api/leaderboard/weekly          LeaderboardsScreen (weekly races)  weekly fold over server records + settlement outcomes (0035)
 *
 * Identity rules (hard): the caller's player id comes ONLY from the
 * verified Chef JWT (chefPlayerId). Query/body player ids are never read.
 * Every route requires a valid access token — the Supabase surface being
 * mirrored grants these reads to `authenticated` only (anon is revoked),
 * so B2 does not widen that. Routes that take a :playerId return only
 * the public projections, exactly as the RPCs do today.
 */
import type { Express, Request, Response } from 'express';
import { chefPlayerId, type AuthConfig } from '../auth/routes';
import {
  LEADERBOARD_METRICS, LEADERBOARD_PERIODS, ReadStoreError,
  type LeaderboardMetric, type LeaderboardPeriod, type ReadStore,
} from './store';
import {
  MARKET_SORTS,
  type MarketListingQuery,
  type MarketSort,
} from '../../lib/market/listingQuery';
import type { MarketCategory } from '../../lib/market/identityKey';

const MARKET_CATEGORIES: readonly string[] = [
  'weapon', 'shield', 'relic', 'classMod', 'ordnance', 'consumable', 'material',
  'fragment', 'core', 'essence',
];

/** Parse the 0019 browse query from query params; unknown values are ignored, never trusted raw. */
function parseMarketQuery(req: Request): MarketListingQuery {
  const q = req.query;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
  const num = (v: unknown): number | undefined => {
    const n = typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const category = str(q.category);
  const sort = str(q.sort);
  const sellerType = str(q.sellerType);
  const sellerId = str(q.sellerId);
  const excludeSellerId = str(q.excludeSellerId);
  return {
    search: str(q.search),
    category: category && MARKET_CATEGORIES.includes(category) ? (category as MarketCategory) : undefined,
    weaponType: str(q.weaponType),
    element: str(q.element),
    rarity: str(q.rarity),
    levelMin: num(q.levelMin),
    levelMax: num(q.levelMax),
    priceMin: num(q.priceMin),
    priceMax: num(q.priceMax),
    sellerType: sellerType === 'player' || sellerType === 'npc' ? sellerType : undefined,
    sellerId: sellerId && UUID_RE.test(sellerId) ? sellerId : undefined,
    excludeSellerId: excludeSellerId && UUID_RE.test(excludeSellerId) ? excludeSellerId : undefined,
    sort: sort && MARKET_SORTS.includes(sort as MarketSort) ? (sort as MarketSort) : undefined,
    limit: num(q.limit),
    offset: num(q.offset),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unauthorized(res: Response): void {
  res.status(401).json({ error: 'unauthorized', message: 'A valid Chef access token is required' });
}

function notFound(res: Response, what: string): void {
  res.status(404).json({ error: 'not_found', message: `${what} not found` });
}

function validation(res: Response, message: string): void {
  res.status(400).json({ error: 'validation', message });
}

function fail(res: Response, err: unknown): void {
  if (err instanceof ReadStoreError) {
    res.status(400).json({ error: err.code, message: err.message });
    return;
  }
  console.error('[chef-reads] unexpected error', err);
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

function targetPlayer(req: Request, res: Response): string | null {
  const playerId = req.params.playerId;
  if (!UUID_RE.test(playerId)) {
    validation(res, 'A valid player id is required');
    return null;
  }
  return playerId;
}

function parseMetric(req: Request, res: Response): LeaderboardMetric | null {
  const metric = typeof req.query.metric === 'string' ? req.query.metric : 'level';
  if (!LEADERBOARD_METRICS.includes(metric as LeaderboardMetric)) {
    validation(res, `Invalid leaderboard metric: ${metric}`);
    return null;
  }
  return metric as LeaderboardMetric;
}

function parsePeriod(req: Request, res: Response): LeaderboardPeriod | null {
  const period = typeof req.query.period === 'string' ? req.query.period : 'all_time';
  if (!LEADERBOARD_PERIODS.includes(period as LeaderboardPeriod)) {
    validation(res, `Invalid leaderboard period: ${period}`);
    return null;
  }
  return period as LeaderboardPeriod;
}

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

export function mountReadRoutes(app: Express, store: ReadStore, config: AuthConfig): void {
  // Collection log (0026): the caller's proven discoveries + legendary
  // core balance. The catalog is client content; this read carries
  // only the player's own server-side facts.
  app.get('/api/collections/me', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      const collections = await store.getCollections(id);
      if (!collections) return notFound(res, 'Profile');
      res.json(collections);
    } catch (err) { fail(res, err); }
  });

  // Cache box lane (0037): the caller's daily box budget — opened
  // today, remaining, whether the free box is still available, and
  // when the budget resets. Identity from the JWT only; the day is
  // the server's UTC day.
  app.get('/api/caches/me', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      const lane = await store.getCacheLane(id, new Date());
      if (!lane) return notFound(res, 'Profile');
      res.json(lane);
    } catch (err) { fail(res, err); }
  });

  // Data Slots (0049): the machine's display state — levered bet
  // tiers, the caller's pulls used / remaining today, and the cache
  // budget a key prize would charge. Identity from the JWT only.
  // Guests may read it (the machine is visible to everyone; the
  // pull op itself is verified-only).
  app.get('/api/slots/me', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      const state = await store.getSlotState(id, new Date());
      if (!state) return notFound(res, 'Profile');
      res.json(state);
    } catch (err) { fail(res, err); }
  });

  // Lifetime stats + trophy showcase (0034): every figure folds from
  // server records (ledger, discoveries, run/mission/job rows) — the
  // read carries only the caller's proven facts, never catalog data.
  app.get('/api/profile/stats', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      const stats = await store.getProfileStats(id);
      if (!stats) return notFound(res, 'Profile');
      res.json(stats);
    } catch (err) { fail(res, err); }
  });

  app.get('/api/profile/me', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      const profile = await store.getProfile(id);
      if (!profile) return notFound(res, 'Profile');
      res.json(profile);
    } catch (err) { fail(res, err); }
  });

  app.get('/api/profile/summary', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      const summary = await store.getMyProfileSummary(id);
      if (!summary) return notFound(res, 'Profile');
      res.json(summary);
    } catch (err) { fail(res, err); }
  });

  app.get('/api/progression/snapshots', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      const sources = typeof req.query.source === 'string'
        ? req.query.source.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
      res.json(await store.getMyProgressionSnapshots(id, {
        sources,
        since: typeof req.query.since === 'string' ? req.query.since : undefined,
        until: typeof req.query.until === 'string' ? req.query.until : undefined,
        limit: Number.isNaN(limitRaw) ? undefined : limitRaw,
      }));
    } catch (err) { fail(res, err); }
  });

  app.get('/api/mastery/summary', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      res.json(await store.getMyMasterySummary(id));
    } catch (err) { fail(res, err); }
  });

  app.get('/api/mastery/leaderboard', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    const masteryId = typeof req.query.masteryId === 'string' ? req.query.masteryId : '';
    if (!masteryId) return validation(res, 'A masteryId query parameter is required');
    try {
      res.json(await store.getMasteryLeaderboard(masteryId, parseLimit(req.query.limit, 25, 100)));
    } catch (err) { fail(res, err); }
  });

  app.get('/api/leaderboard', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    const metric = parseMetric(req, res);
    if (!metric) return;
    const period = parsePeriod(req, res);
    if (!period) return;
    try {
      res.json(await store.getLeaderboard(metric, period, parseLimit(req.query.limit, 100, 1000)));
    } catch (err) { fail(res, err); }
  });

  app.get('/api/leaderboard/me', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    const metric = parseMetric(req, res);
    if (!metric) return;
    const period = parsePeriod(req, res);
    if (!period) return;
    try {
      const rank = await store.getMyLeaderboardRank(id, metric, period);
      if (!rank) return notFound(res, 'Leaderboard rank');
      res.json(rank);
    } catch (err) { fail(res, err); }
  });

  // Weekly race boards (0035): current week's live standings folded
  // from server records + last week's finals and the caller's own
  // reward outcome. Identity from the JWT only — no player id is
  // read from the request anywhere in this payload.
  app.get('/api/leaderboard/weekly', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      const boards = await store.getWeeklyLeaderboards(id, new Date());
      if (!boards) return notFound(res, 'Profile');
      res.json(boards);
    } catch (err) { fail(res, err); }
  });

  app.get('/api/players/:playerId/public-profile', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    const target = targetPlayer(req, res);
    if (!target) return;
    try {
      const profile = await store.getPublicProfile(target);
      if (!profile) return notFound(res, 'Player');
      res.json(profile);
    } catch (err) { fail(res, err); }
  });

  app.get('/api/stats/me', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      const stats = await store.getMyStats(id);
      if (!stats) return notFound(res, 'Stats');
      res.json(stats);
    } catch (err) { fail(res, err); }
  });

  app.get('/api/players/:playerId/public-stats', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    const target = targetPlayer(req, res);
    if (!target) return;
    try {
      const stats = await store.getPublicStats(target);
      if (!stats) return notFound(res, 'Player');
      res.json(stats);
    } catch (err) { fail(res, err); }
  });

  app.get('/api/usernames/availability', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    const username = typeof req.query.username === 'string' ? req.query.username : null;
    if (username === null) return validation(res, 'A username query parameter is required');
    try {
      res.json({ username, available: await store.isUsernameAvailable(username) });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/market/listings', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      res.json(await store.getActiveMarketListings(parseMarketQuery(req)));
    } catch (err) { fail(res, err); }
  });

  app.get('/api/market/price-stats', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    const raw = typeof req.query.keys === 'string' ? req.query.keys : '';
    const keys = [...new Set(raw.split(',').map((k) => k.trim()).filter(Boolean))].slice(0, 100);
    try {
      res.json({ stats: await store.getMarketPriceStats(keys) });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/runtime/items', async (req, res) => {
    const id = caller(config, req, res);
    if (!id) return;
    try {
      res.json(await store.getMyRuntimeItems(id));
    } catch (err) { fail(res, err); }
  });
}
