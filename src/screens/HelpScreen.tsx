import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Search,
  X,
} from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';

type TabId = 'dashboard' | 'fight' | 'inventory' | 'market' | 'profile';

interface HelpItem {
  term: string;
  body: string;
}

interface HelpSection {
  id: string;
  title: string;
  blurb: string;
  glyph: string;
  color: string;
  items: HelpItem[];
}

interface TourStep {
  id: string;
  title: string;
  body: string;
  target: { tab: TabId; label: string; glyph: string };
  // The on-screen element to spotlight, used by the tour overlay when active.
  spotlight: string;
  cta: string;
}

// One guided step per major gameplay phase. Each step names a real tab and
// describes what the player should be looking at, so the manual is a real tour
// rather than a static reference card.
const TOUR_STEPS: TourStep[] = [
  {
    id: 'pick-turf',
    title: '1. Pick a turf',
    body:
      'Open the Board. The Choose Turf strip lists the seven roaming areas. Each one has a danger rating and a per-tick XP multiplier shown in the chip. Start with Dustwaste Frontier at Level 1; the system gates higher areas behind your Hunter level.',
    target: { tab: 'dashboard', label: 'Board', glyph: '◇' },
    spotlight: 'Choose Turf strip',
    cta: 'Go to Board',
  },
  {
    id: 'start-roam',
    title: '2. Start a roam',
    body:
      'Tap a turf, then Action. The 3-second tick awards credits, scrap, XP, and an occasional gear drop. Bosses and Mini-bosses are triggered by the Boss prep button on the Board, not by Action — Action is the passive roaming loop.',
    target: { tab: 'fight', label: 'Action', glyph: '⚔' },
    spotlight: 'Roaming activity card',
    cta: 'Open Action',
  },
  {
    id: 'inspect-loot',
    title: '3. Inspect loot',
    body:
      'Open Gear and tap any item card to bring up the inspect sheet. The "vs standard target" DPS at the top is your baseline. The Matchup Chip at the bottom shows effective DPS against the boss you are prepping, factoring in element, manufacturer, and legendary effects.',
    target: { tab: 'inventory', label: 'Gear', glyph: '▣' },
    spotlight: 'Gear grid',
    cta: 'Open Gear',
  },
  {
    id: 'build-loadout',
    title: '4. Build a loadout',
    body:
      'Boss damage is computed from the seven equipped slots, not the full backpack. Equip your best weapon, shield, class mod, and relic before any boss attempt. Class Mods unlock Skill Tree keystones; Relics grant affixes. Both stack with weapon affixes in the DPS chain.',
    target: { tab: 'inventory', label: 'Gear', glyph: '◈' },
    spotlight: 'Loadout panel',
    cta: 'Open Gear',
  },
  {
    id: 'check-identity',
    title: '5. Read your Build Identity',
    body:
      'The Hunter tab shows your Build Identity — the weapon type you actually rack kills with, pulled from combat stats. It is not based on what you own. If it shows "No data yet", patrol a turf for a few minutes; the system needs a stable winner in killsByWeaponType.',
    target: { tab: 'profile', label: 'Hunter', glyph: '☻' },
    spotlight: 'Build Identity card',
    cta: 'Open Hunter',
  },
  {
    id: 'sell-buy',
    title: '6. Trade at the Market',
    body:
      'Sell duplicates for credits, and use the Vendor to roll for gear you can afford. Locked items never get sold or salvaged. The Market uses server-minted credits only, so a successful sale reflects in your balance on the next 3s tick.',
    target: { tab: 'market', label: 'Market', glyph: '📈' },
    spotlight: 'Market tabs',
    cta: 'Open Market',
  },
  {
    id: 'mastery-constellation',
    title: '7. Track Mastery',
    body:
      'The Mastery screen (Field Manual → Mastery) renders six orbits — Combat, Weapons, Inventory, Locations, Economy, Services. Each satellite dot is a track. The constellation is server-tracked; the local fallback only fires when the server is unreachable.',
    target: { tab: 'profile', label: 'Hunter', glyph: '✦' },
    spotlight: 'Mastery constellation',
    cta: 'Open Mastery',
  },
];

// Section content reflects the post-PR-#52-to-#58 reality: single-tick loop,
// per-area XP multiplier, new curve, server-minted fragments, build identity
// from kill stats. The old "auto-salvage clutter" copy is gone.
const SECTIONS: HelpSection[] = [
  {
    id: 'start',
    title: 'Getting Started',
    blurb: 'First 10 minutes on the Frontier.',
    glyph: '⚔',
    color: '#F59E0B',
    items: [
      { term: 'Pick a turf', body: 'The Dashboard\'s Choose Turf strip shows the seven roaming areas. Each one scales: later areas drop better loot and award more XP per tick.' },
      { term: 'Tap a turf, then Action', body: 'Selecting an area and hitting Action starts a roaming_loot activity. While it\'s active, the single 3-second tick awards credits, scrap, XP, and the occasional gear drop.' },
      { term: 'Equip before you push bosses', body: 'The boss simulator uses your equipped loadout (7 slots), not your full backpack. Open Loadout and slot your best weapon, shield, class mod, and relic before any boss attempt.' },
    ],
  },
  {
    id: 'loot',
    title: 'Weapons & Loot',
    blurb: 'Rarities, roll quality, and the loot pipeline.',
    glyph: '▣',
    color: '#A855F7',
    items: [
      { term: 'Rarity & roll quality', body: 'Every weapon has a rarity (Common → Legendary) and a roll quality band. Higher bands boost base stats. God rolls start at 96+.' },
      { term: 'DPS modifier chain', body: 'A weapon\'s effective DPS is raw damage × signature × manufacturer × affixes × legendary effect × element matchup × boss resistance. The gear inspector shows "vs standard target"; the dashboard chip shows the dynamic DPS against the selected boss.' },
      { term: 'Lock before salvage', body: 'Use the lock badge on any gear card to protect it from auto-salvage. Locked items survive cleanup passes and are excluded from the vendor list.' },
      { term: 'Server-minted drops', body: 'Credits, scrap, XP, fragments, materials, and essences are all server-minted. Your client rolls gear drops for immediate visual feedback, and the server reconciles economy stats every 3s.' },
      { term: 'Per-area XP', body: 'Each area has its own idle XP multiplier (1.0 → 2.4). The Board shows the multiplier on the area card; high-danger areas reward more XP per tick, not just better loot.' },
    ],
  },
  {
    id: 'loadout',
    title: 'Loadout',
    blurb: 'Seven slots define the loadout.',
    glyph: '◈',
    color: '#3B82F6',
    items: [
      { term: 'Slots', body: 'Primary, Secondary, Heavy, Ordnance, Shield, Class Mod, Relic. Equipping is gated by item kind and unlock level.' },
      { term: 'Build identity', body: 'Your Hunter tab\'s "Build Identity" is the weapon type you actually rack kills with, pulled from combat stats. It\'s not based on what you own — it reflects what you *use*.' },
      { term: 'Class Mods & Relics', body: 'These are build identity pieces, not filler stats. Class Mods grant skill-tree nodes; Relics grant affixes. Both stack with weapon affixes for the DPS chain.' },
    ],
  },
  {
    id: 'bosses',
    title: 'Boss Fights',
    blurb: 'Survival, break, DPS, and mechanics.',
    glyph: '⚡',
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
    glyph: '📈',
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
    glyph: '★',
    color: '#06B6D4',
    items: [
      { term: 'Three trees', body: 'Gunslinger boosts weapons; Demolition boosts ordnance; Scavenger boosts materials and salvage yield. Each tree is gated by level and class mod.' },
      { term: 'Spend points', body: 'One skill point per level starting at level 2. Unspent points are visible on the Hunter and Board HUDs.' },
      { term: 'Nodes & keystones', body: 'Small nodes feed majors; majors unlock keystones. Keystones are build-defining (e.g. "free reload on kill") and are why loadout matters.' },
    ],
  },
  {
    id: 'mastery',
    title: 'Mastery & Constellations',
    blurb: 'Server-tracked ranks across 6 categories.',
    glyph: '✦',
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
    glyph: '▤',
    color: '#F59E0B',
    items: [
      { term: 'Element over rarity', body: 'A Common weapon with the right element is better than a Legendary with the wrong one. Match first, rarify later.' },
      { term: 'DPS label', body: 'The gear inspector\'s "vs standard target" DPS is a baseline. Your effective DPS in any fight depends on the boss\'s weakness / resistance profile.' },
      { term: 'Build Identity lag', body: 'Build Identity only updates after you rack enough kills for a stable winner in `killsByWeaponType`. If it shows "No data yet", patrol a turf for a few minutes.' },
      { term: 'Offline catchup', body: 'Roaming ticks claim rewards on a 3s cadence. Coming back from a long break shows a single summary card (kills, XP, fragments), not a per-tick animation replay.' },
    ],
  },
];

interface HelpScreenProps {
  // Optional callback for the guided tour's "Go to ..." buttons. If the host
  // app (App.tsx) wires this up, the tour can switch tabs for the player.
  onTourJump?: (tab: TabId) => void;
}

const SectionCard: React.FC<{ section: HelpSection; open: boolean; onToggle: () => void; query: string }> = ({ section, open, onToggle, query }) => {
  const sectionGlyph = section.glyph;
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
          <span className="font-black" style={{ color: section.color, fontSize: '16px' }}>{sectionGlyph}</span>
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

const TourStepCard: React.FC<{
  step: TourStep;
  index: number;
  total: number;
  isCurrent: boolean;
  onJump: (tab: TabId) => void;
}> = ({ step, index, isCurrent, onJump }) => {
  const stepGlyph = step.target.glyph;
  return (
    <div
      className={`relative border-2 p-3 transition-all ${
        isCurrent ? 'border-amber bg-amber/10' : 'border-border bg-surface/40'
      }`}
      style={{ clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' }}
    >
      <div className="flex items-start gap-2">
        <div className={`bl-icon-plate flex h-7 w-7 shrink-0 items-center justify-center ${isCurrent ? 'bg-amber text-bg' : 'bg-bg text-amber'}`}>
          <span className="text-[10px] font-black">{index + 1}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-black uppercase tracking-wide text-text-primary">{step.title}</div>
          <div className="mt-1 text-[11px] leading-snug text-text-secondary">{step.body}</div>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex items-center gap-1 border border-border bg-bg/70 px-1.5 py-0.5">
              <span className="font-black text-amber" style={{ fontSize: '10px' }}>{stepGlyph}</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary">{step.target.label}</span>
            </div>
            <span className="text-[9px] text-text-muted">·</span>
            <span className="text-[9px] uppercase tracking-wide text-text-muted">{step.spotlight}</span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onJump(step.target.tab)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 border-2 border-border bg-bg py-1.5 text-[10px] font-black uppercase tracking-widest text-amber transition-transform active:scale-[0.97]"
        style={{ clipPath: 'polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%)' }}
      >
        {step.cta}
        <ArrowRight size={11} />
      </button>
    </div>
  );
};

export const HelpScreen: React.FC<HelpScreenProps> = ({ onTourJump }) => {
  const [openId, setOpenId] = useState<string | null>('start');
  const [query, setQuery] = useState('');
  const [tourStep, setTourStep] = useState<number>(0);
  const [tourOpen, setTourOpen] = useState<boolean>(true);

  // When searching, auto-open every section that has a hit so the user
  // doesn't have to click through each one.
  const effectiveOpenId = useMemo(() => (query.trim().length > 0 ? '__all__' : openId), [query, openId]);

  const handleTourJump = (tab: TabId) => {
    if (onTourJump) {
      onTourJump(tab);
    } else {
      // Fallback: surface a clear hint if the host hasn't wired onTourJump.
      // We don't try to fake a tab switch because the BottomNav state lives
      // in App.tsx and the screens are mounted by tab.
      console.warn('[HelpScreen] onTourJump not wired; cannot switch to', tab);
    }
    // Advance the cursor so the player sees progress when they return.
    setTourStep((prev) => Math.min(prev + 1, TOUR_STEPS.length - 1));
  };

  const resetTour = () => {
    setTourStep(0);
    setTourOpen(true);
  };

  return (
    <div className="bl-page space-y-4 p-4 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Field Manual</div>
          <div className="text-xs text-text-muted">Pinned notes for loot, combat, caches, and buildcraft.</div>
        </div>
        <div className="bl-icon-plate flex h-12 w-12 shrink-0 -rotate-2 items-center justify-center text-amber">
          <span className="font-black text-amber" style={{ fontSize: '22px' }}>▤</span>
        </div>
      </div>

      <MobileCard rarityColor="#FF4B5C">
        <button
          type="button"
          onClick={() => setTourOpen((o) => !o)}
          className="flex w-full items-center gap-2 text-left transition-transform active:scale-[0.98]"
        >
          <div className="bl-icon-plate flex h-9 w-9 shrink-0 items-center justify-center bg-[#FF4B5C]/15">
            <span style={{ fontSize: 16 }} className="text-[#FF4B5C]">🧭</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black uppercase tracking-wide text-text-primary">Guided Tour</div>
            <div className="text-[9px] uppercase tracking-[0.16em] text-text-muted">
              Step {tourStep + 1} of {TOUR_STEPS.length} — {TOUR_STEPS[tourStep].title.replace(/^\d+\.\s*/, '')}
            </div>
          </div>
          <div className="text-[9px] font-black uppercase tracking-widest text-text-muted">
            {Math.round(((tourStep + 1) / TOUR_STEPS.length) * 100)}%
          </div>
          {tourOpen ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
        </button>
        {tourOpen && (
          <div className="mt-2 space-y-2 border-t-2 border-border pt-2">
            <TourStepCard
              step={TOUR_STEPS[tourStep]}
              index={tourStep}
              total={TOUR_STEPS.length}
              isCurrent
              onJump={handleTourJump}
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTourStep((s) => Math.max(0, s - 1))}
                disabled={tourStep === 0}
                className="border-2 border-border bg-bg px-2 py-1 text-[10px] font-black uppercase tracking-widest text-text-secondary transition-transform active:scale-[0.97] disabled:opacity-30"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={resetTour}
                className="border-2 border-border bg-bg px-2 py-1 text-[10px] font-black uppercase tracking-widest text-text-muted transition-transform active:scale-[0.97]"
              >
                Restart
              </button>
              <button
                type="button"
                onClick={() => setTourStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1))}
                disabled={tourStep === TOUR_STEPS.length - 1}
                className="border-2 border-amber bg-amber/20 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber transition-transform active:scale-[0.97] disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </MobileCard>

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
