import React, { useEffect, useRef, useState } from 'react';
import { BossFightStage } from '@/components/pixelArt/BossFightStage';
import { GhostHpBar } from '@/components/pixelArt/PixelFx';
import { HeatChip, HeatStrip, HeatOverlay, satellite, type HeatSpot } from './HeatField';
import type { FightTimeline } from '@/lib/animation/fightTimeline';
import { FIXTURE_OUTCOME, FIXTURE_PHASES, FIXTURE_WEAPON } from './fightFixture';

/**
 * HEAT FIELD — boss (THROWAWAY harness prototype, iter-09).
 * The REAL Pixi BossFightStage driven by decided FightTimeline
 * snapshots (the pixi-harness pattern), boss = Dune Tyrant from
 * its def (src/constants/bosses.ts): 800 HP, Sand Slam every
 * 18 s with a 3 s windup. Player HP max 340 is the shipped fight
 * fixture's (src/harness/fightFixture.ts).
 *
 * Heat mapping = combat's: intensity = tick / 156, satellites per
 * component. The telegraph is heat GATHERING at the boss:
 * intensity = windup elapsed / 3 s (the still holds 2.4 s / 3 s =
 * 0.80, radius grown). Tick 3 (crit 156) closes the kill from a
 * seeded later moment at 156 / 800 — the intermediate ticks are
 * omitted, not invented (INDEX selectivity law). The Sand Slam
 * never lands: the kill arrives inside the windup, so no slam
 * damage is staged or implied.
 *
 * Drive: window.__setBeat(n): 0 rest / 1 tick 1 / 2 tick 2 /
 * 3 telegraph (held at 0.80) / 4 kill.
 */

const BOSS_MAX = 800;
const PLAYER_MAX = 340;
const FULL = 156;
const BOSS = { x: 72, y: 42 };

const snap = (bossHp: number, phase: number, log: FightTimeline['damageLog'], finished = false): FightTimeline => ({
  outcome: FIXTURE_OUTCOME,
  startedAt: 0,
  finishedAt: finished ? Date.now() : null,
  currentPhaseIndex: phase,
  playerHp: PLAYER_MAX,
  playerHpMax: PLAYER_MAX,
  bossHp,
  bossHpMax: BOSS_MAX,
  damageLog: log,
});

const LOG1: FightTimeline['damageLog'] = [{ id: 'hb-1', target: 'boss', value: 96, phaseName: FIXTURE_PHASES[0].phaseName }];
const LOG2: FightTimeline['damageLog'] = [
  ...LOG1,
  { id: 'hb-2', target: 'boss', value: 104, phaseName: FIXTURE_PHASES[1].phaseName },
];
const LOG4: FightTimeline['damageLog'] = [
  ...LOG2,
  { id: 'hb-4', target: 'boss', value: 156, phaseName: FIXTURE_PHASES[4].phaseName },
];

interface BossState {
  timeline: FightTimeline;
  spots: HeatSpot[];
  heat: number;
  chips: React.ReactNode;
}

const restChips = (
  <>
    <HeatChip label="DUNE TYRANT" value="800 HP" />
    <HeatChip label="SAND SLAM" value="18 S CADENCE · 3 S WINDUP" />
    <HeatChip label="CRIT" value="25% · ×2.0" />
  </>
);

export const HeatBossPage: React.FC = () => {
  const [s, setS] = useState<BossState>({ timeline: snap(BOSS_MAX, 0, []), spots: [], heat: 0, chips: restChips });
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const impactSet = (total: number, comps: Array<[string, number, number]>, radius = 132): HeatSpot[] => [
      { id: 'impact', xPct: BOSS.x, yPct: BOSS.y, peak: total / FULL, radius, bornAt: 0 },
      ...comps.map(([label, v, ang]) => satellite(`sat-${label}`, BOSS.x, BOSS.y, 14, ang, v / FULL, 70, 0)),
    ];
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (n: number) => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      if (n === 0) {
        setS({ timeline: snap(BOSS_MAX, 0, []), spots: [], heat: 0, chips: restChips });
      } else if (n === 1) {
        setS({
          timeline: snap(704, 0, LOG1),
          spots: impactSet(96, [['DMG', 58, -55], ['FIRE', 22, 15], ['SPD', 16, 140]]),
          heat: 96 / FULL,
          chips: (
            <>
              <HeatChip label="DMG" value="58" /> <HeatChip label="FIRE" value="22" />
              <HeatChip label="SPD" value="16" /> <HeatChip label="TOTAL" value="96" hot />
              <HeatChip label="BOSS HP" value="800 → 704" />
            </>
          ),
        });
      } else if (n === 2) {
        setS({
          timeline: snap(600, 1, LOG2),
          spots: impactSet(104, [['DMG', 52, -70], ['FIRE', 18, -5], ['SPD', 14, 65], ['MOLTEN', 20, 150]]),
          heat: 104 / FULL,
          chips: (
            <>
              <HeatChip label="DMG" value="52" /> <HeatChip label="FIRE" value="18" />
              <HeatChip label="SPD" value="14" /> <HeatChip label="MOLTEN" value="20" hot />
              <HeatChip label="TOTAL" value="104" hot /> <HeatChip label="BOSS HP" value="704 → 600" />
            </>
          ),
        });
      } else if (n === 3) {
        // Telegraph: heat gathers at the boss over the 3 s windup;
        // the still holds the field at 2.4 s of 3 s = 0.80, radius
        // grown — gathering, not impact (no satellites, no damage).
        setS({
          timeline: snap(600, 1, LOG2),
          spots: [{ id: 'gather', xPct: BOSS.x, yPct: BOSS.y, peak: 0.8, radius: 176, bornAt: 0 }],
          heat: 0.8,
          chips: (
            <>
              <HeatChip label="SAND SLAM" value="WINDUP 2.4 / 3.0 S" hot />
              <HeatChip label="BOSS HP" value="600 / 800" />
            </>
          ),
        });
      } else if (n === 4) {
        setS({
          timeline: snap(156, 4, LOG2),
          spots: [],
          heat: 0,
          chips: restChips,
        });
        at(160, () => {
          setS({
            timeline: snap(0, 5, LOG4, true),
            spots: impactSet(
              156,
              [['DMG', 88, -75], ['FIRE', 24, -15], ['SPD', 12, 45], ['MOLTEN', 14, 115], ['ECHO', 18, 170]],
              150,
            ),
            heat: 1,
            chips: (
              <>
                <HeatChip label="DMG" value="44 ×2.0 = 88" hot /> <HeatChip label="FIRE" value="24" />
                <HeatChip label="SPD" value="12" /> <HeatChip label="MOLTEN" value="14" />
                <HeatChip label="ECHO" value="18" /> <HeatChip label="TOTAL" value="156" hot />
                <HeatChip label="BOSS HP" value="156 → 0" />
              </>
            ),
          });
        });
      }
    };
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, []);

  const bossPct = (s.timeline.bossHp / BOSS_MAX) * 100;
  const playerPct = (s.timeline.playerHp / PLAYER_MAX) * 100;

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <div style={{ position: 'relative' }} data-testid="boss-stage-wrap">
        <BossFightStage timeline={s.timeline} phases={FIXTURE_PHASES} bossId="dune_tyrant" weapon={FIXTURE_WEAPON} />
        <HeatOverlay spots={s.spots} hold tauMs={1100} />
      </div>
      <div className="mt-2 space-y-1">
        <GhostHpBar pct={bossPct} color="#F87171" testId="heat-boss-bar" />
        <GhostHpBar pct={playerPct} color="#4ADE80" testId="heat-player-bar" />
      </div>
      <HeatStrip intensity={s.heat} scaleLabel="FULL = 156">
        {s.chips}
      </HeatStrip>
    </div>
  );
};
