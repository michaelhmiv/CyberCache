/**
 * fieldHunter — the ONE client owner of the hunter-switch
 * sequence (Cache Hunters slices (b) + (e)).
 *
 * Slice (b)'s Roster stop and slice (e)'s starting-hunter pick
 * field a hunter through exactly this sequence, so the two
 * surfaces can never drift apart:
 *
 *   1. Optimistic: the skill store's active hunter flips at
 *      once, so every surface re-heads itself immediately.
 *   2. The server switch (cc_set_active_hunter via the Chef
 *      route): the outgoing hunter's equipped set is saved as
 *      their loadout assignment, the incoming hunter's is
 *      equipped, the action-skill selection collapses to the
 *      new hunter's tree — and the profile's active_hunter_id
 *      is stamped, which is also what completes a pending
 *      starting-hunter pick (slice (e)).
 *   3. The returned profile snapshot is applied as the
 *      authority, and the runtime item set is re-read — the
 *      loadout changed server-side, so Gear must see the new
 *      truth.
 *
 * On any failure the optimistic flip rolls back and the error
 * rethrows; callers own their busy/error presentation. The
 * switch is not an economy transaction and carries no guest
 * gate and no level check — a level-1 account can field any
 * hunter (brief §3 floor 2, check E4).
 */
import { useSkillStore } from '@/store';
import { newActionSkillNonce, setActiveHunter } from '@/lib/chef/chefClient';
import { syncVerifiedResult } from '@/lib/api/verifiedStateSync';
import { syncRuntimeItemsForUser } from '@/lib/api/runtimeStateService';
import type { HunterId } from './hunters';

export async function fieldHunter(hunterId: HunterId): Promise<void> {
  const previous = useSkillStore.getState().activeHunterId;
  useSkillStore.getState().setActiveHunter(hunterId);
  try {
    const result = await setActiveHunter({
      nonce: newActionSkillNonce('hunter'),
      hunterId,
    });
    syncVerifiedResult({ profile: result.profile });
    await syncRuntimeItemsForUser('');
  } catch (err) {
    useSkillStore.getState().setActiveHunter(previous);
    throw err;
  }
}
