import React, { useEffect, useState } from 'react';
import { BossFightStage } from '@/components/pixelArt/BossFightStage';
import { GhostHpBar } from '@/components/pixelArt/PixelFx';
import { RacePair } from './RacePair';
import type { FightTimeline } from '@/lib/animation/fightTimeline';
import { FIXTURE_OUTCOME, FIXTURE_PHASES, FIXTURE_WEAPON } from './fightFixture';

/**
 * Quota Race — boss (THROWAWAY rendering prototype, 2026-11-13,
 * harness only). The REAL Pixi BossFightStage (the pixi-harness's
 * own stage) with a two-bar race seated under it.
 *
 * Boss fixture, derived per the INDEX: Dune Tyrant from its def
 * (src/constants/bosses.ts — health 800, cadence: special 'Sand
 * Slam' every 18 s, windup 3 s) fought with the INDEX combat
 * fixture's build and tick shapes:
 *   Tick 1: 96 = DMG 58 · FIRE 22 · SPD 16   (800 → 704)
 *   Telegraph: the Sand Slam windup charges over the def's real
 *     3 s. THE RACE: your cumulative damage (climbing to the 800
 *     kill quota) vs the telegraph charge (climbing to 100% —
 *     windup complete = the special lands). The race is shown,
 *     never resolved: no outcome is invented — the telegraph beat
 *     holds at 85% (2.6 s of the 3.0 s windup), mid-race.
 *   Kill beat: a seeded later moment — boss at 156/800 — closed by
 *     the fixture's tick 3 verbatim: crit 156 = DMG 44 ×2.0 = 88 ·
 *     FIRE 24 · SPD 12 · MOLTEN 14 · ECHO 18 (156 → 0). Cumulative
 *     dealt at the kill = 800 (644 seeded + 156).
 *
 * Drive: window.__setBeat('rest'|'telegraph'|'kill'); ?beat=
 * picks the opening beat.
 */

const BOSS_MAX = 800;
const PLAYER_MAX = 340;

const timeline = (bossHp: number, phaseIndex: number, log: FightTimeline['damageLog'], finished = false): FightTimeline => ({
  outcome: FIXTURE_OUTCOME,
  startedAt: 0,
  finishedAt: finished ? performance.now() : null,
  currentPhaseIndex: phaseIndex,
  playerHp: PLAYER_MAX,
  playerHpMax: PLAYER_MAX,
  bossHp,
  bossHpMax: BOSS_MAX,
  damageLog: log,
});

interface BossRaceState {
  tl: FightTimeline;
  dealt: number;
  chargeFrac: number;
  chargeText: string;
  status: string;
  detail: string;
  hot: 'top' | 'bottom' | null;
}

const BEATS: Record<string, BossRaceState> = {
  rest: {
    tl: timeline(BOSS_MAX, 0, []),
    dealt: 0, chargeFrac: 0, chargeText: '0% · 0.0 / 3.0 S',
    status: 'AT THE LINE — SAND SLAM ON AN 18 S CADENCE',
    detail: 'DUNE TYRANT · 800 HP · WINDUP 3 S (SRC/CONSTANTS/BOSSES.TS)',
    hot: null,
  },
  telegraph: {
    tl: timeline(704, 0, [{ id: 'br-1', target: 'boss', value: 96, phaseName: 'Basic Boss Read' }]),
    dealt: 96, chargeFrac: 0.85, chargeText: '85% · 2.6 / 3.0 S',
    status: 'RACE LIVE — CHARGE LEADS: 85% FULL, KILL NEEDS 704 MORE',
    detail: 'T1 96 = DMG 58 · FIRE 22 · SPD 16 · IF THE CHARGE WINS, SAND SLAM LANDS',
    hot: 'bottom',
  },
  kill: {
    tl: timeline(0, FIXTURE_PHASES.length, [
      { id: 'br-1', target: 'boss', value: 96, phaseName: 'Basic Boss Read' },
      { id: 'br-2', target: 'boss', value: 156, phaseName: 'Basic Boss Read' },
    ], true),
    dealt: 800, chargeFrac: 0, chargeText: '0% · 0.0 / 3.0 S',
    status: 'FINISH — YOUR BAR REACHES 800 FIRST · BOSS DOWN',
    detail: 'SEEDED AT 156 HP · CRIT 156 = DMG 44 ×2.0 = 88 · FIRE 24 · SPD 12 · MOLTEN 14 · ECHO 18',
    hot: 'top',
  },
};

export const BossRacePage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [state, setState] = useState<BossRaceState>(() => BEATS[params.get('beat') ?? 'rest'] ?? BEATS.rest);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (beat: string) => {
      const next = BEATS[beat];
      if (next) setState(next);
    };
  }, []);

  const bossPct = (state.tl.bossHp / state.tl.bossHpMax) * 100;
  const playerPct = (state.tl.playerHp / state.tl.playerHpMax) * 100;

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <div data-testid="boss-race-stage">
        <BossFightStage timeline={state.tl} phases={FIXTURE_PHASES} bossId="dune_tyrant" weapon={FIXTURE_WEAPON} />
        <div className="mt-2 space-y-1">
          <GhostHpBar pct={bossPct} color="#F87171" testId="boss-race-boss-bar" />
          <GhostHpBar pct={playerPct} color="#4ADE80" testId="boss-race-player-bar" />
        </div>
      </div>
      <RacePair
        testId="boss-race-pair"
        quotaText="QUOTA 800 — THE KILL · 100% — THE SLAM"
        top={{ label: 'YOUR DAMAGE DEALT', valueText: `${state.dealt} / 800`, frac: state.dealt / BOSS_MAX, color: '#FFD23C', hot: state.hot === 'top' }}
        bottom={{ label: 'SAND SLAM CHARGE', valueText: state.chargeText, frac: state.chargeFrac, color: '#FFB300', hot: state.hot === 'bottom' }}
        status={state.status}
        detail={state.detail}
      />
    </div>
  );
};
