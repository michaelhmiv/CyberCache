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

import { ensureInitialBundle, isInitialBundleClaimed, parseInitialBundleGrant } from '@/lib/api/initialBundle';
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

/**
 * The op result as the real twins produce it (cc_initial_bundle in
 * db/migrations/0021_vehicles.sql + the in-memory writes twin):
 * the post-grant profile snapshot and the granted bike row. The
 * fixture profile holds 85 credits / 12 scrap / 0 keys, so the
 * granted deltas are the bundle's 5,000 / 500 / 3.
 */
const grantResult = (overrides: Record<string, unknown> = {}) => ({
  action_type: 'cc_initial_bundle',
  profile: { id: 'player-1', credits: 5085, scrap: 512, cache_tokens: 3 },
  item: { id: 'bike-1', kind: 'vehicle', payload: { name: 'Scrap Bike', vehicleClassId: 'scrap_bike' } },
  loadout: {},
  ...overrides,
});

const EXPECTED_GRANT = { credits: 5000, scrap: 500, cacheKeys: 3, vehicleName: 'Scrap Bike' };

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

  it('grants a fresh account exactly once and returns the parsed grant', async () => {
    const grant = vi.fn(async () => grantResult());
    await expect(ensureInitialBundle(profile(), grant)).resolves.toEqual(EXPECTED_GRANT);
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('grants a pre-existing ungranted account (the 85-credit fingerprint)', async () => {
    // The live account that exposed F1: earned credits only, no keys,
    // bundle never claimed. Bootstrap must still grant it.
    const grant = vi.fn(async () => grantResult());
    await expect(ensureInitialBundle(profile(), grant)).resolves.toEqual(EXPECTED_GRANT);
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('grants nothing on the second bootstrap (profile now reads claimed)', async () => {
    const grant = vi.fn(async () => grantResult());
    await ensureInitialBundle(profile(), grant);
    await expect(ensureInitialBundle(claimedProfile(), grant)).resolves.toBeNull();
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('never calls the grant for an already-claimed profile', async () => {
    const grant = vi.fn(async () => grantResult());
    await expect(ensureInitialBundle(claimedProfile(), grant)).resolves.toBeNull();
    expect(grant).not.toHaveBeenCalled();
  });

  it('treats the server already-claimed race as success (no throw, no reveal)', async () => {
    const grant = vi.fn(async () => {
      throw new Error('Initial bundle already claimed');
    });
    await expect(ensureInitialBundle(profile(), grant)).resolves.toBeNull();
  });

  it('rethrows unrelated failures so bootstrap can log and retry next session', async () => {
    const grant = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(ensureInitialBundle(profile(), grant)).rejects.toThrow('network down');
  });

  it('defaults to the verified initial-bundle op', async () => {
    vi.mocked(verifiedOps.initialBundle).mockResolvedValue(grantResult() as never);
    await expect(ensureInitialBundle(profile())).resolves.toEqual(EXPECTED_GRANT);
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

  it('feeds the parsed grant to the one-time starter reveal', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/auth/AuthProvider.tsx'), 'utf8');
    expect(source).toContain('useInitialBundleRevealStore.getState().show(bundleGrant)');
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain('<StarterBundleReveal />');
  });
});

describe('parseInitialBundleGrant (FR-02 — the reveal reads the op result, never constants)', () => {
  it('derives the granted deltas and vehicle name from the op result', () => {
    expect(parseInitialBundleGrant(profile(), grantResult())).toEqual(EXPECTED_GRANT);
  });

  it('reports deltas, not post-grant totals', () => {
    // A richer pre-grant profile: only the bundle's own amounts show.
    const before = profile({ credits: 10000, scrap: 700, cache_tokens: 2 });
    const result = grantResult({
      profile: { id: 'player-1', credits: 15000, scrap: 1200, cache_tokens: 5 },
    });
    expect(parseInitialBundleGrant(before, result)).toEqual(EXPECTED_GRANT);
  });

  it('handles the no-new-vehicle result (bike already held) with a null vehicle name', () => {
    const result = grantResult({ item: null });
    expect(parseInitialBundleGrant(profile(), result)).toEqual({ ...EXPECTED_GRANT, vehicleName: null });
  });

  it('returns null when the result carries no profile snapshot', () => {
    expect(parseInitialBundleGrant(profile(), { action_type: 'cc_initial_bundle' })).toBeNull();
    expect(parseInitialBundleGrant(profile(), null)).toBeNull();
    expect(parseInitialBundleGrant(profile(), undefined)).toBeNull();
  });

  it('returns null when a snapshot amount is not a number (no fabricated reveal)', () => {
    const result = grantResult({
      profile: { id: 'player-1', credits: '5085', scrap: 512, cache_tokens: 3 },
    });
    expect(parseInitialBundleGrant(profile(), result)).toBeNull();
  });
});
