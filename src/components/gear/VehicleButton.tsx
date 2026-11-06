import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useVehicleStore } from '@/store/slices/vehicleSlice';
import { conditionFraction, effectiveVehicleYield, getVehicleClass } from '@/lib/vehicles/vehicles';

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

/**
 * The Loadout's vehicle door (owner ruling 2026-11-05, superseding
 * the VehicleStatusLine strip): the vehicle slot is a BUTTON in
 * the Loadout panel's header — the dead space at the top right,
 * above the primary weapon card — and one tap expands the full
 * Garage in place under the panel (the same destination the
 * strip's Open Garage toggle opened; Garage deep-links land with
 * it already expanded). The bottom strip is gone: no yield/tank/
 * condition sentence, no out-of-fuel paragraph — the button face
 * carries the glanceable facts only, as labeled numbers and state
 * words, and the Garage itself carries the remedies.
 *
 * Tank truth is unchanged (audit CONS-01): the ONE tank source is
 * the server profile's vehicle_fuel, mirrored into the player
 * store by every claim and verified op. The vehicle store's
 * lastClaimStatus is claim HISTORY and is never read here.
 *
 * Face grammar (numbers-emphasis law): vehicle name in ink (the
 * class echoes only when it adds information the name doesn't
 * already carry — the starter's name IS its class name), then one
 * compact stat line: the effective yield factor (amber while it
 * pays), the tank in units — labeled "tank", never a bare "fuel"
 * number that could read as cells carried — and the condition
 * percent. A dead bonus compresses to its state word instead
 * (NO FUEL / WORN OUT, amber): a state, not a sentence. On foot,
 * the button says so and still opens the Garage — that's where a
 * vehicle gets equipped.
 */
export const VehicleButton: React.FC<{
  expanded: boolean;
  onToggle: () => void;
}> = ({ expanded, onToggle }) => {
  const equippedId = useLoadoutStore((s) => s.slots.vehicle);
  const vehicles = useVehicleStore((s) => s.vehicles);
  const equipped = equippedId ? vehicles.find((v) => v.id === equippedId) : undefined;
  const vehicleFuel = usePlayerStore((s) => s.vehicleFuel);

  const frame = expanded
    ? 'border-amber/60 bg-amber/10'
    : 'border-border bg-bg/60 hover:border-amber/40';

  if (!equipped) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? 'Close Garage' : 'Open Garage'}
        data-testid="vehicle-button"
        data-state="on-foot"
        className={`flex min-h-[44px] items-center gap-2 border px-2 py-1.5 text-left transition-all active:scale-[0.98] ${frame}`}
        style={signClip}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center border-2 border-border bg-bg/80">
          <PxIcon name="wheel" size={15} className="text-text-muted" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-black leading-tight text-text-secondary">On foot</span>
          <span className="block whitespace-nowrap text-[11px] font-bold leading-tight text-text-muted">
            ×1.00 · no vehicle
          </span>
        </span>
        <PxIcon name={expanded ? 'chevD' : 'chevR'} size={13} className="shrink-0 text-text-muted" />
        <span className="sr-only">No vehicle equipped — roaming at ×1.00. The Garage is where a vehicle gets equipped.</span>
      </button>
    );
  }

  const def = getVehicleClass(equipped.vehicleClassId);
  const fraction = conditionFraction(equipped.conditionCurrent, equipped.conditionMax);
  const fuel = Math.floor(vehicleFuel);
  const outOfFuel = vehicleFuel <= 0;
  const wornOut = fraction <= 0;
  const factor = outOfFuel || wornOut ? 1 : effectiveVehicleYield(equipped, fraction, 1);
  const conditionPct = Math.round(fraction * 100);
  // Name once (audit copy nit, carried from the strip): the class
  // echoes only when it adds information — "Scrap Bike (Scrap
  // Bike)" never prints.
  const classEcho = def && def.displayName.trim().toLowerCase() !== equipped.name.trim().toLowerCase()
    ? def.displayName
    : null;
  const state = outOfFuel ? 'out-of-fuel' : wornOut ? 'worn-out' : 'ok';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? 'Close Garage' : 'Open Garage'}
      data-testid="vehicle-button"
      data-state={state}
      className={`flex min-h-[44px] items-center gap-2 border px-2 py-1.5 text-left transition-all active:scale-[0.98] ${
        expanded ? 'border-amber/60 bg-amber/10' : outOfFuel || wornOut ? 'border-amber/40 bg-bg/60 hover:border-amber/60' : frame
      }`}
      style={signClip}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center border-2 border-border bg-bg/80">
        <PxIcon name="wheel" size={15} className={outOfFuel || wornOut ? 'text-amber' : 'text-text-secondary'} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-black leading-tight text-text-primary">
          {equipped.name}
          {classEcho && <span className="font-bold text-text-muted"> ({classEcho})</span>}
        </span>
        <span className="block whitespace-nowrap text-[11px] font-bold leading-tight text-text-muted">
          <span className={factor > 1 ? 'font-black text-amber' : ''}>×{factor.toFixed(2)}</span>
          {' · '}
          {outOfFuel ? (
            <span className="font-black text-amber">NO FUEL</span>
          ) : (
            <>
              <span className="font-black text-text-primary">{fuel}</span> tank
            </>
          )}
          {' · '}
          {wornOut ? (
            <span className="font-black text-amber">WORN OUT</span>
          ) : (
            <>{conditionPct}%</>
          )}
        </span>
      </span>
      <PxIcon name={expanded ? 'chevD' : 'chevR'} size={13} className="shrink-0 text-text-muted" />
      <span className="sr-only">
        {equipped.name}: yield ×{factor.toFixed(2)}, tank {fuel} units, condition {conditionPct} percent.
        {outOfFuel ? ' Out of fuel — vehicle bonus inactive.' : wornOut ? ' Worn out — vehicle bonus inactive.' : ''}
      </span>
    </button>
  );
};
