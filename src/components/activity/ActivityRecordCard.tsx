/**
 * ActivityRecordCard (AL-3) — one fact in the Activity Log stream.
 *
 * Card anatomy per the DESIGN.md feed law and the exploration:
 * identity + headline numbers only. The item plate is the same
 * plate the Home feed uses (clipped square, rarity border and
 * glow, kind glyph — the summary DTO carries no art asset, so the
 * plate is the glyph plate, exactly as the exploration's non-weapon
 * squares and the app's own bag slots render kinds). The receipt
 * and odds detail live behind the tap — the whole card is the
 * target and opens the record sheet.
 */
import { memo } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import type { ActivityRecord } from '@/lib/api/activityLogService';
import {
  bossWinChance, clockTime, dropChance, itemKindLabel, rarityHex, recordFace, recordKindIcon,
} from '@/lib/activity/activityLogView';

const RARITY_GLOW: Record<string, string> = {
  Common: 'none',
  Uncommon: '0 0 10px rgba(124,252,0,0.35)',
  Rare: '0 0 10px rgba(90,167,255,0.45)',
  Epic: '0 0 12px rgba(255,157,245,0.5)',
  Legendary: '0 0 14px rgba(255,234,58,0.55)',
};

export const ActivityRecordCard = memo(function ActivityRecordCard({
  record, onSelect,
}: {
  record: ActivityRecord;
  onSelect: (record: ActivityRecord) => void;
}) {
  const face = recordFace(record);
  const rarity = record.item?.rarity ?? null;
  const rarityColor = rarityHex(rarity);
  const drop = record.kind === 'drop' ? dropChance(record) : null;
  const win = record.kind === 'boss' ? bossWinChance(record) : null;
  const time = clockTime(record.at);

  return (
    <button
      type="button"
      data-testid="activity-record"
      data-kind={record.kind}
      onClick={() => onSelect(record)}
      className="bl-panel group flex w-full items-stretch gap-3 px-3 py-3 text-left transition-transform active:scale-[0.99]"
      aria-label={`${face.title}. ${face.detail ?? ''} ${time}`}
    >
      {/* Item/kind plate — the feed's plate, with the item's rarity border. */}
      <span
        className="relative flex h-[46px] w-[46px] shrink-0 items-center justify-center self-center border bg-black/60"
        style={{
          borderColor: rarity ? rarityColor : 'rgba(255,255,255,0.14)',
          boxShadow: rarity ? (RARITY_GLOW[rarity] ?? 'none') : 'none',
          color: rarity ? rarityColor : '#B8B0A8',
        }}
        aria-hidden
      >
        <PxIcon name={recordKindIcon(record)} size={24} />
        {record.away && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center border border-black bg-[#151821] text-[#3B82F6]">
            <PxIcon name="clock" size={10} />
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[13px] font-bold leading-tight"
          style={{ color: rarity ? rarityColor : '#F5F5F5' }}
        >
          {face.title}
        </span>
        {record.item && (
          <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {rarity ?? ''} {itemKindLabel(record.item.kind)}{record.item.level != null ? ` · Lv ${record.item.level}` : ''}
          </span>
        )}
        {face.detail && (
          <span className={`mt-0.5 block truncate text-[12px] ${record.kind === 'earnings' ? 'font-bold text-[#7CFC00]' : 'text-text-secondary'}`}>
            {face.detail}
          </span>
        )}
        <span className="mt-0.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          <span>{time}</span>
          {record.away && <span className="text-[#3B82F6]">While away</span>}
          {drop && (
            <span className="text-[#FFEA3A]">
              {drop.pct} · {drop.oneIn}
            </span>
          )}
          {win && (
            <span className="text-text-secondary">
              Won at {win.pct}
            </span>
          )}
        </span>
      </span>

      <span className="flex shrink-0 items-center text-text-muted transition-colors group-hover:text-text-primary" aria-hidden>
        <PxIcon name="chevR" size={14} />
      </span>
    </button>
  );
});
