import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const readSource = (relPath: string) => readFileSync(resolve(root, relPath), 'utf8');

describe('backend authority audit', () => {
  it('keeps gameplay mutations on the canonical verified-op / service paths', () => {
    // Route B (B4): the client calls the Chef write routes; the
    // canonical cc_* functions live server-side in the write store.
    const verifiedOps = readSource('src/lib/api/verifiedOps.ts');
    expect(verifiedOps).toContain('/ops/claim-crafted-consumable');
    expect(verifiedOps).toContain('/ops/recycle-item');
    expect(verifiedOps).toContain('/ops/market-create');
    expect(verifiedOps).toContain('/ops/market-cancel');
    expect(verifiedOps).toContain('/ops/market-accept');
    expect(verifiedOps).toContain('/ops/make-item');

    const writeStore = readSource('src/server/writes/store.ts');
    expect(writeStore).toContain('cc_claim_crafted_consumable');
    expect(writeStore).toContain('cc_recycle_item');
    expect(writeStore).toContain('cc_market_create');
    expect(writeStore).toContain('cc_market_cancel');
    expect(writeStore).toContain('cc_accept_listing');
    expect(writeStore).toContain('cc_make_item');
    expect(writeStore).toContain('cc_set_active_action');
    expect(writeStore).toContain('cc_clear_active_action');
    expect(writeStore).toContain('cc_active_action_heartbeat');

    const activityService = readSource('src/lib/api/activityService.ts');
    expect(activityService).toContain('/activity/set');
    expect(activityService).toContain('/activity/clear');
    expect(activityService).toContain('/activity/heartbeat');

    const claimRoute = readSource('src/server/routes/claim.ts');
    expect(claimRoute).toContain('cc_recycle_item');
    // The claim/settle handlers were de-duplicated in B3: the canonical
    // copies live in roamingHandler.ts / settleOffline.ts (claim.ts's were
    // unreachable duplicates shadowed by chefRoutes mount order).
    const settleRoute = readSource('src/server/routes/settleOffline.ts');
    expect(settleRoute).toContain('cc_settle_offline_roaming');
    const roamingRoute = readSource('src/server/routes/roamingHandler.ts');
    expect(roamingRoute).toContain('cc_apply_chef_rewards');
    // Route B (B6): the handlers invoke the functions through the
    // gameplay store; the canonical function names live in its
    // Postgres implementation.
    const gameplayStore = readSource('src/server/gameplay/store.ts');
    expect(gameplayStore).toContain('cc_recycle_item');
    expect(gameplayStore).toContain('cc_settle_offline_roaming');
    expect(gameplayStore).toContain('cc_apply_chef_rewards');
    expect(gameplayStore).toContain('cc_apply_chef_boss_attempt');
  });
});
