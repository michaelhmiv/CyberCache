import React from 'react';
import { Sword, Shield, Box, Zap, Star, Database, TrendingUp } from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';

const SECTIONS = [
  {
    title: 'Getting Started',
    icon: Sword,
    color: '#F59E0B',
    items: [
      'CyberCache is an idle roguelite looter RPG. You farm weapons, fight bosses, and upgrade your loadout.',
      'The Fight tab is your home base. It passively generates loot and XP while you play.',
      'Tap Quick Drop to manually generate a weapon, or let the auto-farming handle it.',
    ],
  },
  {
    title: 'Weapons & Loot',
    icon: Box,
    color: '#A855F7',
    items: [
      'Weapons have 6 types (Pistol, SMG, Shotgun, Sniper, Launcher, Beam), 5 rarities (Common→Legendary), and 6 elements.',
      'Each weapon has a Roll Quality (0-100). Higher quality = better stats. "God Roll" at 96+.',
      'Weapons have modular Parts and random Affixes that modify their stats.',
      'Legendary weapons have unique Special Effects that change gameplay (e.g., Glass Sun: +50% Fire damage but -30% shield).',
      'Lock valuable items (tap → Lock) to prevent accidental scrapping.',
    ],
  },
  {
    title: 'Loadout',
    icon: Shield,
    color: '#3B82F6',
    items: [
      '7 gear slots: Primary, Secondary, Heavy, Ordnance, Shield, Class Mod, Relic.',
      'Primary weapon contributes the most to combat. Secondary gives ~30% passive contribution.',
      'Heavy weapons (Launcher, Shotgun) are for burst damage and boss phase breaks.',
      'Shields improve your survival chance in boss fights.',
      'Class Mods boost specific Skill Trees. Relics provide global modifiers.',
      'Tap any slot in the Loadout tab to equip gear from your inventory.',
    ],
  },
  {
    title: 'Boss Fights',
    icon: Zap,
    color: '#EF4444',
    items: [
      'Boss fights run through 4 phases: Survival → Shield/Armor Break → DPS → Mechanics.',
      'The win chance estimate shows your odds. 75%+ is "Favorable."',
      'Elemental matchups matter. Use weapons strong against the boss\'s weakness (shown in green).',
      'Bring consumables (Med Kits, Shield Cells, Ordnance Charges) to boost your odds.',
      'Risk settings: Conservative (safer, less reward) → All In (dangerous, high reward).',
      'Death fees take a percentage of your credits on failure. Insurance Tokens reduce this.',
      'Pity counters build up on repeated failures, increasing future win chance by 3% per loss (cap +30%).',
    ],
  },
  {
    title: 'Economy',
    icon: TrendingUp,
    color: '#22C55E',
    items: [
      'Credits: earned from farming, boss victories, and selling gear. Used for vendor purchases.',
      'Scrap: from salvaging unwanted items. Used in the Fusion Lab to improve roll quality.',
      'Cache Keys: open Data Caches which guarantee Rare+ weapons. Earned from boss kills and rare drops.',
      'Cache Key Fragments (5 = 1 Key): randomly drop from farming.',
      'Marketplace: buy/sell weapons with simulated NPC traders. Listing fee is 10%.',
    ],
  },
  {
    title: 'Skill Trees',
    icon: Star,
    color: '#06B6D4',
    items: [
      'Three trees: Gunslinger (weapon damage/crits), Demolition (explosives/armor break), Scavenger (idle/loot/economy).',
      'Spend 1 skill point per level, starting at level 2 (total = your level - 1).',
      'Nodes unlock in tiers. Major nodes and Keystones require adjacent nodes.',
      'Respec costs 100 credits per point spent. Try different builds!',
    ],
  },
  {
    title: 'Pro Tips',
    icon: Database,
    color: '#F59E0B',
    items: [
      'Equip your best weapons in the Loadout tab — the boss simulator uses your loadout, not your inventory.',
      'Match elements to boss weaknesses for 1.3× damage. Avoid resisted elements (0.7×).',
      'Fusion Lab can improve a weapon\'s roll quality by consuming 2+ similar weapons.',
      'Offline earnings accumulate up to your cap. Claim them from the Fight tab.',
      'Auto-salvage in Settings can automatically scrap low-rarity, low-quality drops.',
      'Salvaging gear gives materials and essences — use them in the Workshop to craft consumables.',
    ],
  },
];

export const HelpScreen: React.FC = () => {
  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="text-lg font-black text-text-primary">Guide</div>
      <div className="text-xs text-text-muted">Everything you need to know about CyberCache.</div>

      <div className="space-y-3">
        {SECTIONS.map((section) => (
          <MobileCard key={section.title}>
            <div className="flex items-center gap-2 mb-2">
              <section.icon size={16} style={{ color: section.color }} />
              <div className="text-sm font-bold text-text-primary">{section.title}</div>
            </div>
            <ul className="space-y-1.5">
              {section.items.map((item, i) => (
                <li key={i} className="text-[11px] text-text-secondary flex items-start gap-1.5">
                  <span className="text-text-muted mt-0.5 shrink-0">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </MobileCard>
        ))}
      </div>
    </div>
  );
};
