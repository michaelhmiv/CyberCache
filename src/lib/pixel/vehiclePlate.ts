/**
 * Parked-vehicle plate art — the ONE derivation both roam-stage
 * renderers share for the equipped vehicle's stage plate (left edge,
 * ground line, hunter in front — placement law, not this module's
 * business). The plate is a composition: the class painting fills
 * the plate box, and each rolled affix adds an overlay painting
 * (cargo rack / scanner array / reinforced frame), plus the
 * condition scuff once condition falls under 35%.
 *
 * The overlay paintings are independent canvases, NOT pixel-aligned
 * layers of the class painting — the scanner array is square
 * (1600×1600) against ~2.2–2.7:1 class canvases. The sizing rule
 * PR #579 settled for the Gear/Market surfaces, and the only rule
 * every vehicle-painting surface may use: an overlay renders as the
 * WHOLE painting, undistorted, contained inside the base plate's
 * box (object-contain semantics). Resolving an overlay at the box
 * width with its own aspect spills it past the plate (the DOM
 * stage plate's defect, REPORT §2b); forcing it to the box's width
 * AND height squashes it (the Pixi plate's defect, same section).
 */

/** The art-relevant slice of a vehicle instance: everything the
 *  plate draws, nothing it doesn't. Structural on purpose — the
 *  loadout store's VehicleDisplay satisfies it directly. */
export interface VehiclePlateArtInput {
  vehicleClassId: string;
  affixes: readonly { stat: string }[];
  conditionCurrent: number;
  conditionMax: number;
}

/** Sprite ids a vehicle's plate is composed of: the class painting
 *  plus its affix overlays, in the stacking order both stage
 *  plates have always painted (cargo, scanner, frame, scuff).
 *  Null when no vehicle is equipped (no plate at all). */
export function vehiclePlateSpriteIds(
  vehicle: VehiclePlateArtInput | null | undefined,
): { baseId: string; overlayIds: string[] } | null {
  if (!vehicle) return null;
  const overlayIds: string[] = [];
  if (vehicle.affixes.some((a) => a.stat === 'vehicleCargoPct')) overlayIds.push('vehicle-affix-cargo-rack');
  if (vehicle.affixes.some((a) => a.stat === 'vehicleScannerPct')) overlayIds.push('vehicle-affix-scanner-array');
  if (vehicle.affixes.some((a) => a.stat === 'vehicleFramePct')) overlayIds.push('vehicle-affix-reinforced-frame');
  if (vehicle.conditionCurrent / Math.max(1, vehicle.conditionMax) < 0.35) overlayIds.push('vehicle-condition-scuff');
  return { baseId: `vehicle-${vehicle.vehicleClassId.replace(/_/g, '-')}`, overlayIds };
}

/** Vehicle presentation identity: which art the stage plate must
 *  show for a loadout. The Pixi tick rebuilds the plate sprites
 *  whenever the live slot's key no longer matches the built key
 *  (REPORT §2a — the plate was a mount-time snapshot), so the key
 *  changes exactly when the ART changes: equip, unequip, class
 *  swap, an affix entering/leaving the overlay set, or condition
 *  crossing the scuff threshold in either direction. Condition
 *  drift that stays on one side of the threshold leaves the key
 *  alone — the plate must not rebuild on every claim — and a
 *  same-art instance swap leaves it alone too. '' = no vehicle. */
export function vehiclePlateKeyFor(vehicle: VehiclePlateArtInput | null | undefined): string {
  const ids = vehiclePlateSpriteIds(vehicle);
  if (!ids) return '';
  return [ids.baseId, ...ids.overlayIds].join('+');
}

/** Object-contain fit: the largest size a naturalW×naturalH
 *  painting takes inside a boxW×boxH box without distortion, and
 *  the offsets that center it there. The Pixi plate's overlay
 *  sizing — the DOM surfaces get the same rule from CSS
 *  object-contain; this is its arithmetic twin. */
export function containFit(
  naturalW: number,
  naturalH: number,
  boxW: number,
  boxH: number,
): { width: number; height: number; offsetX: number; offsetY: number } {
  const scale = Math.min(boxW / naturalW, boxH / naturalH);
  const width = naturalW * scale;
  const height = naturalH * scale;
  return { width, height, offsetX: (boxW - width) / 2, offsetY: (boxH - height) / 2 };
}
