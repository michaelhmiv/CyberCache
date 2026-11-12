import React, { useEffect, useState } from 'react';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { useActivityStore, useWorkshopStore } from '@/store';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { formatRpcError } from '@/lib/api/rpcError';
import { buildWorkshopServiceActivity } from '@/lib/activity/activityBuilders';
import {
  PATCH_KIT_BASES,
  REPAIR_KIT_TYPES,
  REPAIR_MASTERY_EFFICIENCY_PER_LEVEL_DEFAULT,
  REPAIR_MASTERY_SPEED_PER_LEVEL_DEFAULT,
  REPAIR_WORK_RATE_BASE_DEFAULT,
  repairEfficiencyWithSkill,
  repairKitRestorePoints,
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
import { getPixelSprite } from '@/lib/pixel/manifest';
import { QuickBuyPlus } from '@/components/quickbuy/QuickBuyPlus';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { rushTicketTimeReduction } from '@/content/crafting';

const KIT_LABELS: Record<string, string> = {
  PatchKit: 'Patch Kit',
  FieldPatchKit: 'Field Patch Kit',
  MasterPatchKit: 'Master Patch Kit',
};

/**
 * The vehicle's face (the v1 garage content design DESIGN.md §11
 * F1 preserves — sprite, gauges, patch-kit repair — now carried by
 * the Loadout's in-place vehicle section, owner ruling 2026-11-02).
 * The class sprite is the ACTUAL instance's class profile
 * with its rolled affix overlays and condition wear, derived exactly
 * as the Home stage derives them for the parked vehicle
 * (LiveTurfDiorama): cargo rack / scanner array / reinforced frame
 * by affix stat, the scuff layer under 35% condition.
 */
export const VehicleSprite: React.FC<{ vehicle: VehicleDisplay; widthClass?: string }> = ({ vehicle, widthClass = 'w-[92px]' }) => {
  const fraction = conditionFraction(vehicle.conditionCurrent, vehicle.conditionMax);
  const overlay = (id: string) => (
    <img
      src={getPixelSprite(id)?.url}
      alt=""
      draggable={false}
      className="absolute inset-0 w-full"
      style={{ imageRendering: 'pixelated' }}
    />
  );
  return (
    <div className={`relative ${widthClass} shrink-0 self-start`} data-testid="garage-vehicle-sprite">
      <img
        src={getPixelSprite(`vehicle-${vehicle.vehicleClassId.replace(/_/g, '-')}`)?.url}
        alt=""
        draggable={false}
        className="w-full"
        style={{ imageRendering: 'pixelated' }}
      />
      {vehicle.affixes.some((a) => a.stat === 'vehicleCargoPct') && overlay('vehicle-affix-cargo-rack')}
      {vehicle.affixes.some((a) => a.stat === 'vehicleScannerPct') && overlay('vehicle-affix-scanner-array')}
      {vehicle.affixes.some((a) => a.stat === 'vehicleFramePct') && overlay('vehicle-affix-reinforced-frame')}
      {fraction < 0.35 && overlay('vehicle-condition-scuff')}
    </div>
  );
};

/**
 * A remedy door: the tappable way OUT of an empty-handed state
 * (fuel/condition clarity, owner feedback 2026-11-02 — the fix sits
 * next to the problem, and when the player owns none of the cure,
 * the door to get it is part of the same block).
 */
const RemedyDoor: React.FC<{ title: string; detail: string; onClick: () => void }> = ({ title, detail, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="min-w-[120px] flex-1 border border-amber/70 bg-background/60 px-2 py-2 text-left"
  >
    <span className="block text-xs font-black text-amber">{title}</span>
    <span className="block text-[11px] leading-snug text-text-muted">{detail}</span>
  </button>
);

/**
 * Garage (0021) — the vehicle home inside the Loadout. It renders
 * expanded under the vehicle status line in the Loadout stop's
 * VehicleGarageSection (owner ruling 2026-11-02 folded it here
 * from its short-lived rail stop; DESIGN.md §11 F1 as amended).
 *
 * Vehicles are real gear in their own slot: equip/unequip go through
 * the same verified ops as gear slots (equip checks ownership only —
 * vehicles are pure market goods, owner ruling 2026-11-02) and fuel
 * loads through cc_refuel_vehicle. Condition
 * repair (0025) is WORK, not an instant consumable: self-repair is a
 * timed job on the Workshop's job machinery — your patch kits escrow
 * when the job starts and apply one at a time while Workshop Service
 * is your active action, at a rate your repair mastery sets — or you
 * post the vehicle to the Repair Services board in the Market and
 * pay another player's mechanic. Every factor the claim engine
 * reads is shown here: class yield, fuel burn, condition, affixes.
 */
export const GaragePanel: React.FC<{
  onRequestService?: () => void;
  /** App navigation for the remedy doors (Vendor / Workshop / Buy lane). */
  onNavigate?: (screen: string) => void;
}> = ({ onRequestService, onNavigate }) => {
  const vehicles = useVehicleStore((s) => s.vehicles);
  const equippedId = useLoadoutStore((s) => s.slots.vehicle);
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
  const [notice, setNotice] = useState<string | null>(null);

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
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(formatRpcError(err));
    } finally {
      setBusy(false);
    }
  };

  // Refuel confirms like the vendor confirms a purchase (audit
  // UX-08): a silent numbers-only change left players unsure the
  // load happened. The tank figure is read back from the player
  // store AFTER the op's server sync lands — the same profile
  // vehicle_fuel the tank row (and the Action banner) display.
  const handleRefuel = async (cells: number) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await verifiedOps.refuelVehicle(cells);
      const tank = usePlayerStore.getState().vehicleFuel;
      setNotice(`Loaded ${cells} cell${cells === 1 ? '' : 's'} — tank at ${Math.floor(tank)} units.`);
    } catch (err) {
      setError(formatRpcError(err));
    } finally {
      setBusy(false);
    }
  };

  // Fuel clarity (owner feedback 2026-11-02): the tank (units) and
  // the cells carried (count) are different numbers and print as
  // such; when the tank is dry the remedy renders WITH the problem —
  // the Load buttons move into the out-of-fuel block (rendered
  // exactly once either way), and an empty-handed player gets
  // tappable doors to the Vendor / Workshop / player market instead
  // of a hint they have to act on from memory.
  const outOfFuel = vehicleFuel <= 0;
  const loadButtons = (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busy || fuelCells < 1}
        onClick={() => void handleRefuel(1)}
        className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
      >
        Load 1 cell (+100 units)
      </button>
      <button
        type="button"
        disabled={busy || fuelCells < 1}
        onClick={() => void handleRefuel(fuelCells)}
        className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
      >
        Load all
      </button>
    </div>
  );

  return (
    <section
      id="garage-panel"
      data-testid="garage-panel"
      className="relative overflow-hidden border-2 border-border bg-surface/95 p-3 space-y-3"
      style={{ clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' }}
    >
      <div>
        <div className="text-lg font-black text-text-primary">Garage</div>
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
        {/* The buttons render exactly once: here in the tank panel,
            except when the tank is dry AND cells are on hand — then
            they move into the out-of-fuel block below, beside the
            problem they fix. Cell-less, they stay here, disabled,
            with the doors in the block (QC C1). */}
        {!(outOfFuel && fuelCells > 0) && loadButtons}
        {notice && <div className="text-xs text-text-secondary">{notice}</div>}
        <div className="text-[11px] text-text-muted">
          Patch Kits owned: {patchKits} — buy fuel cells and patch kits from the vendor.
        </div>
      </div>

      {outOfFuel && (
        <div className="space-y-2 border border-amber/60 bg-amber/10 p-2" data-testid="garage-out-of-fuel">
          <div className="text-xs font-bold text-amber">
            Out of fuel — your vehicle pays no yield bonus and you roam on foot at ×1.00 until the tank has fuel in it.
          </div>
          {fuelCells > 0 ? (
            <>
              <div className="text-[11px] text-text-muted">
                Load a cell to bring the bonus back — each cell adds 100 fuel units:
              </div>
              {loadButtons}
            </>
          ) : (
            <>
              <div className="text-[11px] text-text-muted" data-testid="garage-fuel-hint">
                No Generic Fuel Cells in inventory — the Vendor in the Market sells them, and they
                trade on the player market. Buy a few, then load them here: each cell adds 100 fuel
                units. Out of fuel never stops roaming; the vehicle bonus just turns off until you
                refuel.
              </div>
              {onNavigate && (
                <div className="flex flex-wrap gap-2">
                  <RemedyDoor
                    title="Vendor"
                    detail="Generic Fuel Cells — 40cr each at the Market vendor"
                    onClick={() => onNavigate('market:vendor')}
                  />
                  <RemedyDoor
                    title="Workshop"
                    detail="Craft Fuel Cells at the bench"
                    onClick={() => onNavigate('workshop')}
                  />
                  <RemedyDoor
                    title="Player Market"
                    detail="Fuel cells trade on the Buy lane"
                    onClick={() => onNavigate('market:buy')}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {error && <div className="text-xs text-red-400">{error}</div>}

      {vehicles.length === 0 && (
        <div className="text-xs text-text-muted">No vehicles yet — your starter Scrap Bike is in your initial bundle; more vehicles trade on the player market.</div>
      )}

      <div className="space-y-2">
        {vehicles.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            equipped={vehicle.id === equippedId}
            outOfFuel={outOfFuel}
            onNavigate={onNavigate}
            kitCounts={{
              PatchKit: consumables.PatchKit ?? 0,
              FieldPatchKit: consumables.FieldPatchKit ?? 0,
              MasterPatchKit: consumables.MasterPatchKit ?? 0,
            }}
            rushTickets={consumables.WorkshopRushTicket ?? 0}
            repairJob={repairJobFor(vehicle.id)}
            repairMasteryLevel={repairMasteryLevel}
            busy={busy}
            onEquip={() => void run(() => verifiedOps.equipItem(vehicle.id, 'vehicle'))}
            onUnequip={() => void run(() => verifiedOps.unequipSlot('vehicle'))}
            onStartRepair={(kitType, units, useRushTicket) =>
              void run(async () => {
                await verifiedOps.enqueueRepairJob(vehicle.id, kitType, units, useRushTicket);
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
  /** The panel's one derived fuel state — the same value that drives
   * the out-of-fuel banner (audit G-F6: one derived yield value
   * feeding both surfaces). */
  outOfFuel: boolean;
  kitCounts: Record<string, number>;
  rushTickets: number;
  repairJob?: WorkshopJobView;
  repairMasteryLevel: number;
  busy: boolean;
  onEquip: () => void;
  onUnequip: () => void;
  onStartRepair: (kitType: string, units: number, useRushTicket: boolean) => void;
  onWorkRepair: (job: WorkshopJobView) => void;
  onCancelRepair: (job: WorkshopJobView) => void;
  onRequestService?: () => void;
  onNavigate?: (screen: string) => void;
}> = ({
  vehicle, equipped, outOfFuel, kitCounts, rushTickets, repairJob, repairMasteryLevel,
  busy, onEquip, onUnequip, onStartRepair, onWorkRepair, onCancelRepair, onRequestService,
  onNavigate,
}) => {
  const def = getVehicleClass(vehicle.vehicleClassId);
  const fraction = conditionFraction(vehicle.conditionCurrent, vehicle.conditionMax);
  // One derived yield for the whole Garage (audit G-F6): the tank is
  // a single shared pool, so an empty tank zeroes every card's
  // "effective yield now" exactly as the banner states — the card
  // used to print the condition-only figure (×1.15) while the banner
  // above it said ×1.00. (Wrecked already reads ×1.00 through the
  // condition fraction; VehicleButton gates the same way.)
  const effective = outOfFuel ? 1 : effectiveVehicleYield(vehicle, fraction, 1);
  const worn = vehicle.conditionCurrent < vehicle.conditionMax;
  const wrecked = vehicle.conditionCurrent <= 0;
  const totalKits = (kitCounts.PatchKit ?? 0) + (kitCounts.FieldPatchKit ?? 0) + (kitCounts.MasterPatchKit ?? 0);
  // Empty-handed repair doors (fuel/condition clarity, 2026-11-02):
  // when the player owns no patch kits at all, the way to GET kits
  // renders beside the repair controls, not in another tab's copy.
  const kitDoors = onNavigate ? (
    <div className="flex flex-wrap gap-2" data-testid="garage-kit-doors">
      <RemedyDoor
        title="Vendor"
        detail="Patch Kits — 150cr each at the Market vendor"
        onClick={() => onNavigate('market:vendor')}
      />
      <RemedyDoor
        title="Workshop"
        detail="Craft Patch Kits at the bench"
        onClick={() => onNavigate('workshop')}
      />
    </div>
  ) : null;
  const [kitType, setKitType] = useState<string>('PatchKit');
  const [units, setUnits] = useState(1);
  const [useRush, setUseRush] = useState(false);
  const ownedOfSelected = kitCounts[kitType] ?? 0;
  const unitMs = repairKitUnitDurationMs(
    PATCH_KIT_BASES[kitType] ?? 30,
    repairWorkRatePointsPerHour(
      repairMasteryLevel,
      REPAIR_WORK_RATE_BASE_DEFAULT,
      REPAIR_MASTERY_SPEED_PER_LEVEL_DEFAULT,
    ),
  );

  // QB-2 quick-buy shortfall for the selected kit: what a FULL
  // restore of this vehicle's deficit still needs once the kits on
  // hand are spent. The estimate walks the player's REAL batches
  // at the mastery-only efficiency — the guaranteed pace (Fixer
  // and research terms only ever improve the true coverage, the
  // same conservative basis the service boards quote on) — and
  // prices fresh units at standard quality (100%), the basis
  // vendor stock is sold at. The sheet re-quotes exactly, and its
  // stepper steps down freely, so an estimate can never oversell.
  const consumableBatches = usePlayerStore((s) => s.consumableBatches);
  // Rush ticket preview (wiring package): the ticket's def declares
  // a repair scope, and the enqueue now honors it. The escrow burns
  // FIFO (lowest quality first — the shipped burn order), so the
  // preview prices the reduction off the lowest-quality ticket on
  // hand at the base cap; the Fixer keystone can only improve it.
  const fifoTicketQuality = consumableBatches
    .filter((b) => b.consumable_type === 'WorkshopRushTicket' && b.quantity > 0)
    .reduce<number | null>((min, b) => (min === null || b.quality_percent < min ? b.quality_percent : min), null);
  const rushPreviewReduction = useRush && fifoTicketQuality !== null
    ? rushTicketTimeReduction(fifoTicketQuality, 0)
    : 0;
  const displayUnitHours = (unitMs * (1 - rushPreviewReduction)) / 3600000;
  const kitBase = PATCH_KIT_BASES[kitType] ?? 30;
  const kitEfficiency = repairEfficiencyWithSkill(
    repairMasteryLevel,
    REPAIR_MASTERY_EFFICIENCY_PER_LEVEL_DEFAULT,
    0,
  );
  const pointsPerKit = (quality: number) => repairKitRestorePoints(kitBase, quality, kitEfficiency);
  const deficitPoints = Math.max(0, vehicle.conditionMax - vehicle.conditionCurrent);
  const coveredPoints = consumableBatches
    .filter((b) => b.consumable_type === kitType)
    .reduce((sum, b) => sum + pointsPerKit(b.quality_percent) * Math.max(0, b.quantity), 0);
  const standardKitPoints = pointsPerKit(100);
  const kitShortfall =
    deficitPoints > 0 && coveredPoints < deficitPoints && standardKitPoints > 0
      ? Math.ceil((deficitPoints - coveredPoints) / standardKitPoints)
      : 0;

  return (
    <div className={`border p-2 space-y-1 ${equipped ? 'border-amber' : 'border-border'} bg-background/60`}>
      <div className="flex gap-2">
        <VehicleSprite vehicle={vehicle} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-black text-text-primary">
              {vehicle.name}
              {equipped && <span className="ml-2 text-[11px] font-bold text-amber">EQUIPPED</span>}
              {vehicle.runtimeState === 'in_service' && (
                <span className="ml-2 text-[11px] font-bold text-cyan">ON CONTRACT</span>
              )}
            </div>
            <div className="shrink-0 text-[11px] text-text-muted">{vehicle.rarity}</div>
          </div>
          <div className="text-[11px] text-text-muted">
            {def ? def.displayName : vehicle.vehicleClassId}
            {def ? ` · base yield ×${def.baseYield.toFixed(2)} · burns ${def.fuelBurnPerTick.toFixed(1)} fuel/tick` : ''}
          </div>
          <div className="text-[11px] text-text-muted">
            Effective yield now: <span className="font-bold text-text-primary">×{effective.toFixed(2)}</span>
            {' '}(degrades with condition)
          </div>
        </div>
      </div>
      <div>
        <div className="flex justify-between text-[11px] text-text-muted">
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
            disabled={busy}
            onClick={onEquip}
            className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
          >
            Equip
          </button>
        )}
      </div>

      {wrecked && (
        <div className="space-y-2 border border-red-400/50 bg-red-400/10 p-2" data-testid="garage-worn-out">
          <div className="text-[11px] font-bold leading-snug text-red-300">
            Wrecked — condition is 0, so this vehicle pays no yield bonus. Patch kits are the fix:
            start a repair job below{totalKits > 0 ? ' with the kits you own' : ''}.
          </div>
          {totalKits === 0 && kitDoors}
        </div>
      )}

      {worn && !repairJob && (
        <div className="border-t border-border pt-2 space-y-2">
          <div className="text-[11px] text-text-muted">
            Restore Condition — repair is timed work, not an instant fix. Your kits are held
            when the job starts and apply one at a time while Workshop Service is your active
            action (repair mastery {repairMasteryLevel} sets the pace ≈ {displayUnitHours.toFixed(1)}h
            per {kitType}).
          </div>
          {totalKits === 0 && (
            <>
              <div className="text-[11px] font-bold text-text-primary">You own no patch kits — get them here:</div>
              {kitDoors}
            </>
          )}
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
              onClick={() => onStartRepair(kitType, units, useRush && rushTickets > 0)}
              className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
            >
              Start repair job
            </button>
            {/* Rush ticket (wiring package): the ticket def declares a
                repair scope — same toggle pattern as the Workshop
                bench. Shown only when a ticket is on hand. */}
            {rushTickets > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setUseRush(!useRush)}
                title="Escrow one Workshop Rush Ticket: the repair runs faster by the ticket's quality"
                className={`px-2 py-1 text-[11px] font-bold border ${useRush ? 'bl-primary border-transparent' : 'border-border text-text-secondary'} disabled:opacity-40`}
              >
                <span className="inline-flex items-center gap-1"><PxIcon name="tag" size={13} /> Rush ticket ({rushTickets})</span>
              </button>
            )}
            {/* QB-2: the lone + beside the kit shortfall for a full
                restore — pricing and states live in the sheet. */}
            <QuickBuyPlus
              good={{ kind: 'consumable', id: kitType }}
              goodName={KIT_LABELS[kitType] ?? kitType}
              shortfall={kitShortfall}
              contextLabel={vehicle.name}
              onNavigate={onNavigate}
            />
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
          {useRush && rushTickets > 0 && (
            <div className="text-[11px] text-text-muted">
              One rush ticket is escrowed for this job — it runs faster by the ticket's quality.
            </div>
          )}
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
          {/* Crafting consolidation (2026-11-04): repairs are
              managed at the bench — Home's Craft workspace carries
              the Repairs & Service section. This door lands there;
              starting and quick-working the job stay here. */}
          <button
            type="button"
            onClick={() => onNavigate?.('workshop')}
            className="text-[11px] font-bold text-amber hover:text-amber/80"
          >
            Manage at the bench — Repairs &amp; Service on Home →
          </button>
        </div>
      )}
    </div>
  );
};
