import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useVehicleStore } from '@/store/slices/vehicleSlice';
import { FUEL_CELL_TYPE, conditionFraction, effectiveVehicleYield } from '@/lib/vehicles/vehicles';

/**
 * The vehicle chip on Home's Strip (owner decision 2026-11-10):
 * a permanent vehicle presence docked at the Strip's loot
 * segment, immediately right of the n/7 gear fraction — the
 * vehicle is the loadout's eighth slot, so it rides the counter
 * that counts the other seven. It replaces the belt chip (the
 * consumables belt is consumables only again): the belt chip
 * vanished entirely on foot, leaving Home with no vehicle
 * presence at all; this chip is ALWAYS here — equipped or on
 * foot — and every state is a door to Gear → Loadout with the
 * Garage expanded (the App's 'garage' intent), the same
 * destination the Loadout panel's VehicleButton opens in place.
 *
 * States, in the Strip's segment grammar (icon + data on one
 * line, 11px floor, values never shrink):
 *  - equipped + healthy: a quiet readout — wheel glyph, the
 *    vehicle's name, its fuel units, its ×yield (condition %
 *    joins when worn below full) — the belt chip's exact facts.
 *  - out of fuel / worn out: the chip flips to its remedy, the
 *    belt chip's flip preserved — state word + door word in
 *    amber: Refuel → Garage (a cell is carried), Buy cells →
 *    Vendor (none carried), Repair → Garage.
 *  - on foot: wheel glyph + "On foot" — the door in its quiet
 *    form; the Garage is where a vehicle is chosen.
 *
 * Same numbers as the Garage's status line (tank from the
 * player store's server mirror, factor from
 * effectiveVehicleYield) — display only, no new numbers, no
 * gameplay state of its own. Home variant only: every other
 * tab's Strip renders exactly as shipped.
 */
export const VehicleStripChip: React.FC<{
  onNavigate?: (target: string) => void;
}> = ({ onNavigate }) => {
  const equippedId = useLoadoutStore((s) => s.slots.vehicle);
  const vehicles = useVehicleStore((s) => s.vehicles);
  const vehicleFuel = usePlayerStore((s) => s.vehicleFuel);
  const fuelCells = usePlayerStore((s) => s.consumables[FUEL_CELL_TYPE] ?? 0);
  const equipped = equippedId ? vehicles.find((v) => v.id === equippedId) : undefined;

  const wheel = <PxIcon name="wheel" size={13} className="shrink-0 text-text-secondary" />;

  if (!equipped) {
    return (
      <button
        type="button"
        data-testid="vehicle-strip-chip"
        data-state="on-foot"
        aria-label="On foot — no vehicle equipped. Opens Gear, Loadout, with the Garage expanded."
        onClick={() => onNavigate?.('garage')}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap transition-transform active:scale-[0.96]"
      >
        {wheel}
        <span className="whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-wider text-text-muted">
          On foot
        </span>
      </button>
    );
  }

  const fraction = conditionFraction(equipped.conditionCurrent, equipped.conditionMax);
  const factor = effectiveVehicleYield(equipped, fraction, 1);
  const outOfFuel = vehicleFuel <= 0;
  const wornOut = !outOfFuel && fraction <= 0;
  const name = equipped.name;

  if (outOfFuel || wornOut) {
    const target = outOfFuel && fuelCells <= 0 ? 'market:vendor' : 'garage';
    const stateLabel = outOfFuel ? 'Out of fuel' : 'Worn out';
    const doorLabel = outOfFuel ? (fuelCells > 0 ? 'Refuel' : 'Buy cells') : 'Repair';
    const aria = outOfFuel
      ? fuelCells > 0
        ? `${name} is out of fuel — vehicle bonus inactive. Open the Garage to load one of your ${fuelCells} carried fuel cell${fuelCells === 1 ? '' : 's'}.`
        : `${name} is out of fuel — vehicle bonus inactive, and no fuel cells carried. The Vendor sells Generic Fuel Cells.`
      : `${name} is worn out — vehicle bonus inactive. Open the Garage to repair it.`;
    return (
      <button
        type="button"
        data-testid="vehicle-strip-chip"
        data-state={outOfFuel ? 'out-of-fuel' : 'worn-out'}
        aria-label={aria}
        onClick={() => onNavigate?.(target)}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap transition-transform active:scale-[0.96]"
      >
        {wheel}
        <span className="max-w-[104px] truncate whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-wider text-text-primary">
          {name}
        </span>
        <span className="flex items-center gap-0.5 whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-wider text-amber">
          {stateLabel} · {doorLabel}
          <PxIcon name="chevR" size={11} />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid="vehicle-strip-chip"
      data-state="ok"
      aria-label={`${name}: ${Math.floor(vehicleFuel)} fuel units, yield bonus ×${factor.toFixed(2)}${fraction < 1 ? `, condition ${Math.round(fraction * 100)}%` : ''}. Opens Gear, Loadout, with the Garage expanded.`}
      onClick={() => onNavigate?.('garage')}
      className="flex shrink-0 items-center gap-1 whitespace-nowrap transition-transform active:scale-[0.96]"
    >
      {wheel}
      <span className="max-w-[104px] truncate whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-wider text-text-primary">
        {name}
      </span>
      <span className="whitespace-nowrap text-[11px] font-bold tabular-nums leading-none text-text-muted">
        {`${Math.floor(vehicleFuel)}u · ×${factor.toFixed(2)}${fraction < 1 ? ` · ${Math.round(fraction * 100)}%` : ''}`}
      </span>
    </button>
  );
};
