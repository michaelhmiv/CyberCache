import React, { useMemo } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { CONSUMABLES, type ConsumableDef } from '@/constants/consumables';
import { getVisualAsset } from '@/constants/visualAssets';
import { essenceDisplayName } from '@/lib/market/identityKey';
import { usePlayerStore } from '@/store';

/**
 * Item stacks (redesign Wave D, DESIGN.md §3 — Gear → Items:
 * "consumables/materials stacks, quality % printed").
 *
 * Everything here reads the player's real holdings: consumable
 * stacks are the server batch records (every acquisition — vendor,
 * crafted, reward, market — lands as a batch with its own quality
 * percent, so quality is printed per batch, never averaged or
 * invented), materials and essences are the profile counts. A
 * consumable row taps through to the same inspect sheet the belt
 * uses.
 */

const STACK_ICONS: Record<string, PxIconName> = {
  ScrapAlloy: 'scrap',
  BallisticParts: 'gun',
  ReactiveComponents: 'bolt',
  TechFragments: 'chip',
  VoidDust: 'star',
  IgnitionFluid: 'flame',
  ConduitWire: 'nodes',
  AcidCompound: 'flask',
  CryoGel: 'snow',
  VoidEssence: 'swirl',
};

interface ItemStacksProps {
  onInspectConsumable?: (def: ConsumableDef) => void;
}

export const ItemStacks: React.FC<ItemStacksProps> = ({ onInspectConsumable }) => {
  const batches = usePlayerStore((s) => s.consumableBatches);
  const materials = usePlayerStore((s) => s.materials);
  const essences = usePlayerStore((s) => s.essences);

  const consumableStacks = useMemo(() => {
    const byType = new Map<string, { total: number; batches: Array<{ quality: number; quantity: number }> }>();
    for (const batch of batches) {
      if (batch.quantity <= 0) continue;
      const entry = byType.get(batch.consumable_type) ?? { total: 0, batches: [] };
      entry.total += batch.quantity;
      entry.batches.push({ quality: batch.quality_percent, quantity: batch.quantity });
      byType.set(batch.consumable_type, entry);
    }
    return [...byType.entries()]
      .map(([type, entry]) => ({
        type,
        def: CONSUMABLES[type] ?? null,
        total: entry.total,
        batches: entry.batches.sort((a, b) => b.quality - a.quality),
      }))
      .sort((a, b) => (a.def?.name ?? a.type).localeCompare(b.def?.name ?? b.type));
  }, [batches]);

  const materialRows = useMemo(
    () => Object.entries(materials).filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b)),
    [materials],
  );
  const essenceRows = useMemo(
    () => Object.entries(essences).filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b)),
    [essences],
  );

  const allEmpty = consumableStacks.length === 0 && materialRows.length === 0 && essenceRows.length === 0;

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-text-muted">Stacks</div>

      {allEmpty && <div className="text-sm text-text-muted">Nothing stacked yet.</div>}

      {consumableStacks.length > 0 && (
        <div className="space-y-1.5">
          {consumableStacks.map(({ type, def, total, batches: typeBatches }) => (
            <button
              key={type}
              type="button"
              disabled={!def}
              onClick={() => def && onInspectConsumable?.(def)}
              className="flex w-full items-center gap-3 border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-amber/40"
            >
              <PxIcon name={def?.visual.icon ?? 'vial'} size={26} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black text-text-primary">{def?.name ?? type}</div>
                <div className="text-[11px] leading-snug text-text-muted">
                  {typeBatches.map((b) => `×${b.quantity} at ${Math.round(b.quality)}% quality`).join(' · ')}
                </div>
              </div>
              <div className="shrink-0 text-sm font-black text-amber">×{total}</div>
            </button>
          ))}
        </div>
      )}

      {materialRows.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-text-muted">Materials</div>
          {materialRows.map(([id, count]) => (
            <div key={id} className="flex items-center gap-3 border border-border bg-surface px-3 py-2">
              <PxIcon name={STACK_ICONS[id] ?? 'pack'} size={26} className="shrink-0" />
              <div className="min-w-0 flex-1 text-sm font-black text-text-primary">{getVisualAsset('material', id).label}</div>
              <div className="shrink-0 text-sm font-black text-amber">×{count}</div>
            </div>
          ))}
        </div>
      )}

      {essenceRows.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-text-muted">Essences</div>
          {essenceRows.map(([id, count]) => (
            <div key={id} className="flex items-center gap-3 border border-border bg-surface px-3 py-2">
              <PxIcon name={STACK_ICONS[id] ?? 'gem'} size={26} className="shrink-0" />
              <div className="min-w-0 flex-1 text-sm font-black text-text-primary">{essenceDisplayName(id)}</div>
              <div className="shrink-0 text-sm font-black text-amber">×{count}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
