import { SkillTreeType } from '../types/game';
import { SkillNode } from '../types/skill';

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
  { id: 'gs_major_1', tree: SkillTreeType.Gunslinger, tier: 7, index: 1, name: 'Focus Fire', description: '+15% Boss Damage when using Sniper or Pistol.', type: 'major', maxPoints: 1, cost: 3, effects: { bossDamageSniperPistol: 0.15 }, requires: ['gs_boss_1', 'gs_boss_2'] },
  { id: 'gs_major_2', tree: SkillTreeType.Gunslinger, tier: 7, index: 2, name: 'Speedloader', description: '+20% Attack Speed for first 10 seconds of boss fight.', type: 'major', maxPoints: 1, cost: 3, effects: { openingAttackSpeed: 0.20 }, requires: ['gs_speed_1', 'gs_speed_2'] },
  { id: 'gs_major_3', tree: SkillTreeType.Gunslinger, tier: 8, index: 1, name: 'Weakspot Analysis', description: '+25% Crit Damage against bosses below 50% HP.', type: 'major', maxPoints: 1, cost: 3, effects: { critDamageSub50: 0.25 }, requires: ['gs_critdmg_1', 'gs_critdmg_2'] },
  { id: 'gs_major_4', tree: SkillTreeType.Gunslinger, tier: 8, index: 2, name: 'Elemental Overclock', description: 'Equipping a weapon matching the boss weakness grants +10% overall damage.', type: 'major', maxPoints: 1, cost: 3, effects: { weaknessMatchDamage: 0.10 }, requires: ['gs_status_1'] },
  // Keystone
  { id: 'gs_keystone', tree: SkillTreeType.Gunslinger, tier: 9, index: 1, name: 'Death by a Thousand Cuts', description: 'Critical hits increase the DPS check score by an additional +25%. If crit chance exceeds 50%, gain +10% boss damage.', type: 'keystone', maxPoints: 1, cost: 5, effects: { critDpsBonus: 0.25, highCritBossDamage: 0.10 }, requires: ['gs_major_1', 'gs_major_2', 'gs_major_3'] },

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
  // Major
  { id: 'demo_major_1', tree: SkillTreeType.Demolition, tier: 7, index: 1, name: 'Breaching Charge', description: 'Ordnance attacks strip an additional 20% shield before DPS phase.', type: 'major', maxPoints: 1, cost: 3, effects: { shieldStripBonus: 0.20 }, requires: ['demo_shield_1', 'demo_ord_1'] },
  { id: 'demo_major_2', tree: SkillTreeType.Demolition, tier: 7, index: 2, name: 'Concussive Payload', description: 'Stagger effects last 30% longer and reduce boss damage output by 15% while active.', type: 'major', maxPoints: 1, cost: 3, effects: { staggerDuration: 0.30, staggerMitigation: 0.15 }, requires: ['demo_stag_1', 'demo_stag_2'] },
  { id: 'demo_major_3', tree: SkillTreeType.Demolition, tier: 8, index: 1, name: 'Scorched Earth', description: 'If you bring a Launcher as Heavy Weapon, gain +20% armor break and +10% boss DPS.', type: 'major', maxPoints: 1, cost: 3, effects: { launcherArmorBreak: 0.20, launcherBossDps: 0.10 }, requires: ['demo_armor_1', 'demo_armor_2'] },
  { id: 'demo_major_4', tree: SkillTreeType.Demolition, tier: 8, index: 2, name: 'Cluster Bombs', description: 'Ordnance has a 25% chance to trigger twice (second trigger at 50% damage).', type: 'major', maxPoints: 1, cost: 3, effects: { clusterChance: 0.25, clusterDamage: 0.50 }, requires: ['demo_exp_1', 'demo_exp_2'] },
  // Keystone
  { id: 'demo_keystone', tree: SkillTreeType.Demolition, tier: 9, index: 1, name: 'Unstable Power', description: 'Explosive damage contributes directly to Armor Break check. When armor is broken, next heavy weapon burst deals +50% damage.', type: 'keystone', maxPoints: 1, cost: 5, effects: { explosiveArmorBreak: 1.0, brokenArmorHeavyBonus: 0.50 }, requires: ['demo_major_1', 'demo_major_2', 'demo_major_3'] },

  // ========== SCAVENGER TREE ==========
  { id: 'scav_idle_1', tree: SkillTreeType.Scavenger, tier: 1, index: 1, name: 'Uplink Tap', description: '+15% Offline Earnings', type: 'small', maxPoints: 5, cost: 1, effects: { offlineEarnings: 0.15 } },
  { id: 'scav_idle_2', tree: SkillTreeType.Scavenger, tier: 1, index: 2, name: 'Background Processes', description: '+15% Offline Earnings', type: 'small', maxPoints: 5, cost: 1, effects: { offlineEarnings: 0.15 } },
  { id: 'scav_drop_1', tree: SkillTreeType.Scavenger, tier: 2, index: 1, name: 'Data Miner', description: '+10% Rare Drop Chance', type: 'small', maxPoints: 5, cost: 1, effects: { rareDropChance: 0.10 } },
  { id: 'scav_drop_2', tree: SkillTreeType.Scavenger, tier: 2, index: 2, name: 'Scrap Filter', description: '+10% Rare Drop Chance', type: 'small', maxPoints: 5, cost: 1, effects: { rareDropChance: 0.10 } },
  { id: 'scav_qty_1', tree: SkillTreeType.Scavenger, tier: 3, index: 1, name: 'Bulk Transfer', description: '+10% Loot Quantity', type: 'small', maxPoints: 5, cost: 1, effects: { lootQuantity: 0.10 } },
  { id: 'scav_qty_2', tree: SkillTreeType.Scavenger, tier: 3, index: 2, name: 'Parallel Download', description: '+10% Loot Quantity', type: 'small', maxPoints: 5, cost: 1, effects: { lootQuantity: 0.10 } },
  { id: 'scav_scrap_1', tree: SkillTreeType.Scavenger, tier: 4, index: 1, name: 'Decompiler', description: '+20% Scrap Yield', type: 'small', maxPoints: 5, cost: 1, effects: { scrapYield: 0.20 } },
  { id: 'scav_scrap_2', tree: SkillTreeType.Scavenger, tier: 4, index: 2, name: 'Compression', description: '+20% Scrap Yield', type: 'small', maxPoints: 5, cost: 1, effects: { scrapYield: 0.20 } },
  { id: 'scav_cons_1', tree: SkillTreeType.Scavenger, tier: 5, index: 1, name: 'Efficient Routines', description: '+10% Consumable Efficiency', type: 'small', maxPoints: 5, cost: 1, effects: { consumableEfficiency: 0.10 } },
  { id: 'scav_cons_2', tree: SkillTreeType.Scavenger, tier: 5, index: 2, name: 'Conservation', description: '+10% Consumable Efficiency', type: 'small', maxPoints: 5, cost: 1, effects: { consumableEfficiency: 0.10 } },
  { id: 'scav_cache_1', tree: SkillTreeType.Scavenger, tier: 6, index: 1, name: 'Encrypted Payloads', description: '+5% Cache Quality Modifier', type: 'small', maxPoints: 5, cost: 1, effects: { cacheQuality: 0.05 } },
  { id: 'scav_fee_1', tree: SkillTreeType.Scavenger, tier: 6, index: 2, name: 'Darknet Broker', description: '+5% Marketplace Listing Fee Reduction', type: 'small', maxPoints: 5, cost: 1, effects: { marketFeeReduction: 0.05 } },
  // Major
  { id: 'scav_major_1', tree: SkillTreeType.Scavenger, tier: 7, index: 1, name: 'Hoarder\'s Instinct', description: 'Salvaging gear grants +25% bonus scrap.', type: 'major', maxPoints: 1, cost: 3, effects: { salvageBonus: 0.25 }, requires: ['scav_scrap_1', 'scav_scrap_2'] },
  { id: 'scav_major_2', tree: SkillTreeType.Scavenger, tier: 7, index: 2, name: 'Insurance Fraud', description: 'Consumables used in a victorious boss fight have a 50% chance to be refunded.', type: 'major', maxPoints: 1, cost: 3, effects: { consumableRecovery: 0.50 }, requires: ['scav_cons_1', 'scav_cons_2'] },
  { id: 'scav_major_3', tree: SkillTreeType.Scavenger, tier: 8, index: 1, name: 'Market Manipulator', description: 'Listing fees reduced an additional 15% for items you personally found.', type: 'major', maxPoints: 1, cost: 3, effects: { foundItemFeeReduction: 0.15 }, requires: ['scav_fee_1'] },
  { id: 'scav_major_4', tree: SkillTreeType.Scavenger, tier: 8, index: 2, name: 'Lucky Find', description: '+15% Rare Drop Chance.', type: 'major', maxPoints: 1, cost: 3, effects: { rareDropChance: 0.15 }, requires: ['scav_drop_1', 'scav_drop_2'] },
  // Keystone
  { id: 'scav_keystone', tree: SkillTreeType.Scavenger, tier: 9, index: 1, name: 'King of Scrap', description: 'Low-rarity weapons gain +100% scrap value. Commons have 25% chance for bonus crafting material. Offline cap +4 hours.', type: 'keystone', maxPoints: 1, cost: 5, effects: { lowRarityScrapBonus: 1.0, commonMaterialChance: 0.25, offlineCapBonus: 4 }, requires: ['scav_major_1', 'scav_major_2', 'scav_major_4'] },
];

export const MAX_SKILL_POINTS = 50; // total points available to spend
export const POINTS_PER_LEVEL = 1; // gain 1 per level, starting at level 2 maybe
export function getSkillTreeNodes(tree: SkillTreeType): SkillNode[] {
  return SKILL_NODES.filter((n) => n.tree === tree);
}
