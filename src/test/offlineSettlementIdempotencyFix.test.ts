import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

const repairMigrationPath = 'supabase/migrations/20260612173001_fix_settlement_idempotency_keys.sql';

describe('Offline settlement idempotency repair migration', () => {
  it('does not declare a local idempotency_key variable', () => {
    const migration = readSource(repairMigrationPath);

    expect(migration).not.toContain('idempotency_key text;');
  });

  it('qualifies verified_action_ledger idempotency comparisons against nonce_key', () => {
    const migration = readSource(repairMigrationPath);

    expect(migration).toContain('nonce_key text;');
    expect(migration).toContain('vl.idempotency_key = nonce_key');
    expect(migration).not.toContain('and idempotency_key = idempotency_key');
  });

  it('keeps foreground roaming claims advancing the canonical settlement timestamp', () => {
    const migration = readSource(repairMigrationPath);
    const chefStart = migration.indexOf('create or replace function public.cc_apply_chef_rewards');
    const offlineStart = migration.indexOf('create or replace function public.cc_settle_offline_roaming');
    const chefRpc = migration.slice(chefStart, offlineStart);

    expect(chefRpc).toContain('last_roaming_settled_at = now()');
    expect(chefRpc).not.toContain('last_roaming_settled_at = coalesce(last_roaming_settled_at, now())');
  });

  it('keeps offline settlement capped with fractional-cap support', () => {
    const migration = readSource(repairMigrationPath);
    const offlineRpc = migration.slice(
      migration.indexOf('create or replace function public.cc_settle_offline_roaming'),
    );

    expect(offlineRpc).toContain('greatest(0.25, coalesce(p.offline_cap_hours, 2))');
    expect(offlineRpc).toContain('last_roaming_settled_at = now_ts');
    expect(offlineRpc).toContain('last_settlement_nonce = _settlement_nonce');
  });
});

describe('Offline resume listener cleanup', () => {
  it('removes the same visibilitychange handler it registers', () => {
    const hook = readSource('src/components/activity/useOfflineResumeSettlement.ts');

    expect(hook).toContain('const handleVisibilityChange = () =>');
    expect(hook).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)");
    expect(hook).toContain("document.removeEventListener('visibilitychange', handleVisibilityChange)");
    expect(hook).not.toContain("document.removeEventListener('visibilitychange', handleHidden)");
    expect(hook).not.toContain("document.removeEventListener('visibilitychange', handleVisible)");
  });

  it('clears hiddenSince after a settlement attempt to prevent stale resume retries', () => {
    const hook = readSource('src/components/activity/useOfflineResumeSettlement.ts');

    expect(hook).toContain('hiddenSinceRef.current = null');
  });
});
