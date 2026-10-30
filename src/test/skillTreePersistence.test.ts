/**
 * Skill tree persistence — server-snapshot is the source of truth.
 *
 * Bug being fixed: skillSlice.spendPoint was a local-only Zustand mutation
 * with no server RPC, so every profile read clobbered the user's allocations
 * back to {}. These tests assert that:
 *   1. syncRuntimeProfile with skill_spends hydrates the local store.
 *   2. syncVerifiedResult for a cc_train_skill action overwrites the local
 *      store with the server's authoritative map.
 *   3. Rollback on RPC failure restores the prior spent map.
 *   4. verifiedOps.trainSkill forwards node_id to the RPC and applies the
 *      server response via syncVerifiedResult.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route B (B4): the transport is the Chef api layer now. Mock the
// http helper verifiedOps is built on, with the same fixtures the
// Supabase rpc stub used to return.
const apiRequestMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/http', () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  isApiError: () => false,
  isNotFoundError: () => false,
}));
vi.mock('@/store/runtimeSupabaseSync', () => ({
  saveCurrentRuntimeStores: vi.fn(async () => undefined),
}));

import { syncRuntimeProfile, syncVerifiedResult } from '@/lib/api/verifiedStateSync';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { useSkillStore } from '@/store/slices/skillSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';

const resetStores = () => {
  useSkillStore.setState(useSkillStore.getInitialState(), true);
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  apiRequestMock.mockReset();
};

describe('skill tree persistence — server snapshot wins', () => {
  beforeEach(resetStores);

  it('syncRuntimeProfile hydrates spent from server skill_spends', () => {
    useSkillStore.setState({ spent: { stale_local: 7 } });
    syncRuntimeProfile({
      id: 'test-profile',
      player_level: 5,
      skill_spends: { gs_dmg_1: 3, demo_armor_1: 1 },
    });
    // The server snapshot overwrites the local map entirely — the stale
    // local-only entry must NOT survive.
    expect(useSkillStore.getState().spent).toEqual({
      gs_dmg_1: 3,
      demo_armor_1: 1,
    });
  });

  it('syncVerifiedResult applies cc_train_skill profile snapshot to local store', () => {
    // Pretend the user just spent 1 point on gs_dmg_1 optimistically.
    useSkillStore.setState({ spent: { gs_dmg_1: 1 } });

    // The server returns the authoritative profile with the canonical map.
    syncVerifiedResult({
      action_type: 'cc_train_skill',
      profile: {
        id: 'test-profile',
        player_level: 5,
        skill_spends: { gs_dmg_1: 1, gs_dmg_2: 1 },
      },
    });

    expect(useSkillStore.getState().spent).toEqual({
      gs_dmg_1: 1,
      gs_dmg_2: 1,
    });
  });

  it('local-only spends that the server never recorded are wiped on rehydrate', () => {
    // The bug: user spent points locally, app reloaded, server returned
    // empty skill_spends → local points vanish. This is what we're fixing
    // by making the spend go through cc_train_skill, but we pin the
    // pre-fix failure mode to guard against regression.
    useSkillStore.setState({ spent: { gs_dmg_1: 2, demo_armor_1: 1 } });
    syncRuntimeProfile({ id: 'test-profile', player_level: 4, skill_spends: {} });
    expect(useSkillStore.getState().spent).toEqual({});
  });
});

describe('skill spendPoint rollback on RPC failure', () => {
  beforeEach(() => {
    useSkillStore.setState(useSkillStore.getInitialState(), true);
  });

  it('spendPoint followed by setState rollback restores the prior map', () => {
    useSkillStore.setState({ spent: { gs_dmg_1: 1 } });
    const before = useSkillStore.getState().spent;
    useSkillStore.getState().spendPoint('gs_dmg_2');
    // Optimistic state has the new point:
    expect(useSkillStore.getState().spent).toEqual({ gs_dmg_1: 1, gs_dmg_2: 1 });
    // Rollback (mirrors the screen's catch block):
    useSkillStore.setState({ spent: before });
    expect(useSkillStore.getState().spent).toEqual({ gs_dmg_1: 1 });
  });
});

describe('verifiedOps.trainSkill round-trip', () => {
  beforeEach(resetStores);

  it('posts node_id to the Chef train-skill op and applies the server profile', async () => {
    apiRequestMock.mockResolvedValueOnce({
      action_type: 'cc_train_skill',
      profile: { id: 'test-profile', player_level: 3, skill_spends: { gs_dmg_1: 1 } },
      node_id: 'gs_dmg_1',
      node_points: 1,
      total_spent: 1,
    });

    await verifiedOps.trainSkill('gs_dmg_1');

    expect(apiRequestMock).toHaveBeenCalledWith('/ops/train-skill', {
      method: 'POST',
      body: {
        nonce: expect.stringMatching(/^train:gs_dmg_1:/),
        node_id: 'gs_dmg_1',
      },
    });
    expect(useSkillStore.getState().spent).toEqual({ gs_dmg_1: 1 });
  });

  it('rethrows on op error so the screen can roll back the optimistic spend', async () => {
    apiRequestMock.mockRejectedValueOnce(new Error('Insufficient skill points'));

    await expect(verifiedOps.trainSkill('demo_keystone')).rejects.toBeDefined();
  });
});
