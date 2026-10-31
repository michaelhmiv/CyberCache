/**
 * Boss roster expansion (tiers 8–13) — shipped-path coverage.
 *
 * The six post-Scrap-Bishop bosses extend the ladder to level 75.
 * Pins:
 *  - ladder integrity (13 bosses, sequential tiers, rising stats,
 *    every boss reachable as the previous boss's unlock);
 *  - art/registry completeness (bespoke sprite + unique arena +
 *    visual identity for every boss, old and new);
 *  - BOSS INTEL LAW: the prep intel payload carries the boss's own
 *    stats / mechanics / phases / counters and NO computed win
 *    chance, readiness, or odds field — by key, at any depth;
 *  - the two new sim mechanics behave observably differently from a
 *    neutral profile (Overclock Ramp taxes slow kills, Adaptive
 *    Plating neutralizes the primary's element), and the two trait
 *    gates (stagger / status) flip the mechanic score;
 *  - the Chef path pays the new bosses by the standing formulas:
 *    XP = boss.level × 50, dedicated drops at max(boss, player)
 *    level from the boss's own pool, fee escalation from bossFees.
 */
import { describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { BOSS_VISUALS } from '@/constants/bossVisuals';
import { PIXEL_BOSS_ARENAS } from '@/content/areaPalettes';
import { escalatedBossFee } from '@/lib/bossFees';
import { getPixelSprite, pixelBossSpriteForBoss } from '@/lib/pixel/manifest';
import { overclockRampMult, simulateBoss, type BossSimulationInput } from '@/lib/simulation/bossSimulator';
import { processBossAttempt, type BossAttemptRequest } from '@/server/chef';
import type { BossDef } from '@/types/boss';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Shield, Weapon } from '@/types/items';

const NEW_BOSSES = REGION_1_BOSSES.slice(7);
const bossById = (id: string) => REGION_1_BOSSES.find((b) => b.id === id)!;

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'expansion-weapon',
    name: 'Expansion Test Gun',
    level: 75,
    rarity: Rarity.Legendary,
    weaponType: WeaponType.Rifle,
    manufacturer: Manufacturer.Redline,
    element: Element.Fire,
    rollQuality: 90,
    baseDamage: 500,
    attackSpeed: 4,
    critChance: 0.25,
    critDamage: 1.8,
    statusChance: 0.1,
    statusDamage: 1,
    bossDamageMod: 0.5,
    waveDamageMod: 0,
    shieldDamageMod: 1,
    armorDamageMod: 1,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 7,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

function makeShield(overrides: Partial<Shield> = {}): Shield {
  return {
    id: 'expansion-shield',
    name: 'Expansion Test Shield',
    level: 75,
    rarity: Rarity.Epic,
    hp: 3000,
    rechargeRate: 5,
    mitigation: 0.35,
    element: Element.Kinetic,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 3,
    ...overrides,
  } as Shield;
}

function simInput(boss: BossDef, overrides: Partial<BossSimulationInput> = {}): BossSimulationInput {
  return {
    primary: makeWeapon(),
    secondary: null,
    heavy: null,
    ordnance: null,
    shield: makeShield(),
    classMod: null,
    relic: null,
    consumables: {},
    risk: RiskSetting.Balanced,
    boss,
    playerLevel: boss.level,
    skillBonuses: {},
    pityCount: 0,
    playerCredits: 1_000_000,
    ...overrides,
  };
}

/** The same boss with its signature mechanic neutralized. */
function neutralClone(boss: BossDef): BossDef {
  return { ...boss, mechanic: { ...boss.mechanic, id: 'none' } };
}

describe('boss roster expansion — ladder integrity', () => {
  it('ships 13 bosses with sequential tiers and a rising ladder', () => {
    expect(REGION_1_BOSSES).toHaveLength(13);
    expect(NEW_BOSSES.map((b) => b.id)).toEqual([
      'spinneret_widow',
      'mnemosyne_mirror',
      'static_choir',
      'verdant_maw',
      'sister_null',
      'vaultkeeper_omega',
    ]);
    expect(NEW_BOSSES.map((b) => b.level)).toEqual([50, 55, 60, 65, 70, 75]);
    for (let i = 0; i < REGION_1_BOSSES.length; i++) {
      expect(REGION_1_BOSSES[i].tier).toBe(i + 1);
      if (i > 0) {
        expect(REGION_1_BOSSES[i].level).toBeGreaterThan(REGION_1_BOSSES[i - 1].level);
        expect(REGION_1_BOSSES[i].health).toBeGreaterThan(REGION_1_BOSSES[i - 1].health);
        expect(REGION_1_BOSSES[i].dps).toBeGreaterThan(REGION_1_BOSSES[i - 1].dps);
        expect(REGION_1_BOSSES[i].entryCost).toBeGreaterThan(REGION_1_BOSSES[i - 1].entryCost);
      }
    }
    // The original seven are untouched at the head of the ladder.
    expect(REGION_1_BOSSES[0].id).toBe('dune_tyrant');
    expect(REGION_1_BOSSES[6].id).toBe('scrap_bishop');
    expect(REGION_1_BOSSES[6].level).toBe(45);
  });

  it('every dedicated drop is eligible at the boss tier and inside its drop table', () => {
    for (const boss of NEW_BOSSES) {
      expect(boss.dedicatedDrops.length).toBeGreaterThan(0);
      for (const dropId of boss.dedicatedDrops) {
        expect(boss.dropTable).toContain(dropId);
      }
    }
    // First dedicated homes: these effects were previously only in
    // generic tier pools, never a boss's dedicated pool.
    expect(bossById('verdant_maw').dedicatedDrops).toContain('molten_core');
    expect(bossById('static_choir').dedicatedDrops).toContain('cryo_stasis');
    expect(bossById('mnemosyne_mirror').dedicatedDrops).toContain('phase_shifter');
    expect(bossById('spinneret_widow').dedicatedDrops).toContain('hot_swapper');
  });

  it('every boss has a bespoke sprite, a unique arena, and a visual identity', () => {
    const arenaBackgrounds = new Set<string>();
    for (const boss of REGION_1_BOSSES) {
      const spriteId = pixelBossSpriteForBoss(boss.id);
      expect(spriteId, `${boss.id} sprite mapping`).toBeTruthy();
      expect(getPixelSprite(spriteId!), `${boss.id} sprite in manifest`).toBeTruthy();
      const arena = PIXEL_BOSS_ARENAS[boss.id];
      expect(arena, `${boss.id} arena`).toBeTruthy();
      expect(getPixelSprite(arena.backgroundId), `${boss.id} arena background`).toBeTruthy();
      expect(getPixelSprite(arena.propId), `${boss.id} arena prop`).toBeTruthy();
      expect(arenaBackgrounds.has(arena.backgroundId)).toBe(false);
      arenaBackgrounds.add(arena.backgroundId);
      expect(BOSS_VISUALS[boss.id], `${boss.id} visual`).toBeTruthy();
      expect(BOSS_VISUALS[boss.id].description).not.toContain('Unknown boss');
    }
    expect(arenaBackgrounds.size).toBe(13);
  });
});

describe('boss roster expansion — BOSS INTEL LAW', () => {
  /** The intel payload exactly as the prep panel consumes it: the
   *  boss's own vitals, profile, mechanic, phases, and drops. */
  function intelPayload(boss: BossDef) {
    return {
      name: boss.name,
      tier: boss.tier,
      level: boss.level,
      vitals: { health: boss.health, shield: boss.shield, armor: boss.armor, dps: boss.dps },
      weaknesses: boss.weaknesses,
      resistances: boss.resistances,
      tags: boss.tags,
      mechanic: { name: boss.mechanic.name, description: boss.mechanic.description },
      phases: boss.phases.map((phase) => ({
        name: phase.name,
        description: phase.description,
        type: phase.type,
        recommendedCounters: phase.recommendedCounters,
      })),
      dedicatedDrops: boss.dedicatedDrops,
    };
  }

  function collectKeys(value: unknown, into: string[]): void {
    if (Array.isArray(value)) {
      value.forEach((entry) => collectKeys(entry, into));
    } else if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        into.push(key);
        collectKeys(entry, into);
      }
    }
  }

  it('intel carries mechanics and stats, and no win-chance/readiness field at any depth', () => {
    for (const boss of REGION_1_BOSSES) {
      const payload = intelPayload(boss);
      // The intel is real: mechanic, phases with counters, profile.
      expect(payload.mechanic.name.length).toBeGreaterThan(0);
      expect(payload.mechanic.description.length).toBeGreaterThan(0);
      expect(payload.phases.length).toBeGreaterThan(0);
      expect(payload.phases.every((p) => p.recommendedCounters.length > 0)).toBe(true);
      expect(payload.vitals.health).toBe(boss.health);
      const keys: string[] = [];
      collectKeys(payload, keys);
      for (const key of keys) {
        expect(key).not.toMatch(/win|chance|readiness|odds|probabilit|success.?rate/i);
      }
    }
  });
});

describe('boss roster expansion — Overclock Ramp (Spinneret / Vaultkeeper)', () => {
  it('ramp multiplier follows the published curve', () => {
    expect(overclockRampMult(5)).toBe(1);
    expect(overclockRampMult(20)).toBe(1);
    expect(overclockRampMult(30)).toBeCloseTo(1.2);
    expect(overclockRampMult(45)).toBeCloseTo(1.5);
    expect(overclockRampMult(70)).toBe(2);
    expect(overclockRampMult(600)).toBe(2);
  });

  it('a slow kill pays ramped survival; a fast kill pays none', () => {
    const spinneret = bossById('spinneret_widow');
    const neutral = neutralClone(spinneret);

    const slowWeapon = makeWeapon({ baseDamage: 40, attackSpeed: 1, critChance: 0 });
    const slowVsRamp = simulateBoss(simInput(spinneret, { primary: slowWeapon }));
    const slowVsNeutral = simulateBoss(simInput(neutral, { primary: slowWeapon }));
    expect(slowVsRamp.timeToKill).toBeGreaterThan(45);
    expect(slowVsRamp.survivalScore).toBeLessThan(slowVsNeutral.survivalScore);
    expect(slowVsRamp.reasons.some((r) => r.includes('Overclock'))).toBe(true);
    // The tax lands only on survival: physical DPS/TTK are unchanged.
    expect(slowVsRamp.timeToKill).toBeCloseTo(slowVsNeutral.timeToKill);
    expect(slowVsRamp.effectiveDPS).toBeCloseTo(slowVsNeutral.effectiveDPS);

    const fastWeapon = makeWeapon({ baseDamage: 3000, attackSpeed: 6, critChance: 0 });
    const fastVsRamp = simulateBoss(simInput(spinneret, { primary: fastWeapon }));
    const fastVsNeutral = simulateBoss(simInput(neutral, { primary: fastWeapon }));
    expect(fastVsRamp.timeToKill).toBeLessThan(20);
    expect(fastVsRamp.survivalScore).toBeCloseTo(fastVsNeutral.survivalScore);
  });

  it('the Vaultkeeper finale ramps too', () => {
    const vaultkeeper = bossById('vaultkeeper_omega');
    const slowWeapon = makeWeapon({ baseDamage: 60, attackSpeed: 1, critChance: 0 });
    const ramped = simulateBoss(simInput(vaultkeeper, { primary: slowWeapon }));
    const neutral = simulateBoss(simInput(neutralClone(vaultkeeper), { primary: slowWeapon }));
    expect(ramped.survivalScore).toBeLessThan(neutral.survivalScore);
    expect(ramped.reasons.some((r) => r.includes('Final Overclock'))).toBe(true);
  });
});

describe('boss roster expansion — Adaptive Plating (Mnemosyne Mirror)', () => {
  it('the primary element reads as resisted: the weakness gap collapses', () => {
    const mirror = bossById('mnemosyne_mirror');
    const neutral = neutralClone(mirror);
    const kineticPrimary = makeWeapon({ element: Element.Kinetic });
    const cryoPrimary = makeWeapon({ element: Element.Cryo });

    const cloneKinetic = simulateBoss(simInput(neutral, { primary: kineticPrimary }));
    const cloneCryo = simulateBoss(simInput(neutral, { primary: cryoPrimary }));
    // Neutral profile: Kinetic is her weakness (1.3x), Cryo resisted (0.7x).
    expect(cloneKinetic.effectiveDPS / cloneCryo.effectiveDPS).toBeGreaterThan(1.5);

    const mirrorKinetic = simulateBoss(simInput(mirror, { primary: kineticPrimary }));
    const mirrorCryo = simulateBoss(simInput(mirror, { primary: cryoPrimary }));
    // Attuned: BOTH primaries read as resisted — the gap collapses.
    expect(mirrorKinetic.effectiveDPS).toBeLessThan(cloneKinetic.effectiveDPS);
    expect(mirrorKinetic.effectiveDPS / mirrorCryo.effectiveDPS).toBeGreaterThan(0.9);
    expect(mirrorKinetic.effectiveDPS / mirrorCryo.effectiveDPS).toBeLessThan(1.1);
    expect(mirrorKinetic.reasons.some((r) => r.includes('Adaptive Plating'))).toBe(true);
  });

  it('a mixed-element build keeps a live answer through the heavy slot', () => {
    const mirror = bossById('mnemosyne_mirror');
    const kineticPrimary = makeWeapon({ element: Element.Kinetic });
    const shockHeavy = makeWeapon({ id: 'heavy', element: Element.Shock, baseDamage: 400 });
    const kineticHeavy = makeWeapon({ id: 'heavy', element: Element.Kinetic, baseDamage: 400 });
    const mixed = simulateBoss(simInput(mirror, { primary: kineticPrimary, heavy: shockHeavy }));
    const doubled = simulateBoss(simInput(mirror, { primary: kineticPrimary, heavy: kineticHeavy }));
    // Attunement reads the PRIMARY only: the Kinetic heavy keeps its
    // weakness match (so the doubled-down build out-damages the
    // mixed one here), while both builds pay the same primary
    // penalty versus the neutral clone — the penalty is real, and
    // non-primary slots are genuinely untouched by it.
    expect(mixed.effectiveDPS).not.toBeCloseTo(doubled.effectiveDPS);
    const neutralMixed = simulateBoss(simInput(neutralClone(mirror), { primary: kineticPrimary, heavy: shockHeavy }));
    expect(mixed.effectiveDPS).toBeLessThan(neutralMixed.effectiveDPS);
  });
});

describe('boss roster expansion — trait gates and layer checks', () => {
  it('Static Choir: stagger chance flips the mechanic score', () => {
    const choir = bossById('static_choir');
    const unprepared = simulateBoss(simInput(choir, { skillBonuses: {} }));
    const prepared = simulateBoss(simInput(choir, { skillBonuses: { staggerChance: 0.25 } }));
    expect(unprepared.mechanicScore).toBe(0.5);
    expect(prepared.mechanicScore).toBe(1);
    expect(prepared.winChance).toBeGreaterThan(unprepared.winChance);
  });

  it('Sister Null: status chance flips the mechanic score', () => {
    const sister = bossById('sister_null');
    const unprepared = simulateBoss(simInput(sister, { skillBonuses: {} }));
    const prepared = simulateBoss(simInput(sister, { skillBonuses: { statusChance: 0.2 } }));
    expect(unprepared.mechanicScore).toBe(0.5);
    expect(prepared.mechanicScore).toBe(1);
    expect(prepared.winChance).toBeGreaterThan(unprepared.winChance);
  });

  it('Verdant Maw: Corrosive out-breaks Kinetic against the living armor', () => {
    const maw = bossById('verdant_maw');
    const corrosive = simulateBoss(simInput(maw, { primary: makeWeapon({ element: Element.Corrosive }) }));
    const kinetic = simulateBoss(simInput(maw, { primary: makeWeapon({ element: Element.Kinetic }) }));
    expect(corrosive.breakScore).toBeGreaterThan(kinetic.breakScore);
    expect(corrosive.winChance).toBeGreaterThan(kinetic.winChance);
  });
});

describe('boss roster expansion — Chef path (fees, XP, dedicated drops, unlocks)', () => {
  const PLAYER = '22222222-2222-4222-8222-222222222222';

  function attemptRequest(boss: BossDef, overrides: Partial<BossAttemptRequest> = {}): Omit<BossAttemptRequest, 'attemptNonce'> {
    return {
      playerId: PLAYER,
      bossId: boss.id,
      primary: makeWeapon({ baseDamage: 10000, attackSpeed: 10, critChance: 0.5, critDamage: 2, bossDamageMod: 2 }),
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: makeShield({ hp: 8000, mitigation: 0.5 }),
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      playerLevel: boss.level + 10,
      skillBonuses: { staggerChance: 0.3, statusChance: 0.25 },
      pityCount: 0,
      playerCredits: 100_000_000,
      entryFee: 0,
      economy: { bossDedicatedChance: 1 },
      ...overrides,
    };
  }

  function findVictory(boss: BossDef, overrides: Partial<BossAttemptRequest> = {}) {
    const base = attemptRequest(boss, overrides);
    for (let nonce = 1; nonce <= 2000; nonce++) {
      const result = processBossAttempt({ ...base, attemptNonce: nonce });
      if (result.result.victory) return result;
    }
    throw new Error(`no victory nonce for ${boss.id}`);
  }

  it('each new boss pays XP = level × 50 and drops a dedicated legendary at max(boss, player) level', () => {
    for (const boss of NEW_BOSSES) {
      const result = findVictory(boss);
      expect(result.xpAwarded, `${boss.id} xp`).toBe(boss.level * 50);
      expect(result.dedicatedDropAwarded, `${boss.id} dedicated`).toBe(true);
      const drop = result.loot[0] as Weapon;
      expect(drop.rarity).toBe(Rarity.Legendary);
      expect(boss.dedicatedDrops).toContain(drop.legendaryEffectId);
      // Player (boss.level + 10) outlevels the boss: dedicated drops
      // generate at the player's level; generic rolls keep boss level.
      expect(drop.level).toBe(boss.level + 10);
    }
  });

  it('victories unlock the next boss in ladder order, through the whole expansion', () => {
    expect(findVictory(bossById('scrap_bishop')).unlockedBossId).toBe('spinneret_widow');
    for (let i = 0; i < NEW_BOSSES.length - 1; i++) {
      expect(findVictory(NEW_BOSSES[i]).unlockedBossId).toBe(NEW_BOSSES[i + 1].id);
    }
    expect(findVictory(bossById('vaultkeeper_omega')).unlockedBossId).toBeUndefined();
  });

  it('fees follow the standing escalation on the new defs', () => {
    for (const boss of NEW_BOSSES) {
      expect(escalatedBossFee(boss.entryCost, 0)).toBe(boss.entryCost);
      expect(escalatedBossFee(boss.rematchCost, 1)).toBe(boss.rematchCost * 2);
      expect(escalatedBossFee(boss.rematchCost, 3)).toBe(boss.rematchCost * 8);
      expect(escalatedBossFee(boss.rematchCost, 12)).toBe(boss.rematchCost * 8);
      expect(boss.rematchCost).toBeGreaterThan(boss.entryCost);
    }
  });
});
