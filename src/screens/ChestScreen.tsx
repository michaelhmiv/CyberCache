import React, { useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Info, Lock, Play, Unlock } from 'lucide-react';
import { usePlayerStore, useInventoryStore, useIdleStore, useLoadoutStore } from '@/store';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';
import { isItemCompatibleWithSlot } from '@/lib/loadout/loadoutSlotCompat';
import { SwapUndoToast } from '@/components/action/SwapUndoToast';
import { RARITIES } from '@/constants/rarities';
import { verifiedOps, type VerifiedResult } from '@/lib/api/verifiedOps';
import { fetchCacheLane, type CacheLaneState } from '@/lib/api/cacheLaneService';
import { canUseRewardedCacheAds, showRewardedCacheAd } from '@/lib/ads/rewardedCacheAd';
import { CACHE_LANE_RULE, cacheLaneResetsAt } from '@/content/cacheLane';
import { serverItemRowToDisplayGear, type ServerItemRow } from '@/lib/api/serverItemAdapter';
import { GearItem, Weapon, Shield, ClassMod, Relic, Ordnance } from '@/types/items';
import { SHIELD_BEHAVIORS, shieldBehaviorOf } from '@/lib/combat/shieldBehaviors';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { ChestIllustration } from '@/components/common/ChestIllustration';
import { LootMoment } from '@/components/pixelArt/LootMoment';
import { getPixelSprite, pixelBackgroundForArea } from '@/lib/pixel/manifest';

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
  /** Audit UX-01: equips the revealed weapon in place via the
   *  shipped verified equip op (the button used to only navigate to
   *  the gear tab while saying "Equip"). The Phase 1 "one gear home"
   *  pin that kept equipping out of this surface was superseded by
   *  the 2026-11-01 UX audit — same exception class as flow-fix F11's
   *  loot-feed equip. */
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
            {shieldBehaviorOf(item as Shield) !== 'standard' && (
              <span>Behavior {SHIELD_BEHAVIORS[shieldBehaviorOf(item as Shield)].name}</span>
            )}
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
            onClick={onEquip}
            disabled={action === 'equipped'}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber/20 text-amber text-[11px] font-bold active:scale-95 transition-transform disabled:opacity-60"
          >
            <PxIcon name="crosshair" size={13} />
            {action === 'equipped' ? 'Equipped' : 'Equip'}
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
          <PxIcon name="recycle" size={13} />
          Salvage
        </button>
      </div>
    </motion.div>
  );
};

export const ChestScreen: React.FC<{ onNavigate?: (screen: string) => void }> = () => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();

  const [opening, setOpening] = useState(false);
  const [revealed, setRevealed] = useState<GearItem[] | null>(null);
  // P3 loot moment: the cache's contents celebrate first (rarity
  // ladder + legendary treatment), then the item cards take over.
  // The item was already granted by the server op before `revealed`
  // was set.
  const [momentDone, setMomentDone] = useState(false);
  const reducedMotion = !!useReducedMotion();
  const [itemActions, setItemActions] = useState<Record<string, 'none' | 'scrapped' | 'locked' | 'unlocked' | 'equipped'>>({});
  // Audit UX-01: the reveal equip's undo window (SwapUndoToast state).
  const [equipUndo, setEquipUndo] = useState<{ itemId: string; itemName: string; slot: LoadoutSlot; previousId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keys = player.cacheKeys;
  const frags = player.cacheKeyFragments;

  // Cache box lane (0037): the daily budget — 1 free box, then key
  // or watch-ad openings, 10 total per UTC day. The server enforces
  // all of it inside the open op; this state only presents it. The
  // ad offer lives HERE and nowhere else (no ads on the play
  // screen, ever).
  const [lane, setLane] = useState<CacheLaneState | null>(null);

  const refreshLane = async () => {
    const state = await fetchCacheLane();
    if (state) setLane(state);
  };

  useEffect(() => {
    let cancelled = false;
    fetchCacheLane().then((state) => {
      if (!cancelled && state) setLane(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Fold an open op's returned lane view (snake_case jsonb) into state. */
  const applyLaneFromResult = (result: VerifiedResult) => {
    const raw = result.cache_lane as Record<string, unknown> | undefined;
    if (!raw || typeof raw.day !== 'string') return;
    const by = (raw.by_payment ?? {}) as Record<string, number>;
    const profile = result.profile as { cache_tokens?: number } | undefined;
    setLane({
      day: raw.day,
      cap: Number(raw.cap ?? 10),
      freePerDay: Number(raw.free_per_day ?? 1),
      openedToday: Number(raw.opened_today ?? 0),
      remaining: Number(raw.remaining ?? 0),
      freeAvailable: raw.free_available === true,
      keys: Number(profile?.cache_tokens ?? keys),
      byPayment: {
        free: Number(by.free ?? 0),
        ad: Number(by.ad ?? 0),
        key: Number(by.key ?? 0),
      },
      resetsAt: cacheLaneResetsAt(raw.day),
      rule: CACHE_LANE_RULE,
    });
  };

  const openWith = async (payment: 'free' | 'ad' | 'key', adUnitId?: string) => {
    if (opening) return;
    setOpening(true);
    setError(null);
    setItemActions({});
    setEquipUndo(null);
    setMomentDone(false);
    try {
      const result = await verifiedOps.makeItem({ payment, adUnitId });
      applyLaneFromResult(result);
      const item = serverItemRowToDisplayGear(result.item as ServerItemRow);
      if (!item) {
        setError('Cache produced an unrecognizable item.');
        return;
      }
      setRevealed([item]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open cache.');
      void refreshLane();
    } finally {
      setOpening(false);
    }
  };

  const handleOpenFree = () => void openWith('free');
  const handleOpenKey = () => {
    if (keys > 0) void openWith('key');
  };
  const handleOpenAd = async () => {
    if (opening) return;
    setError(null);
    try {
      const reward = await showRewardedCacheAd(player.id);
      await openWith('ad', reward.adUnitId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open cache.');
    }
  };

  const adsReady = canUseRewardedCacheAds();
  const freeAvailable = lane?.freeAvailable ?? false;
  const capReached = lane !== null && lane.remaining <= 0;

  const close = () => {
    setRevealed(null);
    setItemActions({});
    setEquipUndo(null);
    setMomentDone(false);
  };

  // Reveal actions surface failures in the screen's error banner
  // (flow-fix F13) — they used to await the verified ops bare, so a
  // rejection left the card exactly as it was with no explanation.
  const handleScrap = async (item: GearItem, _idx: number) => {
    if (item.isLocked) return;
    setError(null);
    try {
      await verifiedOps.recycleItem(item.id);
      setItemActions((prev) => ({ ...prev, [item.id]: 'scrapped' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to scrap that item.');
    }
  };

  const handleLockToggle = async (item: GearItem, _idx: number) => {
    const nextLocked = !item.isLocked;
    setError(null);
    try {
      await verifiedOps.itemLock(item.id, nextLocked);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update the lock on that item.');
      return;
    }
    if (nextLocked) {
      inventory.lockItem(item.id);
      setItemActions((prev) => ({ ...prev, [item.id]: 'locked' }));
    } else {
      inventory.unlockItem(item.id);
      setItemActions((prev) => ({ ...prev, [item.id]: 'unlocked' }));
    }
    setRevealed((prev) => prev?.map((i) => (i.id === item.id ? { ...i, isLocked: nextLocked } : i)) ?? null);
  };

  // Audit UX-01: the reveal card's Equip button equips for real.
  // Slot resolution mirrors the shipped call sites (roaming feed F11,
  // gear home): first empty weapon slot, else primary — then the
  // strict compatibility rule (loadoutSlotCompat) gets the final say
  // before the verified op runs. On success the SwapUndoToast offers
  // the same one-tap reversal as the loadout panel: re-equip the
  // displaced item, or clear the slot when it was empty.
  const handleEquip = async (item: GearItem) => {
    const slots = useLoadoutStore.getState().slots;
    const slot = (['primary', 'secondary', 'heavy'] as LoadoutSlot[]).find((s) => !slots[s]) ?? 'primary';
    if (!isItemCompatibleWithSlot(item, slot)) {
      setError(`"${item.name}" doesn't fit the ${slot} slot — open Gear to place it manually.`);
      return;
    }
    const previousId = slots[slot] ?? null;
    setError(null);
    try {
      await verifiedOps.equipItem(item.id, slot);
      setItemActions((prev) => ({ ...prev, [item.id]: 'equipped' }));
      setEquipUndo({ itemId: item.id, itemName: item.name, slot, previousId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to equip that item.');
    }
  };

  const handleEquipUndo = async () => {
    const undo = equipUndo;
    if (!undo) return;
    setEquipUndo(null);
    setError(null);
    try {
      if (undo.previousId) await verifiedOps.equipItem(undo.previousId, undo.slot);
      else await verifiedOps.unequipSlot(undo.slot);
      setItemActions((prev) => ({ ...prev, [undo.itemId]: 'none' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to undo that equip.');
    }
  };

  const odds: Record<string, string> = {
    Common: '0%',
    Uncommon: '0%',
    Rare: '60%',
    Epic: '32%',
    Legendary: '8%',
  };

  const visibleItems = revealed?.filter((d) => itemActions[d.id] !== 'scrapped') ?? [];
  // The cache stage dresses in the player's CURRENT area (§5.9) — the
  // old hard-coded Dustwaste backdrop is gone.
  const currentAreaId = useIdleStore((state) => state.selectedRoamingAreaId);
  const zoneBg = getPixelSprite(pixelBackgroundForArea(currentAreaId) ?? 'zone-dustwaste-bg');
  const canOpenAnother =
    !opening &&
    (lane ? lane.remaining > 0 && (lane.freeAvailable || keys > 0) : keys > 0);

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div className="text-lg font-black text-text-primary">Data Cache</div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-secondary">Keys:</span>
          <span className="text-amber font-bold">{keys}</span>
          {frags > 0 && (
            <span className="text-text-muted text-xs">(+{frags} fragment{frags === 1 ? '' : 's'})</span>
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

      {lane && (
        <div className="bg-surface-raised border border-border rounded-xl p-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-text-muted">Cache Boxes Today</span>
            <span className="text-text-secondary font-bold">
              {lane.openedToday} / {lane.cap} opened · {lane.remaining} left
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-bg overflow-hidden">
            <div
              className="h-full rounded-full bg-amber transition-all duration-300"
              style={{ width: `${Math.min((lane.openedToday / Math.max(lane.cap, 1)) * 100, 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-text-muted mt-1">
            {lane.freeAvailable
              ? "Today's FREE box is ready below — no key, no ad."
              : capReached
                ? `Daily limit reached — the budget resets at 00:00 UTC (${new Date(lane.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} local).`
                : 'Free box used today — open more with a key or an ad.'}
          </div>
        </div>
      )}

      <div className="bg-surface-raised border border-border rounded-2xl p-6 text-center space-y-3">
        <div className="w-20 h-20 mx-auto flex items-center justify-center">
          <ChestIllustration tier="rare" size={80} open={opening} animate={opening} />
        </div>
        {capReached ? (
          <div className="rounded-xl border border-border bg-bg p-3 text-xs text-text-secondary">
            You&apos;ve opened all {lane?.cap ?? 10} of today&apos;s cache boxes. The daily
            budget resets at 00:00 UTC
            {lane
              ? ` (${new Date(lane.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} local)`
              : ''}{' '}
            — your first box tomorrow is free again.
          </div>
        ) : freeAvailable ? (
          <>
            <button
              onClick={handleOpenFree}
              disabled={opening}
              className="w-full py-3 rounded-xl bg-amber text-bg font-black text-sm uppercase tracking-wider disabled:opacity-40 active:scale-95 transition-transform"
            >
              {opening ? 'Decrypting...' : 'OPEN FREE CACHE'}
            </button>
            <div className="text-[10px] text-text-muted">
              Today&apos;s free box. After it, open more with a key or an ad — up to{' '}
              {lane?.cap ?? 10} boxes a day.
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <button
              onClick={handleOpenKey}
              disabled={keys <= 0 || opening}
              className="w-full py-3 rounded-xl bg-amber text-bg font-black text-sm uppercase tracking-wider disabled:opacity-40 active:scale-95 transition-transform"
            >
              {opening ? 'Decrypting...' : `OPEN WITH KEY (${keys})`}
            </button>
            <button
              onClick={handleOpenAd}
              disabled={opening || !adsReady}
              className="flex w-full items-center justify-center gap-2 py-3 rounded-xl bg-amber/20 border border-amber text-amber font-black text-sm uppercase tracking-wider disabled:opacity-40 active:scale-95 transition-transform"
            >
              <Play size={14} />
              Watch Ad to Open
            </button>
            {!adsReady && (
              <div className="text-[10px] text-text-muted">
                Rewarded ads are available in Android app builds.
              </div>
            )}
            {lane && (
              <div className="text-[10px] text-text-muted">
                {lane.remaining} of {lane.cap} boxes left today — always optional, keys work too.
              </div>
            )}
          </div>
        )}
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
              <PxIcon name="crate" size={40} />
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
              <PxIcon name="star" size={40} className="text-amber" />
            </motion.div>
            <div className="text-xl font-black text-amber mb-4">CACHE DECRYPTED</div>
            <div className="w-full max-w-[480px] space-y-3 max-h-[55vh] overflow-y-auto">
              {visibleItems.map((item, i) => (
                <GearItemCard
                  key={item.id}
                  item={item}
                  action={itemActions[item.id] ?? 'none'}
                  onEquip={() => void handleEquip(item)}
                  onScrap={() => handleScrap(item, i)}
                  onLockToggle={() => handleLockToggle(item, i)}
                />
              ))}
              {visibleItems.length === 0 && (
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
                    setEquipUndo(null);
                    if (freeAvailable) handleOpenFree();
                    else handleOpenKey();
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

      {/* Audit UX-01: equip confirmation + UNDO, same toast the
          loadout panel uses. Portaled, so it rides above the reveal
          overlay too. */}
      <SwapUndoToast
        visible={!!equipUndo}
        itemName={equipUndo?.itemName ?? ''}
        previousName={equipUndo?.previousId ? inventory.items.find((i) => i.id === equipUndo.previousId)?.name ?? null : null}
        onUndo={() => void handleEquipUndo()}
        onDismiss={() => setEquipUndo(null)}
      />
    </div>
  );
};
