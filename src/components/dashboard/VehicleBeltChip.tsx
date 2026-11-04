import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useVehicleStore } from '@/store/slices/vehicleSlice';
import { FUEL_CELL_TYPE, conditionFraction, effectiveVehicleYield } from '@/lib/vehicles/vehicles';

/**
 * The vehicle chip in the consumables belt (Home consolidation,
 * owner correction 2026-11-03: the Scrap Bike does NOT get its own
 * full-width row — its status lives IN the belt row, in the belt
 * chips' grammar). While the vehicle is fueled and sound the chip
 * sits quietly as a fuel readout; the moment the bonus is inactive
 * it carries its remedy as a door: out of fuel → the Garage (load
 * a carried cell) or the Vendor (no cells carried — it sells
 * Generic Fuel Cells); worn to zero condition → the Garage.
 *
 * Same numbers as the Garage's status line (tank from the player
 * store's server mirror, factor from effectiveVehicleYield) —
 * display only. No vehicle equipped → no chip; the on-foot state
 * lives on the Loadout page's status line and Garage.
 */
export const VehicleBeltChip: React.FC<{
  onNavigate: (target: string) => void;
}> = ({ onNavigate }) => {
  const equippedId = useLoadoutStore((s) => s.slots.vehicle);
  const vehicles = useVehicleStore((s) => s.vehicles);
  const vehicleFuel = usePlayerStore((s) => s.vehicleFuel);
  const fuelCells = usePlayerStore((s) => s.consumables[FUEL_CELL_TYPE] ?? 0);
  const equipped = equippedId ? vehicles.find((v) => v.id === equippedId) : undefined;

  if (!equipped) return null;

  const fraction = conditionFraction(equipped.conditionCurrent, equipped.conditionMax);
  const factor = effectiveVehicleYield(equipped, fraction, 1);
  const outOfFuel = vehicleFuel <= 0;
  const wornOut = !outOfFuel && fraction <= 0;
  const name = equipped.name;

  const iconBox = (
    <div className="flex h-7 w-7 items-center justify-center border-2 border-border bg-bg/80">
      <PxIcon name="wheel" size={13} className="text-text-secondary" />
    </div>
  );

  if (outOfFuel || wornOut) {
    const target = outOfFuel && fuelCells <= 0 ? 'market:vendor' : 'garage';
    const stateLabel = outOfFuel ? 'OUT OF FUEL' : 'WORN OUT';
    const doorLabel = outOfFuel ? (fuelCells > 0 ? 'Garage' : 'Vendor') : 'Garage';
    const aria = outOfFuel
      ? fuelCells > 0
        ? `${name} is out of fuel — vehicle bonus inactive. Open the Garage to load one of your ${fuelCells} carried fuel cell${fuelCells === 1 ? '' : 's'}.`
        : `${name} is out of fuel — vehicle bonus inactive, and no fuel cells carried. The Vendor sells Generic Fuel Cells.`
      : `${name} is worn out — vehicle bonus inactive. Open the Garage to repair it.`;
    return (
      <button
        type="button"
        data-testid="vehicle-belt-chip"
        data-state={outOfFuel ? 'out-of-fuel' : 'worn-out'}
        onClick={() => onNavigate(target)}
        aria-label={aria}
        className="flex min-w-0 flex-[1.35] flex-col items-center gap-1 px-1 py-2 transition-transform active:scale-[0.97]"
      >
        {iconBox}
        <div className="w-full truncate text-center text-[11px] font-black uppercase tracking-wide text-text-primary">{name}</div>
        <div className="flex items-center gap-1 whitespace-nowrap text-[11px] font-black uppercase text-amber">
          {stateLabel} · {doorLabel}
          <PxIcon name="chevR" size={13} />
        </div>
      </button>
    );
  }

  return (
    <div
      data-testid="vehicle-belt-chip"
      data-state="ok"
      className="flex min-w-0 flex-[1.35] flex-col items-center gap-1 px-1 py-2"
      aria-label={`${name}: ${Math.floor(vehicleFuel)} fuel units, yield bonus ×${factor.toFixed(2)}${fraction < 1 ? `, condition ${Math.round(fraction * 100)}%` : ''}.`}
    >
      {iconBox}
      <div className="w-full truncate text-center text-[11px] font-black uppercase tracking-wide text-text-primary">{name}</div>
      <div className="whitespace-nowrap text-[11px] font-black uppercase text-text-muted">
        {`${Math.floor(vehicleFuel)}u · ×${factor.toFixed(2)}${fraction < 1 ? ` · ${Math.round(fraction * 100)}%` : ''}`}
      </div>
    </div>
  );
};
