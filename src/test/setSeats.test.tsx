import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairBayScene, ShieldTechBayScene } from '@/components/pixelArt/ActionScenes';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { SET_SEATS, requireSetSeat, seatPointBottomPct, seatPointTopPct } from '@/lib/pixel/setSeats';
import { ACTION_SETS } from '@/lib/pixel/grammar';

/**
 * Set seats (Full Visual Program V2 landing): the seat records are
 * the declared data the bay scenes derive their geometry from.
 * These pins keep the data honest — every V2 piece has a record,
 * every record names a real sprite, seat points stay inside their
 * boxes, seatless pieces carry their reason — and keep the scenes'
 * derivations seated: the vehicle on the lift's deck line, the
 * glyph at the rig's ring center.
 */

const V2_PIECES = [
  'set-bench-forge',
  'set-bench-basic',
  'set-bench-lab',
  'set-refinery-crusher',
  'set-refinery-furnace',
  'set-bay-lift',
  'set-calibration-rig',
  'set-bay-tray',
  'set-bay-wall-listing',
  'set-vendor-stall',
] as const;

/** The pieces whose V2-authored art actually shipped in the
 *  landing (the benches were superseded by #447's own build). */
const LANDED_PIECES = [
  'set-refinery-crusher',
  'set-refinery-furnace',
  'set-bay-lift',
  'set-calibration-rig',
  'set-bay-tray',
  'set-bay-wall-listing',
  'set-vendor-stall',
] as const;

describe('set seat records', () => {
  it('covers every V2-authored piece and every ACTION_SETS set piece', () => {
    for (const id of V2_PIECES) {
      expect(SET_SEATS[id], `missing seat record for ${id}`).toBeDefined();
      expect(getPixelSprite(id), `seat record names a missing sprite: ${id}`).toBeDefined();
    }
    for (const ids of Object.values(ACTION_SETS)) {
      for (const id of ids) {
        expect(getPixelSprite(id), `ACTION_SETS names a missing sprite: ${id}`).toBeDefined();
      }
    }
  });

  it('keeps seat points and clear zones inside their sprite boxes', () => {
    for (const [id, record] of Object.entries(SET_SEATS)) {
      if (!record.seat) {
        expect(record.nullReason, `${id}: a seatless record must carry its reason`).toBeTruthy();
        continue;
      }
      const { point, clearZone } = record.seat;
      expect(point.x, `${id} point.x`).toBeGreaterThanOrEqual(0);
      expect(point.x, `${id} point.x`).toBeLessThanOrEqual(1);
      expect(point.y, `${id} point.y`).toBeGreaterThanOrEqual(0);
      expect(point.y, `${id} point.y`).toBeLessThanOrEqual(1);
      expect(clearZone.x + clearZone.w, `${id} clear zone width`).toBeLessThanOrEqual(1.001);
      expect(clearZone.y + clearZone.h, `${id} clear zone height`).toBeLessThanOrEqual(1.001);
    }
  });

  it('the landed pieces ship at their authored canvas sizes', () => {
    // Top-Choice INT-5 (2026-11-11): the adopted Wave 10 paintings
    // are the authored canvases now — these are their shipped dims
    // (the retired pixel sprites measured 96x68 / 76x68 / 116x87 /
    // 100x87 / 84x36 / 96x68 / 104x68). Seat fractions are fractions
    // of the sprite's own box by design (setSeats.ts header), so
    // they carry over to the new canvases; per-piece seat-point
    // precision against the paintings' compositions is a device
    // eyeball item (work-cycle seating), not a size question.
    const authored: Record<string, [number, number]> = {
      'set-refinery-crusher': [1920, 1280],
      'set-refinery-furnace': [1600, 1600],
      'set-bay-lift': [1792, 1280],
      'set-calibration-rig': [1728, 1440],
      'set-bay-tray': [2480, 992],
      'set-bay-wall-listing': [1920, 1280],
      'set-vendor-stall': [1920, 1280],
    };
    for (const id of LANDED_PIECES) {
      const sprite = getPixelSprite(id);
      expect(sprite, id).toBeDefined();
      expect([sprite!.width, sprite!.height], id).toEqual(authored[id]);
    }
  });

  it('requireSetSeat throws for seatless and unknown pieces', () => {
    expect(() => requireSetSeat('set-refinery-furnace')).toThrow();
    expect(() => requireSetSeat('set-bay-wall-listing')).toThrow();
    expect(() => requireSetSeat('set-nope')).toThrow();
    expect(requireSetSeat('set-bay-lift').point).toEqual({ x: 0.5, y: 0.609 });
  });

  it('seat derivations are pure height-fraction math', () => {
    const seat = requireSetSeat('set-bay-lift');
    // Deck at 0.609 of an 87-tall piece standing 38% tall on a
    // 0.86 ground line: top = 0.86 - 0.38*(1-0.609) = 0.71142.
    expect(seatPointTopPct(seat, 38, 0.86)).toBeCloseTo(71.142, 3);
    expect(seatPointBottomPct(seat, 38, 0.86)).toBeCloseTo(28.858, 3);
  });
});

describe('bay scenes derive their geometry from the seats', () => {
  it('the repair vehicle stands on the lift deck line', () => {
    render(<RepairBayScene progress={0.45} causeLabel="Repairing" vehicleSpriteId="vehicle-dune-buggy" working />);
    const vehicle = screen.getByTestId('repair-bay-vehicle');
    const bottom = parseFloat(vehicle.style.bottom);
    // ThrowTech ground line 0.86 -> the deck seat reads 28.858%.
    expect(bottom).toBeCloseTo(seatPointBottomPct(requireSetSeat('set-bay-lift'), 38, 0.86), 3);
    expect(bottom).toBeGreaterThan(20); // the retired painting's +4% float is gone
  });

  it('the shield-tech glyph floats at the rig ring center, sized to the disc', () => {
    render(<ShieldTechBayScene progress={0.45} causeLabel="Calibrating" behaviorGlyphId="glyph-behavior-amp" working />);
    const glyph = screen.getByTestId('shieldtech-behavior-glyph');
    const rigSeat = requireSetSeat('set-calibration-rig');
    expect(glyph.style.left).toBe(`${rigSeat.point.x * 100}%`);
    expect(glyph.style.top).toBe(`${rigSeat.point.y * 100}%`);
    expect(glyph.style.transform).toBe('translate(-50%, -50%)');
    // A child of the rig actor: it inherits the rig's own box, so
    // the seat fractions are of the sprite itself.
    const rig = screen.getByTestId('shieldtech-calibration-rig');
    expect(rig.contains(glyph)).toBe(true);
  });
});
