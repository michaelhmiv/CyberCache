import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock, X } from 'lucide-react';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { ReforgePanel } from '@/components/gear/ReforgePanel';
import { RARITIES, rollQualityLabel } from '@/constants/rarities';
import { calculateSalvageYield } from '@/constants/salvageRules';
import { useBossStore, useInventoryStore, useLoadoutStore, useMarketStore } from '@/store';
import { computeLoadoutDps, computeStandardDps } from '@/lib/stats/dpsChain';
import { REGION_1_BOSSES } from '@/constants/bosses';
import {
  SHIELD_BEHAVIORS,
  describeShieldBehavior,
  shieldBehaviorOf,
} from '@/lib/combat/shieldBehaviors';
import type { Affix, ClassMod, GearItem, Ordnance, Relic, Shield as ShieldItem, Weapon } from '@/types/items';
import type { Listing } from '@/types/market';

const panelClip = { clipPath: 'polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)' };
const slashClip = { clipPath: 'polygon(9px 0,100% 0,calc(100% - 9px) 100%,0 100%)' };
const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
const isShield = (item: GearItem): item is ShieldItem => 'hp' in item && !isWeapon(item);
const isClassMod = (item: GearItem): item is ClassMod => 'treeBonus' in item;
const isOrdnance = (item: GearItem): item is Ordnance => 'damage' in item && 'effect' in item && !isWeapon(item);
const _isRelic = (item: GearItem): item is Relic => 'affixes' in item && !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item);
const affixesOf = (item: GearItem): Affix[] => ('affixes' in item && Array.isArray(item.affixes) ? item.affixes : []);
const kindOf = (item: GearItem) => (isWeapon(item) ? 'Weapon' : isShield(item) ? 'Shield' : isClassMod(item) ? 'Class Mod' : isOrdnance(item) ? 'Ordnance' : 'Relic');
const pct = (value: number) => `${Math.round(value * 100)}%`;
const signedPct = (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
const n = (value: number) => Number.isFinite(value) ? value.toLocaleString() : '0';

function similar(item: GearItem, listing: Listing) {
  const other = listing.itemSnapshot;
  if (!other) return false;
  if (kindOf(item) !== kindOf(other) || other.rarity !== item.rarity) return false;
  if (Math.abs((other.level ?? 1) - (item.level ?? 1)) > 5) return false;
  if (isWeapon(item) && isWeapon(other)) return other.weaponType === item.weaponType && other.manufacturer === item.manufacturer && other.element === item.element;
  return true;
}

function StatLine({ label, value, tone = 'text-text-primary', width = 50 }: { label: string; value: React.ReactNode; tone?: string; width?: number }) {
  return (
    <div className="relative overflow-hidden border border-border bg-bg/75 px-2 py-1.5" style={slashClip}>
      <div className="absolute bottom-0 left-0 h-1 bg-amber/75" style={{ width: `${Math.max(6, Math.min(100, width))}%` }} />
      <div className="flex items-center justify-between gap-3"><span className="text-[9px] font-black uppercase tracking-wide text-text-muted">{label}</span><span className={`text-xs font-black ${tone}`}>{value}</span></div>
    </div>
  );
}

function Tape({ title, glyph, icon: Icon, children }: { title: string; glyph?: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="relative mt-3 overflow-hidden border-2 border-border bg-surface/95 p-3 shadow-[5px_5px_0_rgba(0,0,0,0.42)]" style={panelClip}>
      <div className="pointer-events-none absolute -right-8 top-2 h-5 w-28 rotate-12 bg-amber/10" />
      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber">{Icon ? <Icon size={14} /> : glyph ? <span style={{ fontSize: '14px' }}>{glyph}</span> : null}{title}</div>
      {children}
    </section>
  );
}

function Visual({ item }: { item: GearItem }) {
  return (
    <motion.div
      className="relative flex h-48 items-center justify-center"
      animate={isWeapon(item) ? { y: [0, -4, 0], rotate: [-1, 1, -1] } : { scale: [1, 1.03, 1], y: [0, -4, 0] }}
      transition={{ duration: isWeapon(item) ? 2.6 : 2.2, repeat: Infinity }}
    >
      {isWeapon(item) && <div className="absolute inset-x-8 top-7 h-24 -rotate-6 bg-black/30 blur-xl" />}
      <GearIllustration item={item} size="showcase" showBadges animate />
    </motion.div>
  );
}

function statRows(item: GearItem, bossRelativeDps?: number, bossName?: string): Array<[string, React.ReactNode, string?, number?]> {
  if (isWeapon(item)) {
    // DPS goes through the unified modifier chain. The "vs standard target"
    // label is shown next to the number on the UI to make the assumption
    // explicit — the player can see in the boss-prep screen what the value
    // becomes against a real weakness. When a boss is selected, a second
    // row is appended with the boss-relative DPS so the player can compare
    // this weapon's contribution to both the standard baseline and the
    // current hunt target.
    const dps = Math.round(computeStandardDps(item));
    const rows: Array<[string, React.ReactNode, string?, number?]> = [
      ['Combat Power', item.combatPower, 'text-amber', item.combatPower],
      ['DPS (vs standard)', dps, 'text-red', dps],
      ['Boss Power', item.bossPower, 'text-amber', item.bossPower],
      ['Farm Power', item.farmPower, 'text-green', item.farmPower],
      ['Damage', item.baseDamage],
      ['Attack Speed', (item.attackSpeed ?? 0).toFixed(2)],
      ['Crit Chance', pct(item.critChance)],
      ['Crit Damage', pct(item.critDamage)],
      ['Status Chance', pct(item.statusChance)],
      ['Shield Modifier', signedPct(item.shieldDamageMod), 'text-cyan'],
      ['Armor Modifier', signedPct(item.armorDamageMod), 'text-purple'],
      ['Boss Damage Mod', signedPct(item.bossDamageMod), 'text-red'],
      ['Wave Damage Mod', signedPct(item.waveDamageMod), 'text-orange'],
      ['Offline Modifier', signedPct(item.offlineEarningsMod), 'text-green'],
      ['Rare Drop', signedPct(item.rareDropChanceMod), 'text-amber'],
      ['Scrap Yield', signedPct(item.scrapYieldMod), 'text-cyan'],
    ];
    if (bossRelativeDps !== undefined && bossName) {
      rows.splice(2, 0, [`DPS (vs ${bossName})`, Math.round(bossRelativeDps), 'text-red', bossRelativeDps]);
    }
    return rows;
  }
  if (isShield(item)) {
    // Behavior (Phase 2c): name + plain-language effect with this
    // shield's real numbers — no invisible mechanics. Legacy shields
    // read as Standard.
    const behavior = shieldBehaviorOf(item);
    return [
      ['Shield HP', item.hp, 'text-cyan', item.hp],
      ['Recharge Rate', `${Math.round(item.rechargeRate)}/s`],
      ['Mitigation', pct(item.mitigation), 'text-green'],
      ['Element', item.element],
      ['Behavior', SHIELD_BEHAVIORS[behavior].name, 'text-amber'],
      ['Effect', describeShieldBehavior(behavior, item)],
    ];
  }
  if (isClassMod(item)) return [['Skill Tree', item.treeBonus, 'text-purple'], ['Boosted Nodes', Object.keys(item.nodeBoosts).length], ['Total Node Boost', Object.values(item.nodeBoosts).reduce((s, v) => s + v, 0), 'text-purple'], ['Affixes', item.affixes.length]];
  if (isOrdnance(item)) return [['Payload Damage', item.damage, 'text-red', item.damage], ['Shield Damage', item.shieldDamage, 'text-cyan'], ['Armor Damage', item.armorDamage, 'text-purple'], ['Element', item.element], ['Effect', item.effect]];
  // Relic: show affix category breakdown (relics are all about affixes)
  const relicAffixes = affixesOf(item);
  const byCategory: Record<string, number> = {};
  relicAffixes.forEach((a) => {
    byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  });
  const catRows: Array<[string, React.ReactNode, string?, number?]> = Object.entries(byCategory).map(
    ([cat, count]) => [`${cat} Affixes`, count, 'text-amber', count * 15],
  );
  return [
    ['Total Affixes', relicAffixes.length, 'text-amber', relicAffixes.length * 10],
    ...catRows,
    ['Source', item.sourceTag],
    ['Rarity', item.rarity],
  ];
}

export function GearInspectSheet({ item, open, onClose, actions, contextLabel = 'Gear Inspect', allowReforge = false }: { item: GearItem | null; open: boolean; onClose: () => void; actions?: React.ReactNode; contextLabel?: string; allowReforge?: boolean }) {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const market = useMarketStore();
  const bossStore = useBossStore();
  // After a successful reforge the sheet keeps showing the item —
  // swapped for the server's returned row so the stat poster, the
  // visual, and the affix rows all read the new roll immediately.
  const [reforgedItem, setReforgedItem] = useState<GearItem | null>(null);
  const equippedIds = useMemo(() => new Set(Object.values(loadout.slots).filter(Boolean) as string[]), [loadout.slots]);
  const intel = useMemo(() => {
    if (!item) return { active: 0, lowest: null as number | null, median: null as number | null, mine: 0, recent: 0 };
    const listings = market.listings.filter((listing) => similar(item, listing));
    const prices = listings.map((listing) => listing.price).sort((a, b) => a - b);
    return { active: listings.length, lowest: prices[0] ?? null, median: prices.length ? prices[Math.floor(prices.length / 2)] : null, mine: market.listings.filter((listing) => listing.itemId === item.id).length, recent: market.history.filter((entry) => entry.itemRarity === item.rarity).length };
  }, [item, market.history, market.listings]);

  if (!item) return null;
  const shownItem = reforgedItem && reforgedItem.id === item.id ? reforgedItem : item;
  const color = RARITIES[item.rarity]?.color ?? '#F5B544';
  const equipped = equippedIds.has(item.id);
  const ownedExact = inventory.items.filter((owned) => owned.id === item.id).length;
  const ownedSimilar = inventory.items.filter((owned) => kindOf(owned) === kindOf(item) && owned.rarity === item.rarity && Math.abs((owned.level ?? 1) - (item.level ?? 1)) <= 5).length;
  const affixes = affixesOf(shownItem);
  const salvage = calculateSalvageYield(item);
  // If the player has a boss selected, show a second DPS row on weapons
  // using the same chain (computeLoadoutDps) the diorama uses. The label
  // says "vs {boss.name}" so the player knows which target the number
  // refers to. Falls back to "vs standard" only when no boss is selected.
  const currentBoss = bossStore.currentBossId ? REGION_1_BOSSES.find((b) => b.id === bossStore.currentBossId) ?? null : null;
  const bossRelativeDps = isWeapon(shownItem) && currentBoss
    ? computeLoadoutDps([shownItem], currentBoss.weaknesses, currentBoss.resistances)
    : undefined;
  const rows = statRows(shownItem, bossRelativeDps, currentBoss?.name);
  const maxRow = Math.max(1, ...rows.map(([, value]) => typeof value === 'number' ? value : 0));

  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/85" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}><motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 320 }} className="max-h-[92vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-3 shadow-[0_-12px_32px_rgba(0,0,0,0.75)]" style={panelClip} onClick={(event) => event.stopPropagation()}><div className="mb-3 flex justify-center"><div className="h-1.5 w-12 rounded-full bg-border" /></div><div className="relative overflow-hidden border-2 border-border bg-surface p-3" style={panelClip}><div className="absolute -right-10 top-3 h-8 w-36 rotate-12 bg-amber/10" /><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">{contextLabel}</div><div className="truncate bl-title text-3xl leading-none" style={{ color }}>{item.name}</div><div className="mt-1 text-[10px] font-black uppercase tracking-wide text-text-muted">{item.rarity} · Lv.{item.level} · {kindOf(item)} · {item.sourceTag}</div></div><button type="button" onClick={onClose} className="bl-secondary shrink-0 p-2 text-text-muted"><X size={15} /></button></div><div className="mt-3 border-2 border-border bg-bg/80" style={panelClip}><Visual item={shownItem} /></div><div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5"><StatLine label="Qty" value={`Unique x${Math.max(1, ownedExact)}`} tone="text-amber" width={55} /><StatLine label="Owned" value={ownedSimilar} tone="text-cyan" width={45} /><StatLine label="State" value={equipped ? 'Equipped' : item.isLocked ? 'Locked' : 'Tradeable'} tone={equipped ? 'text-green' : item.isLocked ? 'text-red' : 'text-amber'} width={65} /></div>{isWeapon(item) && <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5"><StatLine label="Roll" value={`${item.rollQuality} ${rollQualityLabel(item.rollQuality)}`} tone="text-amber" width={item.rollQuality} /><StatLine label="Maker" value={item.manufacturer} width={55} /><StatLine label="Element" value={item.element} tone="text-cyan" width={55} /></div>}</div><Tape title="Stat Poster" glyph="◈"><div className="space-y-1.5">{rows.map(([label, value, tone, width]) => <StatLine key={`${label}-${value}`} label={label} value={value} tone={tone} width={width ? width / maxRow * 100 : 38} />)}</div></Tape>{isWeapon(item) && item.parts.length > 0 && <Tape title="Roll Parts" glyph="⚔"><div className="space-y-1.5">{item.parts.map((part) => <div key={part.slot} className="border border-border bg-bg/70 p-2" style={slashClip}><div className="text-[10px] font-black text-text-primary">{part.slot}</div><div className="mt-1 text-[9px] text-text-muted">{Object.entries(part.modifier).map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(2) : v}`).join(' · ') || 'Visual part'}</div></div>)}</div></Tape>}{isClassMod(item) && Object.keys(item.nodeBoosts).length > 0 && <Tape title="Skill Node Boosts" glyph="⊕"><div className="space-y-1.5">{Object.entries(item.nodeBoosts).map(([node, boost]) => <StatLine key={node} label={node} value={`+${boost}`} tone="text-purple" width={boost * 18} />)}</div></Tape>}{allowReforge ? <ReforgePanel key={shownItem.id} item={shownItem} equipped={equipped} onReforged={setReforgedItem} /> : affixes.length > 0 && <Tape title={`Affixes (${affixes.length})`} glyph="✦"><div className="space-y-1.5">{affixes.map((affix) => <div key={affix.id} className="border border-amber/35 bg-amber/10 p-2 text-xs font-bold text-amber" style={slashClip}>{affix.displayText}</div>)}</div></Tape>}{isWeapon(item) && item.legendaryEffectId && <Tape title="Legendary Effect" glyph="✦"><div className="text-sm font-black text-amber">{item.legendaryEffectId}</div></Tape>}<Tape title="Market Intelligence" glyph="$"><div className="space-y-1.5"><StatLine label="Comparable Supply" value={intel.active} tone="text-amber" width={intel.active * 10} /><StatLine label="Lowest Ask" value={intel.lowest ? `${n(intel.lowest)}cr` : 'None'} tone="text-green" width={60} /><StatLine label="Median Ask" value={intel.median ? `${n(intel.median)}cr` : 'None'} width={50} /><StatLine label="Recent Sales" value={intel.recent} width={intel.recent * 10} /><StatLine label="Mine Listed" value={intel.mine} tone="text-cyan" width={intel.mine * 30} /></div><div className="mt-2 border border-border bg-bg/70 p-2 text-[10px] text-text-muted" style={slashClip}>Comparable supply is same type, rarity, and nearby level. Unique rolled gear is quantity one; stack counts belong to materials, consumables, and fragments.</div></Tape><Tape title="Salvage Forecast" glyph="⚡"><div className="space-y-1.5"><StatLine label="Scrap" value={salvage.scrapValue} tone="text-orange" width={salvage.scrapValue} /><StatLine label="Alloy" value={salvage.scrapAlloy} width={salvage.scrapAlloy} /><StatLine label="Parts" value={salvage.ballisticParts} width={salvage.ballisticParts * 15} /><StatLine label="Reactive" value={salvage.reactiveComponents} width={salvage.reactiveComponents * 15} /><StatLine label="Tech" value={salvage.techFragments} width={salvage.techFragments * 15} /><StatLine label="Void" value={salvage.voidDust} width={salvage.voidDust * 20} /></div></Tape>{item.isLocked && <div className="mt-3 flex items-center gap-2 border border-red/30 bg-red/10 p-2 text-xs font-bold text-red" style={slashClip}><Lock size={13} />Locked gear cannot be listed or bulk-scrapped without unlocking.</div>}{actions && <div className="sticky bottom-0 mt-4 border-t-2 border-border bg-bg/95 pt-3 backdrop-blur">{actions}</div>}</motion.div></motion.div>}</AnimatePresence>;
}
