/**
 * Product analytics — GA4 via Firebase Analytics. This module is the
 * ONE owner of product telemetry for the client (ARCHITECTURE.md's
 * one-owner rule applied to a cross-cutting concern): every screen
 * and service reports through the small typed functions below and
 * never touches the Firebase SDK directly.
 *
 * What this feeds: the GA4 property linked to the Firebase project
 * (`cybercache-29881`) — its standard reports (active users
 * DAU/WAU/MAU, retention cohorts, engagement) come from the SDK's
 * automatic collection; this module adds the game's own vocabulary
 * on top: screen views for the four tabs + the major doors, and one
 * custom event per core-loop verb.
 *
 * HOW TO ADD AN EVENT (one-liner rule):
 *   1. Add a typed `trackX` function below that calls `send('x', …)`.
 *   2. Call it from the ONE place the action settles (the verified
 *      op, the store action, the Chef client function) — never from
 *      a render path, never speculatively before the server confirms.
 *   3. Snake_case name, minimal typed params, NO free text.
 *
 * PRIVACY LAW (do not break):
 *   - No PII, ever: no emails, no usernames, no raw user/account ids
 *     in event params. Firebase's own pseudonymous app-instance id is
 *     the only identity GA4 sees.
 *   - Params are ids of CONTENT (area, boss, recipe, listing kind,
 *     slot) and small enums/numbers — nothing a player typed.
 *   - Analytics is never a gate: guests are measured exactly like
 *     linked accounts (Guest Visibility Law), and a failed or absent
 *     analytics config must never break, block, or delay gameplay.
 *     Every public function here is fire-and-forget and total: it
 *     cannot throw into a caller.
 *
 * CONFIG (the repo's VITE_* env pattern — see .env.example):
 *   VITE_FIREBASE_API_KEY / VITE_FIREBASE_PROJECT_ID /
 *   VITE_FIREBASE_APP_ID / VITE_FIREBASE_MEASUREMENT_ID
 *     — the Firebase web-app config for project cybercache-29881.
 *     Until ALL four are present in the build env, analytics is a
 *     silent no-op (status 'unconfigured'): nothing is faked, no
 *     placeholder id is shipped.
 *   VITE_ANALYTICS_ENABLED=false — force collection off in any build.
 *   VITE_ANALYTICS_DEBUG=true, a dev build, or `?analytics_debug=1`
 *     in the page URL — events carry GA4's debug flag and appear in
 *     the GA4 console's DebugView within seconds (the verification
 *     path; see the PR notes).
 *
 * The SDK is loaded with a dynamic import inside initAnalytics():
 * merely importing this module (as every verified op and store now
 * does) must never execute Firebase code — tests, SSR-ish contexts,
 * and unconfigured builds stay untouched by it.
 */
import { Capacitor } from '@capacitor/core';
import type { Analytics } from 'firebase/analytics';

/** The firebase/analytics module surface this wrapper drives (type-only). */
type FirebaseAnalyticsModule = typeof import('firebase/analytics');

/** Documented screen names (DESIGN.md §2 four tabs + §9 doors). */
export type ScreenName =
  | 'Home' | 'Gear' | 'Market' | 'Hunter'
  | 'Workshop' | 'Boss' | 'Endless' | 'Garage' | 'Standings' | 'Cache'
  | 'Dispatch' | 'Collections' | 'Settings' | 'Help';

export type SignInMethod = 'google' | 'email';
export type AccountTypeProperty = 'guest' | 'linked';
export type CacheOpenSource = 'free' | 'ad' | 'key';
export type BossAttemptResult = 'victory' | 'defeat';

export interface FirebaseWebConfig {
  apiKey: string;
  projectId: string;
  appId: string;
  measurementId: string;
  authDomain?: string;
  messagingSenderId?: string;
  storageBucket?: string;
}

type AnalyticsStatus =
  | 'idle' | 'initializing' | 'ready'
  | 'unconfigured' | 'disabled' | 'unsupported' | 'failed';

interface QueuedEvent {
  name: string;
  params?: Record<string, string | number | boolean>;
}

const MAX_QUEUED_EVENTS = 100;
/** A craft completion observed this long after it happened still counts as news. */
const CRAFT_COMPLETION_FRESH_MS = 10 * 60 * 1000;

interface AnalyticsState {
  status: AnalyticsStatus;
  sdk: FirebaseAnalyticsModule | null;
  instance: Analytics | null;
  debug: boolean;
  queue: QueuedEvent[];
  pendingProps: Record<string, string>;
  lastScreen: ScreenName | null;
  lastLevel: number | null;
  lastLevelBand: string | null;
  seenActiveCraftJobs: Set<string>;
  reportedCraftJobs: Set<string>;
  reportedEndlessRuns: Set<string>;
}

const freshState = (): AnalyticsState => ({
  status: 'idle',
  sdk: null,
  instance: null,
  debug: false,
  queue: [],
  pendingProps: {},
  lastScreen: null,
  lastLevel: null,
  lastLevelBand: null,
  seenActiveCraftJobs: new Set(),
  reportedCraftJobs: new Set(),
  reportedEndlessRuns: new Set(),
});

let state = freshState();

/* ------------------------------------------------------------------ */
/* Config resolution (pure, injectable — the nativeAuth.ts pattern)    */
/* ------------------------------------------------------------------ */

const envString = (env: ImportMetaEnv, key: string): string => {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
};

/**
 * The Firebase web config from env, or null when any required value
 * is missing. Null is a first-class outcome (analytics off), never
 * an error and never papered over with a placeholder.
 */
export function resolveAnalyticsConfig(env: ImportMetaEnv = import.meta.env): FirebaseWebConfig | null {
  const apiKey = envString(env, 'VITE_FIREBASE_API_KEY');
  const projectId = envString(env, 'VITE_FIREBASE_PROJECT_ID');
  const appId = envString(env, 'VITE_FIREBASE_APP_ID');
  const measurementId = envString(env, 'VITE_FIREBASE_MEASUREMENT_ID');
  if (!apiKey || !projectId || !appId || !measurementId) return null;
  const config: FirebaseWebConfig = { apiKey, projectId, appId, measurementId };
  const authDomain = envString(env, 'VITE_FIREBASE_AUTH_DOMAIN');
  const messagingSenderId = envString(env, 'VITE_FIREBASE_MESSAGING_SENDER_ID');
  const storageBucket = envString(env, 'VITE_FIREBASE_STORAGE_BUCKET');
  if (authDomain) config.authDomain = authDomain;
  if (messagingSenderId) config.messagingSenderId = messagingSenderId;
  if (storageBucket) config.storageBucket = storageBucket;
  return config;
}

/** VITE_ANALYTICS_ENABLED=false is the owner's kill switch for any build. */
export function isAnalyticsDisabledByConfig(env: ImportMetaEnv = import.meta.env): boolean {
  return envString(env, 'VITE_ANALYTICS_ENABLED').toLowerCase() === 'false';
}

/**
 * DebugView flag: explicit env opt-in, any dev build, or the
 * `?analytics_debug` URL param on the running page.
 */
export function isAnalyticsDebugEnabled(
  env: ImportMetaEnv = import.meta.env,
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  if (envString(env, 'VITE_ANALYTICS_DEBUG').toLowerCase() === 'true') return true;
  if (env.DEV === true) return true;
  return /[?&]analytics_debug(=|&|$)/.test(search);
}

/** Coarse level bands for the level_band user property (never raw funnels per level). */
export function levelBandFor(level: number): string {
  if (level >= 100) return '100+';
  if (level >= 75) return '75-99';
  if (level >= 50) return '50-74';
  if (level >= 25) return '25-49';
  if (level >= 10) return '10-24';
  return '1-9';
}

export function platformProperty(): 'android' | 'web' {
  try {
    return Capacitor.isNativePlatform() ? 'android' : 'web';
  } catch {
    return 'web';
  }
}

/** Current lifecycle status — for tests and diagnostics, not gameplay. */
export function analyticsStatus(): AnalyticsStatus {
  return state.status;
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

function applyUserProperties(props: Record<string, string>): void {
  if (state.status !== 'ready' || !state.sdk || !state.instance) {
    Object.assign(state.pendingProps, props);
    return;
  }
  try {
    state.sdk.setUserProperties(state.instance, props);
  } catch {
    // Telemetry must never surface an error into the game.
  }
}

function send(name: string, params?: Record<string, string | number | boolean>): void {
  if (state.status === 'ready' && state.sdk && state.instance) {
    try {
      state.sdk.logEvent(state.instance, name, state.debug ? { ...params, debug_mode: true } : params);
    } catch {
      // Telemetry must never surface an error into the game.
    }
    return;
  }
  if (state.status === 'idle' || state.status === 'initializing') {
    // Pre-init events (guest_start / sign_in land during boot) are
    // queued in order and flushed when the SDK is ready; in every
    // terminal-off state they are dropped silently instead.
    if (state.queue.length < MAX_QUEUED_EVENTS) state.queue.push({ name, params });
  }
}

function flushQueue(): void {
  const queued = state.queue;
  state.queue = [];
  for (const event of queued) send(event.name, event.params);
  const pending = state.pendingProps;
  state.pendingProps = {};
  if (Object.keys(pending).length > 0) applyUserProperties(pending);
}

/**
 * Initialize Firebase Analytics exactly once. Safe to call from any
 * mount effect: unconfigured, disabled, unsupported, and non-browser
 * contexts all resolve to a silent no-op status.
 */
export function initAnalytics(): void {
  if (state.status !== 'idle') return;
  const env = import.meta.env;
  if (isAnalyticsDisabledByConfig(env)) {
    state.status = 'disabled';
    state.queue = [];
    return;
  }
  const config = resolveAnalyticsConfig(env);
  if (!config) {
    state.status = 'unconfigured';
    state.queue = [];
    return;
  }
  if (typeof window === 'undefined') {
    state.status = 'unsupported';
    state.queue = [];
    return;
  }
  state.debug = isAnalyticsDebugEnabled(env);
  state.status = 'initializing';
  void (async () => {
    try {
      const appModule = await import('firebase/app');
      const analyticsModule: FirebaseAnalyticsModule = await import('firebase/analytics');
      if (!(await analyticsModule.isSupported())) {
        state.status = 'unsupported';
        state.queue = [];
        return;
      }
      const app = appModule.initializeApp(config);
      state.instance = analyticsModule.getAnalytics(app);
      state.sdk = analyticsModule;
      state.status = 'ready';
      applyUserProperties({ platform: platformProperty() });
      flushQueue();
    } catch (error) {
      state.status = 'failed';
      state.queue = [];
      // The one place analytics may speak: a console warning, never UI.
      console.warn('[analytics] initialization failed; telemetry off for this session.', error);
    }
  })();
}

/* ------------------------------------------------------------------ */
/* User properties                                                     */
/* ------------------------------------------------------------------ */

/** account_type property: set on every account load (restore + sign-in alike). */
export function setAccountTypeProperty(accountType: AccountTypeProperty): void {
  applyUserProperties({ account_type: accountType });
}

/**
 * Feed the player store's level here (App subscribes once). The
 * first observation is the session baseline — a restored level-40
 * account must NOT fire level_up — later increases fire level_up
 * once per sync and keep the level_band property current.
 */
export function observePlayerLevel(level: number): void {
  if (!Number.isFinite(level) || level < 1) return;
  const band = levelBandFor(level);
  if (state.lastLevel === null) {
    state.lastLevel = level;
    state.lastLevelBand = band;
    applyUserProperties({ level_band: band });
    return;
  }
  if (level > state.lastLevel) {
    state.lastLevel = level;
    send('level_up', { level });
  }
  if (band !== state.lastLevelBand) {
    state.lastLevelBand = band;
    applyUserProperties({ level_band: band });
  }
}

/* ------------------------------------------------------------------ */
/* Screen tracking                                                     */
/* ------------------------------------------------------------------ */

/** screen_view for the visible surface; consecutive duplicates are suppressed. */
export function trackScreen(screenName: ScreenName): void {
  if (state.lastScreen === screenName) return;
  state.lastScreen = screenName;
  send('screen_view', { firebase_screen_name: screenName, screen_name: screenName });
}

/* ------------------------------------------------------------------ */
/* Custom events — the v1 taxonomy (snake_case, minimal typed params)  */
/* ------------------------------------------------------------------ */

export function trackSignIn(method: SignInMethod): void {
  send('sign_in', { method });
}

export function trackGuestStart(): void {
  send('guest_start');
}

export function trackRoamStart(area: string): void {
  send('roam_start', { area });
}

export function trackRoamStop(): void {
  send('roam_stop');
}

export function trackBossAttempt(boss: string, result: BossAttemptResult): void {
  send('boss_attempt', { boss, result });
}

export function trackCraftQueue(recipe: string): void {
  send('craft_queue', { recipe });
}

export function trackCraftComplete(recipe: string): void {
  send('craft_complete', { recipe });
}

export function trackMarketBuy(kind: string): void {
  send('market_buy', { kind });
}

export function trackMarketList(kind: string): void {
  send('market_list', { kind });
}

export function trackCacheOpen(source: CacheOpenSource): void {
  send('cache_open', { source });
}

export function trackSalvage(count: number): void {
  if (Number.isFinite(count) && count > 0) send('salvage', { count });
}

export function trackEquip(slot: string): void {
  send('equip', { slot });
}

/**
 * endless_run fires exactly once per ENDED run (bank, death, cap, or
 * a run abandoned by starting another), keyed by run id so the
 * several settlement paths can never double-count one run.
 */
export function trackEndlessRunEnd(runId: string, depth: number): void {
  if (!runId || state.reportedEndlessRuns.has(runId)) return;
  if (!Number.isFinite(depth) || depth < 0) return;
  state.reportedEndlessRuns.add(runId);
  send('endless_run', { depth });
}

/** The workshop half of the taxonomy: the slice's server-view shape, structurally. */
export interface CraftJobObservation {
  id: string;
  recipeId: string;
  state: 'running' | 'queued' | 'paused' | 'complete' | 'cancelled';
  completedAtMs: number | null;
}

export interface CraftCompletionObservation {
  jobId: string;
  recipeId: string;
}

/**
 * Diff one workshop server view for craft completions. A completion
 * is news when the job was seen in a non-complete state earlier this
 * session, or when it completed within the freshness window (the
 * Workshop's 15s mirror poll can straddle a settle). Anything older
 * is history absorbed silently, so logging in never replays a
 * backlog of craft_complete events. Call from the workshop store's
 * refresh — the one place new views land.
 */
export function trackCraftCompletions(
  view: { jobs: CraftJobObservation[]; recentCompletions?: CraftCompletionObservation[] },
  now: number = Date.now(),
): void {
  for (const job of view.jobs) {
    if (job.state !== 'complete') {
      state.seenActiveCraftJobs.add(job.id);
      continue;
    }
    if (state.reportedCraftJobs.has(job.id)) continue;
    state.reportedCraftJobs.add(job.id);
    const fresh = typeof job.completedAtMs === 'number'
      && job.completedAtMs <= now + 60_000
      && now - job.completedAtMs <= CRAFT_COMPLETION_FRESH_MS;
    if (state.seenActiveCraftJobs.has(job.id) || fresh) {
      trackCraftComplete(job.recipeId);
    }
  }
  for (const completion of view.recentCompletions ?? []) {
    if (state.reportedCraftJobs.has(completion.jobId)) continue;
    if (!state.seenActiveCraftJobs.has(completion.jobId)) continue;
    state.reportedCraftJobs.add(completion.jobId);
    trackCraftComplete(completion.recipeId);
  }
}

/** Test-only: restore pristine module state between suites. */
export function __resetAnalyticsForTests(): void {
  state = freshState();
}
