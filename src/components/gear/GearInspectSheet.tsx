import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Gem, Lock, PackageSearch, Scroll, Shield, ShoppingCart, Sparkles, Sword, X, Zap } from 'lucide-react';
import { WeaponIllustration } from '@/components/weapon/WeaponIllustration';
import { RARITIES, rollQualityLabel } from '@/constants/rarities';
import { calculateSalvageYield } from '@/constants/salvageRules';
import { useInventoryStore, useLoadoutStore, useMarketStore } from '@/store';
import type { Affix, ClassMod, GearItem, Ordnance, Relic, Shield as ShieldItem, Weapon } from '@/types/items';
import type { Listing } from '@/types/market';

const panelClip = { clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)' };
const chipClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
const isShield = (item: GearItem): item is ShieldItem => 'hp' in item && !isWeapon(item);
const isClassMod = (item: GearItem): item is ClassMod => 'treeBonus' in item;
const isOrdnance = (item: GearItem): item is Ordnance => 'damage' in item && 'effect' in item && !isWeapon(item);
const isRelic = (item: GearItem): item is Relic => 'affixes' in item && !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item);
const affixesOf = (item: GearItem): Affix[] => ('affixes' in item && Array.isArray(item.affixes) ? item.affixes : []);

const kindOf = (item: GearItem) => (isWeapon(item) ? 'Weapon' : isShield(item) ? 'Shield' : isClassMod(item) ? 'Class Mod' : isOrdnance(item) ? 'Ordnance' : 'Relic');
const pct = (value: number) => `${Math.round(value * 100)}%`;
const signedPct = (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
const n = (value: number) => Number.isFinite(value) ? value.toLocaleString() : '0';

function similar(item: GearItem, listing: Listing) {
  const other = listing.itemSnapshot;
  if (kindOf(item) !== kindOf(other) || other.rarity !== item.rarity) return false;
  if (Math.abs((other.level ?? 1) - (item.level ?? 1)) > 5) return false;
  if (isWeapon(item) && isWeapon(other)) return other.weaponType === item.weaponType && other.manufacturer === item.manufacturer && other.element === item.element;
  return true;
}

function Chip({ label, value, tone = 'text-text-primary' }: { label: string; value: React.ReactNode; tone?: string }) {
  return <div className="border border-border bg-bg/70 p-2" style={chipClip}><div className="text-[8px] font-black uppercase tracking-widest text-text-muted">{label}</div><div className={`mt-0.5 truncate text-xs font-black ${tone}`}>{value}</div></div>;
}

function Section({ title, icon: Icon, children }: { title: string; icon?: React.ElementType; children: React.ReactNode }) {
  return <div className="mt-3 border-2 border-border bg-surface/95 p-3" style={panelClip}><div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-amber">{Icon && <Icon size={14} />}{title}</div>{children}</div>;
}

function Visual({ item, color }: { item: GearItem; color: string }) {
  if (isWeapon(item)) return <motion.div className="flex h-44 items-center justify-center" animate={{ y: [0, -4, 0], rotate: [-1, 1, -1] }} transition={{ duration: 2.6, repeat: Infinity }}><WeaponIllustration weapon={item} size="showcase" showBadges animate /></motion.div>;
  const Icon = isShield(item) ? Shield : isClassMod(item) ? Scroll : isOrdnance(item) ? Zap : Gem;
  return <motion.div className="flex h-44 items-center justify-center" animate={{ scale: [1, 1.05, 1], y: [0, -5, 0] }} transition={{ duration: 2.2, repeat: Infinity }}><div className="relative flex h-32 w-32 items-center justify-center border-[5px] border-black bg-bg shadow-[10px_10px_0_rgba(0,0,0,0.45)]" style={panelClip}><div className="absolute inset-2 border-2" style={{ borderColor: color, clipPath: panelClip.clipPath }} /><motion.div className="absolute inset-5 opacity-20" style={{ backgroundColor: color, clipPath: panelClip.clipPath }} animate={{ opacity: [0.12, 0.28, 0.12] }} transition={{ duration: 1.4, repeat: Infinity }} /><Icon size={52} style={{ color }} /></div></motion.div>;
}

function rows(item: GearItem): Array<[string, React.ReactNode, string?]> {
  if (isWeapon(item)) {
    const dps = Math.round(item.baseDamage * item.attackSpeed * (1 + item.critChance * item.critDamage));
    return [['Combat', item.combatPower, 'text-amber'], ['Boss', item.bossPower], ['Farm', item.farmPower], ['DPS Est.', dps], ['Damage', item.baseDamage], ['Speed', item.attackSpeed.toFixed(2)], ['Crit', pct(item.critChance)], ['Crit Dmg', pct(item.critDamage)], ['Status', pct(item.statusChance)], ['Shield Mod', signedPct(item.shieldDamageMod)], ['Armor Mod', signedPct(item.armorDamageMod)], ['Offline', signedPct(item.offlineEarningsMod)], ['Rare Drop', signedPct(item.rareDropChanceMod)], ['Economy', item.economyScore]];
  }
  if (isShield(item)) return [['HP', item.hp], ['Recharge', `${Math.round(item.rechargeRate)}/s`], ['Mitigation', pct(item.mitigation)], ['Element', item.element]];
  if (isClassMod(item)) return [['Tree', item.treeBonus], ['Boosted Nodes', Object.keys(item.nodeBoosts).length], ['Total Boost', Object.values(item.nodeBoosts).reduce((s, v) => s + v, 0)], ['Affixes', item.affixes.length]];
  if (isOrdnance(item)) return [['Damage', item.damage], ['Shield', item.shieldDamage], ['Armor', item.armorDamage], ['Element', item.element], ['Effect', item.effect]];
  return [['Affixes', affixesOf(item).length], ['Source', item.sourceTag], ['Level', item.level], ['Rarity', item.rarity]];
}

export function GearInspectSheet({ item, open, onClose, actions, contextLabel = 'Gear Inspect' }: { item: GearItem | null; open: boolean; onClose: () => void; actions?: React.ReactNode; contextLabel?: string }) {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const market = useMarketStore();
  const equippedIds = useMemo(() => new Set(Object.values(loadout.slots).filter(Boolean) as string[]), [loadout.slots]);
  const intel = useMemo(() => {
    if (!item) return { active: 0, lowest: null as number | null, median: null as number | null, mine: 0, recent: 0 };
    const listings = market.listings.filter((listing) => similar(item, listing));
    const prices = listings.map((listing) => listing.price).sort((a, b) => a - b);
    return { active: listings.length, lowest: prices[0] ?? null, median: prices.length ? prices[Math.floor(prices.length / 2)] : null, mine: market.listings.filter((listing) => listing.itemId === item.id).length, recent: market.history.filter((entry) => entry.itemRarity === item.rarity).length };
  }, [item, market.history, market.listings]);

  if (!item) return null;
  const color = RARITIES[item.rarity]?.color ?? '#F5B544';
  const equipped = equippedIds.has(item.id);
  const ownedExact = inventory.items.filter((owned) => owned.id === item.id).length;
  const ownedSimilar = inventory.items.filter((owned) => kindOf(owned) === kindOf(item) && owned.rarity === item.rarity && Math.abs((owned.level ?? 1) - (item.level ?? 1)) <= 5).length;
  const affixes = affixesOf(item);
  const salvage = calculateSalvageYield(item);

  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}><motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 320 }} className="max-h-[92vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-4 shadow-[0_-12px_32px_rgba(0,0,0,0.65)]" style={panelClip} onClick={(event) => event.stopPropagation()}><div className="mb-3 flex justify-center"><div className="h-1.5 w-12 rounded-full bg-border" /></div><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">{contextLabel}</div><div className="truncate text-2xl font-black" style={{ color }}>{item.name}</div><div className="text-[11px] text-text-muted">{item.rarity} · Lv.{item.level} · {kindOf(item)} · {item.sourceTag}</div></div><button type="button" onClick={onClose} className="bl-secondary shrink-0 p-2 text-text-muted"><X size={15} /></button></div><div className="mt-3 overflow-hidden border-2 border-border bg-surface/90" style={panelClip}><Visual item={item} color={color} /></div><div className="mt-3 grid grid-cols-3 gap-2"><Chip label="Quantity" value={`Unique x${Math.max(1, ownedExact)}`} tone="text-amber" /><Chip label="Similar Owned" value={ownedSimilar} tone="text-cyan" /><Chip label="State" value={equipped ? 'Equipped' : item.isLocked ? 'Locked' : 'Tradeable'} tone={equipped ? 'text-green' : item.isLocked ? 'text-red' : 'text-amber'} /></div>{isWeapon(item) && <div className="mt-3 grid grid-cols-3 gap-2"><Chip label="Roll" value={`${item.rollQuality} ${rollQualityLabel(item.rollQuality)}`} tone="text-amber" /><Chip label="Maker" value={item.manufacturer} /><Chip label="Element" value={item.element} tone="text-cyan" /></div>}<Section title="Stat Breakdown" icon={PackageSearch}><div className="grid grid-cols-3 gap-2">{rows(item).map(([label, value, tone]) => <Chip key={`${label}-${value}`} label={label} value={value} tone={tone} />)}</div></Section>{isWeapon(item) && item.parts.length > 0 && <Section title="Roll Parts" icon={Sword}><div className="space-y-1.5">{item.parts.map((part) => <div key={part.slot} className="flex justify-between gap-3 border border-border bg-bg/60 p-2 text-[10px]"><span className="font-black text-text-primary">{part.slot}</span><span className="text-right text-text-muted">{Object.entries(part.modifier).map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(2) : v}`).join(' · ') || 'Visual part'}</span></div>)}</div></Section>}{isClassMod(item) && Object.keys(item.nodeBoosts).length > 0 && <Section title="Skill Node Boosts" icon={Scroll}><div className="space-y-1.5">{Object.entries(item.nodeBoosts).map(([node, boost]) => <div key={node} className="flex justify-between border border-border bg-bg/60 p-2 text-xs"><span>{node}</span><span className="font-black text-purple">+{boost}</span></div>)}</div></Section>}{affixes.length > 0 && <Section title={`Affixes (${affixes.length})`} icon={Sparkles}><div className="space-y-1.5">{affixes.map((affix) => <div key={affix.id} className="border border-border bg-bg/60 p-2 text-xs text-amber">{affix.displayText}</div>)}</div></Section>}{isWeapon(item) && item.legendaryEffectId && <Section title="Legendary Effect" icon={Sparkles}><div className="text-sm font-black text-amber">{item.legendaryEffectId}</div></Section>}<Section title="Market Intelligence" icon={ShoppingCart}><div className="grid grid-cols-3 gap-2"><Chip label="Active Supply" value={intel.active} tone="text-amber" /><Chip label="Lowest Ask" value={intel.lowest ? `${n(intel.lowest)}cr` : 'None'} tone="text-green" /><Chip label="Median Ask" value={intel.median ? `${n(intel.median)}cr` : 'None'} /><Chip label="Recent Sales" value={intel.recent} /><Chip label="Mine Listed" value={intel.mine} /><Chip label="Model" value="Comparable" /></div><div className="mt-2 text-[10px] text-text-muted">Comparable supply is same type, rarity, and nearby level. Unique rolled gear is quantity one; stack counts belong to materials, consumables, and fragments.</div></Section><Section title="Salvage Forecast" icon={Zap}><div className="grid grid-cols-3 gap-2"><Chip label="Scrap" value={salvage.scrapValue} tone="text-orange" /><Chip label="Alloy" value={salvage.scrapAlloy} /><Chip label="Parts" value={salvage.ballisticParts} /><Chip label="Reactive" value={salvage.reactiveComponents} /><Chip label="Tech" value={salvage.techFragments} /><Chip label="Void" value={salvage.voidDust} /></div></Section>{item.isLocked && <div className="mt-3 flex items-center gap-2 border border-red/30 bg-red/10 p-2 text-xs font-bold text-red"><Lock size={13} />Locked gear cannot be listed or bulk-scrapped without unlocking.</div>}{actions && <div className="sticky bottom-0 mt-4 border-t-2 border-border bg-bg/95 pt-3 backdrop-blur">{actions}</div>}</motion.div></motion.div>}</AnimatePresence>;
}
