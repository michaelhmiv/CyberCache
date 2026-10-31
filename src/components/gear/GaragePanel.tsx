import React, { useState } from 'react';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { formatRpcError } from '@/lib/api/rpcError';
import {
  FUEL_CELL_TYPE,
  PATCH_KIT_TYPE,
  conditionFraction,
  effectiveVehicleYield,
  getVehicleClass,
} from '@/lib/vehicles/vehicles';

/**
 * Garage (0021) — the vehicle home inside the gear home.
 *
 * Vehicles are real gear in their own slot: equip/unequip go through
 * the same verified ops as gear slots (the server enforces the class
 * level gate), fuel loads through cc_refuel_vehicle, and Patch Kits
 * repair through cc_use_patch_kit. Every factor the claim engine
 * reads is shown here: class yield, fuel burn, condition, affixes.
 */
export const GaragePanel: React.FC = () => {
  const vehicles = useVehicleStore((s) => s.vehicles);
  const equippedId = useLoadoutStore((s) => s.slots.vehicle);
  const playerLevel = usePlayerStore((s) => s.level);
  const vehicleFuel = usePlayerStore((s) => s.vehicleFuel);
  const fuelCells = usePlayerStore((s) => s.consumables[FUEL_CELL_TYPE] ?? 0);
  const patchKits = usePlayerStore((s) => s.consumables[PATCH_KIT_TYPE] ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(formatRpcError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="garage-panel"
      className="relative overflow-hidden border-2 border-border bg-surface/95 p-3 space-y-3"
      style={{ clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' }}
    >
      <div>
        <div className="text-base font-black text-text-primary">Garage</div>
        <div className="text-xs text-text-muted">
          Your vehicle multiplies what every roaming tick yields — it never changes the tick rate. Out of fuel or worn out, you roam on foot at ×1.00.
        </div>
      </div>

      <div className="border border-border bg-background/60 p-2 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Fuel tank</span>
          <span className="font-bold text-text-primary">{Math.floor(vehicleFuel)} units</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Generic Fuel Cells in inventory</span>
          <span className="font-bold text-text-primary">{fuelCells}</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || fuelCells < 1}
            onClick={() => void run(() => verifiedOps.refuelVehicle(1))}
            className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
          >
            Load 1 cell (+100 units)
          </button>
          <button
            type="button"
            disabled={busy || fuelCells < 2}
            onClick={() => void run(() => verifiedOps.refuelVehicle(fuelCells))}
            className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
          >
            Load all
          </button>
        </div>
        <div className="text-[11px] text-text-muted">
          Patch Kits owned: {patchKits} — buy fuel cells and patch kits from the vendor.
        </div>
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      {vehicles.length === 0 && (
        <div className="text-xs text-text-muted">No vehicles yet. Your starter Scrap Bike arrives with the initial bundle; more drop while roaming.</div>
      )}

      <div className="space-y-2">
        {vehicles.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            equipped={vehicle.id === equippedId}
            playerLevel={playerLevel}
            patchKits={patchKits}
            busy={busy}
            onEquip={() => void run(() => verifiedOps.equipItem(vehicle.id, 'vehicle'))}
            onUnequip={() => void run(() => verifiedOps.unequipSlot('vehicle'))}
            onPatch={() => void run(() => verifiedOps.usePatchKit(vehicle.id))}
          />
        ))}
      </div>
    </section>
  );
};

const VehicleCard: React.FC<{
  vehicle: VehicleDisplay;
  equipped: boolean;
  playerLevel: number;
  patchKits: number;
  busy: boolean;
  onEquip: () => void;
  onUnequip: () => void;
  onPatch: () => void;
}> = ({ vehicle, equipped, playerLevel, patchKits, busy, onEquip, onUnequip, onPatch }) => {
  const def = getVehicleClass(vehicle.vehicleClassId);
  const fraction = conditionFraction(vehicle.conditionCurrent, vehicle.conditionMax);
  const effective = effectiveVehicleYield(vehicle, fraction, 1);
  const locked = def ? playerLevel < def.unlockLevel : false;
  const worn = vehicle.conditionCurrent < vehicle.conditionMax;

  return (
    <div className={`border p-2 space-y-1 ${equipped ? 'border-amber' : 'border-border'} bg-background/60`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-black text-text-primary">
          {vehicle.name}
          {equipped && <span className="ml-2 text-[10px] font-bold text-amber">EQUIPPED</span>}
        </div>
        <div className="text-[11px] text-text-muted">{vehicle.rarity}</div>
      </div>
      <div className="text-[11px] text-text-muted">
        {def ? `${def.displayName} · requires level ${def.unlockLevel}` : vehicle.vehicleClassId}
        {def ? ` · base yield ×${def.baseYield.toFixed(2)} · burns ${def.fuelBurnPerTick.toFixed(1)} fuel/tick` : ''}
      </div>
      <div className="text-[11px] text-text-muted">
        Effective yield now: <span className="font-bold text-text-primary">×{effective.toFixed(2)}</span>
        {' '}(degrades with condition)
      </div>
      <div>
        <div className="flex justify-between text-[10px] text-text-muted">
          <span>Condition</span>
          <span>{Math.floor(vehicle.conditionCurrent)} / {vehicle.conditionMax}</span>
        </div>
        <div className="h-2 bg-surface border border-border">
          <div className="h-full bg-amber" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      </div>
      {vehicle.affixes.length > 0 && (
        <ul className="text-[11px] text-text-primary space-y-0.5">
          {vehicle.affixes.map((affix) => (
            <li key={affix.id}>{affix.displayText}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 pt-1">
        {equipped ? (
          <button
            type="button"
            disabled={busy}
            onClick={onUnequip}
            className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
          >
            Unequip
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || locked}
            onClick={onEquip}
            className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
          >
            {locked ? `Requires level ${def?.unlockLevel}` : 'Equip'}
          </button>
        )}
        <button
          type="button"
          disabled={busy || !worn || patchKits < 1}
          onClick={onPatch}
          className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
        >
          Use Patch Kit{!worn ? ' (full)' : patchKits < 1 ? ' (none owned)' : ''}
        </button>
      </div>
    </div>
  );
};
