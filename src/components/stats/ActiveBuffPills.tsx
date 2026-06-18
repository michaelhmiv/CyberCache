import React, { memo, useState, useEffect, useMemo, useRef } from 'react';
import { CONSUMABLES, type ConsumableVisual } from '@/constants/consumables';
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

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const SLOT_LABEL: Record<keyof LoadoutConsumables, string> = {
  PreFight: 'Pre',
  MidFight: 'Mid',
  Emergency: 'Emg',
};

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
  const glyph = def?.visual.glyph;
  const name = def?.name ?? buff.consumableId;
  const effectSummary = def?.runtime.ledgerText ?? '';
  const isMedKit = buff.consumableId === 'MedKit' || buff.consumableId === 'MedKitRefined';
  const isBufferConsumable = isMedKit && buff.value;
  const isArmed = buff.displayState === 'armed';
  const remainingMs = Math.max(0, buff.expiresAt - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const progress = buff.durationMs > 0 ? Math.min(1, Math.max(0, remainingMs / buff.durationMs)) : 0;
  const remainingLabel = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  // Med Kit: show buffer HP + inventory count instead of timer
  const displayLabel = isBufferConsumable
    ? `${buff.value} HP${inventoryCount > 0 ? ` · ${inventoryCount}×` : ''}`
    : isArmed ? 'ARMED' : remainingLabel;

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
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-1">
          <span className="truncate text-[10px] font-black uppercase tracking-wide text-text-primary">
            {name}
          </span>
          <span
            data-testid="buff-countdown"
            className="shrink-0 text-[9px] font-black text-amber tabular-nums"
            style={{ fontVariantNumeric: 'tabular-nums', color: isArmed ? '#888' : undefined }}
          >
            {displayLabel}
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
        {effectSummary && (
          <div className="mt-0.5 truncate text-[7px] leading-tight text-text-muted">
            {effectSummary}
          </div>
        )}
      </div>
    </div>
  );
});

export const ActiveBuffPills = memo(function ActiveBuffPills({
  consumables,
  inventory,
  onClick,
  size: _size,
}: {
  consumables: LoadoutConsumables;
  inventory: Record<string, number>;
  onClick: () => void;
  size?: number;
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

  const armedSlots = useMemo(() => {
    return SLOT_ORDER
      .map((slot) => {
        const id = consumables[slot];
        if (!id) return null;
        const def = CONSUMABLES[id];
        if (!def) return null;
        return { slot, id, def };
      })
      .filter((entry): entry is { slot: keyof LoadoutConsumables; id: string; def: typeof CONSUMABLES[string] } => {
        return !!entry && !activeConsumableIds.has(entry.id);
      });
  }, [consumables, activeConsumableIds]);

  const loadedCount = SLOT_ORDER.reduce(
    (count, slot) => count + (consumables[slot] && CONSUMABLES[consumables[slot]!] ? 1 : 0),
    0,
  );

  if (loadedCount === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid="active-buff-pills"
        data-pills-empty
        aria-label="No consumables loaded. Tap to manage."
        className="flex shrink-0 items-center justify-center border-2 border-border bg-surface/90 px-3 py-2 text-[9px] font-black uppercase tracking-wide text-text-muted"
        style={signClip}
      >
        No consumables loaded
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="active-buff-pills"
      aria-label={`${activeBuffs.length} active buff${activeBuffs.length === 1 ? '' : 's'}, ${armedSlots.length} armed. Tap to open ledger.`}
      className="flex shrink-0 flex-col border-2 border-border bg-surface/90 shadow-[4px_4px_0_rgba(0,0,0,0.72)]"
      style={panelClip}
    >
      {activeBuffs.length > 0 && (
        <div data-testid="active-buffs-list">
          {activeBuffs.map((buff) => {
            const invCount = inventory[buff.consumableId] ?? 0;
            return <BuffPill key={buff.id} buff={buff} now={now} inventoryCount={invCount} />;
          })}
        </div>
      )}
      {armedSlots.length > 0 && (
        <div
          data-testid="armed-slots-row"
          className="flex items-center gap-1.5 border-t border-border/30 px-2 py-1"
        >
          {armedSlots.map(({ slot, def }, i) => (
            <React.Fragment key={slot}>
              {i > 0 && <span className="text-[7px] text-text-muted">·</span>}
              <span
                className="text-[8px] font-bold uppercase tracking-wide"
                style={{ color: accentClass[def.visual.accent], opacity: 0.6 }}
              >
                {SLOT_LABEL[slot]}
              </span>
              <span className="truncate text-[8px] font-medium text-text-muted">
                {def.name}
              </span>
            </React.Fragment>
          ))}
          <span className="ml-auto shrink-0 text-[7px] font-black uppercase tracking-wider text-text-muted">
            LOADED
          </span>
        </div>
      )}
    </button>
  );
});

export default ActiveBuffPills;
