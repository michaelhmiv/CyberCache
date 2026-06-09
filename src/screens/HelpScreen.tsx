import React, { useMemo, useState } from 'react';
import { Box, ChevronDown, ChevronUp, Database, Search, Shield, Sparkles, Star, Sword, TrendingUp, X, Zap } from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';

interface HelpItem {
  term: string;
  body: string;
}

interface HelpSection {
  id: string;
  title: string;
  blurb: string;
  icon: React.ElementType;
  color: string;
  items: HelpItem[];
}

// Section content reflects the post-PR-#52-to-#56 reality: single-tick loop,
// per-area XP multiplier, new curve, server-minted fragments, build identity
// from kill stats. The old "auto-salvage clutter" copy is gone.
const SECTIONS: HelpSection[] = [
  {
    id: 'start',
    title: 'Getting Started',
    blurb: 'First 10 minutes on the Frontier.',
    icon: Sword,
    color: '#F59E0B',
    items: [
      { term: 'Pick a turf', body: 'The Dashboard\'s Choose Turf strip shows the seven roaming areas. Each one scales: later areas drop better loot and award more XP per tick.' },
      { term: 'Tap a turf, then Fight', body: 'Selecting an area and hitting Fight starts a roaming_loot activity. While it\'s active, the single 3-second tick awards credits, scrap, XP, and the occasional gear drop.' },
      { term: 'Equip before you push bosses', body: 'The boss simulator uses your equipped loadout (7 slots), not your full backpack. Open Loadout and slot your best weapon, shield, class mod, and relic before any boss attempt.' },
    ],
  },
  {
    id: 'loot',
    title: 'Weapons & Loot',
    blurb: 'Rarities, roll quality, and the loot pipeline.',
    icon: Box,
    color: '#A855F7',
    items: [
      { term: 'Rarity & roll quality', body: 'Every weapon has a rarity (Common → Legendary) and a roll quality band. Higher bands boost base stats. God rolls start at 96+.' },
      { term: 'DPS modifier chain', body: 'A weapon\'s effective DPS is raw damage × signature × manufacturer × affixes × legendary effect × element matchup × boss resistance. The gear inspector shows "vs standard target"; the dashboard chip shows the dynamic DPS against the selected boss.' },
      { term: 'Lock before salvage', body: 'Use the lock badge on any gear card to protect it from auto-salvage. Locked items survive cleanup passes and are excluded from the vendor list.' },
      { term: 'Server-minted drops', body: 'Credits, scrap, XP, fragments, materials, and essences are all server-minted. Your client rolls gear drops for immediate visual feedback, and the server reconciles economy stats every 3s.' },
    ],
  },
  {
    id: 'loadout',
    title: 'Loadout',
    blurb: 'Seven slots define the rig.',
    icon: Shield,
    color: '#3B82F6',
    items: [
      { term: 'Slots', body: 'Primary, Secondary, Heavy, Ordnance, Shield, Class Mod, Relic. Equipping is gated by item kind and unlock level.' },
      { term: 'Build identity', body: 'Your Profile\'s "Build Identity" is the weapon type you actually rack kills with, pulled from combat stats. It\'s not based on what you own — it reflects what you *use*.' },
      { term: 'Class Mods & Relics', body: 'These are build identity pieces, not filler stats. Class Mods grant skill-tree nodes; Relics grant affixes. Both stack with weapon affixes for the DPS chain.' },
    ],
  },
  {
    id: 'bosses',
    title: 'Boss Fights',
    blurb: 'Survival, break, DPS, and mechanics.',
    icon: Zap,
    color: '#EF4444',
    items: [
      { term: 'Phases', body: 'Bosses run through survival, break, DPS, and mechanic checks. You can attempt a boss any number of times; failed attempts do not consume resources.' },
      { term: 'Element matchup', body: 'Each boss has elemental weaknesses. Hitting a weakness with a matching element is a damage multiplier; hitting a resistance is a penalty. The dashboard diorama shows your current effective DPS against the selected boss.' },
      { term: 'Pity counter', body: 'Repeated failures improve future odds. The pity counter resets on a kill.' },
    ],
  },
  {
    id: 'economy',
    title: 'Economy',
    blurb: 'Credits, scrap, fragments, materials, essences.',
    icon: TrendingUp,
    color: '#22C55E',
    items: [
      { term: 'Credits', body: 'Earned passively while roaming, plus boss wins and vendor sales. Used for vendor purchases and some workshop recipes.' },
      { term: 'Scrap & materials', body: 'Salvage gear to get Scrap + materials. Materials are area-biased: each roaming area prefers different material kinds. Use the Workshop to convert them into combat utility.' },
      { term: 'Cache Keys & Fragments', body: 'Five fragments convert into one Cache Key. Fragments drop on roam ticks (small chance) and are server-minted. Keys open Data Caches for high-rarity gear.' },
    ],
  },
  {
    id: 'skills',
    title: 'Skill Trees',
    blurb: 'Gunslinger, Demolition, Scavenger.',
    icon: Star,
    color: '#06B6D4',
    items: [
      { term: 'Three trees', body: 'Gunslinger boosts weapons; Demolition boosts ordnance; Scavenger boosts materials and salvage yield. Each tree is gated by level and class mod.' },
      { term: 'Spend points', body: 'One skill point per level starting at level 2. Unspent points are visible on the Profile and Dashboard HUDs.' },
      { term: 'Nodes & keystones', body: 'Small nodes feed majors; majors unlock keystones. Keystones are build-defining (e.g. "free reload on kill") and are why loadout matters.' },
    ],
  },
  {
    id: 'mastery',
    title: 'Mastery & Constellations',
    blurb: 'Server-tracked ranks across 6 categories.',
    icon: Sparkles,
    color: '#FF4B5C',
    items: [
      { term: '6 categories', body: 'Combat, Weapons, Inventory, Locations, Economy, Services. Each category has tracks that ascend through Dormant → Active → Pulsar → Nova.' },
      { term: 'Constellation map', body: 'The Mastery screen renders your categories as a constellation — each orbit node is a category, satellite dots are the tracks. The map visualizes the spread of your progression, not just a single number.' },
      { term: 'Mastery score', body: 'Read directly from the server\'s `mastery_xp` total. Local fallbacks only appear when the server is unreachable.' },
    ],
  },
  {
    id: 'tips',
    title: 'Pro Tips',
    blurb: 'Things the dashboard won\'t tell you.',
    icon: Database,
    color: '#F59E0B',
    items: [
      { term: 'Element over rarity', body: 'A Common weapon with the right element is better than a Legendary with the wrong one. Match first, rarify later.' },
      { term: 'DPS label', body: 'The gear inspector\'s "vs standard target" DPS is a baseline. Your effective DPS in any fight depends on the boss\'s weakness / resistance profile.' },
      { term: 'Build Identity lag', body: 'Build Identity only updates after you rack enough kills for a stable winner in `killsByWeaponType`. If it shows "No data yet", patrol a turf for a few minutes.' },
      { term: 'Offline catchup', body: 'Roaming ticks claim rewards on a 3s cadence. Coming back from a long break shows a single summary card (kills, XP, fragments), not a per-tick animation replay.' },
    ],
  },
];

const SectionCard: React.FC<{ section: HelpSection; open: boolean; onToggle: () => void; query: string }> = ({ section, open, onToggle, query }) => {
  const Icon = section.icon;
  const lower = query.toLowerCase();
  const filtered = query.trim().length === 0
    ? section.items
    : section.items.filter((it) => it.term.toLowerCase().includes(lower) || it.body.toLowerCase().includes(lower));
  if (query && filtered.length === 0) return null;
  return (
    <MobileCard rarityColor={section.color}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left transition-transform active:scale-[0.98]"
      >
        <div className="bl-icon-plate flex h-9 w-9 shrink-0 items-center justify-center" style={{ backgroundColor: `${section.color}18` }}>
          <Icon size={16} style={{ color: section.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black uppercase tracking-wide text-text-primary">{section.title}</div>
          <div className="text-[9px] uppercase tracking-[0.16em] text-text-muted">{section.blurb}</div>
        </div>
        <div className="text-[9px] font-black uppercase tracking-widest text-text-muted">{filtered.length}</div>
        {open ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t-2 border-border pt-2">
          {filtered.map((item) => (
            <div key={item.term} className="border-l-2 pl-2" style={{ borderColor: section.color }}>
              <div className="text-[11px] font-black uppercase tracking-wide text-text-primary">{item.term}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-text-secondary">{item.body}</div>
            </div>
          ))}
        </div>
      )}
    </MobileCard>
  );
};

export const HelpScreen: React.FC = () => {
  const [openId, setOpenId] = useState<string | null>('start');
  const [query, setQuery] = useState('');

  // When searching, auto-open every section that has a hit so the user
  // doesn't have to click through each one.
  const effectiveOpenId = useMemo(() => (query.trim().length > 0 ? '__all__' : openId), [query, openId]);

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

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the manual..."
          className="w-full border-2 border-border bg-bg/80 py-1.5 pl-7 pr-7 text-xs text-text-primary placeholder:text-text-muted focus:border-amber focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="space-y-2">
        {SECTIONS.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            open={effectiveOpenId === '__all__' || openId === section.id}
            onToggle={() => setOpenId((prev) => (prev === section.id ? null : section.id))}
            query={query}
          />
        ))}
      </div>
    </div>
  );
};
