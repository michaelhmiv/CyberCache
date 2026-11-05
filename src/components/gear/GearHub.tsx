/**
 * GearHub — mobile-first inventory management.
 *
 * Design rules:
 *   - Keep the main Gear tab dense: gear-kind rail, search, one compact toolbar, then items.
 *   - Move high-cardinality filters into a bottom sheet so the inventory stays readable.
 *   - GRID is the triage card face: type-specific decision stats + the
 *     instance's real affixes. LIST is a true list (owner ruling
 *     2026-11-04, DESIGN.md §3): ONE line per item — thumb with an
 *     element corner badge, level, rarity-colored name, equipped/lock
 *     markers, ONE headline stat per kind. Everything else is behind
 *     inspect, which is one tap on the row.
 */
import React, { memo, useCallback, useMemo, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  ArrowUpDown,
  X,
  LayoutGrid,
  List,
  Trash2,
  Lock,
  Unlock,
  CheckSquare,
  Square,
  ArrowLeftRight,
  SlidersHorizontal,
  Undo2,
} from 'lucide-react';
import { GearInspectSheet } from '@/components/gear/GearInspectSheet';
import { SalvageThresholdSheet } from '@/components/gear/SalvageThresholdSheet';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { useInventoryStore, useLoadoutStore, useMarketStore } from '@/store';
import { useSalvageFeedStore } from '@/store/slices/salvageFeedSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { salvageYieldFromRecycleResult } from '@/lib/gear/salvageAward';
import { formatRpcError } from '@/lib/api/rpcError';
import { isItemCompatibleWithSlot } from '@/lib/loadout/loadoutSlotCompat';
import type { GearItem } from '@/types/items';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';
import {
  isWeapon,
  isShield,
  isClassMod,
  isOrdnance,
  isRelic,
  colorOf,
  affixesOf,
  affixValue,
  topActivityModule,
  sumNodeBoosts,
  gearCardSummary,
  gearRowHeadline,
  type CardStat
} from '@/lib/gear/gearCardSummary';
import { ELEMENTS as ELEMENT_DEFS } from '@/constants/elements';

// ── Constants ────────────────────────────────────────────────────────────────

const RARITY_RANK: Record<string, number> = {
  Common: 1,
  Uncommon: 2,
  Rare: 3,
  Epic: 4,
  Legendary: 5,
};

const RARITY_ORDER = Object.values(Rarity);
const ELEMENTS = Object.values(Element);
const MANUFACTURERS = Object.values(Manufacturer);
const WEAPON_TYPES = Object.values(WeaponType);
const SOURCE_ORDER = Object.values(DropSource);

type SortKey =
  | 'combatPower'
  | 'bossPower'
  | 'farmPower'
  | 'economy'
  | 'level'
  | 'rarity'
  | 'rollQuality'
  | 'name'
  | 'recent'
  | 'shieldHp'
  | 'mitigation'
  | 'recharge'
  | 'payload'
  | 'shieldBreak'
  | 'armorBreak'
  | 'skillBoost'
  | 'nodeCount'
  | 'affixCount'
  | 'activityValue'
  | 'idleValue'
  | 'dropValue'
  | 'scrapValue';

type GearKind = 'all' | 'weapon' | 'shield' | 'ordnance' | 'classMod' | 'relic';
type ViewMode = 'list' | 'grid';

interface SortOption {
  key: SortKey;
  label: string;
}

const SORTS_BY_KIND: Record<GearKind, SortOption[]> = {
  all: [
    { key: 'combatPower', label: 'Best Overall' },
    { key: 'level', label: 'Level' },
    { key: 'rarity', label: 'Rarity' },
    { key: 'recent', label: 'Newest' },
    { key: 'activityValue', label: 'Activity Value' },
    { key: 'name', label: 'Name A-Z' },
  ],
  weapon: [
    { key: 'combatPower', label: 'DPS' },
    { key: 'bossPower', label: 'Boss' },
    { key: 'farmPower', label: 'Farm' },
    { key: 'economy', label: 'Economy' },
    { key: 'rollQuality', label: 'Roll' },
    { key: 'level', label: 'Level' },
    { key: 'rarity', label: 'Rarity' },
    { key: 'recent', label: 'Newest' },
  ],
  shield: [
    { key: 'shieldHp', label: 'HP' },
    { key: 'mitigation', label: 'Mitigation' },
    { key: 'recharge', label: 'Recharge' },
    { key: 'activityValue', label: 'Activity Value' },
    { key: 'level', label: 'Level' },
    { key: 'rarity', label: 'Rarity' },
    { key: 'recent', label: 'Newest' },
  ],
  ordnance: [
    { key: 'payload', label: 'Payload' },
    { key: 'shieldBreak', label: 'Shield Break' },
    { key: 'armorBreak', label: 'Armor Break' },
    { key: 'activityValue', label: 'Activity Value' },
    { key: 'level', label: 'Level' },
    { key: 'rarity', label: 'Rarity' },
    { key: 'recent', label: 'Newest' },
  ],
  classMod: [
    { key: 'skillBoost', label: 'Skill Boost' },
    { key: 'nodeCount', label: 'Nodes' },
    { key: 'activityValue', label: 'Activity Value' },
    { key: 'level', label: 'Level' },
    { key: 'rarity', label: 'Rarity' },
    { key: 'recent', label: 'Newest' },
  ],
  relic: [
    { key: 'idleValue', label: 'Idle Value' },
    { key: 'dropValue', label: 'Drop Value' },
    { key: 'scrapValue', label: 'Scrap Value' },
    { key: 'affixCount', label: 'Affix Count' },
    { key: 'activityValue', label: 'Activity Value' },
    { key: 'level', label: 'Level' },
    { key: 'rarity', label: 'Rarity' },
    { key: 'recent', label: 'Newest' },
  ],
};

const LOADOUT_LABELS: Record<LoadoutSlot, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  heavy: 'Heavy',
  ordnance: 'Ordnance',
  shield: 'Shield',
  classMod: 'Class Mod',
  relic: 'Relic',
};

/**
 * Element → sheet glyph for the list row's thumbnail corner badge
 * (owner ruling 2026-11-04: information rides badges and color
 * wherever a badge says it as well as a word would — the element is
 * never spelled out on the row). Picks are the sheet's plainest
 * silhouettes, chosen to survive the 13px inline size on the badge's
 * element-color field: flame / bolt / droplet / snow (snow is the
 * sheet's own Cryo glyph, DESIGN.md §7) / ring-dot for Void, and a
 * plain dot for Kinetic, the neutral element.
 */
const ELEMENT_GLYPHS: Partial<Record<Element, PxIconName>> = {
  [Element.Kinetic]: 'dot',
  [Element.Fire]: 'flame',
  [Element.Shock]: 'bolt',
  [Element.Corrosive]: 'drop',
  [Element.Cryo]: 'snow',
  [Element.Void]: 'ringDot',
};

const KIND_DEFS: Array<{ id: GearKind; label: string; short: string; icon: PxIconName }> = [
  { id: 'all', label: 'All Gear', short: 'All', icon: 'diamondIn' },
  { id: 'weapon', label: 'Weapons', short: 'Weapons', icon: 'crosshair' },
  { id: 'shield', label: 'Shields', short: 'Shields', icon: 'shield' },
  { id: 'ordnance', label: 'Ordnance', short: 'Ordnance', icon: 'bullseye' },
  { id: 'classMod', label: 'Class Mods', short: 'Mods', icon: 'star' },
  { id: 'relic', label: 'Relics', short: 'Relics', icon: 'diamond' },
];

// ── Type Guards ──────────────────────────────────────────────────────────────

const kindOf = (item: GearItem): GearKind =>
  isWeapon(item) ? 'weapon'
    : isShield(item) ? 'shield'
      : isClassMod(item) ? 'classMod'
        : isOrdnance(item) ? 'ordnance'
          : 'relic';

const kindLabel = (item: GearItem): string =>
  KIND_DEFS.find((kind) => kind.id === kindOf(item))?.label.replace(/s$/, '') ?? 'Gear';

// ── Formatting / Scoring Helpers ─────────────────────────────────────────────

function itemComparable(item: GearItem, key: SortKey): number {
  const activity = topActivityModule(item)?.value ?? 0;
  switch (key) {
    case 'combatPower': return isWeapon(item) ? item.combatPower : isShield(item) ? item.hp : isOrdnance(item) ? item.damage : affixesOf(item).length * 20;
    case 'bossPower': return isWeapon(item) ? item.bossPower : affixValue(item, ['bossDamageMod', 'survivalBoost']);
    case 'farmPower': return isWeapon(item) ? item.farmPower : affixValue(item, ['creditsPerKill', 'rareDropChanceMod', 'xpBoostMod']);
    case 'economy': return isWeapon(item) ? item.economyScore : affixValue(item, ['offlineEarningsMod', 'rareDropChanceMod', 'scrapYieldMod']) * 100;
    case 'level': return item.level ?? 1;
    case 'rarity': return RARITY_RANK[item.rarity] ?? 0;
    case 'rollQuality': return isWeapon(item) ? item.rollQuality : activity * 100;
    case 'shieldHp': return isShield(item) ? item.hp : 0;
    case 'mitigation': return isShield(item) ? item.mitigation : 0;
    case 'recharge': return isShield(item) ? item.rechargeRate : 0;
    case 'payload': return isOrdnance(item) ? item.damage : 0;
    case 'shieldBreak': return isOrdnance(item) ? item.shieldDamage : isWeapon(item) ? item.shieldDamageMod : 0;
    case 'armorBreak': return isOrdnance(item) ? item.armorDamage : isWeapon(item) ? item.armorDamageMod : 0;
    case 'skillBoost': return sumNodeBoosts(item) + affixValue(item, ['skillPoints', 'weaponDamage', 'critChance']) * 100;
    case 'nodeCount': return isClassMod(item) ? Object.keys(item.nodeBoosts).length : 0;
    case 'affixCount': return affixesOf(item).length;
    case 'activityValue': return activity * 100;
    case 'idleValue': return affixValue(item, ['offlineEarningsMod', 'offlineScrapMod', 'offlineXpMod', 'offlineMaterialMod']) * 100;
    case 'dropValue': return affixValue(item, ['rareDropChanceMod', 'cacheKeyChanceMod', 'cacheFragmentChance', 'materialFindChance']) * 100;
    case 'scrapValue': return affixValue(item, ['scrapYieldMod', 'salvageYield', 'rareMaterialChance', 'essenceExtraction']) * 100;
    case 'name':
    case 'recent':
    default:
      return 0;
  }
}

function itemElement(item: GearItem): string | null {
  return 'element' in item && typeof item.element === 'string' ? item.element : null;
}

function itemManufacturer(item: GearItem): string | null {
  return 'manufacturer' in item && typeof item.manufacturer === 'string' ? item.manufacturer : null;
}

function itemWeaponType(item: GearItem): string | null {
  return 'weaponType' in item && typeof item.weaponType === 'string' ? item.weaponType : null;
}

function itemNameSearch(item: GearItem, query: string): boolean {
  const q = query.toLowerCase();
  if (item.name.toLowerCase().includes(q)) return true;
  if (item.rarity.toLowerCase().includes(q)) return true;
  if (item.sourceTag.toLowerCase().includes(q)) return true;
  const kind = kindLabel(item);
  if (kind.toLowerCase().includes(q)) return true;
  const el = itemElement(item);
  if (el && el.toLowerCase().includes(q)) return true;
  const mfg = itemManufacturer(item);
  if (mfg && mfg.toLowerCase().includes(q)) return true;
  const wt = itemWeaponType(item);
  if (wt && wt.toLowerCase().includes(q)) return true;
  return affixesOf(item).some((affix) => affix.displayText.toLowerCase().includes(q));
}

function compareDiff(a: number, b: number, higherIsBetter = true): string {
  if (a === b) return '=';
  const diff = b - a;
  if (diff === 0) return '=';
  const better = higherIsBetter ? diff > 0 : diff < 0;
  return better ? `↑ ${diff > 0 ? '+' : ''}${Math.round(diff)}` : `↓ ${diff > 0 ? '+' : ''}${Math.round(diff)}`;
}

function loadoutSlotFor(itemId: string, slots: Record<LoadoutSlot, string | null>): LoadoutSlot | null {
  const entry = Object.entries(slots).find(([, equippedId]) => equippedId === itemId) as [LoadoutSlot, string | null] | undefined;
  return entry?.[0] ?? null;
}

// ── Small UI Components ──────────────────────────────────────────────────────

function StatPill({ stat }: { stat: CardStat }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-bg/80 px-1.5 py-0.5">
      <span className="text-[11px] font-black uppercase tracking-wide text-text-muted">{stat.label}</span>
      <span className={`truncate text-[11px] font-black ${stat.tone ?? 'text-text-primary'}`}>{stat.value}</span>
    </span>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-text-muted">{title}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

function FilterChip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-black transition-colors ${
        active ? 'border-amber bg-amber/15 text-amber' : 'border-border bg-surface text-text-muted'
      }`}
    >
      {children}
    </button>
  );
}

// ── Inventory Card ───────────────────────────────────────────────────────────

interface GearCardProps {
  item: GearItem;
  viewMode: ViewMode;
  selected: boolean;
  equippedSlot: LoadoutSlot | null;
  selectMode: boolean;
  onTap: (item: GearItem) => void;
  onCompareStart: (id: string) => void;
}

/**
 * One inventory card — grid tile or list row. Two measured rules from
 * the gear-grid perf audit (2026-11-02; 132-item veteran fixture,
 * 4x CPU throttle):
 *   - MEMOIZED on item identity + chrome flags. Unmemoized, every hub
 *     state change (search keystroke, sheet open, lock busy flag)
 *     re-ran gearCardSummary and the whole illustration subtree for
 *     all 132 items.
 *   - NO framer-motion `layout` prop. On a 132-card tree the layout
 *     projection pass was half the List→Grid switch freeze and made
 *     every re-render rewrite attributes across the tree (1,260
 *     mutation records for one filter change vs 84 without). The
 *     cards never needed layout animation — they remount on a view
 *     switch anyway; `whileTap` keeps the press feedback.
 */
const GearCard = memo(({
  item,
  viewMode,
  selected,
  equippedSlot,
  selectMode,
  onTap,
  onCompareStart,
}: GearCardProps) => {
  const equipped = !!equippedSlot;
  const color = colorOf(item);
  const summary = gearCardSummary(item);
  // Real-item invariant on the card face (redesign Wave D,
  // DESIGN.md §3): the card prints THIS instance's rolled
  // affixes — the actual displayText lines from the item —
  // not just counts and derived triage stats.
  const affixTexts = affixesOf(item).map((affix) => affix.displayText);

  if (viewMode === 'grid') {
    return (
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => onTap(item)}
        className={`relative flex min-h-[132px] flex-col gap-1.5 rounded-xl border bg-surface p-2 text-left ${
          selected ? 'border-amber ring-1 ring-amber/40' : equipped ? 'border-amber/50' : 'border-border'
        }`}
        style={{ borderLeftColor: color, borderLeftWidth: 3 }}
      >
        <div className="flex items-start justify-between gap-1">
          {selectMode ? (
            selected ? <CheckSquare size={14} className="text-amber" /> : <Square size={14} className="text-text-muted" />
          ) : equippedSlot ? (
            <span className="rounded-full bg-amber px-1.5 py-0.5 text-[11px] font-black text-bg">{LOADOUT_LABELS[equippedSlot]}</span>
          ) : <span />}
          {item.isLocked && <Lock size={10} className="text-red" />}
        </div>
        <div className="flex h-14 items-center justify-center">
          <GearIllustration item={item} size={50} showBadges={false} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-black" style={{ color }}>{item.name}</div>
          <div className="truncate text-[11px] text-text-muted">{summary.meta.join(' · ')}</div>
        </div>
        <div className="flex flex-wrap gap-1">
          {summary.primaryStats.slice(0, 2).map((stat) => <StatPill key={stat.label} stat={stat} />)}
        </div>
        {summary.badges[0] && <div className="truncate text-[11px] font-bold text-amber">{summary.badges[0]}</div>}
        {affixTexts[0] && (
          <div className="text-[11px] font-bold leading-snug text-text-secondary [overflow-wrap:anywhere]">{affixTexts[0]}</div>
        )}
      </motion.button>
    );
  }

  // LIST — a true list (owner ruling 2026-11-04, DESIGN.md §3): ONE
  // line per item on a 46px row. Identity rides the thumb + color +
  // badges, not words: rarity is the name's color and the row's
  // spine, the element is a corner badge on the thumb (element-color
  // field, sheet glyph — never the element word). Text is only what
  // earns it: level, the name, the equipped slot chip (a word-fact —
  // a badge could say "equipped" but not "as Primary"), and ONE
  // headline stat per kind. Affixes, maker, type, source, secondary
  // stats and badges live behind inspect (one tap on the row); the
  // GRID above keeps the full card face. Freeze discipline (perf
  // audit 2026-11-02 + freeze investigation 2026-11-04): memoized,
  // no `layout` prop, weapons compose at stage density here — the
  // card-density list row was ~26 ms of compose per weapon.
  const headline = gearRowHeadline(item, summary);
  const elementName = itemElement(item);
  const elementDef = elementName ? ELEMENT_DEFS[elementName as Element] : undefined;
  const elementGlyph = elementName ? ELEMENT_GLYPHS[elementName as Element] : undefined;

  return (
    <motion.div
      whileTap={{ scale: 0.99 }}
      onClick={() => onTap(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onTap(item);
      }}
      data-testid="gear-list-row"
      data-kind={kindOf(item)}
      className={`relative flex min-h-[46px] w-full items-center gap-2 rounded-lg border bg-surface px-2 text-left ${
        selected ? 'border-amber ring-1 ring-amber/40' : equipped ? 'border-amber/50' : 'border-border'
      }`}
      style={{ borderLeftColor: color, borderLeftWidth: 4 }}
    >
      {selectMode && (
        <div className="shrink-0">
          {selected ? <CheckSquare size={16} className="text-amber" /> : <Square size={16} className="text-text-muted" />}
        </div>
      )}

      <div className="relative flex w-12 shrink-0 items-center justify-center">
        <GearIllustration item={item} size={46} weaponDensity="stage" showBadges={false} />
        {elementDef && elementGlyph && (
          <span
            className="absolute bottom-0 left-0 flex h-4 w-4 items-center justify-center border border-black/70"
            style={{ backgroundColor: elementDef.color }}
            title={elementDef.name}
            data-element-badge={elementDef.id}
          >
            <PxIcon name={elementGlyph} size={13} className="text-[#171008]" />
          </span>
        )}
      </div>

      <span className="w-10 shrink-0 text-[11px] font-black tabular-nums text-text-muted">Lv {item.level}</span>

      {/* Name block: flexes, but with a floor — the equipped chip
          rides as a row-level sibling (not inside this block) and
          the stat block is width-capped, so a long relic headline
          can never starve the name to zero width again (the first
          capture's Echo Stone row lost its name entirely that way). */}
      <div className="flex min-w-16 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate text-[13px] font-black leading-tight" style={{ color }}>{item.name}</span>
        {item.isLocked && <Lock size={12} className="shrink-0 text-red" />}
      </div>

      {equippedSlot && <span className="shrink-0 rounded-full bg-amber px-1.5 py-0.5 text-[11px] font-black text-bg">{LOADOUT_LABELS[equippedSlot]}</span>}

      <div className="flex min-w-0 max-w-[38%] shrink items-baseline gap-1">
        {headline.label && (
          <span className="shrink-0 text-[11px] font-black uppercase tracking-wide text-text-muted">{headline.label}</span>
        )}
        <span className={`min-w-0 truncate text-[13px] font-black tabular-nums ${headline.tone ?? 'text-text-primary'}`}>{headline.value}</span>
      </div>

      {!selectMode && (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onCompareStart(item.id); }}
          className="shrink-0 rounded-lg border border-border bg-surface p-1.5 text-text-muted"
          aria-label={`Compare ${item.name}`}
        >
          <ArrowLeftRight size={13} />
        </button>
      )}
    </motion.div>
  );
});

// ── Component ────────────────────────────────────────────────────────────────

interface GearHubProps {
  onNavigate?: (screen: string) => void;
  /**
   * Phase 1 (one gear home): GearHub no longer equips directly. Its
   * Equip action routes here; the gear home switches to the Loadout
   * tab and opens the Slot Picker — the one equip surface — on the
   * item's slot.
   */
  onEquipRequest?: (item: GearItem, slot: LoadoutSlot) => void;
}

export const GearHub: React.FC<GearHubProps> = ({ onNavigate, onEquipRequest }) => {
  // Narrow store slices (gear-grid perf audit, 2026-11-02): the hub
  // re-renders when ITEMS or SLOTS change — a whole-store subscription
  // re-rendered all 132 cards on any write to either store. Actions
  // are stable singletons, read through getState() at call time.
  const invItems = useInventoryStore((s) => s.items);
  const slots = useLoadoutStore((s) => s.slots);
  const setMarketTab = useMarketStore((s) => s.setActiveTab);
  const setShieldTechPreselect = useMarketStore((s) => s.setShieldTechPreselect);

  // Browsing + filters
  const [activeKind, setActiveKind] = useState<GearKind>('all');
  const [search, setSearch] = useState('');
  const [filterRarity, setFilterRarity] = useState<Set<string>>(new Set());
  const [filterElement, setFilterElement] = useState<Set<string>>(new Set());
  const [filterMfg, setFilterMfg] = useState<Set<string>>(new Set());
  const [filterWtype, setFilterWtype] = useState<Set<string>>(new Set());
  const [filterSource, setFilterSource] = useState<Set<string>>(new Set());
  const [filterLocked, setFilterLocked] = useState<'all' | 'locked' | 'unlocked'>('all');
  const [filterJunk, setFilterJunk] = useState(false);
  const [filterEquippedOnly, setFilterEquippedOnly] = useState(false);

  // Sort & View
  const [sort, setSort] = useState<SortKey>('combatPower');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showSort, setShowSort] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Multi-select
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingScrapIds, setPendingScrapIds] = useState<Set<string>>(new Set());
  // Bulk salvage (0055): the threshold sheet is the one bulk door —
  // both the toolbar salvage button and the select-bar scrap button
  // open it. There is no per-item bulk loop anymore.
  const [showSalvageSheet, setShowSalvageSheet] = useState(false);

  // Compare
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);

  // Inspect
  const [inspectItem, setInspectItem] = useState<GearItem | null>(null);
  // Visible failure notices (flow audit F4/F8): an equip that cannot
  // resolve a slot and a lock that the server refuses must SAY so —
  // never close the sheet or flip a flag as if they succeeded.
  const [inspectNotice, setInspectNotice] = useState<string | null>(null);
  const [hubNotice, setHubNotice] = useState<string | null>(null);
  const [lockBusyId, setLockBusyId] = useState<string | null>(null);
  const [unequipBusy, setUnequipBusy] = useState(false);

  const equippedIds = useMemo(
    () => new Set(Object.values(slots).filter(Boolean) as string[]),
    [slots],
  );

  const kindCounts = useMemo(() => {
    const counts: Record<GearKind, { total: number; equipped: number }> = {
      all: { total: invItems.length, equipped: 0 },
      weapon: { total: 0, equipped: 0 },
      shield: { total: 0, equipped: 0 },
      ordnance: { total: 0, equipped: 0 },
      classMod: { total: 0, equipped: 0 },
      relic: { total: 0, equipped: 0 },
    };
    for (const item of invItems) {
      const kind = kindOf(item);
      counts[kind].total += 1;
      if (equippedIds.has(item.id)) {
        counts[kind].equipped += 1;
        counts.all.equipped += 1;
      }
    }
    return counts;
  }, [invItems, equippedIds]);

  const sourceOptions = useMemo(() => {
    const fromInventory = invItems.map((item) => item.sourceTag);
    return Array.from(new Set([...SOURCE_ORDER, ...fromInventory]));
  }, [invItems]);

  const activeSortOptions = SORTS_BY_KIND[activeKind];
  const effectiveSort = activeSortOptions.some((option) => option.key === sort)
    ? sort
    : activeSortOptions[0].key;
  const activeSortLabel = activeSortOptions.find((option) => option.key === effectiveSort)?.label ?? 'Sort';

  const filterCount = filterRarity.size + filterElement.size + filterMfg.size + filterWtype.size + filterSource.size
    + (filterLocked !== 'all' ? 1 : 0)
    + (filterJunk ? 1 : 0)
    + (filterEquippedOnly ? 1 : 0);

  const hasAnyFilter = search !== '' || activeKind !== 'all' || filterCount > 0;

  const clearFilters = useCallback(() => {
    setActiveKind('all');
    setSearch('');
    setFilterRarity(new Set());
    setFilterElement(new Set());
    setFilterMfg(new Set());
    setFilterWtype(new Set());
    setFilterSource(new Set());
    setFilterLocked('all');
    setFilterJunk(false);
    setFilterEquippedOnly(false);
  }, []);

  const items = useMemo(() => {
    let result = [...invItems];

    if (activeKind !== 'all') result = result.filter((item) => kindOf(item) === activeKind);
    if (search) result = result.filter((item) => itemNameSearch(item, search));
    if (filterRarity.size > 0) result = result.filter((item) => filterRarity.has(item.rarity));
    if (filterElement.size > 0) {
      result = result.filter((item) => {
        const el = itemElement(item);
        return el && filterElement.has(el);
      });
    }
    if (filterMfg.size > 0) {
      result = result.filter((item) => {
        const mfg = itemManufacturer(item);
        return mfg && filterMfg.has(mfg);
      });
    }
    if (filterWtype.size > 0) {
      result = result.filter((item) => {
        const wt = itemWeaponType(item);
        return wt && filterWtype.has(wt);
      });
    }
    if (filterSource.size > 0) result = result.filter((item) => filterSource.has(item.sourceTag));
    if (filterLocked === 'locked') result = result.filter((item) => item.isLocked);
    if (filterLocked === 'unlocked') result = result.filter((item) => !item.isLocked);
    if (filterEquippedOnly) result = result.filter((item) => equippedIds.has(item.id));
    if (filterJunk) result = result.filter((item) => !item.isLocked && !equippedIds.has(item.id));

    result.sort((a, b) => {
      const aEq = equippedIds.has(a.id) ? 1 : 0;
      const bEq = equippedIds.has(b.id) ? 1 : 0;
      if (aEq !== bEq) return bEq - aEq;

      if (effectiveSort === 'name') return a.name.localeCompare(b.name);
      if (effectiveSort === 'recent') return 0;
      if (effectiveSort === 'rarity') {
        const ra = RARITY_RANK[a.rarity] ?? 0;
        const rb = RARITY_RANK[b.rarity] ?? 0;
        if (ra !== rb) return rb - ra;
      }
      const ca = itemComparable(a, effectiveSort);
      const cb = itemComparable(b, effectiveSort);
      return cb - ca;
    });

    return result;
  }, [
    invItems,
    activeKind,
    search,
    filterRarity,
    filterElement,
    filterMfg,
    filterWtype,
    filterSource,
    filterLocked,
    filterEquippedOnly,
    filterJunk,
    effectiveSort,
    equippedIds,
  ]);

  const junkItems = useMemo(
    () => invItems.filter((item) => !item.isLocked && !equippedIds.has(item.id)),
    [invItems, equippedIds],
  );

  const compareItemA = compareA ? (invItems.find((i) => i.id === compareA) ?? null) : null;
  const compareItemB = compareB ? (invItems.find((i) => i.id === compareB) ?? null) : null;
  // The inspect sheet reads the LIVE store row, not the tap-time
  // snapshot: a verified lock/equip replaces the row, and the
  // sheet's actions (Lock ↔ Unlock, Equip) must key off the current
  // state, not the state when the sheet opened.
  const liveInspectItem = inspectItem ? (invItems.find((i) => i.id === inspectItem.id) ?? inspectItem) : null;
  // Audit UX-02: the slot the inspected item currently occupies, if
  // any — drives the Unequip action in the inspect sheet below.
  const inspectSlot = liveInspectItem ? loadoutSlotFor(liveInspectItem.id, slots) : null;

  const toggleFilter = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  // Equip intent only: pick the item's slot and hand off to the gear
  // home, which opens the Slot Picker there. Weapons target the first
  // empty weapon slot, or Primary when all three are filled (the
  // picker then offers the swap). GearHub itself never equips.
  // Flow audit F4: the old code closed the inspect sheet even when
  // the handoff went nowhere. Two failure shapes are now surfaced
  // instead: no slot resolves at all, and — because the card-summary
  // isRelic guard is a catch-all — a resolved slot the Slot Picker's
  // own strict compatibility rule (loadoutSlotCompat, the rule the
  // picker filters by) would reject, which used to strand the player
  // in an empty picker. Either way the sheet stays open with a
  // notice naming the kind.
  const equip = (item: GearItem) => {
    let slot: LoadoutSlot | null = null;
    if (isShield(item)) { slot = 'shield'; }
    else if (isClassMod(item)) { slot = 'classMod'; }
    else if (isOrdnance(item)) { slot = 'ordnance'; }
    else if (isRelic(item)) { slot = 'relic'; }
    else if (isWeapon(item)) {
      const weaponSlots: Array<'primary' | 'secondary' | 'heavy'> = ['primary', 'secondary', 'heavy'];
      slot = weaponSlots.find((s) => !slots[s]) ?? 'primary';
    }

    if (!slot || !isItemCompatibleWithSlot(item, slot)) {
      console.warn('[GearHub] equip: no picker-compatible loadout slot for item', item.id);
      setInspectNotice(`"${item.name}" can't be equipped — its kind (${kindLabel(item)}) doesn't fit any loadout slot.`);
      return;
    }
    setInspectNotice(null);
    onEquipRequest?.(item, slot);
    setInspectItem(null);
  };

  // Item lock (flow audit F8): the Gear home used to flip a bare
  // local flag that the next server sync silently overwrote — the
  // "protection" never existed server-side. Lock/unlock now go
  // through the verified op (the ChestScreen pattern): await
  // verifiedOps.itemLock, then mirror locally; on failure the flag
  // does NOT move and the player sees why.
  const toggleLock = async (item: GearItem) => {
    if (lockBusyId) return;
    setLockBusyId(item.id);
    setInspectNotice(null);
    try {
      await verifiedOps.itemLock(item.id, !item.isLocked);
      if (item.isLocked) useInventoryStore.getState().unlockItem(item.id); else useInventoryStore.getState().lockItem(item.id);
    } catch (err) {
      setInspectNotice(`Couldn't ${item.isLocked ? 'unlock' : 'lock'} "${item.name}" — ${formatRpcError(err)}`);
    } finally {
      setLockBusyId(null);
    }
  };

  // Unequip (audit UX-02): the inspect sheet's reforge copy told
  // players to "unequip it first" while the sheet offered no Unequip
  // — the only path was closing the sheet and hunting the slot in the
  // picker. Unequip is a slot operation, not an equip intent, so it
  // runs the shipped verified op directly (the itemLock pattern
  // above): the op's result sync applies the server loadout snapshot,
  // the sheet stays open on the live row, and a refusal surfaces in
  // the notice instead of failing silently.
  const unequip = async (item: GearItem) => {
    if (unequipBusy) return;
    const slot = loadoutSlotFor(item.id, slots);
    if (!slot) {
      setInspectNotice(`"${item.name}" is not in any loadout slot.`);
      return;
    }
    setUnequipBusy(true);
    setInspectNotice(null);
    try {
      await verifiedOps.unequipSlot(slot);
    } catch (err) {
      setInspectNotice(`Couldn't unequip "${item.name}" — ${formatRpcError(err)}`);
    } finally {
      setUnequipBusy(false);
    }
  };

  const scrap = async (item: GearItem) => {
    if (pendingScrapIds.has(item.id)) return;
    setPendingScrapIds((prev) => new Set(prev).add(item.id));
    try {
      const result = await verifiedOps.recycleItem(item.id);
      // Feedback names what the server actually paid — Scrap, any
      // legendary cores, and the narrow King-of-Scrap bonus material
      // (salvageYieldFromRecycleResult is the one mapper).
      useSalvageFeedStore.getState().push(item, salvageYieldFromRecycleResult(result));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    } catch (error) {
      console.warn('[GearHub] verified salvage failed:', error instanceof Error ? error.message : error);
    } finally {
      setPendingScrapIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  // Bulk lock/unlock (F8): same verified path as the single toggle,
  // sequential per item; failures are named, never swallowed.
  const bulkSetLocked = (locked: boolean) => {
    void (async () => {
      const failures: string[] = [];
      for (const id of selectedIds) {
        const item = invItems.find((i) => i.id === id);
        if (!item || item.isLocked === locked) continue;
        try {
          await verifiedOps.itemLock(id, locked);
          if (locked) useInventoryStore.getState().lockItem(id); else useInventoryStore.getState().unlockItem(id);
        } catch {
          failures.push(item.name);
        }
      }
      if (failures.length > 0) {
        setHubNotice(`Couldn't ${locked ? 'lock' : 'unlock'}: ${failures.join(', ')} — the server refused; their protection state is unchanged.`);
      }
      setSelectedIds(new Set());
      setSelectMode(false);
    })();
  };

  const bulkLock = () => bulkSetLocked(true);

  const bulkUnlock = () => bulkSetLocked(false);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => {
    setSelectedIds(new Set(items.map((item) => item.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleItemTap = useCallback((item: GearItem) => {
    if (selectMode) {
      toggleSelect(item.id);
      return;
    }
    if (compareA !== null && compareA !== item.id) {
      setCompareB(item.id);
      return;
    }
    setInspectNotice(null);
    setInspectItem(item);
  }, [selectMode, compareA, toggleSelect]);

  const startCompare = useCallback((id: string) => {
    setCompareA(id);
    setCompareB(null);
  }, []);

  const activeFilterLabels = [
    activeKind !== 'all' ? KIND_DEFS.find((kind) => kind.id === activeKind)?.short ?? 'Kind' : null,
    ...Array.from(filterRarity),
    ...Array.from(filterElement),
    ...Array.from(filterMfg),
    ...Array.from(filterWtype),
    ...Array.from(filterSource),
    filterLocked !== 'all' ? (filterLocked === 'locked' ? 'Locked' : 'Unlocked') : null,
    filterEquippedOnly ? 'Equipped' : null,
    filterJunk ? 'Salvage candidates' : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-2.5 px-4">
      {/* Section header + controls, sticky (merged Gear page,
          2026-11-03): on the one-scroll page the section keeps its
          name, count, kind rail, search, and toolbar in reach while
          its rows scroll beneath — the mock's .sec-h pattern. The
          bordered bar is the rail's own language over the page
          gradient. */}
      <div className="sticky top-0 z-20 -mx-4 space-y-2.5 border-b border-border/60 bg-bg/95 px-4 pb-2 pt-2 backdrop-blur-sm">
      {/* Compact header — the section is "Inventory" on the merged
          page (the Grid retired as a place; this is its content). */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-base font-black leading-tight text-text-primary">Inventory</div>
          <div className="truncate text-[11px] text-text-muted">Mobile gear triage: compare, equip, salvage, sell.</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasAnyFilter && (
            <button onClick={clearFilters} className="rounded-full border border-red/30 bg-red/10 px-2 py-1 text-[11px] font-black text-red">
              Reset
            </button>
          )}
          <div className="rounded-full border border-border bg-surface px-2 py-1 text-[11px] font-black text-amber">
            {items.length}/{invItems.length}
          </div>
        </div>
      </div>

      {/* Gear-kind rail: first-class mobile navigation, one row only. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-0.5">
        <div className="flex min-w-max gap-1.5">
          {KIND_DEFS.map(({ id, short, icon }) => {
            const active = activeKind === id;
            const counts = kindCounts[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveKind(id)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-black transition-colors ${
                  active ? 'border-amber bg-amber/15 text-amber' : 'border-border bg-surface text-text-muted'
                }`}
              >
                <PxIcon name={icon} size={13} />
                <span>{short}</span>
                <span className={active ? 'text-amber/80' : 'text-text-muted/70'}>{counts.total}</span>
                {counts.equipped > 0 && <span className="rounded-full bg-amber px-1 py-0 text-[11px] text-bg">{counts.equipped} EQ</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, stat, effect, source..."
          className="h-9 w-full rounded-lg border border-border bg-surface-raised pl-8 pr-8 text-xs text-text-primary placeholder:text-text-muted"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Compact toolbar */}
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSort((prev) => !prev)}
            className="flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2 text-[11px] font-black text-text-muted"
          >
            <ArrowUpDown size={12} />
            {activeSortLabel}
          </button>
          {showSort && (
            <div className="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
              {activeSortOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => { setSort(option.key); setShowSort(false); }}
                  className={`w-full px-3 py-1.5 text-left text-[11px] font-black transition-colors ${
                    effectiveSort === option.key ? 'bg-amber/15 text-amber' : 'text-text-muted hover:bg-surface-raised'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowFilters(true)}
          className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-black transition-colors ${
            filterCount > 0 ? 'border-amber bg-amber/10 text-amber' : 'border-border bg-surface text-text-muted'
          }`}
        >
          <SlidersHorizontal size={12} />
          Filters{filterCount > 0 ? ` ${filterCount}` : ''}
        </button>

        <button
          type="button"
          onClick={() => setViewMode((mode) => (mode === 'list' ? 'grid' : 'list'))}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-text-muted"
          aria-label="Toggle inventory layout"
        >
          {viewMode === 'list' ? <LayoutGrid size={14} /> : <List size={14} />}
        </button>

        <button
          type="button"
          onClick={() => { setSelectMode((prev) => !prev); setSelectedIds(new Set()); }}
          className={`h-8 rounded-lg border px-2 text-[11px] font-black transition-colors ${
            selectMode ? 'border-amber bg-amber/10 text-amber' : 'border-border bg-surface text-text-muted'
          }`}
        >
          {selectMode ? 'Done' : 'Select'}
        </button>

        <div className="flex-1" />

        {junkItems.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSalvageSheet(true)}
            aria-label="Salvage by rarity"
            className="flex h-8 items-center gap-1 rounded-lg border border-red/30 bg-red/10 px-2 text-[11px] font-black text-red"
          >
            <Trash2 size={11} />
            {junkItems.length}
          </button>
        )}
      </div>
      </div>

      {/* Active filters: one horizontal row, never a wrapped wall. */}
      {activeFilterLabels.length > 0 && (
        <div className="-mx-4 overflow-x-auto px-4">
          <div className="flex min-w-max gap-1.5">
            {activeFilterLabels.slice(0, 10).map((label) => (
              <span key={label} className="rounded-full border border-amber/30 bg-amber/10 px-2 py-0.5 text-[11px] font-black text-amber">
                {label}
              </span>
            ))}
            {activeFilterLabels.length > 10 && (
              <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-black text-text-muted">
                +{activeFilterLabels.length - 10}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bulk-action failure notice (F8) */}
      {hubNotice && (
        <div className="flex items-start justify-between gap-2 border border-red/40 bg-red/10 p-2 text-[11px] font-bold text-red-light" role="alert">
          <span>{hubNotice}</span>
          <button type="button" onClick={() => setHubNotice(null)} className="shrink-0 text-red-light/70 hover:text-red-light" aria-label="Dismiss notice">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      <AnimatePresence>
        {selectMode && selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2 rounded-xl border border-amber/40 bg-amber/10 p-2"
          >
            <span className="text-[11px] font-black text-amber">{selectedIds.size} selected</span>
            <button onClick={selectAll} className="text-[11px] text-text-muted">All</button>
            <button onClick={deselectAll} className="text-[11px] text-text-muted">None</button>
            <div className="flex-1" />
            <button onClick={bulkLock} aria-label="Lock selected" className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-black text-text-muted">
              <Lock size={12} />
            </button>
            <button onClick={bulkUnlock} aria-label="Unlock selected" className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-black text-text-muted">
              <Unlock size={12} />
            </button>
            <button onClick={() => setShowSalvageSheet(true)} aria-label="Scrap by rarity" className="rounded-lg border border-red/40 bg-red/10 px-2 py-1 text-[11px] font-black text-red">
              <Trash2 size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Item list */}
      {items.length === 0 && (
        <div className="py-8 text-center">
          <div className="text-sm text-text-muted">
            {hasAnyFilter ? 'No gear matches these filters.' : 'No gear in inventory.'}
          </div>
          {hasAnyFilter && (
            <button onClick={clearFilters} className="mt-2 text-xs font-black text-amber">Clear filters</button>
          )}
        </div>
      )}

      <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-1.5'}>
        {items.map((item) => (
          <GearCard
            key={item.id}
            item={item}
            viewMode={viewMode}
            selected={selectedIds.has(item.id)}
            equippedSlot={loadoutSlotFor(item.id, slots)}
            selectMode={selectMode}
            onTap={handleItemTap}
            onCompareStart={startCompare}
          />
        ))}
      </div>

      {/* Filter sheet */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowFilters(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="max-h-[78vh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl border-t-2 border-border bg-bg p-3 shadow-[0_-12px_32px_rgba(0,0,0,0.75)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-black text-text-primary">Filters</div>
                  <div className="text-[11px] text-text-muted">Hidden by default so the Gear tab stays dense.</div>
                </div>
                <div className="flex items-center gap-2">
                  {filterCount > 0 && <button type="button" onClick={clearFilters} className="text-[11px] font-black text-red">Reset</button>}
                  <button type="button" onClick={() => setShowFilters(false)} className="rounded-lg border border-border bg-surface p-2 text-text-muted">
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <FilterSection title="State">
                  <FilterChip active={filterEquippedOnly} onClick={() => setFilterEquippedOnly((prev) => !prev)}>Equipped</FilterChip>
                  <FilterChip active={filterLocked === 'locked'} onClick={() => setFilterLocked((prev) => (prev === 'locked' ? 'all' : 'locked'))}>Locked</FilterChip>
                  <FilterChip active={filterLocked === 'unlocked'} onClick={() => setFilterLocked((prev) => (prev === 'unlocked' ? 'all' : 'unlocked'))}>Unlocked</FilterChip>
                  <FilterChip active={filterJunk} onClick={() => setFilterJunk((prev) => !prev)}>Salvage candidates</FilterChip>
                </FilterSection>

                <FilterSection title="Rarity">
                  {RARITY_ORDER.map((rarity) => (
                    <FilterChip key={rarity} active={filterRarity.has(rarity)} onClick={() => toggleFilter(setFilterRarity, rarity)}>
                      {rarity}
                    </FilterChip>
                  ))}
                </FilterSection>

                {(activeKind === 'all' || activeKind === 'weapon' || activeKind === 'shield' || activeKind === 'ordnance') && (
                  <FilterSection title="Element">
                    {ELEMENTS.map((element) => (
                      <FilterChip key={element} active={filterElement.has(element)} onClick={() => toggleFilter(setFilterElement, element)}>
                        {element}
                      </FilterChip>
                    ))}
                  </FilterSection>
                )}

                {(activeKind === 'all' || activeKind === 'weapon') && (
                  <>
                    <FilterSection title="Weapon Type">
                      {WEAPON_TYPES.map((weaponType) => (
                        <FilterChip key={weaponType} active={filterWtype.has(weaponType)} onClick={() => toggleFilter(setFilterWtype, weaponType)}>
                          {weaponType}
                        </FilterChip>
                      ))}
                    </FilterSection>

                    <FilterSection title="Manufacturer">
                      {MANUFACTURERS.map((manufacturer) => (
                        <FilterChip key={manufacturer} active={filterMfg.has(manufacturer)} onClick={() => toggleFilter(setFilterMfg, manufacturer)}>
                          {manufacturer}
                        </FilterChip>
                      ))}
                    </FilterSection>
                  </>
                )}

                <FilterSection title="Source">
                  {sourceOptions.map((source) => (
                    <FilterChip key={source} active={filterSource.has(source)} onClick={() => toggleFilter(setFilterSource, source)}>
                      {source}
                    </FilterChip>
                  ))}
                </FilterSection>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compare sheet */}
      <AnimatePresence>
        {compareA && compareB && compareItemA && compareItemB && (
          <motion.div
            className="fixed inset-0 z-[75] flex items-end justify-center bg-black/85"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { setCompareA(null); setCompareB(null); }}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl border-t-2 border-border bg-bg p-4"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-black text-text-primary">Compare Gear</div>
                <button onClick={() => { setCompareA(null); setCompareB(null); }} className="text-text-muted"><X size={18} /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border bg-surface p-3">
                  <div className="mb-2 flex justify-center">
                    <GearIllustration item={compareItemA} size={72} showBadges={false} />
                  </div>
                  <div className="text-[11px] font-black" style={{ color: colorOf(compareItemA) }}>{compareItemA.name}</div>
                  <div className="text-[11px] text-text-muted">{compareItemA.rarity} · Lv.{compareItemA.level}</div>
                  {isWeapon(compareItemA) && (
                    <div className="mt-1 space-y-0.5 text-[11px]">
                      <div className="text-text-muted">PWR: {compareItemA.combatPower}</div>
                      <div className="text-text-muted">DMG: {compareItemA.baseDamage}</div>
                      <div className="text-text-muted">Crit: {Math.round(compareItemA.critChance * 100)}%</div>
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-border bg-surface p-3">
                  <div className="mb-2 flex justify-center">
                    <GearIllustration item={compareItemB} size={72} showBadges={false} />
                  </div>
                  <div className="text-[11px] font-black" style={{ color: colorOf(compareItemB) }}>{compareItemB.name}</div>
                  <div className="text-[11px] text-text-muted">{compareItemB.rarity} · Lv.{compareItemB.level}</div>
                  {isWeapon(compareItemB) && isWeapon(compareItemA) && (
                    <div className="mt-1 space-y-0.5 text-[11px]">
                      <div className={compareItemB.combatPower > compareItemA.combatPower ? 'text-green' : compareItemB.combatPower < compareItemA.combatPower ? 'text-red' : 'text-text-muted'}>
                        PWR: {compareItemB.combatPower} ({compareDiff(compareItemA.combatPower, compareItemB.combatPower)})
                      </div>
                      <div className={compareItemB.baseDamage > compareItemA.baseDamage ? 'text-green' : compareItemB.baseDamage < compareItemA.baseDamage ? 'text-red' : 'text-text-muted'}>
                        DMG: {compareItemB.baseDamage} ({compareDiff(compareItemA.baseDamage, compareItemB.baseDamage)})
                      </div>
                      <div className={compareItemB.critChance > compareItemA.critChance ? 'text-green' : compareItemB.critChance < compareItemA.critChance ? 'text-red' : 'text-text-muted'}>
                        Crit: {Math.round(compareItemB.critChance * 100)}% ({compareDiff(compareItemA.critChance, compareItemB.critChance)})
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 text-center text-[11px] text-text-muted">
                {compareItemA.name} vs {compareItemB.name}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk salvage threshold sheet (0055) */}
      {showSalvageSheet && (
        <SalvageThresholdSheet
          eligibleItems={junkItems}
          onClose={() => setShowSalvageSheet(false)}
          onSettled={() => {
            setSelectedIds(new Set());
            setSelectMode(false);
          }}
        />
      )}

      {/* Inspect sheet */}
      <GearInspectSheet
        item={liveInspectItem}
        open={!!inspectItem}
        onClose={() => { setInspectItem(null); setInspectNotice(null); }}
        contextLabel="Inventory Inspect"
        allowReforge
        actions={liveInspectItem ? (
          <div className="grid grid-cols-4 gap-2">
            {inspectNotice && (
              <div className="col-span-4 border border-red/40 bg-red/10 p-2 text-[11px] font-bold text-red-light" role="alert">
                {inspectNotice}
              </div>
            )}
            {inspectSlot ? (
              <button type="button" disabled={unequipBusy} onClick={() => void unequip(liveInspectItem)} className="flex flex-col items-center gap-1 border border-border bg-surface py-2 text-[11px] font-black text-text-secondary disabled:opacity-50">
                <Undo2 size={15} />
                {unequipBusy ? 'Working…' : 'Unequip'}
              </button>
            ) : (
              <button type="button" onClick={() => equip(liveInspectItem)} className="flex flex-col items-center gap-1 border border-amber/40 bg-amber/10 py-2 text-[11px] font-black text-amber">
                <PxIcon name="crosshair" size={13} />Equip
              </button>
            )}
            <button type="button" onClick={() => onNavigate?.('market')} className="flex flex-col items-center gap-1 border border-green/40 bg-green/10 py-2 text-[11px] font-black text-green">
              <ArrowLeftRight size={15} />Market
            </button>
            <button type="button" disabled={lockBusyId === liveInspectItem.id} onClick={() => void toggleLock(liveInspectItem)} className="flex flex-col items-center gap-1 border border-border bg-surface py-2 text-[11px] font-black text-text-secondary disabled:opacity-50">
              {liveInspectItem.isLocked ? <Unlock size={15} /> : <Lock size={15} />}
              {lockBusyId === liveInspectItem.id ? 'Working…' : liveInspectItem.isLocked ? 'Unlock' : 'Lock'}
            </button>
            <button type="button" onClick={() => void scrap(liveInspectItem)} className="flex flex-col items-center gap-1 border border-red/40 bg-red/10 py-2 text-[11px] font-black text-red">
              <Trash2 size={15} />Salvage
            </button>
            {isShield(liveInspectItem) && !inspectSlot && !liveInspectItem.isLocked && (
              <button
                type="button"
                onClick={() => {
                  // Shield-tech deep link (0044): hand the shield to
                  // the Shield Tech tab's post form. Only AVAILABLE
                  // shields recalibrate — equipped/locked shields are
                  // refused by the server, so the action hides here.
                  setShieldTechPreselect(liveInspectItem.id);
                  setMarketTab('shieldTech');
                  setInspectItem(null);
                  setInspectNotice(null);
                  onNavigate?.('market');
                }}
                className="col-span-4 flex items-center justify-center gap-2 border border-cyan/40 bg-cyan/10 py-2 text-[11px] font-black text-cyan"
              >
                <PxIcon name="shield" size={13} />Recalibrate behavior…
              </button>
            )}
          </div>
        ) : undefined}
      />

    </div>
  );
};
