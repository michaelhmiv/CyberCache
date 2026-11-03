import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useVehicleStore } from '@/store/slices/vehicleSlice';
import { FUEL_CELL_TYPE, PATCH_KIT_TYPE, conditionFraction, effectiveVehicleYield, getVehicleClass } from '@/lib/vehicles/vehicles';

/**
 * Roaming vehicle status (0021) — every factor the claim engine
 * reads, on the action surface: equipped vehicle, effective yield
 * bonus, fuel remaining, condition, and WHY the bonus is inactive
 * when it is (no vehicle / out of fuel / worn to zero condition).
 * Display only — the Chef derives the real factor server-side.
 *
 * ONE source for the CURRENT tank (audit CONS-01): the server
 * profile's vehicle_fuel, mirrored into the player store by every
 * claim (syncVerifiedResult) and every verified op (refuel,
 * dispatch) — the same number the Garage shows. The vehicle store's
 * lastClaimStatus is claim HISTORY (what the last claim burned, how
 * many of its ticks were active); it must never shadow the tank.
 * Before this fix the banner preferred the last claim's
 * fuelUnitsRemaining and latched its inactiveReason, so after a
 * refuel it kept reading "fuel 0 units · out of fuel" while the
 * Garage correctly showed the full tank.
 */
/**
 * Two Garage affordances, one per surface (owner ruling 2026-11-02,
 * DESIGN.md §11 F1 as amended): on the Home stage the line carries
 * the Open Garage DOOR (`onOpenGarage` — navigates to Gear →
 * Loadout with the Garage section expanded); on the Loadout itself
 * it carries the expansion TOGGLE (`onToggleExpand` + `expanded`) —
 * the Garage unfolds in place under this line, no navigation.
 */
export const VehicleStatusLine: React.FC<{
  onOpenGarage?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
}> = ({ onOpenGarage, expanded, onToggleExpand }) => {
  const equippedId = useLoadoutStore((s) => s.slots.vehicle);
  const vehicles = useVehicleStore((s) => s.vehicles);
  const equipped = equippedId ? vehicles.find((v) => v.id === equippedId) : undefined;
  const vehicleFuel = usePlayerStore((s) => s.vehicleFuel);
  // Tank units and carried cells are DIFFERENT numbers (owner
  // feedback 2026-11-02: a bare "fuel 0" read as either) — the line
  // prints both, labeled, and its remedy pointer names the cure the
  // player can actually use: load a carried cell, or go get some.
  const fuelCells = usePlayerStore((s) => s.consumables[FUEL_CELL_TYPE] ?? 0);
  const patchKits = usePlayerStore((s) => s.consumables[PATCH_KIT_TYPE] ?? 0);
  const lastClaim = useVehicleStore((s) => s.lastClaimStatus);

  const garageButton = onToggleExpand ? (
    <button
      type="button"
      onClick={onToggleExpand}
      aria-expanded={expanded ?? false}
      className="shrink-0 border border-border bg-background/60 px-2.5 py-1.5 text-[11px] font-black text-amber"
    >
      {expanded ? 'Close Garage' : 'Open Garage'}
    </button>
  ) : onOpenGarage ? (
    <button
      type="button"
      onClick={onOpenGarage}
      className="shrink-0 border border-border bg-background/60 px-2.5 py-1.5 text-[11px] font-black text-amber"
    >
      Open Garage
    </button>
  ) : null;

  if (!equipped) {
    return (
      <div data-testid="vehicle-status" className="flex items-center justify-between gap-2 border border-border/60 bg-surface/80 px-2 py-1.5 text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-1"><PxIcon name="person" size={13} /> On foot — no vehicle equipped, roaming at ×1.00. {onToggleExpand ? 'Equip one in the Garage below.' : 'Equip one in the Garage (Gear tab, Loadout).'}</span>
        {garageButton}
      </div>
    );
  }

  const def = getVehicleClass(equipped.vehicleClassId);
  const fraction = conditionFraction(equipped.conditionCurrent, equipped.conditionMax);
  const fuel = vehicleFuel;
  const factor = effectiveVehicleYield(equipped, fraction, 1);
  const outOfFuel = fuel <= 0;
  const wornOut = fraction <= 0;
  // Name once (audit copy nit): generated vehicles carry their own
  // names, but the starter's name IS its class name — echoing it
  // read "Scrap Bike (Scrap Bike)". Show the class only when it
  // adds information the name doesn't already carry.
  const classEcho = def && def.displayName.trim().toLowerCase() !== equipped.name.trim().toLowerCase()
    ? ` (${def.displayName})`
    : '';

  return (
    <div data-testid="vehicle-status" className="border border-border/60 bg-surface/80 px-2 py-1.5 text-[11px] text-text-muted space-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="inline-flex items-center gap-1"><PxIcon name="wheel" size={13} /> <span className="font-bold text-text-primary">{equipped.name}</span></span>
          {classEcho} — yield bonus{' '}
          <span className="font-bold text-text-primary">×{outOfFuel || wornOut ? '1.00' : factor.toFixed(2)}</span>
          {' '}· tank <span className="font-bold text-text-primary">{Math.floor(fuel)} units</span>
          {' '}· <span className="font-bold text-text-primary">{fuelCells}</span> fuel cell{fuelCells === 1 ? '' : 's'} carried
          {' '}· condition <span className="font-bold text-text-primary">{Math.round(fraction * 100)}%</span>
        </div>
        {garageButton}
      </div>
      {outOfFuel && (
        <div className="leading-snug text-amber [overflow-wrap:anywhere]">
          {fuelCells > 0
            ? 'Out of fuel — vehicle bonus inactive, roaming on foot at ×1.00. Load a fuel cell in the Garage to bring the bonus back.'
            : 'Out of fuel — vehicle bonus inactive, roaming on foot at ×1.00. No fuel cells carried — the Vendor in the Market sells Generic Fuel Cells, and Fuel Cells can be crafted in the Workshop.'}
        </div>
      )}
      {!outOfFuel && wornOut && (
        <div className="leading-snug text-amber [overflow-wrap:anywhere]">
          {patchKits > 0
            ? 'Vehicle worn out — bonus is ×1.00 until repaired. Use a Patch Kit in the Garage.'
            : 'Vehicle worn out — bonus is ×1.00 until repaired. No patch kits carried — the Vendor in the Market sells them, and they can be crafted in the Workshop.'}
        </div>
      )}
      {!outOfFuel && !wornOut && lastClaim && lastClaim.activeTicks < lastClaim.ticks && (
        <div>Bonus active for {lastClaim.activeTicks} of the last {lastClaim.ticks} ticks (fuel ran dry mid-claim).</div>
      )}
    </div>
  );
};
