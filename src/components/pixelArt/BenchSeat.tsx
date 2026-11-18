import React, { useEffect, useRef } from 'react';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { PixelConsumable } from '@/components/pixelArt/PixelConsumable';
import { PixelGear } from '@/components/pixelArt/PixelGear';
import { PixelMaterial } from '@/components/pixelArt/PixelMaterial';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { GEAR_SLOT_ICONS, type BenchRisePlan, type BenchSeatPlan } from '@/lib/pixel/benchSeat';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { relicGrammar } from '@/lib/pixel/relicGrammar';
import {
  sampleWorkCycle,
  WORK_CYCLE_PERIOD_MS,
  WORK_CYCLE_START_DELAY_MS,
  type WorkCycleSpec,
} from '@/lib/pixel/workCycle';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useVehicleStore } from '@/store/slices/vehicleSlice';

/**
 * BenchItemRender (Motion M4b) — paints a bench seat / rise plan
 * (benchSeat.ts) in the game's own render vocabulary: the real
 * compositors for everything that exists or is fully specified by
 * its recipe, the slot+rarity frame for the gear that does not
 * exist yet, and the service target's own record for service work.
 * The wrapper carries data-plan-kind so tests pin WHICH truth a
 * scene is showing, not just that something rendered.
 */
export const BenchItemRender: React.FC<{
  plan: BenchSeatPlan | BenchRisePlan;
  testId?: string;
}> = React.memo(({ plan, testId }) => {
  const items = useInventoryStore((s) => s.items);
  const vehicles = useVehicleStore((s) => s.vehicles);

  let body: React.ReactNode = null;
  switch (plan.kind) {
    case 'consumable':
      body = <PixelConsumable type={plan.consumableType} size={40} />;
      break;
    case 'material':
      body = <PixelMaterial id={plan.materialId} size={40} />;
      break;
    case 'cosmeticPart': {
      const sprite = getPixelSprite(plan.spriteId);
      // Part sprites are figure-scale portraits — seat them by
      // HEIGHT so a torso or helm sits on the bench instead of
      // towering over it.
      body = sprite ? (
        <img
          src={sprite.url}
          alt=""
          draggable={false}
          style={{ height: 42, width: 'auto', imageRendering: 'pixelated' }}
        />
      ) : null;
      break;
    }
    case 'namedRelic':
      body = <PixelGear grammar={relicGrammar} input={plan.input} size={46} density="thumb" />;
      break;
    case 'gearFrame': {
      const frame = RARITY_FRAME_STYLES[plan.rarity];
      body = (
        <div
          data-seat-slot={plan.slot}
          data-seat-rarity={plan.rarity}
          className="flex items-center justify-center border-2 bg-black/55"
          style={{
            width: 46,
            height: 36,
            borderColor: frame.color,
            boxShadow: frame.glow !== 'none' ? frame.glow : undefined,
          }}
        >
          <PxIcon name={GEAR_SLOT_ICONS[plan.slot]} size={20} />
        </div>
      );
      break;
    }
    case 'serviceItem': {
      const item = items.find((i) => i.id === plan.itemId);
      if (item) {
        body = <GearIllustration item={item} size={44} />;
        break;
      }
      const vehicle = vehicles.find((v) => v.id === plan.itemId);
      const sprite = vehicle
        ? getPixelSprite(`vehicle-${vehicle.vehicleClassId.replace(/_/g, '-')}`)
        : undefined;
      body = sprite ? (
        <img
          src={sprite.url}
          alt=""
          draggable={false}
          style={{ width: 54, imageRendering: 'pixelated' }}
        />
      ) : null;
      break;
    }
    case 'item':
      body = <GearIllustration item={plan.item} size={46} />;
      break;
    case 'glow':
      body = (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9999,
            background: 'radial-gradient(circle, rgba(255,214,110,0.95) 0%, rgba(255,160,60,0.45) 55%, transparent 75%)',
          }}
        />
      );
      break;
  }
  if (!body) return null;
  return (
    <div data-testid={testId} data-plan-kind={plan.kind} className="flex items-center justify-center">
      {body}
    </div>
  );
});

/** The seated piece's strike dip in scene px — small on purpose;
 *  this is an idle-game bench, not a cartoon. */
const SEAT_JOLT_PX = 2;

/**
 * BenchSeatWorkMotion (Motion S3) — the seat's half of the work
 * cycle: the piece is inert stock until the strike lands on it.
 * The dip is derived from the same sampler BenchFx executes
 * (sampleWorkCycle on the same start delay), never a private
 * timer, so the jolt, the glow crest, and the spark burst are
 * one instant by construction. Transform order puts the dip in
 * scene px (parent space) so it does not scale with the seat's
 * own zoom.
 */
export const BenchSeatWorkMotion: React.FC<{
  spec: WorkCycleSpec;
  /** Cycle running (a running job, not celebrating). Inactive or
   *  reduced renders the plain scaled seat — today's picture. */
  active: boolean;
  reduced?: boolean;
  /** The seat's zoom scale (the diorama's seatZoomScale). */
  scale: number;
  children: React.ReactNode;
}> = ({ spec, active, reduced = false, scale, children }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active || reduced) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0;
    let stopped = false;
    const startedAt = performance.now();
    const paint = () => {
      if (stopped) return;
      const local = performance.now() - startedAt - WORK_CYCLE_START_DELAY_MS;
      let dip = 0;
      if (local >= 0) {
        const amplitude = Math.max(0, Math.min(1, local / WORK_CYCLE_PERIOD_MS));
        const frame = sampleWorkCycle(spec, local, amplitude);
        dip = Math.pow(frame.strike, 1.5) * SEAT_JOLT_PX;
      }
      el.style.transform = `translateY(${dip.toFixed(2)}px) scale(${scale})`;
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [spec, active, reduced, scale]);
  return (
    <div ref={ref} style={{ transform: `scale(${scale})`, transformOrigin: '50% 100%' }}>
      {children}
    </div>
  );
};
