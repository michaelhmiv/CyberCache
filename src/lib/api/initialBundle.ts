/**
 * Initial bundle bootstrap (flow-fix F1).
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
 */
import { verifiedOps } from './verifiedOps';
import type { ProfileRow } from './profileService';

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

/**
 * Grant the initial bundle iff the loaded profile has not claimed it.
 * Returns true when this call performed the grant (the op's own sync
 * has already applied the granted profile/items/loadout to the
 * stores). A lost already-claimed race returns false. Any other
 * failure throws — the caller decides whether bootstrap may continue
 * without the bundle (AuthProvider logs and continues; the next
 * session load retries, since the profile still reads unclaimed).
 */
export async function ensureInitialBundle(
  profile: Pick<ProfileRow, 'boss_state'> | null | undefined,
  grant: () => Promise<unknown> = () => verifiedOps.initialBundle(),
): Promise<boolean> {
  if (!profile || isInitialBundleClaimed(profile)) return false;
  try {
    await grant();
    return true;
  } catch (error) {
    if (isAlreadyClaimedError(error)) return false;
    throw error;
  }
}
