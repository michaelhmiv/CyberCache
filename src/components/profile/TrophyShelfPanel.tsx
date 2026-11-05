import React, { useEffect, useMemo, useState } from 'react';
import {
  fetchProfileLifetime,
  setShowcasePins,
  type ProfileLifetimePayload,
  type ShowcaseItemPayload,
} from '@/lib/api/verifiedOps';
import { RARITIES } from '@/constants/rarities';
import { RARITY_RANK } from '@/lib/pixel/lootMoment';
import { Rarity } from '@/types/game';
import type { Weapon } from '@/types/items';
import { useInventoryStore } from '@/store';
import {
  TM_FAINT,
  TM_GOLD,
  TM_INK,
  TM_MUT,
  tmHeadStyle,
  tmMonoStyle,
} from './profileTelemetryTheme';
import {
  TmLed,
  TmPanel,
  TmPanelLabel,
  TmReadoutRow,
} from './profileTelemetry';

/**
 * Trophy Shelf (Profile showcase, 0034; hand-pinning 0058) — the
 * player's brag surface, restyled as the Instrument Panel's
 * PINNED UNITS spec sheet (Register B, owner pick 2026-11-05):
 * each shelved weapon reads as a unit under test — rarity LED,
 * the real generated name set solid, a PINNED stamp, and a mono
 * spec line read straight off the item instance.
 *
 * The shelf is the SERVER's top-3 weapons from GET
 * /api/profile/stats (the payload IS the instance the generators
 * minted — seed, parts, affixes and roll quality all ride it).
 * Since 0058 the owner can PIN favorites: pinned weapons headline
 * the shelf in pin order and the server rank (rarity → level →
 * newest) fills the remaining slots. Pins are server state (POST
 * /api/profile/showcase-pins, full-list replace) — they survive
 * devices; this panel computes nothing but the candidate list,
 * and the server validates ownership/kind/showability regardless
 * of what the picker offered. Alongside: the Cache Rank balance
 * as the panel's foot readout and the Collections door (its
 * count prints once, in the record bank) — all folded
 * server-side. Renders nothing until the Chef answers, so an
 * unreachable Chef simply omits the panel (the CacheRankPanel
 * pattern).
 */

const SHELF_SIZE = 3;

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * One pinned unit's spec sheet row. The spec lines read the
 * payload's own fields — a field the instance does not carry is
 * simply not printed (no invented specs).
 */
const SpecRow: React.FC<{
  item: ShowcaseItemPayload;
  pinned: boolean;
  actions?: React.ReactNode;
  testId?: string;
}> = ({ item, pinned, actions, testId = 'showcase-weapon' }) => {
  const payload = item.payload ?? {};
  const name = str(payload.name) ?? 'Weapon';
  const rarity = item.rarity ?? str(payload.rarity) ?? 'Common';
  const level = item.item_level ?? num(payload.level) ?? 1;
  const color = RARITIES[rarity as Rarity]?.color ?? '#A5A7B5';
  const type = str(payload.weaponType);
  const manufacturer = str(payload.manufacturer);
  const line1 = [
    `LV ${level}`,
    ...(type ? [type.toUpperCase()] : []),
    ...(manufacturer ? [manufacturer.toUpperCase()] : []),
    rarity.toUpperCase(),
    ...(item.equipped_slot != null ? ['EQUIPPED'] : []),
  ].join(' · ');
  const dmg = num(payload.baseDamage);
  const spd = num(payload.attackSpeed);
  const crit = num(payload.critChance);
  const rollQ = num(payload.rollQuality);
  const line2 = [
    ...(dmg !== null ? [`DMG ${Math.round(dmg)}`] : []),
    ...(spd !== null ? [`SPD ${spd.toFixed(1)}/S`] : []),
    ...(crit !== null ? [`CRIT ${(crit * 100).toFixed(1)}%`] : []),
    ...(rollQ !== null ? [`ROLL Q${Math.round(rollQ <= 1 ? rollQ * 100 : rollQ)}`] : []),
  ].join(' · ');
  return (
    <div data-testid={testId} className="flex items-start gap-2.5 py-2" style={{ borderBottom: '1px solid rgba(58,52,43,0.55)' }}>
      <span className="pt-1">
        <TmLed lit color={color} size={10} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="break-words text-[14px] font-bold leading-tight" style={{ ...tmHeadStyle, color: TM_INK }}>
            {name}
          </span>
          {pinned && (
            <span className="shrink-0 text-[11px] font-black uppercase" style={{ ...tmMonoStyle, color: TM_GOLD, letterSpacing: '0.12em' }}>
              Pinned
            </span>
          )}
        </span>
        <span className="block break-words text-[11px] leading-tight" style={{ ...tmMonoStyle, color: TM_MUT }}>
          {line1}
        </span>
        {line2 && (
          <span className="block break-words text-[11px] leading-tight" style={{ ...tmMonoStyle, color: TM_FAINT }}>
            {line2}
          </span>
        )}
      </span>
      {actions}
    </div>
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
    className="shrink-0 px-2 py-2 text-[11px] font-black uppercase tracking-wide disabled:opacity-40"
    style={{
      border: '2px solid #000',
      background: 'linear-gradient(180deg, #241D15 0%, #171310 70%)',
      boxShadow: 'inset 0 0 0 1px rgba(163,152,134,0.35), 0 2px 0 #000',
      color: TM_MUT,
      ...tmMonoStyle,
    }}
  >
    {label}
  </button>
);

export const TrophyShelfPanel: React.FC<{
  onOpenCollections?: () => void;
  /**
   * Bare form (drift-fix F4): the host panel carries the shelf.
   * In the Instrument Panel build the shelf is its own rack panel
   * in both forms — the prop remains for host compatibility.
   */
  bare?: boolean;
}> = ({ onOpenCollections, bare = false }) => {
  void bare;
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

  return (
    <TmPanel testId="trophy-shelf">
      <TmPanelLabel label="Pinned Units" right="Trophy Shelf · Top 3" />
      <div className="mb-1 text-[11px]" style={{ ...tmMonoStyle, color: TM_FAINT }}>
        {pins.length > 0 ? `${pins.length} pinned · ranked after` : 'Best gear, server-ranked'}
      </div>

      {weapons.length === 0 ? (
        <div className="py-1 text-[11px]" style={{ ...tmMonoStyle, color: TM_FAINT }}>
          No trophies yet — the first weapon worth shelving is still out there.
        </div>
      ) : (
        <div>
          {weapons.map((item) => (
            <SpecRow
              key={item.id}
              item={item}
              pinned={pins.includes(item.id)}
              actions={rowActions(item)}
              testId="trophy-weapon"
            />
          ))}
        </div>
      )}

      {pinError && (
        <div role="alert" className="mt-2 px-2 py-1.5 text-[11px] font-bold" style={{ border: '1px solid rgba(255,90,77,0.5)', background: 'rgba(255,90,77,0.10)', color: TM_INK }}>
          {pinError}
        </div>
      )}

      <div className="mt-2.5 space-y-2">
        <button
          type="button"
          data-testid="trophy-pin-picker-toggle"
          onClick={() => setPickerOpen((open) => !open)}
          disabled={saving}
          className="min-h-[44px] w-full px-3 py-2.5 text-[11px] font-black uppercase tracking-wide disabled:opacity-40"
          style={{
            border: '2px solid #000',
            background: 'linear-gradient(180deg, #241D15 0%, #171310 70%)',
            boxShadow: 'inset 0 0 0 1px rgba(163,152,134,0.35), 0 3px 0 #000',
            color: TM_MUT,
            ...tmMonoStyle,
          }}
        >
          {pickerOpen ? 'Done picking' : pins.length >= SHELF_SIZE ? 'Shelf full — unpin to swap' : 'Pin a favorite'}
        </button>
        {pickerOpen && (
          <div data-testid="trophy-pin-picker" className="space-y-1">
            {candidates.length === 0 ? (
              <div className="text-[11px]" style={{ ...tmMonoStyle, color: TM_FAINT }}>
                No other weapons to pin yet — every showable weapon you own is already on the shelf or pinned.
              </div>
            ) : (
              candidates.slice(0, 20).map((weapon) => {
                const color = RARITIES[weapon.rarity as Rarity]?.color ?? '#A5A7B5';
                return (
                  <div key={weapon.id} className="flex items-center gap-2 px-2 py-1.5" style={{ border: '1px solid #3A342B', background: '#0A0806' }}>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-xs font-black leading-snug" style={{ color: TM_INK }}>{weapon.name}</div>
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
              <div className="text-[11px]" style={{ ...tmMonoStyle, color: TM_FAINT }}>Showing your strongest 20 — the rest wait their turn.</div>
            )}
          </div>
        )}
      </div>

      <div className="mt-1.5">
        {/* The shelf's foot is the Cache Rank balance only
            (prototype B): endless best depth and the collection
            count print exactly once, in the record's career bank
            above — never re-printed here. */}
        <TmReadoutRow
          label="Cache Rank"
          value={`${showcase.cache_rank_total_ranks} ranks · ${showcase.cache_rank_tokens} tokens`}
        />
      </div>

      {onOpenCollections && (
        <button
          type="button"
          onClick={onOpenCollections}
          data-testid="trophy-collections-tile"
          aria-label="Open Collections"
          className="mt-2.5 flex min-h-[48px] w-full items-center gap-3 px-3.5 text-left active:translate-y-[2px]"
          style={{
            border: '2px solid #000',
            background: 'linear-gradient(180deg, #241D15 0%, #171310 70%)',
            boxShadow: 'inset 0 0 0 1px rgba(163,152,134,0.35), inset 0 1px 0 rgba(245,239,230,0.10), 0 3px 0 #000',
          }}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-black uppercase leading-tight" style={{ fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '0.08em', color: TM_INK }}>
              Collections
            </span>
            <span className="block text-[11px] leading-snug" style={{ ...tmMonoStyle, color: TM_FAINT }}>
              Effects, bosses, frames, and named elites you've proven
            </span>
          </span>
        </button>
      )}
    </TmPanel>
  );
};
