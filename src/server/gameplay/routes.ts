/**
 * Legacy Chef gameplay route mounting (Route B, slice B6).
 *
 * The four original Chef endpoints, mounted once each on a Route B
 * boot (inside the CHEF_JWT_SECRET + DATABASE_URL gate in
 * src/server/index.ts, alongside identity/reads/writes/jobs). The
 * handlers live with the other Chef routes (routes/roamingHandler.ts,
 * routes/settleOffline.ts, routes/claim.ts) and are built over the
 * ChefGameplayStore seam. GET /api/health stays unconditional — it
 * answers on every boot, configured or not, exactly as in June.
 */
import type { Express } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { EconomyConfig } from '../economy/config';
import { createClaimHandler } from '../routes/roamingHandler';
import { createSettleOfflineHandler } from '../routes/settleOffline';
import { createSalvageHandler, createVerifyBossHandler } from '../routes/claim';
import { createResurrectHandler } from '../routes/resurrect';
import {
  createAdvanceEndlessHandler,
  createBankEndlessHandler,
  createGetEndlessHandler,
  createStartEndlessRunHandler,
} from '../routes/endless';
import {
  createFireOverclockWorkshopHandler,
  createGetActionSkillHandler,
  createSelectActionSkillHandler,
} from '../routes/actionSkill';
import { createGetCacheRankHandler, createSpendCacheRankHandler } from '../routes/cacheRank';
import {
  createGetDispatchHandler,
  createPreviewDispatchHandler,
  createRecallDispatchHandler,
  createStartDispatchHandler,
} from '../routes/dispatch';
import { createGetExtractionHandler, type ExtractionConfig } from '../routes/extraction';
import { createGetLoginStreakHandler } from '../routes/loginStreak';
import {
  createCancelResearchHandler,
  createEnrollResearchHandler,
  createGetResearchHandler,
} from '../routes/research';
import type { WriteStore } from '../writes/store';
import type { ChefGameplayStore } from './store';

export function mountChefHealthRoute(app: Express): void {
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', chef: 'ready' });
  });
}

/** Gameplay routes plus the optional live economy-lever accessor (0018). */
export interface GameplayRoutesConfig extends AuthConfig {
  economyConfig?: EconomyConfig;
  /** Clock override (tests pin the hot-area rotation to a fixed date;
   *  production omits it and the routes read the wall clock). */
  now?: () => Date;
}

export function mountGameplayRoutes(app: Express, store: ChefGameplayStore, config: GameplayRoutesConfig): void {
  app.post('/api/claim', createClaimHandler(store, config));
  app.post('/api/settle-offline', createSettleOfflineHandler(store, config));
  app.post('/api/verify-boss', createVerifyBossHandler(store, config));
  app.post('/api/salvage', createSalvageHandler(store, config));
  app.post('/api/resurrect', createResurrectHandler(store, config));
  app.post('/api/endless/start', createStartEndlessRunHandler(store, config));
  app.post('/api/endless/encounter', createAdvanceEndlessHandler(store, config));
  app.post('/api/endless/bank', createBankEndlessHandler(store, config));
  app.get('/api/endless/me', createGetEndlessHandler(store, config));
  console.log(
    '[chef] gameplay routes mounted: POST /api/claim, /api/settle-offline, /api/verify-boss, /api/salvage, /api/resurrect, /api/endless/* (Route B B6)',
  );
}

/**
 * Action skill routes (0030): the state read + selection live on the
 * gameplay store; the Overclock workshop fire completes craft units,
 * so it mounts on the write store. Mounted separately because the two
 * stores are composed independently in index.ts.
 */
export function mountActionSkillRoutes(
  app: Express,
  gameplayStore: ChefGameplayStore,
  writeStore: WriteStore,
  config: GameplayRoutesConfig,
): void {
  app.get('/api/action-skill/me', createGetActionSkillHandler(gameplayStore, config));
  app.post('/api/action-skill/select', createSelectActionSkillHandler(gameplayStore, config));
  app.post('/api/action-skill/fire-workshop', createFireOverclockWorkshopHandler(writeStore, config));
  console.log('[chef] action skill routes mounted: GET /api/action-skill/me, POST /api/action-skill/select, /api/action-skill/fire-workshop (0030)');
}

/**
 * Cache Rank routes (0031): state read (observe-and-grant) + spend,
 * both on the gameplay store. Mounted separately alongside the
 * action skill routes in index.ts.
 */
export function mountCacheRankRoutes(
  app: Express,
  gameplayStore: ChefGameplayStore,
  config: GameplayRoutesConfig,
): void {
  app.get('/api/cache-rank/me', createGetCacheRankHandler(gameplayStore, config));
  app.post('/api/cache-rank/spend', createSpendCacheRankHandler(gameplayStore, config));
  console.log('[chef] cache rank routes mounted: GET /api/cache-rank/me, POST /api/cache-rank/spend (0031)');
}

/**
 * Dispatch routes (0032): board/bay state, prep pricing, departure,
 * and recall — all on the gameplay store. Mounted alongside the
 * cache rank routes in index.ts.
 */
export function mountDispatchRoutes(
  app: Express,
  gameplayStore: ChefGameplayStore,
  config: GameplayRoutesConfig,
): void {
  app.get('/api/dispatch/me', createGetDispatchHandler(gameplayStore, config));
  app.post('/api/dispatch/preview', createPreviewDispatchHandler(gameplayStore, config));
  app.post('/api/dispatch/start', createStartDispatchHandler(gameplayStore, config));
  app.post('/api/dispatch/recall', createRecallDispatchHandler(gameplayStore, config));
  console.log('[chef] dispatch routes mounted: GET /api/dispatch/me, POST /api/dispatch/preview, /api/dispatch/start, /api/dispatch/recall (0032)');
}

/**
 * Extraction routes (0033): the settle-then-read state surface.
 * Starting/switching rides the ordinary activity path
 * (POST /api/activity/set) — there is deliberately no start route
 * here, so the personal-slot transition rules have one door.
 */
export function mountExtractionRoutes(
  app: Express,
  gameplayStore: ChefGameplayStore,
  config: GameplayRoutesConfig,
): void {
  const extractionConfig: ExtractionConfig = config;
  app.get('/api/extraction/state', createGetExtractionHandler(gameplayStore, extractionConfig));
  console.log('[chef] extraction routes mounted: GET /api/extraction/state (0033)');
}

/**
 * Login streak routes (0036): the daily check-in state read
 * (observe-and-record) on the gameplay store. Mounted alongside
 * the cache rank routes in index.ts.
 */
export function mountLoginStreakRoutes(
  app: Express,
  gameplayStore: ChefGameplayStore,
  config: GameplayRoutesConfig,
): void {
  app.get('/api/login-streak/me', createGetLoginStreakHandler(gameplayStore, config));
  console.log('[chef] login streak routes mounted: GET /api/login-streak/me (0036)');
}

/**
 * Research routes (0038): the parallel education track's state
 * read + enroll/cancel on the gameplay store. Deliberately NOT an
 * activity: mounting here adds no ActivityKind and no workspace
 * spec (brief §2.3.2) — enrollment runs beside the action slot.
 */
export function mountResearchRoutes(
  app: Express,
  gameplayStore: ChefGameplayStore,
  config: GameplayRoutesConfig,
): void {
  app.get('/api/research/me', createGetResearchHandler(gameplayStore, config));
  app.post('/api/research/enroll', createEnrollResearchHandler(gameplayStore, config));
  app.post('/api/research/cancel', createCancelResearchHandler(gameplayStore, config));
  console.log('[chef] research routes mounted: GET /api/research/me, POST /api/research/enroll, POST /api/research/cancel (0038)');
}
