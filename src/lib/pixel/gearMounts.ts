/**
 * Equipped-gear mounts (Parts System M3, SPEC §6 + skins brief §5.4).
 *
 * Before M3 the equipped-gear reads (shield / relic / pauldron /
 * belt) rendered as DOM chips floated over the actor at fixed frame
 * percentages — presentation siblings of the figure, keyed by slot
 * PRESENCE, in fixed stage spots, blind to pose. M3 hangs them on
 * the parts actor's declared mounts instead:
 *
 *   shield   → the far (support) arm's `shieldMount`
 *   relic    → the torso's `chestMount`
 *   pauldron → the torso's `shoulderMount` (the shoulderExtraN mount)
 *   belt     → the torso's `beltMount`, consumables fanned on the band
 *
 * REAL-ITEM INVARIANT: every mounted read derives from the ACTUAL
 * equipped item instance, keyed per the skins brief's S4 rule set —
 * the shield projects its own behavior glyph tinted by its own
 * element; the relic sigil is framed by its own rarity; the pauldron
 * wears its class mod's tree; belt props are the slotted consumables'
 * own sprites. An unequipped slot mounts nothing, and an item whose
 * mount is absent from the placed set renders nothing — gear never
 * floats at a stock default (the §6 swallow rule).
 *
 * This module is the single mount truth: the DOM actor
 * (PixelPartsActor) and the raster compositor (composePartSet) both
 * resolve mounts through `resolveGearMount`, and both draw from the
 * same MountedGearItem list built by `mountedGearForLoadout`.
 */
import { CONSUMABLES } from '@/constants/consumables';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { shieldBehaviorOf } from '@/lib/combat/shieldBehaviors';
import { elementDialect } from '@/lib/pixel/elementFx';
import type { PaletteSpec } from '@/lib/pixel/paletteSwap';
import type { PartPoint, PartSlot } from '@/lib/pixel/parts';
import type { PartPlacement } from '@/lib/pixel/partsCompositor';
import { Element } from '@/types/game';
import type { ClassMod, Relic, Shield } from '@/types/items';

export type GearMountKind = 'shield' | 'relic' | 'pauldron' | 'belt';

/** One equipped item ready to mount. All sizes are S-REF frame px
 *  (the 260×320 reference frame of SKELETON), matching the footprint
 *  the overlay-era chips rendered at, so the mount swap changes
 *  WHERE gear sits, not how big it reads. */
export interface MountedGearItem {
  kind: GearMountKind;
  /** The sprite the item itself renders with (instance-keyed). */
  spriteId: string;
  /** Rendered width in frame px; height follows the sprite aspect. */
  width: number;
  /** Normalized point inside the gear sprite that sits ON the mount. */
  anchor: PartPoint;
  /** Per-instance palette remap (shield element tint). */
  tint?: PaletteSpec;
  /** Palette cache key for the tinted sprite. */
  tintKey?: string;
  /** Relic rarity frame: stroke color + CSS glow (shared with the
   *  inspect-view rarity frames in weaponVisuals). */
  frameColor?: string;
  frameGlow?: string;
  /** Belt fan: stage-x offset from the band mount (slot-keyed). */
  fanOffsetX?: number;
  testId: string;
  /** Raster layer key in composePartSet output. */
  layerKey: string;
}

/** The mount each gear kind hangs from (SPEC §6). Paint order 8 is
 *  the shoulderExtraN tier — the z the overlay chips rendered at —
 *  and list order within the tier preserves the chips' paint
 *  sequence (shield under relic under pauldron under belt). */
export const GEAR_PAINT_ORDER = 8;

export const GEAR_MOUNT_POINTS: Record<GearMountKind, { slot: PartSlot; mount: string }> = {
  shield: { slot: 'armFar', mount: 'shieldMount' },
  relic: { slot: 'torso', mount: 'chestMount' },
  pauldron: { slot: 'torso', mount: 'shoulderMount' },
  belt: { slot: 'torso', mount: 'beltMount' },
};

export interface ResolvedGearMount {
  /** Stage point (S-REF frame px) the gear's anchor sits on,
   *  including the belt fan offset. */
  stage: PartPoint;
  /** Rotation of the part carrying the mount, in the posed layout. */
  rotationDeg: number;
  slot: PartSlot;
  /** The anchorStages key the mount resolved from, e.g.
   *  `torso:mount:chestMount`. */
  anchorKey: string;
}

/** Resolve an item's mount against a posed part layout. Returns
 *  undefined when the carrying part or its mount is absent — the
 *  swallow rule: the item renders nothing rather than floating. */
export function resolveGearMount(
  layout: {
    anchorStages: Map<string, PartPoint>;
    placements: Partial<Record<PartSlot, PartPlacement>>;
  },
  item: MountedGearItem,
): ResolvedGearMount | undefined {
  const spec = GEAR_MOUNT_POINTS[item.kind];
  const anchorKey = `${spec.slot}:mount:${spec.mount}`;
  const stage = layout.anchorStages.get(anchorKey);
  const placement = layout.placements[spec.slot];
  if (!stage || !placement) return undefined;
  return {
    stage: { x: stage.x + (item.fanOffsetX ?? 0), y: stage.y },
    rotationDeg: placement.rotationDeg,
    slot: spec.slot,
    anchorKey,
  };
}

/* -- Instance keying (skins brief §5, S4 row) -------------------- */

function hexToRgbTuple(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hueOf(hex: string): number {
  const [r, g, b] = hexToRgbTuple(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  if (max === r) return (60 * ((g - b) / d) + 360) % 360;
  if (max === g) return 60 * ((b - r) / d) + 120;
  return 60 * ((r - g) / d) + 240;
}

/** The behavior glyphs render in a deep cyan-blue (~210°). The
 *  shield's element tint rotates that base hue onto the element's
 *  own dialect hue and lays the element's impact color in as the
 *  accent, so a Fire nova shield burns orange and a Void one violet
 *  while the glyph SHAPE still names the behavior. Kinetic (the
 *  neutral element) desaturates toward steel instead. */
const GLYPH_BASE_HUE = 210;

export function shieldElementTint(element: Element): PaletteSpec {
  const dialect = elementDialect(element);
  return {
    hueShiftDeg: Math.round(hueOf(dialect.tracerColor) - GLYPH_BASE_HUE),
    saturationScale: element === Element.Kinetic ? 0.3 : element === Element.Cryo ? 0.7 : 1,
    accent: hexToRgbTuple(dialect.impactColor),
    accentBlend: 0.3,
  };
}

/** The shield read: the equipped shield's own behavior glyph,
 *  tinted by its own element. */
export function shieldGearItem(shield: Shield): MountedGearItem {
  const behavior = shieldBehaviorOf(shield);
  return {
    kind: 'shield',
    spriteId: `glyph-behavior-${behavior}`,
    width: 88.4,
    anchor: { x: 0.5, y: 0.5 },
    tint: shieldElementTint(shield.element),
    tintKey: `shield-${behavior}-${shield.element}`,
    testId: 'pixel-gear-shield',
    layerKey: 'gear:shield',
  };
}

/** The relic read: the sigil, framed by the relic's own rarity
 *  (the same frame colors the inspect view uses). */
export function relicGearItem(relic: Relic): MountedGearItem {
  const frame = RARITY_FRAME_STYLES[relic.rarity];
  return {
    kind: 'relic',
    spriteId: 'gear-relic-sigil',
    width: 52,
    anchor: { x: 0.5, y: 0.5 },
    frameColor: frame.color,
    frameGlow: frame.glow,
    testId: 'pixel-gear-relic',
    layerKey: 'gear:relic',
  };
}

/** The pauldron read: the class mod's own tree sprite (the value
 *  read the Gear screen's class-mod inspect shows). No class mod
 *  equipped → no pauldron. */
export function pauldronGearItem(classMod: ClassMod): MountedGearItem {
  const tree = String(classMod.treeBonus ?? '').toLowerCase();
  const resolved = tree.includes('demolition')
    ? 'demolition'
    : tree.includes('scavenger')
      ? 'scavenger'
      : 'gunslinger';
  return {
    kind: 'pauldron',
    spriteId: `gear-pauldron-${resolved}`,
    width: 67.6,
    anchor: { x: 0.5, y: 0.5 },
    testId: 'pixel-gear-pauldron',
    layerKey: 'gear:pauldron',
  };
}

/** Belt sprite per consumable (overhaul §4.7): specific ids first,
 *  then the family read. Moved here from the diorama in M3 — the
 *  belt is a mount now, and its keying lives with the other mounts. */
const BELT_SPRITES_BY_ID: Record<string, string> = {
  med_kit: 'belt-vial',
  shield_cell: 'belt-cell',
  swarm_grenade: 'belt-swarm',
  combat_stims: 'belt-syringe',
  ammo_box: 'belt-rounds',
  loot_beacon: 'belt-beacon',
  salvage_contract: 'belt-contract',
  data_skimmer: 'belt-scanner',
  magnetized_payload: 'belt-magazine',
};
const BELT_SPRITES_BY_FAMILY: Record<string, string> = {
  survival: 'belt-vial',
  ammo: 'belt-magazine',
  ordnance: 'belt-grenade',
  tactical: 'belt-scanner',
  economy: 'belt-ticket',
  corrupted: 'belt-syringe',
};

export function beltSpriteFor(consumableId: string | null): string | undefined {
  if (!consumableId) return undefined;
  return BELT_SPRITES_BY_ID[consumableId] ?? BELT_SPRITES_BY_FAMILY[CONSUMABLES[consumableId as keyof typeof CONSUMABLES]?.family ?? ''];
}

/** Belt fan spacing in frame px (the overlay row stepped 9% of the
 *  260px frame ≈ 23.4px per prop). The fan is keyed to the PRESENT
 *  props, centered on the band mount — the overlay row compressed
 *  empty slots away the same way. */
export const BELT_FAN_PX = 24;

export function beltGearItems(consumables: (string | null)[]): MountedGearItem[] {
  const present: { spriteId: string; slotIndex: number }[] = [];
  consumables.forEach((consumableId, slotIndex) => {
    const spriteId = beltSpriteFor(consumableId);
    if (spriteId) present.push({ spriteId, slotIndex });
  });
  return present.map(({ spriteId, slotIndex }, presentIndex) => ({
    kind: 'belt',
    spriteId,
    width: 28.6,
    anchor: { x: 0.5, y: 0 },
    fanOffsetX: (presentIndex - (present.length - 1) / 2) * BELT_FAN_PX,
    testId: 'pixel-belt-prop',
    layerKey: `gear:belt-${slotIndex}`,
  }));
}

/** Build the full mounted-gear list from the ACTUAL equipped
 *  instances. Paint sequence within the gear tier matches the
 *  overlay era: shield, relic, pauldron, then belt props. Anything
 *  unequipped is simply absent from the list — and therefore from
 *  the render. */
export function mountedGearForLoadout(input: {
  shield?: Shield;
  relic?: Relic;
  classMod?: ClassMod;
  consumables: (string | null)[];
}): MountedGearItem[] {
  const items: MountedGearItem[] = [];
  if (input.shield) items.push(shieldGearItem(input.shield));
  if (input.relic) items.push(relicGearItem(input.relic));
  if (input.classMod) items.push(pauldronGearItem(input.classMod));
  items.push(...beltGearItems(input.consumables));
  return items;
}
