/**
 * Initial bundle bootstrap (flow-fix F1 + first-run reveal, audit FR-02).
 *
 * cc_initial_bundle grants every account its starter economy exactly
 * once (+5,000 credits, +500 scrap, +3 cache keys, the starter Scrap
 * Bike auto-equipped). The Chef route and the verifiedOps wrapper
 * shipped in the Route B / vehicles slices, but nothing ever called
 * them — every account started at zero forever. This module is the
 * client bootstrap half: AuthProvider's loadUser runs it on every
 * session load, gated on the profile's own claim flag, so fresh AND
 * pre-existing ungranted accounts receive the bundle exactly once.
 *
 * Exactly-once is enforced server-side, not here: the SQL function
 * checks `boss_state.initial_bundle_claimed` under an advisory lock
 * (and replays the recorded result for a repeated nonce), raising
 * 'Initial bundle already claimed' on a second claim. The gate below
 * keeps the common case call-free; the already-claimed race (two
 * devices bootstrapping together) is treated as success, not an error.
 *
 * FR-02: a fresh grant used to land silently — balances simply
 * changed between glances. ensureInitialBundle now returns the
 * parsed grant (or null when nothing was granted) so AuthProvider
 * can present the one-time starter reveal. The reveal's contents are
 * derived from the op's OWN result, never hardcoded: the op returns
 * `{ action_type, profile, item, loadout }` where `profile` is the
 * post-grant cc_profile_snapshot (credits / scrap / cache_tokens)
 * and `item` is the granted starter-vehicle row (its payload names
 * the vehicle). The granted amounts are the deltas between that
 * snapshot and the pre-grant profile this call was handed; a result
 * without a usable snapshot yields null (no fabricated reveal — the
 * grant itself still landed and synced through the op).
 */
import { verifiedOps, type VerifiedResult } from './verifiedOps';
import type { ProfileRow } from './profileService';

/** What one fresh initial-bundle grant actually delivered. */
export interface InitialBundleGrant {
  /** Credits granted (post-grant snapshot minus pre-grant profile). */
  credits: number;
  /** Scrap granted (same delta derivation). */
  scrap: number;
  /** Cache keys granted (the snapshot's cache_tokens delta). */
  cacheKeys: number;
  /** Starter vehicle name from the granted item's payload, when the
   * grant carried a vehicle row; null when it did not (e.g. the
   * account already held its starter bike from an earlier grant). */
  vehicleName: string | null;
}

export function isInitialBundleClaimed(
  profile: Pick<ProfileRow, 'boss_state'> | null | undefined,
): boolean {
  const flag = profile?.boss_state?.initial_bundle_claimed;
  return flag === true || flag === 'true';
}

export function isAlreadyClaimedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('Initial bundle already claimed');
}

function snapshotNumber(snapshot: Record<string, unknown>, key: string): number | null {
  const value = snapshot[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Parse the grant out of the op result. Returns null when the result
 * carries no usable post-grant profile snapshot — the reveal must
 * only ever show numbers the op itself reported.
 */
export function parseInitialBundleGrant(
  before: Pick<ProfileRow, 'credits' | 'scrap' | 'cache_tokens'>,
  result: VerifiedResult | null | undefined,
): InitialBundleGrant | null {
  const snapshot = result?.profile;
  if (!snapshot || typeof snapshot !== 'object') return null;
  const record = snapshot as Record<string, unknown>;
  const credits = snapshotNumber(record, 'credits');
  const scrap = snapshotNumber(record, 'scrap');
  const cacheTokens = snapshotNumber(record, 'cache_tokens');
  if (credits === null || scrap === null || cacheTokens === null) return null;

  const item = result?.item;
  const payload =
    item && typeof item === 'object' ? (item as Record<string, unknown>).payload : null;
  const vehicleName =
    payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).name === 'string'
      ? ((payload as Record<string, unknown>).name as string)
      : null;

  return {
    credits: credits - (before.credits ?? 0),
    scrap: scrap - (before.scrap ?? 0),
    cacheKeys: cacheTokens - (before.cache_tokens ?? 0),
    vehicleName,
  };
}

/**
 * Grant the initial bundle iff the loaded profile has not claimed it.
 * Returns the parsed grant when THIS call performed the grant (the
 * op's own sync has already applied the granted profile/items/loadout
 * to the stores); the caller presents the one-time reveal from it. A
 * profile that already claimed, a lost already-claimed race, and an
 * unparseable result all return null — no reveal. Any other failure
 * throws — the caller decides whether bootstrap may continue without
 * the bundle (AuthProvider logs and continues; the next session load
 * retries, since the profile still reads unclaimed).
 */
export async function ensureInitialBundle(
  profile: Pick<ProfileRow, 'boss_state' | 'credits' | 'scrap' | 'cache_tokens'> | null | undefined,
  grant: () => Promise<VerifiedResult> = () => verifiedOps.initialBundle(),
): Promise<InitialBundleGrant | null> {
  if (!profile || isInitialBundleClaimed(profile)) return null;
  try {
    const result = await grant();
    return parseInitialBundleGrant(profile, result);
  } catch (error) {
    if (isAlreadyClaimedError(error)) return null;
    throw error;
  }
}
