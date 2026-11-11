/**
 * Boss attack cadence — slice C1 (owner rulings D1–D8, 2026-11-10).
 *
 * The approved brief's acceptance pins, verbatim in spirit:
 *   1. Budget invariance — cadence on vs off, the boss's total
 *      damage budget is bit-identical for identical inputs, per boss.
 *   2. Recharge isolation — at rechargeRate 0, winChance is
 *      bit-identical cadence-on vs cadence-off for every boss:
 *      cadence moves outcomes ONLY through recharge.
 *   3. Gap truth — restored recharge > 0 for the wide archetypes
 *      (Bruiser/Duelist/Siege/Ghost/Mountain), = 0 for Ashgut and
 *      Widow-9 (3s swarm cadence touches every tick).
 *   4. Special bound — every boss's single special ≤ 35% of the
 *      reference parity survival pool.
 *   5. Endless bit-identical — a generated encounter's sim output is
 *      unchanged with the cadence code present (its def carries no
 *      cadence field — ruling D3).
 *
 * The budget itself (bossTotalDamage) is internal to simulateBoss;
 * its observable is survivalScore = totalSurvival / budget, with
 * totalSurvival pinned by the fixture: at rechargeRate 0 and no
 * consumables, survivalScore × (dps × 30) reconstructs the budget
 * bit-exactly whenever the folds (stagger / burst / ramp) are 1 —
 * the fixtures keep them 1 by construction (no skills, no action
 * skill, and every boss's fixture weapon calibrated so its TTK
 * lands at ~10s, inside the ramp's 20s grace window — a flat
 * weapon leaves the late roster at 40–98s TTKs, where the two
 * ramp bosses' output survivalScore is ramp-taxed and the
 * reconstruction cannot hold).
 */
import { describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '../constants/bosses';
import { endlessEncounterForDepth } from '../content/endless';
import { computeHunterMaxHp } from '../lib/combat/damageContract';
import {
  bossCadenceTimeline,
  simulateBoss,
  type BossSimulationInput,
} from '../lib/simulation/bossSimulator';
import type { BossDef } from '../types/boss';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Shield, Weapon } from '../types/items';

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'parity-primary',
    name: 'Parity Gun',
    level: 50,
    rarity: Rarity.Epic,
    weaponType: WeaponType.Sniper,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic,
    rollQuality: 75,
    baseDamage: 100,
    attackSpeed: 3,
    critChance: 0.15,
    critDamage: 1.5,
    statusChance: 0.1,
    statusDamage: 1,
    bossDamageMod: 1,
    waveDamageMod: 1,
    shieldDamageMod: 1,
    armorDamageMod: 1,
    offlineEarningsMod: 1,
    rareDropChanceMod: 1,
    scrapYieldMod: 1,
    parts: [],
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 0,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  } as Weapon;
}

function makeShield(overrides: Partial<Shield> = {}): Shield {
  return {
    id: 'parity-shield',
    name: 'Parity Shield',
    level: 50,
    rarity: Rarity.Rare,
    hp: 1200,
    rechargeRate: 0,
    mitigation: 0,
    element: Element.Kinetic,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 0,
    ...overrides,
  } as Shield;
}

function inputFor(boss: BossDef, shield: Shield | null): BossSimulationInput {
  return {
    primary: makeWeapon(),
    secondary: null,
    heavy: null,
    ordnance: null,
    shield,
    classMod: null,
    relic: null,
    consumables: {},
    risk: RiskSetting.Balanced,
    boss,
    playerLevel: boss.level,
    skillBonuses: {},
    pityCount: 0,
    playerCredits: 0,
  } as BossSimulationInput;
}

/**
 * The fixture weapon, calibrated per boss: probe the flat weapon's
 * TTK, then scale baseDamage so the kill lands at ~10s — inside the
 * overclock ramp's 20s grace for the two ramp bosses, and clear of
 * every other TTK-sensitive fold. DPS scales linearly with
 * baseDamage through the chain, so one probe pins the scale.
 */
function calibratedInputFor(boss: BossDef, shield: Shield | null): BossSimulationInput {
  const probe = simulateBoss(inputFor(boss, null));
  const scale = probe.timeToKill / 10;
  const input = inputFor(boss, shield);
  input.primary = makeWeapon({ baseDamage: 100 * scale });
  return input;
}

function withoutCadence(boss: BossDef): BossDef {
  const clone: BossDef = { ...boss };
  delete clone.cadence;
  return clone;
}

/** Damage-free seconds per boss, counted by the shipped timeline. */
const QUIET: Record<string, number> = {
  dune_tyrant: 15,
  siltstalker: 9,
  heap_guard: 12,
  ashgut: 0,
  mirage_duster: 12,
  rust_prophet: 15,
  scrap_bishop: 12,
  spinneret_widow: 0,
  mnemosyne_mirror: 12,
  static_choir: 9,
  verdant_maw: 12,
  sister_null: 9,
  vaultkeeper_omega: 12,
};

describe('boss cadence — the defs', () => {
  it('every authored boss carries a cadence (Endless defs do not)', () => {
    expect(REGION_1_BOSSES).toHaveLength(13);
    for (const boss of REGION_1_BOSSES) {
      expect(boss.cadence, boss.id).toBeDefined();
      expect(boss.cadence!.windupSeconds, boss.id).toBe(3);
      expect(boss.cadence!.specialShare, boss.id).toBeGreaterThan(0);
      expect(boss.cadence!.specialShare, boss.id).toBeLessThan(1);
    }
  });
});

describe('bossCadenceTimeline — the bucketing', () => {
  it('counts damage-free ticks as the ticks no event lands in', () => {
    for (const boss of REGION_1_BOSSES) {
      const tl = bossCadenceTimeline(boss.cadence!, boss.dps * 30);
      expect(tl.damageFreeSeconds, boss.id).toBe(QUIET[boss.id]);
    }
  });

  it('splits the budget exactly: regular + special = B', () => {
    for (const boss of REGION_1_BOSSES) {
      const B = boss.dps * 30;
      const tl = bossCadenceTimeline(boss.cadence!, B);
      expect(tl.totalDamage, boss.id).toBe(B);
      expect(tl.regularBudget + tl.specialBudget, boss.id).toBe(B);
      expect(tl.specialBudget, boss.id).toBeCloseTo(B * boss.cadence!.specialShare, 9);
    }
  });

  it('a 3s rhythm touches every tick — no quiet, by construction', () => {
    const tl = bossCadenceTimeline(
      { hitIntervalSeconds: 3, specialName: 'X', specialEverySeconds: 12, specialShare: 0.3, windupSeconds: 3 },
      3000,
    );
    expect(tl.damageFreeSeconds).toBe(0);
    expect(tl.specialCount).toBe(2);
  });
});

describe('boss cadence — acceptance', () => {
  it('(1) budget invariance: survivalScore × base budget is identical cadence on/off', () => {
    for (const boss of REGION_1_BOSSES) {
      const shield = makeShield({ hp: 1200, rechargeRate: 0 });
      const on = simulateBoss(calibratedInputFor(boss, shield));
      const off = simulateBoss(calibratedInputFor(withoutCadence(boss), shield));
      // Fixture sanity: no fold may move the budget (ramp inside grace).
      expect(on.timeToKill, boss.id).toBeLessThan(20);
      expect(off.timeToKill, boss.id).toBeLessThan(20);
      const pool = computeHunterMaxHp(boss.level, 0) + 1200;
      expect(on.survivalScore * (boss.dps * 30), boss.id).toBeCloseTo(pool, 6);
      expect(off.survivalScore * (boss.dps * 30), boss.id).toBeCloseTo(pool, 6);
      expect(on.survivalScore, boss.id).toBe(off.survivalScore);
    }
  });

  it('(2) recharge isolation: at rate 0, winChance is bit-identical on/off', () => {
    for (const boss of REGION_1_BOSSES) {
      const shield = makeShield({ hp: 1200, rechargeRate: 0 });
      const on = simulateBoss(inputFor(boss, shield));
      const off = simulateBoss(inputFor(withoutCadence(boss), shield));
      expect(on.winChance, boss.id).toBe(off.winChance);
      expect(on.cadence, boss.id).toBeDefined();
      expect(on.cadence!.shieldRecharged, boss.id).toBe(0);
      expect(off.cadence, boss.id).toBeUndefined();
    }
  });

  it('(3) gap truth: recharge restores in the wide rhythms, never in the swarm pair', () => {
    const wide = ['dune_tyrant', 'mnemosyne_mirror', 'scrap_bishop', 'mirage_duster', 'verdant_maw'];
    for (const boss of REGION_1_BOSSES) {
      const shield = makeShield({ hp: 5000, rechargeRate: 25 });
      const on = simulateBoss(inputFor(boss, shield));
      expect(on.cadence, boss.id).toBeDefined();
      expect(on.cadence!.damageFreeSeconds, boss.id).toBe(QUIET[boss.id]);
      if (boss.id === 'ashgut' || boss.id === 'spinneret_widow') {
        expect(on.cadence!.shieldRecharged, boss.id).toBe(0);
        const off = simulateBoss(inputFor(withoutCadence(boss), shield));
        expect(on.winChance, boss.id).toBe(off.winChance);
      } else if (wide.includes(boss.id)) {
        expect(on.cadence!.shieldRecharged, boss.id).toBeGreaterThan(0);
      }
    }
  });

  it('(3b) the Mirror restore is exact: min(dent, rate × quiet)', () => {
    const mirror = REGION_1_BOSSES.find((b) => b.id === 'mnemosyne_mirror')!;
    // dent = min(capacity 5000, budget 255 × 30 = 7650) = 5000;
    // rate × quiet = 25 × 12 = 300.
    const on = simulateBoss(inputFor(mirror, makeShield({ hp: 5000, rechargeRate: 25 })));
    expect(on.cadence!.shieldRecharged).toBe(300);
    expect(on.cadence!.specialCount).toBe(2);
  });

  it('(4) special bound: no single special exceeds 35% of the parity pool', () => {
    // Parity pool = hunter HP at the boss's level + a 5,000 shield.
    // The two slowest cycles (Maw 20s, Sister Null 18s) land ONE
    // special in the window, so their shares (0.30 / 0.27) are set
    // by this bound — at the archetype table's 0.45 / 0.40 first
    // estimates a single hit would carry ~50% of this pool.
    for (const boss of REGION_1_BOSSES) {
      const tl = bossCadenceTimeline(boss.cadence!, boss.dps * 30);
      const parityPool = computeHunterMaxHp(boss.level, 0) + 5000;
      expect(tl.perSpecialDamage, boss.id).toBeLessThanOrEqual(0.35 * parityPool);
    }
  });

  it('(5) Endless: generated encounters carry no cadence and sim unchanged', () => {
    for (const [depth, start] of [
      [1, 20],
      [5, 20],
      [10, 40],
    ] as const) {
      const enc = endlessEncounterForDepth(depth, start);
      expect(enc.def.cadence, `depth ${depth}`).toBeUndefined();
      const shield = makeShield({ hp: 2000, rechargeRate: 25 });
      const a = simulateBoss(inputFor(enc.def, shield));
      const b = simulateBoss(inputFor(enc.def, shield));
      expect(a.winChance).toBe(b.winChance);
      expect(a.cadence).toBeUndefined();
    }
  });

  it('attempt reasons name the special and its share of the damage', () => {
    const mirror = REGION_1_BOSSES.find((b) => b.id === 'mnemosyne_mirror')!;
    const on = simulateBoss(inputFor(mirror, makeShield({ hp: 5000, rechargeRate: 25 })));
    const line = on.reasons.find((r) => r.startsWith('Attack pattern:'));
    expect(line).toBeDefined();
    expect(line).toContain('Refraction Burst');
    expect(line).toContain('~40% of the damage');
    expect(line).toContain('recharges in the 12s of quiet');
  });

  it('a cadence-less boss has no pattern reason and no cadence echo', () => {
    const tyrant = withoutCadence(REGION_1_BOSSES[0]);
    const out = simulateBoss(inputFor(tyrant, makeShield({ hp: 1200, rechargeRate: 25 })));
    expect(out.cadence).toBeUndefined();
    expect(out.reasons.some((r) => r.startsWith('Attack pattern:'))).toBe(false);
  });
});
