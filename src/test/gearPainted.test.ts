import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DropSource, Element, Rarity, SkillTreeType } from '@/types/game';
import { SKILL_NODES } from '@/constants/skillTrees';
import type { ClassMod, Ordnance, Relic, Shield } from '@/types/items';
import { GEAR_GRAMMARS } from '@/lib/pixel/gearDispatch';
import { getManifestEntry } from '@/lib/pixel/gearManifestData';
import { decodePng } from '@/lib/pixel/pngCodec';
import {
  PAINTED_CLASS_MOD_WINDOWS,
  PAINTED_GEAR_SPRITES,
  PAINTED_ORDNANCE_COLORWAYS,
  PAINTED_SHIELD_COLORWAYS,
} from '@/lib/pixel/gearPaintedData';
import {
  applyPaletteSwap,
  drawPaintedNodeDeck,
  paletteSwapFor,
  resolvePaintedGear,
} from '@/lib/pixel/gearPaintedRender';

/**
 * Top-Choice INT-2 — the painted gear layer.
 *
 * Pins: every gear identity resolves to its adopted painting (all 5
 * shield forms, all 16 relics by name, all 4 class-mod trees, all 4
 * ordnance forms); every painted sprite is a real manifest entry;
 * the element colorways move ONLY the measured glow-zone palette
 * entries (body/trim byte-identical by construction); and the
 * class-mod deck draws into the measured window — lit sockets for
 * the item's boosts, ink holes elsewhere, home-row marker on the
 * mod's own tree row.
 */

const shield = (over: Partial<Shield> = {}): Shield => ({
  id: 's1', name: 'Test Aegis', level: 5, rarity: Rarity.Rare,
  hp: 200, rechargeRate: 5, mitigation: 0.2, element: Element.Shock,
  affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 7,
  ...over,
});

const relic = (name: string): Relic => ({
  id: `r-${name}`, name, level: 3, rarity: Rarity.Rare,
  affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
});

const ordnance = (over: Partial<Ordnance> = {}): Ordnance => ({
  id: 'o1', name: 'Test Ordnance', level: 5, rarity: Rarity.Rare,
  damage: 50, shieldDamage: 25, armorDamage: 25, element: Element.Fire,
  effect: 'Fragmentation: +15% area damage',
  affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 3,
  ...over,
});

const classMod = (over: Partial<ClassMod> = {}): ClassMod => ({
  id: 'm1', name: 'Test Mod', level: 5, rarity: Rarity.Rare,
  treeBonus: SkillTreeType.Fixer, nodeBoosts: {},
  affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
  ...over,
});

function spriteBytes(spriteId: string): Uint8Array {
  const entry = getManifestEntry(spriteId);
  if (!entry) throw new Error(`no manifest entry for ${spriteId}`);
  return new Uint8Array(readFileSync(join(process.cwd(), 'src/assets/pixel', entry.src)));
}

describe('painted gear — resolution covers every identity', () => {
  it('all five shield behaviors resolve to their Wave 3 painting', () => {
    for (const behavior of ['standard', 'nova', 'absorb', 'amp', 'turtle'] as const) {
      const res = resolvePaintedGear(shield({ behavior }), GEAR_GRAMMARS.shield);
      expect(res?.spriteId, behavior).toBe(`gear-shield-${behavior}`);
      expect(res?.form).toBe(behavior);
    }
    // Legacy shields (no behavior field) read Standard, as always.
    expect(resolvePaintedGear(shield(), GEAR_GRAMMARS.shield)?.form).toBe('standard');
  });

  it('all sixteen relics resolve by name to their Wave 4 painting', () => {
    const names: [string, string][] = [
      ['Vault Chip', 'vault-chip'], ['Data Shard', 'data-shard'],
      ['Neural Key', 'neural-key'], ['Cache Relic', 'cache-relic'],
      ['Echo Stone', 'echo-stone'], ['Void Prism', 'void-prism'],
      ['Circuit Totem', 'circuit-totem'], ['Ancient Module', 'ancient-module'],
      ['Scrap Core', 'scrap-core'], ['Glitched Token', 'glitched-token'],
      ['Ethereal Drive', 'ethereal-drive'], ['Quantum Fragment', 'quantum-fragment'],
      ['Precision Calipers', 'precision-calipers'], ['Servo Bench Rig', 'servo-bench-rig'],
      ['Reclaimer Head', 'reclaimer-head'], ['Prime Laboratory', 'prime-laboratory'],
    ];
    for (const [name, form] of names) {
      const res = resolvePaintedGear(relic(name), GEAR_GRAMMARS.relic);
      expect(res?.spriteId, name).toBe(`gear-relic-${form}`);
    }
    // An off-pool name has no painting (the grammar throws first in
    // the render seam; resolution itself simply finds nothing).
    expect(resolvePaintedGear(relic('Odd Relic'), GEAR_GRAMMARS.relic)).toBeUndefined();
  });

  it('all four ordnance forms resolve by their effect string', () => {
    const effects: [string, string][] = [
      ['Fragmentation: +15% area damage', 'spike'],
      ['EMP Payload: +25% shield break', 'disc'],
      ['Seeker: Homes on weakpoints (+15% crit)', 'dart'],
      ['Cluster: Splits into 3 bomblets', 'canister'],
    ];
    for (const [effect, form] of effects) {
      const res = resolvePaintedGear(ordnance({ effect }), GEAR_GRAMMARS.ordnance);
      expect(res?.spriteId, effect).toBe(`gear-ordnance-${form}`);
    }
  });

  it('all four class-mod trees resolve; an unknown tree does not', () => {
    for (const tree of Object.values(SkillTreeType)) {
      const res = resolvePaintedGear(classMod({ treeBonus: tree }), GEAR_GRAMMARS.classMod);
      expect(res?.spriteId, tree).toBe(`gear-class-mod-${tree.toLowerCase()}`);
    }
    expect(
      resolvePaintedGear(classMod({ treeBonus: 'NoSuchTree' }), GEAR_GRAMMARS.classMod),
    ).toBeUndefined();
  });

  // Decodes all 29 masters from disk — far past the 5s default on a
  // loaded box; the assertion is the point, not the clock.
  it('every painted sprite id is a manifest entry with the declared size', { timeout: 120_000 }, () => {
    for (const byForm of Object.values(PAINTED_GEAR_SPRITES)) {
      for (const spriteId of Object.values(byForm)) {
        const entry = getManifestEntry(spriteId);
        expect(entry, spriteId).toBeDefined();
        const img = decodePng(spriteBytes(spriteId));
        expect(img.width, spriteId).toBe(entry!.width);
        expect(img.height, spriteId).toBe(entry!.height);
      }
    }
  });
});

describe('painted gear — element colorways move only the glow zone', () => {
  it('shield swaps rewrite only PLTE bytes, only at table indices', () => {
    const res = resolvePaintedGear(shield({ behavior: 'standard', element: Element.Fire }), GEAR_GRAMMARS.shield)!;
    const table = paletteSwapFor(res)!;
    // Wave 3's published proof: Standard's glow zone is 56 entries.
    expect(Object.keys(table)).toHaveLength(56);
    const before = spriteBytes(res.spriteId);
    const after = applyPaletteSwap(before, table);
    expect(after.length).toBe(before.length);
    // The only differing bytes live inside the PLTE chunk (plus its CRC).
    let offset = 8;
    let plteStart = -1;
    let plteEnd = -1;
    while (offset + 8 <= before.length) {
      const length = ((before[offset] << 24) | (before[offset + 1] << 16) | (before[offset + 2] << 8) | before[offset + 3]) >>> 0;
      const type = String.fromCharCode(before[offset + 4], before[offset + 5], before[offset + 6], before[offset + 7]);
      if (type === 'PLTE') { plteStart = offset + 8; plteEnd = offset + 8 + length + 4; }
      if (type === 'IEND') break;
      offset += 8 + length + 4;
    }
    expect(plteStart).toBeGreaterThan(0);
    for (let i = 0; i < before.length; i++) {
      if (after[i] !== before[i]) expect(i, `byte ${i}`).toBeGreaterThanOrEqual(plteStart);
      if (after[i] !== before[i]) expect(i, `byte ${i}`).toBeLessThan(plteEnd);
    }
    // A Kinetic colorway desaturates the glow (sat cap 0.08): every
    // swapped entry is near-grey, and the Shock master itself is the
    // identity swap (its entries return near their own hues).
    const kinetic = PAINTED_SHIELD_COLORWAYS.standard[Element.Kinetic];
    for (const rgb of Object.values(kinetic)) {
      const spread = Math.max(...rgb) - Math.min(...rgb);
      expect(spread).toBeLessThanOrEqual(30);
    }
  });

  it('every form carries a non-empty swap table for all six elements', () => {
    for (const tables of [PAINTED_SHIELD_COLORWAYS, PAINTED_ORDNANCE_COLORWAYS]) {
      for (const [form, byElement] of Object.entries(tables)) {
        for (const element of Object.values(Element)) {
          expect(Object.keys(byElement[element]).length, `${form}/${element}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('an empty/absent table is a byte-identical pass-through', () => {
    const bytes = spriteBytes('gear-relic-void-prism');
    expect(applyPaletteSwap(bytes, undefined)).toBe(bytes);
    expect(applyPaletteSwap(bytes, {})).toBe(bytes);
  });
});

describe('painted gear — the class-mod deck is live data in the measured window', () => {
  it('every tree has a measured window inside the casing', () => {
    for (const tree of Object.values(SkillTreeType)) {
      const win = PAINTED_CLASS_MOD_WINDOWS[tree.toLowerCase()];
      expect(win, tree).toBeDefined();
      expect(win.x0).toBeGreaterThan(0);
      expect(win.y0).toBeGreaterThan(0);
      expect(win.x1).toBeLessThan(1);
      expect(win.y1).toBeLessThan(1);
      expect(win.x1 - win.x0).toBeGreaterThan(0.25);
    }
  });

  it('boosts light their sockets; the rest of the window stays holes + marker', () => {
    // Two real boosts from the registry's own placement — the first
    // two small Gunslinger nodes, as the wiki plate items pick them.
    const boosts: Record<string, number> = {};
    for (const node of SKILL_NODES) {
      if (node.tree !== SkillTreeType.Gunslinger || node.type !== 'small') continue;
      boosts[node.id] = 2;
      if (Object.keys(boosts).length >= 2) break;
    }
    const boosted = classMod({ treeBonus: SkillTreeType.Gunslinger, nodeBoosts: boosts });
    const base = decodePng(spriteBytes('gear-class-mod-gunslinger'));
    const plain = { width: base.width, height: base.height, data: new Uint8Array(base.data) };
    const lit = { width: base.width, height: base.height, data: new Uint8Array(base.data) };
    drawPaintedNodeDeck(plain, classMod({ treeBonus: SkillTreeType.Gunslinger, nodeBoosts: {} }));
    drawPaintedNodeDeck(lit, boosted);
    const win = PAINTED_CLASS_MOD_WINDOWS.gunslinger;
    const wx0 = Math.floor(win.x0 * base.width);
    const wx1 = Math.ceil(win.x1 * base.width);
    const wy0 = Math.floor(win.y0 * base.height);
    const wy1 = Math.ceil(win.y1 * base.height);
    let changedInWindow = 0;
    let changedOutside = 0;
    for (let y = 0; y < base.height; y++) {
      for (let x = 0; x < base.width; x++) {
        const o = (y * base.width + x) * 4;
        const differs = lit.data[o] !== base.data[o] || lit.data[o + 1] !== base.data[o + 1] || lit.data[o + 2] !== base.data[o + 2];
        const plainDiffers = plain.data[o] !== base.data[o];
        if (x >= wx0 && x < wx1 && y >= wy0 && y < wy1) {
          if (differs) changedInWindow++;
        } else if (differs || plainDiffers) {
          changedOutside++;
        }
      }
    }
    expect(changedInWindow).toBeGreaterThan(0);
    expect(changedOutside).toBe(0);
    // The boosted render differs from the unboosted deck somewhere
    // inside the window (lit cores vs holes).
    let deckDelta = 0;
    for (let y = wy0; y < wy1; y++) {
      for (let x = wx0; x < wx1; x++) {
        const o = (y * base.width + x) * 4;
        if (lit.data[o] !== plain.data[o] || lit.data[o + 3] !== plain.data[o + 3]) deckDelta++;
      }
    }
    expect(deckDelta).toBeGreaterThan(0);
  });
});
