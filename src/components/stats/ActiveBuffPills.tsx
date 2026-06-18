import React, { memo, useState, useEffect, useMemo, useRef } from 'react';
import { CONSUMABLES, type ConsumableVisual, type ConsumableRuntimeEffects } from '@/constants/consumables';
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
const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' } as const;

const SLOT_LABEL: Record<keyof LoadoutConsumables, string> = {
  PreFight: 'Pre',
  MidFight: 'Mid',
  Emergency: 'Emg',
};

const signedPct = (delta: number): string => `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}%`;

/**
 * Derive a one-line, glance-ready effect summary string from a consumable's
 * `runtime.baseEffects`. Replaces the static `ledgerText` log line on the
 * dashboard HUD with real numbers (heal HP, +X% DPS, +X% loot, etc.).
 *
 * Returns null only when no effect could be derived AND there's no ledger
 * fallback — in which case callers should render nothing.
 */
function buildEffectSummary(
  def: typeof CONSUMABLES[string] | undefined,
  buff: ActiveBuff,
  isBufferConsumable: boolean,
): string | null {
  if (!def) return null;
  const e: ConsumableRuntimeEffects = def.runtime.baseEffects ?? {};
  const parts: string[] = [];

  // ─ Survival / heal / repair ─
  if (isBufferConsumable && typeof buff.value === 'number' && buff.value > 0) {
    parts.push(`+${Math.round(buff.value)} HP buffer`);
  } else if (typeof e.healHp === 'number' && e.healHp > 0) {
    parts.push(`Heal ${Math.round(e.healHp)} HP`);
  }
  if (typeof e.shieldRestore === 'number' && e.shieldRestore > 0) {
    parts.push(`+${Math.round(e.shieldRestore)} Shield`);
  }
  if (typeof e.repairTotalHp === 'number' && e.repairTotalHp > 0) {
    const dur = typeof e.repairDurationSeconds === 'number' && e.repairDurationSeconds > 0
      ? ` / ${Math.round(e.repairDurationSeconds)}s`
      : '';
    parts.push(`Repair ${Math.round(e.repairTotalHp)} HP${dur}`);
  }

  // ─ Multiplier effects (delta from 1.0) ─
  if (typeof e.dpsMultiplier === 'number' && e.dpsMultiplier !== 1) {
    parts.push(`${signedPct(e.dpsMultiplier - 1)} DPS`);
  }
  if (typeof e.survivalMultiplier === 'number' && e.survivalMultiplier !== 1) {
    parts.push(`${signedPct(e.survivalMultiplier - 1)} Surv`);
  }
  if (typeof e.armorBreakMultiplier === 'number' && e.armorBreakMultiplier !== 1) {
    parts.push(`${signedPct(e.armorBreakMultiplier - 1)} Armor Brk`);
  }
  if (typeof e.shieldBreakMultiplier === 'number' && e.shieldBreakMultiplier !== 1) {
    parts.push(`${signedPct(e.shieldBreakMultiplier - 1)} Shield Brk`);
  }
  if (typeof e.mechanicMultiplier === 'number' && e.mechanicMultiplier !== 1) {
    parts.push(`${signedPct(e.mechanicMultiplier - 1)} Mech`);
  }
  if (typeof e.bossSlowMultiplier === 'number' && e.bossSlowMultiplier !== 1) {
    parts.push(`${signedPct(-(e.bossSlowMultiplier - 1))} Boss Spd`);
  }
  if (typeof e.incomingDpsMultiplier === 'number' && e.incomingDpsMultiplier !== 1) {
    parts.push(`${signedPct(-(e.incomingDpsMultiplier - 1))} Inc DPS`);
  }
  if (typeof e.incomingAccuracyMultiplier === 'number' && e.incomingAccuracyMultiplier !== 1) {
    parts.push(`${signedPct(-(e.incomingAccuracyMultiplier - 1))} Inc Acc`);
  }
  if (typeof e.reloadPenaltyReduction === 'number' && e.reloadPenaltyReduction > 0) {
    parts.push(`${signedPct(e.reloadPenaltyReduction)} Reload`);
  }
  if (typeof e.critChanceBonus === 'number' && e.critChanceBonus > 0) {
    parts.push(`${signedPct(e.critChanceBonus)} Crit`);
  }
  if (typeof e.armorBypass === 'number' && e.armorBypass > 0) {
    parts.push(`${signedPct(e.armorBypass)} Armor Bypass`);
  }
  if (typeof e.ordnanceBoostMultiplier === 'number' && e.ordnanceBoostMultiplier !== 1) {
    parts.push(`${signedPct(e.ordnanceBoostMultiplier - 1)} Ordnance`);
  }

  // ─ Fraction-of-1 effects (signed +X% / -X%) ─
  if (typeof e.bonusLootChance === 'number' && e.bonusLootChance > 0) {
    parts.push(`${signedPct(e.bonusLootChance)} Loot`);
  }
  if (typeof e.extraLootRollChance === 'number' && e.extraLootRollChance > 0) {
    parts.push(`${signedPct(e.extraLootRollChance)} Double Roll`);
  }
  if (typeof e.rareMaterialChance === 'number' && e.rareMaterialChance > 0) {
    parts.push(`${signedPct(e.rareMaterialChance)} Rare Mat`);
  }
  if (typeof e.rarityBias === 'number' && e.rarityBias > 0) {
    parts.push(`${signedPct(e.rarityBias)} Rarity`);
  }
  if (typeof e.eventChanceBonus === 'number' && e.eventChanceBonus > 0) {
    parts.push(`${signedPct(e.eventChanceBonus)} Event`);
  }
  if (typeof e.deathFeeReduction === 'number' && e.deathFeeReduction > 0) {
    parts.push(`${signedPct(-e.deathFeeReduction)} Death Fee`);
  }
  if (typeof e.dotDamageReduction === 'number' && e.dotDamageReduction > 0) {
    parts.push(`${signedPct(-e.dotDamageReduction)} DoT`);
  }
  if (typeof e.fatigueDamagePct === 'number' && e.fatigueDamagePct > 0) {
    parts.push(`${signedPct(e.fatigueDamagePct)} Fatigue`);
  }
  if (typeof e.shieldRegenInterruptChance === 'number' && e.shieldRegenInterruptChance > 0) {
    parts.push(`${signedPct(e.shieldRegenInterruptChance)} Shield Brk%`);
  }
  if (typeof e.staggerChance === 'number' && e.staggerChance > 0) {
    parts.push(`${signedPct(e.staggerChance)} Stagger`);
  }
  if (typeof e.dodgeChanceBonus === 'number' && e.dodgeChanceBonus > 0) {
    parts.push(`${signedPct(e.dodgeChanceBonus)} Dodge`);
  }

  if (parts.length > 0) return parts.join(' · ');
  // Defensive fallback — the static log line — only if no numeric effects were derived.
  return def.runtime.ledgerText || null;
}

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
        {glyph}
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
            ★ {activePerk}
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
              <span
                className="shrink-0 text-[7px] font-black"
                style={{ color: accentClass[def.visual.accent], opacity: 0.7 }}
              >
                {def.tacticalRole}
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
