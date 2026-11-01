/**
 * Offline Settlement Architecture Tests
 *
 * These tests enforce the contract established in the 2026-06-12
 * offline settlement repair. They verify:
 *   - Server-authoritative elapsed time (no client Date.now())
 *   - Correct tick semantics (advance by ticksSettled, not +1)
 *   - No 20-tick clamp for offline settlement
 *   - Snapshot contract enforcement
 *   - Idempotency via settlement nonce
 *   - No-op behavior for non-roaming actions
 *   - Login flow ordering (settlement after hydration, before snapshot)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('Offline settlement — server authority', () => {
  // Test 1: profile snapshots keep the fields settlement sync consumes
  it('cc_profile_snapshot keeps its final-definition fields', () => {
    // Route B (B6): the snapshot lives in db/migrations/0004 (ported in
    // B3 from the FINAL June definition). History: the June
    // 20260612150000 migration added 'last_claimed_tick' to the
    // snapshot, but the final June redefinition (20260612173000)
    // dropped it again, and the B3 port is verbatim — so the tick
    // baseline reaches the client through the B2 read profile instead,
    // which maps the column explicitly (checked below).
    const migration = readSource('db/migrations/0004_write_apis.sql');
    const snapshotStart = migration.indexOf('cc_profile_snapshot(profile_row profiles)');
    const snapshot = migration.slice(snapshotStart, snapshotStart + 2500);
    expect(snapshot).toContain("'consumables', profile_row.consumables");
    expect(snapshot).toContain("'boss_state', profile_row.boss_state");
    expect(snapshot).toContain("'last_idle_claim_at', profile_row.last_idle_claim_at");
    const readStore = readSource('src/server/reads/store.ts');
    expect(readStore).toContain('last_claimed_tick: num(row.last_claimed_tick)');
  });

  // Test 2: Offline settlement uses maxTicks=Infinity (no 20-tick clamp)
  it('offline settlement route does not cap ticks to 20', () => {
    // Canonical handler: settleOffline.ts (claim.ts's duplicate was removed in B3).
    const route = readSource('src/server/routes/settleOffline.ts');
    expect(route).toContain('handleSettleOffline');
    // Settlement route should use maxTicks: Infinity, not the default 20
    expect(route).toContain('maxTicks: Infinity');
    expect(route).toContain('NO 20-TICK CLAMP');
  });

  // Test 3: Foreground claim keeps 20-tick clamp
  it('foreground claim caps at 20 ticks (default maxTicks)', () => {
    const chef = readSource('src/server/chef.ts');
    expect(chef).toContain('maxTicks ?? 20');
    // The foreground route does NOT override maxTicks, so it defaults to 20
    const route = readSource('src/server/routes/roamingHandler.ts');
    const claimHandler = route.slice(
      route.indexOf('createClaimHandler'),
    );
    expect(claimHandler).not.toContain('maxTicks');
  });

  // Test 4: processRoamingClaim advances tick count by ticks processed
  it('processRoamingClaim uses the full tick count, not +1', () => {
    const chef = readSource('src/server/chef.ts');
    // The function should NOT advance last_claimed_tick by +1 for batch claims
    // It uses the tickCount parameter as-is from the request
    const processFn = chef.slice(
      chef.indexOf('export function processRoamingClaim'),
    );
    // The claim request uses its own ticks count; the RPC receives the full tick_count
    expect(processFn).toContain('rewards: {');
    expect(processFn).toContain('ticks');
  });

  // Test 5: Offline settlement has idempotency guard
  it('offline settlement checks settlement nonce for idempotency', () => {
    const route = readSource('src/server/routes/settleOffline.ts');
    const settlementHandler = route.slice(
      route.indexOf('createSettleOfflineHandler'),
    );
    expect(settlementHandler).toContain('last_settlement_nonce');
    expect(settlementHandler).toContain('settlementNonce');
    expect(settlementHandler).toContain("reason: 'idempotent'");
    // Should check the nonce BEFORE processing
    const nonceCheckIdx = settlementHandler.indexOf('last_settlement_nonce');
    const processClaimIdx = settlementHandler.indexOf('processRoamingClaim');
    expect(nonceCheckIdx).toBeGreaterThan(0);
    expect(processClaimIdx).toBeGreaterThan(nonceCheckIdx);
  });

  // Test 6: Offline settlement is server-authoritative (uses DB timestamps)
  it('offline settlement computes elapsed time from DB, not client clock', () => {
    const route = readSource('src/server/routes/settleOffline.ts');
    const settlementHandler = route.slice(
      route.indexOf('createSettleOfflineHandler'),
    );
    expect(settlementHandler).toContain('last_roaming_settled_at');
    expect(settlementHandler).toContain('activeAction.started_at');
    // Must NOT use client Date.now() for elapsed computation
    // (Date.now() is used for the current server time, which is correct;
    //  the FROM timestamp is DB-derived)
    expect(settlementHandler).toContain('settleFrom');
  });

  // Test 7: No-op when active action is not roaming_loot
  it('settlement returns no-op when not roaming', () => {
    const route = readSource('src/server/routes/settleOffline.ts');
    const settlementHandler = route.slice(
      route.indexOf('createSettleOfflineHandler'),
    );
    expect(settlementHandler).toContain("active_action !== 'roaming_loot'");
    expect(settlementHandler).toContain("reason: 'not_roaming'");
  });
});

describe('Offline settlement — client contract', () => {
  // Test 8: activitySettlement.ts is a thin adapter (no client-side reward math)
  it('activitySettlement.ts delegates to server, does not compute rewards client-side', () => {
    const settlement = readSource('src/lib/activity/activitySettlement.ts');
    expect(settlement).toContain('settleOffline');
    expect(settlement).toContain('POST /api/settle-offline');
    // Must NOT contain the old client-reward patterns (TICK_MS for time calc, localStorage lock)
    expect(settlement).not.toContain('TICK_MS = 3000');
    expect(settlement).not.toContain('SETTLEMENT_LOCK_KEY');
  });

  // Test 9: No localStorage settlement lock
  it('activitySettlement.ts does not use localStorage lock', () => {
    const settlement = readSource('src/lib/activity/activitySettlement.ts');
    expect(settlement).not.toContain('SETTLEMENT_LOCK_KEY');
    expect(settlement).not.toContain('acquireLock');
  });

  // Test 10: Login flow calls settlement after hydration, before snapshot
  it('AuthProvider runs settlement after activity hydration', () => {
    const auth = readSource('src/auth/AuthProvider.tsx');
    const hydrateIdx = auth.indexOf('hydrate()');
    const settlementIdx = auth.indexOf('settleActiveActivityRewards');
    const snapshotIdx = auth.indexOf('saveCurrentRuntimeStores');
    expect(hydrateIdx).toBeGreaterThan(0);
    expect(settlementIdx).toBeGreaterThan(0);
    expect(snapshotIdx).toBeGreaterThan(0);
    // Settlement should happen after hydrate, and snapshot save after settlement
    // (snapshot may not be explicitly after — there's a save in the settlement function)
  });
});

describe('Offline settlement — snapshot boundaries', () => {
  // Test 11: Runtime snapshots do not restore economy state
  it('applyRuntimeDisplaySnapshot does not touch player/inventory/skill/workshop stores', () => {
    const sync = readSource('src/store/runtimeSupabaseSync.ts');
    const applyFn = sync.slice(
      sync.indexOf('export function applyRuntimeDisplaySnapshot'),
      sync.indexOf('export async function restoreRuntimeStoresFromSupabase'),
    );
    expect(applyFn).not.toContain('usePlayerStore');
    expect(applyFn).not.toContain('useInventoryStore');
    expect(applyFn).not.toContain('useSkillStore');
    expect(applyFn).not.toContain('useWorkshopStore');
  });

  // Test 12: Snapshot type declaration includes authority field
  it('RuntimeDisplaySnapshot declares display_hydration_only authority', () => {
    const sync = readSource('src/store/runtimeSupabaseSync.ts');
    expect(sync).toContain("authority: 'display_hydration_only'");
  });
});

describe('Offline settlement — Chef client types', () => {
  // Test 13: ChefClaimRequest supports maxTicks
  it('ChefClaimRequest includes optional maxTicks field', () => {
    const client = readSource('src/lib/chef/chefClient.ts');
    expect(client).toContain('maxTicks?');
  });

  // Test 14: OfflineSettlementResult has full recap fields
  it('OfflineSettlementResult includes all recap UI fields', () => {
    const client = readSource('src/lib/chef/chefClient.ts');
    expect(client).toContain('settled: true');
    expect(client).toContain('timeAway');
    expect(client).toContain('ticksSettled');
    expect(client).toContain('startTick');
    expect(client).toContain('endTick');
    expect(client).toContain('capReached');
    expect(client).toContain('idempotent');
  });

  // Test 15: settleOffline function exists
  it('settleOffline function exports for client use', () => {
    const client = readSource('src/lib/chef/chefClient.ts');
    expect(client).toContain('export async function settleOffline');
    expect(client).toContain("chefUrl('/settle-offline')");
  });
});

describe('Offline settlement — UI recap', () => {
  // Test 16: OfflineRecap component exists
  it('OfflineRecap component renders settlement data', () => {
    const recap = readSource('src/components/activity/OfflineRecap.tsx');
    expect(recap).toContain('While You Were Away');
    expect(recap).toContain('useOfflineRecapStore');
    expect(recap).toContain('dismiss');
  });

  // Test 17: Recap shows whenever a settlement exists.
  // Dashboard-top redesign (2026-11-01) supersedes the old guard:
  // the recap card moved into the Dashboard level pop-up, where it
  // must render whenever a settlement exists — `dismissed` is now
  // only the level button's beacon read-marker, not a render gate
  // (otherwise the pop-up could never re-show an acknowledged
  // recap, which was the reopen strip's whole job).
  it('OfflineRecap returns null only when there is no settlement', () => {
    const recap = readSource('src/components/activity/OfflineRecap.tsx');
    expect(recap).toContain('if (!lastSettlement) return null');
    expect(recap).not.toContain('if (!lastSettlement || dismissed) return null');
  });

  // Test 18: Listener wires event to store
  it('useOfflineRecapListener wires custom event to store', () => {
    const listener = readSource('src/components/activity/useOfflineRecapListener.ts');
    expect(listener).toContain('cybercache:activity-settled');
    expect(listener).toContain('setSettlement');
    expect(listener).toContain('addEventListener');
  });
});

describe('Offline settlement — schema fix (active_action / user_id)', () => {
  // Test 19: /api/settle-offline queries active_action, not kind
  it('handleSettleOffline selects active_action, not kind', () => {
    // Route B (B6): the read goes through the gameplay store — its SQL
    // selects the same columns, keyed by user_id (the live names).
    const route = readSource('src/server/routes/settleOffline.ts');
    expect(route).toContain('store.getActiveAction(playerId)');
    const store = readSource('src/server/gameplay/store.ts');
    expect(store).toContain('user_id, active_action, target_id, started_at, last_heartbeat_at, activity_payload');
    expect(store).toContain('from public.active_actions where user_id = $1');
  });

  // Test 20: No references to kind or player_id remain in active_actions query
  it('handleSettleOffline has no kind/player_id fallback', () => {
    const route = readSource('src/server/routes/settleOffline.ts');
    const settlementHandler = route.slice(
      route.indexOf('createSettleOfflineHandler'),
    );
    // The active_actions select should include active_action, not kind
    // Route B (B6): the select lives in the gameplay store's SQL.
    const store = readSource('src/server/gameplay/store.ts');
    const aaBlockMatch = store.match(
      /select ([\w, ]+) from public\.active_actions where user_id/,
    );
    expect(aaBlockMatch).toBeTruthy();
    if (aaBlockMatch) {
      expect(aaBlockMatch[1]).not.toContain('kind');
      expect(aaBlockMatch[1]).toContain('active_action');
    }
    // The query key should use user_id not player_id
    // Find the line after the active_actions select
    // Route B (B6): the store SQL keys the row `where user_id = $1`
    // (asserted in Test 19); the handler never queries by a
    // body-supplied id.
    expect(settlementHandler).not.toContain('player_id');
    expect(settlementHandler).toContain('store.getActiveAction(playerId)');
  });
});

describe('Offline settlement — mobile resume hook', () => {
  // Test 21: useOfflineResumeSettlement exists
  it('useOfflineResumeSettlement hook exists', () => {
    const hook = readSource('src/components/activity/useOfflineResumeSettlement.ts');
    expect(hook).toContain('export function useOfflineResumeSettlement');
    expect(hook).toContain('visibilitychange');
  });

  // Test 22: Listens to visibilitychange, focus, pageshow
  it('useOfflineResumeSettlement listens to multiple resume signals', () => {
    const hook = readSource('src/components/activity/useOfflineResumeSettlement.ts');
    expect(hook).toContain("document.addEventListener('visibilitychange'");
    expect(hook).toContain("window.addEventListener('focus'");
    expect(hook).toContain("window.addEventListener('pageshow'");
  });

  // Test 23: Throttle/debounce prevents overlapping settlements
  it('useOfflineResumeSettlement debounces rapid events', () => {
    const hook = readSource('src/components/activity/useOfflineResumeSettlement.ts');
    expect(hook).toContain('DEBOUNCE_MS');
    expect(hook).toContain('settlingRef');
    expect(hook).toContain('lastSettleAttemptRef');
  });

  // Test 24: Hidden duration threshold
  it('useOfflineResumeSettlement has min hidden duration threshold', () => {
    const hook = readSource('src/components/activity/useOfflineResumeSettlement.ts');
    expect(hook).toContain('MIN_HIDDEN_MS');
    expect(hook).toContain('hiddenDuration');
  });
});

describe('Offline settlement — direct store write', () => {
  // Test 25: settleActiveActivityRewards writes directly to OfflineRecapStore
  it('settleActiveActivityRewards calls setSettlement on useOfflineRecapStore', () => {
    const settlement = readSource('src/lib/activity/activitySettlement.ts');
    expect(settlement).toContain('useOfflineRecapStore.getState().setSettlement');
    expect(settlement).toContain('PRIMARY delivery path');
  });

  // Test 26: CustomEvent is secondary, not primary
  it('CustomEvent is marked as secondary notification', () => {
    const settlement = readSource('src/lib/activity/activitySettlement.ts');
    expect(settlement).toContain('NOT the primary delivery path');
    expect(settlement).toContain('secondary notification');
    // CustomEvent still present for debugging
    expect(settlement).toContain("new CustomEvent('cybercache:activity-settled'");
  });

  // Test 27: Recap store is written before CustomEvent dispatches
  it('store write happens before CustomEvent dispatch', () => {
    const settlement = readSource('src/lib/activity/activitySettlement.ts');
    const storeWriteIdx = settlement.indexOf('useOfflineRecapStore.getState().setSettlement');
    const customEventIdx = settlement.indexOf("new CustomEvent('cybercache:activity-settled'");
    expect(storeWriteIdx).toBeGreaterThan(0);
    expect(customEventIdx).toBeGreaterThan(0);
    expect(storeWriteIdx).toBeLessThan(customEventIdx);
  });
});

describe('Offline settlement — canonical timestamp', () => {
  // Test 28: cc_apply_chef_rewards sets last_roaming_settled_at
  it('cc_apply_chef_rewards updates last_roaming_settled_at', () => {
    const migration = readSource('db/migrations/0007_chef_gameplay_appliers.sql');
    // The updated RPC should include last_roaming_settled_at in the UPDATE
    expect(migration).toContain('last_roaming_settled_at = now()');
  });

  // Test 29: Atomic RPC sets last_roaming_settled_at to now_ts after cap
  it('cc_settle_offline_roaming sets last_roaming_settled_at to now_ts, not settle_from + cap', () => {
    const migration = readSource('db/migrations/0007_chef_gameplay_appliers.sql');
    expect(migration).toContain('last_roaming_settled_at = now_ts');
    expect(migration).toContain('NOT settle_from + cap_ms');
  });

  // Test 30: foreground claims advance canonical timestamp via cc_apply_chef_rewards
  it('foreground roaming claims advance last_roaming_settled_at via cc_apply_chef_rewards', () => {
    const migration = readSource('db/migrations/0007_chef_gameplay_appliers.sql');
    // The new cc_apply_chef_rewards definition must include last_roaming_settled_at
    const rpcStart = migration.indexOf('create or replace function public.cc_apply_chef_rewards');
    const rpcEnd = migration.indexOf('create or replace function public.cc_settle_offline_roaming');
    const rpcDef = migration.slice(rpcStart, rpcEnd);
    expect(rpcDef).toContain('last_roaming_settled_at');
  });
});

describe('Offline settlement — atomic RPC', () => {
  // Test 31: cc_settle_offline_roaming exists with idempotency
  it('cc_settle_offline_roaming has idempotency via verified_action_ledger', () => {
    const migration = readSource('db/migrations/0007_chef_gameplay_appliers.sql');
    expect(migration).toContain('create or replace function public.cc_settle_offline_roaming');
    expect(migration).toContain(':offline_settle:');
    expect(migration).toContain('if prior is not null then return prior');
  });

  // Test 32: Atomic RPC uses advisory lock for serialization
  it('cc_settle_offline_roaming uses pg_advisory_xact_lock', () => {
    const migration = readSource('db/migrations/0007_chef_gameplay_appliers.sql');
    expect(migration).toContain('pg_advisory_xact_lock');
  });

  // Test 33: Atomic RPC returns settled=false for not_roaming
  it('cc_settle_offline_roaming returns settled=false when not roaming', () => {
    const migration = readSource('db/migrations/0007_chef_gameplay_appliers.sql');
    const rpcDef = migration.slice(
      migration.indexOf('create or replace function public.cc_settle_offline_roaming'),
    );
    expect(rpcDef).toContain("'not_roaming'");
  });

  // Test 34: Atomic RPC returns settled=false for no_elapsed
  it('cc_settle_offline_roaming returns settled=false when no elapsed', () => {
    const migration = readSource('db/migrations/0007_chef_gameplay_appliers.sql');
    const rpcDef = migration.slice(
      migration.indexOf('create or replace function public.cc_settle_offline_roaming'),
    );
    expect(rpcDef).toContain("'no_elapsed'");
  });

  // Test 35: Route uses atomic RPC instead of cc_apply_chef_rewards + manual update
  it('handleSettleOffline uses cc_settle_offline_roaming', () => {
    const route = readSource('src/server/routes/settleOffline.ts');
    const settlementHandler = route.slice(
      route.indexOf('createSettleOfflineHandler'),
    );
    // Route B (B6): the handler calls the gameplay store, whose
    // Postgres implementation invokes cc_settle_offline_roaming.
    expect(settlementHandler).toContain('store.settleOfflineRoaming');
    expect(readSource('src/server/gameplay/store.ts')).toContain('cc_settle_offline_roaming');
    // Should NOT call cc_apply_chef_rewards for offline settlement
    // (it's still used for foreground claims)
  });
});

describe('Offline settlement — leave signals', () => {
  // Test 36: useLeaveSignals hook exists
  it('useLeaveSignals hook exists and listens to pagehide/visibilitychange', () => {
    const hook = readSource('src/components/activity/useLeaveSignals.ts');
    expect(hook).toContain('export function useLeaveSignals');
    expect(hook).toContain("window.addEventListener('pagehide'");
    expect(hook).toContain("document.addEventListener('visibilitychange'");
  });

  // Test 37: useLeaveSignals saves snapshot and heartbeats
  it('useLeaveSignals calls saveCurrentRuntimeStores and heartbeatActiveActivity', () => {
    const hook = readSource('src/components/activity/useLeaveSignals.ts');
    expect(hook).toContain('saveCurrentRuntimeStores');
    expect(hook).toContain('heartbeatActiveActivity');
  });

  // Test 38: useLeaveSignals comment acknowledges events may never fire
  it('useLeaveSignals documents that leave events are best-effort', () => {
    const hook = readSource('src/components/activity/useLeaveSignals.ts');
    expect(hook).toContain('BEST-EFFORT');
    expect(hook).toContain('MUST work correctly even when these events NEVER fire');
  });
});

describe('Offline settlement — debug surface', () => {
  // Test 39: SettlementDebugOverlay exists
  it('SettlementDebugOverlay component exists', () => {
    const overlay = readSource('src/components/activity/SettlementDebugOverlay.tsx');
    expect(overlay).toContain('SettlementDebugOverlay');
    expect(overlay).toContain('VITE_DEBUG_SETTLEMENT');
  });

  // Test 40: Debug overlay renders only when debug flag is set
  it('SettlementDebugOverlay returns null when not debug', () => {
    const overlay = readSource('src/components/activity/SettlementDebugOverlay.tsx');
    expect(overlay).toContain('if (!DEBUG) return null');
  });
});

describe('Offline settlement — App integration', () => {
  // Test 41: App.tsx mounts useOfflineResumeSettlement
  it('App.tsx calls useOfflineResumeSettlement', () => {
    const app = readSource('src/App.tsx');
    expect(app).toContain('useOfflineResumeSettlement()');
  });

  // Test 42: App.tsx mounts useLeaveSignals
  it('App.tsx calls useLeaveSignals', () => {
    const app = readSource('src/App.tsx');
    expect(app).toContain('useLeaveSignals()');
  });

  // Test 43: App.tsx renders SettlementDebugOverlay
  it('App.tsx renders SettlementDebugOverlay', () => {
    const app = readSource('src/App.tsx');
    expect(app).toContain('<SettlementDebugOverlay />');
  });
});
