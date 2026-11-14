import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  containFit,
  vehiclePlateKeyFor,
  vehiclePlateSpriteIds,
  type VehiclePlateArtInput,
} from '@/lib/pixel/vehiclePlate';

/**
 * Stage vehicle plate — REPORT 2026-11-13 §2a/§2b regressions.
 *
 * §2a: the Pixi plate was a mount-time snapshot — the tick never
 * re-read the loadout, so an equip/swap in the Gear tab (Home kept
 * alive) left the canvas showing the previous vehicle. The tick's
 * rebuild decision is the art-key compare (syncEnemyArt's shape):
 * these tests pin the key so a vehicle-slot change after mount
 * always changes it, and art-irrelevant drift never does.
 *
 * §2b: the two stage plates sized affix overlays differently from
 * the rule PR #579 settled (whole painting, undistorted, contained
 * in the base plate's box) — DOM resolved the square Scanner
 * painting at box width and spilled ~2.4× the plate height; Pixi
 * squashed it into the box. These tests pin the contain math the
 * Pixi plate now shares with the CSS object-contain surfaces.
 */

const vehicle = (overrides: Partial<VehiclePlateArtInput> = {}): VehiclePlateArtInput => ({
  vehicleClassId: 'scrap_bike',
  affixes: [],
  conditionCurrent: 100,
  conditionMax: 100,
  ...overrides,
});
const affix = (stat: string) => ({ stat });

describe('vehiclePlateSpriteIds', () => {
  it('is null with no vehicle equipped', () => {
    expect(vehiclePlateSpriteIds(null)).toBeNull();
    expect(vehiclePlateSpriteIds(undefined)).toBeNull();
  });

  it('derives the class painting id with underscores dashed', () => {
    expect(vehiclePlateSpriteIds(vehicle({ vehicleClassId: 'leviathan_rig' }))?.baseId).toBe('vehicle-leviathan-rig');
  });

  it('stacks overlays in the plates’ order: cargo, scanner, frame, scuff', () => {
    const ids = vehiclePlateSpriteIds(
      vehicle({
        affixes: [affix('vehicleFramePct'), affix('vehicleScannerPct'), affix('vehicleCargoPct')],
        conditionCurrent: 20,
        conditionMax: 100,
      }),
    );
    expect(ids?.overlayIds).toEqual([
      'vehicle-affix-cargo-rack',
      'vehicle-affix-scanner-array',
      'vehicle-affix-reinforced-frame',
      'vehicle-condition-scuff',
    ]);
  });

  it('adds the scuff only under 35% condition', () => {
    expect(vehiclePlateSpriteIds(vehicle({ conditionCurrent: 35, conditionMax: 100 }))?.overlayIds).toEqual([]);
    expect(vehiclePlateSpriteIds(vehicle({ conditionCurrent: 34, conditionMax: 100 }))?.overlayIds).toEqual([
      'vehicle-condition-scuff',
    ]);
  });

  it('ignores affixes with no overlay painting (yield, fuel efficiency)', () => {
    const ids = vehiclePlateSpriteIds(
      vehicle({ affixes: [affix('vehicleYieldPct'), affix('vehicleFuelEfficiencyPct')] }),
    );
    expect(ids?.overlayIds).toEqual([]);
  });
});

describe('vehiclePlateKeyFor — the §2a re-sync decision', () => {
  it('is empty with no vehicle equipped', () => {
    expect(vehiclePlateKeyFor(null)).toBe('');
    expect(vehiclePlateKeyFor(undefined)).toBe('');
  });

  it('changes on equip and on unequip (the mount-snapshot defect)', () => {
    expect(vehiclePlateKeyFor(vehicle())).not.toBe(vehiclePlateKeyFor(null));
    expect(vehiclePlateKeyFor(null)).not.toBe(vehiclePlateKeyFor(vehicle()));
  });

  it('changes on a class swap', () => {
    expect(vehiclePlateKeyFor(vehicle({ vehicleClassId: 'armored_crawler' }))).not.toBe(
      vehiclePlateKeyFor(vehicle({ vehicleClassId: 'scrap_bike' })),
    );
  });

  it('changes when an affix enters or leaves the overlay set', () => {
    const plain = vehiclePlateKeyFor(vehicle());
    const scanner = vehiclePlateKeyFor(vehicle({ affixes: [affix('vehicleScannerPct')] }));
    expect(scanner).not.toBe(plain);
    expect(vehiclePlateKeyFor(vehicle({ affixes: [affix('vehicleScannerPct'), affix('vehicleCargoPct')] }))).not.toBe(
      scanner,
    );
  });

  it('changes when condition crosses the scuff threshold in either direction', () => {
    const worn = vehiclePlateKeyFor(vehicle({ conditionCurrent: 30, conditionMax: 100 }));
    const sound = vehiclePlateKeyFor(vehicle({ conditionCurrent: 40, conditionMax: 100 }));
    expect(worn).not.toBe(sound);
  });

  it('does NOT change on condition drift that stays on one side of the threshold', () => {
    expect(vehiclePlateKeyFor(vehicle({ conditionCurrent: 90, conditionMax: 100 }))).toBe(
      vehiclePlateKeyFor(vehicle({ conditionCurrent: 50, conditionMax: 100 })),
    );
    expect(vehiclePlateKeyFor(vehicle({ conditionCurrent: 30, conditionMax: 100 }))).toBe(
      vehiclePlateKeyFor(vehicle({ conditionCurrent: 20, conditionMax: 100 })),
    );
  });

  it('does NOT change for a different instance with identical art', () => {
    const a = vehicle({ affixes: [affix('vehicleScannerPct')], conditionCurrent: 80, conditionMax: 100 });
    const b = vehicle({ affixes: [affix('vehicleScannerPct')], conditionCurrent: 75, conditionMax: 100 });
    expect(vehiclePlateKeyFor(a)).toBe(vehiclePlateKeyFor(b));
  });
});

describe('containFit — the §2b overlay rule', () => {
  it('contains the square Scanner painting inside a 2.4:1 plate box, undistorted', () => {
    // Scanner painting 1600×1600; a 2.4:1 plate box 240×100.
    const fit = containFit(1600, 1600, 240, 100);
    expect(fit.height).toBe(100);
    expect(fit.width).toBe(100);
    expect(fit.width).toBeLessThanOrEqual(240);
    expect(fit.height).toBeLessThanOrEqual(100);
    // Aspect preserved — the old Pixi sizing squashed it to 240×100.
    expect(fit.width / fit.height).toBeCloseTo(1600 / 1600, 10);
    // Centered on the plate.
    expect(fit.offsetX).toBe(70);
    expect(fit.offsetY).toBe(0);
  });

  it('contains a wide overlay in a square box, centered vertically', () => {
    const fit = containFit(2048, 1024, 100, 100);
    expect(fit.width).toBe(100);
    expect(fit.height).toBe(50);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(25);
  });

  it('never exceeds the box and never distorts, across overlay/box shapes', () => {
    const cases: Array<[number, number, number, number]> = [
      [1600, 1600, 86.5, 40], // scanner in the real 412px-stage plate box
      [1904, 1280, 86.5, 40], // cargo rack
      [2048, 1248, 173, 72], // reinforced frame, larger stage
      [2304, 1008, 92, 44.6], // scuff at garage width
      [400, 1600, 200, 100], // tall painting
    ];
    for (const [nw, nh, bw, bh] of cases) {
      const fit = containFit(nw, nh, bw, bh);
      expect(fit.width).toBeLessThanOrEqual(bw + 1e-9);
      expect(fit.height).toBeLessThanOrEqual(bh + 1e-9);
      expect(fit.width / fit.height).toBeCloseTo(nw / nh, 6);
      expect(fit.offsetX).toBeCloseTo((bw - fit.width) / 2, 9);
      expect(fit.offsetY).toBeCloseTo((bh - fit.height) / 2, 9);
    }
  });

  it('is the identity fit when the painting already matches the box', () => {
    const fit = containFit(200, 100, 200, 100);
    expect(fit).toEqual({ width: 200, height: 100, offsetX: 0, offsetY: 0 });
  });
});

describe('stage plates carry the fixes (structural pins)', () => {
  const readSource = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

  it('DOM plate: every affix overlay is contained in the plate box (§2b)', () => {
    const diorama = readSource('src/components/dashboard/LiveTurfDiorama.tsx');
    for (const id of [
      'vehicle-affix-cargo-rack',
      'vehicle-affix-scanner-array',
      'vehicle-affix-reinforced-frame',
      'vehicle-condition-scuff',
    ]) {
      const line = diorama.split('\n').find((l) => l.includes(`getPixelSprite('${id}')`));
      expect(line, `overlay line for ${id}`).toBeTruthy();
      // The master form was `absolute inset-0 w-full` — height auto,
      // the square painting resolving ~2.4× the plate height.
      expect(line).toContain('object-contain');
      expect(line).toContain('h-full');
    }
    // The plate wrapper clips as the hard containment guarantee.
    const plateAt = diorama.indexOf('data-testid="pixel-vehicle"');
    const plateBlock = diorama.slice(plateAt, plateAt + 200);
    expect(plateBlock).toContain('relative overflow-hidden');
  });

  it('Pixi plate: the tick re-syncs the plate and init builds through the shared builder (§2a)', () => {
    const stage = readSource('src/components/pixelArt/pixi/RoamPixiStage.tsx');
    expect(stage).toContain('syncVehicleArt(rt, env);');
    expect(stage).toContain('vehiclePlateKey: vehiclePlateKeyFor(vehicle)');
    // One build path: init and the re-sync share the builder.
    expect(stage.match(/buildVehiclePlateSprites\(/g)?.length).toBeGreaterThanOrEqual(3);
    // The mount-time squash sizing is gone.
    expect(stage).not.toContain('asp.height = vh');
  });
});
