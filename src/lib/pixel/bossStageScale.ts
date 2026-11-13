/**
 * Per-boss stage scale — stage-iteration program (B1), presentation
 * only. Both boss stages (BossPixiStage and the DOM BossFightStage)
 * consume this table so the two renderers stay in parity.
 *
 * Why per-boss: the boss paintings have wildly different canvas
 * aspects (239×512 up to 849×512) but were all placed at the uniform
 * heightPct 80 / xPct 76. At that size the wide paintings' canvases
 * spanned 62–90% of the stage width, three of them overflowed the
 * right edge outright (up to 130.7%), and six crowded the hunter
 * (canvas left edge under 40% of stage width, hunter anchored at
 * 20%). These initial values are computed from each sprite's canvas
 * aspect + feet anchor so that, at canvas level:
 *   - canvas width ≤ 45% of stage width,
 *   - canvas right edge ≤ 97% of stage width,
 *   - canvas left edge ≥ ~50% of stage width (the silhouette gap to
 *     the hunter, weapon included, is judged from captures; note the
 *     wide paintings' opaque silhouettes measure ≈100% of canvas
 *     width — Group A alpha-bbox measurements, 2026-11-12 — so for
 *     those bosses canvas bounds ≈ silhouette bounds).
 * Narrow paintings keep the legacy 80 — they already satisfy every
 * bound and their figure presence is a capture judgment, not a math
 * one. Values are refined per boss from capture rounds; the round
 * logs live in the stage-iteration program's track B1 files.
 */
export interface BossStagePlacement {
  xPct: number;
  heightPct: number;
}

const DEFAULT_BOSS_PLACEMENT: BossStagePlacement = { xPct: 76, heightPct: 80 };

export const BOSS_STAGE_PLACEMENTS: Record<string, BossStagePlacement> = {
  // Wide paintings — normalized down to the width/edge bounds.
  dune_tyrant: { xPct: 76, heightPct: 40 },
  siltstalker: { xPct: 76, heightPct: 42 },
  heap_guard: { xPct: 76, heightPct: 47 },
  ashgut: { xPct: 76, heightPct: 50 },
  scrap_bishop: { xPct: 76, heightPct: 50 },
  rust_prophet: { xPct: 76, heightPct: 74 },
  // The widest painting on the ladder (849×512): also pulled left —
  // at xPct 76 its right edge lands at 130.7% of stage width no
  // matter the height; xPct 62 keeps the full canvas on stage.
  spinneret_widow: { xPct: 62, heightPct: 35 },
  // Narrow paintings — legacy size already satisfies the bounds.
  mirage_duster: { xPct: 76, heightPct: 80 },
  mnemosyne_mirror: { xPct: 76, heightPct: 80 },
  static_choir: { xPct: 76, heightPct: 80 },
  verdant_maw: { xPct: 76, heightPct: 80 },
  sister_null: { xPct: 76, heightPct: 80 },
  vaultkeeper_omega: { xPct: 76, heightPct: 80 },
};

/** The stage placement for one boss (defaults to the legacy
 *  uniform placement for any boss without a table entry). */
export function bossStagePlacement(bossId: string | undefined): BossStagePlacement {
  if (bossId && BOSS_STAGE_PLACEMENTS[bossId]) return BOSS_STAGE_PLACEMENTS[bossId];
  return DEFAULT_BOSS_PLACEMENT;
}
