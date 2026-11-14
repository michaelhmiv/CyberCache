import React from 'react';
import { VehicleSprite } from '@/components/gear/GaragePanel';
import type { VehicleDisplay } from '@/store/slices/vehicleSlice';
import { DropSource, Rarity } from '@/types/game';

/**
 * Dev-only harness for the vehicle thumbnail containment fix
 * (owner device defect, 2026-11-13). Renders VehicleSprite cards
 * in the GaragePanel card grammar at phone width: a Scanner bike
 * (the reported burst), a Cargo bike, a worn Frame rover (scuff +
 * frame overlays), and a plain Crawler control. Not routed in the
 * app; served via vehicle-thumb-harness.html by vite dev.
 */
const make = (overrides: Partial<VehicleDisplay>): VehicleDisplay => ({
  id: 'harness', name: 'Vehicle', vehicleClassId: 'scrap_bike', level: 1,
  rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
  isLocked: false, pixelSeed: 1, conditionCurrent: 100, conditionMax: 100,
  runtimeState: 'available',
  ...overrides,
});

const affix = (stat: string, displayText: string) =>
  ({ stat, value: 0.1, displayText } as VehicleDisplay['affixes'][number]);

const Card: React.FC<{ title: string; vehicle: VehicleDisplay }> = ({ title, vehicle }) => (
  <div className="border border-border bg-card p-2" data-testid={`harness-card-${title}`}>
    <div className="flex gap-3">
      <VehicleSprite vehicle={vehicle} />
      <div className="min-w-0">
        <div className="text-sm font-bold text-text-primary">{title}</div>
        <div className="text-[11px] text-text-muted">Effective yield now: ×1.00 (degrades with condition)</div>
      </div>
    </div>
    <div className="mt-1 flex items-baseline justify-between">
      <span className="text-[11px] text-text-muted">Condition</span>
      <span className="text-[11px] text-text-muted">100 / 100</span>
    </div>
    <div className="h-1.5 w-full bg-black/60">
      <div className="h-full w-full bg-amber-500" />
    </div>
  </div>
);

export const VehicleThumbHarnessPage: React.FC = () => (
  <div className="min-h-dvh bg-background p-2" style={{ width: 412 }}>
    <div className="flex flex-col gap-2">
      <Card
        title="Scrap Bike — Scanner"
        vehicle={make({
          name: 'Scrap Bike', vehicleClassId: 'scrap_bike', rarity: Rarity.Rare,
          affixes: [affix('vehicleScannerPct', '+9% Scanner (find)'), affix('vehicleFuelEfficiencyPct', '+9% Fuel Efficiency')],
        })}
      />
      <Card
        title="Dune Buggy — Scanner"
        vehicle={make({
          name: 'Dune Buggy', vehicleClassId: 'dune_buggy', rarity: Rarity.Uncommon,
          affixes: [affix('vehicleScannerPct', '+11% Scanner (find)')],
        })}
      />
      <Card
        title="Scrap Bike — Cargo"
        vehicle={make({
          name: 'Scrap Bike', vehicleClassId: 'scrap_bike', rarity: Rarity.Epic,
          affixes: [affix('vehicleCargoPct', '+18% Cargo Racks')],
        })}
      />
      <Card
        title="Utility Rover — Frame, worn (scuff)"
        vehicle={make({
          name: 'Utility Rover', vehicleClassId: 'utility_rover', rarity: Rarity.Rare,
          affixes: [affix('vehicleFramePct', '+12% Reinforced Frame')],
          conditionCurrent: 20, conditionMax: 100,
        })}
      />
      <Card
        title="Armored Crawler — no overlays (control)"
        vehicle={make({
          name: 'Armored Crawler', vehicleClassId: 'armored_crawler', rarity: Rarity.Uncommon,
          affixes: [affix('vehicleFuelEfficiencyPct', '+11% Fuel Efficiency')],
        })}
      />
    </div>
  </div>
);
