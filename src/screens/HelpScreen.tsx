import React from 'react';
import { Sword, Shield, Box, Zap, Star, Database, TrendingUp } from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';

const SECTIONS = [
  {
    title: 'Getting Started',
    icon: Sword,
    color: '#F59E0B',
    items: [
      'CyberCache is an idle roguelite looter RPG. Farm weapons, fight bosses, and upgrade your rig.',
      'The Fight tab is your main field board. It passively generates loot and XP while you play.',
      'Use manual sweeps for instant combat feedback, then tune the loadout before bosses.',
    ],
  },
  {
    title: 'Weapons & Loot',
    icon: Box,
    color: '#A855F7',
    items: [
      'Weapons have types, rarities, elements, roll quality, modular parts, and affixes.',
      'Higher roll quality means better stats. God rolls start at 96+.',
      'Legendary weapons have special effects that alter the run.',
      'Lock valuable gear before scrapping or listing it.',
    ],
  },
  {
    title: 'Loadout',
    icon: Shield,
    color: '#3B82F6',
    items: [
      'Seven slots define the hunter rig: Primary, Secondary, Heavy, Ordnance, Shield, Class Mod, Relic.',
      'The boss simulator uses your equipped loadout, not the full backpack.',
      'Class Mods and Relics are build identity pieces, not filler stats.',
    ],
  },
  {
    title: 'Boss Fights',
    icon: Zap,
    color: '#EF4444',
    items: [
      'Boss fights run through survival, break, DPS, and mechanic checks.',
      'Element matchups and consumables matter. Target weaknesses and avoid resistances.',
      'Pity counters build on repeated failures and improve future odds.',
    ],
  },
  {
    title: 'Economy',
    icon: TrendingUp,
    color: '#22C55E',
    items: [
      'Credits come from farming, boss wins, and selling gear.',
      'Scrap and materials come from salvaging and feed the workbench.',
      'Cache Keys open Data Caches. Five fragments convert into one key.',
    ],
  },
  {
    title: 'Skill Trees',
    icon: Star,
    color: '#06B6D4',
    items: [
      'Three trees: Gunslinger, Demolition, and Scavenger.',
      'Spend one skill point per level starting at level 2.',
      'Small nodes feed majors; majors unlock keystones.',
    ],
  },
  {
    title: 'Pro Tips',
    icon: Database,
    color: '#F59E0B',
    items: [
      'Match elements to boss weaknesses for stronger damage checks.',
      'Use Settings to tune auto-salvage so junk does not clutter your backpack.',
      'Use Workshop queues to convert salvaged parts into combat utility.',
    ],
  },
];

export const HelpScreen: React.FC = () => {
  return (
    <div className="bl-page space-y-4 p-4 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Field Manual</div>
          <div className="text-xs text-text-muted">Pinned notes for loot, combat, caches, and buildcraft.</div>
        </div>
        <div className="bl-icon-plate flex h-12 w-12 shrink-0 -rotate-2 items-center justify-center text-amber">
          <Database size={22} />
        </div>
      </div>

      <div className="space-y-3">
        {SECTIONS.map((section) => (
          <MobileCard key={section.title} rarityColor={section.color}>
            <div className="mb-2 flex items-center gap-2">
              <div className="bl-icon-plate flex h-9 w-9 items-center justify-center" style={{ backgroundColor: `${section.color}18` }}>
                <section.icon size={16} style={{ color: section.color }} />
              </div>
              <div>
                <div className="text-sm font-black uppercase tracking-wide text-text-primary">{section.title}</div>
                <div className="text-[9px] uppercase tracking-[0.16em] text-text-muted">Briefing card</div>
              </div>
            </div>
            <ul className="space-y-1.5">
              {section.items.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-text-secondary">
                  <span className="mt-0.5 shrink-0 text-amber">▸</span>
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
