import React, { useEffect, useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';
import {
  fetchProfileLifetime,
  setShowcasePins,
  type ProfileLifetimePayload,
  type ShowcaseItemPayload,
} from '@/lib/api/verifiedOps';
import { ShowcaseWeaponRow } from './ShowcaseRows';
import { COLLECTION_TOTAL } from '@/content/collections';
import { RARITIES } from '@/constants/rarities';
import { RARITY_RANK } from '@/lib/pixel/lootMoment';
import { Rarity } from '@/types/game';
import type { Weapon } from '@/types/items';
import { useInventoryStore } from '@/store';

/**
 * Trophy Shelf (Profile showcase, 0034; hand-pinning 0058) — the
 * player's brag surface.
 *
 * The shelf is the SERVER's top-3 weapons from GET
 * /api/profile/stats, rendered as the real item instances through
 * the shipped compositor (real-item invariant: the payload IS the
 * instance the generators minted — seed, parts, affixes and roll
 * quality all ride it). Since 0058 the owner can PIN favorites:
 * pinned weapons headline the shelf in pin order and the server
 * rank (rarity → level → newest) fills the remaining slots. Pins
 * are server state (POST /api/profile/showcase-pins, full-list
 * replace) — they survive devices; this panel computes nothing but
 * the candidate list, and the server validates ownership/kind/
 * showability regardless of what the picker offered. Alongside:
 * best endless depth, Cache Rank standing, and collection
 * completion — all folded server-side. Renders nothing until the
 * Chef answers, so an unreachable Chef simply omits the panel (the
 * CacheRankPanel pattern).
 */

const SHELF_SIZE = 3;

const FactChip: React.FC<{ label: string; value: string; tone: string }> = ({ label, value, tone }) => (
  <div className="bl-card min-w-0 flex-1 px-2 py-2 text-center" style={{ borderTopColor: tone, borderTopWidth: 3 }}>
    {/* Values print whole — "0 ranks · 0 tokens" wraps inside its
        chip rather than clipping at the chip edge (fidelity audit,
        drift-fix F4: the shipped shelf read as three stat boxes with
        ellipsized values). */}
    <div className="break-words text-sm font-black leading-tight text-text-primary">{value}</div>
    <div className="text-[11px] font-bold uppercase leading-tight tracking-wide text-text-muted">{label}</div>
  </div>
);

/**
 * The Collections fact chip is a DOOR, not a readout (redesign v2,
 * audit B3): the Trophy Shelf tile is the shelf's obvious entrance,
 * and before the redesign it opened nothing — the one live door was
 * a row buried in Account Tools. When the host provides
 * `onOpenCollections` the chip renders as a button carrying the same
 * fact; without a host it stays a plain chip.
 */
const CollectionsTile: React.FC<{
  discovered: number;
  onOpenCollections?: () => void;
}> = ({ discovered, onOpenCollections }) => {
  const body = (
    <>
      <div className="break-words text-sm font-black leading-tight text-text-primary">
        {discovered} / {COLLECTION_TOTAL}
      </div>
      <div className="text-[11px] font-bold uppercase leading-tight tracking-wide text-text-muted">Collections</div>
    </>
  );
  if (!onOpenCollections) {
    return (
      <div className="bl-card min-w-0 flex-1 px-2 py-2 text-center" style={{ borderTopColor: '#FF9800', borderTopWidth: 3 }}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpenCollections}
      data-testid="trophy-collections-tile"
      aria-label={`Open Collections — ${discovered} of ${COLLECTION_TOTAL} discovered`}
      className="bl-card min-w-0 flex-1 px-2 py-2 text-center transition-transform active:scale-[0.97]"
      style={{ borderTopColor: '#FF9800', borderTopWidth: 3 }}
    >
      {body}
    </button>
  );
};

const PinButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}> = ({ label, onClick, disabled = false, testId }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    data-testid={testId}
    className="bl-secondary shrink-0 px-2 py-2 text-[11px] font-black uppercase tracking-wide text-text-primary disabled:opacity-40"
  >
    {label}
  </button>
);

export const TrophyShelfPanel: React.FC<{
  onOpenCollections?: () => void;
  /**
   * Bare form (drift-fix F4): the approved Hunter composition
   * (mock m36) seats the shelf INSIDE the identity panel — one
   * panel: identity line, shelf header, trophy rows, fact boxes.
   * Bare renders the shelf content without its own card chrome so
   * the host panel carries it; the standalone card form remains
   * for any other host.
   */
  bare?: boolean;
}> = ({ onOpenCollections, bare = false }) => {
  const [data, setData] = useState<ProfileLifetimePayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inventoryItems = useInventoryStore((s) => s.items);

  useEffect(() => {
    let cancelled = false;
    fetchProfileLifetime()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        // Chef unreachable: the shelf stays hidden (Profile renders
        // the rest from its own services).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pins = useMemo(() => data?.showcase.pinned_item_ids ?? [], [data]);

  /** The picker's candidates: owned, showable weapons not already
   * pinned — strongest first. The server re-validates everything;
   * this filter only keeps the list honest at a glance (a sparse
   * starter with no rolled damage can never headline the shelf). */
  const candidates = useMemo(() => {
    const owned = inventoryItems.filter(
      (item): item is Weapon =>
        'weaponType' in item && typeof (item as Weapon).baseDamage === 'number' && (item as Weapon).baseDamage > 0,
    );
    return owned
      .filter((w) => !pins.includes(w.id))
      .sort(
        (a, b) =>
          (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0) || b.level - a.level,
      );
  }, [inventoryItems, pins]);

  if (!data) return null;
  const { showcase } = data;
  const weapons = showcase.top_weapons;

  const savePins = async (next: string[]) => {
    setSaving(true);
    setPinError(null);
    try {
      const result = await setShowcasePins(next);
      if (!result.ok) {
        setPinError(result.error ?? 'Those pins could not be saved.');
        return;
      }
      const fresh = await fetchProfileLifetime();
      setData(fresh);
    } catch {
      setPinError('Could not reach the Chef — your pins are unchanged.');
    } finally {
      setSaving(false);
    }
  };

  const movePin = (id: string, delta: number) => {
    const at = pins.indexOf(id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= pins.length) return;
    const next = [...pins];
    [next[at], next[to]] = [next[to], next[at]];
    void savePins(next);
  };

  const rowActions = (item: ShowcaseItemPayload): React.ReactNode => {
    const pinIndex = pins.indexOf(item.id);
    if (pinIndex >= 0) {
      return (
        <div className="flex shrink-0 flex-col gap-1">
          <div className="flex gap-1">
            <PinButton
              label="Up"
              testId={`trophy-pin-up-${item.id}`}
              disabled={saving || pinIndex === 0}
              onClick={() => movePin(item.id, -1)}
            />
            <PinButton
              label="Down"
              testId={`trophy-pin-down-${item.id}`}
              disabled={saving || pinIndex === pins.length - 1}
              onClick={() => movePin(item.id, 1)}
            />
          </div>
          <PinButton
            label="Unpin"
            testId={`trophy-unpin-${item.id}`}
            disabled={saving}
            onClick={() => void savePins(pins.filter((id) => id !== item.id))}
          />
        </div>
      );
    }
    if (pins.length < SHELF_SIZE) {
      return (
        <PinButton
          label="Pin"
          testId={`trophy-pin-${item.id}`}
          disabled={saving}
          onClick={() => void savePins([...pins, item.id])}
        />
      );
    }
    return null;
  };

  const shelfBody = (
    <>
      <div className="flex items-center gap-2">
        <PxIcon name="trophy" size={17} className="text-amber" />
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Trophy Shelf</div>
        <div className="ml-auto text-[11px] text-text-muted">
          {pins.length > 0 ? `${pins.length} pinned · ranked after` : 'Best gear, server-ranked'}
        </div>
      </div>

      {weapons.length === 0 ? (
        <div className="text-[11px] text-text-muted">
          No trophies yet — the first weapon worth shelving is still out there.
        </div>
      ) : (
        <div className="space-y-2">
          {weapons.map((item, index) => (
            <ShowcaseWeaponRow
              key={item.id}
              item={item}
              index={index}
              pinned={pins.includes(item.id)}
              actions={rowActions(item)}
              testId="trophy-weapon"
            />
          ))}
        </div>
      )}

      {pinError && (
        <div role="alert" className="border border-red/50 bg-red/10 px-2 py-1.5 text-[11px] font-bold text-text-primary">
          {pinError}
        </div>
      )}

      <div className="space-y-2">
        <button
          type="button"
          data-testid="trophy-pin-picker-toggle"
          onClick={() => setPickerOpen((open) => !open)}
          disabled={saving}
          className="bl-secondary w-full px-3 py-2.5 text-[11px] font-black uppercase tracking-wide text-text-primary disabled:opacity-40"
        >
          {pickerOpen ? 'Done picking' : pins.length >= SHELF_SIZE ? 'Shelf full — unpin to swap' : 'Pin a favorite'}
        </button>
        {pickerOpen && (
          <div data-testid="trophy-pin-picker" className="space-y-1">
            {candidates.length === 0 ? (
              <div className="text-[11px] text-text-muted">
                No other weapons to pin yet — every showable weapon you own is already on the shelf or pinned.
              </div>
            ) : (
              candidates.slice(0, 20).map((weapon) => {
                const color = RARITIES[weapon.rarity as Rarity]?.color ?? '#A5A7B5';
                return (
                  <div key={weapon.id} className="flex items-center gap-2 border border-border bg-bg px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-xs font-black leading-snug text-text-primary">{weapon.name}</div>
                      <div className="text-[11px] font-bold leading-snug" style={{ color }}>
                        {weapon.rarity} · Lv {weapon.level}
                      </div>
                    </div>
                    <PinButton
                      label="Pin"
                      testId={`trophy-pin-add-${weapon.id}`}
                      disabled={saving || pins.length >= SHELF_SIZE}
                      onClick={() => void savePins([...pins, weapon.id])}
                    />
                  </div>
                );
              })
            )}
            {candidates.length > 20 && (
              <div className="text-[11px] text-text-muted">Showing your strongest 20 — the rest wait their turn.</div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <FactChip label="Best Depth" value={String(showcase.best_endless_depth)} tone="#FF4B5C" />
        <FactChip
          label="Cache Rank"
          value={`${showcase.cache_rank_total_ranks} ranks · ${showcase.cache_rank_tokens} tokens`}
          tone="#F2C063"
        />
        <CollectionsTile discovered={showcase.collections_discovered} onOpenCollections={onOpenCollections} />
      </div>
    </>
  );

  if (bare) {
    return (
      <div data-testid="trophy-shelf" className="space-y-3">
        {shelfBody}
      </div>
    );
  }

  return (
    <div data-testid="trophy-shelf">
      <MobileCard className="space-y-3" rarityColor="#FFD166">
        {shelfBody}
      </MobileCard>
    </div>
  );
};
