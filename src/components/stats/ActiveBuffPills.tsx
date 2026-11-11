import React, { memo, useState, useEffect, useMemo, useRef } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { CONSUMABLES, type ConsumableVisual } from '@/constants/consumables';
import type { ConsumableType } from '@/types/game';
import { buildEffectSummary } from '@/lib/buffs/effectSummary';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';

const SLOT_ORDER: Array<keyof LoadoutConsumables> = ['PreFight', 'MidFight', 'Emergency'];

const accentClass: Record<ConsumableVisual['accent'], string> = {
  green: '#7CFC00',
  red: '#FF4B5C',
  orange: '#FF9000',
  cyan: '#00E5FF',
  amber: '#FFB300',
  purple: '#B66BFF',
  blue: '#5AA7FF',
};

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' } as const;


const BuffPill = memo(function BuffPill({
  buff,
  now,
  inventoryCount,
}: {
  buff: ActiveBuff;
  now: number;
  inventoryCount: number;
}) {
  const def = CONSUMABLES[buff.consumableId];
  const accent = def ? accentClass[def.visual.accent] : '#888';
  const icon = def?.visual.icon;
  const name = def?.name ?? buff.consumableId;
  const tacticalRole = def?.tacticalRole ?? '';
  const isMedKit = buff.consumableId === 'MedKit' || buff.consumableId === 'MedKitRefined';
  const isBufferConsumable = isMedKit && typeof buff.value === 'number';
  const isArmed = buff.displayState === 'armed';
  const remainingMs = Math.max(0, buff.expiresAt - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const progress = buff.durationMs > 0 ? Math.min(1, Math.max(0, remainingMs / buff.durationMs)) : 0;
  const remainingLabel = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;

  // Build right-side meta: timer/ARMED · Q85 · ×3
  const timerLabel = isBufferConsumable
    ? `${buff.value} HP`
    : isArmed ? 'ARMED' : remainingLabel;
  const qualityTag = typeof buff.qualityPercent === 'number' && buff.qualityPercent > 0
    ? `Q${Math.round(buff.qualityPercent)}`
    : null;
  const stockTag = inventoryCount > 0 ? `×${inventoryCount}` : null;
  const rightMeta = [timerLabel, qualityTag, stockTag].filter(Boolean).join(' · ');

  // Active HQ perk label (only render when this buff's quality actually proc'd the perk)
  const activePerk = def?.runtime.highQualityPerks?.find((perk) =>
    typeof buff.qualityPercent === 'number' && buff.qualityPercent >= perk.minQuality)?.label;

  // Derived numeric effect string (replaces the static ledgerText)
  const effectLine = buildEffectSummary(def, buff, isBufferConsumable);

  return (
    <div
      data-testid="active-buff-pill"
      data-consumable-id={buff.consumableId}
      className="flex items-center gap-2 border-b border-border/40 px-2 py-1.5"
    >
      <span
        className="shrink-0 text-[14px] font-black leading-none"
        style={{ color: accent }}
      >
        {icon ? <PxIcon name={icon} size={13} /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-1">
          <div className="min-w-0">
            {tacticalRole && (
              <div className="truncate text-[7px] uppercase tracking-wide text-text-muted">
                {tacticalRole}
              </div>
            )}
            <span className="truncate text-[10px] font-black uppercase tracking-wide text-text-primary">
              {name}
            </span>
          </div>
          <span
            data-testid="buff-countdown"
            className="shrink-0 text-[9px] font-black text-amber tabular-nums"
            style={{ fontVariantNumeric: 'tabular-nums', color: isArmed ? '#888' : undefined }}
          >
            {rightMeta}
          </span>
        </div>
        <div
          data-testid="buff-progress"
          className="mt-0.5 h-[3px] w-full overflow-hidden rounded-full bg-surface"
        >
          <div
            className="h-full rounded-full transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress * 100}%`, backgroundColor: accent }}
          />
        </div>
        {effectLine && (
          <div className="mt-0.5 truncate text-[7px] leading-tight text-text-muted">
            {effectLine}
          </div>
        )}
        {activePerk && (
          <div
            className="mt-0.5 truncate text-[7px] leading-tight"
            style={{ color: accent }}
          >
            <span className="inline-flex items-center gap-1"><PxIcon name="star5" size={13} color={accent} /> {activePerk}</span>
          </div>
        )}
      </div>
    </div>
  );
});

export const ActiveBuffPills = memo(function ActiveBuffPills({
  consumables,
  inventory,
  onSlotClick,
  size: _size,
  trailingCell,
}: {
  consumables: LoadoutConsumables;
  inventory: Record<string, number>;
  onSlotClick: (slot: keyof LoadoutConsumables) => void;
  size?: number;
  /**
   * A fourth cell in the slots row, in the slots' grammar (Home
   * consolidation: the vehicle chip rides the belt row). Renders
   * nothing when the cell itself renders nothing.
   */
  trailingCell?: React.ReactNode;
}) {
  const storeBuffs = useActiveBuffsStore((state) => state.buffs);
  const [now, setNow] = useState(Date.now);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const activeBuffs = useMemo(
    () => storeBuffs.filter((buff) => buff.expiresAt > now && (buff.displayState === 'active' || buff.displayState === 'recent' || buff.displayState === 'armed')),
    [storeBuffs, now],
  );

  const activeConsumableIds = useMemo(
    () => new Set(activeBuffs.map((buff) => buff.consumableId)),
    [activeBuffs],
  );

  return (
    <div
      data-testid="active-buff-pills"
      className="flex shrink-0 flex-col border-2 border-border bg-surface/90 shadow-[4px_4px_0_rgba(0,0,0,0.72)]"
      style={panelClip}
    >
      {/* 3 slots — horizontal row, tap one to manage */}
      <div data-testid="slots-section" className="flex flex-row divide-x divide-border/40">
        {SLOT_ORDER.map((slot) => {
          const id = consumables[slot];
          const def = id ? CONSUMABLES[id] : null;
          const accent = def ? accentClass[def.visual.accent] : '#888';
          const stockCount = id ? (inventory[id] ?? 0) : 0;
          const isActive = id ? activeConsumableIds.has(id as ConsumableType) : false;
          const slotNumber = SLOT_ORDER.indexOf(slot) + 1;

          return (
            <button
              key={slot}
              type="button"
              data-testid="slot-row"
              data-slot={slot}
              onClick={() => onSlotClick(slot)}
              aria-label={`Slot ${slotNumber}: ${def ? def.name : 'empty'}. Tap to manage.`}
              className={`flex flex-1 flex-col items-center gap-1 px-1 py-2 transition-transform active:scale-[0.97] ${!def ? 'opacity-50' : ''}`}
            >
              {/* Glyph or slot number */}
              <div className="flex h-7 w-7 items-center justify-center border-2 border-border bg-bg/80">
                {def ? (
                  <PxIcon name={def.visual.icon} size={13} style={{ color: accent }} />
                ) : (
                  <span className="text-[11px] font-black text-text-muted">{slotNumber}</span>
                )}
              </div>
              {/* Name or "Slot N" */}
              <div className="w-full truncate text-center text-[9px] font-black uppercase tracking-wide text-text-primary">
                {def ? def.name : `Slot ${slotNumber}`}
              </div>
              {/* Stock or empty */}
              {def ? (
                <div className="flex items-center gap-1">
                  <span className="text-[7px] font-black uppercase text-amber">×{stockCount}</span>
                  {isActive && (
                    <span className="text-[7px] font-black uppercase text-green animate-pulse">LIVE</span>
                  )}
                </div>
              ) : (
                <div className="text-[7px] font-black uppercase text-text-muted">Empty</div>
              )}
            </button>
          );
        })}
        {trailingCell}
      </div>
      {/* Active buff pills with timers (only when roaming/fight is live) */}
      {activeBuffs.length > 0 && (
        <div data-testid="active-buffs-list" className="border-t border-border/30">
          {activeBuffs.map((buff) => {
            const invCount = inventory[buff.consumableId] ?? 0;
            return <BuffPill key={buff.id} buff={buff} now={now} inventoryCount={invCount} />;
          })}
        </div>
      )}
    </div>
  );
});

export default ActiveBuffPills;
