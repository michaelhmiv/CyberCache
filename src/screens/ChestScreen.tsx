import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Sparkles, Info, Lock, Unlock, Scissors, Sword } from 'lucide-react';
import { usePlayerStore, useInventoryStore } from '@/store';
import { useLoadoutStore, LoadoutSlot } from '@/store/slices/loadoutSlice';
import { RARITIES } from '@/constants/rarities';
import { DropSource, Rarity } from '@/types/game';
import { GearItem, Weapon, Shield, ClassMod, Relic, Ordnance } from '@/types/items';

// ─── helpers ──────────────────────────────────────────────────────────

function isWeapon(item: GearItem): item is Weapon {
  return 'weaponType' in item;
}
function isShield(item: GearItem): item is Shield {
  return 'hp' in item && !('weaponType' in item);
}
function isClassMod(item: GearItem): item is ClassMod {
  return 'treeBonus' in item;
}
function isOrdnance(item: GearItem): item is Ordnance {
  return 'damage' in item && 'effect' in item && !('weaponType' in item);
}
function isRelic(item: GearItem): item is Relic {
  return 'affixes' in item && !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item);
}

function gearTypeLabel(item: GearItem): string {
  if (isWeapon(item)) return item.weaponType;
  if (isShield(item)) return 'Shield';
  if (isClassMod(item)) return 'Class Mod';
  if (isRelic(item)) return 'Relic';
  if (isOrdnance(item)) return 'Ordnance';
  return 'Gear';
}

// ─── post-open item card ──────────────────────────────────────────────

const GearItemCard: React.FC<{
  item: GearItem;
  action: 'none' | 'scrapped' | 'locked' | 'unlocked' | 'equipped';
  onEquip: () => void;
  onScrap: () => void;
  onLockToggle: () => void;
}> = ({ item, action, onEquip, onScrap, onLockToggle }) => {
  const rarityDef = RARITIES[item.rarity];
  const itemIsWeapon = isWeapon(item);
  const itemIsLocked = item.isLocked;

  if (action === 'scrapped') return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="relative rounded-xl p-4 bg-surface border border-border overflow-hidden"
      style={{ borderLeftColor: rarityDef.color, borderLeftWidth: 4 }}
    >
      {/* rarity + name */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: rarityDef.color }}>
            {item.name}
          </span>
          <span className="text-[10px] text-text-muted bg-surface-raised px-1.5 py-0.5 rounded">
            {rarityDef.name}
          </span>
        </div>
        <span className="text-[10px] text-text-muted">Lv.{item.level}</span>
      </div>

      {/* type */}
      <div className="text-[10px] text-text-muted mb-2">
        {gearTypeLabel(item)}
        {itemIsWeapon && (item as Weapon).element && (
          <span className="ml-1">· {(item as Weapon).element}</span>
        )}
        {'sourceTag' in item && (
          <span className="ml-1">· {item.sourceTag}</span>
        )}
      </div>

      {/* inline stats */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted mb-3">
        {itemIsWeapon && (
          <>
            <span>Dmg {(item as Weapon).baseDamage}</span>
            <span>Spd {(item as Weapon).attackSpeed.toFixed(2)}</span>
            <span>Crit {((item as Weapon).critChance * 100).toFixed(1)}%</span>
            <span>Boss {((item as Weapon).bossDamageMod * 100).toFixed(0)}%</span>
          </>
        )}
        {isShield(item) && (
          <>
            <span>HP {(item as Shield).hp}</span>
            <span>Recharge {(item as Shield).rechargeRate}/s</span>
            <span>Mitigation {((item as Shield).mitigation * 100).toFixed(0)}%</span>
          </>
        )}
        {isClassMod(item) && (
          <span>Tree: {(item as ClassMod).treeBonus}</span>
        )}
        {isOrdnance(item) && (
          <>
            <span>Dmg {(item as Ordnance).damage}</span>
            <span>Effect: {(item as Ordnance).effect}</span>
          </>
        )}
        {isRelic(item) && (
          <span>{(item as Relic).affixes.length} affix{(item as Relic).affixes.length !== 1 ? 'es' : ''}</span>
        )}
        {/* affix count for all */}
        {'affixes' in item && item.affixes && item.affixes.length > 0 && !isRelic(item) && (
          <span>{item.affixes.length} affix{item.affixes.length !== 1 ? 'es' : ''}</span>
        )}
      </div>

      {/* action buttons */}
      <div className="flex items-center gap-2">
        {itemIsWeapon && action !== 'equipped' && (
          <button
            onClick={onEquip}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber/20 text-amber text-[11px] font-bold active:scale-95 transition-transform"
          >
            <Sword size={12} />
            Equip
          </button>
        )}
        {action === 'equipped' && (
          <span className="px-3 py-1.5 rounded-lg bg-green/20 text-green text-[11px] font-bold">
            ✓ Equipped
          </span>
        )}
        <button
          onClick={onLockToggle}
          disabled={action === 'scrapped' || action === 'equipped'}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-raised text-text-secondary text-[11px] font-bold active:scale-95 transition-transform disabled:opacity-30"
        >
          {itemIsLocked ? <Lock size={12} /> : <Unlock size={12} />}
          {itemIsLocked ? 'Locked' : 'Lock'}
        </button>
        <button
          onClick={onScrap}
          disabled={itemIsLocked || action === 'scrapped'}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red/10 text-red-light text-[11px] font-bold active:scale-95 transition-transform disabled:opacity-30"
        >
          <Scissors size={12} />
          Scrap
        </button>
      </div>
    </motion.div>
  );
};

// ─── main screen ──────────────────────────────────────────────────────

export const ChestScreen: React.FC = () => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();

  const [opening, setOpening] = useState(false);
  const [revealed, setRevealed] = useState<GearItem[] | null>(null);
  const [itemActions, setItemActions] = useState<Record<string, 'none' | 'scrapped' | 'locked' | 'unlocked' | 'equipped'>>({});

  const keys = player.cacheKeys;
  const frags = player.cacheKeyFragments;

  const handleOpen = () => {
    if (keys <= 0) return;
    player.removeCacheKeys(1);
    setOpening(true);
    setItemActions({});
    setTimeout(() => {
      const drops: GearItem[] = [];
      // primary roll: Rare 60% / Epic 32% / Legendary 8%
      const r = Math.random();
      let forcedRarity = Rarity.Rare;
      if (r > 0.6) forcedRarity = Rarity.Epic;
      if (r > 0.92) forcedRarity = Rarity.Legendary;
      drops.push(inventory.generateAndAdd({ source: DropSource.CacheForged, level: player.level, forcedRarity }));

      // bonus: 40% chance of a second Rare+ item
      if (Math.random() < 0.4) {
        drops.push(inventory.generateAndAdd({
          source: DropSource.CacheForged,
          level: player.level,
          forcedRarity: Math.random() > 0.5 ? Rarity.Rare : Rarity.Epic,
        }));
      }
      // bonus: 15% chance of a third Epic+ item
      if (Math.random() < 0.15) {
        drops.push(inventory.generateAndAdd({
          source: DropSource.CacheForged,
          level: player.level,
          forcedRarity: Rarity.Epic,
        }));
      }
      setRevealed(drops);
      setOpening(false);
    }, 2000);
  };

  const close = () => {
    setRevealed(null);
    setItemActions({});
  };

  // ── item actions ──────────────────────────────────────────────────

  const handleEquip = (item: GearItem, _idx: number) => {
    if (!isWeapon(item)) return;
    // auto-pick best available weapon slot
    const slots: LoadoutSlot[] = ['primary', 'secondary', 'heavy'];
    let targetSlot: LoadoutSlot | null = null;
    for (const slot of slots) {
      if (!loadout.slots[slot]) {
        targetSlot = slot;
        break;
      }
    }
    if (!targetSlot) targetSlot = 'primary'; // fallback: replace primary
    loadout.setSlot(targetSlot, item.id);
    setItemActions((prev) => ({ ...prev, [item.id]: 'equipped' }));
  };

  const handleScrap = (item: GearItem, _idx: number) => {
    if (item.isLocked) return;
    const result = inventory.scrapItem(item.id);
    player.addScrap(result.scrapValue);
    if (result.materials) {
      Object.entries(result.materials).forEach(([type, count]) => {
        if (count > 0) player.addMaterial(type, count);
      });
    }
    if (result.essences) {
      Object.entries(result.essences).forEach(([type, count]) => {
        if (count > 0) player.addEssence(type, count);
      });
    }
    setItemActions((prev) => ({ ...prev, [item.id]: 'scrapped' }));
  };

  const handleLockToggle = (item: GearItem, _idx: number) => {
    if (item.isLocked) {
      inventory.unlockItem(item.id);
      setItemActions((prev) => ({ ...prev, [item.id]: 'unlocked' }));
      // refresh the item reference
      const refreshed = inventory.getById(item.id);
      if (refreshed) {
        setRevealed((prev) => prev?.map((i) => (i.id === item.id ? refreshed : i)) ?? null);
      }
    } else {
      inventory.lockItem(item.id);
      setItemActions((prev) => ({ ...prev, [item.id]: 'locked' }));
      const refreshed = inventory.getById(item.id);
      if (refreshed) {
        setRevealed((prev) => prev?.map((i) => (i.id === item.id ? refreshed : i)) ?? null);
      }
    }
  };

  // ── odds display ──────────────────────────────────────────────────

  const odds: Record<string, string> = {
    Common: '0%',
    Uncommon: '0%',
    Rare: '60%',
    Epic: '32%',
    Legendary: '8%',
  };

  const visibleDrops = revealed?.filter((d) => itemActions[d.id] !== 'scrapped') ?? [];
  const canOpenAnother = keys > 0 && !opening;

  return (
    <div className="p-4 space-y-4 pb-20">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="text-lg font-black text-text-primary">Data Cache</div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-secondary">Keys:</span>
          <span className="text-amber font-bold">{keys}</span>
          {frags > 0 && (
            <span className="text-text-muted text-xs">(+{frags} frags)</span>
          )}
        </div>
      </div>

      {/* key fragments progress */}
      <div className="bg-surface-raised border border-border rounded-xl p-3">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-text-muted">Key Fragments</span>
          <span className="text-text-secondary font-bold">{frags} / 5</span>
        </div>
        <div className="w-full h-2 rounded-full bg-bg overflow-hidden">
          <div
            className="h-full rounded-full bg-amber transition-all duration-300"
            style={{ width: `${Math.min((frags / 5) * 100, 100)}%` }}
          />
        </div>
        <div className="text-[10px] text-text-muted mt-1">
          5 fragments = 1 Cache Key
        </div>
      </div>

      {/* main open panel */}
      <div className="bg-surface-raised border border-border rounded-2xl p-6 text-center space-y-3">
        <div className="w-20 h-20 mx-auto rounded-full bg-amber/10 border-2 border-amber flex items-center justify-center">
          <Box size={36} className="text-amber" />
        </div>
        <button
          onClick={handleOpen}
          disabled={keys <= 0 || opening}
          className="w-full py-3 rounded-xl bg-amber text-bg font-black text-sm uppercase tracking-wider disabled:opacity-40 active:scale-95 transition-transform"
        >
          {opening ? 'Decrypting...' : 'OPEN CACHE'}
        </button>
        <div className="flex items-center justify-center gap-1 text-[10px] text-text-muted">
          <Info size={10} />
          Guarantees Rare or better
        </div>
      </div>

      {/* odds breakdown */}
      <div className="space-y-1">
        <div className="text-xs font-bold text-text-muted uppercase">Cache Odds (per item)</div>
        {Object.values(RARITIES).map((r) => (
          <div key={r.id} className="flex items-center justify-between text-xs">
            <span style={{ color: r.color }} className="font-bold">{r.name}</span>
            <span className="text-text-muted">{odds[r.id] ?? '0%'}</span>
          </div>
        ))}
      </div>

      {/* bonus drop info */}
      <div className="bg-surface-raised border border-border rounded-xl p-3 space-y-1">
        <div className="text-xs font-bold text-text-muted uppercase mb-1">Bonus Drops</div>
        <div className="flex items-center gap-2 text-[11px] text-text-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-amber shrink-0" />
          40% chance of a second <span className="text-blue font-bold">Rare+</span> item
        </div>
        <div className="flex items-center gap-2 text-[11px] text-text-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-purple shrink-0" />
          15% chance of a third <span className="text-purple font-bold">Epic+</span> item
        </div>
      </div>

      {/* Opening Animation */}
      <AnimatePresence>
        {opening && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          >
            <motion.div
              animate={{ rotate: [0, -10, 10, -10, 0], scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 0.4 }}
              className="text-amber"
            >
              <Box size={80} />
            </motion.div>
            <div className="absolute bottom-20 text-amber font-bold text-sm animate-pulse">
              DECRYPTING CACHE...
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reveal overlay */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', delay: 0.1 }}
              className="text-amber mb-4"
            >
              <Sparkles size={48} />
            </motion.div>
            <div className="text-xl font-black text-amber mb-4">CACHE DECRYPTED</div>
            <div className="w-full max-w-[480px] space-y-3 max-h-[55vh] overflow-y-auto">
              {visibleDrops.map((item, i) => (
                <GearItemCard
                  key={item.id}
                  item={item}
                  action={itemActions[item.id] ?? 'none'}
                  onEquip={() => handleEquip(item, i)}
                  onScrap={() => handleScrap(item, i)}
                  onLockToggle={() => handleLockToggle(item, i)}
                />
              ))}
              {visibleDrops.length === 0 && (
                <div className="text-text-muted text-sm text-center py-8">
                  All items collected.
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 mt-4">
              {canOpenAnother && (
                <button
                  onClick={() => {
                    setRevealed(null);
                    setItemActions({});
                    handleOpen();
                  }}
                  className="px-5 py-2 rounded-xl bg-amber/20 border border-amber text-amber font-bold text-sm active:scale-95 transition-transform"
                >
                  Open Another
                </button>
              )}
              <button
                onClick={close}
                className="px-6 py-2 rounded-xl bg-amber text-bg font-bold text-sm active:scale-95 transition-transform"
              >
                Collect
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
