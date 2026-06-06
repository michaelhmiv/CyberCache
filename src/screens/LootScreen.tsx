import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trash2, Lock, Unlock, ShoppingBag, Shield, Sword,
  Gem, Zap, Scroll, ArrowLeftRight, AlertTriangle, Hammer,
} from 'lucide-react';
import { useInventoryStore, useLoadoutStore, usePlayerStore, useWorkshopStore } from '@/store';
import {
  GearItem, Weapon, Shield as ShieldType, ClassMod, Relic, Ordnance,
} from '@/types/items';
import { Rarity, Element } from '@/types/game';
import { RARITIES } from '@/constants/rarities';
import { rollQualityLabel } from '@/constants/rarities';
import { calculateSalvageYield } from '@/constants/salvageRules';
import { WeaponCanvas } from '@/components/pixelArt/WeaponCanvas';
import { RollQualityBadge } from '@/components/common/RollQualityBadge';

// ── Type Guards (same logic as loadoutSlice) ──────────────────────────────

const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
const isShield = (item: GearItem): item is ShieldType =>
  'hp' in item && !('weaponType' in item);
const isClassMod = (item: GearItem): item is ClassMod => 'treeBonus' in item;
const isOrdnanceG = (item: GearItem): item is Ordnance =>
  'damage' in item && 'effect' in item && !('weaponType' in item);
const isRelic = (item: GearItem): item is Relic =>
  'affixes' in item &&
  !isWeapon(item) &&
  !isShield(item) &&
  !isClassMod(item) &&
  !isOrdnanceG(item);

// ── Gear Type helpers ─────────────────────────────────────────────────────

type GearType = 'Weapons' | 'Shields' | 'Mods' | 'Relics' | 'Ordnance';
type LoadoutSlot = 'shield' | 'classMod' | 'relic' | 'ordnance';

const TYPE_LABELS: Record<GearType, string> = {
  Weapons: 'Weapon',
  Shields: 'Shield',
  Mods: 'Class Mod',
  Relics: 'Relic',
  Ordnance: 'Ordnance',
};

const TYPE_ICONS: Record<GearType, React.ReactNode> = {
  Weapons: <Sword size={12} />,
  Shields: <Shield size={12} />,
  Mods: <Scroll size={12} />,
  Relics: <Gem size={12} />,
  Ordnance: <Zap size={12} />,
};

const TYPE_BG: Record<GearType, string> = {
  Weapons: 'bg-red/15 border-red/40 text-red',
  Shields: 'bg-blue/15 border-blue/40 text-blue',
  Mods: 'bg-purple/15 border-purple/40 text-purple',
  Relics: 'bg-amber/15 border-amber/40 text-amber',
  Ordnance: 'bg-orange/15 border-orange/40 text-orange',
};

function getGearType(item: GearItem): GearType {
  if (isWeapon(item)) return 'Weapons';
  if (isShield(item)) return 'Shields';
  if (isClassMod(item)) return 'Mods';
  if (isRelic(item)) return 'Relics';
  return 'Ordnance';
}

function getSingleSlot(item: GearItem): LoadoutSlot | null {
  if (isShield(item)) return 'shield';
  if (isClassMod(item)) return 'classMod';
  if (isRelic(item)) return 'relic';
  if (isOrdnanceG(item)) return 'ordnance';
  return null; // weapons have 3 slots — navigate instead
}

// ── Filters ───────────────────────────────────────────────────────────────

const RARITY_FILTERS = ['All', Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary] as const;
const TYPE_FILTERS: (GearType | 'All')[] = ['All', 'Weapons', 'Shields', 'Mods', 'Relics', 'Ordnance'];
const SPECIAL_FILTERS = ['All', 'Equipped', 'Tradeable', 'Scrap'] as const;
type SpecialFilter = (typeof SPECIAL_FILTERS)[number];

const FILTER_TAB_STYLE =
  'px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-colors border';
const ACTIVE_TAB = 'bg-amber text-bg border-amber';
const INACTIVE_TAB = 'bg-surface text-text-secondary border-border';

// ── Sub-components ────────────────────────────────────────────────────────

/** Tiny icon badge for gear type */
const TypeBadge: React.FC<{ type: GearType }> = ({ type }) => (
  <span
    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border ${TYPE_BG[type]}`}
  >
    {TYPE_ICONS[type]}
    {TYPE_LABELS[type]}
  </span>
);

/** Compact card for any gear item */
const GearCard: React.FC<{
  item: GearItem;
  isEquipped: boolean;
  onClick: () => void;
}> = ({ item, isEquipped, onClick }) => {
  const rarityColor = RARITIES[item.rarity].color;
  const gearType = getGearType(item);

  // Stat preview line per item type
  const statLine = (() => {
    if (isWeapon(item))
      return `Dmg ${item.baseDamage}  Spd ${item.attackSpeed.toFixed(2)}  Crit ${(item.critChance * 100).toFixed(0)}%`;
    if (isShield(item))
      return `HP ${item.hp}  Rech ${item.rechargeRate.toFixed(0)}/s  Mit ${(item.mitigation * 100).toFixed(0)}%`;
    if (isClassMod(item))
      return `Tree: ${item.treeBonus}  Nodes: ${Object.keys(item.nodeBoosts).length}`;
    if (isRelic(item))
      return `Affixes: ${item.affixes.length}`;
    // Ordnance
    return `Dmg ${item.damage}  Shield ${item.shieldDamage}  Armor ${item.armorDamage}`;
  })();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="relative rounded-xl p-3 bg-surface border border-border overflow-hidden flex items-center gap-3 cursor-pointer"
      style={{ borderLeftColor: rarityColor, borderLeftWidth: 4 }}
    >
      {/* Left visual */}
      <div className="shrink-0 w-14 h-14 flex items-center justify-center rounded-lg bg-surface-raised">
        {isWeapon(item) ? (
          <WeaponCanvas
            type={item.weaponType}
            manufacturer={item.manufacturer}
            element={item.element}
            rarity={item.rarity}
            size={48}
          />
        ) : (
          <span className="text-2xl">
            {isShield(item) ? '🛡️' : isClassMod(item) ? '📜' : isRelic(item) ? '💎' : '💣'}
          </span>
        )}
      </div>

      {/* Middle info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <span className="text-xs font-bold truncate" style={{ color: rarityColor }}>
            {item.name}
          </span>
          {isWeapon(item) && <RollQualityBadge quality={item.rollQuality} />}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-text-secondary mb-1 flex-wrap">
          <span>Lv.{item.level}</span>
          <TypeBadge type={gearType} />
          {isEquipped && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-green/15 border border-green/40 text-green">
              Equipped
            </span>
          )}
        </div>
        <div className="text-[10px] text-text-muted truncate">{statLine}</div>
      </div>

      {/* Locked badge */}
      {item.isLocked && (
        <div className="absolute top-1.5 right-1.5 text-text-muted/60">
          <Lock size={10} />
        </div>
      )}
    </motion.div>
  );
};

// ── Detail Modal ──────────────────────────────────────────────────────────

/** Renders the stat grid / info section for the selected item */
const ItemDetailStats: React.FC<{ item: GearItem }> = ({ item }) => {
  if (isWeapon(item)) {
    return (
      <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
        <div>Base Dmg: <span className="text-text-primary font-bold">{item.baseDamage}</span></div>
        <div>Attack Speed: <span className="text-text-primary font-bold">{item.attackSpeed.toFixed(2)}</span></div>
        <div>Crit Chance: <span className="text-text-primary font-bold">{(item.critChance * 100).toFixed(1)}%</span></div>
        <div>Crit Dmg: <span className="text-text-primary font-bold">{(item.critDamage * 100).toFixed(0)}%</span></div>
        <div>Status Chance: <span className="text-text-primary font-bold">{(item.statusChance * 100).toFixed(1)}%</span></div>
        <div>Boss Dmg: <span className="text-text-primary font-bold">{(item.bossDamageMod * 100).toFixed(0)}%</span></div>
        <div>Shield Dmg: <span className="text-text-primary font-bold">{(item.shieldDamageMod * 100).toFixed(0)}%</span></div>
        <div>Armor Dmg: <span className="text-text-primary font-bold">{(item.armorDamageMod * 100).toFixed(0)}%</span></div>
        {item.rollQuality !== undefined && (
          <div>Roll: <span className="text-text-primary font-bold">{item.rollQuality} ({rollQualityLabel(item.rollQuality)})</span></div>
        )}
      </div>
    );
  }

  if (isShield(item)) {
    return (
      <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
        <div>HP: <span className="text-text-primary font-bold">{item.hp}</span></div>
        <div>Recharge: <span className="text-text-primary font-bold">{item.rechargeRate.toFixed(0)}/s</span></div>
        <div>Mitigation: <span className="text-text-primary font-bold">{(item.mitigation * 100).toFixed(0)}%</span></div>
        <div>Element: <span className="text-text-primary font-bold">{item.element}</span></div>
      </div>
    );
  }

  if (isClassMod(item)) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
          <div>Tree Bonus: <span className="text-text-primary font-bold text-purple">{item.treeBonus}</span></div>
          <div>Nodes Boosted: <span className="text-text-primary font-bold">{Object.keys(item.nodeBoosts).length}</span></div>
        </div>
        {Object.keys(item.nodeBoosts).length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase font-bold text-text-muted">Node Boosts</div>
            {Object.entries(item.nodeBoosts).map(([node, boost]) => (
              <div key={node} className="text-xs text-purple flex justify-between">
                <span className="truncate">{node}</span>
                <span className="font-bold ml-2">+{boost}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (isRelic(item)) {
    return (
      <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
        <div>Affix Count: <span className="text-text-primary font-bold text-amber">{item.affixes.length}</span></div>
      </div>
    );
  }

  // Ordnance
  return (
    <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
      <div>Damage: <span className="text-text-primary font-bold">{item.damage}</span></div>
      <div>Shield Dmg: <span className="text-text-primary font-bold">{item.shieldDamage}</span></div>
      <div>Armor Dmg: <span className="text-text-primary font-bold">{item.armorDamage}</span></div>
      <div>Element: <span className="text-text-primary font-bold">{item.element}</span></div>
      <div className="col-span-2">Effect: <span className="text-text-primary font-bold text-orange">{item.effect}</span></div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────

export const LootScreen: React.FC<{ onNavigate?: (screen: string) => void }> = ({
  onNavigate,
}) => {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const player = usePlayerStore();

  // Filter state
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [rarityFilter, setRarityFilter] = useState<string>('All');
  const [specialFilter, setSpecialFilter] = useState<SpecialFilter>('All');

  // Detail modal state
  const [selected, setSelected] = useState<GearItem | null>(null);
  const [confirmScrap, setConfirmScrap] = useState(false);
  const [confirmBulkScrap, setConfirmBulkScrap] = useState(false);

  // Derived: set of equipped item IDs
  const equippedIds = useMemo(() => {
    return new Set(Object.values(loadout.slots).filter(Boolean) as string[]);
  }, [loadout.slots]);

  // All items from inventory
  const allItems = inventory.items;

  // Filtered items
  const filtered = useMemo(() => {
    return allItems.filter((item) => {
      if (typeFilter !== 'All' && getGearType(item) !== typeFilter) return false;
      if (rarityFilter !== 'All' && item.rarity !== rarityFilter) return false;
      if (specialFilter === 'Equipped') return equippedIds.has(item.id);
      if (specialFilter === 'Tradeable') return !item.isLocked && !equippedIds.has(item.id);
      if (specialFilter === 'Scrap')
        return item.rarity === Rarity.Common || item.rarity === Rarity.Uncommon;
      return true;
    });
  }, [allItems, typeFilter, rarityFilter, specialFilter, equippedIds]);

  // Count badges for filters
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { All: allItems.length };
    for (const t of TYPE_FILTERS) {
      if (t === 'All') continue;
      counts[t] = allItems.filter((i) => getGearType(i) === t).length;
    }
    return counts;
  }, [allItems]);

  const rarityCounts = useMemo(() => {
    const counts: Record<string, number> = { All: allItems.length };
    for (const r of Object.values(Rarity)) {
      counts[r] = allItems.filter((i) => i.rarity === r).length;
    }
    return counts;
  }, [allItems]);

  const specialCounts = useMemo(() => {
    return {
      All: allItems.length,
      Equipped: allItems.filter((i) => equippedIds.has(i.id)).length,
      Tradeable: allItems.filter((i) => !i.isLocked && !equippedIds.has(i.id)).length,
      Scrap: allItems.filter(
        (i) => i.rarity === Rarity.Common || i.rarity === Rarity.Uncommon,
      ).length,
    };
  }, [allItems, equippedIds]);

  // ── Actions ───────────────────────────────────────────────────────────

  const handleScrap = useCallback(
    (id: string) => {
      const { scrapValue, materials, essences } = inventory.scrapItem(id);
      player.addScrap(scrapValue);
      if (materials) {
        Object.entries(materials).forEach(([type, count]) => {
          if (count > 0) player.addMaterial(type, count);
        });
      }
      if (essences) {
        Object.entries(essences).forEach(([type, count]) => {
          if (count > 0) player.addEssence(type, count);
        });
      }
      setSelected(null);
      setConfirmScrap(false);
    },
    [inventory, player],
  );

  const handleBulkScrap = useCallback(() => {
    const scrapTargets = allItems.filter(
      (item) => !item.isLocked && !equippedIds.has(item.id) && (item.rarity === Rarity.Common || item.rarity === Rarity.Uncommon)
    );
    let totalScrap = 0;
    scrapTargets.forEach((item) => {
      const { scrapValue, materials, essences } = inventory.scrapItem(item.id);
      totalScrap += scrapValue;
      if (materials) {
        Object.entries(materials).forEach(([type, count]) => {
          if (count > 0) player.addMaterial(type, count);
        });
      }
      if (essences) {
        Object.entries(essences).forEach(([type, count]) => {
          if (count > 0) player.addEssence(type, count);
        });
      }
    });
    player.addScrap(totalScrap);
    setConfirmBulkScrap(false);
  }, [allItems, equippedIds, inventory, player]);

  const toggleLock = useCallback(
    (id: string, locked: boolean) => {
      if (locked) inventory.unlockItem(id);
      else inventory.lockItem(id);
    },
    [inventory],
  );

  const handleEquip = useCallback(
    (item: GearItem) => {
      const slot = getSingleSlot(item);
      if (slot) {
        // Non-weapon: equip directly
        loadout.setSlot(slot, item.id);
        setSelected(null);
      } else {
        // Weapon: navigate to loadout screen
        onNavigate?.('loadout');
        setSelected(null);
      }
    },
    [loadout, onNavigate],
  );

  /** Returns the equipped item in the same slot category, if any */
  const getCompareItem = useCallback(
    (item: GearItem): GearItem | undefined => {
      if (isShield(item)) return loadout.getShield?.();
      if (isClassMod(item)) return loadout.getClassMod?.();
      if (isRelic(item)) return loadout.getRelic?.();
      if (isOrdnanceG(item)) return loadout.getOrdnance?.();
      // Weapon: check any weapon slot
      return (
        loadout.getWeapon?.('primary') ??
        loadout.getWeapon?.('secondary') ??
        loadout.getWeapon?.('heavy')
      );
    },
    [loadout],
  );

  // ── Render ────────────────────────────────────────────────────────────

  // Material summary for display
  const materialSummary = useMemo(() => {
    const totals: Record<string, number> = {};
    Object.entries(player.materials).forEach(([type, count]) => {
      if (count > 0) totals[type] = count;
    });
    Object.entries(player.essences).forEach(([type, count]) => {
      if (count > 0) totals[type] = count;
    });
    return totals;
  }, [player.materials, player.essences]);

  // Scrap yield preview for selected item
  const scrapPreview = useMemo(() => {
    if (!selected) return null;
    const { scrapValue, materials, essences } = calculateSalvageYield(selected as Weapon);
    return { scrapValue, materials, essences };
  }, [selected]);

  return (
    <div className="p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-lg font-bold text-text-primary">Cache Inventory</div>
        <div className="text-[10px] text-text-muted bg-surface-raised rounded-full px-2 py-0.5">
          {inventory.items.length} items
        </div>
      </div>

      {/* === TYPE Filters === */}
      <div>
        <div className="text-[10px] uppercase font-bold text-text-muted mb-1.5">Type</div>
        <div className="flex gap-1.5 flex-wrap">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`${FILTER_TAB_STYLE} ${typeFilter === t ? ACTIVE_TAB : INACTIVE_TAB}`}
            >
              {t}
              <span className="ml-1 opacity-60">{typeCounts[t] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* === RARITY Filters === */}
      <div>
        <div className="text-[10px] uppercase font-bold text-text-muted mb-1.5">Rarity</div>
        <div className="flex gap-1.5 flex-wrap">
          {RARITY_FILTERS.map((r) => (
            <button
              key={r}
              onClick={() => setRarityFilter(r)}
              className={`${FILTER_TAB_STYLE} ${rarityFilter === r ? ACTIVE_TAB : INACTIVE_TAB}`}
              style={
                r !== 'All' && rarityFilter === r
                  ? { backgroundColor: RARITIES[r].color, borderColor: RARITIES[r].color }
                  : r !== 'All'
                    ? { borderColor: `${RARITIES[r].color}40`, color: RARITIES[r].color }
                    : undefined
              }
            >
              {r}
              <span className="ml-1 opacity-60">{rarityCounts[r] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* === SPECIAL Filters === */}
      <div>
        <div className="text-[10px] uppercase font-bold text-text-muted mb-1.5">View</div>
        <div className="flex gap-1.5 flex-wrap">
          {SPECIAL_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setSpecialFilter(s)}
              className={`${FILTER_TAB_STYLE} ${specialFilter === s ? ACTIVE_TAB : INACTIVE_TAB}`}
            >
              {s}
              <span className="ml-1 opacity-60">{specialCounts[s]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* === Item Count === */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-text-muted font-medium">
          Showing {filtered.length} of {allItems.length} items
        </div>
        {specialCounts.Scrap > 0 && (
          <button
            onClick={() => setConfirmBulkScrap(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red/10 border border-red/30 text-red text-[10px] font-bold active:scale-95 transition-transform"
          >
            <Trash2 size={10} />
            Bulk Scrap ({specialCounts.Scrap})
          </button>
        )}
      </div>

      {/* === Item List === */}
      <div className="space-y-2 pb-20">
        <AnimatePresence mode="popLayout">
          {filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 text-text-muted text-sm"
            >
              {specialFilter === 'Equipped'
                ? 'No equipped items'
                : specialFilter === 'Tradeable'
                  ? 'No tradeable items'
                  : specialFilter === 'Scrap'
                    ? 'Nothing to scrap'
                    : 'No items match these filters'}
            </motion.div>
          ) : (
            filtered.map((item) => (
              <GearCard
                key={item.id}
                item={item}
                isEquipped={equippedIds.has(item.id)}
                onClick={() => {
                  setSelected(item);
                  setConfirmScrap(false);
                }}
              />
            ))
          )}
        </AnimatePresence>
      </div>

      {/* === Detail Modal === */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center"
            onClick={() => {
              setSelected(null);
              setConfirmScrap(false);
            }}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-surface w-full max-w-[480px] rounded-t-2xl p-4 space-y-4 border-t border-border max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle */}
              <div className="flex justify-center">
                <div className="w-12 h-1.5 bg-border rounded-full" />
              </div>

              {/* Item card preview */}
              <GearCard
                item={selected}
                isEquipped={equippedIds.has(selected.id)}
                onClick={() => {}}
              />

              {/* Stat details */}
              {selected.rarity && (
                <div className="rounded-lg bg-surface-raised border border-border p-3">
                  <div className="text-[10px] uppercase font-bold text-text-muted mb-2">
                    {TYPE_LABELS[getGearType(selected)]} Details
                  </div>
                  <ItemDetailStats item={selected} />
                </div>
              )}

              {/* Affixes (shared) */}
              {'affixes' in selected && (selected as any).affixes?.length > 0 && (
                <div className="rounded-lg bg-surface-raised border border-border p-3">
                  <div className="text-[10px] uppercase font-bold text-text-muted mb-1.5">
                    Affixes ({(selected as any).affixes.length})
                  </div>
                  <div className="space-y-1">
                    {(selected as any).affixes.map((a: any) => (
                      <div key={a.id} className="text-xs text-amber">
                        {a.displayText}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Legendary Effect (weapons only) */}
              {isWeapon(selected) && selected.legendaryEffectId && (
                <div className="rounded-lg bg-amber/10 border border-amber/30 p-3">
                  <div className="text-[10px] uppercase font-bold text-amber">Legendary Effect</div>
                  <div className="text-xs text-text-primary mt-1">{selected.legendaryEffectId}</div>
                </div>
              )}

              {/* Source tag */}
              <div className="text-[10px] text-text-muted text-center">
                Source: {selected.sourceTag}
              </div>

              {/* Scrap yield preview */}
              {scrapPreview && scrapPreview.scrapValue > 0 && (
                <div className="rounded-lg bg-orange/5 border border-orange/30 p-3">
                  <div className="text-[10px] uppercase font-bold text-orange mb-2">Scrap Yields</div>
                  <div className="space-y-1 text-xs text-text-secondary">
                    <div className="flex justify-between">
                      <span>Scrap</span>
                      <span className="font-bold text-orange">{scrapPreview.scrapValue}</span>
                    </div>
                    {scrapPreview.materials && Object.entries(scrapPreview.materials).map(([type, count]) => (
                      count > 0 && (
                        <div key={type} className="flex justify-between">
                          <span className="text-text-muted">{type}</span>
                          <span className="font-bold">{count}</span>
                        </div>
                      )
                    ))}
                    {scrapPreview.essences && Object.entries(scrapPreview.essences).map(([type, count]) => (
                      count > 0 && (
                        <div key={type} className="flex justify-between">
                          <span className="text-text-muted">{type}</span>
                          <span className="font-bold">{count}</span>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}

              {/* ── Action Buttons ── */}
              {confirmScrap ? (
                /* ── Scrap Confirmation ── */
                <div className="rounded-xl bg-red/5 border border-red/30 p-3 space-y-3">
                  <div className="flex items-center gap-2 text-red text-xs">
                    <AlertTriangle size={14} />
                    <span className="font-bold">
                      {equippedIds.has(selected.id)
                        ? 'This item is EQUIPPED. Scrap anyway?'
                        : selected.isLocked
                          ? 'This item is LOCKED. Scrap anyway?'
                          : 'Scrap this item?'}
                    </span>
                  </div>
                  {/* Show what you'll get */}
                  {scrapPreview && (
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      <span className="px-1.5 py-0.5 rounded bg-orange/10 text-orange font-bold border border-orange/30">
                        +{scrapPreview.scrapValue} Scrap
                      </span>
                      {scrapPreview.materials &&
                        Object.entries(scrapPreview.materials)
                          .filter(([, c]) => c > 0)
                          .map(([type, count]) => (
                            <span
                              key={type}
                              className="px-1.5 py-0.5 rounded bg-surface-raised text-text-secondary font-bold border border-border"
                            >
                              +{count} {type}
                            </span>
                          ))}
                      {scrapPreview.essences &&
                        Object.entries(scrapPreview.essences)
                          .filter(([, c]) => c > 0)
                          .map(([type, count]) => (
                            <span
                              key={type}
                              className="px-1.5 py-0.5 rounded bg-purple/10 text-purple font-bold border border-purple/30"
                            >
                              +{count} {type}
                            </span>
                          ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setConfirmScrap(false)}
                      className="py-2 rounded-lg bg-surface-raised border border-border text-text-primary text-xs font-bold
                                 active:scale-95 transition-transform hover:bg-surface"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleScrap(selected.id)}
                      className="py-2 rounded-lg bg-red border border-red text-white text-xs font-bold
                                 active:scale-95 transition-transform hover:bg-red/80"
                    >
                      Scrap It
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Action Row ── */
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {/* Equip */}
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleEquip(selected)}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-amber/10 border border-amber/30 
                               text-amber hover:bg-amber/15 active:bg-amber/20 transition-colors"
                  >
                    <Sword size={15} />
                    <span className="text-[9px] font-bold">Equip</span>
                  </motion.button>

                  {/* Compare (only if there's something to compare against) */}
                  {(() => {
                    const cmp = getCompareItem(selected);
                    if (cmp && cmp.id !== selected.id) {
                      return (
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setSelected(cmp)}
                          className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-blue/10 border border-blue/30 
                                     text-blue hover:bg-blue/15 active:bg-blue/20 transition-colors"
                        >
                          <ArrowLeftRight size={15} />
                          <span className="text-[9px] font-bold">Compare</span>
                        </motion.button>
                      );
                    }
                    return <div />;
                  })()}

                  {/* Lock / Unlock */}
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => toggleLock(selected.id, selected.isLocked)}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-surface-raised border border-border 
                               text-text-secondary hover:bg-surface hover:text-text-primary active:scale-95 transition-all"
                  >
                    {selected.isLocked ? <Unlock size={15} /> : <Lock size={15} />}
                    <span className="text-[9px] font-bold">
                      {selected.isLocked ? 'Unlock' : 'Lock'}
                    </span>
                  </motion.button>

                  {/* Scrap */}
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setConfirmScrap(true)}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-red/10 border border-red/30 
                               text-red hover:bg-red/15 active:bg-red/20 transition-colors"
                  >
                    <Trash2 size={15} />
                    <span className="text-[9px] font-bold">Scrap</span>
                  </motion.button>
                </div>
              )}

              {/* List on Market — full width below the action row */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => onNavigate?.('market')}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green/10 border border-green/30 
                           text-green hover:bg-green/15 active:bg-green/20 transition-colors text-xs font-bold"
              >
                <ShoppingBag size={14} />
                List on Market
              </motion.button>

              {/* Material summary & workshop link */}
              {Object.keys(materialSummary).length > 0 && (
                <div className="rounded-lg bg-surface-raised border border-border p-3 mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] uppercase font-bold text-text-muted">Your Materials</div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => onNavigate?.('workshop')}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-amber/10 border border-amber/30 
                                 text-amber text-[10px] font-bold hover:bg-amber/15 active:bg-amber/20 transition-colors"
                    >
                      <Hammer size={10} />
                      Workshop
                      {(() => {
                        // Show badge if workshop has active queues
                        const ws = useWorkshopStore.getState();
                        if (ws.activeQueues.length > 0) {
                          return (
                            <span className="ml-1 px-1 py-0.5 rounded-full bg-amber text-bg text-[8px] font-bold">
                              {ws.activeQueues.length}
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </motion.button>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px]">
                    {Object.entries(materialSummary).slice(0, 6).map(([type, count]) => (
                      <div key={type} className="flex justify-between">
                        <span className="text-text-muted">{type}</span>
                        <span className="font-bold text-text-secondary">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* === Bulk Scrap Confirmation Modal === */}
      <AnimatePresence>
        {confirmBulkScrap && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => setConfirmBulkScrap(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-surface w-full max-w-[400px] rounded-2xl p-6 space-y-4 border border-border"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 text-red text-sm font-bold">
                <AlertTriangle size={16} />
                <span>Bulk Scrap Confirmation</span>
              </div>
              <div className="text-xs text-text-secondary">
                Scrap{' '}
                <span className="font-bold text-text-primary">{specialCounts.Scrap}</span> Common &amp; Uncommon
                items (locked/equipped items skipped).
              </div>
              {/* Material yield preview for bulk */}
              <div className="rounded-lg bg-orange/5 border border-orange/30 p-2.5">
                <div className="text-[10px] font-bold text-orange uppercase mb-1.5">You'll receive:</div>
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-orange/10 text-orange font-bold border border-orange/30">
                    Estimated Scrap
                  </span>
                  {Object.keys(player.materials).length > 0 ? (
                    Object.entries(player.materials).map(([type]) => (
                      <span
                        key={type}
                        className="px-1.5 py-0.5 rounded bg-surface-raised text-text-secondary border border-border"
                      >
                        +{type}
                      </span>
                    ))
                  ) : (
                    <span className="text-text-muted">(materials from each item)</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setConfirmBulkScrap(false)}
                  className="py-2 rounded-lg bg-surface-raised border border-border text-text-primary text-xs font-bold
                             active:scale-95 transition-transform hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkScrap}
                  className="py-2 rounded-lg bg-red border border-red text-white text-xs font-bold
                             active:scale-95 transition-transform hover:bg-red/80"
                >
                  Scrap All
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
