import React, { useEffect, useRef, useState } from 'react';
import { LiveTurfDiorama, DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';
import { CraftingBenchScene } from '@/components/pixelArt/ActionScenes';
import { BossFightStageDom } from '@/components/pixelArt/BossFightStage';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useLoadoutStore, useTickFeedStore, useExtractionFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
import type { ChefExtractionPass } from '@/lib/chef/chefClient';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { FIXTURE_BOSS_ID, FIXTURE_PHASES, FIXTURE_WEAPON as BOSS_WEAPON, freezeSnapshot } from './fightFixture';
import { motion } from 'framer-motion';

/**
 * ANATOMY STACK (iter-02, THROWAWAY harness prototype, 2026-11-13).
 * Every event visibly BUILDS as a stack of labeled parts that totals
 * itself: blocks land one by one (bottom-up), a total cap locks on
 * top, and only then does the target bar give up exactly that much.
 * Presentation only — no combat math; all numbers are the INDEX
 * fixtures verbatim or real defs (cited in iter-02 README).
 *
 *   ?act=roam|boss|craft|gather|research
 *   ?beat=<beat name>   deterministic still state
 *   ?auto=1             roam only: full timeline for the clip
 */

const WEAPON: Weapon = {
  id: 'roam-harness-weapon', name: 'Harness Carbine', weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood, rarity: Rarity.Epic, element: Element.Fire, level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } }, { slot: 'Grip', modifier: { handling: 1.04 } },
    { slot: 'Core', modifier: { baseDamage: 1.02 } }, { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
    { slot: 'Sight', modifier: { critChance: 1.06 } }, { slot: 'Chamber', modifier: { fireRate: 0.98 } },
  ], pixelSeed: 42,
} as unknown as Weapon;
void DropSource;

interface Block { label: string; value: number; color: string; foreign?: boolean; note?: string }
const C = { dmg: '#E8EAF0', fire: '#FF7A1A', spd: '#F5B83D', molten: '#FF4D2E', echo: '#B78CFF', foreign: '#FF3B5C', teal: '#3EC6B8', green: '#4ADE80', blue: '#5EA8FF', tan: '#C9A86A' };

const T1: Block[] = [
  { label: 'DMG', value: 58, color: C.dmg }, { label: 'FIRE', value: 22, color: C.fire }, { label: 'SPD', value: 16, color: C.spd },
];
const T2: Block[] = [
  { label: 'DMG', value: 52, color: C.dmg }, { label: 'FIRE', value: 18, color: C.fire }, { label: 'SPD', value: 14, color: C.spd }, { label: 'MOLTEN', value: 20, color: C.molten, note: 'MOLTEN CORE' },
];
const T3: Block[] = [
  { label: 'DMG 44 ×2.0', value: 88, color: C.dmg, note: 'CRIT' }, { label: 'FIRE', value: 24, color: C.fire },
  { label: 'SPD', value: 12, color: C.spd }, { label: 'MOLTEN', value: 14, color: C.molten, note: 'MOLTEN CORE' }, { label: 'ECHO', value: 18, color: C.echo, note: 'ECHO CHAMBER' },
];

const Stack: React.FC<{ blocks: Block[]; step: number; totalLabel: string; pending?: boolean; unit?: string }> = ({ blocks, step, totalLabel, pending, unit }) => {
  const shown = blocks.slice(0, step);
  const sum = shown.reduce((a, b) => a + b.value, 0);
  const complete = step >= blocks.length && !pending;
  const max = Math.max(...blocks.map((b) => b.value), 1);
  return (
    <div data-testid="anatomy-stack" style={{ display: 'flex', flexDirection: 'column-reverse', gap: 3 }}>
      {shown.map((b, i) => (
        <div key={i} style={{
          height: Math.max(20, Math.round((b.value / max) * 30)), display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 10px', background: b.foreign ? 'transparent' : b.color, color: b.foreign ? C.foreign : '#0B0C10',
          border: b.foreign ? `2px dashed ${C.foreign}` : 'none', marginLeft: b.foreign ? 18 : 0,
          fontSize: 12, fontWeight: 900, letterSpacing: '0.04em', boxSizing: 'border-box',
        }}>
          <span>{b.label}{b.note ? ` · ${b.note}` : ''}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{b.value}{unit ?? ''}</span>
        </div>
      ))}
      {shown.length > 0 && (
        <div style={{
          order: 99, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px',
          background: complete ? '#F5F5F0' : '#171A21', color: complete ? '#0B0C10' : '#8A93A3',
          border: '2px solid #2A2F3A', fontSize: 13, fontWeight: 900, boxSizing: 'border-box',
        }}>
          <span>{totalLabel}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{pending ? '···' : sum}{unit ?? ''}</span>
        </div>
      )}
      {shown.length === 0 && (
        <div style={{ padding: '6px 10px', border: '2px dashed #2A2F3A', color: '#5B6370', fontSize: 12, fontWeight: 800 }}>STACK EMPTY</div>
      )}
    </div>
  );
};

const Panel: React.FC<{ title: string; right: string; children: React.ReactNode }> = ({ title, right, children }) => (
  <div style={{ background: '#07080B', border: '2px solid #232833', borderTop: 'none', padding: '10px 12px 12px', boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.08em', color: '#E8EAF0' }}>{title}</span>
      <span style={{ fontSize: 12, fontWeight: 900, color: '#F5B83D', fontVariantNumeric: 'tabular-nums' }}>{right}</span>
    </div>
    {children}
  </div>
);

const HpLine: React.FC<{ label: string; before: number; after: number; max: number; locked: boolean }> = ({ label, before, after, max, locked }) => {
  const shown = locked ? after : before;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 800, color: '#8A93A3' }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: locked ? '#FF7A1A' : '#8A93A3' }}>{before} → {after} HP</span>
      </div>
      <div style={{ height: 10, background: '#1A1E27', marginTop: 4 }}>
        <div style={{ height: '100%', width: `${(shown / max) * 100}%`, background: locked ? '#FF4D2E' : '#4ADE80', transition: 'width 350ms ease' }} />
      </div>
    </div>
  );
};

const Roam: React.FC<{ beat: string; auto: boolean }> = ({ beat, auto }) => {
  const beats: Record<string, { blocks: Block[]; hp: [number, number]; label: string }> = {
    rest: { blocks: T1, hp: [300, 300], label: 'WRAITH SCAVENGER' },
    surge: { blocks: T1, hp: [300, 204], label: 'TICK 1 · HIT' },
    molten: { blocks: T2, hp: [204, 100], label: 'TICK 2 · MOLTEN CORE' },
    kill: { blocks: T3, hp: [100, 0], label: 'TICK 3 · CRIT — KILL' },
  };
  const [cur, setCur] = useState(beat);
  const [step, setStep] = useState(99);
  const timers = useRef<number[]>([]);
  const b = beats[cur] ?? beats.rest;
  const locked = step >= b.blocks.length;

  useEffect(() => {
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useLoadoutStore.getState().setSlot('vehicle', null);
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const playBeat = (name: string, startAt: number) => {
      const bb = beats[name];
      at(startAt, () => { setCur(name); setStep(0); useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: bb.hp[0], currentTargetHpMax: 300 }); });
      bb.blocks.forEach((_, i) => at(startAt + 350 + i * 480, () => setStep(i + 1)));
      at(startAt + 350 + bb.blocks.length * 480 + 250, () => useKillCycleStore.setState({ currentTargetHp: bb.hp[1] }));
    };
    if (auto) { playBeat('surge', 400); playBeat('molten', 3600); playBeat('kill', 7000); }
    else {
      setCur(beat); setStep(99);
      useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: b.hp[1], currentTargetHpMax: 300 });
    }
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={WEAPON} playerLevel={5} equippedCount={4} activityKind="roaming_loot" />
      <Panel title={b.label} right={cur === 'kill' && locked ? '+1 TECHFRAGMENTS' : 'CRIT 25% · ×2.0'}>
        {cur === 'rest' ? <Stack blocks={[]} step={0} totalLabel="TOTAL" /> : <Stack blocks={b.blocks} step={step} totalLabel="TOTAL" />}
        <HpLine label="WRAITH SCAVENGER" before={b.hp[0]} after={b.hp[1]} max={300} locked={locked && cur !== 'rest'} />
        {cur === 'molten' && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: C.foreign }}>ENEMY SWIPE · SHLD 64 → 36 · RECHARGING → 52</div>}
      </Panel>
    </div>
  );
};

const Boss: React.FC<{ beat: string }> = ({ beat }) => {
  const freeze = beat === 'rest' ? 0 : beat === 'telegraph' ? 1 : 2;
  const teleBlocks: Block[] = [...T2, { label: 'INCOMING SWIPE', value: 28, color: C.foreign, foreign: true, note: 'SHLD 64 → 36' }];
  return (
    <div>
      <BossFightStageDom timeline={freezeSnapshot(freeze)} phases={FIXTURE_PHASES} bossId={FIXTURE_BOSS_ID} weapon={BOSS_WEAPON} />
      <Panel title={beat === 'telegraph' ? 'DUNE TYRANT · TELEGRAPH IN STACK' : beat === 'surge' ? 'DUNE TYRANT · TICK 3 ANATOMY' : 'DUNE TYRANT'} right="DMG THIS TICK">
        {beat === 'rest' && <Stack blocks={[]} step={0} totalLabel="TOTAL" />}
        {beat === 'telegraph' && <Stack blocks={teleBlocks} step={99} totalLabel="TOTAL" pending />}
        {beat === 'surge' && <Stack blocks={T3} step={99} totalLabel="TOTAL" />}
        {beat === 'telegraph' && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: C.foreign }}>FOREIGN BLOCK ENTERS BEFORE THE TICK RESOLVES</div>}
      </Panel>
    </div>
  );
};

const seatJob = (): WorkshopJobView => ({
  id: 'anatomy-craft-job', bench: 0, kind: 'consumable', recipeId: 'recipe_patch_kit', name: 'Patch Kit', state: 'running',
  unitsTotal: 2, unitsCompleted: 0, unitDurationMs: 60_000, accruedMs: 12_000, remainingMs: 48_000, xpAwarded: 0,
  gearRarity: null, catalystMaterialId: null, outputs: [], createdAtMs: 0, completedAtMs: null, repairItemId: null, repairKitType: null, repairPointsRestored: 0,
}) as WorkshopJobView;

const Craft: React.FC<{ beat: string }> = ({ beat }) => {
  const cfg = {
    slow: { progress: 0.3, pace: 'PACE 2 / MIN', groups: [1, 1] as number[], working: true, done: false },
    ramped: { progress: 0.55, pace: 'PACE 5 / MIN', groups: [1, 1, 2, 2] as number[], working: true, done: false },
    complete: { progress: 1, pace: 'PACE 9 / MIN', groups: [1, 1, 2, 2, 4] as number[], working: false, done: true },
  }[beat] ?? { progress: 0.12, pace: 'PACE 2 / MIN', groups: [] as number[], working: false, done: false };
  const totalBeats = cfg.groups.reduce((a, n) => a + n, 0);
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <CraftingBenchScene progress={cfg.progress} causeLabel="Tempering · Patch Kit" buysLabel="→ Patch Kit ×1" working={cfg.working} result={cfg.done ? 'success' : null} seatJob={seatJob()} />
        {cfg.done && (
          <div className="pointer-events-none absolute z-30" style={{ left: '58%', top: '67%', width: 46, height: 58, transform: 'translate(-50%, -78%)' }}>
            <motion.div initial={{ y: 6, opacity: 0, scale: 0.6 }} animate={{ y: [6, -14, -26, -30], opacity: [0, 1, 1, 0], scale: [0.6, 1.05, 1, 0.8] }} transition={{ duration: 1.6, times: [0, 0.3, 0.75, 1], ease: 'easeOut' }} style={{ width: '100%', height: '100%' }}>
              <DropRiseIcon tone="material" label="+1 Patch Kit" />
            </motion.div>
          </div>
        )}
      </div>
      <Panel title="PATCH KIT · WORK BEATS" right={cfg.pace}>
        <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 6 }}>
          {cfg.groups.map((n, gi) => (
            <div key={gi} style={{ display: 'flex', gap: n === 1 ? 0 : 2 }}>
              {Array.from({ length: n }, (_, i) => (
                <div key={i} style={{ flex: 1, height: 18, background: gi === cfg.groups.length - 1 && cfg.done ? '#4ADE80' : '#F5B83D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: '#0B0C10' }}>
                  {i === 0 ? (gi < 2 ? 'BEAT · SINGLE' : gi < 4 ? 'BEATS · PAIRED' : 'BEATS · CONTINUOUS') : ''}
                </div>
              ))}
            </div>
          ))}
          {cfg.groups.length === 0 && <div style={{ padding: '6px 10px', border: '2px dashed #2A2F3A', color: '#5B6370', fontSize: 12, fontWeight: 800 }}>STACK EMPTY</div>}
        </div>
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 900, color: cfg.done ? '#4ADE80' : '#8A93A3' }}>
          <span>{cfg.done ? '+1 PATCH KIT' : 'PROGRESS'}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalBeats} BEATS · {Math.round(cfg.progress * 100)}%</span>
        </div>
      </Panel>
    </div>
  );
};

const PASS: ChefExtractionPass = { index: 7, areaId: 'dustwaste_frontier', method: 'surface', draws: 32, gearFactor: 1, deepDegraded: false, xpAwarded: 120, materials: { TechFragments: 14, BallisticParts: 9, Dustglass: 4 }, essences: { IgnitionFluid: 6 }, signatureUnits: 0 };
const GATHER_BLOCKS: Block[] = [
  { label: 'TECHFRAGMENTS', value: 14, color: C.teal }, { label: 'BALLISTIC PARTS', value: 9, color: C.tan },
  { label: 'DUSTGLASS', value: 4, color: C.blue }, { label: 'IGNITION FLUID', value: 6, color: C.fire },
];
const Gather: React.FC<{ beat: string }> = ({ beat }) => {
  useEffect(() => {
    if (beat !== 'start') { const t = window.setTimeout(() => useExtractionFeedStore.getState().pushPass(PASS), 1200); return () => window.clearTimeout(t); }
    return undefined;
  }, [beat]);
  const step = beat === 'start' ? 0 : beat === 'flow' ? 2 : 99;
  return (
    <div>
      <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={WEAPON} playerLevel={5} equippedCount={1} activityKind={'extraction' as never} />
      <Panel title="EXTRACTION PASS 7 · SURFACE · 32 DRAWS" right="+120 XP">
        <Stack blocks={GATHER_BLOCKS} step={step} totalLabel="UNITS" />
      </Panel>
    </div>
  );
};

const Research: React.FC<{ beat: string }> = ({ beat }) => {
  const done = beat === 'done' ? 6 : beat === 'flow' ? 3 : 0;
  const blocks: Block[] = Array.from({ length: 6 }, (_, i) => ({ label: `HOUR ${i + 1}`, value: 1, color: C.blue }));
  return (
    <div>
      <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={WEAPON} playerLevel={5} equippedCount={4} activityKind={'idle_standby' as never} />
      <Panel title="SHOP FUNDAMENTALS · FABRICATION T1" right="2,500 CR · 6 H">
        <Stack blocks={blocks} step={done} totalLabel="HOURS" unit="h" />
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 900, color: done === 6 ? '#4ADE80' : '#8A93A3' }}>
          <span>{done === 6 ? 'CRAFT QUALITY SHIFT +2' : 'EFFECT ON COMPLETION'}</span><span>{done}/6 H</span>
        </div>
      </Panel>
    </div>
  );
};

export const AnatomyHarnessPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const act = params.get('act') ?? 'roam';
  const beat = params.get('beat') ?? 'rest';
  const auto = params.get('auto') === '1';
  useEffect(() => { useTickFeedStore.setState({ events: [] }); }, []);
  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box', minHeight: '100vh' }} data-testid="anatomy-root">
      {act === 'roam' && <Roam beat={beat} auto={auto} />}
      {act === 'boss' && <Boss beat={beat} />}
      {act === 'craft' && <Craft beat={beat} />}
      {act === 'gather' && <Gather beat={beat} />}
      {act === 'research' && <Research beat={beat} />}
    </div>
  );
};
