import { describe, expect, it } from 'vitest';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Affix, WeaponPart } from '@/types/items';
import {
  CARD_WEAPON_HEIGHT,
  CARD_WEAPON_WIDTH,
  WEAPON_CARD_GRIP_FRACTIONS,
  cardGripBox,
  composeWeaponCard,
  composeWeaponCardCached,
  type WeaponCardRender,
} from '@/lib/pixel/weaponCardCompositor';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';

/**
 * One Grammar (owner ruling 2026-11-06, sweep brief Amendment 1):
 * the stage's held weapon is the CARD grammar in held mode — the
 * card composition minus its presentation furniture (sniper bipod,
 * Legendary halo ring, pooled glow, floating sparkles), applied as
 * a compositor pass. These pins hold the contract:
 *
 *  - held mode OFF is untouched: the card pins in
 *    weaponCardCompositor.test.ts (S1 goldens) stay byte-exact,
 *    and a furniture-free input renders identical rows either way;
 *  - held mode only ever REMOVES cells (its filled mask is a
 *    subset of the card mask) across the maker×type×rarity space
 *    at clean condition — the seeded wear speckle at worn grades
 *    legitimately lands differently, because the furniture cells
 *    the wear stream walks are gone (the grade itself is shared);
 *  - the furniture census on the owner's sample godroll matches
 *    the card-held proof's hand-stripped patch cell-for-cell
 *    (opaque 5,560 → 3,706; gold 866 → 10 — those were the PROOF's
 *    numbers on the trained form; S5's authored form re-measured
 *    the same fixture at opaque 5,383 → 3,543, gold 850 → 10);
 *  - the declared per-type grip anchors (the data the stage seats
 *    grip-to-grip) sit on the grip cluster the compositor actually
 *    draws, re-measured here for every maker of every type.
 */

const base = (over: Partial<PixelWeaponInput> = {}): PixelWeaponInput => ({
  weaponType: WeaponType.SMG,
  manufacturer: Manufacturer.Redline,
  element: Element.Kinetic,
  rarity: Rarity.Common,
  rollQuality: 75, // 'clean' — no wear speckle (see the subset pin's note)
  pixelSeed: 1234,
  ...over,
});

const filledCount = (render: WeaponCardRender) =>
  render.rows.reduce((n, r) => n + [...r].filter((c) => c !== '.').length, 0);
const countShade = (render: WeaponCardRender, s: string) =>
  render.rows.reduce((n, r) => n + [...r].filter((c) => c === s).length, 0);

const MAKERS = Object.values(Manufacturer);
const TYPES = Object.values(WeaponType);

/** The card-held proof's sample godroll (weapon-sheen-sample
 *  inputs.json, frozen) — the same minted instance the proof
 *  hand-stripped through a temporary compositor patch. */
const GODROLL_SNIPER: PixelWeaponInput = {
  id: 'ef69295e-c6fd-4d1d-bd0c-c1d911d49380',
  name: 'Spark Crater Needle Spec',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.BlastForge,
  rarity: Rarity.Legendary,
  element: Element.Shock,
  pixelSeed: 2044000165,
  rollQuality: 99,
  parts: [
    { slot: 'Barrel', modifier: { attackSpeed: 1.057 } },
    { slot: 'Grip', modifier: { critDamage: 1.108 } },
    { slot: 'Core', modifier: { critDamage: 0.988 } },
    { slot: 'Magazine', modifier: { critDamage: 1.025 } },
    { slot: 'Sight', modifier: { statusChance: 1.033 } },
    { slot: 'Chamber', modifier: { bossDamageMod: 0.996 } },
  ] as WeaponPart[],
  affixes: [
    { id: 'shieldDamageMod_0', category: 'boss', stat: 'shieldDamageMod', value: 0.1, displayText: '+10% Shield Break' },
    { id: 'critChance_1', category: 'combat', stat: 'critChance', value: 0.05, displayText: '+5% Crit Chance' },
    { id: 'critChance_2', category: 'combat', stat: 'critChance', value: 0.02, displayText: '+2% Crit Chance' },
    { id: 'baseDamage_3', category: 'combat', stat: 'baseDamage', value: 0.04, displayText: '+4% Damage' },
    { id: 'attackSpeed_4', category: 'combat', stat: 'attackSpeed', value: 0.08, displayText: '+8% Attack Speed' },
  ] as Affix[],
};

describe('held mode — furniture strip', () => {
  it('reproduces the card-held proof census cell-for-cell on the sample godroll', () => {
    const card = composeWeaponCard(GODROLL_SNIPER);
    const held = composeWeaponCard(GODROLL_SNIPER, undefined, { held: true });
    expect(filledCount(card)).toBe(5383);
    expect(countShade(card, 'G')).toBe(850);
    expect(filledCount(held)).toBe(3543);
    // The 10 surviving gold cells are on-gun accents (chamber band,
    // decals, godroll sparkles) — the halo ring, pooled glow and
    // floating sparkles are gone.
    expect(countShade(held, 'G')).toBe(10);
  });

  // Per-type its with explicit timeouts (the repo's heavy-test
  // convention): the full sweep is 288 composes, and a share of it
  // still crosses the default 5s limit under full-suite load.
  for (const weaponType of TYPES) {
    it(`only removes cells: the held mask is a subset of the card mask (${weaponType})`, { timeout: 30_000 }, () => {
      for (const manufacturer of MAKERS) {
        for (const rarity of [Rarity.Common, Rarity.Rare, Rarity.Epic, Rarity.Legendary]) {
          const input = base({ weaponType, manufacturer, rarity, id: `sub-${weaponType}-${manufacturer}-${rarity}` });
          const card = composeWeaponCard(input);
          const held = composeWeaponCard(input, undefined, { held: true });
          for (let y = 0; y < CARD_WEAPON_HEIGHT; y++) {
            for (let x = 0; x < CARD_WEAPON_WIDTH; x++) {
              if (held.rows[y][x] !== '.') {
                expect(card.rows[y][x], `${weaponType}/${manufacturer}/${rarity} at ${x},${y}`).not.toBe('.');
              }
            }
          }
        }
      }
    });
  }

  it('a furniture-free input renders identical rows in both modes (signatures stay disjoint)', () => {
    // Common Pistol: no bipod (Sniper-only), no halo/glow/sparkles
    // (Legendary-only) — nothing exists for held mode to strip.
    const input = base({ weaponType: WeaponType.Pistol, manufacturer: Manufacturer.Redline, rarity: Rarity.Common });
    const card = composeWeaponCard(input);
    const held = composeWeaponCard(input, undefined, { held: true });
    expect(held.rows).toEqual(card.rows);
    expect(held.colors).toEqual(card.colors);
    expect(held.signature).not.toBe(card.signature);
  });

  it('the sniper bipod is card-only: a Common sniper loses cells in held mode', () => {
    const input = base({ weaponType: WeaponType.Sniper, manufacturer: Manufacturer.Redline, rarity: Rarity.Common });
    const card = composeWeaponCard(input);
    const held = composeWeaponCard(input, undefined, { held: true });
    expect(filledCount(held)).toBeLessThan(filledCount(card));
  });

  it('on-body finishes survive: Epic edge glow and godroll sparkles stay in the hand', () => {
    const epic = base({ weaponType: WeaponType.SMG, manufacturer: Manufacturer.Redline, rarity: Rarity.Epic, element: Element.Fire });
    const epicHeld = composeWeaponCard(epic, undefined, { held: true });
    expect(countShade(epicHeld, 'e')).toBeGreaterThan(0);
    const god = composeWeaponCard(GODROLL_SNIPER, undefined, { held: true });
    expect(god.condition).toBe('godroll');
    expect(countShade(god, 'G')).toBeGreaterThan(0);
  });

  it('the cached compose keeps the two modes apart', () => {
    const input = base({ weaponType: WeaponType.Sniper, rarity: Rarity.Legendary });
    const card = composeWeaponCardCached(input);
    const held = composeWeaponCardCached(input, undefined, { held: true });
    expect(held).not.toBe(card);
    expect(composeWeaponCardCached(input)).toBe(card);
    expect(composeWeaponCardCached(input, undefined, { held: true })).toBe(held);
  });

  it('a payload-shaped stub renders the fallback gun in both modes (never throws)', () => {
    // The stage's contract since the pixel path: a weapon-shaped
    // object with its art fields missing (store fixtures do this)
    // renders as the normalized fallback — Common Redline Pistol —
    // instead of throwing on the rarity frame read. Regression
    // pin: wiring the stage to this compositor (One Grammar)
    // crashed LiveTurfDiorama on exactly such a stub.
    const stub = { id: 'stub-1', name: 'Stub' } as unknown as PixelWeaponInput;
    // The fallback is the stub with ONLY the three normalized
    // fields filled — every other field stays absent, exactly as
    // normalization leaves it (a missing rollQuality grades
    // 'field-used', so a "cleaner" fallback would not be equal).
    const fallback = {
      id: 'stub-1',
      name: 'Stub',
      weaponType: WeaponType.Pistol,
      manufacturer: Manufacturer.Redline,
      rarity: Rarity.Common,
    } as unknown as PixelWeaponInput;
    expect(composeWeaponCard(stub).rows).toEqual(composeWeaponCard(fallback).rows);
    expect(composeWeaponCard(stub, undefined, { held: true }).rows).toEqual(
      composeWeaponCard(fallback, undefined, { held: true }).rows,
    );
  });
});

describe('held mode — declared grip anchors', () => {
  it('every type declares an anchor, and the held render reports it', () => {
    for (const weaponType of TYPES) {
      const frac = WEAPON_CARD_GRIP_FRACTIONS[weaponType];
      expect(frac, weaponType).toBeTruthy();
      const held = composeWeaponCard(base({ weaponType }), undefined, { held: true });
      // Anchors ride at TEXEL=4 render scale over the 240×88 grid.
      expect(Math.abs(held.anchors.grip.x / (CARD_WEAPON_WIDTH * 4) - frac.x)).toBeLessThan(0.002);
      expect(Math.abs(held.anchors.grip.y / (CARD_WEAPON_HEIGHT * 4) - frac.y)).toBeLessThan(0.002);
    }
  });

  it('each declared anchor sits on the grip cluster its type actually draws (all makers)', { timeout: 30_000 }, () => {
    for (const weaponType of TYPES) {
      const box = cardGripBox(weaponType);
      const declared = WEAPON_CARD_GRIP_FRACTIONS[weaponType];
      for (const manufacturer of MAKERS) {
        const held = composeWeaponCard(
          base({ weaponType, manufacturer, id: `grip-${weaponType}-${manufacturer}` }),
          undefined,
          { held: true },
        );
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let y = box.y; y < Math.min(CARD_WEAPON_HEIGHT, box.y + box.h); y++) {
          for (let x = box.x; x < box.x + box.w; x++) {
            if (held.rows[y][x] !== '.') {
              sx += x + 0.5;
              sy += y + 0.5;
              n++;
            }
          }
        }
        expect(n, `${weaponType}/${manufacturer} grip cells`).toBeGreaterThan(0);
        const cx = sx / n / CARD_WEAPON_WIDTH;
        const cy = sy / n / CARD_WEAPON_HEIGHT;
        expect(Math.abs(cx - declared.x), `${weaponType}/${manufacturer} grip x`).toBeLessThan(0.02);
        expect(Math.abs(cy - declared.y), `${weaponType}/${manufacturer} grip y`).toBeLessThan(0.02);
        // And the anchor lands in the grip's mass, not in air: a
        // grip template can notch the exact centroid cell (the
        // BlastForge shotgun does), so the pin is neighborhood
        // density — the hand wraps a cluster, not a point.
        const ax = Math.floor(declared.x * CARD_WEAPON_WIDTH);
        const ay = Math.floor(declared.y * CARD_WEAPON_HEIGHT);
        let near = 0;
        for (let y = ay - 2; y <= ay + 2; y++) {
          for (let x = ax - 2; x <= ax + 2; x++) {
            if (held.rows[y]?.[x] && held.rows[y][x] !== '.') near++;
          }
        }
        expect(near, `${weaponType}/${manufacturer} anchor neighborhood`).toBeGreaterThanOrEqual(8);
      }
    }
  });
});
