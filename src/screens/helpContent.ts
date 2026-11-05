/**
 * helpContent — the Field Manual's words: guided-tour steps and
 * section entries, verbatim. Split out of HelpScreen.tsx so the
 * screen file exports components only (react-refresh) and design
 * passes (e.g. the Hunter subpage prototypes) can import the real
 * content without importing a screen.
 */
import { type PxIconName } from '@/components/pixelArt/PxIcon';
import { getNavSigil } from '@/constants/navSigils';

type TabId = 'home' | 'gear' | 'market' | 'hunter';

export interface HelpItem {
  term: string;
  body: string;
}

export interface HelpSection {
  id: string;
  title: string;
  blurb: string;
  icon: PxIconName;
  color: string;
  items: HelpItem[];
}

export interface TourStep {
  id: string;
  title: string;
  body: string;
  target: { tab: TabId; label: string; icon: PxIconName };
  // The on-screen element to spotlight, used by the tour overlay when active.
  spotlight: string;
  cta: string;
}

// One guided step per major gameplay phase. Each step names a real tab and
// describes what the player should be looking at, so the manual is a real tour
// rather than a static reference card.
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'pick-turf',
    title: '1. Pick an area',
    body:
      'Open Home. The Choose Area panel lists the seven roaming areas. Each one has a danger rating and a per-tick XP multiplier shown in the chip. Every area is open from Level 1 — nothing is gated. Start with Dustwaste Frontier while you gear up; later areas hit harder and pay better, and the danger rating is a warning, never a wall.',
    target: { tab: 'home', label: 'Home', icon: 'home' },
    spotlight: 'Choose Area panel',
    cta: 'Go to Home',
  },
  {
    id: 'start-roam',
    title: '2. Start a roam',
    body:
      'On Home, tap an area, then Start Roam on the stage. The 3-second tick awards credits, scrap, XP, and an occasional gear drop. Bosses are never triggered by roaming — a boss attempt is deliberate: open Boss Prep from the same stage, read the intel, and launch the attempt yourself when you are ready.',
    target: { tab: 'home', label: 'Home', icon: 'crosshair' },
    spotlight: 'Roaming activity card',
    cta: 'Open Home',
  },
  {
    id: 'inspect-loot',
    title: '3. Inspect loot',
    body:
      'Open Gear and tap any item card to bring up the inspect sheet. The "vs standard target" DPS at the top is your baseline. The Matchup Chip at the bottom shows effective DPS against the boss you are prepping, factoring in element, manufacturer, and legendary effects.',
    target: { tab: 'gear', label: 'Gear', icon: 'grid' },
    spotlight: 'Gear grid',
    cta: 'Open Gear',
  },
  {
    id: 'build-loadout',
    title: '4. Build a loadout',
    body:
      'Boss damage is computed from the seven equipped slots, not the full backpack. Equip your best weapon, shield, class mod, and relic before any boss attempt. Class Mods unlock Skill Tree keystones; Relics grant affixes. Both stack with weapon affixes in the DPS chain.',
    target: { tab: 'gear', label: 'Gear', icon: 'diamondIn' },
    spotlight: 'Loadout panel',
    cta: 'Open Gear',
  },
  {
    id: 'check-identity',
    title: '5. Read your Build Identity',
    body:
      'The Hunter tab shows your Build Identity — the weapon type you actually rack kills with, pulled from combat stats. It is not based on what you own. If it shows "No data yet", patrol an area for a few minutes; the system needs a stable winner in killsByWeaponType.',
    target: { tab: 'hunter', label: 'Hunter', icon: 'person' },
    spotlight: 'Build Identity card',
    cta: 'Open Hunter',
  },
  {
    id: 'sell-buy',
    title: '6. Trade at the Market',
    body:
      'Sell duplicates for credits, and use the Vendor to roll for gear you can afford. Locked items never get sold or salvaged. The Market uses server-minted credits only, so a successful sale reflects in your balance on the next 3s tick.',
    target: { tab: 'market', label: 'Market', icon: getNavSigil('market').icon },
    spotlight: 'Market tabs',
    cta: 'Open Market',
  },
  {
    id: 'mastery-constellation',
    title: '7. Track Mastery',
    body:
      'The Mastery screen (Field Manual → Mastery) renders six orbits — Combat, Weapons, Inventory, Locations, Economy, Services. Each satellite dot is a track. The constellation is server-tracked; the local fallback only fires when the server is unreachable.',
    target: { tab: 'hunter', label: 'Hunter', icon: 'star' },
    spotlight: 'Mastery constellation',
    cta: 'Open Mastery',
  },
];

// Section content reflects the post-PR-#52-to-#58 reality: single-tick loop,
// per-area XP multiplier, new curve, server-minted rewards, build identity
// from kill stats. The old "auto-salvage clutter" copy is gone.
export const SECTIONS: HelpSection[] = [
  {
    id: 'start',
    title: 'Getting Started',
    blurb: 'First 10 minutes on the Frontier.',
    icon: 'crosshair',
    color: '#F59E0B',
    items: [
      { term: 'Pick an area', body: 'Home\'s Choose Area panel shows the seven roaming areas. Each one scales: later areas drop better loot and award more XP per tick.' },
      { term: 'Tap an area, then Start Roam', body: 'Selecting an area and hitting Start Roam on Home\'s stage starts a roaming_loot activity. While it\'s active, the single 3-second tick awards credits, scrap, XP, and the occasional gear drop.' },
      { term: 'Equip before you push bosses', body: 'The boss simulator uses your equipped loadout (7 slots), not your full backpack. Open Loadout and slot your best weapon, shield, class mod, and relic before any boss attempt.' },
    ],
  },
  {
    id: 'loot',
    title: 'Weapons & Loot',
    blurb: 'Rarities, roll quality, and the loot pipeline.',
    icon: 'grid',
    color: '#A855F7',
    items: [
      { term: 'Rarity & roll quality', body: 'Every weapon has a rarity (Common → Legendary) and a roll quality band. Higher bands boost base stats. God rolls start at 96+.' },
      { term: 'DPS modifier chain', body: 'A weapon\'s effective DPS is raw damage × signature × manufacturer × affixes × legendary effect × element matchup × boss resistance. The gear inspector shows "vs standard target"; the dashboard chip shows the dynamic DPS against the selected boss.' },
      { term: 'Lock before salvage', body: 'Use the lock badge on any gear card to protect it from auto-salvage. Locked items survive cleanup passes and are excluded from the vendor list.' },
      { term: 'Server-minted drops', body: 'Credits, scrap, XP, cache keys, materials, and essences are all server-minted. Your client rolls gear drops for immediate visual feedback, and the server reconciles economy stats every 3s.' },
      { term: 'Per-area XP', body: 'Each area has its own idle XP multiplier (1.0 → 2.4). Home shows the multiplier on the area card; high-danger areas reward more XP per tick, not just better loot.' },
    ],
  },
  {
    id: 'loadout',
    title: 'Loadout',
    blurb: 'Seven slots define the loadout.',
    icon: 'diamondIn',
    color: '#3B82F6',
    items: [
      { term: 'Slots', body: 'Primary, Secondary, Heavy, Ordnance, Shield, Class Mod, Relic. Equipping is gated only by item kind — if you own it and it fits the slot, you can equip it at any level.' },
      { term: 'Build identity', body: 'Your Hunter tab\'s "Build Identity" is the weapon type you actually rack kills with, pulled from combat stats. It\'s not based on what you own — it reflects what you *use*.' },
      { term: 'Class Mods & Relics', body: 'These are build identity pieces, not filler stats. Class Mods grant skill-tree nodes; Relics grant affixes. Both stack with weapon affixes for the DPS chain.' },
    ],
  },
  {
    id: 'bosses',
    title: 'Boss Fights',
    blurb: 'Survival, break, DPS, and mechanics.',
    icon: 'bolt',
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
    blurb: 'Credits, scrap, cache keys, materials, essences.',
    icon: 'chart',
    color: '#22C55E',
    items: [
      { term: 'Credits', body: 'Earned passively while roaming, plus boss wins and vendor sales. Used for vendor purchases and some workshop recipes.' },
      { term: 'Scrap & materials', body: 'Salvage gear to get Scrap + materials. Materials are area-biased: each roaming area prefers different material kinds. Use the Workshop to convert them into combat utility.' },
      { term: 'Cache Keys', body: 'Keys open Data Caches for high-rarity gear. Every opening costs one key or one watched ad — no daily limit. Keys are rare: roaming drops a whole key now and then, and the login streak, contracts, and leaderboards pay them too.' },
    ],
  },
  {
    id: 'skills',
    title: 'Skill Trees',
    blurb: 'Gunslinger, Demolition, Scavenger.',
    icon: 'star5',
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
    icon: 'star',
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
    icon: 'grid',
    color: '#F59E0B',
    items: [
      { term: 'Element over rarity', body: 'A Common weapon with the right element is better than a Legendary with the wrong one. Match first, rarify later.' },
      { term: 'DPS label', body: 'The gear inspector\'s "vs standard target" DPS is a baseline. Your effective DPS in any fight depends on the boss\'s weakness / resistance profile.' },
      { term: 'Build Identity lag', body: 'Build Identity only updates after you rack enough kills for a stable winner in `killsByWeaponType`. If it shows "No data yet", patrol an area for a few minutes.' },
      { term: 'Offline catchup', body: 'Roaming ticks claim rewards on a 3s cadence. Coming back from a long break shows a single summary card (kills, XP, credits), not a per-tick animation replay.' },
    ],
  },
];
