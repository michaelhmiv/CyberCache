import React from 'react';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { PixelConsumable } from '@/components/pixelArt/PixelConsumable';
import { PixelGear } from '@/components/pixelArt/PixelGear';
import { PixelMaterial } from '@/components/pixelArt/PixelMaterial';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { GEAR_SLOT_ICONS, type BenchRisePlan, type BenchSeatPlan } from '@/lib/pixel/benchSeat';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { relicGrammar } from '@/lib/pixel/relicGrammar';
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
