import React, { useEffect, useMemo, useRef } from 'react';
import type { GearItem } from '@/types/items';
import {
  bespokeSpriteIdForGear,
  composeGearCached,
  defaultGearInput,
  paintGear,
  type GearComposeInput,
  type GearDensity,
  type GearGrammar,
} from '@/lib/pixel/gearCardCompositor';
import { getPixelSprite } from '@/lib/pixel/manifest';

/**
 * PixelGear — renders a non-weapon gear item as pixel art through
 * the shared plate engine (src/lib/pixel/gearCardCompositor.ts),
 * the sibling of PixelWeapon for the gear kinds.
 *
 * - Bespoke resolution FIRST: a named item with registered bespoke
 *   art renders its fixed sprite instead of a grammar composition
 *   (the weapons' legendary pattern). No bespoke gear art exists
 *   yet — the registry is empty — but the order is structural, so
 *   a future named shield/relic can never be shadowed by grammar.
 * - Otherwise the item's kind grammar composes deterministically
 *   from the record itself; the render is cached module-wide by
 *   signature, so lists never repaint texels.
 * - `density`: 'card' (the kind's logical plate, e.g. 240×140) or
 *   'thumb' (quarter grid, detail level 0 — a composed bold
 *   silhouette, NOT a downscale of the card render).
 */

const CARD_PAINT_SCALE = 2;
const THUMB_PAINT_SCALE = 4;

interface PixelGearProps {
  item?: GearItem;
  input?: GearComposeInput;
  grammar: GearGrammar;
  /** Display width in CSS px; height follows the plate aspect. */
  size?: number;
  /** Fill the parent width (height follows aspect). */
  fluid?: boolean;
  className?: string;
  testId?: string;
  density?: GearDensity;
  /** Test seam: a bespoke registry override (production uses the
   *  core registry, which is empty until named gear art exists). */
  bespokeRegistry?: Readonly<Record<string, string>>;
}

export const PixelGear: React.FC<PixelGearProps> = React.memo(({
  item,
  input,
  grammar,
  size = 70,
  fluid = false,
  className = '',
  testId,
  density = 'card',
  bespokeRegistry,
}: PixelGearProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const resolved: GearComposeInput | undefined = useMemo(() => {
    if (input) return input;
    if (!item) return undefined;
    try {
      return grammar.inputFromItem ? grammar.inputFromItem(item) : defaultGearInput(item, grammar);
    } catch {
      // Art derivation must never take down a screen: a grammar may
      // legitimately refuse a record it has no truthful art for
      // (the relic grammar throws on a name outside the closed
      // pool). Pool↔grammar drift is a SUITE failure — the coverage
      // tests call the derivation directly — not a runtime outage;
      // here the item simply renders no plate.
      return undefined;
    }
  }, [input, item, grammar]);

  const bespoke = resolved
    ? bespokeSpriteIdForGear(grammar.kind, item?.name, bespokeRegistry)
    : undefined;
  const bespokeSprite = bespoke ? getPixelSprite(bespoke) : undefined;

  const render = useMemo(
    () => (resolved && !bespokeSprite ? composeGearCached(resolved, grammar, density) : undefined),
    [resolved, bespokeSprite, grammar, density],
  );

  const paintScale = density === 'card' ? CARD_PAINT_SCALE : THUMB_PAINT_SCALE;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !render) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported — element + signature still render
    paintGear(ctx, render, paintScale);
  }, [render, paintScale]);

  if (bespokeSprite) {
    const height = Math.round(size * (bespokeSprite.height / bespokeSprite.width));
    return (
      <img
        src={bespokeSprite.url}
        alt={item?.name ?? 'Named gear'}
        width={fluid ? undefined : size}
        height={fluid ? undefined : height}
        className={className}
        style={{ imageRendering: 'pixelated', width: fluid ? '100%' : undefined, height: fluid ? 'auto' : undefined }}
        data-testid={testId}
        data-pixel-sprite={bespokeSprite.id}
        draggable={false}
      />
    );
  }

  if (!render) return null;
  const height = Math.round(size * (render.height / render.width));
  return (
    <canvas
      ref={canvasRef}
      width={render.width * paintScale}
      height={render.height * paintScale}
      className={className}
      style={{
        width: fluid ? '100%' : size,
        height: fluid ? 'auto' : height,
        imageRendering: 'pixelated',
        filter:
          resolved && (resolved.rarity === 'Epic' || resolved.rarity === 'Legendary')
            ? `drop-shadow(0 0 6px ${render.rarityColor})`
            : undefined,
      }}
      role="img"
      aria-label={item?.name ?? `${resolved?.rarity ?? ''} ${grammar.kind}`}
      data-testid={testId}
      data-signature={render.signature}
      data-density={density}
    />
  );
});
