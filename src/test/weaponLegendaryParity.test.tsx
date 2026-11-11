import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { LEGENDARY_EFFECTS } from '@/constants/legendaryEffects';
import {
  bespokeSpriteIdForLegendaryEffect,
  bespokeSpriteIdForWeaponName,
} from '@/lib/pixel/manifest';
import { LEGENDARY_AUTHORED } from '@/lib/pixel/legendaryAuthoredData';
import { legendaryAuthoredSetForId } from '@/lib/pixel/legendaryArt';
import { pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import { resolveWeaponPainting, weaponPaintingShell } from '@/lib/pixel/weaponPaintingRender';
import { legendaryPaintingSpriteId } from '@/lib/pixel/spriteProduction';
import { showcaseWeaponInput } from '@/lib/pixel/showcaseWeaponInput';
import type { ShowcaseItemPayload } from '@/lib/api/verifiedOps';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { createRNG } from '@/lib/utils/rng';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { LEGENDARY_ART_PARITY } from './legendaryParityTable';

/**
 * Weapon pixel program, slice 2 — legendary parity pins.
 *
 * The law (owner, 2026-11-02): a legendary drop's type is the type its
 * bespoke art depicts. Three layers keep it true:
 *  1. THE TABLE (legendaryParityTable.ts): every def type was read
 *     against its sprite's silhouette. Re-typing a def or swapping a
 *     sprite without re-reading the art fails here.
 *  2. THE GENERATOR: an assigned effect pins the drop's type — the
 *     pin outranks even an explicit forcedType.
 *  3. THE SURFACES: every named legendary renders its bespoke
 *     art through the shared component — since the painted
 *     renderer (Top-Choice renderer slice, 2026-11-11) that art
 *     is the legendary's adopted Top-Choice PAINTING
 *     (legendary-painting-<slug>), which supersedes the V4
 *     authored-set compositor render as the surface render. The
 *     parity law itself is unchanged: the painting IS the
 *     bespoke identity, resolved name-first then effect, ahead
 *     of the type x manufacturer base painting — including on
 *     the two surfaces slice 2 found resolving art on their own
 *     (Collections, Trophy Shelf).
 */

const makeWeapon = (overrides: Partial<Weapon> = {}): Weapon =>
  ({
    id: 'w-parity',
    name: 'Procedural Roll Name',
    level: 30,
    rarity: Rarity.Legendary,
    weaponType: WeaponType.Sniper,
    manufacturer: Manufacturer.HelixWorks,
    element: Element.Fire,
    rollQuality: 90,
    baseDamage: 3000,
    attackSpeed: 1.2,
    critChance: 0.2,
    critDamage: 2.1,
    statusChance: 0.3,
    statusDamage: 60,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 0,
    armorDamageMod: 0,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: DropSource.BossDrop,
    isLocked: false,
    pixelSeed: 11,
    combatPower: 500,
    bossPower: 480,
    farmPower: 300,
    economyScore: 90,
    ...overrides,
  }) as Weapon;

afterEach(() => {
  cleanup();
});

// ─── 1. The audit table ─────────────────────────────────────────────

describe('legendary art parity table — completeness', () => {
  it('covers exactly the 25 effects plus the Emberfall name piece', () => {
    const effectRows = LEGENDARY_ART_PARITY.filter((row) => row.effectId !== null);
    expect(effectRows.length).toBe(25);
    expect(new Set(effectRows.map((row) => row.effectId))).toEqual(
      new Set(LEGENDARY_EFFECTS.map((effect) => effect.id)),
    );
    const nameRows = LEGENDARY_ART_PARITY.filter((row) => row.effectId === null);
    expect(nameRows.map((row) => row.spriteId)).toEqual(['legendary-emberfall']);
  });

  it('every id in the table resolves to an authored legendary set (V4), and no authored set is left out', () => {
    const authoredIds = Object.keys(LEGENDARY_AUTHORED).sort();
    expect(LEGENDARY_ART_PARITY.map((row) => row.spriteId).sort()).toEqual(authoredIds);
    for (const row of LEGENDARY_ART_PARITY) {
      expect(legendaryAuthoredSetForId(row.spriteId), row.spriteId).toBeDefined();
    }
  });

  it('each row’s sprite is the one the live resolver returns for that legendary', () => {
    for (const row of LEGENDARY_ART_PARITY) {
      if (row.effectId) {
        expect(bespokeSpriteIdForLegendaryEffect(row.effectId), row.effectId).toBe(row.spriteId);
      } else {
        expect(bespokeSpriteIdForWeaponName(row.name)).toBe(row.spriteId);
      }
    }
  });

  it('each row’s def type and name match the live def (a re-typed def must re-enter the audit)', () => {
    for (const row of LEGENDARY_ART_PARITY) {
      if (!row.effectId) continue;
      const def = LEGENDARY_EFFECTS.find((effect) => effect.id === row.effectId);
      expect(def, row.effectId).toBeDefined();
      expect(row.defType, `${row.effectId} def type drifted from the audited table`).toBe(def!.weaponType);
      expect(row.name).toBe(def!.name);
    }
  });
});

describe('legendary art parity — the law itself', () => {
  it('every def type agrees with the type its sprite depicts, with exactly one owner-ruled exception', () => {
    const exceptions: string[] = [];
    for (const row of LEGENDARY_ART_PARITY) {
      if (!row.effectId || !row.defType) continue;
      if (row.defType !== row.depictedType) {
        exceptions.push(row.effectId);
        expect(row.verdict, `${row.effectId} disagrees without an owner ruling`).toBe('owner-ruled');
      } else {
        expect(row.verdict, `${row.effectId} is marked owner-ruled but actually agrees`).toBe('agree');
      }
    }
    // Thunder Receipt: carbine-read sprite, owner ruled Sniper (PR #285).
    expect(exceptions).toEqual(['thunder_receipt']);
  });
});

// ─── 2. The drop path ───────────────────────────────────────────────

describe('generator — an assigned legendary effect pins the drop’s type to the depicted type', () => {
  it('for every effect, a forced drop lands on the def type even against a contradictory forcedType', () => {
    for (const effect of LEGENDARY_EFFECTS) {
      const wrongType = Object.values(WeaponType).find((type) => type !== effect.weaponType)!;
      const weapon = generateWeapon(
        {
          source: DropSource.BossDrop,
          level: 40,
          bossTier: 7,
          forcedRarity: Rarity.Legendary,
          forcedLegendaryEffectId: effect.id,
          forcedType: wrongType,
        },
        createRNG(1234),
      );
      expect(weapon.legendaryEffectId, effect.id).toBe(effect.id);
      expect(weapon.weaponType, `${effect.id} must drop as the type its art depicts`).toBe(effect.weaponType);
    }
  });

  it('an ineligible forced effect never mints (tier gate holds) and any assigned effect still pins its type', () => {
    // Jackpot needs boss tier 7; at tier 1 the force must not mint it.
    const weapon = generateWeapon(
      {
        source: DropSource.BossDrop,
        level: 10,
        bossTier: 1,
        forcedRarity: Rarity.Legendary,
        forcedLegendaryEffectId: 'jackpot',
      },
      createRNG(77),
    );
    expect(weapon.legendaryEffectId).not.toBe('jackpot');
    if (weapon.legendaryEffectId) {
      const assigned = LEGENDARY_EFFECTS.find((effect) => effect.id === weapon.legendaryEffectId)!;
      expect(weapon.weaponType).toBe(assigned.weaponType);
    }
  });

  it('unforced legendary boss drops always carry an effect whose type the item matches', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const weapon = generateWeapon(
        { source: DropSource.BossDrop, level: 30, bossTier: 7, forcedRarity: Rarity.Legendary },
        createRNG(seed * 1000),
      );
      expect(weapon.legendaryEffectId, `seed ${seed}`).toBeDefined();
      const assigned = LEGENDARY_EFFECTS.find((effect) => effect.id === weapon.legendaryEffectId)!;
      expect(weapon.weaponType, `seed ${seed} (${assigned.id})`).toBe(assigned.weaponType);
    }
  });
});

// ─── 3. The surfaces ────────────────────────────────────────────────

describe('PixelWeapon — every named legendary renders its bespoke Top-Choice painting (painted renderer, 2026-11-11)', () => {
  // Re-pinned from the V4 authored-set compositor signatures by
  // the renderer slice: the surface render for a named legendary
  // is now its painting (data-painted-sprite names it; the
  // signature is the painting shell's). The parity assertion is
  // the same law in the new medium — bespoke identity first,
  // never the procedural/base form of the same roll.
  const paintingShellSignature = (weapon: Weapon, density: 'card' | 'stage') => {
    const input = pixelWeaponInputFromWeapon(weapon);
    const resolution = resolveWeaponPainting(input);
    expect(resolution, 'every parity weapon resolves to a painting').toBeDefined();
    return weaponPaintingShell(input, resolution!, density).signature;
  };

  it('at card density, for all 25 effects', () => {
    for (const row of LEGENDARY_ART_PARITY) {
      if (!row.effectId) continue;
      const weapon = makeWeapon({ legendaryEffectId: row.effectId, weaponType: row.defType! });
      const { container, unmount } = render(<PixelWeapon weapon={weapon} density="card" testId="pw-card" />);
      const canvas = container.querySelector('canvas');
      expect(canvas, row.effectId).not.toBeNull();
      // The canvas IS the bespoke painting for this legendary…
      expect(canvas!.getAttribute('data-painted-sprite'), row.effectId).toBe(
        legendaryPaintingSpriteId(row.spriteId.replace(/^legendary-/, '')),
      );
      expect(canvas!.getAttribute('data-signature'), row.effectId).toBe(paintingShellSignature(weapon, 'card'));
      // …and NOT the base painting the same roll would otherwise get.
      const procedural = makeWeapon({ name: 'Unnamed Roll', legendaryEffectId: undefined, weaponType: row.defType! });
      expect(canvas!.getAttribute('data-signature'), row.effectId).not.toBe(paintingShellSignature(procedural, 'card'));
      unmount();
    }
  });

  it('at stage density, for all 25 effects', () => {
    for (const row of LEGENDARY_ART_PARITY) {
      if (!row.effectId) continue;
      const weapon = makeWeapon({ legendaryEffectId: row.effectId, weaponType: row.defType! });
      const { container, unmount } = render(<PixelWeapon weapon={weapon} testId="pw-stage" />);
      const canvas = container.querySelector('canvas');
      expect(canvas, row.effectId).not.toBeNull();
      expect(canvas!.getAttribute('data-painted-sprite'), row.effectId).toBe(
        legendaryPaintingSpriteId(row.spriteId.replace(/^legendary-/, '')),
      );
      expect(canvas!.getAttribute('data-signature'), row.effectId).toBe(paintingShellSignature(weapon, 'stage'));
      const procedural = makeWeapon({ name: 'Unnamed Roll', legendaryEffectId: undefined, weaponType: row.defType! });
      expect(canvas!.getAttribute('data-signature'), row.effectId).not.toBe(paintingShellSignature(procedural, 'stage'));
      unmount();
    }
  });

  it('a weapon literally named Emberfall renders the Emberfall painting', () => {
    const weapon = makeWeapon({ name: 'Emberfall', legendaryEffectId: 'glass_sun' });
    const { container } = render(<PixelWeapon weapon={weapon} density="card" />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas!.getAttribute('data-painted-sprite')).toBe('legendary-painting-emberfall');
    expect(canvas!.getAttribute('data-signature')).toBe(paintingShellSignature(weapon, 'card'));
    // Name wins over the effect: not the Glass Sun painting.
    const glassSun = makeWeapon({ name: 'Other Name', legendaryEffectId: 'glass_sun' });
    expect(canvas!.getAttribute('data-signature')).not.toBe(paintingShellSignature(glassSun, 'card'));
  });
});

describe('GearIllustration — the shared card path (grid / GearHub / inspect / market / chest)', () => {
  it('renders every named legendary as its bespoke painting', () => {
    for (const row of LEGENDARY_ART_PARITY) {
      if (!row.effectId) continue;
      const weapon = makeWeapon({ legendaryEffectId: row.effectId, weaponType: row.defType! });
      const { container, unmount } = render(<GearIllustration item={weapon} size="showcase" />);
      const canvas = container.querySelector('canvas');
      expect(canvas, row.effectId).not.toBeNull();
      expect(canvas!.getAttribute('data-painted-sprite'), row.effectId).toBe(
        legendaryPaintingSpriteId(row.spriteId.replace(/^legendary-/, '')),
      );
      const input = pixelWeaponInputFromWeapon(weapon);
      expect(canvas!.getAttribute('data-signature'), row.effectId).toBe(
        weaponPaintingShell(input, resolveWeaponPainting(input)!, 'card').signature,
      );
      unmount();
    }
  });
});

// ─── 4. The two surfaces slice 2 repaired ───────────────────────────

const collectionsState = vi.hoisted(() => ({
  discoveries: [
    { family: 'legendary_effect', entry_key: 'insurance_fraud_weapon', source: 'Boss drop', discovered_at: '2026-11-02T00:00:00.000Z' },
  ],
}));

const lifetimeState = vi.hoisted(() => ({
  payload: null as unknown,
}));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {},
  fetchCollections: vi.fn(async () => ({
    legendary_cores: 0,
    discoveries: collectionsState.discoveries,
  })),
  fetchProfileLifetime: vi.fn(async () => lifetimeState.payload),
  setShowcasePins: vi.fn(async () => ({ ok: true })),
}));

import { CollectionsScreen } from '@/screens/CollectionsScreen';
import { TrophyShelfPanel } from '@/components/profile/TrophyShelfPanel';

describe('Collections screen — legendary-effect entries show their bespoke art', () => {
  it('Insurance Fraud renders the legendary-painting-insurance-fraud painting (its id is not name-shaped)', async () => {
    render(<CollectionsScreen />);
    const entry = await screen.findByTestId('collection-entry-legendary_effect-insurance_fraud_weapon');
    const canvas = entry.querySelector('canvas');
    expect(canvas, 'the entry must render its bespoke art, not the star fallback').not.toBeNull();
    expect(entry.querySelector('img')).toBeNull();
    expect(canvas!.getAttribute('data-painted-sprite')).toBe('legendary-painting-insurance-fraud');
    // The panel synthesizes its input with an FNV-1a seed off the
    // entry key (seedFromKey in CollectionsPanel.tsx) — replicated
    // here so the pin names the exact bespoke render (painting
    // shell signature since the painted renderer, 2026-11-11).
    const key = 'insurance_fraud_weapon';
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const synthesized = {
      weaponType: WeaponType.Pistol,
      manufacturer: Manufacturer.HelixWorks,
      rarity: Rarity.Legendary,
      legendaryEffectId: 'insurance_fraud_weapon',
      name: 'Insurance Fraud',
      pixelSeed: Math.abs(hash),
      rollQuality: 100,
      id: 'collection-leg-insurance_fraud_weapon',
    };
    const expected = weaponPaintingShell(synthesized, resolveWeaponPainting(synthesized)!, 'card');
    expect(canvas!.getAttribute('data-signature')).toBe(expected.signature);
  }, 30000);
});

describe('Trophy Shelf — a shelved legendary keeps its bespoke art', () => {
  it('the payload → input mapping forwards legendaryEffectId to the renderer', async () => {
    lifetimeState.payload = {
      kills: { roaming: 0, by_area: {}, by_weapon_type: {}, by_element: {}, elites: 0, named_elites_downed: 0 },
      deaths: 0,
      credits: { earned: 0, spent: 0, since: null },
      bosses: { attempts: 0, victories: 0, by_boss: {}, downed: 0 },
      endless: { runs: 0, best_depth: 0, deaths: 0, banked: 0, abandoned: 0 },
      legendaries: { salvaged: 0, cores_minted: 0, cores_spent: 0, cores_balance: 0, discoveries_by_source: {} },
      caches: { opened: 0, rewarded_keys: 0 },
      crafting: { total_units: 0, units_by_kind: {} },
      consumables: { used_total: 0, top_used: [] },
      repair: { board_points_restored: 0, board_jobs_completed: 0, board_credits_earned: 0, self_points_restored: 0, self_jobs: 0 },
      dispatch: { completed: 0, foot: 0, courier: 0, credits_earned: 0 },
      extraction: { passes: 0, xp_awarded: 0 },
      market: { sales: 0, sales_volume: 0, fees_paid: 0, purchases: 0, purchases_volume: 0 },
      salvage: { items: 0, scrap_earned: 0 },
      reforges: 0,
      resurrections: 0,
      collections: { discovered: 1, by_family: {} },
      showcase: {
        top_weapons: [
          {
            id: 'item-glass-sun',
            item_level: 42,
            rarity: 'Legendary',
            is_locked: false,
            runtime_state: 'idle',
            equipped_slot: null,
            created_at: '2026-11-02T00:00:00.000Z',
            payload: {
              name: 'Scorched HelixWorks Rail Prototype',
              weaponType: 'SMG',
              manufacturer: 'HelixWorks',
              element: 'Fire',
              rarity: 'Legendary',
              pixelSeed: 7,
              rollQuality: 91,
              affixes: [],
              parts: [],
              legendaryEffectId: 'glass_sun',
            },
          },
        ],
        best_endless_depth: 0,
        cache_rank_tokens: 0,
        cache_rank_total_ranks: 0,
        collections_discovered: 1,
      },
    };
    render(<TrophyShelfPanel />);
    const trophy = await screen.findByTestId('trophy-weapon');
    const art = within(trophy).getByRole('img');
    expect(art.tagName).toBe('CANVAS');
    expect(art.getAttribute('data-painted-sprite')).toBe('legendary-painting-glass-sun');
    const payloadItem = (lifetimeState.payload as { showcase: { top_weapons: ShowcaseItemPayload[] } }).showcase.top_weapons[0];
    const input = showcaseWeaponInput(payloadItem);
    const expected = weaponPaintingShell(input, resolveWeaponPainting(input)!, 'card');
    expect(art.getAttribute('data-signature')).toBe(expected.signature);
  }, 30000);
});
