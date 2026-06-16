/**
 * ActionLoadout — star-pattern loadout display for the Action tab.
 *
 * Collapsible. Click any slot chip to open a filtered gear picker.
 * DPS readout and consumable chips visible in both expanded and collapsed states.
 *
 * Layout (3-column grid, expanded):
 *   Row 1:   (empty)    Secondary      Heavy
 *   Row 2:   Shield     ★PRIMARY★    Class Mod
 *   Row 3:   (empty)    Relic         Ordnance
 */
import React, { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Crosshair, Shield, Zap, Diamond, Gem } from 'lucide-react';
import { useLoadoutStore, usePlayerStore, useInventoryStore } from '@/store';
import { ConsumablesChips } from '@/components/action/ConsumablesChips';
import { SlotGearPicker } from '@/components/action/SlotGearPicker';
import { PresetSwitcher } from '@/components/action/PresetSwitcher';
import { loadoutEffectiveDps } from '@/lib/combat/loadoutSurvival';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import type { Weapon, Shield as ShieldItem, ClassMod, Relic, Ordnance } from '@/types/items';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const COLLAPSE_STORAGE_KEY = 'cybercache_action_loadout_collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
  } catch { return false; }
}

function saveCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSE_STORAGE_KEY, v ? '1' : '0'); } catch { /* noop */ }
}

const SLOT_CONFIG: Array<{
  slot: LoadoutSlot;
  label: string;
  icon: React.ElementType;
  row: number;
  col: number;
  isCenter?: boolean;
}> = [
  { slot: 'secondary',  label: 'Secondary', icon: Crosshair, row: 1, col: 2 },
  { slot: 'heavy',      label: 'Heavy',     icon: Crosshair, row: 1, col: 3 },
  { slot: 'shield',     label: 'Shield',    icon: Shield,    row: 2, col: 1 },
  { slot: 'primary',    label: 'Primary',   icon: Crosshair, row: 2, col: 2, isCenter: true },
  { slot: 'classMod',   label: 'Mod',       icon: Diamond,   row: 2, col: 3 },
  { slot: 'relic',      label: 'Relic',     icon: Gem,       row: 3, col: 2 },
  { slot: 'ordnance',   label: 'Ordnance',  icon: Zap,       row: 3, col: 3 },
];

const SATURATED: Record<string, string> = {
  Common:    '#A5A7B5',
  Uncommon:  '#7CFC00',
  Rare:      '#5AA7FF',
  Epic:      '#FF9DF5',
  Legendary: '#FFEA3A',
};

function slotItem(
  loadout: ReturnType<typeof useLoadoutStore.getState>,
  slot: string,
): Weapon | ShieldItem | ClassMod | Relic | Ordnance | null {
  switch (slot) {
    case 'primary':   return loadout.getWeapon('primary') ?? null;
    case 'secondary': return loadout.getWeapon('secondary') ?? null;
    case 'heavy':     return loadout.getWeapon('heavy') ?? null;
    case 'shield':    return loadout.getShield() ?? null;
    case 'classMod':  return loadout.getClassMod() ?? null;
    case 'relic':     return loadout.getRelic() ?? null;
    case 'ordnance':  return loadout.getOrdnance() ?? null;
    default:          return null;
  }
}

// ── SVG star connectors (unchanged) ───────────────────────────────

const STAR_LINES: Array<[number, number, number, number]> = [
  [2,2,1,2], [2,2,2,3], [2,2,3,3], [2,2,3,2], [2,2,2,1], [2,2,1,3],
  [1,2,2,1], [1,2,1,3], [2,1,3,2], [2,3,3,3], [1,3,2,3], [3,2,3,3],
];

function gridPct(row: number, col: number): [number, number] {
  const xPct = ((col - 1) / 2) * 100;
  const yPct = ((row - 1) / 2) * 100;
  return [xPct, yPct];
}

const StarConnectors: React.FC = () => (
  <svg className="pointer-events-none absolute inset-0 z-0" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden>
    {STAR_LINES.map(([r1, c1, r2, c2], i) => {
      const [x1, y1] = gridPct(r1, c1);
      const [x2, y2] = gridPct(r2, c2);
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FF9000" strokeOpacity="0.18" strokeWidth="0.5" strokeDasharray="2 4" />;
    })}
  </svg>
);

// ── Slot chip (now a button) ──────────────────────────────────────

const SlotChip: React.FC<{
  label: string;
  icon: React.ElementType;
  item: Weapon | ShieldItem | ClassMod | Relic | Ordnance | null;
  isCenter?: boolean;
  onClick: () => void;
}> = ({ label, icon: Icon, item, isCenter, onClick }) => {
  const filled = !!item;
  const accent = item?.rarity ? SATURATED[item.rarity] ?? '#7B756D' : '#7B756D';
  const name = item?.name ?? (isCenter ? 'No weapon' : 'Open');

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative z-10 flex w-full flex-col items-center justify-center gap-0.5 border-2 p-1.5 text-center transition-all active:scale-[0.97] ${
        isCenter
          ? 'border-amber/60 bg-amber/10 shadow-[0_0_18px_rgba(255,144,0,0.18)]'
          : filled
            ? 'border-border bg-bg/70 hover:border-amber/40'
            : 'border-border bg-bg/40 opacity-55 hover:opacity-80'
      }`}
      style={{
        ...signClip,
        ...(filled && !isCenter ? { borderColor: `${accent}55`, boxShadow: `inset 0 0 0 1px ${accent}20` } : {}),
      }}
    >
      <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-text-muted">
        <Icon size={isCenter ? 13 : 10} style={{ color: filled ? accent : undefined }} />
        <span>{label}</span>
      </div>
      <div
        className={`text-[10px] font-black leading-tight truncate max-w-full ${isCenter ? 'text-sm' : ''}`}
        style={{ color: filled ? accent : '#7B756D' }}
      >
        {name}
      </div>
      {filled && (
        <div className="text-[7px] font-black uppercase tracking-wider" style={{ color: accent }}>
          {item.rarity}
        </div>
      )}
    </button>
  );
};

// ── Main component ─────────────────────────────────────────────────

export const ActionLoadout: React.FC<{ className?: string }> = ({ className }) => {
  const loadout = useLoadoutStore();
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  // Subscribe to consumable changes so the chips re-render
  usePlayerStore((s) => s.consumables);
  useLoadoutStore((s) => s.consumables);

  const dps = loadoutEffectiveDps();
  const equippedCount = Object.values(loadout.slots).filter(Boolean).length;
  const emptyLoadout = equippedCount === 0;

  // Auto-expand when loadout is empty — the player needs to see what to fill.
  const [collapsed, setCollapsed] = useState(() => {
    if (emptyLoadout) return false; // always expand for empty loadout
    return readCollapsed();
  });

  // Resource summary: always visible
  const resourceStats = useMemo(() => [
    { label: 'Credits', value: player.credits.toLocaleString(), tone: 'text-cyan' as const },
    { label: 'Scrap', value: player.scrap.toLocaleString(), tone: 'text-green' as const },
    { label: 'Items', value: inventory.items.length, tone: 'text-amber' as const },
    { label: 'Keys', value: `${player.cacheKeys}+${player.cacheKeyFragments}`, tone: 'text-purple' as const },
  ], [player.credits, player.scrap, player.cacheKeys, player.cacheKeyFragments, inventory.items.length]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerSlot, setPickerSlot] = useState<LoadoutSlot | null>(null);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      saveCollapsed(next);
      return next;
    });
  }, []);

  const onEquip = useCallback(async (itemId: string) => {
    if (!pickerSlot) return;
    setBusy(true);
    setError(null);
    try {
      await verifiedOps.equipItem(itemId, pickerSlot);
      setPickerSlot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update loadout.');
    } finally {
      setBusy(false);
    }
  }, [pickerSlot, setPickerSlot]);

  const onUnequip = useCallback(async () => {
    if (!pickerSlot) return;
    setBusy(true);
    setError(null);
    try {
      await verifiedOps.unequipSlot(pickerSlot);
      setPickerSlot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to clear slot.');
    } finally {
      setBusy(false);
    }
  }, [pickerSlot, setPickerSlot]);

  const currentItemId = pickerSlot ? loadout.slots[pickerSlot] : null;

  return (
    <section
      data-testid="action-loadout"
      className={`relative overflow-hidden border-2 border-border bg-surface/95 p-3 ${className ?? ''}`}
      style={{ clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' }}
    >
      {/* Header with collapse toggle */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-2 text-left hover:text-amber transition-colors"
        >
          <Crosshair size={15} className="text-amber shrink-0" />
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">Loadout</div>
            <div className="text-sm font-black text-text-primary">{equippedCount}/7 Gear</div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">DPS</div>
            <div className={`text-lg font-black ${dps > 0 ? 'text-amber' : 'text-text-muted'}`}>
              {dps > 0 ? dps.toFixed(0) : '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="bl-secondary p-1.5 text-text-muted hover:text-amber"
            aria-label={collapsed ? 'Expand loadout' : 'Collapse loadout'}
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {/* Resource summary — always visible, compact row */}
      <div className="mt-2 flex gap-1.5">
        {resourceStats.map(({ label, value, tone }) => (
          <div key={label} className="flex-1 border border-border/60 bg-bg/40 px-1.5 py-1 text-center" style={signClip}>
            <div className="text-[7px] font-black uppercase tracking-wider text-text-muted">{label}</div>
            <div className={`text-[10px] font-black truncate ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Consumables — always visible, not hidden in collapsed/expanded blocks */}
      <div className="mt-2">
        <ConsumablesChips className="text-[9px]" />
      </div>

      {/* Collapsed summary strip */}
      {collapsed && (
        <div className="mt-2">
          <PresetSwitcher />
        </div>
      )}

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2">
              <PresetSwitcher />
            </div>
            <div className="mt-3 relative" style={{ paddingTop: '75%' }}>
              <StarConnectors />
              <div
                className="absolute inset-0 grid gap-1.5 z-10"
                style={{ gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr' }}
              >
                {SLOT_CONFIG.map(({ slot, label, icon, row, col, isCenter }) => {
                  const item = slotItem(loadout, slot);
                  return (
                    <div key={slot} style={{ gridRow: row, gridColumn: col }}>
                      <SlotChip
                        label={label}
                        icon={icon}
                        item={item}
                        isCenter={isCenter}
                        onClick={() => setPickerSlot(slot)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slot gear picker sheet */}
      <AnimatePresence>
        {pickerSlot && (
          <SlotGearPicker
            slot={pickerSlot}
            currentItemId={currentItemId}
            onClose={() => setPickerSlot(null)}
            onEquip={onEquip}
            onUnequip={onUnequip}
            busy={busy}
            error={error}
          />
        )}
      </AnimatePresence>

      {/* Error banner */}
      {error && (
        <div className="mt-2 rounded-xl border border-red/30 bg-red/10 p-2 text-xs text-red-light">{error}</div>
      )}
    </section>
  );
};
