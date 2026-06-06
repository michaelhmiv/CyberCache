import type { LegendaryEffectDef } from '../types/items';
import { DropSource } from '../types/game';

export const LEGENDARY_EFFECTS: LegendaryEffectDef[] = [
  {
    id: 'debt_collector',
    name: 'Debt Collector',
    description: 'Each failed attempt vs. the same boss grants +3% win chance next time, stacking to a cap of +30%.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 1,
  },
  {
    id: 'warranty_void',
    name: 'Warranty Void',
    description: 'Each failed boss attempt permanently increases this weapon\'s base damage by +2%, up to +20%.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 1,
  },
  {
    id: 'ricochet_gospel',
    name: 'Ricochet Gospel',
    description: 'Crits bounce to an additional target. Against a single boss, the bounce returns 40% damage.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 1,
  },
  {
    id: 'bad_decision',
    name: 'Bad Decision',
    description: 'Win chance estimate is hidden, but victory reward multiplier is +25%.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 1,
  },
  {
    id: 'glass_sun',
    name: 'Glass Sun',
    description: '+50% Fire damage, but -30% Shield effectiveness.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 1,
  },
  {
    id: 'the_accountant',
    name: 'The Accountant',
    description: 'Every 100 enemies defeated increases the rarity roll tier of your next drop by +1 stage.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 1,
  },
  {
    id: 'armor_eater',
    name: 'Armor Eater',
    description: 'Corrosive procs reduce boss repair/healing by 50% and grant +20% armor break contribution.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 1,
  },
  {
    id: 'thunder_receipt',
    name: 'Thunder Receipt',
    description: 'A Shock proc that breaks a shield refunds one Ordnance charge or 10% Action Skill charge.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 1,
  },
  {
    id: 'second_opinion',
    name: 'Second Opinion',
    description: 'On boss victory, the loot roll happens twice. You pick one reward; the other is auto-scrapped.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 4,
  },
  {
    id: 'salvage_rights',
    name: 'Salvage Rights',
    description: 'Kills with this weapon yield +50% scrap.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 4,
  },
  {
    id: 'overclocked',
    name: 'Overclocked',
    description: 'Attack speed ramps +5% every 5 seconds during a fight, but crit chance drops -2% per ramp.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 4,
  },
  {
    id: 'borrowed_time',
    name: 'Borrowed Time',
    description: 'Once per boss attempt, if you would fail the Survival Check, auto-consume 1 Med Kit and pass instead.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 4,
  },
  {
    id: 'kickback',
    name: 'Kickback',
    description: 'Every 7th hit deals 300% bonus damage as a burst spike.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 4,
  },
  {
    id: 'vampiric_ledger',
    name: 'Vampiric Ledger',
    description: 'Converts 5% of damage dealt into bonus credits on victory.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 4,
  },
  {
    id: 'echo_chamber',
    name: 'Echo Chamber',
    description: 'Status effects applied by this weapon have a 30% chance to re-apply themselves once.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 4,
  },
  {
    id: 'insurance_fraud_weapon',
    name: 'Insurance Fraud',
    description: 'If equipped during a defeat, 50% of consumed consumables are refunded.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 4,
  },
  {
    id: 'market_crash',
    name: 'Market Crash',
    description: 'This weapon\'s scrap value is 4x normal. Listing it on the market bypasses 50% of the fee.',
    eligibleSources: [DropSource.BossDrop],
    minBossTier: 4,
  },
  {
    id: 'stable_loop',
    name: 'Stable Loop',
    description: 'Action Skill charges 25% faster while this is your Primary weapon.',
    eligibleSources: [DropSource.BossDrop, DropSource.CacheForged],
    minBossTier: 4,
  },
  {
    id: 'phase_shifter',
    name: 'Phase Shifter',
    description: 'First hit against each boss shield/armor phase ignores 40% of that layer.',
    eligibleSources: [DropSource.BossDrop, DropSource.CacheForged],
    minBossTier: 4,
  },
  {
    id: 'hot_swapper',
    name: 'Hot Swapper',
    description: 'Your Secondary weapon contributes 60% of its passive stats instead of the normal reduced rate.',
    eligibleSources: [DropSource.BossDrop, DropSource.CacheForged],
    minBossTier: 4,
  },
  {
    id: 'chain_lightning',
    name: 'Chain Lightning',
    description: 'Shock procs chain to up to 2 additional nearby targets (or back to the boss for reduced damage).',
    eligibleSources: [DropSource.BossDrop, DropSource.CacheForged],
    minBossTier: 7,
  },
  {
    id: 'molten_core',
    name: 'Molten Core',
    description: 'Fire DoT stacks up to 5 times. Each stack reduces boss healing by an additional 10%.',
    eligibleSources: [DropSource.BossDrop, DropSource.CacheForged],
    minBossTier: 7,
  },
  {
    id: 'cryo_stasis',
    name: 'Cryo Stasis',
    description: 'Cryo procs have a 20% chance to trigger a mini-stagger, interrupting the boss for +5% DPS window.',
    eligibleSources: [DropSource.BossDrop, DropSource.CacheForged],
    minBossTier: 7,
  },
  {
    id: 'void_bargain',
    name: 'Void Bargain',
    description: '+40% Void damage, but every hit has a 5% chance to deal 10% damage to your own shield.',
    eligibleSources: [DropSource.BossDrop, DropSource.CacheForged],
    minBossTier: 7,
  },
  {
    id: 'jackpot',
    name: 'Jackpot',
    description: 'Every 150th enemy killed by this weapon drops a Cache Key fragment.',
    eligibleSources: [DropSource.BossDrop, DropSource.CacheForged],
    minBossTier: 7,
  },
];

export function getEligibleLegendaryEffects(source: DropSource, bossTier?: number): LegendaryEffectDef[] {
  return LEGENDARY_EFFECTS.filter((eff) => {
    if (!eff.eligibleSources.includes(source)) return false;
    if (source === DropSource.BossDrop && bossTier !== undefined && eff.minBossTier !== undefined) {
      return bossTier >= eff.minBossTier;
    }
    return true;
  });
}
