import React, { useEffect, useRef, useState } from 'react';
import { BossFightStageDom } from '@/components/pixelArt/BossFightStage';
import { GhostHpBar } from '@/components/pixelArt/PixelFx';
import { REGION_1_BOSSES } from '@/constants/bosses';
import type { FightOutcome, FightTimeline } from '@/lib/animation/fightTimeline';
import type { PhaseAnalysis } from '@/types/boss';
import { TickerLedger, tapePush, type LedgerEntry } from './TickerLedger';
import { FIXTURE_WEAPON } from '../fightFixture';

/**
 * TICKER LEDGER — BOSS (iter-04 harness, dev only).
 *
 * The real boss stage (DOM renderer, C3 telegraph parity) for DUNE
 * TYRANT — tier 1, level 5, 800 HP, cadence from its shipped def
 * (src/constants/bosses.ts): special "Sand Slam" every 18 s with a
 * 3.0 s windup. The tape runs the INDEX combat anatomy against the
 * boss's real 800 HP: the fixture's three ticks verbatim first
 * (96 / 104 / crit 156), then the same anatomy repeated until the
 * account closes at 800. The telegraph posts as its own full-bleed
 * danger entry BEFORE the slam resolves — and the resolution is
 * the fixture shape's dodge (src/harness/fightFixture.ts: boss
 * counters are telegraph + dodge), never an invented number.
 * Victory line carries the fixture outcome's creditsDelta (1500).
 *
 *   ?freeze=rest|telegraph|kill   hold a beat (stills)
 *   ?auto=1                        play once (supporting)
 */

const BOSS = REGION_1_BOSSES.find((b) => b.id === 'dune_tyrant')!;
const PHASES: PhaseAnalysis[] = Array.from({ length: 7 }, (_, i) => ({
  phaseId: `${BOSS.phases[0].id}-${i}`,
  phaseName: BOSS.phases[0].name,
  score: 0.8,
  status: 'safe' as const,
  currentAnswers: ['weapon'],
  missingCounters: [],
  relevantConsumables: [],
  explanation: 'Fixture phase',
}));

const OUTCOME: FightOutcome = {
  result: { victory: true, winChance: 0.75, bossHpRemaining: 0 },
  creditsDelta: 1500,
  bonusLootRolls: 1,
  consumedConsumables: {},
  loot: [],
  extraLoot: false,
};

type Row = Omit<LedgerEntry, 'id'>;
interface Step {
  beat: string;
  atMs: number;
  bossHp: number;
  dmg: number; // this step's total damage to the boss (0 = no hit)
  rows: Row[];
  foot: [string, string];
  finished?: boolean;
}

const comp = {
  plain: (t: string, dmg: number, fire: number, spd: number): Row[] => [
    { t, kind: 'hit', label: 'DMG', amount: `−${dmg}` },
    { t, kind: 'proc', label: 'FIRE', amount: `−${fire}`, tint: '#FF7A1A' },
    { t, kind: 'hit', label: 'SPD', amount: `−${spd}` },
  ],
  molten: (t: string, m: number): Row => ({ t, kind: 'proc', label: 'MOLTEN CORE', amount: `−${m}`, tint: '#FF5A2A' }),
  critSet: (t: string): Row[] => [
    { t, kind: 'crit', label: 'CRIT ×2.0 — DMG 44', amount: '−88' },
    { t, kind: 'proc', label: 'FIRE', amount: '−24', tint: '#FF7A1A' },
    { t, kind: 'hit', label: 'SPD', amount: '−12' },
    { t, kind: 'proc', label: 'MOLTEN CORE', amount: '−14', tint: '#FF5A2A' },
    { t, kind: 'proc', label: 'ECHO CHAMBER', amount: '−18', tint: '#7DD3FC' },
  ],
  total: (t: string, n: number, sum: number, hp: number): Row => ({
    t,
    kind: 'total',
    label: `TICK ${n} — TOTAL`,
    amount: `−${sum}`,
    balance: `HP ${hp}`,
  }),
};

const STEPS: Step[] = [
  {
    beat: 'rest', atMs: 0, bossHp: 800, dmg: 0,
    rows: [{ t: 'T+0:00', kind: 'open', label: 'ENGAGE — DUNE TYRANT · TIER 1', balance: 'HP 800' }],
    foot: ['DEALT Σ 0', 'BOSS HP 800'],
  },
  {
    beat: 'tick1', atMs: 1100, bossHp: 704, dmg: 96,
    rows: [...comp.plain('T+0:06', 58, 22, 16), comp.total('T+0:06', 1, 96, 704)],
    foot: ['DEALT Σ 96', 'BOSS HP 704'],
  },
  {
    beat: 'tick2', atMs: 2400, bossHp: 600, dmg: 104,
    rows: [...comp.plain('T+0:12', 52, 18, 14), comp.molten('T+0:12', 20), comp.total('T+0:12', 2, 104, 600)],
    foot: ['DEALT Σ 200', 'BOSS HP 600'],
  },
  {
    beat: 'telegraph', atMs: 3600, bossHp: 600, dmg: 0,
    rows: [
      { t: 'T+0:18', kind: 'tele', label: '!! TELEGRAPH — SAND SLAM', amount: 'WINDUP', balance: '3.0s' },
      { t: 'T+0:21', kind: 'step', label: 'SAND SLAM — DODGED', balance: 'HP 600' },
    ],
    foot: ['DEALT Σ 200', 'BOSS HP 600'],
  },
  {
    beat: 'tick3', atMs: 5000, bossHp: 444, dmg: 156,
    rows: [...comp.critSet('T+0:24'), comp.total('T+0:24', 3, 156, 444)],
    foot: ['DEALT Σ 356', 'BOSS HP 444'],
  },
  {
    beat: 'tick4', atMs: 6300, bossHp: 340, dmg: 104,
    rows: [...comp.plain('T+0:30', 52, 18, 14), comp.molten('T+0:30', 20), comp.total('T+0:30', 4, 104, 340)],
    foot: ['DEALT Σ 460', 'BOSS HP 340'],
  },
  {
    beat: 'tick5', atMs: 7600, bossHp: 244, dmg: 96,
    rows: [...comp.plain('T+0:36', 58, 22, 16), comp.total('T+0:36', 5, 96, 244)],
    foot: ['DEALT Σ 556', 'BOSS HP 244'],
  },
  {
    beat: 'tick6', atMs: 8900, bossHp: 88, dmg: 156,
    rows: [...comp.critSet('T+0:42'), comp.total('T+0:42', 6, 156, 88)],
    foot: ['DEALT Σ 712', 'BOSS HP 88'],
  },
  {
    beat: 'kill', atMs: 10200, bossHp: 0, dmg: 88, finished: true,
    rows: [
      { t: 'T+0:48', kind: 'crit', label: 'CRIT ×2.0 — DMG 30', amount: '−60' },
      { t: 'T+0:48', kind: 'proc', label: 'FIRE', amount: '−16', tint: '#FF7A1A' },
      { t: 'T+0:48', kind: 'hit', label: 'SPD', amount: '−12' },
      { t: 'T+0:48', kind: 'total', label: 'TICK 7 — TOTAL', amount: '−88', balance: 'HP 0' },
      { t: 'T+0:48', kind: 'mile', label: 'KILL — DUNE TYRANT' },
      { t: 'T+0:49', kind: 'yield', label: 'VICTORY — CREDITS', amount: '+1,500' },
      { t: 'T+0:49', kind: 'close', label: 'ACCOUNT SETTLED', amount: '−800', balance: 'HP 0' },
    ],
    foot: ['DEALT Σ 800', 'BOSS HP 0'],
  },
];

const FREEZE_COUNT: Record<string, number> = { rest: 1, telegraph: 4, kill: 9 };

const snapshot = (stepIdx: number, log: FightTimeline['damageLog']): FightTimeline => ({
  outcome: OUTCOME,
  startedAt: 0,
  finishedAt: STEPS[stepIdx].finished ? performance.now() : null,
  currentPhaseIndex: Math.min(stepIdx, PHASES.length - 1),
  playerHp: 340,
  playerHpMax: 340,
  bossHp: STEPS[stepIdx].bossHp,
  bossHpMax: 800,
  damageLog: log.slice(-6),
});

export const TickerBossPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [foot, setFoot] = useState<[string, string]>(STEPS[0].foot);
  const [timeline, setTimeline] = useState<FightTimeline>(() => snapshot(0, []));
  const timers = useRef<number[]>([]);
  const logRef = useRef<FightTimeline['damageLog']>([]);

  const applyStep = (idx: number) => {
    const s = STEPS[idx];
    if (s.dmg > 0) logRef.current = [...logRef.current, { id: `tb-${idx}`, target: 'boss' as const, value: s.dmg, phaseName: PHASES[0].phaseName }];
    setTimeline(snapshot(idx, logRef.current));
    tapePush(setEntries, s.rows);
    setFoot(s.foot);
  };

  useEffect(() => {
    const freeze = params.get('freeze');
    const count = freeze ? (FREEZE_COUNT[freeze] ?? 1) : 0;
    if (count > 0) {
      STEPS.slice(0, count).forEach((s, idx) => {
        if (s.dmg > 0) logRef.current = [...logRef.current, { id: `tb-${idx}`, target: 'boss' as const, value: s.dmg, phaseName: PHASES[0].phaseName }];
        setEntries((prev) => [...prev, ...s.rows.map((r, i) => ({ ...r, id: prev.length + i + 1 }))]);
        setFoot(s.foot);
        setTimeline(snapshot(idx, logRef.current));
      });
    } else {
      applyStep(0);
    }
    const play = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setEntries([]);
      logRef.current = [];
      STEPS.forEach((s, i) => timers.current.push(window.setTimeout(() => applyStep(i), s.atMs)));
    };
    const w = window as unknown as Record<string, unknown>;
    w.__playBoss = play;
    if (params.get('auto') === '1' && !freeze) timers.current.push(window.setTimeout(play, 500));
    return () => timers.current.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bossPct = (timeline.bossHp / timeline.bossHpMax) * 100;
  const playerPct = (timeline.playerHp / timeline.playerHpMax) * 100;

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <BossFightStageDom timeline={timeline} phases={PHASES} bossId={BOSS.id} weapon={FIXTURE_WEAPON} />
      <div className="mt-2 space-y-1">
        <GhostHpBar pct={bossPct} color="#F87171" testId="ticker-boss-bar" />
        <GhostHpBar pct={playerPct} color="#4ADE80" testId="ticker-player-bar" />
      </div>
      <TickerLedger title="BOSS — LEDGER" footLeft={foot[0]} footRight={foot[1]} entries={entries} height={300} />
    </div>
  );
};
