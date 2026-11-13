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
import { CACHE_LANE_RULE } from '@/content/cacheLane';
import { serverItemRowToDisplayGear, type ServerItemRow } from '@/lib/api/serverItemAdapter';
import { GearItem, Weapon, Shield, ClassMod, Relic, Ordnance } from '@/types/items';
import { ItemStatDeck } from '@/components/gear/itemStatDeck';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
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

      {/* The FULL stat deck — the same shared rendering the
          inspect sheet uses (itemStatDeck), so the reveal can never
          disagree with inspect about an item's numbers: DPS, every
          affix line by its display text, legendary effect name +
          description, class-mod node boosts by name. (Owner,
          2026-11-04: "show more stats" — the old hand-rolled line
          printed four weapon numbers and bare affix counts.) */}
      <div className="mb-3">
        <ItemStatDeck item={item} />
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
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-raised text-text-secondary text-[11px] font-bold active:scale-95 transition-transform disabled:opacity-30"
        >
          {itemIsLocked ? <Lock size={12} /> : <Unlock size={12} />}
          {itemIsLocked ? 'Locked' : 'Lock'}
        </button>
        <button
          onClick={onScrap}
          disabled={itemIsLocked}
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
  // ladder + legendary treatment) on the reveal page's stage; when
  // the moment completes, the item cards appear BELOW the stage on
  // the same page (one page, no phase swap — owner, 2026-11-04).
  // The item was already granted by the server op before `revealed`
  // was set.
  const [momentDone, setMomentDone] = useState(false);
  const reducedMotion = !!useReducedMotion();
  const [itemActions, setItemActions] = useState<Record<string, 'none' | 'scrapped' | 'locked' | 'unlocked' | 'equipped'>>({});
  // Audit UX-01: the reveal equip's undo window (SwapUndoToast state).
  const [equipUndo, setEquipUndo] = useState<{ itemId: string; itemName: string; slot: LoadoutSlot; previousId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keys = player.cacheKeys;

  // Cache box lane (0037, rebuilt 0082): no daily budget — every
  // opening is paid with 1 cache key or one rewarded-ad
  // attestation, uncapped. The server enforces payment inside the
  // open op; this state only presents the key stock. The ad offer
  // lives HERE and nowhere else (no ads on the play screen, ever).
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
    if (!raw) return;
    const profile = result.profile as { cache_tokens?: number } | undefined;
    setLane({
      keys: Number(raw.keys ?? profile?.cache_tokens ?? keys),
      rule: typeof raw.rule === 'string' ? raw.rule : CACHE_LANE_RULE,
    });
  };

  const openWith = async (payment: 'ad' | 'key', adUnitId?: string) => {
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
  // The cache itself (the in-game crate prop — the same crate identity
  // the app icon carries): the Top-Choice logo-identity master (navy,
  // brass, gold-lit cracks, hex medallion), keyed from the adopted
  // painting. The procedural SVG chest retired with the item-moment
  // reveal (census C-5): the lane, the decrypt overlay, and the reveal
  // prop all show THIS crate, and no surface colors it by a rarity the
  // roll hasn't happened yet. Painterly art renders smooth — the
  // pixelated seat exception the light kit set inside the loot moment
  // (PR #483) applies here too.
  const cachePropSprite = getPixelSprite('prop-cache-crate');
  const canOpenAnother = !opening && keys > 0;

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div className="text-lg font-black text-text-primary">Data Cache</div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-secondary">Keys:</span>
          <span className="text-amber font-bold">{keys}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red/30 bg-red/10 p-3 text-xs text-red-light">
          {error}
        </div>
      )}

      <div className="bg-surface-raised border border-border rounded-2xl p-6 text-center space-y-3">
        <div className="mx-auto flex items-center justify-center">
          {cachePropSprite && (
            <img
              src={cachePropSprite.url}
              alt=""
              draggable={false}
              style={{ width: 150 }}
            />
          )}
        </div>
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
            <div className="text-[10px] text-text-muted">
              {lane?.rule ?? CACHE_LANE_RULE}
            </div>
          </div>
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
              {cachePropSprite && (
                <img
                  src={cachePropSprite.url}
                  alt=""
                  draggable={false}
                  style={{ width: 150 }}
                />
              )}
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
            className="fixed inset-0 z-50 overflow-y-auto bg-black/90"
          >
            {/* ONE reveal page (owner, 2026-11-04): the loot moment
                plays on the stage at the top — its composition,
                backdrop, header and choreography are UNTOUCHED — and
                when it completes, the stat deck + actions render
                BELOW it on this same page instead of the overlay
                swapping to a separate card phase (the old swap read
                as a second pop-up arriving too fast).
                SETTLED PRESENTATION (owner device report, 2026-11-12):
                at 'done' the moment unmounts by its own contract, so
                a stage that kept its full-viewport height stranded
                the deck exactly one screen below the fold — the
                player was left staring at the header over an empty
                stage while the item, its stats, and its actions sat
                off-screen with no scroll cue. Once the moment is
                done, the stage therefore yields its height and
                settles to the header band, so the deck presents in
                the first viewport directly under CACHE DECRYPTED. */}
            <div
              data-testid="cache-reveal-stage"
              className={`relative w-full ${reducedMotion ? '' : 'transition-[height] duration-500 ease-out'} ${momentDone ? 'h-[120px]' : 'h-dvh'}`}
            >
              {/* P3 loot moment over the pixel zone backdrop — the
                  cache's actual drop, celebrated before the cards. */}
              {zoneBg && (
                <img src={zoneBg.url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-55" style={{ imageRendering: 'pixelated' }} />
              )}
              {/* Header law (DESIGN.md §8): the header text is an
                  unmodified top layer above every FX canvas; it sits
                  on a soft dark underlay, and the beam's luminance is
                  notched behind this band (headerBandPx below), so
                  CACHE DECRYPTED reads clean at every reveal frame. */}
              <div className="absolute left-0 right-0 top-8 z-50 text-center">
                <div
                  aria-hidden
                  className="absolute left-1/2 top-1/2 -z-10 h-[76px] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-[50%]"
                  style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.34) 48%, rgba(0,0,0,0) 74%)' }}
                />
                <div className="relative text-xl font-black text-amber">CACHE DECRYPTED</div>
              </div>
              <LootMoment
                items={revealed}
                surface="stage"
                reduced={reducedMotion}
                anchorXPct={50}
                groundYPct={74}
                propCache
                headerBandPx={{ top: 24, bottom: 72 }}
                onDone={() => setMomentDone(true)}
                testId="cache-loot-moment"
              />
            </div>
            {momentDone && (
              <div data-testid="cache-reveal-deck" className="relative z-10 mx-auto w-full max-w-[480px] px-4 pb-10 pt-2">
                <div className="space-y-3">
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
                <div className="flex items-center justify-center gap-3 mt-4">
                  {canOpenAnother && (
                    <button
                      onClick={() => {
                        setRevealed(null);
                        setItemActions({});
                        setEquipUndo(null);
                        handleOpenKey();
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
              </div>
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
