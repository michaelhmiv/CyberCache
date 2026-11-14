import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { CraftingBenchScene, ExtractionScene } from '@/components/pixelArt/ActionScenes';
import { BossFightStageDom } from '@/components/pixelArt/BossFightStage';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useSurvivalStore, useTickFeedStore } from '@/store';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
import type { FightTimeline } from '@/lib/animation/fightTimeline';
import { FIXTURE_PHASES, FIXTURE_WEAPON, FIXTURE_OUTCOME } from './fightFixture';

/**
 * IGNITION RAIL — dashboard iteration 06 (throwaway harness only).
 *
 * Every system that can actually fire in the activity sits as a CHIP
 * on a rail under the real stage. A chip is quiet (dim) until its
 * system fires in the staged beat; then it ignites in its own color
 * and throws an SVG arc from the chip to the exact point of action
 * on the stage (enemy, hunter, bench work point, extraction rig,
 * research desk). The player learns their build by watching which
 * chips light up.
 *
 * Data is the INDEX fixture, verbatim. Arithmetic closes:
 *   roam/boss ticks: 96 (58+22+16) · 104 (52+18+14+20) ·
 *   156 kill (44x2.0=88 +24+12+14+18). Enemy 300 -> 204 -> 100 -> 0.
 *   Boss Dune Tyrant (src/constants/bosses.ts): 800 HP, the staged
 *   segment opens at 356 so the same three ticks close it:
 *   356 -> 260 -> 156 -> 0. Sand Slam: special every 18 s, 3 s
 *   windup (boss cadence def) — the telegraph beat.
 *
 * Drive: ?activity=roam|boss|craft|gather|research ?beat=<name>
 *        window.__setBeat(name) switches beats live (capture rig).
 *        ?auto=1 (roam) plays rest -> surge -> kill on a loop (clip).
 */

type ChipDef = {
  id: string;
  name: string;
  color: string;
  /** stage anchor the arc lands on, as fractions of the stage box */
  anchor: { x: number; y: number };
  /** value printed on the chip when it ignites in a given beat */
  values: Record<string, string>;
};

type BeatDef = {
  /** chip ids igniting in this beat, in ignition order */
  fire: string[];
  /** headline readout over the rail (real numbers only) */
  readout: string;
  /** impact label rendered at the primary anchor */
  impact?: string;
};

const ENEMY = { x: 0.72, y: 0.42 };
const HUNTER = { x: 0.27, y: 0.52 };
const BENCH = { x: 0.58, y: 0.62 };
const RIG = { x: 0.58, y: 0.58 };
const DESK = { x: 0.5, y: 0.46 };

const COMBAT_CHIPS: ChipDef[] = [
  { id: 'crit', name: 'CRIT', color: '#FFD23D', anchor: ENEMY, values: { kill: 'x2.0 · 88' } },
  { id: 'fire', name: 'FIRE', color: '#FF7A1A', anchor: ENEMY, values: { surge: '18', kill: '24' } },
  { id: 'molten', name: 'MOLTEN CORE', color: '#FFA01F', anchor: ENEMY, values: { surge: '20', kill: '14' } },
  { id: 'echo', name: 'ECHO CHAMBER', color: '#3FD6E8', anchor: ENEMY, values: { kill: '18' } },
  { id: 'shield', name: 'SHIELD', color: '#4ADE80', anchor: HUNTER, values: { surge: '64 > 36' } },
];

const ACTIVITIES: Record<string, { title: string; chips: ChipDef[]; beats: Record<string, BeatDef>; order: string[] }> = {
  roam: {
    title: 'ROAM · WRAITH SCAVENGER · HP',
    chips: COMBAT_CHIPS,
    order: ['rest', 'surge', 'kill'],
    beats: {
      rest: { fire: [], readout: '204 / 300' },
      surge: { fire: ['molten', 'shield'], readout: '204 > 100 · TICK 104', impact: '-104' },
      kill: { fire: ['crit', 'molten', 'echo'], readout: '100 > 0 · TICK 156 · +1 TechFragments', impact: '-156' },
    },
  },
  boss: {
    title: 'BOSS · DUNE TYRANT · HP',
    chips: [
      ...COMBAT_CHIPS,
      { id: 'slam', name: 'SAND SLAM', color: '#F87171', anchor: HUNTER, values: { telegraph: 'WINDUP 3S', kill: '' } },
    ],
    order: ['rest', 'telegraph', 'kill'],
    beats: {
      rest: { fire: [], readout: '356 / 800' },
      telegraph: { fire: ['slam'], readout: '356 / 800 · SAND SLAM IN 3S', impact: 'TELEGRAPH' },
      kill: { fire: ['crit', 'molten', 'echo'], readout: '156 > 0 · TICK 156', impact: '-156' },
    },
  },
  craft: {
    title: 'BENCH · PATCH KIT',
    chips: [
      { id: 'scrap', name: 'SCRAP x10', color: '#B8C0CC', anchor: BENCH, values: { slow: 'CONSUMED' } },
      { id: 'reactive', name: 'REACTIVE x1', color: '#3FD6E8', anchor: BENCH, values: { slow: 'CONSUMED' } },
      { id: 'temper', name: 'TEMPERING', color: '#FFA01F', anchor: BENCH, values: { slow: 'PACE 2/MIN', ramped: 'PACE 9/MIN' } },
      { id: 'kit', name: 'PATCH KIT', color: '#4ADE80', anchor: BENCH, values: { complete: '+1' } },
    ],
    order: ['slow', 'ramped', 'complete'],
    beats: {
      slow: { fire: ['scrap', 'reactive'], readout: 'PACE 2 / MIN', impact: '' },
      ramped: { fire: ['temper'], readout: 'PACE 9 / MIN', impact: 'WORK' },
      complete: { fire: ['kit'], readout: '+1 PATCH KIT', impact: '+1 Patch Kit' },
    },
  },
  gather: {
    title: 'EXTRACTION · DUSTWASTE FRONTIER · SURFACE PASS 10 MIN',
    chips: [
      { id: 'find', name: 'FIND', color: '#FFA01F', anchor: RIG, values: { flow: '+ TechFragments' } },
      { id: 'signature', name: 'SIGNATURE · SILTGLASS', color: '#3FD6E8', anchor: RIG, values: { yield: '+ Siltglass' } },
      { id: 'pass', name: 'PASS', color: '#B8C0CC', anchor: RIG, values: { yield: 'COMPLETE' } },
      { id: 'mastery', name: 'MASTERY', color: '#4ADE80', anchor: RIG, values: { yield: '+20 XP' } },
    ],
    order: ['start', 'flow', 'yield'],
    beats: {
      start: { fire: [], readout: 'PASS 0:00 / 10:00 · 192 DRAWS/HR' },
      flow: { fire: ['find'], readout: 'FIND · TechFragments', impact: '+ TechFragments' },
      yield: { fire: ['pass', 'signature', 'mastery'], readout: 'PASS COMPLETE · +20 MASTERY XP', impact: '+ Siltglass' },
    },
  },
  research: {
    title: 'RESEARCH · SHOP FUNDAMENTALS · FABRICATION T1 · 6 H',
    chips: [
      { id: 'enroll', name: 'ENROLL', color: '#B8C0CC', anchor: DESK, values: { start: '-2,500 CR' } },
      { id: 'study', name: 'STUDY', color: '#FFA01F', anchor: DESK, values: { flow: '3H / 6H' } },
      { id: 'quality', name: 'CRAFT QUALITY SHIFT', color: '#4ADE80', anchor: DESK, values: { done: '+2' } },
    ],
    order: ['start', 'flow', 'done'],
    beats: {
      start: { fire: ['enroll'], readout: 'ENROLLED · 2,500 CR · 6 H', impact: '-2,500 CR' },
      flow: { fire: ['study'], readout: '3H / 6H', impact: '' },
      done: { fire: ['quality'], readout: 'COMPLETE · CRAFT QUALITY SHIFT +2', impact: '+2 QUALITY' },
    },
  },
};

const HARNESS_WEAPON: Weapon = {
  id: 'roam-harness-weapon',
  name: 'Harness Carbine',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  rarity: Rarity.Epic,
  element: Element.Fire,
  level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } },
    { slot: 'Grip', modifier: { handling: 1.04 } },
    { slot: 'Core', modifier: { baseDamage: 1.02 } },
    { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
    { slot: 'Sight', modifier: { critChance: 1.06 } },
    { slot: 'Chamber', modifier: { fireRate: 0.98 } },
  ],
  pixelSeed: 42,
} as unknown as Weapon;

const seatJob = (): WorkshopJobView =>
  ({
    id: 'ignition-craft-job', bench: 0, kind: 'consumable', recipeId: 'recipe_patch_kit',
    name: 'Patch Kit', state: 'running', unitsTotal: 2, unitsCompleted: 0,
    unitDurationMs: 60_000, accruedMs: 12_000, remainingMs: 48_000, xpAwarded: 0,
    gearRarity: null, catalystMaterialId: null, outputs: [], createdAtMs: 0,
    completedAtMs: null, repairItemId: null, repairKitType: null, repairPointsRestored: 0,
  }) as WorkshopJobView;

const bossTimeline = (bossHp: number, finished: boolean): FightTimeline => ({
  outcome: FIXTURE_OUTCOME,
  startedAt: 0,
  finishedAt: finished ? 1 : null,
  currentPhaseIndex: 0,
  playerHp: 340,
  playerHpMax: 340,
  bossHp,
  bossHpMax: 800,
  damageLog: [],
});

const Rail: React.FC<{
  activity: string; beat: string; stageRef: React.RefObject<HTMLDivElement | null>;
}> = ({ activity, beat, stageRef }) => {
  const def = ACTIVITIES[activity];
  const beatDef = def.beats[beat];
  const [lit, setLit] = useState<string[]>([]);
  const [arcs, setArcs] = useState<{ chip: ChipDef; d: string; key: number }[]>([]);
  const chipRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const railRef = useRef<HTMLDivElement | null>(null);

  // Ignition sequence: chips light in fixture order, staggered —
  // the sequence IS the teaching (crit first on the kill tick).
  useEffect(() => {
    setLit([]);
    setArcs([]);
    const timers = beatDef.fire.map((id, i) =>
      window.setTimeout(() => setLit((prev) => [...prev, id]), 60 + i * 150),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, beat]);

  // Arcs: measured from each lit chip's real center to its anchor
  // point on the stage box — geometry measured, never eyeballed.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const rail = railRef.current;
    if (!stage || !rail) return;
    const s = stage.getBoundingClientRect();
    const next = lit.map((id) => {
      const chip = def.chips.find((c) => c.id === id)!;
      const el = chipRefs.current[id];
      if (!el) return null;
      const c = el.getBoundingClientRect();
      const x1 = c.left + c.width / 2 - s.left;
      const y1 = c.top - s.top;
      const x2 = chip.anchor.x * s.width;
      const y2 = chip.anchor.y * s.height;
      const midY = Math.min(y1, y2) - 46;
      return { chip, key: Date.now() + x1, d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}` };
    }).filter(Boolean) as { chip: ChipDef; d: string; key: number }[];
    setArcs(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, activity, beat]);

  const primary = beatDef.fire.length
    ? def.chips.find((c) => c.id === beatDef.fire[0])
    : undefined;

  return (
    <>
      {/* arc layer: spans stage + rail, drawn over the stage box coords */}
      <svg
        data-testid="ignition-arcs"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 40, overflow: 'visible' }}
      >
        {arcs.map((a) => (
          <g key={a.key}>
            <path d={a.d} fill="none" stroke={a.chip.color} strokeWidth={7} opacity={0.22} strokeLinecap="round" />
            <path d={a.d} fill="none" stroke={a.chip.color} strokeWidth={2.5} opacity={0.95} strokeLinecap="round" />
          </g>
        ))}
        {arcs.map((a) => {
          const stage = stageRef.current;
          if (!stage) return null;
          const s = stage.getBoundingClientRect();
          return (
            <rect
              key={`hit-${a.key}`}
              x={a.chip.anchor.x * s.width - 5}
              y={a.chip.anchor.y * s.height - 5}
              width={10}
              height={10}
              fill={a.chip.color}
              transform={`rotate(45 ${a.chip.anchor.x * s.width} ${a.chip.anchor.y * s.height})`}
            />
          );
        })}
      </svg>
      {primary && beatDef.impact ? (
        <div
          data-testid="ignition-impact"
          style={{
            position: 'absolute', zIndex: 41, pointerEvents: 'none',
            left: `${primary.anchor.x * 100}%`, top: `${primary.anchor.y * 100}%`,
            transform: 'translate(-50%, -170%)',
            fontSize: 15, fontWeight: 900, color: primary.color,
            textShadow: '0 2px 0 #000', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          }}
        >
          {beatDef.impact}
        </div>
      ) : null}
      <div
        ref={railRef}
        data-testid="ignition-rail"
        style={{ background: '#07080B', border: '2px solid #232833', borderTop: 'none', padding: '10px 10px 12px', boxSizing: 'border-box' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: '#8A93A3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{def.title}</span>
          <span style={{ fontSize: 12, fontWeight: 900, color: '#F5F7FA', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{beatDef.readout}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {def.chips.map((chip) => {
            const on = lit.includes(chip.id);
            const value = chip.values[beat];
            return (
              <div
                key={chip.id}
                ref={(el) => { chipRefs.current[chip.id] = el; }}
                data-testid={`chip-${chip.id}`}
                style={{
                  border: `2px solid ${on ? chip.color : '#232833'}`,
                  background: on ? `${chip.color}26` : '#0B0D12',
                  boxShadow: on ? `0 0 14px ${chip.color}66` : 'none',
                  padding: '6px 8px', minHeight: 34, boxSizing: 'border-box',
                  display: 'flex', alignItems: 'center', gap: 6,
                  transition: 'border-color 120ms ease, background 120ms ease, box-shadow 120ms ease',
                }}
              >
                <span style={{ width: 8, height: 8, background: on ? chip.color : '#2A3040', transform: 'rotate(45deg)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.06em', color: on ? '#F5F7FA' : '#5B6472', whiteSpace: 'nowrap' }}>
                  {chip.name}
                </span>
                {on && value ? (
                  <span style={{ fontSize: 11, fontWeight: 900, color: chip.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

export const IgnitionHarnessPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const activity = ACTIVITIES[params.get('activity') ?? 'roam'] ? (params.get('activity') ?? 'roam') : 'roam';
  const def = ACTIVITIES[activity];
  const [beat, setBeat] = useState(params.get('beat') ?? def.order[0]);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (name: string) => { if (def.beats[name]) setBeat(name); };
    w.__fpsDeltas = [] as number[];
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      (w.__fpsDeltas as number[]).push(now - last);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity]);

  // Roam: seed the real stores so the diorama's own HP follows the beat.
  useEffect(() => {
    if (activity !== 'roam') return;
    const hp = beat === 'rest' ? 204 : beat === 'surge' ? 100 : 0;
    useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: hp, currentTargetHpMax: 300 });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
  }, [activity, beat]);

  // Roam clip autoplay: rest -> surge -> kill, held beats, looping.
  useEffect(() => {
    if (params.get('auto') !== '1' || activity !== 'roam') return;
    const seq: [string, number][] = [['rest', 1400], ['surge', 1900], ['kill', 2400], ['rest', 600]];
    let i = 0;
    let timer = 0;
    const step = () => {
      setBeat(seq[i][0]);
      timer = window.setTimeout(step, seq[i][1]);
      i = (i + 1) % seq.length;
    };
    const start = window.setTimeout(step, 500);
    return () => { window.clearTimeout(start); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity]);

  const bossHp = beat === 'rest' || beat === 'telegraph' ? 356 : 0;

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <div ref={stageRef} style={{ position: 'relative' }} data-testid="ignition-stage">
        {activity === 'roam' && (
          <LiveTurfDiorama
            area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
            weapon={HARNESS_WEAPON}
            playerLevel={5}
            equippedCount={4}
            activityKind="roaming_loot"
          />
        )}
        {activity === 'boss' && (
          <BossFightStageDom
            timeline={bossTimeline(bossHp, beat === 'kill')}
            phases={FIXTURE_PHASES}
            bossId="dune_tyrant"
            weapon={FIXTURE_WEAPON}
          />
        )}
        {activity === 'craft' && (
          <CraftingBenchScene
            progress={beat === 'slow' ? 0.3 : beat === 'ramped' ? 0.8 : 1}
            causeLabel="Tempering · Patch Kit"
            buysLabel="-> Patch Kit x1"
            working={beat !== 'complete'}
            result={beat === 'complete' ? 'success' : null}
            seatJob={seatJob()}
          />
        )}
        {activity === 'gather' && (
          <ExtractionScene
            progress={beat === 'start' ? 0.05 : beat === 'flow' ? 0.45 : 1}
            causeLabel="Surface Pass · Dustwaste Frontier"
            buysLabel="-> Materials + Essences"
            working={beat !== 'yield'}
            result={beat === 'yield' ? 'success' : null}
          />
        )}
        {activity === 'research' && (
          <div
            data-testid="research-desk"
            style={{ border: '2px solid #232833', background: '#0B0D12', padding: '18px 16px', minHeight: 228, boxSizing: 'border-box' }}
          >
            <div style={{ fontSize: 13, fontWeight: 900, color: '#F5F7FA', letterSpacing: '0.04em' }}>Shop Fundamentals</div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#8A93A3', marginTop: 4, letterSpacing: '0.06em' }}>FABRICATION · TIER 1 · 6 H · 2,500 CR</div>
            <div style={{ marginTop: 18, height: 12, background: '#1A1E27', display: 'flex' }}>
              <div style={{ width: beat === 'start' ? '2%' : beat === 'flow' ? '50%' : '100%', background: '#FFA01F', transition: 'width 400ms ease' }} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#8A93A3', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
              {beat === 'start' ? '0H / 6H' : beat === 'flow' ? '3H / 6H' : '6H / 6H'}
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: beat === 'done' ? '#4ADE80' : '#5B6472', marginTop: 16 }}>
              Unlock: Craft quality shift +2 on every completed craft unit
            </div>
          </div>
        )}
        <Rail activity={activity} beat={beat} stageRef={stageRef} />
      </div>
    </div>
  );
};
