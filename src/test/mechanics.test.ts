import { describe, it, expect } from "vitest";
import { simulateBoss } from "../lib/simulation/bossSimulator";
import { REGION_1_BOSSES } from "../constants/bosses";
import { ROAMING_AREAS, DEFAULT_ROAMING_AREA_ID } from "../constants/roamingAreas";
import { CONSUMABLES, CONSUMABLE_SLOTS } from "../constants/consumables";
import { CRAFTING_RECIPES } from "../constants/craftingRecipes";
import { LEGENDARY_EFFECTS } from "../constants/legendaryEffects";
import { Weapon, Shield } from "../types/items";
import { RiskSetting, Element, Rarity, WeaponType, Manufacturer } from "../types/game";

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeWeapon(opts: {
  baseDamage: number;
  element: Element;
  weaponType: WeaponType;
  manufacturer: Manufacturer;
  shieldDamageMod?: number;
  armorDamageMod?: number;
  bossDamageMod?: number;
}): Weapon {
  return {
    id: "test-" + Math.random().toString(36).slice(2, 8),
    name: "Test Weapon",
    level: 15,
    rarity: Rarity.Rare,
    weaponType: opts.weaponType,
    manufacturer: opts.manufacturer,
    element: opts.element,
    rollQuality: 60,
    baseDamage: opts.baseDamage,
    attackSpeed: 1.0,
    critChance: 0.1,
    critDamage: 1.5,
    statusChance: 0.1,
    statusDamage: 1.0,
    bossDamageMod: opts.bossDamageMod ?? 1.0,
    waveDamageMod: 1.0,
    shieldDamageMod: opts.shieldDamageMod ?? 1.0,
    armorDamageMod: opts.armorDamageMod ?? 1.0,
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
    id: "test-shield-" + Math.random().toString(36).slice(2, 6),
    name: "Test Shield",
    level: 15,
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

// â”€â”€ Consumables V2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("Consumables V2", () => {
  const all = Object.values(CONSUMABLES);

  it("every consumable has required V2 fields", () => {
    for (const c of all) {
      expect(c.id).toBeTruthy();
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.family).toBeTruthy();
      expect(c.allowedSlots.length).toBeGreaterThan(0);
      expect(c.shortDescription.length).toBeGreaterThan(0);
      expect(c.tacticalRole.length).toBeGreaterThan(0);
      expect(c.trigger).toBeTruthy();
      expect(c.consumePolicy).toBeTruthy();
      expect(c.implementationStatus).toBeTruthy();
    }
  });

  it("all boss-prep-visible consumables have counterTags and uiHints", () => {
    const prepCons = all.filter((c) => c.isBossPrepVisible);
    expect(prepCons.length).toBeGreaterThan(16);
    for (const c of prepCons) {
      expect(c.counterTags.length).toBeGreaterThan(0);
      expect(c.uiHints.length).toBeGreaterThan(0);
    }
  });

  it("ShockAmmo counters shield tag", () => {
    expect(CONSUMABLES.ShockAmmo.counterTags).toContain("shield");
  });

  it("CorrosiveAmmo counters armor and repair tags", () => {
    expect(CONSUMABLES.CorrosiveAmmo.counterTags).toContain("armor");
    expect(CONSUMABLES.CorrosiveAmmo.counterTags).toContain("repair");
  });

  it("Jammer counters enrage, phase, and repair", () => {
    expect(CONSUMABLES.Jammer.counterTags).toContain("enrage");
    expect(CONSUMABLES.Jammer.counterTags).toContain("phase");
    expect(CONSUMABLES.Jammer.counterTags).toContain("repair");
  });

  it("InsuranceToken has deathFee counter tag", () => {
    expect(CONSUMABLES.InsuranceToken.counterTags).toContain("deathFee");
  });

  it("Survival consumables use Emergency slot", () => {
    const survivalCons = all.filter((c) => c.family === "survival");
    for (const c of survivalCons) {
      expect(c.allowedSlots).toContain("Emergency");
    }
  });

  it("BossPrep-visible consumables only use valid slots", () => {
    const VALID = ["PreFight", "MidFight", "Emergency"];
    for (const c of all.filter((c2) => c2.isBossPrepVisible)) {
      for (const s of c.allowedSlots) {
        expect(VALID).toContain(s);
      }
    }
  });

  it("all implementation statuses are valid", () => {
    const VALID = ["implemented", "approximated", "legacy"];
    for (const c of all) {
      expect(VALID).toContain(c.implementationStatus);
    }
  });
});

// â”€â”€ Roaming Areas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("Roaming Areas", () => {
  it("Dustwaste Frontier is the default starter area at level 1", () => {
    const area = ROAMING_AREAS.find((a) => a.id === DEFAULT_ROAMING_AREA_ID);
    expect(area).toBeDefined();
    expect(area!.unlockLevel).toBe(1);
  });

  it("each area has a unique ID", () => {
    const ids = new Set(ROAMING_AREAS.map((a) => a.id));
    expect(ids.size).toBe(ROAMING_AREAS.length);
  });

  it("each area has required gameplay metadata", () => {
    for (const area of ROAMING_AREAS) {
      expect(area.name.length).toBeGreaterThan(0);
      expect(area.gameplayIdentity.length).toBeGreaterThan(0);
      expect(area.shortDescription.length).toBeGreaterThan(0);
      expect(area.enemyType.length).toBeGreaterThan(0);
      expect(area.lootBias.length).toBeGreaterThan(0);
      expect(area.selectionHint.length).toBeGreaterThan(0);
      expect(area.unlockLevel).toBeGreaterThanOrEqual(1);
      expect(area.idleCreditsPerMinute).toBeGreaterThanOrEqual(0);
    }
  });

  it("each area has valid manufacturer influence", () => {
    const VALID = ["Redline", "Ironwood", "BlastForge", "Prismatek", "ThrowTech", "HelixWorks", "Mixed"];
    for (const area of ROAMING_AREAS) {
      expect(VALID).toContain(area.manufacturerInfluence);
    }
  });
});

// â”€â”€ Boss Definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("Boss Definitions", () => {
  it("7 bosses in Region 1 with sequential tiers", () => {
    expect(REGION_1_BOSSES).toHaveLength(7);
    for (let i = 0; i < REGION_1_BOSSES.length; i++) {
      expect(REGION_1_BOSSES[i].tier).toBe(i + 1);
    }
  });

  it("each boss has tags, phases, and mechanic description", () => {
    for (const boss of REGION_1_BOSSES) {
      expect(boss.tags.length).toBeGreaterThan(0);
      expect(boss.phases.length).toBeGreaterThan(0);
      expect(boss.mechanic.description.length).toBeGreaterThan(0);
      expect(boss.name.length).toBeGreaterThan(0);
    }
  });

  it("tutorial boss has no shield/armor and 0 entry cost", () => {
    const tut = REGION_1_BOSSES.find((b) => b.tags.includes("tutorial"));
    expect(tut).toBeDefined();
    expect(tut!.shield).toBe(0);
    expect(tut!.armor).toBe(0);
    expect(tut!.entryCost).toBe(0);
  });

  it("boss health increases with tier", () => {
    for (let i = 1; i < REGION_1_BOSSES.length; i++) {
      expect(REGION_1_BOSSES[i].health).toBeGreaterThan(REGION_1_BOSSES[i - 1].health);
    }
  });

  it("each boss phase has recommended counters", () => {
    for (const boss of REGION_1_BOSSES) {
      const hasCounters = boss.phases.some(
        (p) => p.recommendedCounters.length > 0
      );
      expect(hasCounters).toBe(true);
    }
  });

  it("Heap Guard has shield tag", () => {
    const heapGuard = REGION_1_BOSSES.find((b) => b.id === "heap_guard");
    expect(heapGuard).toBeDefined();
    expect(heapGuard!.tags).toContain("shield");
  });

  it("Rust Prophet has armor and repair tags", () => {
    const rustProphet = REGION_1_BOSSES.find((b) => b.id === "rust_prophet");
    expect(rustProphet).toBeDefined();
    expect(rustProphet!.tags).toContain("armor");
    expect(rustProphet!.tags).toContain("repair");
  });

  it("Scrap Bishop is multi-phase with shield, armor, enrage", () => {
    const sb = REGION_1_BOSSES.find((b) => b.id === "scrap_bishop");
    expect(sb).toBeDefined();
    expect(sb!.tags).toContain("multiPhase");
    expect(sb!.tags).toContain("shield");
    expect(sb!.tags).toContain("armor");
    expect(sb!.tags).toContain("enrage");
    expect(sb!.phases).toHaveLength(3);
  });
});

// â”€â”€ Boss Prep Simulation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("Boss Prep Simulation", () => {
  const shield = makeShield(400);

  it("Shock ammo improves win chance vs shield boss", () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === "heap_guard")!;
    const weapon = makeWeapon({
      baseDamage: 100,
      element: Element.Shock,
      weaponType: WeaponType.SMG,
      manufacturer: Manufacturer.Prismatek,
      shieldDamageMod: 1.3,
    });

    const noAmmo = simulateBoss({
      primary: weapon,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: 20,
      skillBonuses: {},
    });

    const withShockAmmo = simulateBoss({
      primary: weapon,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield,
      classMod: null,
      relic: null,
      consumables: { ShockAmmo: 1 },
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: 20,
      skillBonuses: {},
    });

    expect(withShockAmmo.breakScore).toBeGreaterThan(noAmmo.breakScore);
  });

  it("Corrosive ammo improves win chance vs armor boss", () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === "rust_prophet")!;
    const weapon = makeWeapon({
      baseDamage: 120,
      element: Element.Corrosive,
      weaponType: WeaponType.Launcher,
      manufacturer: Manufacturer.BlastForge,
      armorDamageMod: 1.4,
    });

    const noAmmo = simulateBoss({
      primary: weapon,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: 40,
      skillBonuses: {},
    });

    const withCorrosive = simulateBoss({
      primary: weapon,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield,
      classMod: null,
      relic: null,
      consumables: { CorrosiveAmmo: 1 },
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: 40,
      skillBonuses: {},
    });

    expect(withCorrosive.breakScore).toBeGreaterThan(noAmmo.breakScore);
  });

  it("Dune Tyrant is beatable by a basic loadout", () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === "dune_tyrant")!;
    const weapon = makeWeapon({
      baseDamage: 40,
      element: Element.Kinetic,
      weaponType: WeaponType.Pistol,
      manufacturer: Manufacturer.Redline,
    });

    const sim = simulateBoss({
      primary: weapon,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: makeShield(200),
      classMod: null,
      relic: null,
      consumables: { MedKit: 1 },
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: 5,
      skillBonuses: {},
    });

    expect(sim.winChance).toBeGreaterThan(0.5);
  });

  it("deterministic simulation returns same result for same input", () => {
    const boss = REGION_1_BOSSES[0];
    const weapon = makeWeapon({
      baseDamage: 50,
      element: Element.Kinetic,
      weaponType: WeaponType.Pistol,
      manufacturer: Manufacturer.Redline,
    });

    const input = {
      primary: weapon,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: makeShield(200),
      classMod: null,
      relic: null,
      consumables: {} as Record<string, number>,
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: 10,
      skillBonuses: {} as Record<string, number>,
    };

    const s1 = simulateBoss(input);
    const s2 = simulateBoss(input);
    expect(s1.winChance).toBe(s2.winChance);
  });
});

// â”€â”€ Crafting Recipes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("Crafting Recipes", () => {
  it("all recipes have positive craftTime and outputCount", () => {
    for (const r of CRAFTING_RECIPES) {
      expect(r.craftTimeMs).toBeGreaterThan(0);
      expect(r.outputCount).toBeGreaterThan(0);
      expect(Object.keys(r.materials).length).toBeGreaterThan(0);
    }
  });

  it("all recipe output consumables exist", () => {
    for (const r of CRAFTING_RECIPES) {
      const cons = CONSUMABLES[r.consumableType];
      expect(cons).toBeDefined();
    }
  });

  it("all recipe IDs are unique", () => {
    const ids = CRAFTING_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// â”€â”€ Legendary Effects â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("Legendary Effects", () => {
  it("25 legendary effects defined with unique IDs", () => {
    expect(LEGENDARY_EFFECTS).toHaveLength(25);
    const ids = LEGENDARY_EFFECTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(25);
  });

  it("each effect has name and description", () => {
    for (const eff of LEGENDARY_EFFECTS) {
      expect(eff.name.length).toBeGreaterThan(0);
      expect(eff.description.length).toBeGreaterThan(0);
    }
  });

  it("boss drop tables reference valid legendary effects", () => {
    const validIds = new Set(LEGENDARY_EFFECTS.map((e) => e.id));
    for (const boss of REGION_1_BOSSES) {
      for (const dropId of boss.dedicatedDrops) {
        expect(validIds.has(dropId)).toBe(true);
      }
    }
  });
});

// â”€â”€ Documentation Freshness â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("Documentation Freshness", () => {
  it("AGENTS.md exists and mentions MECHANICS.md", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const agentsPath = path.join(process.cwd(), "AGENTS.md");
    const exists = fs.existsSync(agentsPath);
    expect(exists).toBe(true);
    const content = fs.readFileSync(agentsPath, "utf8");
    expect(content).toContain("MECHANICS.md");
    expect(content).toContain("documentation freshness");
  });

  it("MECHANICS.md exists and mentions implemented status", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const mechPath = path.join(process.cwd(), "MECHANICS.md");
    const exists = fs.existsSync(mechPath);
    expect(exists).toBe(true);
    const content = fs.readFileSync(mechPath, "utf8");
    expect(content).toContain("implemented");
  });
});