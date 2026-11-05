/**
 * Activity Log view model (AL-3) — pure presentation math over
 * AL-2's records. Everything here formats facts the server
 * recorded; nothing is estimated or back-computed:
 *
 *  - A drop's headline chance exists only when AL-1 stamped the
 *    inputs (rarityWeights, and gearChance when the roll was a
 *    tick roll). Kill-caused drops were guaranteed by the kill, so
 *    their stamp carries the rarity roll's shaping facts instead —
 *    the headline is then the rarity share, labelled as such.
 *  - A cache draw's shaped rarity weight is not in the record
 *    (cache quality shapes it server-side), so cache records show
 *    the recorded draw facts — roll, total weight, table version —
 *    and never a percentage the record can't prove.
 *  - Pre-stamp drops (receipt: null) get no provenance line at
 *    all. The one receipts divider marks where the stamped record
 *    begins; below it, entries say "predates item records".
 */
import type { PxIconName } from '@/lib/pixel/icons';
import type {
  ActivityDropOdds, ActivityEarnings, ActivityRecord,
} from '@/lib/api/activityLogService';

// ---------------------------------------------------------------------------
// Rarity + kind presentation (colors are data — DESIGN.md §5).
// ---------------------------------------------------------------------------

export const RARITY_HEX: Record<string, string> = {
  Common: '#A5A7B5',
  Uncommon: '#7CFC00',
  Rare: '#5AA7FF',
  Epic: '#FF9DF5',
  Legendary: '#FFEA3A',
};

export function rarityHex(rarity: string | null | undefined): string {
  return (rarity && RARITY_HEX[rarity]) || '#A5A7B5';
}

const ITEM_KIND_LABELS: Record<string, string> = {
  weapon: 'Weapon',
  shield: 'Shield',
  relic: 'Relic',
  classMod: 'Class Mod',
  classmod: 'Class Mod',
  ordnance: 'Ordnance',
  vehicle: 'Vehicle',
  consumable: 'Consumable',
  material: 'Material',
  essence: 'Essence',
  fragment: 'Cache Fragments',
  core: 'Legendary Core',
};

export function itemKindLabel(kind: string | null | undefined): string {
  if (!kind) return 'Item';
  return ITEM_KIND_LABELS[kind] ?? kind;
}

const ITEM_KIND_ICONS: Record<string, PxIconName> = {
  weapon: 'gun',
  shield: 'shield',
  relic: 'diamondIn',
  classMod: 'chip',
  classmod: 'chip',
  ordnance: 'burst',
  vehicle: 'wheel',
  consumable: 'vial',
  material: 'scrap',
  essence: 'flask',
  fragment: 'frag',
  core: 'core',
};

export function itemKindIcon(kind: string | null | undefined): PxIconName {
  return (kind && ITEM_KIND_ICONS[kind]) || 'loot';
}

const RECORD_KIND_ICONS: Record<ActivityRecord['kind'], PxIconName> = {
  drop: 'loot',
  kills: 'crosshair',
  boss: 'skull',
  cache: 'crate',
  craft: 'hammer',
  market: 'tag',
  earnings: 'coin',
  settlement: 'clock',
  salvage: 'recycle',
  dispatch: 'signal',
  endless: 'infinity',
  system: 'info',
};

export function recordKindIcon(record: ActivityRecord): PxIconName {
  // Item-carrying records wear their item's plate, not the kind's.
  if (record.item) return itemKindIcon(record.item.kind);
  return RECORD_KIND_ICONS[record.kind];
}

// ---------------------------------------------------------------------------
// Odds — display math over the recorded stamp only.
// ---------------------------------------------------------------------------

export interface DropChance {
  /** The chance as a fraction (0..1). */
  fraction: number;
  pct: string;
  oneIn: string;
  /** What the fraction describes, in player words. */
  basis: 'tick' | 'rarity-roll' | 'dedicated';
}

function weightShare(weights: Record<string, number> | undefined, rarity: string | null | undefined): number | null {
  if (!weights || !rarity) return null;
  let total = 0;
  let mine: number | null = null;
  for (const [key, value] of Object.entries(weights)) {
    if (typeof value !== 'number' || !(value > 0)) continue;
    total += value;
    if (key.toLowerCase() === rarity.toLowerCase()) mine = value;
  }
  if (mine === null || total <= 0) return null;
  return mine / total;
}

/** Format a fraction as the log's chance figure: 0.8% · 2.6% · 64%. */
export function formatChancePct(fraction: number): string {
  const pct = fraction * 100;
  if (pct >= 9.95) return `${Math.round(pct)}%`;
  if (pct >= 0.995) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2).replace(/0$/, '')}%`;
}

export function formatOneIn(fraction: number): string {
  if (!(fraction > 0) || fraction >= 1) return '1 in 1';
  return `1 in ~${Math.max(2, Math.round(1 / fraction)).toLocaleString('en-US')}`;
}

/**
 * The headline chance for a drop record, or null when the stamp
 * can't prove one. Tick rolls multiply the tick's gear chance by
 * the item's rarity share of the shaped weights; kill-caused
 * drops (no gearChance — the kill guaranteed the drop) headline
 * the rarity share alone; a boss item the dedicated roll produced
 * headlines the dedicated chance.
 */
export function dropChance(record: ActivityRecord): DropChance | null {
  const odds: ActivityDropOdds | null | undefined = record.receipt?.dropOdds;
  if (!odds) return null;
  if (odds.dedicatedHit && typeof odds.dedicatedChance === 'number' && odds.dedicatedChance > 0) {
    return {
      fraction: odds.dedicatedChance,
      pct: formatChancePct(odds.dedicatedChance),
      oneIn: formatOneIn(odds.dedicatedChance),
      basis: 'dedicated',
    };
  }
  const share = weightShare(odds.rarityWeights, record.item?.rarity);
  if (share === null) return null;
  if (typeof odds.gearChance === 'number' && odds.gearChance > 0) {
    const fraction = odds.gearChance * share;
    return { fraction, pct: formatChancePct(fraction), oneIn: formatOneIn(fraction), basis: 'tick' };
  }
  return { fraction: share, pct: formatChancePct(share), oneIn: formatOneIn(share), basis: 'rarity-roll' };
}

/** The boss fight's own recorded chance line (the sim's number for that fight). */
export function bossWinChance(record: ActivityRecord): DropChance | null {
  const win = record.boss?.winChance;
  if (typeof win !== 'number' || !(win > 0)) return null;
  return { fraction: win, pct: formatChancePct(win), oneIn: formatOneIn(win), basis: 'tick' };
}

// ---------------------------------------------------------------------------
// Time — bands, clocks, elapsed.
// ---------------------------------------------------------------------------

export function clockTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fullWhen(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} · ${clockTime(at)}`;
}

export interface TimeBand { key: string; label: string }

export function timeBand(at: string, now: Date = new Date()): TimeBand {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return { key: 'unknown', label: 'EARLIER' };
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (dayDiff <= 0) return { key: `d-${startOfDay(d)}`, label: 'TODAY' };
  if (dayDiff === 1) return { key: `d-${startOfDay(d)}`, label: 'YESTERDAY' };
  const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  return { key: `d-${startOfDay(d)}`, label };
}

/** "6h 12m away" / "45m away" / "2d 3h away" for settlement facts. */
export function elapsedLabel(elapsedMs: number | null | undefined): string | null {
  if (typeof elapsedMs !== 'number' || !(elapsedMs > 0)) return null;
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// ---------------------------------------------------------------------------
// Card faces — identity + headline numbers (detail lives in the sheet).
// ---------------------------------------------------------------------------

const fmtNum = (n: number): string => n.toLocaleString('en-US');
const signed = (n: number): string => `${n > 0 ? '+' : ''}${fmtNum(n)}`;

function materialParts(map: Record<string, number> | undefined, sign: '+' | ''): string[] {
  return Object.entries(map ?? {}).map(([name, count]) => `${sign}${fmtNum(count)} ${name}`);
}

/** The earnings amounts line, from the record's own deltas. */
export function earningsLine(earnings: ActivityEarnings | undefined): string {
  if (!earnings) return '';
  const parts: string[] = [];
  if (earnings.credits) parts.push(`${signed(earnings.credits)} cr`);
  if (earnings.scrap) parts.push(`${signed(earnings.scrap)} scrap`);
  if (earnings.xp) parts.push(`+${fmtNum(earnings.xp)} XP`);
  if (earnings.fragments) parts.push(`+${fmtNum(earnings.fragments)} fragments`);
  if (earnings.cacheKeys) parts.push(`+${fmtNum(earnings.cacheKeys)} cache key${earnings.cacheKeys === 1 ? '' : 's'}`);
  parts.push(...materialParts(earnings.materials, '+'));
  parts.push(...materialParts(earnings.essences, '+'));
  return parts.join(' · ');
}

/** The source half of a server earnings label ("Roaming claim — +…" → "Roaming claim"). */
function labelSource(label: string): string {
  const idx = label.indexOf(' — ');
  return idx > 0 ? label.slice(0, idx) : label;
}

export interface RecordFace { title: string; detail: string | null }

export function recordFace(record: ActivityRecord): RecordFace {
  const itemName = record.item?.name ?? null;
  switch (record.kind) {
    case 'drop':
      return {
        title: itemName ?? record.label,
        detail: record.receipt === null
          ? 'Source not recorded'
          : record.label,
      };
    case 'salvage':
      return {
        title: itemName ? `Salvaged ${itemName}` : record.label,
        detail: record.salvage
          ? `+${fmtNum(record.salvage.scrapAward)} scrap${record.salvage.coresAward > 0 ? ` · +${record.salvage.coresAward} cores` : ''}`
          : null,
      };
    case 'cache':
      return {
        title: itemName ?? record.label,
        detail: record.cache
          ? `Cache${record.cache.outcome ? ` — ${record.cache.outcome}` : ''}${record.cache.payment ? ` · ${cachePaymentLabel(record.cache.payment)}` : ''}`
          : record.label,
      };
    case 'market': {
      const m = record.market;
      if (!m) return { title: itemName ?? record.label, detail: null };
      const goods = itemName ?? (m.goodsKey ? goodsDisplayName(m.goodsKey) : 'goods');
      const counterparty = m.counterpartyName
        ?? (m.direction === 'bought' ? 'the market' : null);
      return {
        title: `${m.direction === 'bought' ? 'Bought' : 'Sold'} ${goods}`,
        detail: `${fmtNum(m.priceCredits)} cr${counterparty ? ` · ${m.direction === 'bought' ? 'from' : 'to'} ${counterparty}` : ''}${m.feeCredits ? ` · fee ${fmtNum(m.feeCredits)} cr` : ''}`,
      };
    }
    case 'earnings':
      return { title: labelSource(record.label), detail: earningsLine(record.earnings) || null };
    case 'settlement': {
      const s = record.settlement;
      const parts: string[] = [];
      const elapsed = elapsedLabel(s?.elapsedMs);
      if (elapsed) parts.push(`${elapsed} away`);
      if (s?.ticks) parts.push(`${fmtNum(s.ticks)} ticks settled`);
      if (s?.capReached) parts.push('offline cap reached');
      return { title: record.label, detail: parts.join(' · ') || null };
    }
    case 'boss': {
      const b = record.boss;
      if (!b) return { title: record.label, detail: null };
      const parts: string[] = [];
      if (b.creditsGained > 0) parts.push(`+${fmtNum(b.creditsGained)} cr`);
      if (b.creditsLost > 0) parts.push(`−${fmtNum(b.creditsLost)} cr`);
      if (b.loot.length > 0) parts.push(`${b.loot.length} loot`);
      return { title: record.label, detail: parts.join(' · ') || null };
    }
    case 'craft': {
      const c = record.craft;
      if (!c) return { title: record.label, detail: null };
      const outputs = c.outputs.map((o) => `×${o.count} ${o.name ?? 'output'}`).join(' · ');
      return {
        title: record.label,
        detail: `${outputs || `${c.unitsCompleted} units`}${c.xpAwarded > 0 ? ` · +${fmtNum(c.xpAwarded)} XP` : ''}`,
      };
    }
    case 'dispatch': {
      const d = record.dispatch;
      return {
        title: record.label,
        detail: d ? `+${fmtNum(d.payoutCredits)} cr${d.payoutFraction !== null && d.payoutFraction < 1 ? ` · ${Math.round(d.payoutFraction * 100)}% paid` : ''}` : null,
      };
    }
    case 'endless':
      return {
        title: record.label,
        detail: record.endless ? `Depth ${record.endless.depthReached} · ${record.endless.status}` : null,
      };
    case 'kills':
      return { title: record.label, detail: record.areaName ? `Roaming · ${record.areaName}` : null };
    default:
      return { title: record.label, detail: null };
  }
}

export function cachePaymentLabel(payment: string): string {
  switch (payment) {
    case 'free': return 'daily free box';
    case 'key': return 'cache key';
    case 'ad': return 'rewarded ad';
    default: return payment;
  }
}

/** Vendor goods keys print as their display names, never raw ids. */
export function goodsDisplayName(goodsKey: string): string {
  return goodsKey
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

/** foundVia in player words. */
export function foundViaLabel(foundVia: string): string {
  switch (foundVia) {
    case 'roam': return 'Roaming';
    case 'offline': return 'While away — offline roaming';
    case 'boss': return 'Boss fight';
    case 'cache': return 'Cache';
    case 'endless': return 'Endless';
    case 'event': return 'Event';
    default: return foundVia;
  }
}

// ---------------------------------------------------------------------------
// Stream decoration — the two dividers, computed over the loaded
// stream (newest first). A divider is a fact about the records
// around it, so it is derived here, never stored.
// ---------------------------------------------------------------------------

export interface DecoratedRecord {
  record: ActivityRecord;
  /** Print the "While you were away" divider directly above this record. */
  awayDivider: boolean;
  /** Print the "Receipts begin here" divider directly above this record. */
  receiptsDivider: boolean;
}

export function decorateStream(records: ActivityRecord[]): DecoratedRecord[] {
  let sawStampedDrop = false;
  let receiptsDividerSpent = false;
  return records.map((record, index) => {
    const prev = index > 0 ? records[index - 1] : null;
    const awayDivider = record.away && !(prev?.away ?? false);
    let receiptsDivider = false;
    if (record.kind === 'drop') {
      if (record.receipt) {
        sawStampedDrop = true;
      } else if (sawStampedDrop && !receiptsDividerSpent) {
        receiptsDivider = true;
        receiptsDividerSpent = true;
      }
    }
    return { record, awayDivider, receiptsDivider };
  });
}

/** Group the decorated stream under its time signs, preserving order. */
export interface StreamBand {
  key: string;
  label: string;
  entries: DecoratedRecord[];
}

export function bandStream(decorated: DecoratedRecord[], now: Date = new Date()): StreamBand[] {
  const bands: StreamBand[] = [];
  for (const entry of decorated) {
    const band = timeBand(entry.record.at, now);
    const last = bands[bands.length - 1];
    if (last && last.key === band.key) last.entries.push(entry);
    else bands.push({ key: band.key, label: band.label, entries: [entry] });
  }
  return bands;
}
