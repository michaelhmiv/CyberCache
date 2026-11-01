/**
 * Contracts Board — rotating work orders (contracts-board slice,
 * migration 0042). Content owner for everything the board is: the
 * template taxonomy, level bands, targets, rewards, the seeded
 * generation, the lever surface, progress evaluation over server
 * facts, and the board view the Dashboard renders.
 *
 * The laws this file encodes (brief + DECISIONS.md):
 *
 *  - NOT ACHIEVEMENTS (R-adjacent, brief §2.11). Contracts are
 *    rotating work with soft rewards: they expire, they recur, and
 *    nothing permanent is gated behind them. No ranks, no lifetime
 *    tiers, no badges; Cache Rank never reads contract history.
 *  - R3 — CONTRACTS NEVER PAY LEGENDARY CORES. Salvage
 *    (cc_recycle_item) is the only core mint. Nor do contracts pay
 *    legendaries, gear, or XP (boss victories already pay ×50 XP;
 *    contracts redirect play, they are not a fourth occupation).
 *  - R4 — SEEDS: the daily set is GLOBAL PER LEVEL BAND
 *    (FNV-1a `<date>:<band>` — every player in a band sees the same
 *    three contracts; the board is a shared bulletin). The weekly
 *    set is PER-PLAYER seeded (FNV-1a `<player>:<iso-week>` — a
 *    global weekly would bottleneck one market corner at a time).
 *  - SERVER TRUTH ONLY. Progress folds from facts the server
 *    recorded (trigger-maintained stats with baselines frozen at
 *    issuance; window folds over tables/ledger for the rest). No
 *    request carries a progress value — there is no field for it.
 *  - ISSUED IS FROZEN. Target, reward, band, and baselines freeze
 *    into the instance at issuance; a later lever move never
 *    reprices an issued contract. A mid-period level-up never
 *    re-bands an issued set.
 *  - FORFEIT AT EXPIRY (Q3 default). Completion does not auto-pay;
 *    the claim tap is the reward beat, and an unclaimed contract
 *    whose window closes is gone — stated on the card from
 *    issuance ("Claim by … UTC"), per G-3.
 *  - REROLL IS THE SKIP (Q4 default). One free reroll per set;
 *    further rerolls cost scrap (100 daily / 400 weekly, levered),
 *    DESTROYED — a scrap sink beside reforge. A reroll draws a
 *    fresh contract with a fresh baseline; work toward the old
 *    one does not transfer. Completed-but-unclaimed contracts
 *    cannot be rerolled (claim it or let it expire).
 *  - KEYS LIVE ONLY IN THE WEEKLY FULL-SET BONUS (Q5 default):
 *    clearing all weeklies pays 1 cache key (lever
 *    contractWeeklyKeys) + one weekly contract's credits. Clearing
 *    all dailies pays +2 fragment parts. One key per week per
 *    player, maximum, from this whole system.
 *  - GUESTS SEE THE BOARD (Q6 default); claims are refused
 *    server-side (contracts mint rewards; guests keep the vendor
 *    on-ramp) with the standard account explanation.
 *  - FRAGMENTS: combat- and boss-family dailies pay 1 cache
 *    fragment part; Breakdown's daily pays 1 part too — the
 *    brief's own G-3 example prices it ("Breakdown: salvage 6
 *    items — pays 220 cr + 1 fragment" at B2, and 220 cr IS the
 *    B2 daily reward), so the template carries the part
 *    explicitly. Every weekly pays 3 parts. (The brief's §2.6
 *    drip estimate is approximate; the explicit per-template
 *    rules and its concrete example govern.)
 *
 * Generation is computed-on-read (the game's seeded law — hot
 * area, vendor rotation): no cron issues contracts. The draw
 * below is mirrored EXACTLY by cc_issue_contracts in migration
 * 0042 (same FNV-1a, same mulberry32, same pool order and
 * rejection rule); the SQL harness pins the two implementations
 * to identical sets for fixed seeds.
 */

// ─── Bands ───────────────────────────────────────────────────────────

export type ContractBandId = 'B1' | 'B2' | 'B3' | 'B4' | 'B5';

export interface ContractBand {
  id: ContractBandId;
  /** 1-based band index (the SQL twin's min_band unit). */
  index: number;
  minLevel: number;
  /** Inclusive top level; Number.POSITIVE_INFINITY for B5. */
  maxLevel: number;
  /** Multiplier on base targets (brief §2.5). */
  targetMultiplier: number;
  /** Per-contract credit reward at scalar 1.0 (brief §2.6). */
  dailyCredits: number;
  weeklyCredits: number;
}

export const CONTRACT_BANDS: ContractBand[] = [
  { id: 'B1', index: 1, minLevel: 1, maxLevel: 9, targetMultiplier: 0.5, dailyCredits: 120, weeklyCredits: 500 },
  { id: 'B2', index: 2, minLevel: 10, maxLevel: 24, targetMultiplier: 1, dailyCredits: 220, weeklyCredits: 900 },
  { id: 'B3', index: 3, minLevel: 25, maxLevel: 49, targetMultiplier: 1.5, dailyCredits: 350, weeklyCredits: 1400 },
  { id: 'B4', index: 4, minLevel: 50, maxLevel: 74, targetMultiplier: 2, dailyCredits: 500, weeklyCredits: 2000 },
  { id: 'B5', index: 5, minLevel: 75, maxLevel: Number.POSITIVE_INFINITY, targetMultiplier: 2.5, dailyCredits: 650, weeklyCredits: 2600 },
];

export function contractBandForLevel(level: number): ContractBand {
  const lv = Math.max(1, Math.trunc(level) || 1);
  return CONTRACT_BANDS.find((b) => lv >= b.minLevel && lv <= b.maxLevel) ?? CONTRACT_BANDS[CONTRACT_BANDS.length - 1];
}

export function contractBandById(id: string): ContractBand {
  return CONTRACT_BANDS.find((b) => b.id === id) ?? CONTRACT_BANDS[0];
}

// ─── Objective kinds, families, stat sources ─────────────────────────

export type ContractFamily = 'combat' | 'boss' | 'craft' | 'service' | 'market' | 'meta';

export type ContractObjectiveKind =
  | 'kills' | 'elites' | 'events' | 'roaming_xp'
  | 'boss_victories' | 'specific_boss'
  | 'endless_depth' | 'endless_runs'
  | 'crafts' | 'consumables_crafted' | 'refines'
  | 'points_restored'
  | 'seller_sales' | 'listings' | 'vendor_buys'
  | 'salvages' | 'reforges' | 'cache_opens' | 'consumables_used'
  | 'discoveries' | 'extraction_units';

/**
 * The standing stat each kind reads (player_stat_counters key), or
 * null for window-fold kinds. The three 0042 stats
 * (combat.roaming_kills, consumables.used, services.points_restored)
 * join the trigger-maintained family here.
 */
export const CONTRACT_STAT_KEYS: Record<ContractObjectiveKind, string | null> = {
  kills: 'combat.roaming_kills',
  elites: 'combat.elite_kills',
  events: 'roaming.events_fired',
  roaming_xp: 'combat.idle_xp_claimed',
  boss_victories: 'combat.boss_defeats',
  specific_boss: null,
  endless_depth: null,
  endless_runs: null,
  crafts: null,
  consumables_crafted: 'consumables_crafted',
  refines: null,
  points_restored: 'services.points_restored',
  seller_sales: null,
  listings: 'economy.market_listings',
  vendor_buys: 'economy.vendor_buys',
  salvages: 'inventory.recycle.count',
  reforges: 'actions.cc_reforge_item',
  cache_opens: 'inventory.cache_draws',
  consumables_used: 'consumables.used',
  discoveries: null,
  extraction_units: null,
};

// ─── Templates (the launch taxonomy, brief §2.3) ─────────────────────

export type ContractPeriodKind = 'daily' | 'weekly';

export interface ContractTemplate {
  id: string;
  /** Plain work-language name (the card's title stem). */
  name: string;
  family: ContractFamily;
  kind: ContractObjectiveKind;
  cadences: ContractPeriodKind[];
  /** First band the template may be issued in. */
  minBand: ContractBandId;
  /** Base targets (band multiplier applies), per cadence. */
  baseTargetDaily?: number;
  baseTargetWeekly?: number;
  /**
   * Per-band targets INSTEAD of base × multiplier — only the
   * Gauntlet (endless depth), whose targets are parameters of the
   * endless slice's shipped curve (brief §2.5): the #224
   * boundedness sims measured median depths with full Epic kits
   * of L10 4 / L30 8 / L60 5 / L100 4; dailies sit at an honest
   * run for a regular build under those medians, weeklies at
   * ~1.6× the daily.
   */
  targetByBand?: Record<ContractBandId, { daily?: number; weekly?: number }>;
  /** Fragment parts the DAILY contract pays (weeklies pay 3). */
  fragmentPartsDaily: number;
  paramKind: 'none' | 'boss';
  /** Plural unit for the G-3 progress line ("Salvages 4 / 6"). */
  unitLabel: string;
}

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  // Combat family.
  { id: 'field_work', name: 'Field Work', family: 'combat', kind: 'kills', cadences: ['daily', 'weekly'], minBand: 'B1', baseTargetDaily: 200, baseTargetWeekly: 1200, fragmentPartsDaily: 1, paramKind: 'none', unitLabel: 'kills' },
  { id: 'elite_hunt', name: 'Elite Hunt', family: 'combat', kind: 'elites', cadences: ['daily', 'weekly'], minBand: 'B1', baseTargetDaily: 1, baseTargetWeekly: 4, fragmentPartsDaily: 1, paramKind: 'none', unitLabel: 'elites downed' },
  { id: 'surge_watch', name: 'Surge Watch', family: 'combat', kind: 'events', cadences: ['weekly'], minBand: 'B1', baseTargetWeekly: 100, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'events triggered' },
  { id: 'long_haul', name: 'Long Haul', family: 'combat', kind: 'roaming_xp', cadences: ['daily', 'weekly'], minBand: 'B1', baseTargetDaily: 1000, baseTargetWeekly: 8000, fragmentPartsDaily: 1, paramKind: 'none', unitLabel: 'roaming XP' },
  { id: 'gauntlet', name: 'Gauntlet', family: 'combat', kind: 'endless_depth', cadences: ['daily', 'weekly'], minBand: 'B1', targetByBand: { B1: { daily: 2, weekly: 3 }, B2: { daily: 3, weekly: 5 }, B3: { daily: 5, weekly: 8 }, B4: { daily: 4, weekly: 6 }, B5: { daily: 3, weekly: 5 } }, fragmentPartsDaily: 1, paramKind: 'none', unitLabel: 'depth reached' },
  { id: 'gauntlet_regular', name: 'Gauntlet Regular', family: 'combat', kind: 'endless_runs', cadences: ['weekly'], minBand: 'B1', baseTargetWeekly: 3, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'endless runs' },
  // Boss family.
  { id: 'boss_contract', name: 'Boss Contract', family: 'boss', kind: 'boss_victories', cadences: ['daily', 'weekly'], minBand: 'B1', baseTargetDaily: 1, baseTargetWeekly: 3, fragmentPartsDaily: 1, paramKind: 'none', unitLabel: 'bosses defeated' },
  { id: 'named_bounty', name: 'Named Bounty', family: 'boss', kind: 'specific_boss', cadences: ['weekly'], minBand: 'B3', baseTargetWeekly: 1, fragmentPartsDaily: 0, paramKind: 'boss', unitLabel: 'bounty kills' },
  // Craft family.
  { id: 'production_order', name: 'Production Order', family: 'craft', kind: 'crafts', cadences: ['daily', 'weekly'], minBand: 'B1', baseTargetDaily: 4, baseTargetWeekly: 24, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'craft units' },
  { id: 'fine_work', name: 'Fine Work', family: 'craft', kind: 'consumables_crafted', cadences: ['daily'], minBand: 'B1', baseTargetDaily: 4, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'consumables crafted' },
  { id: 'refinery_shift', name: 'Refinery Shift', family: 'craft', kind: 'refines', cadences: ['weekly'], minBand: 'B1', baseTargetWeekly: 8, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'refine units' },
  { id: 'perfectionist', name: 'Perfectionist', family: 'craft', kind: 'reforges', cadences: ['weekly'], minBand: 'B3', baseTargetWeekly: 3, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'reforges' },
  // Service family.
  { id: 'service_record', name: 'Service Record', family: 'service', kind: 'points_restored', cadences: ['weekly'], minBand: 'B2', baseTargetWeekly: 150, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'condition points restored' },
  // Market family.
  { id: 'shopfront', name: 'Shopfront', family: 'market', kind: 'seller_sales', cadences: ['daily', 'weekly'], minBand: 'B2', baseTargetDaily: 1, baseTargetWeekly: 4, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'sales completed' },
  { id: 'open_for_business', name: 'Open for Business', family: 'market', kind: 'listings', cadences: ['daily'], minBand: 'B1', baseTargetDaily: 2, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'listings posted' },
  { id: 'supply_run', name: 'Supply Run', family: 'market', kind: 'vendor_buys', cadences: ['daily'], minBand: 'B1', baseTargetDaily: 3, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'vendor purchases' },
  // Meta family.
  { id: 'breakdown', name: 'Breakdown', family: 'meta', kind: 'salvages', cadences: ['daily', 'weekly'], minBand: 'B1', baseTargetDaily: 6, baseTargetWeekly: 36, fragmentPartsDaily: 1, paramKind: 'none', unitLabel: 'salvages' },
  { id: 'cache_work', name: 'Cache Work', family: 'meta', kind: 'cache_opens', cadences: ['daily', 'weekly'], minBand: 'B1', baseTargetDaily: 1, baseTargetWeekly: 3, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'caches opened' },
  { id: 'field_kit', name: 'Field Kit', family: 'meta', kind: 'consumables_used', cadences: ['daily'], minBand: 'B1', baseTargetDaily: 5, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'consumables used' },
  { id: 'archivist', name: 'Archivist', family: 'meta', kind: 'discoveries', cadences: ['weekly'], minBand: 'B1', baseTargetWeekly: 3, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'new discoveries' },
  { id: 'gathering_order', name: 'Gathering Order', family: 'meta', kind: 'extraction_units', cadences: ['daily', 'weekly'], minBand: 'B1', baseTargetDaily: 40, baseTargetWeekly: 240, fragmentPartsDaily: 0, paramKind: 'none', unitLabel: 'units gathered' },
];

export const CONTRACT_TEMPLATE_BY_ID = new Map(CONTRACT_TEMPLATES.map((t) => [t.id, t]));

/** Fragment parts every weekly contract pays (brief §2.6). */
export const CONTRACT_WEEKLY_FRAGMENT_PARTS = 3;
/** Fragment parts the daily full-set bonus pays (brief §2.6). */
export const CONTRACT_DAILY_SET_BONUS_PARTS = 2;
/** Family spread cap inside one set (brief §2.2). */
export const CONTRACT_FAMILY_CAP = 2;

// ─── Periods (UTC day / ISO week, the game's boundaries) ─────────────

/** UTC day key (YYYY-MM-DD) — the codebase's UTC-day convention. */
export function contractUtcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The period key for a date: the UTC day, or the ISO week's Monday. */
export function contractPeriodKey(kind: ContractPeriodKind, now: Date): string {
  const day = contractUtcDay(now);
  if (kind === 'daily') return day;
  const d = new Date(`${day}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const sinceMonday = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD day by whole UTC days. */
export function contractAddDays(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** [start, end) ISO instants of a period — the fold windows. */
export function contractPeriodWindow(kind: ContractPeriodKind, periodKey: string): { start: string; end: string } {
  const start = `${periodKey}T00:00:00.000Z`;
  const endDay = contractAddDays(periodKey, kind === 'daily' ? 1 : 7);
  return { start, end: `${endDay}T00:00:00.000Z` };
}

/** The claim-by line's deadline label (G-3). */
export function contractExpiryLabel(kind: ContractPeriodKind): string {
  return kind === 'daily' ? '00:00 UTC' : 'Monday 00:00 UTC';
}

/** True once the period's window has fully closed at `now`. */
export function contractPeriodExpired(kind: ContractPeriodKind, periodKey: string, now: Date): boolean {
  return now.toISOString() >= contractPeriodWindow(kind, periodKey).end;
}

// ─── Levers ──────────────────────────────────────────────────────────

export interface ContractLeverValues {
  /** Multiplies all contract credit/part rewards at issuance. */
  contractRewardScalar: number;
  /** Multiplies targets at issuance (difficulty brake/throttle). */
  contractTargetScalar: number;
  /** Daily set size. */
  contractDailyCount: number;
  /** Weekly set size. */
  contractWeeklyCount: number;
  /** Paid daily reroll price (scrap, destroyed). */
  contractRerollScrapDaily: number;
  /** Paid weekly reroll price (scrap, destroyed). */
  contractRerollScrapWeekly: number;
  /** Cache keys in the weekly full-set bonus. */
  contractWeeklyKeys: number;
}

export const CONTRACT_LEVER_DEFAULTS: ContractLeverValues = {
  contractRewardScalar: 1,
  contractTargetScalar: 1,
  contractDailyCount: 3,
  contractWeeklyCount: 5,
  contractRerollScrapDaily: 100,
  contractRerollScrapWeekly: 400,
  contractWeeklyKeys: 1,
};

/** Hard clamps per lever (brief §2.10) — the SQL call sites clamp identically. */
export const CONTRACT_LEVER_CLAMPS: Record<keyof ContractLeverValues, { min: number; max: number; integer?: boolean }> = {
  contractRewardScalar: { min: 0, max: 2 },
  contractTargetScalar: { min: 0.5, max: 2 },
  contractDailyCount: { min: 1, max: 5, integer: true },
  contractWeeklyCount: { min: 1, max: 8, integer: true },
  contractRerollScrapDaily: { min: 0, max: 1000, integer: true },
  contractRerollScrapWeekly: { min: 0, max: 5000, integer: true },
  contractWeeklyKeys: { min: 0, max: 3, integer: true },
};

function clampContractLever(key: keyof ContractLeverValues, value: number): number {
  const clamp = CONTRACT_LEVER_CLAMPS[key];
  const clamped = Math.min(clamp.max, Math.max(clamp.min, value));
  return clamp.integer ? Math.trunc(clamped) : clamped;
}

/** Merge raw lever values over the shipped defaults (the streak resolve shape). */
export function resolveContractLevers(partial?: Partial<ContractLeverValues> | null): ContractLeverValues {
  const values: ContractLeverValues = { ...CONTRACT_LEVER_DEFAULTS };
  if (!partial) return values;
  for (const key of Object.keys(CONTRACT_LEVER_DEFAULTS) as Array<keyof ContractLeverValues>) {
    const raw = partial[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      values[key] = clampContractLever(key, raw);
    }
  }
  return values;
}

// ─── Seeded generation (mirrored by cc_issue_contracts in 0042) ──────

/** FNV-1a 32-bit — the hash family the hot area and pixel layer use. */
export function contractFnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32 — the codebase's seeded RNG stream shape. */
export function contractMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed string a set draws from (R4 shapes, plus the reroll family). */
export function contractSetSeed(kind: ContractPeriodKind, periodKey: string, band: ContractBandId, playerId: string): string {
  return kind === 'daily'
    ? `contracts:daily:${periodKey}:${band}`
    : `contracts:weekly:${periodKey}:${playerId}`;
}

export interface ContractBossChoice {
  id: string;
  level: number;
}

/** Bosses a band can reach for Named Bounty params, in draw order. */
export function contractEligibleBosses(band: ContractBand, bosses: ContractBossChoice[]): ContractBossChoice[] {
  return bosses
    .filter((b) => b.level <= band.maxLevel)
    .sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface ContractDraw {
  template: ContractTemplate;
  params: { bossId?: string };
}

/**
 * Draw a set from a seed stream — THE generation algorithm, mirrored
 * statement-for-statement by the SQL issuer:
 *
 *   pool = eligible templates (cadence + band), sorted by id;
 *   repeat until the set is full or the pool is empty:
 *     pick index floor(rand() × pool.length);
 *     if the candidate's family already has CONTRACT_FAMILY_CAP
 *       members in the set, DISCARD it (the pick is consumed) and
 *       continue;
 *     else accept it; a boss-param template immediately draws its
 *       boss from the band-eligible list with the next rand().
 *
 * Excluded ids (rerolls) leave the pool before the first pick.
 */
export function drawContractSet(args: {
  seed: string;
  kind: ContractPeriodKind;
  band: ContractBand;
  count: number;
  bosses: ContractBossChoice[];
  excludeIds?: string[];
}): ContractDraw[] {
  const exclude = new Set(args.excludeIds ?? []);
  const pool = CONTRACT_TEMPLATES
    .filter((t) => t.cadences.includes(args.kind)
      && contractBandById(t.minBand).index <= args.band.index
      && !exclude.has(t.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rand = contractMulberry32(contractFnv1a(args.seed));
  const eligibleBosses = contractEligibleBosses(args.band, args.bosses);
  const set: ContractDraw[] = [];
  const familyCount = new Map<string, number>();
  const remaining = [...pool];
  while (set.length < args.count && remaining.length > 0) {
    const idx = Math.floor(rand() * remaining.length);
    const candidate = remaining[idx];
    remaining.splice(idx, 1);
    if ((familyCount.get(candidate.family) ?? 0) >= CONTRACT_FAMILY_CAP) continue;
    familyCount.set(candidate.family, (familyCount.get(candidate.family) ?? 0) + 1);
    const params: { bossId?: string } = {};
    if (candidate.paramKind === 'boss' && eligibleBosses.length > 0) {
      params.bossId = eligibleBosses[Math.floor(rand() * eligibleBosses.length)].id;
    }
    set.push({ template: candidate, params });
  }
  return set;
}

/** The reroll draw: one fresh contract from the slot's own stream. */
export function drawContractReroll(args: {
  kind: ContractPeriodKind;
  periodKey: string;
  band: ContractBand;
  playerId: string;
  slot: number;
  generation: number;
  bosses: ContractBossChoice[];
  /** Templates currently in the set (incl. the one being rerolled). */
  excludeIds: string[];
  /** The set's OTHER members, for the family-cap check. */
  setFamilies: ContractFamily[];
}): ContractDraw | null {
  const seed = `contracts:reroll:${args.kind}:${args.periodKey}:${args.playerId}:${args.slot}:${args.generation}`;
  const exclude = new Set(args.excludeIds);
  const pool = CONTRACT_TEMPLATES
    .filter((t) => t.cadences.includes(args.kind)
      && contractBandById(t.minBand).index <= args.band.index
      && !exclude.has(t.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rand = contractMulberry32(contractFnv1a(seed));
  const eligibleBosses = contractEligibleBosses(args.band, args.bosses);
  const familyCount = new Map<string, number>();
  for (const f of args.setFamilies) familyCount.set(f, (familyCount.get(f) ?? 0) + 1);
  const remaining = [...pool];
  while (remaining.length > 0) {
    const idx = Math.floor(rand() * remaining.length);
    const candidate = remaining[idx];
    remaining.splice(idx, 1);
    if ((familyCount.get(candidate.family) ?? 0) >= CONTRACT_FAMILY_CAP) continue;
    const params: { bossId?: string } = {};
    if (candidate.paramKind === 'boss' && eligibleBosses.length > 0) {
      params.bossId = eligibleBosses[Math.floor(rand() * eligibleBosses.length)].id;
    }
    return { template: candidate, params };
  }
  return null;
}

// ─── Targets & rewards at issuance ───────────────────────────────────

/** The frozen target for a drawn template at issuance. */
export function contractTargetFor(
  template: ContractTemplate,
  kind: ContractPeriodKind,
  band: ContractBand,
  levers: ContractLeverValues,
): number {
  let base: number;
  if (template.targetByBand) {
    base = template.targetByBand[band.id][kind] ?? 1;
    return Math.max(1, Math.round(base * levers.contractTargetScalar));
  }
  base = (kind === 'daily' ? template.baseTargetDaily : template.baseTargetWeekly) ?? 1;
  return Math.max(1, Math.round(base * band.targetMultiplier * levers.contractTargetScalar));
}

export interface ContractReward {
  credits: number;
  fragments: number;
}

/** The frozen reward for a drawn template at issuance. */
export function contractRewardFor(
  template: ContractTemplate,
  kind: ContractPeriodKind,
  band: ContractBand,
  levers: ContractLeverValues,
): ContractReward {
  const credits = Math.round(
    (kind === 'daily' ? band.dailyCredits : band.weeklyCredits) * levers.contractRewardScalar,
  );
  const parts = kind === 'daily' ? template.fragmentPartsDaily : CONTRACT_WEEKLY_FRAGMENT_PARTS;
  return { credits, fragments: Math.floor(parts * levers.contractRewardScalar) };
}

export interface ContractSetBonus {
  credits: number;
  fragments: number;
  cacheKeys: number;
}

/** The full-set bonus for a period kind at a band (brief §2.6). */
export function contractSetBonusFor(
  kind: ContractPeriodKind,
  band: ContractBand,
  levers: ContractLeverValues,
): ContractSetBonus {
  if (kind === 'daily') {
    return {
      credits: 0,
      fragments: Math.floor(CONTRACT_DAILY_SET_BONUS_PARTS * levers.contractRewardScalar),
      cacheKeys: 0,
    };
  }
  return {
    credits: Math.round(band.weeklyCredits * levers.contractRewardScalar),
    fragments: 0,
    cacheKeys: levers.contractWeeklyKeys,
  };
}

// ─── Instances & progress evaluation ─────────────────────────────────

export interface ContractInstanceRecord {
  id: string;
  periodKind: ContractPeriodKind;
  periodKey: string;
  slot: number;
  generation: number;
  templateId: string;
  params: { bossId?: string };
  target: number;
  /** Frozen stat baselines at issuance ({statKey: value}); empty for window kinds. */
  baseline: Record<string, number>;
  reward: ContractReward;
  status: 'active' | 'claimed' | 'rerolled';
  issuedAt: string;
  claimedAt: string | null;
}

/** Window-fold facts for one player + one period (server records). */
export interface ContractWindowFacts {
  crafts: number;
  refines: number;
  sellerSales: number;
  discoveries: number;
  endlessRuns: number;
  endlessBestDepth: number;
  extractionUnits: number;
  specificBossVictories: Record<string, number>;
}

export const EMPTY_CONTRACT_WINDOW_FACTS: ContractWindowFacts = {
  crafts: 0,
  refines: 0,
  sellerSales: 0,
  discoveries: 0,
  endlessRuns: 0,
  endlessBestDepth: 0,
  extractionUnits: 0,
  specificBossVictories: {},
};

/**
 * Progress for one instance from server facts — the TS evaluator,
 * mirrored by cc_contract_progress in SQL. Stat kinds diff the
 * standing counter against the frozen baseline (monotonic stats:
 * never negative); window kinds read the period fold (depth is a
 * MAX, the rest sums/counts).
 */
export function contractProgressFor(
  instance: Pick<ContractInstanceRecord, 'templateId' | 'params' | 'baseline'>,
  stats: Record<string, number>,
  windowFacts: ContractWindowFacts,
): number {
  const template = CONTRACT_TEMPLATE_BY_ID.get(instance.templateId);
  if (!template) return 0;
  const statKey = CONTRACT_STAT_KEYS[template.kind];
  if (statKey) {
    const current = stats[statKey] ?? 0;
    const baseline = instance.baseline[statKey] ?? 0;
    return Math.max(0, current - baseline);
  }
  switch (template.kind) {
    case 'specific_boss':
      return instance.params.bossId ? (windowFacts.specificBossVictories[instance.params.bossId] ?? 0) : 0;
    case 'endless_depth':
      return windowFacts.endlessBestDepth;
    case 'endless_runs':
      return windowFacts.endlessRuns;
    case 'crafts':
      return windowFacts.crafts;
    case 'refines':
      return windowFacts.refines;
    case 'seller_sales':
      return windowFacts.sellerSales;
    case 'discoveries':
      return windowFacts.discoveries;
    case 'extraction_units':
      return windowFacts.extractionUnits;
    default:
      return 0;
  }
}

// ─── Display text ────────────────────────────────────────────────────

/** The imperative objective phrase ("salvage 6 items"). */
export function contractObjectiveText(
  template: ContractTemplate,
  target: number,
  params: { bossId?: string },
  bossName?: string,
): string {
  switch (template.kind) {
    case 'kills': return `record ${target} roaming kills`;
    case 'elites': return `down ${target} named elites`;
    case 'events': return `trigger ${target} roaming events`;
    case 'roaming_xp': return `earn ${target} roaming XP`;
    case 'boss_victories': return `defeat ${target} ${target === 1 ? 'boss' : 'bosses'}`;
    case 'specific_boss': return `defeat ${bossName ?? params.bossId ?? 'the named boss'}`;
    case 'endless_depth': return `reach depth ${target} in one endless run`;
    case 'endless_runs': return `complete ${target} endless runs`;
    case 'crafts': return `complete ${target} craft units`;
    case 'consumables_crafted': return `craft ${target} consumables`;
    case 'refines': return `complete ${target} refine units`;
    case 'points_restored': return `restore ${target} condition points`;
    case 'seller_sales': return `complete ${target} sales as seller`;
    case 'listings': return `post ${target} listings`;
    case 'vendor_buys': return `buy ${target} from the vendor`;
    case 'salvages': return `salvage ${target} items`;
    case 'reforges': return `complete ${target} reforges`;
    case 'cache_opens': return `open ${target} caches`;
    case 'consumables_used': return `use ${target} consumables`;
    case 'discoveries': return `record ${target} new discoveries`;
    case 'extraction_units': return `gather ${target} materials or essences`;
    default: return `complete ${target}`;
  }
}

/** Compact reward label ("220 cr + 1 fragment" / "900 cr + key"). */
export function formatContractReward(reward: ContractReward & { cacheKeys?: number }): string {
  const parts: string[] = [];
  if (reward.credits > 0) parts.push(`${reward.credits} cr`);
  if (reward.fragments > 0) parts.push(reward.fragments === 1 ? '1 fragment' : `${reward.fragments} fragments`);
  if ((reward.cacheKeys ?? 0) > 0) {
    parts.push(reward.cacheKeys === 1 ? 'cache key' : `${reward.cacheKeys} cache keys`);
  }
  return parts.length > 0 ? parts.join(' + ') : '—';
}

// ─── Board view ──────────────────────────────────────────────────────

export interface ContractInstanceView {
  id: string;
  slot: number;
  templateId: string;
  /** Card title: "Breakdown: salvage 6 items". */
  title: string;
  family: ContractFamily;
  target: number;
  progress: number;
  complete: boolean;
  status: 'active' | 'claimed' | 'expired';
  reward: ContractReward;
  /** G-3 line: "Salvages 4 / 6 — pays 220 cr + 1 fragment · claim by 00:00 UTC". */
  progressLine: string;
  claimByLabel: string;
}

export interface ContractSetView {
  periodKind: ContractPeriodKind;
  periodKey: string;
  band: ContractBandId;
  contracts: ContractInstanceView[];
  claimedCount: number;
  setSize: number;
  /** The full-set bonus and whether it has been earned+paid. */
  setBonus: ContractSetBonus & { earned: boolean };
  setBonusLine: string;
  /** Reroll economics for the set's next reroll. */
  freeRerollAvailable: boolean;
  rerollCostScrap: number;
}

export interface ContractBoardView {
  /** Guests see the board; claims refuse server-side (Q6). */
  canClaim: boolean;
  daily: ContractSetView;
  weekly: ContractSetView;
}

export interface ContractSetFacts {
  band: ContractBandId;
  instances: Array<ContractInstanceRecord & { progress: number }>;
  rerollsUsed: number;
  setBonusClaimed: boolean;
}

function contractSetView(
  kind: ContractPeriodKind,
  periodKey: string,
  facts: ContractSetFacts,
  levers: ContractLeverValues,
  now: Date,
  bossName: (bossId: string) => string | undefined,
): ContractSetView {
  const band = contractBandById(facts.band);
  const expired = contractPeriodExpired(kind, periodKey, now);
  const claimBy = contractExpiryLabel(kind);
  const contracts: ContractInstanceView[] = facts.instances.map((inst) => {
    const template = CONTRACT_TEMPLATE_BY_ID.get(inst.templateId);
    const complete = inst.progress >= inst.target;
    const status: ContractInstanceView['status'] =
      inst.status === 'claimed' ? 'claimed' : expired ? 'expired' : 'active';
    const unit = template?.unitLabel ?? '';
    const unitTitle = unit ? unit.charAt(0).toUpperCase() + unit.slice(1) : 'Progress';
    return {
      id: inst.id,
      slot: inst.slot,
      templateId: inst.templateId,
      title: template
        ? `${template.name}: ${contractObjectiveText(template, inst.target, inst.params, inst.params.bossId ? bossName(inst.params.bossId) : undefined)}`
        : inst.templateId,
      family: template?.family ?? 'meta',
      target: inst.target,
      progress: Math.min(inst.progress, inst.target),
      complete,
      status,
      reward: inst.reward,
      progressLine: `${unitTitle} ${Math.min(inst.progress, inst.target)} / ${inst.target} — pays ${formatContractReward(inst.reward)} · claim by ${claimBy}`,
      claimByLabel: claimBy,
    };
  });
  const bonus = contractSetBonusFor(kind, band, levers);
  const claimedCount = facts.instances.filter((i) => i.status === 'claimed').length;
  const setBonusLine = kind === 'daily'
    ? `Clear all ${facts.instances.length} today: +${bonus.fragments} fragments`
    : `Clear all ${facts.instances.length} this week: ${formatContractReward({ credits: bonus.credits, fragments: 0, cacheKeys: bonus.cacheKeys })}`;
  return {
    periodKind: kind,
    periodKey,
    band: facts.band,
    contracts,
    claimedCount,
    setSize: facts.instances.length,
    setBonus: { ...bonus, earned: facts.setBonusClaimed },
    setBonusLine,
    freeRerollAvailable: facts.rerollsUsed < 1,
    rerollCostScrap: kind === 'daily' ? levers.contractRerollScrapDaily : levers.contractRerollScrapWeekly,
  };
}

/** Derive the board view from server facts. Pure — both store paths share it. */
export function contractBoardView(
  facts: { canClaim: boolean; daily: ContractSetFacts; weekly: ContractSetFacts },
  levers: ContractLeverValues,
  now: Date,
  bossName: (bossId: string) => string | undefined,
): ContractBoardView {
  return {
    canClaim: facts.canClaim,
    daily: contractSetView('daily', contractPeriodKey('daily', now), facts.daily, levers, now, bossName),
    weekly: contractSetView('weekly', contractPeriodKey('weekly', now), facts.weekly, levers, now, bossName),
  };
}
