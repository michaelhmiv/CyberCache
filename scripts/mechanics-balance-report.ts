/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CyberCache Mechanics Balance Report
 * 
 * Sanity report for boss balance across sample loadout archetypes.
 * Uses the existing boss simulator with mock weapons.
 * 
 * Usage: npm run mechanics:report
 */

import * as path from "path";
import { pathToFileURL } from "url";
import { Weapon, Shield } from "../src/types/items";
import { RiskSetting, Element, Manufacturer, WeaponType, Rarity } from "../src/types/game";
import { BossDef } from "../src/types/boss";

const ROOT = path.resolve(__dirname, "..");

async function loadModule(relativePath: string) {
  const url = pathToFileURL(path.join(ROOT, relativePath)).href;
  return await import(url);
}

// â”€â”€ Sample Weapon Creator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeWeapon(overrides: Partial<Weapon> & { baseDamage: number; weaponType: string; element: string; manufacturer: string; shieldDamageMod?: number; armorDamageMod?: number; bossDamageMod?: number }): Weapon {
  return {
    id: `mock_${overrides.weaponType}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: `Mock ${overrides.weaponType}`,
    level: 25,
    rarity: Rarity.Rare,
    weaponType: overrides.weaponType as WeaponType,
    manufacturer: overrides.manufacturer as Manufacturer,
    element: overrides.element as Element,
    rollQuality: 60,
    baseDamage: overrides.baseDamage,
    attackSpeed: 1.0,
    critChance: 0.1,
    critDamage: 1.5,
    statusChance: 0.1,
    statusDamage: 1.0,
    bossDamageMod: overrides.bossDamageMod ?? 1.0,
    waveDamageMod: 1.0,
    shieldDamageMod: overrides.shieldDamageMod ?? 1.0,
    armorDamageMod: overrides.armorDamageMod ?? 1.0,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: "World Drop" as any,
    isLocked: false,
    pixelSeed: 42,
    combatPower: 200,
    bossPower: 200,
    farmPower: 150,
    economyScore: 50,
  };
}

function makeShield(hp: number): Shield {
  return {
    id: `mock_shield_${hp}`,
    name: `Mock Shield ${hp}`,
    level: 25,
    rarity: Rarity.Rare,
    hp,
    rechargeRate: 10,
    mitigation: 0.2,
    element: Element.Kinetic,
    affixes: [],
    sourceTag: "World Drop" as any,
    isLocked: false,
    pixelSeed: 99,
  };
}

// â”€â”€ Archetypes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface Archetype {
  name: string;
  primary: Weapon;
  secondary: Weapon | null;
  heavy: Weapon | null;
  shield: Shield;
  consumables: Record<string, number>;
  skillBonuses: Record<string, number>;
}

function createArchetypes(): Archetype[] {
  const shield = makeShield(400);

  return [
    {
      name: "Basic Generalist",
      primary: makeWeapon({ baseDamage: 80, weaponType: "Pistol", element: "Kinetic", manufacturer: "Redline" }),
      secondary: null,
      heavy: null,
      shield,
      consumables: { MedKit: 1 },
      skillBonuses: {},
    },
    {
      name: "Shield Breaker",
      primary: makeWeapon({ baseDamage: 70, weaponType: "SMG", element: "Shock", manufacturer: "Prismatek", shieldDamageMod: 1.4 }),
      secondary: null,
      heavy: null,
      shield,
      consumables: { ShockAmmo: 1, OrdnanceCharge: 1 },
      skillBonuses: { shieldBreak: 0.15 },
    },
    {
      name: "Armor Breaker",
      primary: makeWeapon({ baseDamage: 90, weaponType: "Launcher", element: "Corrosive", manufacturer: "BlastForge", armorDamageMod: 1.5 }),
      secondary: null,
      heavy: null,
      shield,
      consumables: { CorrosiveAmmo: 1, PhaseShiftGrenade: 1 },
      skillBonuses: { armorBreak: 0.15 },
    },
    {
      name: "DPS / Burst",
      primary: makeWeapon({ baseDamage: 120, weaponType: "Sniper", element: "Kinetic", manufacturer: "Ironwood", bossDamageMod: 1.3 }),
      secondary: makeWeapon({ baseDamage: 60, weaponType: "Pistol", element: "Fire", manufacturer: "Redline" }),
      heavy: null,
      shield,
      consumables: { TargetPainter: 1, VoidAmmo: 1, OverchargeStim: 1 },
      skillBonuses: { dps: 0.15 },
    },
    {
      name: "Survival Heavy",
      primary: makeWeapon({ baseDamage: 60, weaponType: "Beam", element: "Cryo", manufacturer: "Prismatek" }),
      secondary: null,
      heavy: null,
      shield: makeShield(800),
      consumables: { MedKit: 2, ShieldCell: 2, NanoSwarm: 1, CryoAmmo: 1 },
      skillBonuses: { survival: 0.2 },
    },
    {
      name: "No Consumable Baseline",
      primary: makeWeapon({ baseDamage: 80, weaponType: "Pistol", element: "Kinetic", manufacturer: "Ironwood" }),
      secondary: null,
      heavy: null,
      shield,
      consumables: {},
      skillBonuses: {},
    },
  ];
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function main() {
  console.log("CyberCache Boss Balance Report");
  console.log("==============================\n");

  const [bossesMod] = await Promise.all([
    loadModule("src/constants/bosses.ts"),
  ]);
  const bosses: BossDef[] = bossesMod.REGION_1_BOSSES || [];
  console.log(`Loaded ${bosses.length} bosses\n`);

  const { simulateBoss } = await import(
    pathToFileURL(path.join(ROOT, "src/lib/simulation/bossSimulator.ts")).href
  );

  const archetypes = createArchetypes();
  console.log(`Testing ${archetypes.length} loadout archetypes against ${bosses.length} bosses:\n`);

  const results: Record<string, Record<string, number>> = {};

  for (const boss of bosses) {
    console.log(`${"â”€".repeat(60)}`);
    console.log(`${boss.name} (Tier ${boss.tier}, Lv.${boss.level}, Rec. ${boss.recommendedPower})`);

    if (boss.tags.length > 0) {
      console.log(`  Tags: ${boss.tags.join(", ")}`);
    }
    console.log(`  HP: ${boss.health}  Shield: ${boss.shield}  Armor: ${boss.armor}  DPS: ${boss.dps}`);
    console.log(`  Weak: ${boss.weaknesses.join(", ") || "none"}  Resist: ${boss.resistances.join(", ") || "none"}`);
    console.log(`  Mechanic: ${boss.mechanic.name} (${boss.mechanic.checkType})`);
    console.log(`  Phases: ${boss.phases.length}`);
    console.log();

    results[boss.id] = {};

    for (const arch of archetypes) {
      const sim = simulateBoss({
        primary: arch.primary,
        secondary: arch.secondary,
        heavy: arch.heavy,
        ordnance: null,
        shield: arch.shield,
        classMod: null,
        relic: null,
        consumables: arch.consumables,
        risk: RiskSetting.Balanced,
        boss,
        playerLevel: Math.max(boss.level, 10),
        skillBonuses: arch.skillBonuses,
      });

      results[boss.id][arch.name] = sim.winChance;

      const winPct = (sim.winChance * 100).toFixed(1);
      const band = sim.winChance >= 0.75 ? "good" : sim.winChance >= 0.5 ? "ok" : sim.winChance >= 0.25 ? "bad" : "critical";

      const failurePhase = sim.projectedFailurePhase
        ? `${sim.projectedFailurePhase.phaseName} (${sim.projectedFailurePhase.status})`
        : "none";

      console.log(`  ${arch.name.padEnd(24)} ${winPct}% [${band}]  fail: ${failurePhase}`);
    }
    console.log();
  }

  // â”€â”€ Summary Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log(`${"â”€".repeat(60)}`);
  console.log("\nSummary: Win chance (%) by archetype\n");

  const header = ["Boss".padEnd(22), ...archetypes.map((a) => a.name.padEnd(12))].join("  ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const boss of bosses) {
    const row = [boss.name.padEnd(22), ...archetypes.map((a) => {
      const pct = ((results[boss.id]?.[a.name] ?? 0) * 100).toFixed(0);
      return `${pct}%`.padEnd(12);
    })].join("  ");
    console.log(row);
  }

  // â”€â”€ Warnings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log("\nSanity Warnings:");
  let warnings = 0;

  for (const boss of bosses) {
    const archResults = results[boss.id] || {};

    // Check: shield breaker should be better than baseline against shield bosses
    if (boss.tags.includes("shield") || boss.shield > 500) {
      const shieldBreak = archResults["Shield Breaker"];
      const baseline = archResults["No Consumable Baseline"];
      if (shieldBreak !== undefined && baseline !== undefined && shieldBreak <= baseline) {
        console.log(`  WARN: ${boss.name} - Shield Breaker not better than baseline`);
        warnings++;
      }
    }

    // Check: armor breaker should work against armor bosses
    if (boss.tags.includes("armor") || boss.armor > 500) {
      const armorBreak = archResults["Armor Breaker"];
      const baseline = archResults["No Consumable Baseline"];
      if (armorBreak !== undefined && baseline !== undefined && armorBreak <= baseline) {
        console.log(`  WARN: ${boss.name} - Armor Breaker not better than baseline`);
        warnings++;
      }
    }

    // Check: tutorial boss should be beatable by baseline
    if (boss.tags.includes("tutorial")) {
      const baseline = archResults["No Consumable Baseline"];
      if (baseline !== undefined && baseline < 0.5) {
        console.log(`  WARN: ${boss.name} - Tutorial boss below 50% for baseline`);
        warnings++;
      }
    }

    // Check: no boss should have ALL archetypes at < 5%
    const allChances = Object.values(archResults);
    if (allChances.length > 0 && allChances.every((c) => c < 0.05)) {
      console.log(`  WARN: ${boss.name} - All archetypes below 5% win chance`);
      warnings++;
    }

    // Check: no boss should have ALL archetypes at > 95%
    if (allChances.length > 0 && allChances.every((c) => c > 0.95)) {
      console.log(`  WARN: ${boss.name} - All archetypes above 95% win chance (may be too easy)`);
      warnings++;
    }
  }

  if (warnings === 0) {
    console.log("  No major balance warnings detected.");
  }

  console.log(`\nDone. ${bosses.length} bosses x ${archetypes.length} archetypes = ${bosses.length * archetypes.length} simulations.`);
  console.log(`${warnings} balance warnings.`);
}

main().catch((e: any) => {
  console.error("Fatal:", e.message);
  process.exit(2);
});