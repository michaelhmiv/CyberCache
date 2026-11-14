/**
 * Recorded decided-timeline fixture for the Pixi motion pilot
 * (2026-11-06). Modelled on a real boss attempt's event shape — the
 * same FightTimeline snapshots BossEncounterPanel hands
 * BossFightStage as runFightAnimation walks a decided outcome — with
 * the five phases a full fight shows:
 *
 *   1. Ignition    — normal hit; boss counters: telegraph + dodge
 *   2. Shield Wall — normal hit; no counter
 *   3. Overdrive   — CRIT hit (26% of boss max ≥ the 18% crit
 *                    fraction); boss counters: telegraph + dodge
 *   4. Core Breach — normal hit; boss counters
 *   5. Collapse    — the killing hit (a crit by the law's fraction):
 *                    boss death beat, victory
 *
 * The fixture is data only. Both stage renderers consume the same
 * snapshots; the player below walks them at the movement law's
 * phase interval, mirroring runFightAnimation's cadence, and stamps
 * finishedAt when the finished snapshot lands.
 */
import { MOVEMENT } from '@/lib/pixel/movement';
import type { FightOutcome, FightTimeline } from '@/lib/animation/fightTimeline';
import type { PhaseAnalysis } from '@/types/boss';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

export const FIXTURE_BOSS_ID = 'dune_tyrant';
export const FIXTURE_BOSS_HP_MAX = 1000;
export const FIXTURE_PLAYER_HP_MAX = 340;

export const FIXTURE_WEAPON: Weapon = {
  id: 'fixture-weapon-1',
  name: 'Fixture Sidearm',
  level: 12,
  rarity: Rarity.Rare,
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Redline,
  element: Element.Kinetic,
  rollQuality: 62,
  baseDamage: 41,
  attackSpeed: 1,
  critChance: 0.12,
  critDamage: 1.6,
  statusChance: 0,
  statusDamage: 0,
  bossDamageMod: 0,
  waveDamageMod: 0,
  shieldDamageMod: 0,
  armorDamageMod: 0,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  parts: [],
  affixes: [],
  legendaryEffectId: undefined,
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 1234567,
  combatPower: 0,
  bossPower: 0,
  farmPower: 0,
  economyScore: 0,
};

export const FIXTURE_PHASES: PhaseAnalysis[] = ['Ignition', 'Shield Wall', 'Overdrive', 'Core Breach', 'Collapse'].map(
  (phaseName, i) => ({
    phaseId: `fixture-phase-${i + 1}`,
    phaseName,
    score: 0.8,
    status: 'safe' as const,
    currentAnswers: ['weapon'],
    missingCounters: [],
    relevantConsumables: [],
    explanation: 'Fixture phase',
  }),
);

export const FIXTURE_OUTCOME: FightOutcome = {
  result: { victory: true, winChance: 0.75, bossHpRemaining: 0 },
  creditsDelta: 1500,
  bonusLootRolls: 1,
  consumedConsumables: {},
  loot: [],
  extraLoot: false,
};

/** Per-phase decided damage: [bossDamage, playerDamage]. */
const PHASE_DAMAGE: [number, number][] = [
  [120, 45],
  [90, 0],
  [260, 60],
  [240, 50],
  [290, 0],
];

/** The snapshot script: one FightTimeline per phase, then the
 *  finished snapshot. finishedAt is stamped by the driver. */
export function fixtureSnapshots(): FightTimeline[] {
  const snapshots: FightTimeline[] = [];
  let bossHp = FIXTURE_BOSS_HP_MAX;
  let playerHp = FIXTURE_PLAYER_HP_MAX;
  const log: FightTimeline['damageLog'] = [];
  PHASE_DAMAGE.forEach(([bossDmg, playerDmg], i) => {
    bossHp -= bossDmg;
    playerHp -= playerDmg;
    if (bossDmg > 0) log.push({ id: `fb-${i}`, target: 'boss', value: bossDmg, phaseName: FIXTURE_PHASES[i].phaseName });
    if (playerDmg > 0) log.push({ id: `fp-${i}`, target: 'player', value: playerDmg, phaseName: FIXTURE_PHASES[i].phaseName });
    snapshots.push({
      outcome: FIXTURE_OUTCOME,
      startedAt: 0,
      finishedAt: null,
      currentPhaseIndex: i,
      playerHp,
      playerHpMax: FIXTURE_PLAYER_HP_MAX,
      bossHp,
      bossHpMax: FIXTURE_BOSS_HP_MAX,
      damageLog: [...log].slice(-6),
    });
  });
  snapshots.push({
    outcome: FIXTURE_OUTCOME,
    startedAt: 0,
    finishedAt: null, // stamped by the driver at apply time
    currentPhaseIndex: FIXTURE_PHASES.length,
    playerHp,
    playerHpMax: FIXTURE_PLAYER_HP_MAX,
    bossHp: 0,
    bossHpMax: FIXTURE_BOSS_HP_MAX,
    damageLog: [...log].slice(-6),
  });
  return snapshots;
}

export interface FixtureLogEntry {
  index: number;
  atMs: number;
  bossHp: number;
  playerHp: number;
  finished: boolean;
}

/**
 * Walks the fixture snapshots at the law's phase interval —
 * runFightAnimation's cadence — recording every application so the
 * determinism probe can compare the DOM and Pixi runs event for
 * event. Returns a stop function.
 */
export function playFixture(
  onSnapshot: (timeline: FightTimeline, index: number) => void,
  onDone: () => void,
  log: FixtureLogEntry[],
): () => void {
  const snapshots = fixtureSnapshots();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;
  snapshots.forEach((snapshot, i) => {
    timers.push(
      setTimeout(() => {
        if (stopped) return;
        const applied: FightTimeline =
          snapshot.finishedAt === null && i === snapshots.length - 1
            ? { ...snapshot, finishedAt: performance.now() }
            : snapshot;
        log.push({
          index: i,
          atMs: performance.now(),
          bossHp: applied.bossHp,
          playerHp: applied.playerHp,
          finished: applied.finishedAt != null,
        });
        onSnapshot(applied, i);
        if (i === snapshots.length - 1) {
          timers.push(setTimeout(() => !stopped && onDone(), MOVEMENT.FIGHT_SETTLE_MS));
        }
      }, i * MOVEMENT.PHASE_INTERVAL_MS),
    );
  });
  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
  };
}

/** Freeze mode for stills: apply one snapshot and hold it. */
export function freezeSnapshot(index: number): FightTimeline {
  const snapshots = fixtureSnapshots();
  const snapshot = snapshots[Math.max(0, Math.min(index, snapshots.length - 1))];
  if (index === snapshots.length - 1) {
    return { ...snapshot, finishedAt: performance.now() };
  }
  return snapshot;
}
