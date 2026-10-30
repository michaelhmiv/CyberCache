import React, { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Info, Lock, Unlock } from 'lucide-react';
import { usePlayerStore, useInventoryStore } from '@/store';
import { RARITIES } from '@/constants/rarities';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { serverItemRowToDisplayGear, type ServerItemRow } from '@/lib/api/serverItemAdapter';
import { GearItem, Weapon, Shield, ClassMod, Relic, Ordnance } from '@/types/items';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { ChestIllustration } from '@/components/common/ChestIllustration';
import { LootMoment } from '@/components/pixelArt/LootMoment';
import { getPixelSprite } from '@/lib/pixel/manifest';

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
  action: 'none' | 'scrapped' | 'locked' | 'unlocked';
  /** Phase 1 (one gear home): no equipping here — this door routes to
   *  the gear home, where the Slot Picker equips. */
  onOpenGear: () => void;
  onScrap: () => void;
  onLockToggle: () => void;
}> = ({ item, action, onOpenGear, onScrap, onLockToggle }) => {
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
      <div className="flex justify-center mb-3">
        <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-bg">
          <GearIllustration item={item} size={72} showBadges={false} />
        </div>
      </div>
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

      <div className="text-[10px] text-text-muted mb-2">
        {gearTypeLabel(item)}
        {itemIsWeapon && (item as Weapon).element && (
          <span className="ml-1">· {(item as Weapon).element}</span>
        )}
        {'sourceTag' in item && (
          <span className="ml-1">· {item.sourceTag}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted mb-3">
        {itemIsWeapon && (
          <>
            <span>Dmg {(item as Weapon).baseDamage}</span>
            <span>Spd {((item as Weapon).attackSpeed ?? 0).toFixed(2)}</span>
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
        {'affixes' in item && item.affixes && item.affixes.length > 0 && !isRelic(item) && (
          <span>{item.affixes.length} affix{item.affixes.length !== 1 ? 'es' : ''}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {itemIsWeapon && (
          <button
            onClick={onOpenGear}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber/20 text-amber text-[11px] font-bold active:scale-95 transition-transform"
          >
            <span style={{ fontSize: '12px' }}>⚔</span>
            Equip in Gear
          </button>
        )}
        <button
          onClick={onLockToggle}
          disabled={action === 'scrapped'}
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
          <span style={{ fontSize: 12 }}>♻</span>
          Salvage
        </button>
      </div>
    </motion.div>
  );
};

export const ChestScreen: React.FC<{ onNavigate?: (screen: string) => void }> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();

  const [opening, setOpening] = useState(false);
  const [revealed, setRevealed] = useState<GearItem[] | null>(null);
  // P3 loot moment: the cache's drop celebrates first (rarity ladder +
  // legendary treatment), then the item cards take over. The item was
  // already granted by the server op before `revealed` was set.
  const [momentDone, setMomentDone] = useState(false);
  const reducedMotion = !!useReducedMotion();
  const [itemActions, setItemActions] = useState<Record<string, 'none' | 'scrapped' | 'locked' | 'unlocked'>>({});
  const [error, setError] = useState<string | null>(null);

  const keys = player.cacheKeys;
  const frags = player.cacheKeyFragments;

  const handleOpen = async () => {
    if (keys <= 0 || opening) return;
    setOpening(true);
    setError(null);
    setItemActions({});
    setMomentDone(false);
    try {
      const result = await verifiedOps.makeItem();
      const item = serverItemRowToDisplayGear(result.item as ServerItemRow);
      if (!item) {
        setError('Cache produced an unrecognizable item.');
        return;
      }
      setRevealed([item]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open cache.');
    } finally {
      setOpening(false);
    }
  };

  const close = () => {
    setRevealed(null);
    setItemActions({});
    setMomentDone(false);
  };

  const handleScrap = async (item: GearItem, _idx: number) => {
    if (item.isLocked) return;
    await verifiedOps.recycleItem(item.id);
    setItemActions((prev) => ({ ...prev, [item.id]: 'scrapped' }));
  };

  const handleLockToggle = async (item: GearItem, _idx: number) => {
    const nextLocked = !item.isLocked;
    await verifiedOps.itemLock(item.id, nextLocked);
    if (nextLocked) {
      inventory.lockItem(item.id);
      setItemActions((prev) => ({ ...prev, [item.id]: 'locked' }));
    } else {
      inventory.unlockItem(item.id);
      setItemActions((prev) => ({ ...prev, [item.id]: 'unlocked' }));
    }
    setRevealed((prev) => prev?.map((i) => (i.id === item.id ? { ...i, isLocked: nextLocked } : i)) ?? null);
  };

  const odds: Record<string, string> = {
    Common: '0%',
    Uncommon: '0%',
    Rare: '60%',
    Epic: '32%',
    Legendary: '8%',
  };

  const visibleDrops = revealed?.filter((d) => itemActions[d.id] !== 'scrapped') ?? [];
  const zoneBg = getPixelSprite('zone-dustwaste-bg');
  const canOpenAnother = keys > 0 && !opening;

  return (
    <div className="p-4 space-y-4 pb-20">
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

      {error && (
        <div className="rounded-xl border border-red/30 bg-red/10 p-3 text-xs text-red-light">
          {error}
        </div>
      )}

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

      <div className="bg-surface-raised border border-border rounded-2xl p-6 text-center space-y-3">
        <div className="w-20 h-20 mx-auto flex items-center justify-center">
          <ChestIllustration tier="rare" size={80} open={opening} animate={opening} />
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
          Server-verified rarity roll · Rare or better
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-xs font-bold text-text-muted uppercase">Server Odds</div>
        {Object.values(RARITIES).map((r) => (
          <div key={r.id} className="flex items-center justify-between text-xs">
            <span style={{ color: r.color }} className="font-bold">{r.name}</span>
            <span className="text-text-muted">{odds[r.id] ?? '0%'}</span>
          </div>
        ))}
      </div>

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
              <span className="font-black text-amber" style={{ fontSize: '80px' }}>▤</span>
            </motion.div>
            <div className="absolute bottom-20 text-amber font-bold text-sm animate-pulse">
              DECRYPTING CACHE...
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4"
          >
            {!momentDone ? (
              <>
                {/* P3 loot moment over the pixel zone backdrop — the
                    cache's actual drop, celebrated before the cards. */}
                {zoneBg && (
                  <img src={zoneBg.url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-55" style={{ imageRendering: 'pixelated' }} />
                )}
                <div className="absolute left-0 right-0 top-8 z-50 text-center">
                  <div className="text-xl font-black text-amber">CACHE DECRYPTED</div>
                </div>
                <LootMoment
                  items={revealed}
                  surface="stage"
                  reduced={reducedMotion}
                  anchorXPct={50}
                  groundYPct={74}
                  onDone={() => setMomentDone(true)}
                  testId="cache-loot-moment"
                />
              </>
            ) : (
              <>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', delay: 0.1 }}
              className="text-amber mb-4"
            >
              <span className="font-black text-amber" style={{ fontSize: '48px' }}>✦</span>
            </motion.div>
            <div className="text-xl font-black text-amber mb-4">CACHE DECRYPTED</div>
            <div className="w-full max-w-[480px] space-y-3 max-h-[55vh] overflow-y-auto">
              {visibleDrops.map((item, i) => (
                <GearItemCard
                  key={item.id}
                  item={item}
                  action={itemActions[item.id] ?? 'none'}
                  onOpenGear={() => onNavigate?.('inventory')}
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
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
