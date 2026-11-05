import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { requirePixelSprite } from '@/lib/pixel/manifest';
import { MOVEMENT } from '@/lib/pixel/movement';
import {
  PART_POSES,
  PART_SLOTS,
  PARTS_FEET_X,
  PRIMARY_ANCHOR,
  SKELETON,
  WEAPON_PAINT_ORDER,
  type PartSetDef,
  type PartsPoseName,
} from '@/lib/pixel/parts';
import { layoutPartSet } from '@/lib/pixel/partsCompositor';
import { GEAR_PAINT_ORDER, resolveGearMount, type MountedGearItem } from '@/lib/pixel/gearMounts';
import {
  armedActorExtents,
  fitArmedActorHeight,
  fitDollActorHeight,
  partsWeaponFractionsFor,
  type ArmedActorFit,
  type DollActorFit,
} from '@/lib/pixel/partsStage';
import {
  pixelWeaponInputFromWeapon,
  type PixelWeaponInput,
} from '@/lib/pixel/weaponCompositor';
import { paletteSpriteUrl, type PaletteSpec } from '@/lib/pixel/paletteSwap';
import type { Weapon } from '@/types/items';
import { PixelSway } from './PixelFx';
import { PixelWeapon } from './PixelWeapon';

interface PixelPartsActorProps {
  /** The part set to wear (Standard Issue + the player's head part). */
  set: PartSetDef;
  /** Stage position of the actor's feet anchor, as % of stage width. */
  xPct: number;
  /** Actor height as % of stage height. */
  heightPct: number;
  groundY: number;
  /** Feet anchor x as a fraction of the S-REF frame width. */
  feetX?: number;
  flip?: boolean;
  zIndex?: number;
  reduced?: boolean;
  /** Current pose; transitions run on SEGMENT timings. */
  pose: PartsPoseName;
  /** Per-part palette swap (async data-URL swaps). */
  palette?: { paletteId: string; spec: PaletteSpec };
  /** Per-SLOT palette swaps (M4): a worn skin part's tint/finish
   *  applies to that part only. Takes precedence over `palette`
   *  for the slots it names. */
  partPalettes?: Partial<Record<import('@/lib/pixel/parts').PartSlot, { paletteId: string; spec: PaletteSpec }>>;
  /** The ACTUAL equipped weapon instance. When present it renders
   *  grip-to-grip between the near upper arm and the forearm (the
   *  compositor's paint order) — the hand wraps the grip. When
   *  absent the hunter is unarmed: no weapon layer exists at all,
   *  and callers pose him 'relaxed' (hands at his sides). */
  weapon?: Weapon;
  /** The same, as a compositor input, for surfaces holding an input
   *  rather than an instance. `weapon` wins when both are given. */
  weaponInput?: PixelWeaponInput;
  weaponTestId?: string;
  testId?: string;
  /** Equipped gear to MOUNT on the figure (M3): each item hangs on
   *  the mount its kind declares (gearMounts.ts) and moves/rotates
   *  with the part carrying that mount. Items are keyed from the
   *  ACTUAL equipped instances by the caller; an item whose mount
   *  does not resolve renders nothing. Absent/empty = no gear
   *  layers at all. */
  gear?: MountedGearItem[];
  /** Width-fit law for this surface. 'stage' (default): the armed
   *  width law — shrink until frame + held weapon fit the width;
   *  right for stages, where the weapon's full run is action
   *  information. 'doll': the doll fit (fitDollActorHeight) — the
   *  FRAME fills the width and centers, the weapon crops at the
   *  stage edge like a portrait; for the Gear Loadout doll, whose
   *  subject is the hunter, not the gun's full length. */
  fitMode?: 'stage' | 'doll';
  children?: React.ReactNode;
}

/**
 * The hunter as a PART SET (parts system, SPEC §5) — the only hunter
 * actor since M2 deleted the segmented rig. Every part image is
 * positioned by the shared layout resolver (layoutPartSet): the
 * part's primary anchor lands on its resolved stage point, and pose
 * changes rotate parts around that anchor on SEGMENT timings. The
 * held weapon is a child layer at the compositor's paint order, so
 * the forearm paints over the grip exactly as the raster compositor
 * (and the goldens) draw it.
 */
export const PixelPartsActor: React.FC<PixelPartsActorProps> = ({
  set,
  xPct,
  heightPct,
  groundY,
  feetX = PARTS_FEET_X,
  flip = false,
  zIndex = 10,
  reduced = false,
  pose,
  palette,
  partPalettes,
  weapon,
  weaponInput,
  weaponTestId,
  testId,
  gear,
  fitMode = 'stage',
  children,
}) => {
  const [, setSwapTick] = useState(0);
  // Preload tinted gear sprites (the shield's element tint runs the
  // same async palette-swap cache as the parts); when they land,
  // re-render so the mounted shield picks up the tinted data URL.
  const tintedGear = useMemo(() => (gear ?? []).filter((g) => g.tint && g.tintKey), [gear]);
  useEffect(() => {
    if (tintedGear.length === 0) return;
    let cancelled = false;
    let pending = tintedGear.length;
    for (const item of tintedGear) {
      const sprite = requirePixelSprite(item.spriteId);
      const img = new Image();
      img.onload = () => {
        paletteSpriteUrl(item.spriteId, sprite.url, item.tintKey!, item.tint!);
        pending -= 1;
        if (!cancelled && pending <= 0) setSwapTick((t) => t + 1);
      };
      img.onerror = () => {
        pending -= 1;
      };
      img.src = sprite.url;
    }
    return () => {
      cancelled = true;
    };
  }, [tintedGear]);

  // Preload palette swaps; when they land in the cache, re-render so
  // the parts pick up the swapped data URLs.
  useEffect(() => {
    if (!palette && !partPalettes) return;
    let cancelled = false;
    const jobs: { spriteId: string; paletteId: string; spec: PaletteSpec }[] = [];
    if (palette) {
      for (const { slot } of PART_SLOTS) {
        const spriteId = set.parts[slot]?.spriteId;
        if (spriteId) jobs.push({ spriteId, paletteId: palette.paletteId, spec: palette.spec });
      }
    }
    if (partPalettes) {
      for (const { slot } of PART_SLOTS) {
        const pp = partPalettes[slot];
        const spriteId = set.parts[slot]?.spriteId;
        if (pp && spriteId) jobs.push({ spriteId, paletteId: pp.paletteId, spec: pp.spec });
      }
    }
    let pending = jobs.length;
    if (pending === 0) return;
    for (const job of jobs) {
      const sprite = requirePixelSprite(job.spriteId);
      const img = new Image();
      img.onload = () => {
        paletteSpriteUrl(job.spriteId, sprite.url, job.paletteId, job.spec);
        pending -= 1;
        if (!cancelled && pending <= 0) setSwapTick((t) => t + 1);
      };
      img.onerror = () => {
        pending -= 1;
      };
      img.src = sprite.url;
    }
    return () => {
      cancelled = true;
    };
  }, [palette, partPalettes, set]);

  const heldInput = useMemo<PixelWeaponInput | undefined>(() => {
    if (weapon) return pixelWeaponInputFromWeapon(weapon);
    return weaponInput;
  }, [weapon, weaponInput]);

  const weaponFractions = useMemo(
    () => (heldInput ? partsWeaponFractionsFor(heldInput) : undefined),
    [heldInput],
  );

  const layout = useMemo(
    () => layoutPartSet(set, PART_POSES[pose], weaponFractions),
    [set, pose, weaponFractions],
  );

  // Loadout truth, the width law: an ARMED actor is height-sized
  // and feet-anchored, and the held weapon overhangs the frame's
  // right edge by design — on a stage narrower than the height
  // implies (the Gear-C Loadout column is 152px wide for a ~219px
  // figure) the whole weapon fell outside the stage's clip box and
  // the hunter read as unarmed with a full weapon layer rendered
  // off-stage. When armed, measure the stage box (the actor's
  // parent — every surface mounts the actor directly in its stage)
  // and shrink to fitArmedActorHeight: feet anchor and ground line
  // unmoved, the full frame + weapon inside the width. Unarmed
  // actors never engage the fit (their behavior is byte-identical),
  // and at unconstrained geometries the fit returns the nominal
  // height and nothing changes.
  const frameExtents = useMemo(
    () => (heldInput ? armedActorExtents(layout) : undefined),
    [heldInput, layout],
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [widthFit, setWidthFit] = useState<ArmedActorFit | null>(null);
  useLayoutEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent || !frameExtents) {
      setWidthFit(null);
      return;
    }
    const measure = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (!w || !h) {
        setWidthFit(null);
        return;
      }
      const fit = fitArmedActorHeight({
        containerW: w,
        containerH: h,
        heightPct,
        xPct,
        groundY,
        feetX,
        flip,
        extents: frameExtents,
      });
      setWidthFit(fit.constrained ? fit : null);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [frameExtents, heightPct, xPct, groundY, feetX, flip]);

  // The doll fit (fitMode 'doll' — the Gear Loadout stage): size
  // to the FRAME, not the armed extent. Weapon-independent, so it
  // measures on the same ResizeObserver pattern whether the hunter
  // is armed or not, and equipping a weapon never resizes him.
  // Inert on stage surfaces: the default mode never enters here,
  // and the width-law effect above is untouched.
  const [measuredDollFit, setMeasuredDollFit] = useState<DollActorFit | null>(null);
  useLayoutEffect(() => {
    if (fitMode !== 'doll') return;
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (!w || !h) {
        setMeasuredDollFit(null);
        return;
      }
      const fit = fitDollActorHeight({
        containerW: w,
        containerH: h,
        heightPct,
        groundY,
        feetX,
      });
      setMeasuredDollFit(fit.constrained ? fit : null);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [fitMode, heightPct, groundY, feetX]);
  // The measured fit only exists in doll mode (the effect above
  // never runs otherwise); deriving at render keeps the value
  // honest if the mode prop ever changes on a mounted actor.
  const dollFit = fitMode === 'doll' ? measuredDollFit : null;

  const parts = useMemo(
    () =>
      PART_SLOTS.flatMap(({ slot, paintOrder }) => {
        const placement = layout.placements[slot];
        if (!placement) return [];
        const { part, anchorStage, rotationDeg } = placement;
        const sprite = requirePixelSprite(part.spriteId);
        const slotPalette = partPalettes?.[slot];
        const src = slotPalette
          ? paletteSpriteUrl(part.spriteId, sprite.url, slotPalette.paletteId, slotPalette.spec)
          : palette
            ? paletteSpriteUrl(part.spriteId, sprite.url, palette.paletteId, palette.spec)
            : sprite.url;
        const primaryLocal = part.anchors[PRIMARY_ANCHOR[slot]];
        const isArm = slot === 'armUpperN' || slot === 'armForeN' || slot === 'armFar';
        const duration = reduced
          ? 0
          : (isArm
              ? MOVEMENT.SEGMENT.ARM_RAISE_MS
              : slot === 'head'
                ? MOVEMENT.SEGMENT.HEAD_TRACK_MS
                : MOVEMENT.SEGMENT.STEP_BOB_MS) / 1000;
        return [
          {
            slot,
            src,
            paintOrder,
            duration,
            rotationDeg,
            leftPct: ((anchorStage.x - primaryLocal.x) / SKELETON.frameWidth) * 100,
            topPct: ((anchorStage.y - primaryLocal.y) / SKELETON.frameHeight) * 100,
            widthPct: (part.width / SKELETON.frameWidth) * 100,
            heightPct: (part.height / SKELETON.frameHeight) * 100,
            originXPct: (primaryLocal.x / part.width) * 100,
            originYPct: (primaryLocal.y / part.height) * 100,
          },
        ];
      }),
    [layout, palette, partPalettes, reduced],
  );

  // Mounted gear (M3): every item resolves against THIS actor's
  // own layout — the same resolveGearMount the raster compositor
  // uses — so the DOM figure and the raster render hang gear on
  // identical stage points, rotating with the mounting part on
  // that part's SEGMENT timing.
  const gearLayers = useMemo(
    () =>
      (gear ?? []).flatMap((item) => {
        const mount = resolveGearMount(layout, item);
        if (!mount) return [];
        const sprite = requirePixelSprite(item.spriteId);
        const src = item.tint
          ? paletteSpriteUrl(item.spriteId, sprite.url, item.tintKey!, item.tint)
          : sprite.url;
        const targetW = item.width;
        const targetH = (item.width * sprite.height) / sprite.width;
        const isArm = mount.slot === 'armFar' || mount.slot === 'armUpperN' || mount.slot === 'armForeN';
        const duration = reduced
          ? 0
          : (isArm ? MOVEMENT.SEGMENT.ARM_RAISE_MS : MOVEMENT.SEGMENT.STEP_BOB_MS) / 1000;
        return [
          {
            key: item.layerKey,
            kind: item.kind,
            testId: item.testId,
            mountKey: mount.anchorKey,
            spriteId: item.spriteId,
            src,
            duration,
            rotationDeg: mount.rotationDeg,
            leftPct: ((mount.stage.x - item.anchor.x * targetW) / SKELETON.frameWidth) * 100,
            topPct: ((mount.stage.y - item.anchor.y * targetH) / SKELETON.frameHeight) * 100,
            widthPct: (targetW / SKELETON.frameWidth) * 100,
            heightPct: (targetH / SKELETON.frameHeight) * 100,
            originXPct: item.anchor.x * 100,
            originYPct: item.anchor.y * 100,
            boxShadow: item.frameColor
              ? `inset 0 0 0 2px ${item.frameColor}${item.frameGlow && item.frameGlow !== 'none' ? `, ${item.frameGlow}` : ''}`
              : undefined,
          },
        ];
      }),
    [gear, layout, reduced],
  );

  const weaponBox = layout.weapon
    ? {
        widthPct: (layout.weapon.targetW / SKELETON.frameWidth) * 100,
        heightPct: (layout.weapon.targetH / SKELETON.frameHeight) * 100,
        leftPct:
          (layout.weapon.gripStage.x / SKELETON.frameWidth) * 100 -
          layout.weapon.gripFrac.x * ((layout.weapon.targetW / SKELETON.frameWidth) * 100),
        topPct:
          (layout.weapon.gripStage.y / SKELETON.frameHeight) * 100 -
          layout.weapon.gripFrac.y * ((layout.weapon.targetH / SKELETON.frameHeight) * 100),
      }
    : undefined;

  return (
    <div
      ref={rootRef}
      className="absolute"
      data-testid={testId}
      data-rig={set.id}
      data-armed={heldInput ? 'true' : 'false'}
      data-fit={dollFit ? 'doll' : widthFit ? 'width' : undefined}
      style={
        dollFit
          ? {
              height: `${dollFit.heightPx}px`,
              aspectRatio: `${SKELETON.frameWidth} / ${SKELETON.frameHeight}`,
              left: `${dollFit.leftPct}%`,
              top: `${dollFit.topPx}px`,
              zIndex,
            }
          : widthFit
            ? {
                height: `${widthFit.heightPx}px`,
                aspectRatio: `${SKELETON.frameWidth} / ${SKELETON.frameHeight}`,
                left: `${xPct}%`,
                top: `${widthFit.topPx}px`,
                zIndex,
              }
            : {
              height: `${heightPct}%`,
              aspectRatio: `${SKELETON.frameWidth} / ${SKELETON.frameHeight}`,
              left: `${xPct}%`,
              top: `calc(${groundY * 100}% - ${heightPct}%)`,
              zIndex,
            }
      }
    >
      <div
        className="relative h-full w-full"
        style={{ transform: `translateX(${-feetX * 100}%) ${flip ? 'scaleX(-1)' : ''}` }}
      >
        {parts.map((p) => (
          <motion.img
            key={p.slot}
            src={p.src}
            alt=""
            draggable={false}
            data-part={p.slot}
            className="pointer-events-none absolute"
            style={{
              left: `${p.leftPct}%`,
              top: `${p.topPct}%`,
              width: `${p.widthPct}%`,
              height: `${p.heightPct}%`,
              imageRendering: 'pixelated',
              zIndex: p.paintOrder,
              transformOrigin: `${p.originXPct}% ${p.originYPct}%`,
            }}
            initial={false}
            animate={{ rotate: p.rotationDeg }}
            transition={{ duration: p.duration, ease: 'easeOut' }}
          />
        ))}
        {gearLayers.map((g) => (
          <motion.img
            key={g.key}
            src={g.src}
            alt=""
            draggable={false}
            data-testid={g.testId}
            data-gear-kind={g.kind}
            data-gear-mount={g.mountKey}
            data-gear-sprite={g.spriteId}
            className="pointer-events-none absolute"
            style={{
              left: `${g.leftPct}%`,
              top: `${g.topPct}%`,
              width: `${g.widthPct}%`,
              height: `${g.heightPct}%`,
              imageRendering: 'pixelated',
              zIndex: GEAR_PAINT_ORDER,
              transformOrigin: `${g.originXPct}% ${g.originYPct}%`,
              boxShadow: g.boxShadow,
            }}
            initial={false}
            animate={{ rotate: g.rotationDeg }}
            transition={{ duration: g.duration, ease: 'easeOut' }}
          />
        ))}
        {heldInput && weaponBox && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: `${weaponBox.leftPct}%`,
              top: `${weaponBox.topPct}%`,
              width: `${weaponBox.widthPct}%`,
              transform: 'rotate(-3deg)',
              zIndex: WEAPON_PAINT_ORDER,
            }}
          >
            <PixelSway reduced={reduced}>
              <PixelWeapon weapon={weapon} input={weapon ? undefined : weaponInput} fluid testId={weaponTestId} />
            </PixelSway>
          </div>
        )}
        {children}
      </div>
    </div>
  );
};
