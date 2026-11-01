/**
 * The shared visual grammar (visual overhaul brief §5) — ONE language
 * for every action in the game. Every system scene (crafting bench,
 * repair bay, and the scenes owned by later slices: dispatch pad,
 * vendor stall, death/offline reels) composes these six primitives and
 * nothing else, so a player who has read one screen has read them all.
 *
 *  G-1 Loot beam      — rarity-colored pillar at the moment of gain.
 *  G-2 Item card      — one geometry for "you got this", everywhere.
 *  G-3 Progress-cause — every bar names what fills it and what it buys.
 *  G-4 Actor at work  — the hunter rig, posed for the action.
 *  G-5 Set dressing   — the system's set pieces behind the actor.
 *  G-6 Result flash   — success/failure reads in the same two beats.
 */
export const GRAMMAR = {
  /** G-1: beam widths per celebration tier (px at stage scale). */
  beamWidthPx: { standard: 54, high: 84, legendary: 120 },
  /** G-2: the one card geometry. */
  card: { widthPx: 118, borderPx: 2, risePx: 30 },
  /** G-3: progress bar height + the cause label sits above-left. */
  progress: { heightPx: 8, labelGapPx: 4 },
  /** G-6: result flash beats (ms): flash in, hold, out. */
  resultFlash: { inMs: 120, holdMs: 500, outMs: 260 },
  successColor: '#7FB069',
  failureColor: '#E2483D',
  /** Quality reads: crafted quality % tints the result flash edge. */
  qualityEdge: (qualityPct: number): string =>
    qualityPct >= 130 ? '#FFD166' : qualityPct >= 110 ? '#9BE15D' : qualityPct >= 100 ? '#E8E4D8' : '#9a958a',
} as const;

/** G-5 set dressing per system (sprite ids in the pixel manifest). */
export const ACTION_SETS = {
  crafting: ['set-bench-basic', 'set-bench-forge', 'set-refinery-crusher'],
  craftingLab: ['set-bench-lab', 'set-refinery-furnace'],
  repair: ['set-bay-lift', 'set-bay-tray', 'set-bay-wall-listing'],
  dispatch: ['set-dispatch-pad', 'set-dispatch-board', 'set-dispatch-route'],
  extraction: ['set-extract-stakes', 'set-extract-rig', 'set-extract-crates'],
  vendor: ['set-vendor-stall', 'set-vendor-sign'],
  resurrection: ['set-resurrection-pod'],
  warRoom: ['set-war-room-table'],
} as const;

export type ActionSceneKind = keyof typeof ACTION_SETS;
