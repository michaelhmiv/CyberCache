import { Rarity } from '../types/game';
import type { RoamingAreaDef } from '../constants/roamingAreas';
import { CACHE_FRAGMENT_CHANCE, GEAR_DROP_CHANCE, MATERIAL_FIND_CHANCE } from './roamingRates';

/**
 * Roaming variance — the event system (roaming-variance brief, Part 2).
 *
 * This module is the content source of truth for the roaming event
 * roll: the per-area event tables, the named-elite encounter rules,
 * the two-tier material identity (essence homes + Tier-2 signature
 * materials), and the value model the anti-leak budget is tested
 * against. Resolution lives in the Chef (`src/server/chef.ts`), which
 * rolls on a dedicated per-tick RNG stream seeded from the claim's
 * tick nonce — events inherit the claim's idempotency and replay
 * safety, and the pre-overhaul tick stream stays bit-identical.
 *
 * Design law (brief §2.1): events are variance, not a faucet upgrade.
 * The whole system is budgeted at ≤ +8% expected value per tick over
 * plain ticks, funded mostly in kind (materials, fragments, rolls
 * against the existing rarity table) and balanced by hazard events
 * with real downside. `expectedValueCredits` on each def is the
 * design estimate under EVENT_VALUE_MODEL; realized EV is measured
 * from the verified action ledger (`roaming.event` rows) by the
 * economy-metrics job, and the table weights are the correction lever
 * if it drifts.
 */

export type RoamingEventFamily = 'find' | 'fight' | 'hazard' | 'objective';

/** How the Chef resolves an event once the table selects it. */
export type RoamingEventResolution =
  | { kind: 'cacheFind' }
  | { kind: 'salvageFind'; entries: RoamingEventPayoutEntry[]; credits?: [number, number]; restoreShield?: number }
  | { kind: 'gearFind'; qualityBoost?: boolean }
  | { kind: 'stormWindow' }
  | { kind: 'aidObjective' }
  | { kind: 'overheatWindow' }
  | { kind: 'streakObjective' }
  | { kind: 'weakpointContract' }
  | { kind: 'elitePatrol' }
  | { kind: 'bountyTarget'; payout: 'gear' | 'gearQuality' | 'materials' | 'xp' }
  | { kind: 'detonate' }
  | { kind: 'breakWindow' }
  | { kind: 'elementSurge' }
  | { kind: 'signalTrap' }
  | { kind: 'wallsShift' }
  | { kind: 'resonanceTrial' }
  | { kind: 'minefield' };

export interface RoamingEventPayoutEntry {
  type: string;
  kind: 'material' | 'essence';
  min: number;
  max: number;
}

export interface RoamingEventDef {
  id: string;
  areaId: string;
  name: string;
  family: RoamingEventFamily;
  /** Relative weight inside the area's event table. */
  weight: number;
  /** Pixel prop sprite id the stage shows when this event fires. */
  propId: string;
  /** One-line flavor for the feed. */
  blurb: string;
  resolution: RoamingEventResolution;
  /** Design-estimate expected value in credits under EVENT_VALUE_MODEL (hazards are negative). */
  expectedValueCredits: number;
  /** Epic-grade outcomes escalate to a stage moment (feed tone `event_major`). */
  major?: boolean;
}

/** Base event chance per tick before modifiers (economy lever `eventChanceBase`). */
export const EVENT_CHANCE_BASE = 0.05;
/** Hard clamp for the stacked event chance (brief §2.1). */
export const EVENT_CHANCE_MAX = 0.15;
/** The whole event system may add at most this fraction of a plain tick's EV. */
export const EVENT_VALUE_BUDGET_PCT = 0.08;

/**
 * The valuation the budget is designed and tested under. Deliberately
 * conservative: a gear roll is priced at a low-level average vendor
 * value, XP is excluded (progression, not economy), hazards price
 * their damage/death pressure as negative value.
 */
export const EVENT_VALUE_MODEL = {
  credit: 1,
  scrap: 0.5,
  material: 10,
  essence: 20,
  fragment: 15,
  gearRoll: 30,
  gearRollQuality: 45,
} as const;

/** Expected value of one plain (eventless) tick in an area, under the model. */
export function plainTickValue(area: RoamingAreaDef): number {
  const credits = (area.idleCreditsPerMinute || 15) / 20;
  const scrap = ((area.idleScrapPerMinute || 3) / 20) * EVENT_VALUE_MODEL.scrap;
  const materials = MATERIAL_FIND_CHANCE * 12; // × blended find value
  const fragments = CACHE_FRAGMENT_CHANCE * EVENT_VALUE_MODEL.fragment;
  const gear = GEAR_DROP_CHANCE * EVENT_VALUE_MODEL.gearRoll;
  return credits + scrap + materials + fragments + gear;
}

/** Expected event EV added per tick in an area at the base fire rate. */
export function eventValuePerTick(area: RoamingAreaDef, chance: number = EVENT_CHANCE_BASE): number {
  const table = ROAMING_EVENTS_BY_AREA[area.id] ?? [];
  const totalWeight = table.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight <= 0) return 0;
  const avg = table.reduce((sum, e) => sum + e.weight * e.expectedValueCredits, 0) / totalWeight;
  return chance * avg;
}

// ─── Named elite encounters (brief §2.3) ─────────────────────────────

/** Elite HP multiplier when an encounter escalates. */
export const ELITE_HP_MULTIPLIER = 3;
/** Guaranteed gear roll on an escalated elite kill floors at this rarity. */
export const ELITE_RARITY_FLOOR: Rarity = Rarity.Epic;
/** Bonus cache fragments on an escalated elite kill. */
export const ELITE_FRAGMENT_BONUS = 1;
/**
 * The kill cycle rotates the roster in order, so the elite is every
 * 4th target — far more often than the ~1-in-29 weighted picks the
 * brief's funding math assumed (weights drive the survival attacker,
 * not the cycle). Escalation therefore gates on its own roll: an
 * elite target escalates with this probability, which lands the
 * encounter rate at roughly the brief's 1-in-29 targets. A
 * non-escalated elite target is an ordinary roster kill, exactly as
 * before the overhaul.
 */
export const ELITE_ESCALATION_CHANCE = 0.12;

// ─── Two-tier material identity (brief §2.5 + Q2 ruling) ─────────────

/** Each essence's home area: full rate at home, ≤25% rate elsewhere. */
export const ESSENCE_HOMES: Record<string, string> = {
  IgnitionFluid: 'blastforge_yards',
  ConduitWire: 'throwtech_dumpnet',
  AcidCompound: 'prismatek_reactor',
  CryoGel: 'prismatek_reactor',
  VoidEssence: 'helixworks_labyrinth',
};

/** Find-pool weight of an essence in its home area. */
export const ESSENCE_HOME_WEIGHT = 3;
/** Find-pool weight of an essence away from home (≤25% of home rate). */
export const ESSENCE_GUEST_WEIGHT = 0.75;
/** Find-pool weight of a base material entry. */
export const MATERIAL_FIND_WEIGHT = 2;

export interface SignatureMaterialDef {
  /** MaterialType id (the profile/material key and market identity). */
  materialId: string;
  displayName: string;
  homeAreaId: string;
  /** Mirrors the home area's unlock level — the material unlocks with its area. */
  unlockLevel: number;
  /** What Tier-2 crafting will consume it for (crafting-as-occupation slice). */
  use: string;
}

/**
 * Tier-2 signature materials (Michael's Q2 ruling, 2026-10-30): one
 * per area, layered over the 10 base types. Home-area sourced only,
 * tradable on the player market, consumed by Tier-2 recipes when the
 * crafting-as-occupation slice lands. This slice mints the types, the
 * sourcing, and the market identity — no recipes yet.
 */
export const SIGNATURE_MATERIALS: readonly SignatureMaterialDef[] = [
  { materialId: 'Siltglass', displayName: 'Siltglass', homeAreaId: 'dustwaste_frontier', unlockLevel: 1, use: 'Sights and refining catalysts.' },
  { materialId: 'NitrocellGel', displayName: 'Nitrocell Gel', homeAreaId: 'redline_circuit', unlockLevel: 4, use: 'Overcharge fuel and speed ammo.' },
  { materialId: 'HeartwoodResin', displayName: 'Heartwood Resin', homeAreaId: 'ironwood_bastion', unlockLevel: 8, use: 'Tier-2 patch kits, shields, and armor work.' },
  { materialId: 'ForgeheartIngots', displayName: 'Forgeheart Ingots', homeAreaId: 'blastforge_yards', unlockLevel: 12, use: 'Weapon parts and ordnance.' },
  { materialId: 'PrismShards', displayName: 'Prism Shards', homeAreaId: 'prismatek_reactor', unlockLevel: 16, use: 'Beam parts, optics, class mods, and scanners.' },
  { materialId: 'MagnetiteCores', displayName: 'Magnetite Cores', homeAreaId: 'throwtech_dumpnet', unlockLevel: 20, use: 'Cargo racks and salvage/dispatch gear.' },
  { materialId: 'MycoSteelFiber', displayName: 'Myco-Steel Fiber', homeAreaId: 'helixworks_labyrinth', unlockLevel: 25, use: 'Top-tier survival consumables and relics.' },
];

const SIGNATURE_BY_AREA = new Map(SIGNATURE_MATERIALS.map((def) => [def.homeAreaId, def]));
const SIGNATURE_BY_ID = new Map(SIGNATURE_MATERIALS.map((def) => [def.materialId, def]));

export function signatureMaterialForArea(areaId: string): SignatureMaterialDef | undefined {
  return SIGNATURE_BY_AREA.get(areaId);
}

export function signatureMaterialById(materialId: string): SignatureMaterialDef | undefined {
  return SIGNATURE_BY_ID.get(materialId);
}

/** Chance a material find in its home area is the signature material instead. */
export const SIGNATURE_MATERIAL_FIND_CHANCE = 0.1;

// ─── Event tables (brief §2.2; 4 per area, tuned to the budget) ─────

const ev = (def: RoamingEventDef): RoamingEventDef => def;

export const ROAMING_EVENTS: readonly RoamingEventDef[] = [
  // ── Dustwaste Frontier — salvage & fragments ──
  ev({
    id: 'dustwaste_buried_cache', areaId: 'dustwaste_frontier', name: 'Buried Cache', family: 'find',
    weight: 2, propId: 'prop-buried-cache', expectedValueCredits: 37.5,
    blurb: 'A half-buried crate glints under the silt.',
    resolution: { kind: 'cacheFind' },
  }),
  ev({
    id: 'dustwaste_crashed_convoy', areaId: 'dustwaste_frontier', name: 'Crashed Convoy', family: 'find',
    weight: 3, propId: 'prop-convoy-wreck', expectedValueCredits: 21,
    blurb: 'A wrecked convoy still has salvage worth taking.',
    resolution: {
      kind: 'salvageFind',
      entries: [
        { type: 'ScrapAlloy', kind: 'material', min: 1, max: 2 },
        { type: 'BallisticParts', kind: 'material', min: 0, max: 1 },
      ],
      credits: [4, 8],
    },
  }),
  ev({
    id: 'dustwaste_silt_storm', areaId: 'dustwaste_frontier', name: 'Silt Storm Front', family: 'hazard',
    weight: 2, propId: 'prop-storm-front', expectedValueCredits: -32,
    blurb: 'A silt storm front rolls in — brutal going, but the fragments shake loose.',
    resolution: { kind: 'stormWindow' },
  }),
  ev({
    id: 'dustwaste_wounded_scavenger', areaId: 'dustwaste_frontier', name: 'Wounded Scavenger', family: 'objective',
    weight: 3, propId: 'prop-aid-marker', expectedValueCredits: 18.3,
    blurb: 'A wounded scavenger flags you down.',
    resolution: { kind: 'aidObjective' },
  }),

  // ── Redline Circuit — density, speed, attrition ──
  ev({
    id: 'redline_pileup_wreck', areaId: 'redline_circuit', name: 'Pileup Wreck', family: 'find',
    weight: 3, propId: 'prop-convoy-wreck', expectedValueCredits: 15,
    blurb: 'A fresh pileup — the crews have not stripped it yet.',
    resolution: {
      kind: 'salvageFind',
      entries: [{ type: 'ScrapAlloy', kind: 'material', min: 1, max: 1 }],
      credits: [3, 7],
    },
  }),
  ev({
    id: 'redline_pursuit_pack', areaId: 'redline_circuit', name: 'Pursuit Pack', family: 'fight',
    weight: 2, propId: 'prop-pack-marker', expectedValueCredits: 24,
    blurb: 'A pursuit pack runs you down — three runners, one stand.',
    resolution: { kind: 'bountyTarget', payout: 'gear' },
  }),
  ev({
    id: 'redline_overheat_vent', areaId: 'redline_circuit', name: 'Overheat Vent', family: 'hazard',
    weight: 3, propId: 'prop-vent-stack', expectedValueCredits: 4,
    blurb: 'A vent blows — rich pickings in the heat wash, if you can stand it.',
    resolution: { kind: 'overheatWindow' },
  }),
  ev({
    id: 'redline_streak_run', areaId: 'redline_circuit', name: 'Streak Run', family: 'objective',
    weight: 3, propId: 'prop-streak-marker', expectedValueCredits: 12,
    blurb: 'Clean line ahead — string five kills untouched and the circuit pays.',
    resolution: { kind: 'streakObjective' },
  }),

  // ── Ironwood Bastion — precision, elites ──
  ev({
    id: 'ironwood_elite_patrol', areaId: 'ironwood_bastion', name: 'Elite Patrol', family: 'fight',
    weight: 1, propId: 'prop-patrol-marker', expectedValueCredits: 38,
    blurb: 'Bastion elite patrol on the ridge — the Commander is with them.',
    resolution: { kind: 'elitePatrol' },
  }),
  ev({
    id: 'ironwood_sentry_nest', areaId: 'ironwood_bastion', name: 'Sentry Nest', family: 'fight',
    weight: 3, propId: 'prop-sentry-nest', expectedValueCredits: 21,
    blurb: 'A sentry nest has the sightline. Take it out and the ridge is yours.',
    resolution: { kind: 'bountyTarget', payout: 'gear' },
  }),
  ev({
    id: 'ironwood_weakpoint_contract', areaId: 'ironwood_bastion', name: 'Weakpoint Contract', family: 'objective',
    weight: 3, propId: 'prop-contract-marker', expectedValueCredits: 12,
    blurb: 'Contract posted: drop the marked target fast for a quality bounty.',
    resolution: { kind: 'weakpointContract' },
  }),
  ev({
    id: 'ironwood_thornwind', areaId: 'ironwood_bastion', name: 'Thornwind', family: 'hazard',
    weight: 2, propId: 'prop-storm-front', expectedValueCredits: -25,
    blurb: 'A thornwind squall tears through the treeline — spines in every gust.',
    resolution: { kind: 'stormWindow' },
  }),

  // ── BlastForge Yards — armor break, explosives ──
  ev({
    id: 'blastforge_slag_pocket', areaId: 'blastforge_yards', name: 'Slag Pocket', family: 'find',
    weight: 3, propId: 'prop-slag-pocket', expectedValueCredits: 19,
    blurb: 'A slag pocket cools with reactive stock trapped inside.',
    resolution: {
      kind: 'salvageFind',
      entries: [
        { type: 'ReactiveComponents', kind: 'material', min: 1, max: 1 },
        { type: 'IgnitionFluid', kind: 'essence', min: 0, max: 1 },
      ],
      credits: [2, 6],
    },
  }),
  ev({
    id: 'blastforge_unstable_munitions', areaId: 'blastforge_yards', name: 'Unstable Munitions', family: 'fight',
    weight: 3, propId: 'prop-munitions-stack', expectedValueCredits: 6,
    blurb: 'The target is sitting on unstable munitions. One good hit…',
    resolution: { kind: 'detonate' },
  }),
  ev({
    id: 'blastforge_armor_break_window', areaId: 'blastforge_yards', name: 'Armor-Break Window', family: 'objective',
    weight: 3, propId: 'prop-break-marker', expectedValueCredits: 8,
    blurb: 'A furnace cycle exposes every plate seam in the yard.',
    resolution: { kind: 'breakWindow' },
  }),
  ev({
    id: 'blastforge_coolant_find', areaId: 'blastforge_yards', name: 'Coolant Find', family: 'find',
    weight: 2, propId: 'prop-coolant-rig', expectedValueCredits: 15,
    blurb: 'An intact coolant rig — shield tonic and reactive stock.',
    resolution: {
      kind: 'salvageFind',
      entries: [{ type: 'ReactiveComponents', kind: 'material', min: 1, max: 1 }],
      restoreShield: 40,
    },
  }),

  // ── Prismatek Reactor — elemental ──
  ev({
    id: 'prismatek_reactor_leak', areaId: 'prismatek_reactor', name: 'Reactor Leak', family: 'hazard',
    weight: 3, propId: 'prop-reactor-leak', expectedValueCredits: 4,
    blurb: 'The reactor leaks — one element surges through the whole sector.',
    resolution: { kind: 'elementSurge' },
  }),
  ev({
    id: 'prismatek_anomaly_bloom', areaId: 'prismatek_reactor', name: 'Anomaly Bloom', family: 'find',
    weight: 3, propId: 'prop-anomaly-bloom', expectedValueCredits: 12,
    blurb: 'An anomaly blooms and condenses into raw essence.',
    resolution: {
      kind: 'salvageFind',
      entries: [
        { type: 'AcidCompound', kind: 'essence', min: 0, max: 1 },
        { type: 'CryoGel', kind: 'essence', min: 0, max: 1 },
        { type: 'TechFragments', kind: 'material', min: 1, max: 1 },
      ],
    },
  }),
  ev({
    id: 'prismatek_phase_rift', areaId: 'prismatek_reactor', name: 'Phase Rift', family: 'find',
    weight: 1, propId: 'prop-rift', expectedValueCredits: 45, major: true,
    blurb: 'A phase rift tears open — something better waits on the other side.',
    resolution: { kind: 'gearFind', qualityBoost: true },
  }),
  ev({
    id: 'prismatek_resonance_trial', areaId: 'prismatek_reactor', name: 'Resonance Trial', family: 'objective',
    weight: 3, propId: 'prop-resonance-pylon', expectedValueCredits: 14,
    blurb: 'The reactor tests your attunement. Match its elements and it pays.',
    resolution: { kind: 'resonanceTrial' },
  }),

  // ── ThrowTech Dumpnet — drones, deployables ──
  ev({
    id: 'throwtech_turret_nest', areaId: 'throwtech_dumpnet', name: 'Turret Nest', family: 'fight',
    weight: 2, propId: 'prop-turret', expectedValueCredits: 26,
    blurb: 'A turret nest wakes up in the junk grid. Kill it for its tech.',
    resolution: { kind: 'bountyTarget', payout: 'materials' },
  }),
  ev({
    id: 'throwtech_drone_salvage', areaId: 'throwtech_dumpnet', name: 'Drone Salvage', family: 'find',
    weight: 3, propId: 'prop-drone-wreck', expectedValueCredits: 16,
    blurb: 'A downed drone swarm, ripe for stripping.',
    resolution: {
      kind: 'salvageFind',
      entries: [
        { type: 'TechFragments', kind: 'material', min: 1, max: 2 },
        { type: 'ReactiveComponents', kind: 'material', min: 0, max: 1 },
      ],
    },
  }),
  ev({
    id: 'throwtech_signal_trap', areaId: 'throwtech_dumpnet', name: 'Signal Trap', family: 'objective',
    weight: 2, propId: 'prop-signal-spike', expectedValueCredits: 20,
    blurb: 'A jammed cache squawks on a dead channel. The right gear talks back.',
    resolution: { kind: 'signalTrap' },
  }),
  ev({
    id: 'throwtech_minefield_sweep', areaId: 'throwtech_dumpnet', name: 'Minefield Sweep', family: 'hazard',
    weight: 2, propId: 'prop-minefield', expectedValueCredits: -18,
    blurb: 'The shortcut crosses a live minefield. The fragments beyond it are real.',
    resolution: { kind: 'minefield' },
  }),

  // ── HelixWorks Labyrinth — prototypes, roll quality ──
  ev({
    id: 'helix_prototype_escape', areaId: 'helixworks_labyrinth', name: 'Prototype Escape', family: 'fight',
    weight: 2, propId: 'prop-prototype-pod', expectedValueCredits: 30,
    blurb: 'A prototype construct tears out of its pod. Its parts are worth a fortune.',
    resolution: { kind: 'bountyTarget', payout: 'gearQuality' },
  }),
  ev({
    id: 'helix_fusion_leak', areaId: 'helixworks_labyrinth', name: 'Fusion Leak', family: 'find',
    weight: 3, propId: 'prop-fusion-leak', expectedValueCredits: 15,
    blurb: 'A fusion leak dusts the corridor in void residue.',
    resolution: {
      kind: 'salvageFind',
      entries: [{ type: 'VoidDust', kind: 'material', min: 1, max: 2 }],
    },
  }),
  ev({
    id: 'helix_shifting_walls', areaId: 'helixworks_labyrinth', name: 'Shifting Walls', family: 'objective',
    weight: 3, propId: 'prop-wall-panel', expectedValueCredits: 4,
    blurb: 'The labyrinth reroutes — the loot profile of the place changes with it.',
    resolution: { kind: 'wallsShift' },
  }),
  ev({
    id: 'helix_specimen_release', areaId: 'helixworks_labyrinth', name: 'Specimen Release', family: 'fight',
    weight: 3, propId: 'prop-specimen-tank', expectedValueCredits: 10,
    blurb: 'A test specimen breaks containment and comes straight at you.',
    resolution: { kind: 'bountyTarget', payout: 'xp' },
  }),
];

export const ROAMING_EVENTS_BY_AREA: Record<string, RoamingEventDef[]> = (() => {
  const byArea: Record<string, RoamingEventDef[]> = {};
  for (const def of ROAMING_EVENTS) {
    (byArea[def.areaId] ??= []).push(def);
  }
  return byArea;
})();

export function roamingEventById(id: string): RoamingEventDef | undefined {
  return ROAMING_EVENTS.find((def) => def.id === id);
}

/**
 * Weighted pick from an area's event table. `findWeightMult` is the
 * DataSkimmer's re-weighting toward find/material events;
 * `cacheWeightMult` is the Magnetized Payload's pull toward
 * cache/convoy finds (the cacheFind resolution + convoy-style salvage).
 */
export function pickRoamingEvent(
  areaId: string,
  rng: () => number,
  mods: { findWeightMult?: number; cacheWeightMult?: number } = {},
): RoamingEventDef | null {
  const table = ROAMING_EVENTS_BY_AREA[areaId] ?? [];
  if (table.length === 0) return null;
  const findMult = mods.findWeightMult ?? 1;
  const cacheMult = mods.cacheWeightMult ?? 1;
  let total = 0;
  const weights = table.map((def) => {
    let w = def.weight;
    if (def.family === 'find') w *= findMult;
    if (def.resolution.kind === 'cacheFind' || def.id.endsWith('crashed_convoy')) w *= cacheMult;
    total += w;
    return w;
  });
  let roll = rng() * total;
  for (let i = 0; i < table.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return table[i];
  }
  return table[table.length - 1] ?? null;
}

/**
 * Peek at the event a future tick WOULD select (same stream, same
 * table math) without resolving it — the DataSkimmer's signal hint.
 * Pure: consumes nothing, mutates nothing.
 */
export function peekRoamingEvent(
  areaId: string,
  rng: () => number,
  chance: number,
  mods: { findWeightMult?: number; cacheWeightMult?: number } = {},
): RoamingEventDef | null {
  if (rng() >= chance) return null;
  return pickRoamingEvent(areaId, rng, mods);
}
