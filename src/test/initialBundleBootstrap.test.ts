/**
 * Flow-fix F1 (P0): the initial bundle was never granted — the Chef
 * route and client wrapper existed with zero callers, so every
 * account (new and pre-existing) sat at whatever it earned, never
 * receiving the +5,000 credits / +500 scrap / +3 cache keys / starter
 * Scrap Bike grant.
 *
 * The grant itself self-guards server-side (cc_initial_bundle raises
 * 'Initial bundle already claimed' once boss_state.initial_bundle_claimed
 * is set — see db/migrations/0021_vehicles.sql; the route-level proof
 * lives in chefWrites.test.ts). These tests pin the client bootstrap
 * contract: grant exactly once per account that has not claimed,
 * never for a claimed profile, tolerate the claim race, and wire the
 * call into AuthProvider's bootstrap before runtime items sync (so
 * the bike lands in the inventory the session renders).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: { initialBundle: vi.fn() },
}));

import { ensureInitialBundle, isInitialBundleClaimed } from '@/lib/api/initialBundle';
import { verifiedOps } from '@/lib/api/verifiedOps';
import type { ProfileRow } from '@/lib/api/profileService';

const profile = (overrides: Record<string, unknown> = {}): ProfileRow => ({
  id: 'player-1',
  credits: 85,
  scrap: 12,
  cache_tokens: 0,
  player_level: 2,
  boss_state: {},
  ...overrides,
} as unknown as ProfileRow);

const claimedProfile = () => profile({ boss_state: { initial_bundle_claimed: true } });

describe('isInitialBundleClaimed', () => {
  it('reads the boss_state flag (boolean and string wire forms)', () => {
    expect(isInitialBundleClaimed(profile())).toBe(false);
    expect(isInitialBundleClaimed(profile({ boss_state: null }))).toBe(false);
    expect(isInitialBundleClaimed(claimedProfile())).toBe(true);
    expect(isInitialBundleClaimed(profile({ boss_state: { initial_bundle_claimed: 'true' } }))).toBe(true);
    expect(isInitialBundleClaimed(profile({ boss_state: { initial_bundle_claimed: false } }))).toBe(false);
  });
});

describe('ensureInitialBundle', () => {
  beforeEach(() => {
    vi.mocked(verifiedOps.initialBundle).mockReset();
  });

  it('grants a fresh account exactly once', async () => {
    const grant = vi.fn(async () => ({}));
    await expect(ensureInitialBundle(profile(), grant)).resolves.toBe(true);
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('grants a pre-existing ungranted account (the 85-credit fingerprint)', async () => {
    // The live account that exposed F1: earned credits only, no keys,
    // bundle never claimed. Bootstrap must still grant it.
    const grant = vi.fn(async () => ({}));
    await expect(ensureInitialBundle(profile(), grant)).resolves.toBe(true);
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('grants nothing on the second bootstrap (profile now reads claimed)', async () => {
    const grant = vi.fn(async () => ({}));
    await ensureInitialBundle(profile(), grant);
    await expect(ensureInitialBundle(claimedProfile(), grant)).resolves.toBe(false);
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('never calls the grant for an already-claimed profile', async () => {
    const grant = vi.fn(async () => ({}));
    await expect(ensureInitialBundle(claimedProfile(), grant)).resolves.toBe(false);
    expect(grant).not.toHaveBeenCalled();
  });

  it('treats the server already-claimed race as success (no throw)', async () => {
    const grant = vi.fn(async () => {
      throw new Error('Initial bundle already claimed');
    });
    await expect(ensureInitialBundle(profile(), grant)).resolves.toBe(false);
  });

  it('rethrows unrelated failures so bootstrap can log and retry next session', async () => {
    const grant = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(ensureInitialBundle(profile(), grant)).rejects.toThrow('network down');
  });

  it('defaults to the verified initial-bundle op', async () => {
    vi.mocked(verifiedOps.initialBundle).mockResolvedValue({} as never);
    await expect(ensureInitialBundle(profile())).resolves.toBe(true);
    expect(verifiedOps.initialBundle).toHaveBeenCalledTimes(1);
  });

  it('is wired into AuthProvider bootstrap ahead of the runtime item sync', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/auth/AuthProvider.tsx'), 'utf8');
    const grantAt = source.indexOf('await ensureInitialBundle(profile)');
    const syncAt = source.indexOf('await syncRuntimeItemsForUser(nextUser.id)');
    expect(grantAt).toBeGreaterThan(-1);
    expect(syncAt).toBeGreaterThan(-1);
    expect(grantAt).toBeLessThan(syncAt);
  });
});
