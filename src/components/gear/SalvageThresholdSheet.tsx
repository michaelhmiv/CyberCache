/**
 * SalvageThresholdSheet — the bulk-salvage door (owner ruling,
 * 2026-11-02; DESIGN.md governs).
 *
 * The old bulk flow looped the per-item op once per selected item:
 * a 1,000+ item salvage fired 1,000 requests and 1,000 pop-ups and
 * froze the game. Bulk salvage is now a THRESHOLD choice: pick the
 * rarity ceiling ("everything Rare and under"), the server settles
 * the whole eligible set in ONE call (verifiedOps.recycleBatch), and
 * exactly ONE summary lands in the salvage feed.
 *
 * Rules baked into this sheet:
 *   - Counts are live and honest: they count the eligible set the
 *     server will resolve (unlocked, unequipped gear at or under the
 *     ceiling), computed from the same store rows the grid shows.
 *   - 'Epic & under' needs a second, explicit confirmation that
 *     states the epic count — epics never go in a bulk tap by reflex.
 *   - Legendaries are NEVER in a bulk ceiling. The sheet says so;
 *     they salvage one at a time from the item card.
 *   - A ceiling with nothing under it is shown disabled WITH its
 *     reason ("None in inventory") — every 'no' carries its reason.
 *   - Failure is plain and in place: nothing was scrapped, the sheet
 *     stays open, and the message says so.
 */
import React, { useMemo, useState } from 'react';
import { PickerSheet } from '@/components/common/PickerSheet';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { formatRpcError } from '@/lib/api/rpcError';
import { useSalvageFeedStore } from '@/store/slices/salvageFeedSlice';
import type { GearItem } from '@/types/items';

const SALVAGE_RARITY_RANK: Record<string, number> = {
  Common: 1,
  Uncommon: 2,
  Rare: 3,
  Epic: 4,
  Legendary: 5,
};

const SALVAGE_CEILINGS = [
  { value: 'Common', label: 'Commons only' },
  { value: 'Uncommon', label: 'Uncommon & under' },
  { value: 'Rare', label: 'Rare & under' },
  { value: 'Epic', label: 'Epic & under' },
] as const;

type SalvageCeiling = (typeof SALVAGE_CEILINGS)[number]['value'];

const RARITY_TEXT: Record<string, string> = {
  Common: 'text-[#A5A7B5]',
  Uncommon: 'text-[#7CFC00]',
  Rare: 'text-[#5AA7FF]',
  Epic: 'text-[#FF9DF5]',
};

interface SalvageThresholdSheetProps {
  /** The eligible set: unlocked + unequipped gear (GearHub's junk set). */
  eligibleItems: GearItem[];
  onClose: () => void;
  /** Fired after a successful settlement (hub clears selection state). */
  onSettled: () => void;
}

export const SalvageThresholdSheet: React.FC<SalvageThresholdSheetProps> = ({
  eligibleItems,
  onClose,
  onSettled,
}) => {
  const [confirmingEpic, setConfirmingEpic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const byCeiling: Record<string, number> = {};
    for (const ceiling of SALVAGE_CEILINGS) {
      const rank = SALVAGE_RARITY_RANK[ceiling.value];
      byCeiling[ceiling.value] = eligibleItems.filter(
        (item) => (SALVAGE_RARITY_RANK[item.rarity] ?? 99) <= rank,
      ).length;
    }
    return byCeiling;
  }, [eligibleItems]);

  const epicCount = useMemo(
    () => eligibleItems.filter((item) => item.rarity === 'Epic').length,
    [eligibleItems],
  );

  const settle = async (ceiling: SalvageCeiling) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifiedOps.recycleBatch(ceiling);
      // Exactly ONE feed event for the whole settlement.
      useSalvageFeedStore.getState().pushBatch({
        maxRarity: typeof result.max_rarity === 'string' ? result.max_rarity : ceiling,
        totalItems: Number(result.scrapped_count ?? 0),
        countsByRarity: (result.counts_by_rarity as Record<string, number> | undefined) ?? {},
        scrap: Number(result.scrap_award ?? 0),
        cores: Number(result.cores_award ?? 0),
        bonusMaterials: (result.bonus_materials as Record<string, number> | undefined) ?? {},
      });
      onSettled();
      onClose();
    } catch (err) {
      setError(`Scrapping failed — nothing was scrapped. ${formatRpcError(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const onCeilingTap = (ceiling: SalvageCeiling) => {
    if (busy) return;
    if (ceiling === 'Epic') {
      setError(null);
      setConfirmingEpic(true);
      return;
    }
    void settle(ceiling);
  };

  return (
    <PickerSheet
      title="Salvage by rarity"
      subtitle="One tap scraps everything at or under the level you pick — settled in a single moment, with one summary."
      onClose={onClose}
    >
      {error && (
        <div className="mb-3 border border-red/40 bg-red/10 p-2 text-[11px] font-bold text-red-light" role="alert">
          {error}
        </div>
      )}

      {confirmingEpic ? (
        <div data-testid="salvage-epic-confirm">
          <div className="text-sm font-black text-text-primary">
            Scrap {counts.Epic} items, including{' '}
            <span className="text-[#FF9DF5]">{epicCount} Epic{epicCount === 1 ? '' : 's'}</span>?
          </div>
          <p className="mt-1 text-[11px] font-bold leading-snug text-text-muted">
            Epics are gone for good once scrapped. Legendaries are not included — they are never bulk-scrapped.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void settle('Epic')}
              className="flex-1 rounded-lg border border-red/40 bg-red/10 px-3 py-2.5 text-xs font-black text-red disabled:opacity-50"
            >
              {busy ? 'Scrapping…' : `Scrap all ${counts.Epic}`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingEpic(false)}
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-xs font-black text-text-muted disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {SALVAGE_CEILINGS.map((ceiling) => {
            const count = counts[ceiling.value];
            const disabled = busy || count === 0;
            return (
              <button
                key={ceiling.value}
                type="button"
                disabled={disabled}
                onClick={() => onCeilingTap(ceiling.value)}
                className={`flex w-full items-center gap-3 border-2 border-border bg-surface-raised p-3 text-left transition-colors ${
                  disabled ? 'opacity-50' : 'hover:border-amber/50'
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-border bg-surface">
                  <PxIcon name="recycle" size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs font-black uppercase tracking-wide ${RARITY_TEXT[ceiling.value]}`}>
                    {ceiling.label}
                  </span>
                  {ceiling.value === 'Epic' && epicCount > 0 && (
                    <span className="mt-0.5 block text-[11px] font-bold text-text-muted">
                      Includes {epicCount} Epic{epicCount === 1 ? '' : 's'} — asks first
                    </span>
                  )}
                  {count === 0 && (
                    <span className="mt-0.5 block text-[11px] font-bold text-text-muted">
                      None in inventory
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-black text-text-primary">
                  {count} item{count === 1 ? '' : 's'}
                </span>
              </button>
            );
          })}
          <p className="pt-1 text-[11px] font-bold leading-snug text-text-muted">
            Legendaries are never bulk-scrapped — salvage them one at a time from the item card.
            Locked and equipped items are always left alone.
          </p>
        </div>
      )}
    </PickerSheet>
  );
};
