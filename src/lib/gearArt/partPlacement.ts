import type { WeaponVisualSpec } from '@/lib/weaponArt/buildWeaponVisualSpec';

/**
 * Compute attachment points on a weapon silhouette for positioning parts,
 * element effects, and decals relative to the weapon geometry rather than
 * hardcoded pixel coordinates.
 *
 * Each weapon silhouette declares its outer anchor and inner body bounds.
 * From those we derive stable reference points for every part slot.
 */
export interface PartAttachPoints {
  /** Base of the barrel where it meets the body */
  barrelBase: { x: number; y: number };
  /** Barrel tip near the muzzle */
  barrelTip: { x: number; y: number };
  /** Top of the grip where it meets the body */
  gripTop: { x: number; y: number };
  /** Bottom of the grip */
  gripBottom: { x: number; y: number };
  /** Magazine well center */
  magWell: { x: number; y: number };
  /** Magazine bottom */
  magBottom: { x: number; y: number };
  /** Sight rail center */
  sightRail: { x: number; y: number };
  /** Chamber center */
  chamberCenter: { x: number; y: number };
  /** Body center (for decals, element effects) */
  bodyCenter: { x: number; y: number };
  /** Top rail line for panel details */
  topRail: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * Parse a simple SVG path string (only M, L, Z commands) into an array of
 * {x,y} points. Used to extract geometry from silhouette paths.
 */
function parsePathPoints(d: string): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const parts = d.split(/[ ,]+/);
  let i = 0;
  while (i < parts.length) {
    const cmd = parts[i];
    if (cmd === 'M' || cmd === 'L') {
      const x = parseFloat(parts[i + 1]);
      const y = parseFloat(parts[i + 2]);
      if (!Number.isNaN(x) && !Number.isNaN(y)) {
        points.push({ x, y });
      }
      i += 3;
    } else if (cmd === 'Z') {
      i += 1;
    } else {
      // Probably a coordinate without an explicit command letter
      i += 1;
    }
  }
  return points;
}

/**
 * Compute all attachment points for a given weapon spec.
 */
export function computeAttachPoints(spec: WeaponVisualSpec): PartAttachPoints {
  const sil = spec.silhouette;
  const bodyPoints = parsePathPoints(sil.body);
  const barrelPoints = parsePathPoints(sil.barrel);
  const gripPoints = parsePathPoints(sil.grip);

  // Body center: average of body path points
  const bodyCX = bodyPoints.reduce((s, p) => s + p.x, 0) / Math.max(1, bodyPoints.length);
  const bodyCY = bodyPoints.reduce((s, p) => s + p.y, 0) / Math.max(1, bodyPoints.length);

  // Barrel base: leftmost point of barrel path (closest to body)
  const barrelSorted = [...barrelPoints].sort((a, b) => a.x - b.x);
  const barrelBase = barrelSorted.length > 0 ? barrelSorted[0] : { x: bodyCX + 40, y: bodyCY };
  const barrelTip = barrelSorted.length > 0 ? barrelSorted[barrelSorted.length - 1] : { x: bodyCX + 80, y: bodyCY };

  // Grip: bottommost point
  const gripSorted = [...gripPoints].sort((a, b) => b.y - a.y);
  const gripTop = gripSorted.length > 1 ? gripSorted[gripSorted.length - 1] : { x: bodyCX - 10, y: bodyCY + 15 };
  const gripBottom = gripSorted.length > 0 ? gripSorted[0] : { x: bodyCX - 10, y: bodyCY + 40 };

  // Magazine: use silhouette magazine path or estimate from body
  let magWell = { x: bodyCX + 15, y: bodyCY + 12 };
  let magBottom = { x: bodyCX + 15, y: bodyCY + 35 };
  if (sil.magazine) {
    const magPoints = parsePathPoints(sil.magazine);
    const magSortedY = [...magPoints].sort((a, b) => b.y - a.y);
    if (magSortedY.length > 0) magBottom = magSortedY[0];
    if (magSortedY.length > 1) magWell = magSortedY[magSortedY.length - 1];
  }

  // Sight rail: use silhouette sight path or estimate
  let sightRail = { x: bodyCX + 5, y: bodyCY - 12 };
  if (sil.sight) {
    const sightPoints = parsePathPoints(sil.sight);
    const sightAvgX = sightPoints.reduce((s, p) => s + p.x, 0) / Math.max(1, sightPoints.length);
    const sightAvgY = sightPoints.reduce((s, p) => s + p.y, 0) / Math.max(1, sightPoints.length);
    sightRail = { x: sightAvgX, y: sightAvgY };
  }

  // Chamber center: from silhouette
  let chamberCenter = { x: bodyCX + 30, y: bodyCY };
  if (sil.chamber) {
    const chamberPoints = parsePathPoints(sil.chamber);
    const chX = chamberPoints.reduce((s, p) => s + p.x, 0) / Math.max(1, chamberPoints.length);
    const chY = chamberPoints.reduce((s, p) => s + p.y, 0) / Math.max(1, chamberPoints.length);
    chamberCenter = { x: chX, y: chY };
  }

  // Top rail line: from sight center to muzzle
  const topRail = {
    x1: sil.sight ? sightRail.x - 15 : bodyCX - 5,
    y1: sil.sight ? sightRail.y + 3 : bodyCY - 8,
    x2: barrelTip.x,
    y2: barrelTip.y - 5,
  };

  return {
    barrelBase,
    barrelTip,
    gripTop,
    gripBottom,
    magWell,
    magBottom,
    sightRail,
    chamberCenter,
    bodyCenter: { x: bodyCX, y: bodyCY },
    topRail,
  };
}

/**
 * Generate barrel variant paths based on the actual barrel geometry.
 * Returns up to 3 visually distinct barrel attachment shapes.
 */
export function barrelAttachments(spec: WeaponVisualSpec): Array<{ d: string; variant: number }> {
  const pts = computeAttachPoints(spec);
  const base = pts.barrelBase;
  const tip = pts.barrelTip;
  const length = tip.x - base.x;

  const variants: Array<{ d: string; variant: number }> = [];

  // Variant 0: top-mounted barrel shroud
  variants.push({
    d: `M${base.x + 6} ${base.y - 8} L${tip.x - 8} ${tip.y - 10} L${tip.x - 4} ${tip.y - 3} L${base.x + 10} ${base.y - 1} Z`,
    variant: 0,
  });

  // Variant 1: bottom rail / under-barrel
  variants.push({
    d: `M${base.x + 4} ${base.y + 10} L${tip.x - 10} ${tip.y + 8} L${tip.x - 6} ${tip.y + 3} L${base.x + 8} ${base.y + 5} Z`,
    variant: 1,
  });

  // Variant 2: heat shield / barrel jacket
  if (length > 30) {
    variants.push({
      d: `M${base.x + 2} ${base.y - 5} L${tip.x - 14} ${tip.y - 6} L${tip.x - 12} ${tip.y + 4} L${base.x + 4} ${base.y + 3} Z`,
      variant: 2,
    });
  }

  return variants;
}

/**
 * Generate sight variant paths based on the sight rail geometry.
 */
export function sightAttachments(spec: WeaponVisualSpec): Array<{ d: string; variant: number }> {
  const pts = computeAttachPoints(spec);
  const rail = pts.sightRail;

  return [
    { d: `M${rail.x - 12} ${rail.y - 8} L${rail.x + 14} ${rail.y - 10} L${rail.x + 18} ${rail.y + 2} L${rail.x - 8} ${rail.y + 4} Z`, variant: 0 },
    { d: `M${rail.x - 8} ${rail.y - 14} L${rail.x + 8} ${rail.y - 16} L${rail.x + 12} ${rail.y - 4} L${rail.x - 6} ${rail.y - 2} Z`, variant: 1 },
    { d: `M${rail.x - 10} ${rail.y - 5} L${rail.x + 16} ${rail.y - 6} L${rail.x + 20} ${rail.y + 6} L${rail.x - 6} ${rail.y + 8} Z`, variant: 2 },
  ];
}

/**
 * Generate grip variant paths based on grip geometry.
 */
export function gripAttachments(spec: WeaponVisualSpec): Array<{ d: string; variant: number }> {
  const pts = computeAttachPoints(spec);
  const top = pts.gripTop;
  const bottom = pts.gripBottom;

  return [
    { d: `M${top.x - 4} ${top.y} L${top.x + 4} ${top.y} L${bottom.x + 2} ${bottom.y - 6} L${bottom.x - 2} ${bottom.y - 4} Z`, variant: 0 },
    { d: `M${top.x - 6} ${top.y + 2} L${top.x + 6} ${top.y + 2} L${bottom.x + 3} ${bottom.y - 3} L${bottom.x - 3} ${bottom.y - 1} Z`, variant: 1 },
    { d: `M${top.x - 3} ${top.y - 2} L${top.x + 5} ${top.y} L${bottom.x + 2} ${bottom.y - 8} L${bottom.x - 4} ${bottom.y - 6} Z`, variant: 2 },
  ];
}
