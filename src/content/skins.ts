/**
 * Skins & cosmetics — the content catalog (M4, skins brief).
 *
 * The gameplay-side source of truth for cosmetic parts: which sets
 * exist, which parts they contain, what each part's craft recipe is
 * (the recipes themselves live in src/content/crafting.ts — this
 * catalog names them), and the T1 tint palette catalog.
 *
 * The laws this module encodes (owner rulings, 2026-11-02):
 *  - Skins are PURE COSMETIC: zero stats, forever. Nothing in this
 *    module is read by any mechanics snapshot, DPS, or HP path.
 *  - Acquisition is crafting only, scrap-led: recipes simply appear
 *    in the Workshop cosmetic lane (no blueprints, no learn-gating,
 *    no drops); the player market is where crafted parts change
 *    hands. Cache boxes have NO skin tie-in.
 *  - Parts never bind: tradeable/sellable once unequipped, and
 *    listing an equipped part unequips it first (the market wiring
 *    enforces it server-side).
 *  - Manufacturer heads are normal scrap-crafting pool parts;
 *    heads earned via Manufacturer Standing stay wearable through
 *    the grandfather exception (the 0043 rank record).
 *  - Everything is permanently available (no availability windows
 *    in wave 1).
 *
 * Render-side part definitions (sprites + anchors) live in
 * src/lib/pixel/skinParts.ts; this catalog refers to them by id.
 */
import type { PaletteSpec } from '../lib/pixel/paletteSwap';

export type SkinTier = 'palette' | 'repaint' | 'shaped';

/** Slots a cosmetic part can claim. shoulderExtraN is excluded by
 *  design: it is the gear pauldron mount (SPEC §6) — skins never
 *  fight gear for it. */
export type CosmeticSlot =
  | 'back'
  | 'lowerLegB'
  | 'thighB'
  | 'torso'
  | 'armFar'
  | 'thighF'
  | 'lowerLegF'
  | 'head'
  | 'armUpperN'
  | 'armForeN';

export const COSMETIC_SLOTS: CosmeticSlot[] = [
  'head',
  'torso',
  'armUpperN',
  'armForeN',
  'armFar',
  'thighF',
  'thighB',
  'lowerLegF',
  'lowerLegB',
  'back',
];

export function isCosmeticSlot(value: unknown): value is CosmeticSlot {
  return typeof value === 'string' && (COSMETIC_SLOTS as string[]).includes(value);
}

// ─── Sets ────────────────────────────────────────────────────────

export interface SkinSetDef {
  id: string;
  name: string;
  tier: SkinTier;
  blurb: string;
}

export const SKIN_SETS: SkinSetDef[] = [
  {
    id: 'bulwark',
    name: 'Bulwark',
    tier: 'shaped',
    blurb: 'Heavy plate, shaped new: an oversized helm, a siege torso, and Stomper legs. The silhouette is the statement.',
  },
  {
    id: 'dreadplate',
    name: 'Dreadplate',
    tier: 'repaint',
    blurb: 'Standard Issue silhouettes repainted in bone plate and crimson trim, with a red visor glow.',
  },
  {
    id: 'manufacturer',
    name: 'Manufacturer Heads',
    tier: 'shaped',
    blurb: 'The six manufacturer helmets, crafted like everything else. Standing-earned heads stay wearable.',
  },
];

export function skinSetById(setId: string): SkinSetDef | undefined {
  return SKIN_SETS.find((s) => s.id === setId);
}

// ─── Parts ───────────────────────────────────────────────────────

export interface SkinPartCatalogDef {
  /** Part id — the key into SKIN_PART_DEFS (render side). */
  id: string;
  name: string;
  setId: string;
  slot: CosmeticSlot;
  tier: SkinTier;
  /** The Workshop recipe that crafts this part. */
  recipeId: string;
  /** Manufacturer head parts: the head-variant id this part wears
   *  as, and the manufacturer whose standing record grandfathers it. */
  headVariantId?: string;
  manufacturer?: string;
}

function part(
  id: string,
  name: string,
  setId: string,
  slot: CosmeticSlot,
  tier: SkinTier,
  extra?: { headVariantId?: string; manufacturer?: string },
): SkinPartCatalogDef {
  return { id, name, setId, slot, tier, recipeId: `recipe_skin_${id.replace(/-/g, '_')}`, ...extra };
}

export const SKIN_PARTS: SkinPartCatalogDef[] = [
  // Bulwark (T3 shaped — full set, every slot)
  part('bulwark-head', 'Bulwark Helm', 'bulwark', 'head', 'shaped'),
  part('bulwark-torso', 'Bulwark Siege Torso', 'bulwark', 'torso', 'shaped'),
  part('bulwark-arm-upper-n', 'Bulwark Pauldron Arm', 'bulwark', 'armUpperN', 'shaped'),
  part('bulwark-arm-fore-n', 'Bulwark Gauntlet', 'bulwark', 'armForeN', 'shaped'),
  part('bulwark-arm-far', 'Bulwark Support Arm', 'bulwark', 'armFar', 'shaped'),
  part('bulwark-thigh-f', 'Bulwark Thigh (Near)', 'bulwark', 'thighF', 'shaped'),
  part('bulwark-thigh-b', 'Bulwark Thigh (Far)', 'bulwark', 'thighB', 'shaped'),
  part('bulwark-lower-leg-f', 'Stomper Leg (Near)', 'bulwark', 'lowerLegF', 'shaped'),
  part('bulwark-lower-leg-b', 'Stomper Leg (Far)', 'bulwark', 'lowerLegB', 'shaped'),
  part('bulwark-back', 'Packmaster Tank', 'bulwark', 'back', 'shaped'),
  // Dreadplate (T2 repaint — full set, every slot)
  part('dread-head', 'Dreadplate Helm', 'dreadplate', 'head', 'repaint'),
  part('dread-torso', 'Dreadplate Torso', 'dreadplate', 'torso', 'repaint'),
  part('dread-arm-upper-n', 'Dreadplate Upper Arm', 'dreadplate', 'armUpperN', 'repaint'),
  part('dread-arm-fore-n', 'Dreadplate Forearm', 'dreadplate', 'armForeN', 'repaint'),
  part('dread-arm-far', 'Dreadplate Support Arm', 'dreadplate', 'armFar', 'repaint'),
  part('dread-thigh-f', 'Dreadplate Thigh (Near)', 'dreadplate', 'thighF', 'repaint'),
  part('dread-thigh-b', 'Dreadplate Thigh (Far)', 'dreadplate', 'thighB', 'repaint'),
  part('dread-lower-leg-f', 'Dreadplate Lower Leg (Near)', 'dreadplate', 'lowerLegF', 'repaint'),
  part('dread-lower-leg-b', 'Dreadplate Lower Leg (Far)', 'dreadplate', 'lowerLegB', 'repaint'),
  part('dread-back', 'Dreadplate Back Rig', 'dreadplate', 'back', 'repaint'),
  // Manufacturer heads (normal scrap-crafting pool, brief §0.6)
  part('mfr-head-redline', 'Redline Helm', 'manufacturer', 'head', 'shaped', {
    headVariantId: 'mfr-redline',
    manufacturer: 'Redline',
  }),
  part('mfr-head-ironwood', 'Ironwood Helm', 'manufacturer', 'head', 'shaped', {
    headVariantId: 'mfr-ironwood',
    manufacturer: 'Ironwood',
  }),
  part('mfr-head-blastforge', 'BlastForge Helm', 'manufacturer', 'head', 'shaped', {
    headVariantId: 'mfr-blastforge',
    manufacturer: 'BlastForge',
  }),
  part('mfr-head-prismatek', 'Prismatek Helm', 'manufacturer', 'head', 'shaped', {
    headVariantId: 'mfr-prismatek',
    manufacturer: 'Prismatek',
  }),
  part('mfr-head-throwtech', 'ThrowTech Helm', 'manufacturer', 'head', 'shaped', {
    headVariantId: 'mfr-throwtech',
    manufacturer: 'ThrowTech',
  }),
  part('mfr-head-helixworks', 'HelixWorks Helm', 'manufacturer', 'head', 'shaped', {
    headVariantId: 'mfr-helixworks',
    manufacturer: 'HelixWorks',
  }),
];

/** Manufacturer head-variant picks → the manufacturer whose
 *  Standing rank-3 grants the pick (the grandfather rule). The
 *  variant ids are the head-variant catalog's (lib/pixel/headParts);
 *  the crafted head PARTS above carry the same mapping per part. */
export const HEAD_VARIANT_MANUFACTURERS: Record<string, string> = {
  'mfr-redline': 'Redline',
  'mfr-ironwood': 'Ironwood',
  'mfr-blastforge': 'BlastForge',
  'mfr-prismatek': 'Prismatek',
  'mfr-throwtech': 'ThrowTech',
  'mfr-helixworks': 'HelixWorks',
};

/** The head variants anyone may pick (no entitlement needed). */
export const FREE_HEAD_VARIANTS: readonly string[] = ['visor', 'optic', 'hood', 'fin'];

const PART_BY_ID = new Map(SKIN_PARTS.map((p) => [p.id, p]));

export function skinPartCatalog(partId: string): SkinPartCatalogDef | undefined {
  return PART_BY_ID.get(partId);
}

export function skinPartsForSet(setId: string): SkinPartCatalogDef[] {
  return SKIN_PARTS.filter((p) => p.setId === setId);
}

// ─── T1 tint palettes ────────────────────────────────────────────

export interface TintPaletteDef {
  id: string;
  name: string;
  spec: PaletteSpec;
  /** Starter tints: free of the Chromaweave input (brief §6.2 —
   *  a new player can personalize on day one). */
  starter: boolean;
  /** Chromaweave consumed by a tint craft with this palette. */
  chromaweave: number;
}

export const TINT_PALETTES: TintPaletteDef[] = [
  {
    id: 'arctic',
    name: 'Arctic',
    spec: { hueShiftDeg: -12, saturationScale: 0.5, accent: [205, 232, 255], accentBlend: 0.35 },
    starter: true,
    chromaweave: 0,
  },
  {
    id: 'void',
    name: 'Void',
    spec: { hueShiftDeg: 48, saturationScale: 1.1, accent: [158, 92, 255], accentBlend: 0.3 },
    starter: true,
    chromaweave: 0,
  },
  {
    id: 'crimson',
    name: 'Crimson',
    spec: { hueShiftDeg: 128, saturationScale: 1.05, accent: [255, 96, 84], accentBlend: 0.25 },
    starter: false,
    chromaweave: 1,
  },
  {
    id: 'verdant',
    name: 'Verdant',
    spec: { hueShiftDeg: -118, saturationScale: 0.95, accent: [146, 255, 172], accentBlend: 0.25 },
    starter: false,
    chromaweave: 1,
  },
  {
    id: 'solar',
    name: 'Solar',
    spec: { hueShiftDeg: -158, saturationScale: 1.0, accent: [255, 202, 92], accentBlend: 0.3 },
    starter: false,
    chromaweave: 1,
  },
  {
    id: 'abyss',
    name: 'Abyss',
    spec: { hueShiftDeg: 16, saturationScale: 0.62, accent: [64, 200, 220], accentBlend: 0.2 },
    starter: false,
    chromaweave: 1,
  },
  {
    id: 'royal',
    name: 'Royal',
    spec: { hueShiftDeg: 62, saturationScale: 0.9, accent: [255, 214, 120], accentBlend: 0.28 },
    starter: false,
    chromaweave: 1,
  },
];

const TINT_BY_ID = new Map(TINT_PALETTES.map((t) => [t.id, t]));

export function tintPaletteById(id: string | null | undefined): TintPaletteDef | undefined {
  return id ? TINT_BY_ID.get(id) : undefined;
}

// ─── Finish (craft quality, expressed cosmetically) ──────────────

/** A crafted part's quality roll maps to a FINISH tier (brief
 *  §6.5): worn / standard / pristine, rendered through the palette
 *  path. Finish is the master crafter's moat — visible, priced by
 *  the market, and zero-stats like everything cosmetic. */
export type FinishTier = 'worn' | 'standard' | 'pristine';

export function finishTierForQuality(quality: number): FinishTier {
  if (quality >= 85) return 'pristine';
  if (quality < 55) return 'worn';
  return 'standard';
}

export const FINISH_LABELS: Record<FinishTier, string> = {
  worn: 'Worn finish',
  standard: 'Standard finish',
  pristine: 'Pristine finish',
};

/** The palette a part actually renders with: its tint (if any)
 *  adjusted by its finish. Returns null when no swap applies
 *  (untinted + standard finish — the base art). */
export function effectivePartPalette(
  tintPaletteId: string | null | undefined,
  quality: number,
): { paletteId: string; spec: PaletteSpec } | null {
  const tint = tintPaletteById(tintPaletteId);
  const finish = finishTierForQuality(quality);
  if (!tint && finish === 'standard') return null;
  const base: PaletteSpec = tint
    ? tint.spec
    : { hueShiftDeg: 0, saturationScale: 1, accent: [255, 240, 210], accentBlend: 0 };
  const spec: PaletteSpec = {
    hueShiftDeg: base.hueShiftDeg,
    saturationScale:
      base.saturationScale * (finish === 'worn' ? 0.55 : finish === 'pristine' ? 1.15 : 1),
    accent: base.accent,
    accentBlend:
      finish === 'pristine' ? Math.max(base.accentBlend, 0.22) : finish === 'worn' ? 0 : base.accentBlend,
  };
  return { paletteId: `${tint?.id ?? 'base'}:${finish}`, spec };
}

// ─── Craft quality roll (cosmetic branch, both stores) ───────────

/** Cosmetic craft quality: the roll a completed cosmetic unit
 *  stamps on the part it produces. Defined once here; the SQL
 *  completion branch (migration 0053) and the TS craft engine
 *  implement this exact formula:
 *    roll = clamp( round( (LO + u * (HI - LO)) * benchFactor * toolMult ) + shift, 1, 100 )
 *  with HI widened by cosmetic mastery (the consumable pattern:
 *  mastery makes top finishes reachable, never guaranteed). */
export const COSMETIC_QUALITY = {
  baseMin: 35,
  baseMax: 95,
  masteryMaxBonusPerLevel: 0.3,
  masteryMaxBonusCap: 15,
} as const;

export function rollCosmeticQuality(args: {
  random01: number;
  bench: number;
  toolQualityMultiplier: number;
  shift: number;
  masteryLevel: number;
}): number {
  const hi =
    COSMETIC_QUALITY.baseMax +
    Math.min(
      COSMETIC_QUALITY.masteryMaxBonusCap,
      COSMETIC_QUALITY.masteryMaxBonusPerLevel * Math.max(0, args.masteryLevel),
    );
  const benchFactor = args.bench === 3 ? 1.1 : args.bench === 2 ? 1.05 : 1.0;
  const raw =
    (COSMETIC_QUALITY.baseMin + args.random01 * (hi - COSMETIC_QUALITY.baseMin)) *
    benchFactor *
    args.toolQualityMultiplier;
  return Math.max(1, Math.min(100, Math.round(raw) + args.shift));
}

// ─── Item payload + shared views ─────────────────────────────────

/** The item_instances payload of a cosmetic part item. Written by
 *  the craft finalizers (server), read by every render surface.
 *  `quality` is the finish roll; `tintPaletteId` is set by tint
 *  crafts. There are deliberately NO stat fields — a cosmetic part
 *  has nothing for a mechanics path to read. */
export interface CosmeticPartPayload {
  name: string;
  partId: string;
  slot: CosmeticSlot;
  setId: string;
  tier: SkinTier;
  quality: number;
  tintPaletteId: string | null;
  origin: 'crafted';
  craftedBy: string;
}

/** Build the payload for a freshly crafted part (the finalizers'
 *  one constructor — Pg and InMemory stamp identical payloads). */
export function buildCosmeticPartPayload(
  partId: string,
  quality: number,
  craftedBy: string,
): CosmeticPartPayload | null {
  const part = skinPartCatalog(partId);
  if (!part) return null;
  return {
    name: part.name,
    partId: part.id,
    slot: part.slot,
    setId: part.setId,
    tier: part.tier,
    quality,
    tintPaletteId: null,
    origin: 'crafted',
    craftedBy,
  };
}

export function isCosmeticPartPayload(value: unknown): value is CosmeticPartPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.partId === 'string' &&
    typeof p.slot === 'string' &&
    typeof p.quality === 'number' &&
    !!PART_BY_ID.has(p.partId as string)
  );
}

export function buildCosmeticPayload(partId: string, quality: number, craftedBy: string): CosmeticPartPayload {
  const def = PART_BY_ID.get(partId);
  if (!def) throw new Error(`Unknown skin part: ${partId}`);
  return {
    name: def.name,
    partId: def.id,
    slot: def.slot,
    setId: def.setId,
    tier: def.tier,
    quality,
    tintPaletteId: null,
    origin: 'crafted',
    craftedBy,
  };
}

/** One owned cosmetic part as the API carries it. */
export interface CosmeticPartItemView {
  id: string;
  partId: string;
  slot: CosmeticSlot;
  setId: string;
  tier: SkinTier;
  name: string;
  quality: number;
  tintPaletteId: string | null;
  runtimeState: string;
}

/** The player's cosmetic selection (server record): per-slot
 *  equipped part ITEM ids + the head-variant pick used when no head
 *  part is equipped. */
export interface CosmeticSelection {
  equipped: Partial<Record<CosmeticSlot, string>>;
  headVariant: string;
}

export interface CosmeticsStateView {
  selection: CosmeticSelection;
  /** False until the player has any server selection record (the
   *  client then offers its device-local head pick once). */
  selectionExists: boolean;
  parts: CosmeticPartItemView[];
  /** Head-variant ids wearable WITHOUT holding the crafted part:
   *  the four free variants + grandfathered manufacturer variants
   *  (standing rank ≥ 3, the 0043 record). */
  wearableVariantIds: string[];
}

/** Another hunter's look, as public surfaces (Standings) read it:
 *  part ids + tints by slot — facts only, resolved to sprites
 *  client-side. */
export interface HunterLookView {
  playerId: string;
  username: string | null;
  headVariant: string;
  parts: Partial<Record<CosmeticSlot, { partId: string; tintPaletteId: string | null; quality: number }>>;
}

export const DEFAULT_HEAD_VARIANT = 'visor';
