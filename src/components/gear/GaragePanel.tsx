import React, { useEffect, useState } from 'react';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { useActivityStore, useWorkshopStore, type WorkshopJobView } from '@/store';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { formatRpcError } from '@/lib/api/rpcError';
import { buildWorkshopServiceActivity } from '@/lib/activity/activityBuilders';
import {
  PATCH_KIT_BASES,
  REPAIR_KIT_TYPES,
  REPAIR_MASTERY_SPEED_PER_LEVEL_DEFAULT,
  REPAIR_WORK_RATE_BASE_DEFAULT,
  repairKitUnitDurationMs,
  repairWorkRatePointsPerHour,
} from '@/content/repair';
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
 * level gate) and fuel loads through cc_refuel_vehicle. Condition
 * repair (0025) is WORK, not an instant consumable: self-repair is a
 * timed job on the Workshop's job machinery — your patch kits escrow
 * when the job starts and apply one at a time while Workshop Service
 * is your active action, at a rate your repair mastery sets — or you
 * post the vehicle to the Repair Services board in the Market and
 * pay another player's mechanic. Every factor the claim engine
 * reads is shown here: class yield, fuel burn, condition, affixes.
 */
export const GaragePanel: React.FC<{ onRequestService?: () => void }> = ({ onRequestService }) => {
  const vehicles = useVehicleStore((s) => s.vehicles);
  const equippedId = useLoadoutStore((s) => s.slots.vehicle);
  const playerLevel = usePlayerStore((s) => s.level);
  const vehicleFuel = usePlayerStore((s) => s.vehicleFuel);
  const fuelCells = usePlayerStore((s) => s.consumables[FUEL_CELL_TYPE] ?? 0);
  const consumables = usePlayerStore((s) => s.consumables);
  const patchKits = consumables[PATCH_KIT_TYPE] ?? 0;
  const workshop = useWorkshopStore((s) => s.server);
  const refreshWorkshop = useWorkshopStore((s) => s.refresh);
  const cancelJob = useWorkshopStore((s) => s.cancel);
  const activity = useActivityStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshWorkshop();
  }, [refreshWorkshop]);

  const repairMasteryLevel = workshop?.masteries['services.repair']?.level ?? 1;
  const repairJobFor = (vehicleId: string): WorkshopJobView | undefined =>
    workshop?.jobs.find(
      (j) =>
        j.kind === 'repair' &&
        j.repairItemId === vehicleId &&
        (j.state === 'running' || j.state === 'paused' || j.state === 'queued'),
    );

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
            kitCounts={{
              PatchKit: consumables.PatchKit ?? 0,
              FieldPatchKit: consumables.FieldPatchKit ?? 0,
              MasterPatchKit: consumables.MasterPatchKit ?? 0,
            }}
            repairJob={repairJobFor(vehicle.id)}
            repairMasteryLevel={repairMasteryLevel}
            busy={busy}
            onEquip={() => void run(() => verifiedOps.equipItem(vehicle.id, 'vehicle'))}
            onUnequip={() => void run(() => verifiedOps.unequipSlot('vehicle'))}
            onStartRepair={(kitType, units) =>
              void run(async () => {
                await verifiedOps.enqueueRepairJob(vehicle.id, kitType, units);
                await refreshWorkshop();
              })
            }
            onWorkRepair={(job) =>
              void run(async () => {
                await activity.start(
                  buildWorkshopServiceActivity({ id: job.id, label: `Repairing ${vehicle.name}` }),
                );
                await refreshWorkshop();
              })
            }
            onCancelRepair={(job) =>
              void run(async () => {
                await cancelJob(job.id);
                await refreshWorkshop();
              })
            }
            onRequestService={onRequestService}
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
  kitCounts: Record<string, number>;
  repairJob?: WorkshopJobView;
  repairMasteryLevel: number;
  busy: boolean;
  onEquip: () => void;
  onUnequip: () => void;
  onStartRepair: (kitType: string, units: number) => void;
  onWorkRepair: (job: WorkshopJobView) => void;
  onCancelRepair: (job: WorkshopJobView) => void;
  onRequestService?: () => void;
}> = ({
  vehicle, equipped, playerLevel, kitCounts, repairJob, repairMasteryLevel,
  busy, onEquip, onUnequip, onStartRepair, onWorkRepair, onCancelRepair, onRequestService,
}) => {
  const def = getVehicleClass(vehicle.vehicleClassId);
  const fraction = conditionFraction(vehicle.conditionCurrent, vehicle.conditionMax);
  const effective = effectiveVehicleYield(vehicle, fraction, 1);
  const locked = def ? playerLevel < def.unlockLevel : false;
  const worn = vehicle.conditionCurrent < vehicle.conditionMax;
  const [kitType, setKitType] = useState<string>('PatchKit');
  const [units, setUnits] = useState(1);
  const ownedOfSelected = kitCounts[kitType] ?? 0;
  const unitMs = repairKitUnitDurationMs(
    PATCH_KIT_BASES[kitType] ?? 30,
    repairWorkRatePointsPerHour(
      repairMasteryLevel,
      REPAIR_WORK_RATE_BASE_DEFAULT,
      REPAIR_MASTERY_SPEED_PER_LEVEL_DEFAULT,
    ),
  );
  const unitHours = unitMs / 3600000;

  return (
    <div className={`border p-2 space-y-1 ${equipped ? 'border-amber' : 'border-border'} bg-background/60`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-black text-text-primary">
          {vehicle.name}
          {equipped && <span className="ml-2 text-[10px] font-bold text-amber">EQUIPPED</span>}
          {vehicle.runtimeState === 'in_service' && (
            <span className="ml-2 text-[10px] font-bold text-cyan">ON CONTRACT</span>
          )}
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
      </div>

      {worn && !repairJob && (
        <div className="border-t border-border pt-2 space-y-2">
          <div className="text-[11px] text-text-muted">
            Restore Condition — repair is timed work, not an instant fix. Your kits are held
            when the job starts and apply one at a time while Workshop Service is your active
            action (repair mastery {repairMasteryLevel} sets the pace ≈ {unitHours.toFixed(1)}h
            per {kitType}).
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={kitType}
              onChange={(e) => {
                setKitType(e.target.value);
                setUnits(1);
              }}
              className="px-2 py-1 text-xs font-bold border border-border bg-surface text-text-primary"
              aria-label="Patch kit type"
            >
              {REPAIR_KIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t} — restores {PATCH_KIT_BASES[t]} × quality% (own {kitCounts[t] ?? 0})
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={busy || units <= 1}
                onClick={() => setUnits(Math.max(1, units - 1))}
                className="px-2 py-1 text-xs font-bold border border-border bg-surface disabled:opacity-40"
              >
                −
              </button>
              <span className="text-xs font-bold text-text-primary w-6 text-center">{units}</span>
              <button
                type="button"
                disabled={busy || units >= ownedOfSelected}
                onClick={() => setUnits(Math.min(ownedOfSelected, units + 1))}
                className="px-2 py-1 text-xs font-bold border border-border bg-surface disabled:opacity-40"
              >
                +
              </button>
            </div>
            <button
              type="button"
              disabled={busy || ownedOfSelected < 1}
              onClick={() => onStartRepair(kitType, units)}
              className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
            >
              Start repair job
            </button>
            {onRequestService && (
              <button
                type="button"
                disabled={busy}
                onClick={onRequestService}
                className="px-2 py-1 text-xs font-bold text-text-muted underline hover:text-amber disabled:opacity-40"
              >
                or post it to the Repair Services board
              </button>
            )}
          </div>
        </div>
      )}

      {repairJob && (
        <div className="border-t border-border pt-2 space-y-2">
          <div className="flex justify-between text-[11px]">
            <span className="font-bold text-text-primary">
              Repair job — {repairJob.repairKitType ?? 'PatchKit'}
            </span>
            <span className="text-text-muted">
              {repairJob.state === 'running' ? 'Working' : repairJob.state === 'queued' ? 'Queued' : 'Paused'}
            </span>
          </div>
          <div className="text-[11px] text-text-muted">
            {repairJob.unitsCompleted}/{repairJob.unitsTotal} kits applied ·{' '}
            {Math.floor(repairJob.repairPointsRestored)} condition restored so far. Kits not yet
            applied refund in full if you cancel.
          </div>
          <div className="h-2 bg-surface border border-border">
            <div
              className="h-full bg-emerald-500"
              style={{
                width: `${Math.min(100, Math.round(
                  ((repairJob.unitsCompleted * repairJob.unitDurationMs + repairJob.accruedMs) /
                    Math.max(1, repairJob.unitsTotal * repairJob.unitDurationMs)) * 100,
                ))}%`,
              }}
            />
          </div>
          <div className="flex gap-2">
            {repairJob.state !== 'running' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onWorkRepair(repairJob)}
                className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
              >
                Work on it
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => onCancelRepair(repairJob)}
              className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-red-400 disabled:opacity-40"
            >
              Cancel job
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
