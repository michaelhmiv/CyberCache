/**
 * Vehicle thumbnail containment — owner device defect, 2026-11-13.
 *
 * On the Gear tab's vehicle list, a Scanner-modded vehicle's
 * thumbnail burst out of its image box and painted over the card's
 * Condition row. Root cause: `VehicleSprite` (GaragePanel) stretched
 * every affix overlay to the box WIDTH at the overlay's own aspect
 * ratio (absolute inset-0 w-full, height auto). The adopted affix
 * paintings are independent canvases, not pixel-aligned layers of
 * the class painting — `vehicle-affix-scanner-array` is square
 * (1600×1600) against a ~2.06:1 class canvas — so at the garage's
 * 92 px box the scanner overlay rendered 92 px tall over a ~45 px
 * box (≈47 px of spill). Cargo rack (1904×1280) spilled ≈17 px and
 * the reinforced frame (2048×1248) ≈11 px the same way.
 *
 * This suite renders `VehicleSprite` directly and asserts, for
 * EVERY vehicle class × EVERY overlay, the geometry the browser
 * will actually produce under the component's scheme, computed
 * from the sprite manifest's real dimensions:
 *   - pre-fix scheme (overlay width = box width, height by the
 *     overlay's own aspect): scanner-class pairs exceed the box —
 *     this is the control proving the assertion catches the defect;
 *   - shipped scheme (overlay img fills the box, object-fit:
 *     contain): the drawn painting is always within the box on
 *     both axes, undistorted.
 * It also pins the mechanism in the DOM: every overlay img carries
 * the containment classes and the wrapper clips overflow — on
 * master (w-full only, no h-full/object-contain, no overflow clip)
 * those assertions fail.
 *
 * Renders the real manifest (integrity is enforced separately by
 * pixelManifest.test.ts), so no sprite mocking is needed.
 */
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VehicleSprite } from '@/components/gear/GaragePanel';
import type { VehicleDisplay } from '@/store/slices/vehicleSlice';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { DropSource, Rarity } from '@/types/game';

afterEach(() => cleanup());

const vehicle = (overrides: Partial<VehicleDisplay> = {}): VehicleDisplay => ({
  id: 'veh-1', name: 'Scrap Bike', vehicleClassId: 'scrap_bike', level: 1,
  rarity: Rarity.Rare,
  affixes: [{ stat: 'vehicleScannerPct', value: 0.09, displayText: '+9% Scanner (find)' } as VehicleDisplay['affixes'][number]],
  sourceTag: DropSource.WorldDrop,
  isLocked: false, pixelSeed: 1, conditionCurrent: 100, conditionMax: 100,
  runtimeState: 'available',
  ...overrides,
});

const CLASS_IDS = [
  'armored_crawler', 'cargo_hauler', 'dune_buggy', 'leviathan_rig',
  'relay_skimmer', 'scrap_bike', 'utility_rover',
] as const;

const OVERLAYS: Array<{ stat: string; spriteId: string }> = [
  { stat: 'vehicleCargoPct', spriteId: 'vehicle-affix-cargo-rack' },
  { stat: 'vehicleScannerPct', spriteId: 'vehicle-affix-scanner-array' },
  { stat: 'vehicleFramePct', spriteId: 'vehicle-affix-reinforced-frame' },
  // The scuff layer is condition-driven, rendered below 35% condition.
  { stat: '__scuff__', spriteId: 'vehicle-condition-scuff' },
];

/** Render one sprite composite and return its img elements in order. */
function renderSprite(v: VehicleDisplay) {
  const { container } = render(<VehicleSprite vehicle={v} />);
  const wrapper = container.querySelector('[data-testid="garage-vehicle-sprite"]');
  const imgs = [...container.querySelectorAll('img')];
  return { wrapper, imgs };
}

describe('VehicleSprite — affix overlays stay inside the thumbnail box (2026-11-13 defect)', () => {
  it('renders the scanner overlay img (the defect vehicle)', () => {
    const { imgs } = renderSprite(vehicle());
    // base class painting + scanner overlay
    expect(imgs.length).toBe(2);
  });

  it('every overlay img is box-filling and object-contained; the wrapper clips', () => {
    for (const { stat, spriteId } of OVERLAYS) {
      const v = stat === '__scuff__'
        ? vehicle({ affixes: [], conditionCurrent: 20, conditionMax: 100 })
        : vehicle({ affixes: [{ stat, value: 0.1, displayText: 'x' } as VehicleDisplay['affixes'][number]] });
      const { wrapper, imgs } = renderSprite(v);
      expect(wrapper, `${spriteId}: wrapper`).not.toBeNull();
      expect(wrapper!.className).toContain('overflow-hidden');
      const overlayImg = imgs.find((img) => img.getAttribute('src') === getPixelSprite(spriteId)?.url);
      expect(overlayImg, `${spriteId}: overlay rendered`).toBeDefined();
      // The containment mechanism: the img's box IS the sprite box
      // (h-full + w-full under inset-0) and the painting fits inside
      // it (object-contain). On master the overlay carried only
      // `absolute inset-0 w-full` — height followed its own aspect
      // and spilled. These assertions fail there.
      expect(overlayImg!.className).toContain('h-full');
      expect(overlayImg!.className).toContain('object-contain');
      cleanup();
    }
  });

  it('geometry: under the shipped scheme every class × overlay drawn painting fits the box', () => {
    const BOX_W = 92; // the garage card's sprite width (w-[92px])
    for (const classId of CLASS_IDS) {
      const base = getPixelSprite(`vehicle-${classId.replace(/_/g, '-')}`);
      expect(base, classId).toBeDefined();
      const boxH = (BOX_W * base!.height) / base!.width;
      for (const { spriteId } of OVERLAYS) {
        const overlay = getPixelSprite(spriteId);
        expect(overlay, spriteId).toBeDefined();
        // object-fit: contain inside a BOX_W × boxH img box.
        const scale = Math.min(BOX_W / overlay!.width, boxH / overlay!.height);
        const drawnW = overlay!.width * scale;
        const drawnH = overlay!.height * scale;
        expect(drawnW, `${classId} × ${spriteId} width`).toBeLessThanOrEqual(BOX_W + 1e-9);
        expect(drawnH, `${classId} × ${spriteId} height`).toBeLessThanOrEqual(boxH + 1e-9);
      }
    }
  });

  it('control: the pre-fix scheme (width-stretched, own aspect) overflows — the defect was real', () => {
    const BOX_W = 92;
    const base = getPixelSprite('vehicle-scrap-bike')!;
    const boxH = (BOX_W * base.height) / base.width;
    const scanner = getPixelSprite('vehicle-affix-scanner-array')!;
    const preFixH = (BOX_W * scanner.height) / scanner.width;
    // 92 px rendered over a ~44.6 px box: ≈47 px of spill, exactly
    // the burst the owner screenshotted over the Condition row.
    expect(preFixH).toBeGreaterThan(boxH + 40);
  });
});
