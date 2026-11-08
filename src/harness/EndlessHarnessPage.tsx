import React, { useState } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useBossStore } from '@/store';
import { buildInitialTimeline, type FightOutcome } from '@/lib/animation/fightTimeline';
import { FIXTURE_PHASES, FIXTURE_WEAPON, freezeSnapshot } from '@/harness/fightFixture';

/**
 * Endless harness (dev-only page, served by the Vite dev server at
 * /endless-harness.html — never part of the production bundle).
 * Drives the REAL LiveTurfDiorama through the Motion Reboot M3
 * endless stage states so the before/after captures isolate the
 * STAGE (the panel's own cards are pinned by endlessStageHome):
 *
 *   ?scene=presence   a run is live; the next encounter (depth 3,
 *                     a boss depth — the Dune Tyrant kit) has been
 *                     published as the run's presence.
 *   ?scene=fight      the panel is mid-playback: the fight
 *                     presentation for the same run is published.
 *   ?scene=defeat     the fight's final snapshot: the hunter fell;
 *                     the run is closing on this frame.
 *   ?width=<px>       stage width (default 390, phone width).
 *
 * The activity record is fixed: kind 'endless_run', targetId
 * 'run-1' (the server-pinned run id) — every publication carries
 * the same run id, exactly the panel's discipline. On the BEFORE
 * build the diorama has no endless mode at all: modeFromActivity
 * falls through to the camp vista for every scene — that fall-
 * through is the headline before/after.
 */

const RUN_ID = 'run-1';
const ENCOUNTER_ID = 'dune_tyrant';

const DEFEAT_OUTCOME: FightOutcome = {
  result: { victory: false, winChance: 0, bossHpRemaining: 500 },
  creditsDelta: 0,
  bonusLootRolls: 0,
  consumedConsumables: {},
  loot: [],
  extraLoot: false,
};

function defeatPresentationTimeline() {
  // The walk's end state, frozen: the hunter at 0 HP, the boss at
  // its surviving fraction — the frame the run closes on.
  const base = buildInitialTimeline(DEFEAT_OUTCOME, 600, 20, 0);
  const bossHp = Math.round(base.bossHpMax * ((DEFEAT_OUTCOME.result.bossHpRemaining ?? 50) / 100));
  return {
    ...base,
    currentPhaseIndex: FIXTURE_PHASES.length,
    playerHp: 0,
    bossHp,
    damageLog: [
      { id: 'defeat-1', target: 'player' as const, value: 180, phaseName: FIXTURE_PHASES[2].phaseName },
      { id: 'defeat-2', target: 'boss' as const, value: 100, phaseName: FIXTURE_PHASES[3].phaseName },
      { id: 'defeat-3', target: 'player' as const, value: 260, phaseName: FIXTURE_PHASES[4].phaseName },
    ],
    finishedAt: 1,
  };
}

export const EndlessHarnessPage: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const scene = params.get('scene') ?? 'presence';
  const width = Number(params.get('width') ?? 390);

  // Seed BEFORE the diorama's first render (lazy initializer —
  // the store publications are idempotent, so StrictMode's
  // double-invoke is harmless). On the BEFORE build the endless
  // publications do not exist — the setters are absent and every
  // call below is a no-op, so the same harness file drives both
  // builds (that absence IS the before state: nothing can reach
  // the stage).
  useState(() => {
    const store = useBossStore.getState() as unknown as {
      setEndlessPresence?: (p: unknown) => void;
      setEndlessPresentation?: (p: unknown) => void;
    };
    if (scene === 'presence') {
      store.setEndlessPresence?.({
        runId: RUN_ID,
        encounterId: ENCOUNTER_ID,
        encounterKind: 'boss',
        areaId: 'dustwaste',
        depth: 3,
        band: 0,
      });
    } else if (scene === 'fight') {
      store.setEndlessPresentation?.({
        timeline: freezeSnapshot(2),
        phases: FIXTURE_PHASES,
        runId: RUN_ID,
        depth: 3,
        encounterId: ENCOUNTER_ID,
        band: 0,
        weapon: FIXTURE_WEAPON,
        signatureFire: null,
      });
    } else if (scene === 'defeat') {
      store.setEndlessPresentation?.({
        timeline: defeatPresentationTimeline(),
        phases: FIXTURE_PHASES,
        runId: RUN_ID,
        depth: 3,
        encounterId: ENCOUNTER_ID,
        band: 0,
        weapon: FIXTURE_WEAPON,
        signatureFire: null,
      });
    }
    return true;
  });

  const area = getRoamingArea(DEFAULT_ROAMING_AREA_ID);
  return (
    <div style={{ width, margin: '0 auto', background: '#0b0e14', minHeight: '100vh' }}>
      <LiveTurfDiorama
        area={area}
        weapon={FIXTURE_WEAPON}
        playerLevel={20}
        equippedCount={7}
        activityKind="endless_run"
        endlessRunId={RUN_ID}
      />
    </div>
  );
};
