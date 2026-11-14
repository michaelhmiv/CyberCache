import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LiveTurfDiorama, DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';
import { BossFightStageDom } from '@/components/pixelArt/BossFightStage';
import { CraftingBenchScene } from '@/components/pixelArt/ActionScenes';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useExtractionFeedStore, useKillCycleStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
import type { ChefExtractionPass } from '@/lib/chef/chefClient';
import type { FightTimeline } from '@/lib/animation/fightTimeline';
import { FIXTURE_PHASES, FIXTURE_WEAPON } from './fightFixture';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { Weapon } from '@/types/items';

/**
 * Spotlight Solo (dashboard iteration 12, THROWAWAY harness only).
 * One number huge at a time, everything else dimmed — radical
 * selectivity. At every beat exactly ONE real number owns the
 * surface at display size while the real shipped scene + chrome
 * drop to a dimmed register; between beats the last solo holds,
 * dimmer. Every solo value is a real fixture/def value and the
 * solo sequence per act follows the real event order (README).
 *
 *   ?act=roam|boss|craft|gather|research
 *   ?beat=<name>     deterministic still beat (default: first)
 *   ?auto=1          roam only: play the full solo sequence
 *   window.__setBeat(name) — the capture rig's seam.
 */

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

/** R2 harness pass verbatim (cc-stage-r2 LootHarnessPage FIXTURE_PASS). */
const FIXTURE_PASS: ChefExtractionPass = {
  index: 7,
  areaId: 'dustwaste_frontier',
  method: 'surface',
  draws: 32,
  gearFactor: 1,
  deepDegraded: false,
  xpAwarded: 120,
  materials: { TechFragments: 14, BallisticParts: 9, Dustglass: 4 },
  essences: { IgnitionFluid: 6 },
  signatureUnits: 0,
};

const seatJob = (): WorkshopJobView =>
  ({
    id: 'spotlight-craft-job',
    bench: 0,
    kind: 'consumable',
    recipeId: 'recipe_patch_kit',
    name: 'Patch Kit',
    state: 'running',
    unitsTotal: 2,
    unitsCompleted: 0,
    unitDurationMs: 60_000,
    accruedMs: 12_000,
    remainingMs: 48_000,
    xpAwarded: 0,
    gearRarity: null,
    catalystMaterialId: null,
    outputs: [],
    createdAtMs: 0,
    completedAtMs: null,
    repairItemId: null,
    repairKitType: null,
    repairPointsRestored: 0,
  }) as WorkshopJobView;

type Solo = { value: string; name: string; sub: string; color: string; held?: boolean };
const WHITE = '#F5F7FA';
const AMBER = '#F5B83D';
const ORANGE = '#FF7A1A';
const GREEN = '#4ADE80';

let beatSeq = 0;
const seedBeatEvent = (partial: Partial<TickEvent>) => {
  beatSeq += 1;
  const event = { id: `spotlight-beat-${beatSeq}`, at: Date.now(), detail: 'harness', ...partial } as TickEvent;
  useTickFeedStore.setState({ events: [event] });
};

const bossTimeline = (bossHp: number, phase: number, log: { id: string; value: number; phaseName: string }[]): FightTimeline => ({
  outcome: {
    result: { victory: false, winChance: 0.75 },
    creditsDelta: 0,
    bonusLootRolls: 0,
    consumedConsumables: {},
    loot: [],
    extraLoot: false,
  },
  startedAt: 0,
  finishedAt: null,
  currentPhaseIndex: phase,
  playerHp: 340,
  playerHpMax: 340,
  bossHp,
  bossHpMax: 800,
  damageLog: log.map((e) => ({ target: 'boss' as const, ...e })),
});

const ACT_TITLES: Record<string, { title: string; fixture: string; footer: string }> = {
  roam: { title: 'ROAM — LIVE TURF', fixture: 'WRAITH SCAVENGER · HUNTER L5 · EPIC FIRE SNIPER CARBINE', footer: 'CRIT 25% · ×2.0 · TICK 3S' },
  boss: { title: 'BOSS — DUNE TYRANT', fixture: 'TIER 1 · LEVEL 5 · 800 HP · SAND SLAM EVERY 18S · WINDUP 3S', footer: 'PLAYER HP 340 / 340 · SPECIAL SHARE 0.35' },
  craft: { title: 'CRAFT — PATCH KIT', fixture: 'RECIPE_PATCH_KIT · SCRAP 10 · REACTIVE COMPONENTS 1 · 12 MIN UNIT', footer: 'BENCH 1 · PACE RAMP 2 → 5 → 9 / MIN' },
  gather: { title: 'GATHER — EXTRACTION', fixture: 'SURFACE PASS · DUSTWASTE FRONTIER · 10 MIN PER PASS', footer: '192 DRAWS / HR · MASTERY +20 PER PASS' },
  research: { title: 'RESEARCH — SHOP FUNDAMENTALS', fixture: 'FABRICATION T1 · 6 H · 2,500 CR', footer: 'EFFECT AT COMPLETION — CRAFT QUALITY SHIFT +2' },
};

export const SpotlightHarnessPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const act = params.get('act') ?? 'roam';
  const auto = params.get('auto') === '1';
  const [solo, setSolo] = useState<Solo>({ value: '—', name: '', sub: '', color: WHITE, held: true });
  const [bossTl, setBossTl] = useState<FightTimeline>(() => bossTimeline(800, 0, []));
  const [craft, setCraft] = useState({ progress: 0.12, working: false, result: null as 'success' | null, riseKey: 0 });
  const pushedRef = useRef(false);
  const timers = useRef<number[]>([]);

  const applyBeat = (beat: string) => {
    if (act === 'roam') {
      if (beat === 'rest') {
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 300, currentTargetHpMax: 300 });
        setSolo({ value: '300', name: 'WRAITH SCAVENGER — HP', sub: 'AT REST · NO TICK YET', color: WHITE, held: true });
      } else if (beat === 'surge') {
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 204, currentTargetHpMax: 300 });
        seedBeatEvent({ tone: 'loot', label: '-96', value: 96 });
        setSolo({ value: '96', name: 'TICK 1 — TOTAL', sub: 'DMG 58 · FIRE 22 · SPD 16 — HP 300 → 204', color: WHITE });
      } else if (beat === 'molten') {
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 100, currentTargetHpMax: 300 });
        seedBeatEvent({ tone: 'loot', label: '-104', value: 104 });
        setSolo({ value: '104', name: 'TICK 2 — TOTAL', sub: 'DMG 52 · FIRE 18 · SPD 14 · MOLTEN 20 — HP 204 → 100', color: WHITE });
      } else if (beat === 'proc') {
        setSolo({ value: '20', name: 'MOLTEN CORE', sub: 'TICK 2 PROC — INSIDE THE 104 · SHLD 64 → 36 · RECHARGING → 52', color: ORANGE });
      } else if (beat === 'kill') {
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 0, currentTargetHpMax: 300 });
        seedBeatEvent({ tone: 'kill', label: 'kill', value: 156 });
        setSolo({ value: '156', name: 'TICK 3 — CRIT · KILL', sub: 'DMG 44 ×2.0 = 88 · FIRE 24 · SPD 12 · MOLTEN 14 · ECHO 18 — HP 100 → 0', color: AMBER });
      } else if (beat === 'drop') {
        seedBeatEvent({ tone: 'material', label: '+1 TechFragments', value: 1 });
        setSolo({ value: '+1', name: 'TECHFRAGMENTS', sub: 'DROP AT THE KILL SPOT · BEAM + RISE SHIPPED', color: GREEN });
      }
    } else if (act === 'boss') {
      if (beat === 'rest') {
        setBossTl(bossTimeline(800, 0, []));
        setSolo({ value: '800', name: 'DUNE TYRANT — HP', sub: 'AT REST · NO TICK YET', color: WHITE, held: true });
      } else if (beat === 'telegraph') {
        setBossTl(bossTimeline(600, 1, [
          { id: 'sb-1', value: 96, phaseName: FIXTURE_PHASES[0].phaseName },
          { id: 'sb-2', value: 104, phaseName: FIXTURE_PHASES[1].phaseName },
        ]));
        setSolo({ value: '3', name: 'SAND SLAM — WINDUP · SECONDS', sub: 'SPECIAL EVERY 18S · PRESENTED PHASE 2 OF 3 · BOSS HP 600 / 800', color: ORANGE });
      } else if (beat === 'kill') {
        setBossTl(bossTimeline(444, 2, [
          { id: 'sb-1', value: 96, phaseName: FIXTURE_PHASES[0].phaseName },
          { id: 'sb-2', value: 104, phaseName: FIXTURE_PHASES[1].phaseName },
          { id: 'sb-3', value: 156, phaseName: FIXTURE_PHASES[2].phaseName },
        ]));
        setSolo({ value: '156', name: 'TICK 3 — CRIT', sub: 'DMG 44 ×2.0 = 88 · FIRE 24 · SPD 12 · MOLTEN 14 · ECHO 18 — HP 600 → 444', color: AMBER });
      }
    } else if (act === 'craft') {
      if (beat === 'slow') {
        setCraft({ progress: 0.3, working: true, result: null, riseKey: 0 });
        setSolo({ value: '2', name: 'PACE — PER MINUTE', sub: 'PATCH KIT · PHASE 1 · SINGLE BEATS', color: AMBER });
      } else if (beat === 'ramped') {
        setCraft({ progress: 0.8, working: true, result: null, riseKey: 0 });
        setSolo({ value: '9', name: 'PACE — PER MINUTE', sub: 'PATCH KIT · PHASE 3 · CONTINUOUS — RAMP 2 → 5 → 9', color: AMBER });
      } else if (beat === 'complete') {
        setCraft((c) => ({ progress: 1, working: false, result: 'success', riseKey: c.riseKey + 1 }));
        setSolo({ value: '+1', name: 'PATCH KIT', sub: 'JOB COMPLETE · RESULT FLASH + RISE AT THE WORK POINT', color: GREEN });
      }
    } else if (act === 'gather') {
      if (beat === 'start') {
        setSolo({ value: '192', name: 'DRAWS PER HOUR', sub: 'SURFACE PASS RUNNING · DUSTWASTE FRONTIER', color: WHITE });
      } else if (beat === 'flow' || beat === 'yield') {
        if (!pushedRef.current) {
          pushedRef.current = true;
          useExtractionFeedStore.getState().pushPass(FIXTURE_PASS);
        }
        if (beat === 'flow') {
          setSolo({ value: '32', name: 'DRAWS THIS PASS', sub: '192 PER HOUR × 10 MIN = 32 DRAWS', color: WHITE });
        } else {
          setSolo({ value: '33', name: 'UNITS AT SETTLEMENT', sub: 'TECHFRAGMENTS 14 · BALLISTIC PARTS 9 · DUSTGLASS 4 · IGNITION FLUID 6 · +120 XP', color: GREEN });
        }
      }
    } else if (act === 'research') {
      if (beat === 'start') {
        setSolo({ value: '6', name: 'HOURS — SHOP FUNDAMENTALS', sub: 'REMAINING 6 OF 6 · NOTHING DONE YET', color: WHITE, held: true });
      } else if (beat === 'flow') {
        setSolo({ value: '3', name: 'HOURS REMAINING', sub: '3 OF 6 HOURS DONE', color: WHITE });
      } else if (beat === 'done') {
        setSolo({ value: '+2', name: 'CRAFT QUALITY SHIFT', sub: 'COURSE COMPLETE · 0 HOURS REMAINING', color: GREEN });
      }
    }
  };

  useEffect(() => {
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
    if (act === 'roam') useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 300, currentTargetHpMax: 300 });
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = applyBeat;
    const initial = params.get('beat') ?? (act === 'roam' || act === 'boss' || act === 'research' ? 'rest' : act === 'craft' ? 'slow' : 'start');
    const initialFor = (a: string, b: string) =>
      a === 'boss' && b === 'rest' ? 'rest' : a === 'research' && b === 'rest' ? 'start' : b;
    applyBeat(initialFor(act, initial));
    if (auto && act === 'roam') {
      const at = (ms: number, b: string) => timers.current.push(window.setTimeout(() => applyBeat(b), ms));
      at(1400, 'surge');
      at(3200, 'molten');
      at(5000, 'proc');
      at(6800, 'kill');
      at(8800, 'drop');
      at(10800, 'kill');
    }
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = ACT_TITLES[act] ?? ACT_TITLES.roam;
  const dim = solo.held ? 'brightness(0.55) saturate(0.7)' : 'brightness(0.38) saturate(0.6)';

  return (
    <div style={{ minHeight: '100vh', background: '#050608', boxSizing: 'border-box' }} data-testid="spotlight-root">
      <div style={{ width: 412, margin: '0 auto', padding: '12px 12px 24px', boxSizing: 'border-box', position: 'relative' }}>
        <div style={{ filter: dim, transition: 'filter 300ms ease' }}>
          <div style={{ padding: '2px 2px 10px' }}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: '#F5F7FA' }}>{meta.title}</div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: '#8A93A3', marginTop: 3 }}>{meta.fixture}</div>
          </div>

          {act === 'roam' && (
            <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={HARNESS_WEAPON} playerLevel={5} equippedCount={4} activityKind={'roaming_loot' as never} />
          )}
          {act === 'boss' && <BossFightStageDom timeline={bossTl} phases={FIXTURE_PHASES} bossId="dune_tyrant" weapon={FIXTURE_WEAPON} />}
          {act === 'craft' && (
            <div style={{ position: 'relative' }}>
              <CraftingBenchScene progress={craft.progress} causeLabel="Tempering · Patch Kit" buysLabel="→ Patch Kit ×1" working={craft.working} result={craft.result} seatJob={seatJob()} />
              {craft.riseKey > 0 && (
                <div key={craft.riseKey} className="pointer-events-none absolute z-30" style={{ left: '58%', top: '67%', width: 46, height: 58, transform: 'translate(-50%, -78%)' }}>
                  <motion.div
                    initial={{ y: 6, opacity: 0, scale: 0.6 }}
                    animate={{ y: [6, -14, -26, -30], opacity: [0, 1, 1, 0], scale: [0.6, 1.05, 1, 0.8] }}
                    transition={{ duration: 1.6, times: [0, 0.3, 0.75, 1], ease: 'easeOut' }}
                    style={{ width: '100%', height: '100%' }}
                  >
                    <DropRiseIcon tone="material" label="+1 Patch Kit" />
                  </motion.div>
                </div>
              )}
            </div>
          )}
          {act === 'gather' && (
            <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={HARNESS_WEAPON} playerLevel={5} equippedCount={1} activityKind={'extraction' as never} />
          )}
          {act === 'research' && (
            <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={HARNESS_WEAPON} playerLevel={5} equippedCount={4} activityKind={undefined} />
          )}

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: '#8A93A3', padding: '10px 2px 0' }}>{meta.footer}</div>
        </div>

        <div
          data-testid="spotlight-solo"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            opacity: solo.held ? 0.45 : 1,
            transition: 'opacity 300ms ease',
            padding: '0 18px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              fontSize: 104,
              lineHeight: 1,
              fontWeight: 900,
              color: solo.color,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
              textAlign: 'center',
            }}
          >
            {solo.value}
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', color: '#F5F7FA', marginTop: 14, textAlign: 'center' }}>{solo.name}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#AAB2C0', fontVariantNumeric: 'tabular-nums', marginTop: 6, textAlign: 'center', lineHeight: 1.5 }}>{solo.sub}</div>
        </div>
      </div>
    </div>
  );
};
