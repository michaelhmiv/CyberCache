import React from 'react';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useVehicleStore } from '@/store/slices/vehicleSlice';
import { conditionFraction, effectiveVehicleYield, getVehicleClass } from '@/lib/vehicles/vehicles';

/**
 * Roaming vehicle status (0021) — every factor the claim engine
 * reads, on the action surface: equipped vehicle, effective yield
 * bonus, fuel remaining, condition, and WHY the bonus is inactive
 * when it is (no vehicle / out of fuel / worn to zero condition).
 * Display only — the Chef derives the real factor server-side.
 */
export const VehicleStatusLine: React.FC = () => {
  const equippedId = useLoadoutStore((s) => s.slots.vehicle);
  const vehicles = useVehicleStore((s) => s.vehicles);
  const equipped = equippedId ? vehicles.find((v) => v.id === equippedId) : undefined;
  const vehicleFuel = usePlayerStore((s) => s.vehicleFuel);
  const lastClaim = useVehicleStore((s) => s.lastClaimStatus);

  if (!equipped) {
    return (
      <div data-testid="vehicle-status" className="border border-border/60 bg-surface/80 px-2 py-1.5 text-[11px] text-text-muted">
        🚶 On foot — no vehicle equipped, roaming at ×1.00. Equip one in the Garage (Loadout tab).
      </div>
    );
  }

  const def = getVehicleClass(equipped.vehicleClassId);
  const fraction = conditionFraction(equipped.conditionCurrent, equipped.conditionMax);
  const fuel = lastClaim && lastClaim.equipped ? lastClaim.fuelUnitsRemaining : vehicleFuel;
  const factor = effectiveVehicleYield(equipped, fraction, 1);
  const outOfFuel = fuel <= 0 || lastClaim?.inactiveReason === 'out_of_fuel';
  const wornOut = fraction <= 0;

  return (
    <div data-testid="vehicle-status" className="border border-border/60 bg-surface/80 px-2 py-1.5 text-[11px] text-text-muted space-y-0.5">
      <div>
        🛞 <span className="font-bold text-text-primary">{equipped.name}</span>
        {def ? ` (${def.displayName})` : ''} — yield bonus{' '}
        <span className="font-bold text-text-primary">×{outOfFuel || wornOut ? '1.00' : factor.toFixed(2)}</span>
        {' '}· fuel <span className="font-bold text-text-primary">{Math.floor(fuel)} units</span>
        {' '}· condition <span className="font-bold text-text-primary">{Math.round(fraction * 100)}%</span>
      </div>
      {outOfFuel && (
        <div className="text-amber">Out of fuel — vehicle bonus inactive, roaming on foot at ×1.00. Load Generic Fuel Cells in the Garage.</div>
      )}
      {!outOfFuel && wornOut && (
        <div className="text-amber">Vehicle worn out — bonus is ×1.00 until repaired. Use a Patch Kit in the Garage.</div>
      )}
      {!outOfFuel && !wornOut && lastClaim && lastClaim.activeTicks < lastClaim.ticks && (
        <div>Bonus active for {lastClaim.activeTicks} of the last {lastClaim.ticks} ticks (fuel ran dry mid-claim).</div>
      )}
    </div>
  );
};
