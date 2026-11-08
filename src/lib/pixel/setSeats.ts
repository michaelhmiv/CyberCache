/**
 * Set-piece seats (Full Visual Program V2, authored 2026-11-07;
 * landed 2026-11-08) — where an item sits on a set piece, declared
 * as data keyed by sprite id (flexibility law, 2026-11-06: a future
 * set piece plugs in by adding a row, never by editing scene code).
 *
 * The seat fractions are the authoring pass's measured record
 * (cybercache.set-seats/v1): the point is a fraction of the sprite's
 * own box, so it is resolution-independent and survives re-renders
 * of the piece at any display height. `seat: null` rows are
 * deliberate — the piece is not a work surface, and the record says
 * why, so no future slice invents a seat for it.
 *
 * Which rows describe the SHIPPED art matters: the seven non-bench
 * pieces below are the V2-authored sprites themselves (landed
 * 2026-11-08). The three bench rows describe the V2-authored bench
 * canvases, which were SUPERSEDED for landing by PR #447's own
 * bench build at the legacy canvas sizes — the shipped benches keep
 * the work points #447 tuned for them, and these rows stand as the
 * record of the authored benches, not as live geometry. Consumers
 * must only derive geometry from a row whose art actually shipped:
 * today that is `set-refinery-crusher`, `set-refinery-furnace`,
 * `set-bay-lift`, `set-calibration-rig`, `set-bay-tray`,
 * `set-bay-wall-listing`, and `set-vendor-stall`.
 */

export interface SetSeat {
  /** How the seated render meets the point: its bottom-center
   *  stands on it, or its center floats on it (the ring). */
  anchor: 'bottom-center' | 'center';
  /** Seat point as fractions of the sprite's box (x right, y down
   *  from the sprite's top-left). */
  point: { x: number; y: number };
  /** Rect kept free of props in the authoring, as fractions. */
  clearZone: { x: number; y: number; w: number; h: number };
  /** Largest item footprint the clear zone holds, authored px. */
  maxItemPx: { w: number; h: number };
  /** What the surface is, in the authoring record's words. */
  surface: string;
}

export interface SetSeatRecord {
  seat: SetSeat | null;
  /** Why there is no seat — present exactly when `seat` is null. */
  nullReason?: string;
  /** The work-cycle family that works this piece, if any. */
  workCycleSpec: string | null;
}

export const SET_SEATS: Record<string, SetSeatRecord> = {
  'set-bench-forge': {
    seat: {
      anchor: 'bottom-center',
      point: { x: 0.491, y: 0.329 },
      clearZone: { x: 0.287, y: 0, w: 0.417, h: 0.329 },
      maxItemPx: { w: 44, h: 44 },
      surface: 'bench top slab, top face',
    },
    workCycleSpec: 'forge',
  },
  'set-bench-basic': {
    seat: {
      anchor: 'bottom-center',
      point: { x: 0.509, y: 0.378 },
      clearZone: { x: 0.287, y: 0, w: 0.454, h: 0.378 },
      maxItemPx: { w: 48, h: 48 },
      surface: 'wooden top slab, top face',
    },
    workCycleSpec: 'forge',
  },
  'set-bench-lab': {
    seat: {
      anchor: 'bottom-center',
      point: { x: 0.5, y: 0.378 },
      clearZone: { x: 0.306, y: 0, w: 0.389, h: 0.378 },
      maxItemPx: { w: 42, h: 48 },
      surface: 'steel top slab, top face',
    },
    workCycleSpec: 'forge',
  },
  'set-refinery-crusher': {
    seat: {
      anchor: 'bottom-center',
      point: { x: 0.5, y: 0.132 },
      clearZone: { x: 0.323, y: 0, w: 0.365, h: 0.132 },
      maxItemPx: { w: 30, h: 40 },
      surface: 'crusher mouth rim — the item being salvaged rests in the V, base at the rim line',
    },
    workCycleSpec: 'crush',
  },
  'set-refinery-furnace': {
    seat: null,
    nullReason:
      'A heat source, not a work surface: refining inputs go inside it and are never displayed on it. Declaring a seat here would invite floating an item on a furnace.',
    workCycleSpec: 'forge',
  },
  'set-bay-lift': {
    seat: {
      anchor: 'bottom-center',
      point: { x: 0.5, y: 0.609 },
      clearZone: { x: 0.112, y: 0.241, w: 0.784, h: 0.368 },
      maxItemPx: { w: 90, h: 60 },
      surface: 'lift deck, top face',
    },
    workCycleSpec: 'assembly',
  },
  'set-calibration-rig': {
    seat: {
      anchor: 'center',
      point: { x: 0.5, y: 0.494 },
      clearZone: { x: 0.35, y: 0.322, w: 0.3, h: 0.345 },
      maxItemPx: { w: 30, h: 30 },
      surface: 'emitter ring center — the shield under calibration floats here',
    },
    workCycleSpec: 'calibration',
  },
  'set-bay-tray': {
    seat: {
      anchor: 'bottom-center',
      point: { x: 0.5, y: 0.694 },
      clearZone: { x: 0.298, y: 0, w: 0.417, h: 0.694 },
      maxItemPx: { w: 34, h: 34 },
      surface: 'tray bed floor',
    },
    workCycleSpec: 'assembly',
  },
  'set-bay-wall-listing': {
    seat: null,
    nullReason:
      'A wall board: information surface, not a work surface. Nothing is ever placed on it; no scene consumes a seat for it.',
    workCycleSpec: null,
  },
  'set-vendor-stall': {
    seat: {
      anchor: 'bottom-center',
      point: { x: 0.49, y: 0.574 },
      clearZone: { x: 0.26, y: 0.221, w: 0.471, h: 0.353 },
      maxItemPx: { w: 48, h: 40 },
      surface: 'stall counter, top face',
    },
    workCycleSpec: null,
  },
};

/** The seat for a piece that must have one — the requirePixelSprite
 *  pattern: a scene deriving geometry from a seat treats a missing
 *  or null seat as a data bug, not a render state. */
export function requireSetSeat(spriteId: string): SetSeat {
  const record = SET_SEATS[spriteId];
  if (!record || !record.seat) {
    throw new Error(`set seat missing or seatless for sprite: ${spriteId}`);
  }
  return record.seat;
}

/**
 * The stage-space Y (as a % from the stage top) of a set piece's
 * seat point, for a piece standing on `groundY` (fraction) at
 * `heightPct` (% of stage height). Pure height-fraction math: a
 * sprite's box top sits at groundY − height, and the seat rides at
 * the seat fraction of the box — no stage-aspect term exists in
 * the vertical, so this is exact, not an eyeball.
 */
export function seatPointTopPct(seat: SetSeat, heightPct: number, groundY: number): number {
  return (groundY - (heightPct / 100) * (1 - seat.point.y)) * 100;
}

/** The CSS `bottom` % that lands a render's base exactly on the
 *  seat point of a piece standing on `groundY` at `heightPct` —
 *  the seatPointTopPct read from the stage's bottom edge. */
export function seatPointBottomPct(seat: SetSeat, heightPct: number, groundY: number): number {
  return 100 - seatPointTopPct(seat, heightPct, groundY);
}
