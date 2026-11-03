/**
 * QuickBuy QB-2 — the board shortfall fields and the QB-2 goods'
 * wire-contract fills.
 *
 * Section 1 (server builders, pure): the new shortfall fields on
 * the shared board-requirement builders (src/server/writes/
 * boardRequirements.ts) — the number the + mounts on. The
 * shortfall is the remaining points priced in whole units at
 * STANDARD quality (100%) at the reader's efficiency: the planning
 * basis a fresh unit is quoted at everywhere else (vendor stock is
 * flat 100%), so the sheet's stepper opens at a quantity the
 * market or the vendor can actually deliver.
 *
 * Section 2 (wire, checkpoint 3): fills through the real write
 * routes + InMemoryWriteStore for the QB-2 goods — PatchKit
 * (vendor staple leg + market leg), FieldPatchKit (market-only),
 * CalibrationCore (market-only) — proving delivery lands in the
 * buyer's consumable batches.
 */
import { describe, expect, it } from 'vitest';
import {
  coveredPoints,
  repairJobRequirements,
  shieldTechJobRequirements,
  shortfallUnits,
  type ServiceReaderFacts,
} from '../server/writes/boardRequirements';
import {
  calibrationCoreCapacityPoints,
  coresNeededForTarget,
} from '../content/shieldTech';

function reader(
  batchesByType: Record<string, Array<{ quality: number; quantity: number }>>,
  efficiency = 1,
): ServiceReaderFacts {
  return {
    verified: true,
    batchesByType: new Map(Object.entries(batchesByType)),
    workRatePointsPerHour: 100,
    efficiency,
  };
}

describe('boardRequirements — shortfall helpers', () => {
  it('coveredPoints sums every batch at its own yield, order-free', () => {
    const perUnit = (q: number) => (q / 100) * 10;
    const forward = coveredPoints(
      [{ quality: 100, quantity: 2 }, { quality: 50, quantity: 4 }],
      perUnit,
    );
    const reversed = coveredPoints(
      [{ quality: 50, quantity: 4 }, { quality: 100, quantity: 2 }],
      perUnit,
    );
    expect(forward).toBe(40);
    expect(reversed).toBe(40);
  });

  it('shortfallUnits ceils the remainder at standard quality, 0 when covered or degenerate', () => {
    expect(shortfallUnits(100, 60, 25)).toBe(2);
    expect(shortfallUnits(100, 100, 25)).toBe(0);
    expect(shortfallUnits(100, 140, 25)).toBe(0);
    expect(shortfallUnits(0, 0, 25)).toBe(0);
    expect(shortfallUnits(100, 0, 0)).toBe(0);
    expect(shortfallUnits(100, 0, -5)).toBe(0);
  });
});

describe('boardRequirements — repair kit shortfall', () => {
  const base = (kitType: string) => (kitType === 'PatchKit' ? 100 : 200);
  const restore = (kitBase: number, qualityPct: number, efficiency: number) =>
    kitBase * (qualityPct / 100) * efficiency;

  const build = (batchesByType: Record<string, Array<{ quality: number; quantity: number }>>, target = 250) =>
    repairJobRequirements({
      ownerUserId: 'owner-1',
      callerId: 'reader-1',
      targetPoints: target,
      priceCredits: 1000,
      kitTypes: ['PatchKit'],
      kitBase: base,
      kitRestorePoints: restore,
      reader: reader(batchesByType),
    });

  it('no stock: the whole target, in standard units', () => {
    const req = build({});
    const opt = req.kitOptions[0];
    expect(opt.onHand).toBe(0);
    expect(opt.estimatedKits).toBeNull();
    expect(opt.coversTarget).toBe(false);
    expect(opt.shortfallKits).toBe(3); // ceil(250 / 100)
  });

  it('partial stock: the remainder only, at standard quality — not the burn-order count', () => {
    // 1 × 100% covers 100 of 250; the burn walk runs dry (null),
    // but the shortfall is just ceil(150 / 100) = 2 fresh kits.
    const req = build({ PatchKit: [{ quality: 100, quantity: 1 }] });
    const opt = req.kitOptions[0];
    expect(opt.onHand).toBe(1);
    expect(opt.estimatedKits).toBeNull();
    expect(opt.shortfallKits).toBe(2);
  });

  it('mixed-quality stock prices the remainder off its real coverage', () => {
    // 2 × 50% cover 100 of 250 — same remainder as 1 × 100%.
    const req = build({ PatchKit: [{ quality: 50, quantity: 2 }] });
    expect(req.kitOptions[0].shortfallKits).toBe(2);
  });

  it('covered stock: shortfall 0 and the burn walk agrees', () => {
    const req = build({ PatchKit: [{ quality: 100, quantity: 3 }] });
    const opt = req.kitOptions[0];
    expect(opt.onHand).toBe(3);
    expect(opt.estimatedKits).toBe(3);
    expect(opt.coversTarget).toBe(true);
    expect(opt.shortfallKits).toBe(0);
  });
});

describe('boardRequirements — shield-tech core shortfall', () => {
  const build = (batchesByType: Record<string, Array<{ quality: number; quantity: number }>>, target = 9000) =>
    shieldTechJobRequirements({
      ownerUserId: 'owner-1',
      callerId: 'reader-1',
      targetPoints: target,
      priceCredits: 1000,
      coreType: 'CalibrationCore',
      coresNeeded: coresNeededForTarget,
      coreCapacityPoints: calibrationCoreCapacityPoints,
      reader: reader(batchesByType),
    });

  it('partial stock: remainder in whole standard cores', () => {
    // 2 × 100% cores cover 5,000 of 9,000; a standard core yields
    // 2,500 → ceil(4,000 / 2,500) = 2.
    const req = build({ CalibrationCore: [{ quality: 100, quantity: 2 }] });
    expect(req.coresOnHand).toBe(2);
    expect(req.estimatedCores).toBeNull();
    expect(req.coversTarget).toBe(false);
    expect(req.shortfallCores).toBe(2);
  });

  it('covered stock: shortfall 0', () => {
    const req = build({ CalibrationCore: [{ quality: 100, quantity: 4 }] });
    expect(req.estimatedCores).toBe(4);
    expect(req.coversTarget).toBe(true);
    expect(req.shortfallCores).toBe(0);
  });

  it('no stock: the whole target in standard cores', () => {
    const req = build({});
    expect(req.coresOnHand).toBe(0);
    expect(req.shortfallCores).toBe(4); // ceil(9,000 / 2,500)
  });
});
