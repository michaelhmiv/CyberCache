import React, { useMemo, useState } from 'react';
import { AlertTriangle, Crosshair, PackagePlus, Radio, Shield, Star } from 'lucide-react';
import { CONSUMABLES } from '@/constants/consumables';
import type { ConsumableDef, ConsumableFamily } from '@/constants/consumables';
import { usePlayerStore } from '@/store';
import { ConsumableInspectSheet } from '@/components/consumables/ConsumableInspectSheet';

const FAMILY_ICONS: Record<ConsumableFamily, React.ElementType> = {
  survival: Shield,
  ammo: Crosshair,
  ordnance: PackagePlus,
  tactical: Radio,
  economy: Star,
  corrupted: AlertTriangle,
};

const FAMILY_COLORS: Record<ConsumableFamily, string> = {
  survival: 'text-green border-green/30 bg-green/10',
  ammo: 'text-red border-red/30 bg-red/10',
  ordnance: 'text-orange border-orange/30 bg-orange/10',
  tactical: 'text-cyan border-cyan/30 bg-cyan/10',
  economy: 'text-amber border-amber/30 bg-amber/10',
  corrupted: 'text-purple border-purple/30 bg-purple/10',
};

const FAMILY_LABELS: Record<ConsumableFamily, string> = {
  survival: 'Survival',
  ammo: 'Ammunition',
  ordnance: 'Ordnance',
  tactical: 'Tactical',
  economy: 'Economy',
  corrupted: 'Corrupted',
};

const FAMILY_ORDER: ConsumableFamily[] = ['survival', 'ammo', 'ordnance', 'tactical', 'economy', 'corrupted'];

export const ConsumablesScreen: React.FC = () => {
  const player = usePlayerStore();
  const [inspecting, setInspecting] = useState<ConsumableDef | null>(null);
  const [expandedFamily, setExpandedFamily] = useState<ConsumableFamily | null>(null);

  // Group owned consumables by family
  const grouped = useMemo(() => {
    const result: Record<ConsumableFamily, { def: ConsumableDef; count: number }[]> = {
      survival: [],
      ammo: [],
      ordnance: [],
      tactical: [],
      economy: [],
      corrupted: [],
    };

    Object.values(CONSUMABLES).forEach((def) => {
      const count = player.getConsumableCount(def.id);
      if (count > 0) {
        result[def.family].push({ def, count });
      }
    });

    return result;
  }, [player]);

  const totalOwned = useMemo(
    () => Object.values(grouped).reduce((sum, items) => sum + items.reduce((s, i) => s + i.count, 0), 0),
    [grouped],
  );

  const handleEquip = (id: string) => {
    // Navigate to loadout tab with consumable pre-selected
    // For now, just close the inspect
    setInspecting(null);
  };

  return (
    <div className="space-y-3 p-3 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-black text-text-primary">Consumables</div>
          <div className="text-[10px] text-text-muted">Tap any item to inspect effects, triggers, and loadout slots.</div>
        </div>
        <div className="rounded-full border border-border bg-surface px-2 py-1 text-[10px] font-black text-amber">
          {totalOwned} total
        </div>
      </div>

      {totalOwned === 0 && (
        <div className="py-10 text-center">
          <div className="text-sm text-text-muted">No consumables in inventory.</div>
          <div className="mt-1 text-[10px] text-text-muted">Visit the Market → Vendor to buy consumables.</div>
        </div>
      )}

      {FAMILY_ORDER.map((family) => {
        const items = grouped[family];
        if (items.length === 0) return null;
        const Icon = FAMILY_ICONS[family];
        const colorClass = FAMILY_COLORS[family];
        const expanded = expandedFamily === family;

        return (
          <div key={family} className="overflow-hidden rounded-xl border border-border bg-surface">
            <button
              type="button"
              onClick={() => setExpandedFamily(expanded ? null : family)}
              className="flex w-full items-center gap-3 p-3 text-left"
            >
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${colorClass.split(' ').slice(1).join(' ')}`}>
                <Icon size={18} className={colorClass.split(' ')[0]} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-black text-text-primary">{FAMILY_LABELS[family]}</div>
                <div className="text-[10px] text-text-muted">
                  {items.length} type{items.length !== 1 ? 's' : ''} · {items.reduce((s, i) => s + i.count, 0)} total
                </div>
              </div>
              <div className={`text-xs text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</div>
            </button>

            {expanded && (
              <div className="border-t border-border px-3 pb-3 space-y-1.5">
                {items.map(({ def, count }) => (
                  <button
                    key={def.id}
                    type="button"
                    onClick={() => setInspecting(def)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-bg/60 p-2.5 text-left active:scale-[0.98] transition-transform"
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${colorClass.split(' ').slice(1).join(' ')}`}>
                      <Icon size={15} className={colorClass.split(' ')[0]} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-black text-text-primary">{def.name}</div>
                      <div className="text-[9px] text-text-muted">{def.shortDescription}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {def.allowedSlots.map((slot) => (
                          <span key={slot} className="rounded-full border border-border bg-surface px-1.5 py-0.5 text-[8px] text-text-muted">{slot}</span>
                        ))}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-black text-text-primary">x{count}</div>
                      <div className="text-[9px] text-text-muted">owned</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <ConsumableInspectSheet
        consumable={inspecting}
        open={!!inspecting}
        onClose={() => setInspecting(null)}
        onEquip={handleEquip}
      />
    </div>
  );
};
