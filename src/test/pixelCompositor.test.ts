import { describe, expect, it } from 'vitest';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { WeaponPart } from '@/types/items';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { createRNG } from '@/lib/utils/rng';
import { DropSource } from '@/types/game';
import {
  PIXEL_PART_SLOTS,
  PIXEL_WEAPON_HEIGHT,
  PIXEL_WEAPON_WIDTH,
  composePixelWeapon,
  partVariant,
  type PixelWeaponInput,
} from '@/lib/pixel/weaponCompositor';

const part = (slot: WeaponPart['slot'], stat = 'baseDamage', value = 1.05): WeaponPart => ({
  slot,
  modifier: { [stat]: value },
});

const fullParts = (value = 1.05): WeaponPart[] => PIXEL_PART_SLOTS.map((slot) => part(slot, 'baseDamage', value));

const baseInput = (overrides: Partial<PixelWeaponInput> = {}): PixelWeaponInput => ({
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  rarity: Rarity.Rare,
  element: Element.Fire,
  parts: fullParts(),
  ...overrides,
});

const filledCells = (rows: string[]) => rows.join('').replace(/\./g, '').length;

describe('pixel weapon compositor — determinism', () => {
  it('renders the same item to the identical image, every time', () => {
    const input = baseInput();
    const a = composePixelWeapon(input);
    const b = composePixelWeapon(baseInput());
    expect(b.signature).toBe(a.signature);
    expect(b.rows).toEqual(a.rows);
    expect(a.width).toBe(PIXEL_WEAPON_WIDTH);
    expect(a.height).toBe(PIXEL_WEAPON_HEIGHT);
    expect(filledCells(a.rows)).toBeGreaterThan(400);
  });

  it('is a pure function of part data — item id / name do not change the render', () => {
    const weaponA = generateWeapon(
      { source: DropSource.WorldDrop, level: 5, forcedType: WeaponType.Shotgun, forcedRarity: Rarity.Epic, forcedManufacturer: Manufacturer.BlastForge, forcedElement: Element.Fire },
      createRNG(1234),
    );
    const weaponB = { ...weaponA, id: 'a-completely-different-id', name: 'Renamed Pea Shooter' };
    const toInput = (w: typeof weaponA): PixelWeaponInput => ({
      weaponType: w.weaponType,
      manufacturer: w.manufacturer,
      rarity: w.rarity,
      element: w.element,
      parts: w.parts,
    });
    expect(composePixelWeapon(toInput(weaponB)).signature).toBe(composePixelWeapon(toInput(weaponA)).signature);
  });

  it('changes the render when a rolled part changes', () => {
    const original = baseInput();
    // Find a modifier value that flips the Barrel variant, then compare renders.
    const barrelVariant = partVariant(original, 'Barrel');
    let changed: PixelWeaponInput | undefined;
    for (let milli = 900; milli <= 1150; milli += 5) {
      const candidate = baseInput({
        parts: fullParts().map((p) => (p.slot === 'Barrel' ? part('Barrel', 'baseDamage', milli / 1000) : p)),
      });
      if (partVariant(candidate, 'Barrel') !== barrelVariant) {
        changed = candidate;
        break;
      }
    }
    expect(changed).toBeDefined();
    expect(composePixelWeapon(changed!).signature).not.toBe(composePixelWeapon(original).signature);
  });
});

describe('pixel weapon compositor — 6 types x 6 slots matrix', () => {
  it('renders every weapon type with every slot variant without error', () => {
    for (const weaponType of Object.values(WeaponType)) {
      for (const slot of PIXEL_PART_SLOTS) {
        const seenVariants = new Set<number>();
        // Sweep modifier values until all 3 variants for this slot are hit.
        for (let milli = 850; milli <= 1200 && seenVariants.size < 3; milli += 3) {
          const input = baseInput({
            weaponType,
            parts: fullParts().map((p) => (p.slot === slot ? part(slot, 'critChance', milli / 1000) : p)),
          });
          seenVariants.add(partVariant(input, slot));
          const render = composePixelWeapon(input);
          expect(render.rows).toHaveLength(PIXEL_WEAPON_HEIGHT);
          expect(render.rows.every((row) => row.length === PIXEL_WEAPON_WIDTH)).toBe(true);
          expect(filledCells(render.rows)).toBeGreaterThan(150);
          expect(render.anchors.muzzle.x).toBeGreaterThan(0);
          expect(render.anchors.muzzle.x).toBeLessThan(PIXEL_WEAPON_WIDTH);
          expect(render.anchors.grip.y).toBeLessThan(PIXEL_WEAPON_HEIGHT);
          expect(render.anchors.lootPoint.y).toBeGreaterThanOrEqual(0);
        }
        expect(seenVariants.size).toBe(3);
      }
    }
  });

  it('renders every type x manufacturer x rarity combination', () => {
    for (const weaponType of Object.values(WeaponType)) {
      for (const manufacturer of Object.values(Manufacturer)) {
        for (const rarity of Object.values(Rarity)) {
          const render = composePixelWeapon(baseInput({ weaponType, manufacturer, rarity, parts: fullParts(1.09) }));
          expect(filledCells(render.rows)).toBeGreaterThan(150);
          // Palette resolves to real hex colors from the shared identity sources.
          expect(render.colors.P).toMatch(/^#[0-9A-Fa-f]{6}$/);
          expect(render.colors.T).toBe(render.rarityColor);
        }
      }
    }
  });

  it('renders generator output directly (all forced types)', () => {
    for (const forcedType of Object.values(WeaponType)) {
      const weapon = generateWeapon(
        { source: DropSource.BossDrop, level: 12, forcedType, forcedRarity: Rarity.Legendary },
        createRNG(987),
      );
      expect(weapon.parts).toHaveLength(6);
      const render = composePixelWeapon({
        weaponType: weapon.weaponType,
        manufacturer: weapon.manufacturer,
        rarity: weapon.rarity,
        element: weapon.element,
        parts: weapon.parts,
      });
      expect(filledCells(render.rows)).toBeGreaterThan(150);
    }
  });

  it('renders previews with no parts (deterministic type defaults)', () => {
    const a = composePixelWeapon(baseInput({ parts: [] }));
    const b = composePixelWeapon(baseInput({ parts: [] }));
    expect(a.signature).toBe(b.signature);
    expect(filledCells(a.rows)).toBeGreaterThan(150);
  });
});
