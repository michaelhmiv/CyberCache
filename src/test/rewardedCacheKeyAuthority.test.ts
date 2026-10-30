import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('rewarded cache key authority', () => {
  it('grants rewarded ad cache keys only through a verified op', () => {
    // Route B (B4): the client reaches the op through the Chef write
    // route; the canonical cc_* function runs server-side.
    const verifiedOps = readSource('src/lib/api/verifiedOps.ts');
    expect(verifiedOps).toContain('claimRewardedCacheKey');
    expect(verifiedOps).toContain('/ops/claim-rewarded-cache-key');
    expect(readSource('src/server/writes/store.ts')).toContain('cc_claim_rewarded_cache_key');

    const resourceBar = readSource('src/components/layout/ResourceBar.tsx');
    expect(resourceBar).toContain('verifiedOps.claimRewardedCacheKey');
    expect(resourceBar).not.toContain('addCacheKeys');
    expect(resourceBar).not.toContain('setPlayer');
  });

  it('keeps the rewarded ad entry point in ResourceBar only', () => {
    const resourceBar = readSource('src/components/layout/ResourceBar.tsx');
    expect(resourceBar).toContain('aria-label="Watch ad for cache key"');
    expect(resourceBar).toContain('Watch Ad');

    const chest = readSource('src/screens/ChestScreen.tsx');
    const dashboard = readSource('src/screens/DashboardScreen.tsx');
    const action = readSource('src/screens/ActionScreenContextual.tsx');
    expect(chest).not.toContain('Watch Ad');
    expect(dashboard).not.toContain('Watch Ad');
    expect(action).not.toContain('Watch Ad');
  });

  it('uses auth.uid and server-side caps in the Supabase reward RPC', () => {
    const migration = readSource('supabase/migrations/20260612204858_rewarded_cache_key_ads.sql');
    const rpc = migration.slice(migration.indexOf('create or replace function public.cc_claim_rewarded_cache_key'));
    expect(rpc).toContain('actor uuid := auth.uid()');
    expect(rpc).toContain('cache_tokens = cache_tokens + 1');
    expect(rpc).toContain('grant_count >= 3');
    expect(rpc).toContain("interval '5 minutes'");
    expect(rpc).toContain('public.cc_profile_snapshot(p)');
  });

  it('registers push tokens through authenticated Supabase RPCs', () => {
    const migration = readSource('supabase/migrations/20260612204858_rewarded_cache_key_ads.sql');
    expect(migration).toContain('create table if not exists public.user_push_devices');
    expect(migration).toContain('create table if not exists public.user_notification_settings');
    expect(migration).toContain('create table if not exists public.notification_events');
    expect(migration).toContain('create or replace function public.cc_register_push_device');
    expect(migration).toContain('actor uuid := auth.uid()');

    const push = readSource('src/lib/notifications/pushNotifications.ts');
    expect(push).toContain('PushNotifications.requestPermissions');
    expect(push).toContain('verifiedOps.registerPushDevice');
  });

  it('keeps Firebase push sending server-side and authenticated', () => {
    const fn = readSource('supabase/functions/send-test-push/index.ts');
    expect(fn).toContain("requiredEnv('FIREBASE_ADMIN_JSON')");
    expect(fn).toContain('admin.auth.getUser(jwt)');
    expect(fn).toContain(".from('user_push_devices')");
    expect(fn).toContain("https://www.googleapis.com/auth/firebase.messaging");
    expect(fn).toContain('https://fcm.googleapis.com/v1/projects/${projectId}/messages:send');
    expect(fn).not.toContain('service_account');
    expect(fn).not.toContain('private_key_id');
  });
});
