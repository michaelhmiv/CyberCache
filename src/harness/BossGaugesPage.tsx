import React, { useEffect, useState } from 'react';
import { BossFightStage } from '@/components/pixelArt/BossFightStage';
import { GhostHpBar } from '@/components/pixelArt/PixelFx';
import { GaugeCluster, type GaugeSpec } from './GaugeCluster';
import type { FightTimeline } from '@/lib/animation/fightTimeline';
import { FIXTURE_OUTCOME, FIXTURE_PHASES, FIXTURE_WEAPON } from './fightFixture';

/**
 * Gauge Cluster — boss (THROWAWAY rendering prototype, 2026-11-13,
 * harness only). The REAL Pixi BossFightStage (the pixi-harness's
 * own stage) with a gauge cluster seated under it.
 *
 * Boss fixture, derived per the INDEX: Dune Tyrant from its def
 * (src/constants/bosses.ts — health 800, cadence: hit every 6 s,
 * special 'Sand Slam' every 18 s, windup 3 s) fought with the
 * INDEX combat fixture's build and tick shapes:
 *   Tick 1: 96 = DMG 58 · FIRE 22 · SPD 16   (800 → 704)
 *   Telegraph: the Sand Slam windup — the TELEGRAPH dial winds
 *     0 → 100% across the def's real 3 s windup; the red tick at
 *     full scale is the firing point (windup complete = the
 *     special fires — the cadence def is the threshold source).
 *   Kill beat: a seeded later moment — boss at 156/800 — closed by
 *     the fixture's tick 3 verbatim: crit 156 = DMG 44 ×2.0 = 88 ·
 *     FIRE 24 · SPD 12 · MOLTEN 14 · ECHO 18 (156 → 0).
 *
 * Dials: DMG / TICK and CRIT SHARE carry over from roam (same
 * scales, same 25% crit line); the third dial is the telegraph
 * charge. No shield dial here: no boss hit on the shield is staged
 * in these beats, and a parked dial would be decoration (README).
 * The special's damage is never staged or implied — the dial's
 * subject is the charge itself, which is all a telegraph is.
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

interface BossState {
  tl: FightTimeline;
  dmg: number;
  dmgText: string;
  crit: number;
  critText: string;
  tele: number;
  teleText: string;
  hot: string | null;
}

const BEATS: Record<string, BossState> = {
  rest: {
    tl: timeline(BOSS_MAX, 0, []),
    dmg: 0, dmgText: '0', crit: 0.25, critText: '25%', tele: 0, teleText: '0%', hot: null,
  },
  telegraph: {
    tl: timeline(704, 0, [{ id: 'bg-1', target: 'boss', value: 96, phaseName: 'Basic Boss Read' }]),
    dmg: 96 / 156, dmgText: '96', crit: 0, critText: '0%', tele: 0.85, teleText: '85%', hot: 'tele',
  },
  kill: {
    tl: timeline(0, FIXTURE_PHASES.length, [
      { id: 'bg-1', target: 'boss', value: 96, phaseName: 'Basic Boss Read' },
      { id: 'bg-2', target: 'boss', value: 156, phaseName: 'Basic Boss Read' },
    ], true),
    dmg: 1, dmgText: '156', crit: 88 / 156, critText: '56%', tele: 0, teleText: '0%', hot: 'crit',
  },
};

const toGauges = (s: BossState): GaugeSpec[] => [
  { key: 'dmg', label: 'DMG / TICK', frac: s.dmg, display: s.dmgText, color: '#FFD23C', hot: s.hot === 'dmg', ticks: [{ at: 0.25 }, { at: 0.5 }, { at: 0.75 }] },
  {
    key: 'crit', label: 'CRIT SHARE', frac: s.crit, display: s.critText, color: '#FF4D2E', hot: s.hot === 'crit',
    ticks: [{ at: 0.25, red: true }, { at: 0.5 }, { at: 0.75 }],
  },
  {
    key: 'tele', label: 'SAND SLAM', frac: s.tele, display: s.teleText, color: '#FFB300', hot: s.hot === 'tele',
    ticks: [{ at: 0.5 }, { at: 1, red: true }], k: 55, d: 11,
  },
];

export const BossGaugesPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [state, setState] = useState<BossState>(() => BEATS[params.get('beat') ?? 'rest'] ?? BEATS.rest);

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
      <div data-testid="boss-gauges-stage">
        <BossFightStage timeline={state.tl} phases={FIXTURE_PHASES} bossId="dune_tyrant" weapon={FIXTURE_WEAPON} />
        <div className="mt-2 space-y-1">
          <GhostHpBar pct={bossPct} color="#F87171" testId="boss-gauges-boss-bar" />
          <GhostHpBar pct={playerPct} color="#4ADE80" testId="boss-gauges-player-bar" />
        </div>
      </div>
      <GaugeCluster gauges={toGauges(state)} testId="boss-gauge-cluster" />
    </div>
  );
};
