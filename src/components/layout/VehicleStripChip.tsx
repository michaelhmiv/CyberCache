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
 * States, in the Strip's segment grammar (icon + a two-line
 * cell, 11px floor, values never shrink):
 *  - equipped + healthy: a quiet readout — the vehicle's name
 *    on line one (the condition % rides its line when worn
 *    below full), its fuel units and ×yield whole on line
 *    two — the belt chip's exact facts.
 *  - out of fuel / worn out: the chip flips to its remedy, the
 *    belt chip's flip preserved, stacked state over door in
 *    amber: Refuel → Garage (a cell is carried), Buy cells →
 *    Vendor (none carried), Repair → Garage. The name rides
 *    the aria-label in this state (see width discipline).
 *  - on foot: wheel glyph + "On foot" — the door in its quiet
 *    form; the Garage is where a vehicle is chosen.
 *
 * Same numbers as the Garage's status line (tank from the
 * player store's server mirror, factor from
 * effectiveVehicleYield) — display only, no new numbers, no
 * gameplay state of its own. Home variant only: every other
 * tab's Strip renders exactly as shipped.
 *
 * Width discipline: the wallet's fixed residents leave this
 * cell roughly a hundred pixels at 390px, and the one-line
 * readout (~154px) does not fit it — measured the hard way in
 * this slice's first captures: in the healthy state the name
 * truncated to zero width (only the facts showed), and in the
 * remedy state the state span — shrink-0, unshrinkable —
 * painted over the level block and clipped at the frame edge.
 * The cell therefore STACKS its two lines, the belt chip's own
 * remedy for the same overflow in its cell (its comment records
 * the one-line form painting over the panel edge; state over
 * door was its fix): the name is the row's one elastic part and
 * truncates on line one; the facts stay whole on line two; the
 * remedy prints state over door, both whole, the name carried
 * by the aria-label and one tap away in the Garage. A clip
 * wrapper (overflow-hidden) bounds the cell's content to the
 * chip's own box, so no state can paint past it again. The root
 * keeps min-w-0 with basis-0 (flex-1): inside the Strip's
 * justify-between row a bare min-w-0 does not let the cell take
 * the width the wallet leaves (flexbox's min-content floor
 * holds the item's basis at content size), so the basis itself
 * yields. The full name is one tap away in the Garage.
 *
 * Touch: the Strip row stands 44px tall — the settings gear
 * resident (h-9) plus the row's own padding sets its height —
 * and the two-line cell stands ~26px, so the button extends
 * its hit area ±9px vertically, invisibly (the GearHub compare
 * button's after: idiom), reaching the row's full 44 without
 * widening into the level door's space; the visual stays two
 * 11px lines.
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

  const rootClass = `relative flex min-w-0 flex-1 basis-0 items-center transition-transform active:scale-[0.96] after:absolute after:inset-x-0 after:-inset-y-[9px] after:content-['']`;
  // Remedy states (audit H-04): the state/door words are short,
  // fixed, and must print WHOLE — they are the chip's whole purpose
  // in this state. On the elastic basis-0 root the wallet's other
  // residents squeezed the cell below the words' width at real
  // phone widths and the readout clipped them mid-word ("OUT OF" /
  // "BUY CE"). The remedy root therefore sizes to its content
  // (flex-none); the Strip row is overflow-x-auto by design and
  // absorbs the few pixels. Healthy and on-foot states keep the
  // elastic root — their name is the designed elastic part.
  const remedyRootClass = `relative flex flex-none items-center transition-transform active:scale-[0.96] after:absolute after:inset-x-0 after:-inset-y-[9px] after:content-['']`;

  if (!equipped) {
    return (
      <button
        type="button"
        data-testid="vehicle-strip-chip"
        data-state="on-foot"
        aria-label="On foot — no vehicle equipped. Opens Gear, Loadout, with the Garage expanded."
        onClick={() => onNavigate?.('garage')}
        className={`${rootClass} min-h-[26px]`}
      >
        <span
          data-testid="vehicle-chip-readout"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
        >
          {wheel}
          <span className="min-w-0 truncate whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-wider text-text-muted">
            On foot
          </span>
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
        className={remedyRootClass}
      >
        <span
          data-testid="vehicle-chip-readout"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
        >
          {wheel}
          <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <span
              data-testid="vehicle-chip-state"
              className="whitespace-nowrap text-[11px] font-black uppercase leading-[1.2] tracking-wider text-amber"
            >
              {stateLabel}
            </span>
            <span
              data-testid="vehicle-chip-door"
              className="flex items-center gap-0.5 whitespace-nowrap text-[11px] font-black uppercase leading-[1.2] tracking-wider text-amber"
            >
              {doorLabel}
              <PxIcon name="chevR" size={11} />
            </span>
          </span>
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
      className={rootClass}
    >
      <span
        data-testid="vehicle-chip-readout"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
      >
        {wheel}
        <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <span className="flex min-w-0 items-baseline gap-1 whitespace-nowrap">
            <span
              data-testid="vehicle-chip-name"
              className="min-w-0 truncate text-[11px] font-black uppercase leading-[1.2] tracking-wider text-text-primary"
            >
              {name}
            </span>
            {fraction < 1 && (
              <span
                data-testid="vehicle-chip-condition"
                className="shrink-0 text-[11px] font-bold tabular-nums leading-[1.2] text-text-muted"
              >
                {`${Math.round(fraction * 100)}%`}
              </span>
            )}
          </span>
          <span
            data-testid="vehicle-chip-facts"
            className="whitespace-nowrap text-[11px] font-bold tabular-nums leading-[1.2] text-text-muted"
          >
            {`${Math.floor(vehicleFuel)}u · ×${factor.toFixed(2)}`}
          </span>
        </span>
      </span>
    </button>
  );
};
