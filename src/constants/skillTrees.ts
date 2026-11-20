import { SkillTreeType } from '../types/game';
import { type SkillNode } from '../types/skill';

export const SKILL_NODES: SkillNode[] = [
  // ========== GUNSLINGER TREE ==========
  { id: 'gs_dmg_1', tree: SkillTreeType.Gunslinger, tier: 1, index: 1, name: 'Calibrated Iron', description: '+5% Weapon Damage', type: 'small', maxPoints: 5, cost: 1, effects: { weaponDamage: 0.05 } },
  { id: 'gs_dmg_2', tree: SkillTreeType.Gunslinger, tier: 1, index: 2, name: 'Heavy Slugs', description: '+5% Weapon Damage', type: 'small', maxPoints: 5, cost: 1, effects: { weaponDamage: 0.05 } },
  { id: 'gs_crit_1', tree: SkillTreeType.Gunslinger, tier: 2, index: 1, name: 'Steady Hand', description: '+3% Crit Chance', type: 'small', maxPoints: 5, cost: 1, effects: { critChance: 0.03 } },
  { id: 'gs_crit_2', tree: SkillTreeType.Gunslinger, tier: 2, index: 2, name: 'Weakspot Training', description: '+3% Crit Chance', type: 'small', maxPoints: 5, cost: 1, effects: { critChance: 0.03 } },
  { id: 'gs_critdmg_1', tree: SkillTreeType.Gunslinger, tier: 3, index: 1, name: 'Terminal Ballistics', description: '+10% Crit Damage', type: 'small', maxPoints: 5, cost: 1, effects: { critDamage: 0.10 } },
  { id: 'gs_critdmg_2', tree: SkillTreeType.Gunslinger, tier: 3, index: 2, name: 'Overpenetration', description: '+10% Crit Damage', type: 'small', maxPoints: 5, cost: 1, effects: { critDamage: 0.10 } },
  { id: 'gs_speed_1', tree: SkillTreeType.Gunslinger, tier: 4, index: 1, name: 'Quick Cycle', description: '+8% Attack Speed', type: 'small', maxPoints: 5, cost: 1, effects: { attackSpeed: 0.08 } },
  { id: 'gs_speed_2', tree: SkillTreeType.Gunslinger, tier: 4, index: 2, name: 'Rapid Servos', description: '+8% Attack Speed', type: 'small', maxPoints: 5, cost: 1, effects: { attackSpeed: 0.08 } },
  { id: 'gs_boss_1', tree: SkillTreeType.Gunslinger, tier: 5, index: 1, name: 'Target Priority', description: '+10% Boss Damage', type: 'small', maxPoints: 5, cost: 1, effects: { bossDamageMod: 0.10 } },
  { id: 'gs_boss_2', tree: SkillTreeType.Gunslinger, tier: 5, index: 2, name: 'High-Value Execution', description: '+10% Boss Damage', type: 'small', maxPoints: 5, cost: 1, effects: { bossDamageMod: 0.10 } },
  { id: 'gs_status_1', tree: SkillTreeType.Gunslinger, tier: 6, index: 1, name: 'Procedural Loads', description: '+5% Status Chance', type: 'small', maxPoints: 5, cost: 1, effects: { statusChance: 0.05 } },
  { id: 'gs_shield_1', tree: SkillTreeType.Gunslinger, tier: 6, index: 2, name: 'Shield Breach', description: '+5% Shield Damage', type: 'small', maxPoints: 5, cost: 1, effects: { shieldDamageMod: 0.05 } },
  // Major
  { id: 'gs_major_1', tree: SkillTreeType.Gunslinger, tier: 7, index: 1, name: 'Focus Fire', description: '+15% Boss Damage when using Sniper or Pistol. Pick a spot. End the argument.', type: 'major', maxPoints: 1, cost: 3, effects: { bossDamageSniperPistol: 0.15 }, requires: ['gs_boss_1', 'gs_boss_2'] },
  { id: 'gs_major_2', tree: SkillTreeType.Gunslinger, tier: 7, index: 2, name: 'Speedloader', description: '+20% Attack Speed for the first 10 seconds of a boss fight. Say hello properly.', type: 'major', maxPoints: 1, cost: 3, effects: { openingAttackSpeed: 0.20 }, requires: ['gs_speed_1', 'gs_speed_2'] },
  { id: 'gs_major_3', tree: SkillTreeType.Gunslinger, tier: 8, index: 1, name: 'Weakspot Analysis', description: '+25% Crit Damage against bosses below 50% HP. Finish what you started.', type: 'major', maxPoints: 1, cost: 3, effects: { critDamageSub50: 0.25 }, requires: ['gs_critdmg_1', 'gs_critdmg_2'] },
  { id: 'gs_major_4', tree: SkillTreeType.Gunslinger, tier: 8, index: 2, name: 'Elemental Overclock', description: 'A weapon matching the boss\'s weakness grants +10% damage. Homework pays.', type: 'major', maxPoints: 1, cost: 3, effects: { weaknessMatchDamage: 0.10 }, requires: ['gs_status_1'] },
  // Growth branch — "Long Hunt" (reshape slice (a), brief §2.1): the
  // roaming sprinkle. Consumed keys only (statusChance /
  // shieldDamageMod / attackSpeed second pairs + a major on the same
  // keys) — 23 points, so the tree (100) stays above the 99 budget.
  { id: 'gs_status_2', tree: SkillTreeType.Gunslinger, tier: 5, index: 3, name: 'Tracer Loads', description: '+5% Status Chance', type: 'small', maxPoints: 5, cost: 1, effects: { statusChance: 0.05 } },
  { id: 'gs_shield_2', tree: SkillTreeType.Gunslinger, tier: 6, index: 3, name: 'Breaching Loads', description: '+5% Shield Damage', type: 'small', maxPoints: 5, cost: 1, effects: { shieldDamageMod: 0.05 } },
  { id: 'gs_speed_3', tree: SkillTreeType.Gunslinger, tier: 4, index: 3, name: 'Fast Hands', description: '+8% Attack Speed', type: 'small', maxPoints: 5, cost: 1, effects: { attackSpeed: 0.08 } },
  { id: 'gs_speed_4', tree: SkillTreeType.Gunslinger, tier: 3, index: 3, name: 'Hair Trigger', description: '+8% Attack Speed', type: 'small', maxPoints: 5, cost: 1, effects: { attackSpeed: 0.08 } },
  { id: 'gs_major_5', tree: SkillTreeType.Gunslinger, tier: 8, index: 3, name: 'The Long Hunt', description: '+15% Shield Damage and +10% Status Chance — the roaming hunter’s edge.', type: 'major', maxPoints: 1, cost: 3, effects: { shieldDamageMod: 0.15, statusChance: 0.10 }, requires: ['gs_status_2', 'gs_shield_2'] },
  // Keystone
  { id: 'gs_keystone', tree: SkillTreeType.Gunslinger, tier: 9, index: 1, name: 'Death by a Thousand Cuts', description: 'Critical hits increase your DPS by an additional +25%. If crit chance exceeds 50%, gain +10% boss damage. Death by a thousand cuts, itemized.', type: 'keystone', maxPoints: 1, cost: 5, effects: { critDpsBonus: 0.25, highCritBossDamage: 0.10 }, requires: ['gs_major_1', 'gs_major_2', 'gs_major_3'] },

  // ========== DEMOLITION TREE ==========
  { id: 'demo_ord_1', tree: SkillTreeType.Demolition, tier: 1, index: 1, name: 'Payload Expansion', description: '+10% Ordnance Damage', type: 'small', maxPoints: 5, cost: 1, effects: { ordnanceDamage: 0.10 } },
  { id: 'demo_ord_2', tree: SkillTreeType.Demolition, tier: 1, index: 2, name: 'Fragmentation', description: '+10% Ordnance Damage', type: 'small', maxPoints: 5, cost: 1, effects: { ordnanceDamage: 0.10 } },
  { id: 'demo_exp_1', tree: SkillTreeType.Demolition, tier: 2, index: 1, name: 'Volatile Mix', description: '+8% Explosive Damage', type: 'small', maxPoints: 5, cost: 1, effects: { explosiveDamage: 0.08 } },
  { id: 'demo_exp_2', tree: SkillTreeType.Demolition, tier: 2, index: 2, name: 'Blast Radius', description: '+8% Explosive Damage', type: 'small', maxPoints: 5, cost: 1, effects: { explosiveDamage: 0.08 } },
  { id: 'demo_armor_1', tree: SkillTreeType.Demolition, tier: 3, index: 1, name: 'Penetrator Rounds', description: '+10% Armor Damage', type: 'small', maxPoints: 5, cost: 1, effects: { armorDamageMod: 0.10 } },
  { id: 'demo_armor_2', tree: SkillTreeType.Demolition, tier: 3, index: 2, name: 'Crack Core', description: '+10% Armor Damage', type: 'small', maxPoints: 5, cost: 1, effects: { armorDamageMod: 0.10 } },
  { id: 'demo_stag_1', tree: SkillTreeType.Demolition, tier: 4, index: 1, name: 'Concussion', description: '+5% Stagger Chance', type: 'small', maxPoints: 5, cost: 1, effects: { staggerChance: 0.05 } },
  { id: 'demo_stag_2', tree: SkillTreeType.Demolition, tier: 4, index: 2, name: 'Impact Force', description: '+5% Stagger Chance', type: 'small', maxPoints: 5, cost: 1, effects: { staggerChance: 0.05 } },
  { id: 'demo_heavy_1', tree: SkillTreeType.Demolition, tier: 5, index: 1, name: 'Overcharge', description: '+15% Heavy Weapon Burst', type: 'small', maxPoints: 5, cost: 1, effects: { heavyWeaponBurst: 0.15 } },
  { id: 'demo_heavy_2', tree: SkillTreeType.Demolition, tier: 5, index: 2, name: 'Siege Mode', description: '+15% Heavy Weapon Burst', type: 'small', maxPoints: 5, cost: 1, effects: { heavyWeaponBurst: 0.15 } },
  { id: 'demo_shield_1', tree: SkillTreeType.Demolition, tier: 6, index: 1, name: 'Ion Surge', description: '+10% Shield Break Contribution from Ordnance', type: 'small', maxPoints: 5, cost: 1, effects: { ordnanceShieldBreak: 0.10 } },
  // Parity top-up (reshape slice (a), brief §2.1): Demolition shipped
  // 5 points light (72 vs 77); this second ordnanceShieldBreak node
  // completes the pair on an already-consumed key — all four trees
  // now cost 77 before growth.
  { id: 'demo_shield_2', tree: SkillTreeType.Demolition, tier: 6, index: 2, name: 'Ion Cascade', description: '+10% Shield Break Contribution from Ordnance', type: 'small', maxPoints: 5, cost: 1, effects: { ordnanceShieldBreak: 0.10 } },
  // Growth branch — field-ordnance sprinkle (brief §2.1): Workshop
  // craft-time for the ordnance Silas lives on, on the consumed
  // consumableEfficiency key at sprinkle size — 25 points.
  { id: 'demo_cons_1', tree: SkillTreeType.Demolition, tier: 1, index: 3, name: 'Field Kitchen', description: 'Craft jobs run faster: unit time falls in 2% steps across the five supply nodes — up to −20% with all five maxed. Set when the job is queued — no take-backs.', type: 'small', maxPoints: 5, cost: 1, effects: { consumableEfficiency: 0.04 } },
  { id: 'demo_cons_2', tree: SkillTreeType.Demolition, tier: 2, index: 3, name: 'Powder Stores', description: 'Craft jobs run faster: unit time falls in 2% steps across the five supply nodes — up to −20% with all five maxed. Set when the job is queued — no take-backs.', type: 'small', maxPoints: 5, cost: 1, effects: { consumableEfficiency: 0.04 } },
  { id: 'demo_cons_3', tree: SkillTreeType.Demolition, tier: 3, index: 3, name: 'Grease and Wicks', description: 'Craft jobs run faster: unit time falls in 2% steps across the five supply nodes — up to −20% with all five maxed. Set when the job is queued — no take-backs.', type: 'small', maxPoints: 5, cost: 1, effects: { consumableEfficiency: 0.04 } },
  { id: 'demo_cons_4', tree: SkillTreeType.Demolition, tier: 4, index: 3, name: 'Spares Cache', description: 'Craft jobs run faster: unit time falls in 2% steps across the five supply nodes — up to −20% with all five maxed. Set when the job is queued — no take-backs.', type: 'small', maxPoints: 5, cost: 1, effects: { consumableEfficiency: 0.04 } },
  { id: 'demo_cons_5', tree: SkillTreeType.Demolition, tier: 5, index: 3, name: 'Forward Stockpile', description: 'Craft jobs run faster: unit time falls in 2% steps across the five supply nodes — up to −20% with all five maxed. Set when the job is queued — no take-backs.', type: 'small', maxPoints: 5, cost: 1, effects: { consumableEfficiency: 0.04 } },
  // Major
  { id: 'demo_major_1', tree: SkillTreeType.Demolition, tier: 7, index: 1, name: 'Breaching Charge', description: 'Ordnance strips an additional 20% shield before the DPS phase. Knock first. Loudly.', type: 'major', maxPoints: 1, cost: 3, effects: { shieldStripBonus: 0.20 }, requires: ['demo_shield_1', 'demo_ord_1'] },
  { id: 'demo_major_2', tree: SkillTreeType.Demolition, tier: 7, index: 2, name: 'Concussive Payload', description: 'Stagger effects last 30% longer and reduce boss damage output by 15% while active. Keep them wobbling.', type: 'major', maxPoints: 1, cost: 3, effects: { staggerDuration: 0.30, staggerMitigation: 0.15 }, requires: ['demo_stag_1', 'demo_stag_2'] },
  { id: 'demo_major_3', tree: SkillTreeType.Demolition, tier: 8, index: 1, name: 'Scorched Earth', description: 'If you bring a Launcher as Heavy Weapon, gain +20% armor break and +10% boss DPS. Subtlety not included.', type: 'major', maxPoints: 1, cost: 3, effects: { launcherArmorBreak: 0.20, launcherBossDps: 0.10 }, requires: ['demo_armor_1', 'demo_armor_2'] },
  { id: 'demo_major_4', tree: SkillTreeType.Demolition, tier: 8, index: 2, name: 'Cluster Bombs', description: 'Ordnance has a 25% chance to trigger twice (second trigger at 50% damage). Two booms for the price of one.', type: 'major', maxPoints: 1, cost: 3, effects: { clusterChance: 0.25, clusterDamage: 0.50 }, requires: ['demo_exp_1', 'demo_exp_2'] },
  // Keystone
  { id: 'demo_keystone', tree: SkillTreeType.Demolition, tier: 9, index: 1, name: 'Unstable Power', description: 'Explosive damage counts toward Armor Break. When armor is broken, your next heavy weapon burst deals +50% damage. Unstable is the point.', type: 'keystone', maxPoints: 1, cost: 5, effects: { explosiveArmorBreak: 1.0, brokenArmorHeavyBonus: 0.50 }, requires: ['demo_major_1', 'demo_major_2', 'demo_major_3'] },

  // ========== SCAVENGER TREE ==========
  { id: 'scav_idle_1', tree: SkillTreeType.Scavenger, tier: 1, index: 1, name: 'Uplink Tap', description: '+15% Offline Earnings', type: 'small', maxPoints: 5, cost: 1, effects: { offlineEarnings: 0.15 } },
  { id: 'scav_idle_2', tree: SkillTreeType.Scavenger, tier: 1, index: 2, name: 'Background Processes', description: '+15% Offline Earnings', type: 'small', maxPoints: 5, cost: 1, effects: { offlineEarnings: 0.15 } },
  { id: 'scav_drop_1', tree: SkillTreeType.Scavenger, tier: 2, index: 1, name: 'Data Miner', description: '+10% Rare Drop Chance', type: 'small', maxPoints: 5, cost: 1, effects: { rareDropChance: 0.10 } },
  { id: 'scav_drop_2', tree: SkillTreeType.Scavenger, tier: 2, index: 2, name: 'Scrap Filter', description: '+10% Rare Drop Chance', type: 'small', maxPoints: 5, cost: 1, effects: { rareDropChance: 0.10 } },
  { id: 'scav_qty_1', tree: SkillTreeType.Scavenger, tier: 3, index: 1, name: 'Bulk Transfer', description: '+10% Loot Quantity', type: 'small', maxPoints: 5, cost: 1, effects: { lootQuantity: 0.10 } },
  { id: 'scav_qty_2', tree: SkillTreeType.Scavenger, tier: 3, index: 2, name: 'Parallel Download', description: '+10% Loot Quantity', type: 'small', maxPoints: 5, cost: 1, effects: { lootQuantity: 0.10 } },
  { id: 'scav_scrap_1', tree: SkillTreeType.Scavenger, tier: 4, index: 1, name: 'Decompiler', description: '+20% Scrap Yield', type: 'small', maxPoints: 5, cost: 1, effects: { scrapYield: 0.20 } },
  { id: 'scav_scrap_2', tree: SkillTreeType.Scavenger, tier: 4, index: 2, name: 'Compression', description: '+20% Scrap Yield', type: 'small', maxPoints: 5, cost: 1, effects: { scrapYield: 0.20 } },
  { id: 'scav_cons_1', tree: SkillTreeType.Scavenger, tier: 5, index: 1, name: 'Efficient Routines', description: 'Workshop craft jobs run faster: −2% unit time per point, set at queue time. Waste nothing, not even minutes.', type: 'small', maxPoints: 5, cost: 1, effects: { consumableEfficiency: 0.10 } },
  { id: 'scav_cons_2', tree: SkillTreeType.Scavenger, tier: 5, index: 2, name: 'Conservation', description: 'Workshop craft jobs run faster: −2% unit time per point (−20% across both nodes). Time is loot too.', type: 'small', maxPoints: 5, cost: 1, effects: { consumableEfficiency: 0.10 } },
  { id: 'scav_cache_1', tree: SkillTreeType.Scavenger, tier: 6, index: 1, name: 'Encrypted Payloads', description: '+5% Cache Quality Modifier', type: 'small', maxPoints: 5, cost: 1, effects: { cacheQuality: 0.05 } },
  { id: 'scav_fee_1', tree: SkillTreeType.Scavenger, tier: 6, index: 2, name: 'Darknet Broker', description: '+5% Marketplace Listing Fee Reduction', type: 'small', maxPoints: 5, cost: 1, effects: { marketFeeReduction: 0.05 } },
  // Major
  { id: 'scav_major_1', tree: SkillTreeType.Scavenger, tier: 7, index: 1, name: 'Hoarder\'s Instinct', description: 'Salvaging gear grants +25% bonus scrap. One hunter\'s trash is your income.', type: 'major', maxPoints: 1, cost: 3, effects: { salvageBonus: 0.25 }, requires: ['scav_scrap_1', 'scav_scrap_2'] },
  { id: 'scav_major_2', tree: SkillTreeType.Scavenger, tier: 7, index: 2, name: 'Fine Print', description: 'Consumables used in a victorious boss fight have a 50% chance to be refunded. Read the fine print; it pays.', type: 'major', maxPoints: 1, cost: 3, effects: { consumableRecovery: 0.50 }, requires: ['scav_cons_1', 'scav_cons_2'] },
  { id: 'scav_major_3', tree: SkillTreeType.Scavenger, tier: 8, index: 1, name: 'Market Manipulator', description: 'Listing fees reduced an additional 15% for items you personally found. The market bends for its own.', type: 'major', maxPoints: 1, cost: 3, effects: { foundItemFeeReduction: 0.15 }, requires: ['scav_fee_1'] },
  { id: 'scav_major_4', tree: SkillTreeType.Scavenger, tier: 8, index: 2, name: 'Lucky Find', description: '+15% Rare Drop Chance. Luck, allegedly earned.', type: 'major', maxPoints: 1, cost: 3, effects: { rareDropChance: 0.15 }, requires: ['scav_drop_1', 'scav_drop_2'] },
  // Growth branch — opportunist combat sprinkle (reshape slice (a),
  // brief §2.1): weaponDamage / critChance pairs + a critDamage node,
  // consumed keys only — 25 points, so the tree (102) stays above the
  // 99 budget.
  { id: 'scav_wpn_1', tree: SkillTreeType.Scavenger, tier: 1, index: 3, name: 'Borrowed Caliber', description: '+5% Weapon Damage', type: 'small', maxPoints: 5, cost: 1, effects: { weaponDamage: 0.05 } },
  { id: 'scav_wpn_2', tree: SkillTreeType.Scavenger, tier: 2, index: 3, name: 'Found Ammunition', description: '+5% Weapon Damage', type: 'small', maxPoints: 5, cost: 1, effects: { weaponDamage: 0.05 } },
  { id: 'scav_crit_1', tree: SkillTreeType.Scavenger, tier: 3, index: 3, name: 'Opportunist', description: '+3% Crit Chance', type: 'small', maxPoints: 5, cost: 1, effects: { critChance: 0.03 } },
  { id: 'scav_crit_2', tree: SkillTreeType.Scavenger, tier: 4, index: 3, name: 'Cheap Shot', description: '+3% Crit Chance', type: 'small', maxPoints: 5, cost: 1, effects: { critChance: 0.03 } },
  { id: 'scav_critdmg_1', tree: SkillTreeType.Scavenger, tier: 5, index: 3, name: 'Soft Spot', description: '+10% Crit Damage', type: 'small', maxPoints: 5, cost: 1, effects: { critDamage: 0.10 } },
  // Keystone
  { id: 'scav_keystone', tree: SkillTreeType.Scavenger, tier: 9, index: 1, name: 'King of Scrap', description: 'Low-rarity weapons gain +100% scrap value. Commons have a 25% chance for bonus crafting material. Offline cap +4 hours. Long live the King of Scrap.', type: 'keystone', maxPoints: 1, cost: 5, effects: { lowRarityScrapBonus: 1.0, commonMaterialChance: 0.25, offlineCapBonus: 4 }, requires: ['scav_major_1', 'scav_major_2', 'scav_major_4'] },

  // ========== FIXER TREE (migration 0029) ==========
  // The support/economy tree: every effect is consumed server-side by
  // the Workshop, the repair board, the vehicle tick, the vendor, or
  // the market fee — registered in src/lib/skills/skillConsumers.ts
  // and pinned by src/test/keystoneSkillLayer.test.ts (zero dead
  // keys). Bonuses derive from profiles.skill_spends + the equipped
  // class mod through computeSkillBonuses, never from a request body.
  { id: 'fix_craft_time_1', tree: SkillTreeType.Fixer, tier: 1, index: 1, name: 'Assembly Rhythm', description: 'Workshop craft jobs run faster: −2.5% unit time per point, set at queue time. Doc\'s benches do not dawdle.', type: 'small', maxPoints: 5, cost: 1, effects: { craftSpeedBonus: 0.025 } },
  { id: 'fix_craft_time_2', tree: SkillTreeType.Fixer, tier: 1, index: 2, name: 'Parallel Hands', description: 'Workshop craft jobs run faster: −2.5% unit time per point (−25% across both nodes). Many hands, faster work.', type: 'small', maxPoints: 5, cost: 1, effects: { craftSpeedBonus: 0.025 } },
  { id: 'fix_quality_1', tree: SkillTreeType.Fixer, tier: 2, index: 1, name: 'Calibrated Eye', description: '+1 crafted quality shift per point, counted when a unit completes. Doc checks. Twice.', type: 'small', maxPoints: 5, cost: 1, effects: { craftQualityBonus: 1.0 } },
  { id: 'fix_quality_2', tree: SkillTreeType.Fixer, tier: 2, index: 2, name: 'Tolerance Stacking', description: '+1 crafted quality shift per point (+10 across both nodes). Precision is a personality trait.', type: 'small', maxPoints: 5, cost: 1, effects: { craftQualityBonus: 1.0 } },
  { id: 'fix_repair_speed_1', tree: SkillTreeType.Fixer, tier: 3, index: 1, name: 'Torque Discipline', description: 'Repair work runs faster: −3% unit time per point, set when the job starts. Broken things fear this node.', type: 'small', maxPoints: 5, cost: 1, effects: { repairSpeedBonus: 0.03 } },
  { id: 'fix_repair_speed_2', tree: SkillTreeType.Fixer, tier: 3, index: 2, name: 'Bay Choreography', description: 'Repair work runs faster: −3% unit time per point (−30% across both nodes). The bay runs like a dance.', type: 'small', maxPoints: 5, cost: 1, effects: { repairSpeedBonus: 0.03 } },
  { id: 'fix_repair_eff_1', tree: SkillTreeType.Fixer, tier: 4, index: 1, name: 'Kit Stretching', description: 'Patch kits restore +2.5% more condition per point (multiplies repair efficiency). Stretch every kit further.', type: 'small', maxPoints: 5, cost: 1, effects: { repairEfficiencyBonus: 0.025 } },
  { id: 'fix_repair_eff_2', tree: SkillTreeType.Fixer, tier: 4, index: 2, name: 'Salvage Solder', description: 'Patch kits restore +2.5% more condition per point (+25% across both nodes). Nothing wasted, ever.', type: 'small', maxPoints: 5, cost: 1, effects: { repairEfficiencyBonus: 0.025 } },
  { id: 'fix_vehicle_yield_1', tree: SkillTreeType.Fixer, tier: 5, index: 1, name: 'Rig Tuning', description: '+2% vehicle yield per point (stacks with yield affixes). Tuned to a purr.', type: 'small', maxPoints: 5, cost: 1, effects: { vehicleYieldBonus: 0.02 } },
  { id: 'fix_vehicle_yield_2', tree: SkillTreeType.Fixer, tier: 5, index: 2, name: 'Aero Fairings', description: '+2% vehicle yield bonus per point (+20% across both nodes). Fairings: because air is rude.', type: 'small', maxPoints: 5, cost: 1, effects: { vehicleYieldBonus: 0.02 } },
  { id: 'fix_vehicle_fuel_1', tree: SkillTreeType.Fixer, tier: 6, index: 1, name: 'Lean Burn', description: 'Vehicles burn −3% fuel per point, after fuel-efficiency affixes. Sip, do not gulp.', type: 'small', maxPoints: 5, cost: 1, effects: { vehicleFuelBonus: 0.03 } },
  { id: 'fix_vendor_1', tree: SkillTreeType.Fixer, tier: 6, index: 2, name: "Appraiser's Eye", description: '+1% vendor buyback rate per point. Buyback rate caps at 90%. Marla respects the hustle.', type: 'small', maxPoints: 5, cost: 1, effects: { vendorBuybackBonus: 0.01 } },
  // Major
  { id: 'fix_major_1', tree: SkillTreeType.Fixer, tier: 7, index: 1, name: 'Master Artificer', description: 'Crafted gear temper chance +5%. The bench provides.', type: 'major', maxPoints: 1, cost: 3, effects: { craftTemperBonus: 0.05 }, requires: ['fix_quality_1', 'fix_quality_2'] },
  { id: 'fix_major_2', tree: SkillTreeType.Fixer, tier: 7, index: 2, name: 'Fleet Engineer', description: 'Vehicles lose 25% less condition while fueled. Built to outlast the road.', type: 'major', maxPoints: 1, cost: 3, effects: { vehicleDecayReduction: 0.25 }, requires: ['fix_vehicle_yield_1', 'fix_vehicle_yield_2'] },
  { id: 'fix_major_3', tree: SkillTreeType.Fixer, tier: 8, index: 1, name: 'House Brand', description: 'Listing fees reduced an additional 15% for Workshop-crafted items you sell. House brand, house rules.', type: 'major', maxPoints: 1, cost: 3, effects: { craftedItemFeeReduction: 0.15 }, requires: ['fix_vendor_1'] },
  { id: 'fix_major_4', tree: SkillTreeType.Fixer, tier: 8, index: 2, name: 'Second Shift', description: '+1 concurrent self-repair job. Two bays, no waiting.', type: 'major', maxPoints: 1, cost: 3, effects: { bonusRepairJobs: 1 }, requires: ['fix_repair_speed_1', 'fix_repair_speed_2'] },
  // Growth branch — combat sprinkle (reshape slice (a), brief §2.1):
  // the Fixer builds the ordnance everyone else fires — small nodes
  // on consumed combat keys only — 25 points, so the tree (102)
  // stays above the 99 budget.
  { id: 'fix_ord_1', tree: SkillTreeType.Fixer, tier: 1, index: 3, name: 'Proof Loads', description: '+10% Ordnance Damage', type: 'small', maxPoints: 5, cost: 1, effects: { ordnanceDamage: 0.10 } },
  { id: 'fix_ord_2', tree: SkillTreeType.Fixer, tier: 2, index: 3, name: 'Bench-Tested', description: '+10% Ordnance Damage', type: 'small', maxPoints: 5, cost: 1, effects: { ordnanceDamage: 0.10 } },
  { id: 'fix_exp_1', tree: SkillTreeType.Fixer, tier: 3, index: 3, name: 'Measured Charge', description: '+8% Explosive Damage', type: 'small', maxPoints: 5, cost: 1, effects: { explosiveDamage: 0.08 } },
  { id: 'fix_armor_1', tree: SkillTreeType.Fixer, tier: 4, index: 3, name: 'Stress Points', description: '+10% Armor Damage', type: 'small', maxPoints: 5, cost: 1, effects: { armorDamageMod: 0.10 } },
  { id: 'fix_stag_1', tree: SkillTreeType.Fixer, tier: 5, index: 3, name: 'Loose Bolts', description: '+5% Stagger Chance', type: 'small', maxPoints: 5, cost: 1, effects: { staggerChance: 0.05 } },
  // Keystone
  { id: 'fix_keystone', tree: SkillTreeType.Fixer, tier: 9, index: 1, name: 'Sutter\'s Hands', description: 'Legendary Core Catalyst gear crafts gain +1 generation draw per unit. Each bench queue holds +1 job. Workshop Rush Ticket reduction cap rises to 55%. Sutter\'s hands never idle.', type: 'keystone', maxPoints: 1, cost: 5, effects: { coreCatalystDrawBonus: 1, workshopQueueBonus: 1, rushReductionCapBonus: 0.10 }, requires: ['fix_major_1', 'fix_major_2', 'fix_major_4'] },
];

// The point budget is NOT a constant: a player holds (level − 1)
// points, enforced server-side by cc_train_skill (migration 0004)
// against profiles.player_level, and mirrored by the client store.
// (The old MAX_SKILL_POINTS = 50 constant was dead and wrong — the
// lifetime budget at level 100 is 99 against 303 points of trees.
// Since reshape slice (a) the budget is PER HUNTER (each hunter's
// pool is capped at level − 1 in their own tree) and the trees grew
// to 406 points total — every tree still costs more than 99, so the
// forced-choice pressure holds per hunter.)
export const POINTS_PER_LEVEL = 1; // gain 1 per level, starting at level 2
export function getSkillTreeNodes(tree: SkillTreeType): SkillNode[] {
  return SKILL_NODES.filter((n) => n.tree === tree);
}
