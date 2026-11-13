import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { sheetMotionProps } from '@/lib/animation/uiMotion';
import { Lock, X } from 'lucide-react';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { SheetPortal } from '@/components/common/SheetPortal';
import { Tape } from '@/components/gear/Tape';
import { GearTradeTape } from '@/components/gear/GearTradeTape';
import { ReforgePanel } from '@/components/gear/ReforgePanel';
import { TurnInPanel } from '@/components/gear/TurnInPanel';
import { RARITIES, rollQualityLabel } from '@/constants/rarities';
import { projectSalvageYield } from '@/lib/gear/salvageAward';
import { getVisualAsset } from '@/constants/visualAssets';
import { useBossStore, useInventoryStore, useLoadoutStore, useMarketStore, useSkillStore } from '@/store';
import { computeLoadoutDps } from '@/lib/stats/dpsChain';
import { REGION_1_BOSSES } from '@/constants/bosses';
// The stat deck lives in ONE shared source — data in
// src/lib/gear/itemStatDeck.ts, rendering in ./itemStatDeck.tsx —
// so this sheet and the cache reveal page can never disagree about
// an item's numbers. Do not re-inline copies here.
import {
  affixesOf,
  isClassMod,
  isWeapon,
  kindOf,
  pct,
  skillNodeName,
  slashClip,
  statRows,
} from '@/lib/gear/itemStatDeck';
import {
  AffixLine,
  LegendaryEffectBlock,
  PartLine,
  StatLine,
} from './itemStatDeck';
import type { GearItem } from '@/types/items';
import type { Listing } from '@/types/market';

const panelClip = { clipPath: 'polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)' };
const n = (value: number) => Number.isFinite(value) ? value.toLocaleString() : '0';

function similar(item: GearItem, listing: Listing) {
  const other = listing.itemSnapshot;
  if (!other) return false;
  if (kindOf(item) !== kindOf(other) || other.rarity !== item.rarity) return false;
  if (Math.abs((other.level ?? 1) - (item.level ?? 1)) > 5) return false;
  if (isWeapon(item) && isWeapon(other)) return other.weaponType === item.weaponType && other.manufacturer === item.manufacturer && other.element === item.element;
  return true;
}


function Visual({ item }: { item: GearItem }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="relative flex h-48 items-center justify-center"
      animate={
        reduceMotion
          ? undefined
          : isWeapon(item)
            ? { y: [0, -4, 0], rotate: [-1, 1, -1] }
            : { scale: [1, 1.03, 1], y: [0, -4, 0] }
      }
      transition={{ duration: isWeapon(item) ? 2.6 : 2.2, repeat: Infinity, ease: 'easeInOut' }}
    >
      {isWeapon(item) && <div className="absolute inset-x-8 top-7 h-24 -rotate-6 bg-black/30 blur-xl" />}
      <GearIllustration item={item} size="showcase" showBadges animate />
    </motion.div>
  );
}

export function GearInspectSheet({ item, open, onClose, actions, contextLabel = 'Gear Inspect', allowReforge = false }: { item: GearItem | null; open: boolean; onClose: () => void; actions?: React.ReactNode; contextLabel?: string; allowReforge?: boolean }) {
  const inventory = useInventoryStore();
  const sheet = sheetMotionProps(useReducedMotion());
  const loadout = useLoadoutStore();
  const market = useMarketStore();
  const bossStore = useBossStore();
  const skills = useSkillStore();
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
  // The forecast quotes the LIVE award: projectSalvageYield composes
  // the server's own salvage pieces with this player's skill bonuses,
  // so what prints here is what cc_recycle_item settles — Scrap,
  // legendary cores on Legendaries, and the King of Scrap bonus
  // material as a chance, never a promise.
  const salvage = projectSalvageYield(item, skills.getBonuses());
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

  return <SheetPortal><AnimatePresence>{open && <motion.div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/85" {...sheet.backdrop} onClick={onClose}><motion.div {...sheet.panel} className="max-h-[92vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-3 shadow-[0_-12px_32px_rgba(0,0,0,0.75)]" style={panelClip} onClick={(event) => event.stopPropagation()}><div className="mb-3 flex justify-center"><div className="h-1.5 w-12 rounded-full bg-border" /></div><div className="relative overflow-hidden border-2 border-border bg-surface p-3" style={panelClip}><div className="absolute -right-10 top-3 h-8 w-36 rotate-12 bg-amber/10" /><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">{contextLabel}</div><div className="truncate bl-title text-3xl leading-none" style={{ color }}>{item.name}</div><div className="mt-1 text-[10px] font-black uppercase tracking-wide text-text-muted">{item.rarity} · Lv.{item.level} · {kindOf(item)} · {item.sourceTag}</div></div><button type="button" onClick={onClose} className="bl-secondary shrink-0 p-2 text-text-muted"><X size={15} /></button></div><div className="mt-3 border-2 border-border bg-bg/80" style={panelClip}><Visual item={shownItem} /></div><div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5"><StatLine label="Qty" value={`Unique x${Math.max(1, ownedExact)}`} tone="text-amber" width={55} /><StatLine label="Owned" value={ownedSimilar} tone="text-cyan" width={45} /><StatLine label="State" value={equipped ? 'Equipped' : item.isLocked ? 'Locked' : 'Tradeable'} tone={equipped ? 'text-green' : item.isLocked ? 'text-red' : 'text-amber'} width={65} /></div>{isWeapon(item) && <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5"><StatLine label="Roll" value={`${item.rollQuality} ${rollQualityLabel(item.rollQuality)}`} tone="text-amber" width={item.rollQuality} /><StatLine label="Maker" value={item.manufacturer} width={55} /><StatLine label="Element" value={item.element} tone="text-cyan" width={55} /></div>}</div><Tape title="Stat Poster" px="diamondIn"><div className="space-y-1.5">{rows.map(([label, value, tone, width]) => <StatLine key={`${label}-${value}`} label={label} value={value} tone={tone} width={width ? width / maxRow * 100 : 38} />)}</div></Tape><GearTradeTape candidate={shownItem} boss={currentBoss} />{isWeapon(item) && item.parts.length > 0 && <Tape title="Roll Parts" px="crosshair"><div className="space-y-1.5">{item.parts.map((part) => <PartLine key={part.slot} part={part} />)}</div></Tape>}{isClassMod(item) && Object.keys(item.nodeBoosts).length > 0 && <Tape title="Skill Node Boosts" px="cross"><div className="space-y-1.5">{Object.entries(item.nodeBoosts).map(([node, boost]) => <StatLine key={node} label={skillNodeName(node)} value={`+${boost}`} tone="text-purple" width={boost * 18} />)}</div></Tape>}{allowReforge ? <ReforgePanel key={shownItem.id} item={shownItem} equipped={equipped} onReforged={setReforgedItem} /> : affixes.length > 0 && <Tape title={`Affixes (${affixes.length})`} px="star"><div className="space-y-1.5">{affixes.map((affix) => <AffixLine key={affix.id} affix={affix} />)}</div></Tape>}{isWeapon(item) && item.legendaryEffectId && <Tape title="Legendary Effect" px="star"><LegendaryEffectBlock item={item} /></Tape>}<Tape title="Market Intelligence" px="coin"><div className="space-y-1.5"><StatLine label="Comparable Supply" value={intel.active} tone="text-amber" width={intel.active * 10} /><StatLine label="Lowest Ask" value={intel.lowest ? `${n(intel.lowest)}cr` : 'None'} tone="text-green" width={60} /><StatLine label="Median Ask" value={intel.median ? `${n(intel.median)}cr` : 'None'} width={50} /><StatLine label="Recent Sales" value={intel.recent} width={intel.recent * 10} /><StatLine label="Mine Listed" value={intel.mine} tone="text-cyan" width={intel.mine * 30} /></div><div className="mt-2 border border-border bg-bg/70 p-2 text-[10px] text-text-muted" style={slashClip}>Comparable supply is same type, rarity, and nearby level. Unique rolled gear is quantity one; stack counts belong to materials, consumables, and essences.</div></Tape><Tape title="Salvage Forecast" px="bolt"><div className="space-y-1.5"><StatLine label="Scrap" value={salvage.scrapValue} tone="text-orange" width={salvage.scrapValue} />{(salvage.legendaryCores ?? 0) > 0 && <StatLine label="Legendary Cores" value={salvage.legendaryCores} tone="text-amber" width={(salvage.legendaryCores ?? 0) * 25} />}{salvage.bonusMaterialId && <StatLine label="King of Scrap" value={`${pct(salvage.bonusMaterialChance ?? 0)} chance · +1 ${getVisualAsset('material', salvage.bonusMaterialId).label}`} tone="text-green" width={55} />}</div><div className="mt-2 border border-border bg-bg/70 p-2 text-[10px] text-text-muted" style={slashClip}>Salvage pays Scrap — plus legendary cores from Legendaries. Crafting materials come back only as the occasional King of Scrap bonus on Commons, rolled when the salvage settles; essences never come from salvage.</div></Tape>{allowReforge && <TurnInPanel key={`turnin-${shownItem.id}`} item={shownItem} equipped={equipped} onDone={onClose} />}{item.isLocked && <div className="mt-3 flex items-center gap-2 border border-red/30 bg-red/10 p-2 text-xs font-bold text-red" style={slashClip}><Lock size={13} />Locked gear cannot be listed or bulk-scrapped without unlocking.</div>}{actions && <div className="sticky bottom-0 mt-4 border-t-2 border-border bg-bg/95 pt-3 backdrop-blur">{actions}</div>}</motion.div></motion.div>}</AnimatePresence></SheetPortal>;
}
