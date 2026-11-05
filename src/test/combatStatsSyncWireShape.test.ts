/**
 * Combat-stats sync wire shape — the client half of the 2026-11-05
 * production defect.
 *
 * The foreground heartbeat (ActionScreenContextual) accrues active
 * playtime as FRACTIONAL wall-clock seconds — the real elapsed time
 * between 3s beats — so the combat-stats slice legitimately holds
 * values like 3.184. rowFromState used to ship that float verbatim
 * in PUT /api/stats/combat; combat_stats.active_play_seconds is
 * bigint (migration 0003), Postgres rejected the literal, and the
 * whole-row upsert took every other stat down with it (31 failed
 * saves in one 90-second production roam).
 *
 * This pins the serialization boundary: whatever fraction the slice
 * holds, the row that leaves the client carries whole seconds for
 * the integer-typed columns. (The Chef route rounds again at its
 * trust boundary; that half is pinned in chefCombatStats.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/combatStatsService', () => ({
  getCombatStatsRow: vi.fn(async () => null),
  saveCombatStatsRow: vi.fn(async () => undefined),
}));

import { saveCombatStatsRow } from '@/lib/api/combatStatsService';
import { saveCombatStats } from '@/store/combatStatsSupabaseSync';
import { useCombatStatsStore } from '@/store/slices/combatStatsSlice';

const USER = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.mocked(saveCombatStatsRow).mockClear();
  useCombatStatsStore.getState().setAll({
    totalKills: 0,
    totalDeaths: 0,
    longestKillStreak: 0,
    currentKillStreak: 0,
    lastKillAt: null,
    runStartedAt: null,
    killsByArea: {},
    killsByWeaponType: {},
    killsByBoss: {},
    killsByElement: {},
    highestBossTier: 0,
    activePlaySeconds: 0,
    idlePlaySeconds: 0,
  });
});

describe('saveCombatStats wire shape', () => {
  it('sends whole seconds when the slice holds fractional heartbeat accrual', async () => {
    // The exact fractional values captured in the production
    // warnings: a first heartbeat's real elapsed time, and an
    // accumulated total with binary float drift.
    useCombatStatsStore.setState({
      totalKills: 5,
      totalDeaths: 1,
      activePlaySeconds: 3.184,
      idlePlaySeconds: 9.001000000000001,
    });

    await saveCombatStats(USER);

    expect(saveCombatStatsRow).toHaveBeenCalledTimes(1);
    const row = vi.mocked(saveCombatStatsRow).mock.calls[0][0];
    expect(row.active_play_seconds).toBe(3);
    expect(row.idle_play_seconds).toBe(9);
    expect(Number.isInteger(row.active_play_seconds)).toBe(true);
    expect(Number.isInteger(row.idle_play_seconds)).toBe(true);
    // The rest of the row is untouched by the rounding.
    expect(row.total_kills).toBe(5);
    expect(row.total_deaths).toBe(1);
  });

  it('keeps whole-second accrual exact (no drift introduced at the wire)', async () => {
    useCombatStatsStore.setState({ activePlaySeconds: 114, idlePlaySeconds: 60 });
    await saveCombatStats(USER);
    const row = vi.mocked(saveCombatStatsRow).mock.calls[0][0];
    expect(row.active_play_seconds).toBe(114);
    expect(row.idle_play_seconds).toBe(60);
  });
});
