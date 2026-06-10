/**
 * Monster roster — the data layer for "enemies the hunter is fighting" in
 * each roaming area. Each roaming area gets 3-6 monsters with explicit
 * HP, attack, defense, accuracy, and a small visual identifier.
 *
 * This module is the SINGLE SOURCE OF TRUTH for what an enemy is. Combat
 * math (per-tick damage, kill resolution) lives in `src/lib/combat/`.
 * Animation hooks (which sprite to show, when) live in
 * `src/lib/activity/actionAnimationRenderer.ts` and read from the
 * `visualKey` field on MonsterDef.
 *
 * Adding a new monster:
 *   1. Add an entry below with a unique `id` and a `visualKey` that
 *      matches a sprite registered in `src/lib/pixelArt/`.
 *   2. Add the monster's id to at least one area's `monsterIds` array in
 *      `src/constants/roamingAreas.ts`.
 *   3. The validation test in `test/monsterRoster.test.ts` will catch
 *      any missing fields, orphan ids, or HP/attack regressions.
 */
import type { Element } from '../types/game';

export type MonsterArchetype = 'fodder' | 'runner' | 'brute' | 'sniper' | 'elite' | 'boss';

export interface MonsterDef {
  id: string;
  name: string;
  archetype: MonsterArchetype;
  /** Combat stats — all integers, all positive. */
  hp: number;
  attackPower: number;
  defense: number;
  /** 0-1 hit chance. Default 0.85 if omitted. */
  accuracy?: number;
  /** Optional elemental damage. Defaults to 0. */
  element?: Element;
  /** XP rewarded on kill. */
  xpReward: number;
  /** Sprite key consumed by the action stage renderer. */
  visualKey: string;
  /** Tile width/height in pixels for the stage canvas. */
  visualSize?: number;
  /** Short flavor line shown in the feed log. */
  flavor?: string;
}

/**
 * The shared monster pool. Areas reference these by id and assign
 * per-area weights for selection on each tick. We keep a single pool
 * (rather than per-area inline definitions) so a monster's identity is
 * stable across the game — the same "Wraith Scavenger" appears in
 * Dustwaste Frontier (T1) and a higher tier of the same family appears
 * later as a renamed variant with scaled stats.
 *
 * Stat budget (rough):
 *   T1 areas: hp 30-60, attack 2-6
 *   T2 areas: hp 80-150, attack 8-14
 *   T3 areas: hp 200-350, attack 18-28
 *   T4 areas: hp 500-800, attack 35-55
 *   T5+ areas: hp 1000+, attack 70+
 *   Elite variants: 3x hp + 1.5x attack of the base
 */
export const MONSTERS: MonsterDef[] = [
  // ─── Tier 1 — Dustwaste Frontier ──────────────────────────────────────
  {
    id: 'dustwaste_raider',
    name: 'Wraith Scavenger',
    archetype: 'fodder',
    hp: 45,
    attackPower: 4,
    defense: 0,
    xpReward: 8,
    visualKey: 'monster_scavenger',
    flavor: 'A hollow-eyed looter in salvage rags.',
  },
  {
    id: 'dustwaste_drone',
    name: 'Rusted Drone',
    archetype: 'runner',
    hp: 35,
    attackPower: 5,
    defense: 0,
    accuracy: 0.9,
    xpReward: 9,
    visualKey: 'monster_drone',
    flavor: 'A tick-sized pursuit drone with a stunner needle.',
  },
  {
    id: 'dustwaste_brute',
    name: 'Salvage Brute',
    archetype: 'brute',
    hp: 80,
    attackPower: 6,
    defense: 2,
    xpReward: 14,
    visualKey: 'monster_brute',
    flavor: 'A bear-sized raider in scrap plate.',
  },
  {
    id: 'dustwaste_elite',
    name: 'Silt Marshal',
    archetype: 'elite',
    hp: 220,
    attackPower: 14,
    defense: 6,
    accuracy: 0.9,
    xpReward: 45,
    visualKey: 'monster_marshal',
    flavor: 'A grizzled route captain with a shock maul.',
  },

  // ─── Tier 2 — Redline Circuit ────────────────────────────────────────
  {
    id: 'redline_runner',
    name: 'Overheat Runner',
    archetype: 'runner',
    hp: 90,
    attackPower: 11,
    defense: 1,
    accuracy: 0.92,
    xpReward: 18,
    visualKey: 'monster_runner',
    flavor: 'A speed crew jockey burning out their thruster pack.',
  },
  {
    id: 'redline_drone',
    name: 'Pursuit Drone',
    archetype: 'sniper',
    hp: 75,
    attackPower: 13,
    defense: 2,
    accuracy: 0.95,
    xpReward: 22,
    visualKey: 'monster_pursuit_drone',
    flavor: 'A heavier drone with a shock net launcher.',
  },
  {
    id: 'redline_brute',
    name: 'Highway Brawler',
    archetype: 'brute',
    hp: 160,
    attackPower: 14,
    defense: 5,
    xpReward: 30,
    visualKey: 'monster_brawler',
    flavor: 'A road-armored enforcer with a jury-rigged cannon.',
  },
  {
    id: 'redline_elite',
    name: 'Circuit Marshal',
    archetype: 'elite',
    hp: 380,
    attackPower: 28,
    defense: 10,
    accuracy: 0.92,
    xpReward: 85,
    visualKey: 'monster_circuit_marshal',
    flavor: 'A route boss with a mag-lev interceptor rig.',
  },

  // ─── Tier 3 — Ironwood Bastion ───────────────────────────────────────
  {
    id: 'ironwood_sentinel',
    name: 'Bastion Sentinel',
    archetype: 'brute',
    hp: 240,
    attackPower: 22,
    defense: 8,
    xpReward: 42,
    visualKey: 'monster_sentinel',
    flavor: 'A walking gun platform bolted to a perimeter pylon.',
  },
  {
    id: 'ironwood_ranger',
    name: 'Bastion Ranger',
    archetype: 'sniper',
    hp: 180,
    attackPower: 26,
    defense: 4,
    accuracy: 0.96,
    xpReward: 48,
    visualKey: 'monster_ranger',
    flavor: 'A sniper in camo cloak with a mag-round rifle.',
  },
  {
    id: 'ironwood_brute',
    name: 'Ironclad Mauler',
    archetype: 'brute',
    hp: 380,
    attackPower: 24,
    defense: 12,
    xpReward: 62,
    visualKey: 'monster_mauler',
    flavor: 'A plate-armored heavy with a hydraulic cleaver.',
  },
  {
    id: 'ironwood_elite',
    name: 'Bastion Commander',
    archetype: 'elite',
    hp: 700,
    attackPower: 45,
    defense: 18,
    accuracy: 0.93,
    xpReward: 165,
    visualKey: 'monster_commander',
    flavor: 'A veteran captain in full ballistic plate.',
  },

  // ─── Tier 4 — Blastforge Yards ───────────────────────────────────────
  {
    id: 'blastforge_worker',
    name: 'Forge Laborer',
    archetype: 'fodder',
    hp: 320,
    attackPower: 32,
    defense: 10,
    xpReward: 65,
    visualKey: 'monster_laborer',
    flavor: 'A conscripted foundry worker with a rivet gun.',
  },
  {
    id: 'blastforge_enforcer',
    name: 'Forge Enforcer',
    archetype: 'runner',
    hp: 380,
    attackPower: 38,
    defense: 8,
    accuracy: 0.94,
    xpReward: 78,
    visualKey: 'monster_enforcer',
    flavor: 'A union thug with a shock baton and reinforced boots.',
  },
  {
    id: 'blastforge_brute',
    name: 'Crucible Mauler',
    archetype: 'brute',
    hp: 620,
    attackPower: 42,
    defense: 16,
    xpReward: 110,
    visualKey: 'monster_crucible',
    flavor: 'A walking tank with a portable smelter.',
  },
  {
    id: 'blastforge_elite',
    name: 'Yard Overboss',
    archetype: 'elite',
    hp: 1100,
    attackPower: 72,
    defense: 28,
    accuracy: 0.93,
    xpReward: 290,
    visualKey: 'monster_overboss',
    flavor: 'A blast-scarred overseer in full foundry plate.',
  },

  // ─── Tier 5 — Prismatek Reactor ──────────────────────────────────────
  {
    id: 'prismatek_drone',
    name: 'Refraction Drone',
    archetype: 'sniper',
    hp: 580,
    attackPower: 58,
    defense: 12,
    accuracy: 0.97,
    xpReward: 135,
    visualKey: 'monster_refraction',
    flavor: 'A floating drone with a prismatic beam emitter.',
  },
  {
    id: 'prismatek_runner',
    name: 'Phase Courier',
    archetype: 'runner',
    hp: 700,
    attackPower: 64,
    defense: 10,
    accuracy: 0.95,
    xpReward: 155,
    visualKey: 'monster_courier',
    flavor: 'A courier in a phase-shift suit with a sidearm.',
  },
  {
    id: 'prismatek_brute',
    name: 'Prism Guard',
    archetype: 'brute',
    hp: 1050,
    attackPower: 70,
    defense: 24,
    xpReward: 220,
    visualKey: 'monster_prism_guard',
    flavor: 'A heavy guard in refractor armor.',
  },
  {
    id: 'prismatek_elite',
    name: 'Reactor Warden',
    archetype: 'elite',
    hp: 1900,
    attackPower: 105,
    defense: 38,
    accuracy: 0.94,
    xpReward: 480,
    visualKey: 'monster_warden',
    flavor: 'A refractor-clad warden with a beam cannon.',
  },

  // ─── Tier 6 — Throwtech Dumpnet ──────────────────────────────────────
  {
    id: 'throwtech_scavenger',
    name: 'Dumpnet Scavenger',
    archetype: 'fodder',
    hp: 900,
    attackPower: 82,
    defense: 18,
    xpReward: 210,
    visualKey: 'monster_dump_scav',
    flavor: 'A scavenger in a rebreather mask, loitering in the waste pits.',
  },
  {
    id: 'throwtech_brute',
    name: 'Waste Compactor',
    archetype: 'brute',
    hp: 1500,
    attackPower: 95,
    defense: 32,
    xpReward: 340,
    visualKey: 'monster_compactor',
    flavor: 'A prototype press-frame with operator cockpit.',
  },
  {
    id: 'throwtech_sniper',
    name: 'Sniper Salvager',
    archetype: 'sniper',
    hp: 1100,
    attackPower: 110,
    defense: 16,
    accuracy: 0.97,
    xpReward: 320,
    visualKey: 'monster_sniper_salv',
    flavor: 'A long-rig spotter with a thrown-tech coil rifle.',
  },
  {
    id: 'throwtech_elite',
    name: 'Dump King',
    archetype: 'elite',
    hp: 2800,
    attackPower: 145,
    defense: 48,
    accuracy: 0.94,
    xpReward: 720,
    visualKey: 'monster_dump_king',
    flavor: 'A crowned scavenger with a salvage throne of crushed plate.',
  },

  // ─── Tier 7 — Helixworks Labyrinth ───────────────────────────────────
  {
    id: 'helix_worker',
    name: 'Helix Researcher',
    archetype: 'fodder',
    hp: 1400,
    attackPower: 115,
    defense: 28,
    xpReward: 380,
    visualKey: 'monster_researcher',
    flavor: 'A lab tech with a sidearm and a manic grin.',
  },
  {
    id: 'helix_runner',
    name: 'Helix Test Subject',
    archetype: 'runner',
    hp: 1700,
    attackPower: 125,
    defense: 20,
    accuracy: 0.95,
    xpReward: 430,
    visualKey: 'monster_subject',
    flavor: 'A bolt-necked test subject with helix graft limbs.',
  },
  {
    id: 'helix_brute',
    name: 'Helix Enforcer',
    archetype: 'brute',
    hp: 2400,
    attackPower: 140,
    defense: 42,
    xpReward: 580,
    visualKey: 'monster_helix_enforcer',
    flavor: 'A black-plate enforcer with a helix-lance.',
  },
  {
    id: 'helix_elite',
    name: 'Labyrinth Overseer',
    archetype: 'elite',
    hp: 4200,
    attackPower: 195,
    defense: 62,
    accuracy: 0.95,
    xpReward: 1100,
    visualKey: 'monster_overseer',
    flavor: 'A multi-eyed overseer with a helix-bore cannon.',
  },
];

export const MONSTER_IDS: ReadonlySet<string> = new Set(MONSTERS.map((m) => m.id));

export function getMonster(id: string): MonsterDef | undefined {
  return MONSTERS.find((m) => m.id === id);
}

export function requireMonster(id: string): MonsterDef {
  const m = getMonster(id);
  if (!m) throw new Error(`Missing monster '${id}'.`);
  return m;
}

/** A simple sanity check for tests: every monster has positive integer stats. */
export function validateMonster(monster: MonsterDef): string[] {
  const issues: string[] = [];
  if (!monster.id) issues.push('missing id');
  if (!monster.name) issues.push('missing name');
  if (!Number.isInteger(monster.hp) || monster.hp <= 0) issues.push(`invalid hp ${monster.hp}`);
  if (!Number.isInteger(monster.attackPower) || monster.attackPower <= 0) {
    issues.push(`invalid attackPower ${monster.attackPower}`);
  }
  if (!Number.isInteger(monster.defense) || monster.defense < 0) {
    issues.push(`invalid defense ${monster.defense}`);
  }
  if (monster.accuracy !== undefined && (monster.accuracy < 0 || monster.accuracy > 1)) {
    issues.push(`invalid accuracy ${monster.accuracy}`);
  }
  if (!Number.isInteger(monster.xpReward) || monster.xpReward <= 0) {
    issues.push(`invalid xpReward ${monster.xpReward}`);
  }
  if (!monster.visualKey) issues.push('missing visualKey');
  return issues;
}
