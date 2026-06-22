import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const readSource = (relPath: string) => readFileSync(resolve(root, relPath), 'utf8');

describe('backend authority audit', () => {
  it('keeps gameplay mutations on the canonical verified-op / service paths', () => {
    const verifiedOps = readSource('src/lib/supabase/verifiedOps.ts');
    expect(verifiedOps).toContain('cc_claim_crafted_consumable');
    expect(verifiedOps).toContain('cc_recycle_item');
    expect(verifiedOps).toContain('cc_market_create');
    expect(verifiedOps).toContain('cc_market_cancel');
    expect(verifiedOps).toContain('cc_accept_listing');
    expect(verifiedOps).toContain('cc_make_item');

    const activityService = readSource('src/lib/supabase/activityService.ts');
    expect(activityService).toContain('cc_set_active_action');
    expect(activityService).toContain('cc_clear_active_action');
    expect(activityService).toContain('cc_active_action_heartbeat');

    const claimRoute = readSource('src/server/routes/claim.ts');
    expect(claimRoute).toContain('cc_recycle_item');
    expect(claimRoute).toContain('cc_settle_offline_roaming');
    expect(claimRoute).toContain('cc_apply_chef_rewards');
  });

});
