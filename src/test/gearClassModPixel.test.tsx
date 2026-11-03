import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DropSource, Element, Rarity, SkillTreeType } from '@/types/game';
import type { ClassMod, Relic } from '@/types/items';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { composeGear, type GearRender } from '@/lib/pixel/gearCardCompositor';
import { GEAR_GRAMMARS, GEAR_PIXEL_KINDS, gearRenderRoute } from '@/lib/pixel/gearRenderFlags';
import {
  classModGrammar,
  classModInputFromItem,
  nodeBoostMarks,
  resolveClassModTree,
} from '@/lib/pixel/classModGrammar';
import { SKILL_TREE_VISUALS } from '@/constants/skillTreeVisuals';

/**
 * Gear marriage, slice 3 — class mods render as pixel plates.
 *
 * Pins:
 *  - the Fixer gap is closed: Fixer has its OWN family (the old
 *    SVG fell through to the Scavenger chip) with the Fixer tree
 *    colorway from the one SKILL_TREE_VISUALS registry;
 *  - pip truth: the actual rolled nodeBoosts light the field —
 *    position is the node's SKILL_NODES registry slot, brightness
 *    stack is the rolled value; two mods differing only in boosts
 *    render differently;
 *  - determinism: same record → same render, on every surface;
 *  - thumb is detail level 0: boosts are invisible at thumb, the
 *    family silhouette + colorway still identify the tree;
 *  - rarity is finish only (the core frame), form never changes;
 *  - golden signatures per tree × rarity corner.
 */

const affixes = (n: number): ClassMod['affixes'] =>
  Array.from({ length: n }, (_, i) => ({
    id: `aff_${i}`, category: 'skill' as const, stat: 'craftSpeed', value: 0.05, displayText: '+5%',
  }));

function mod(over: Partial<ClassMod>): ClassMod {
  return {
    id: 'cm_fixture', name: 'Prototype Class Mod', level: 10, rarity: Rarity.Rare,
    treeBonus: 'Gunslinger', nodeBoosts: {}, affixes: [],
    sourceTag: DropSource.WorldDrop, isLocked: false, ...over,
  };
}

/* Fixtures mirror the reviewed capture set in
   ~/workspace/cybercache-prep/gear-classmods-captures/ exactly —
   the golden pins below are those renders' signatures. */
const FIXTURES: Record<string, ClassMod> = {
  'gunslinger-epic-boosted': mod({
    id: 'cm_gs_1', name: 'Elite Gunslinger Class Mod', rarity: Rarity.Epic,
    treeBonus: 'Gunslinger',
    nodeBoosts: { gs_crit_1: 2, gs_dmg_2: 1, gs_boss_2: 3 },
    affixes: affixes(3),
  }),
  'gunslinger-legendary-boosted': mod({
    id: 'cm_gs_2', name: 'Optimized Gunslinger Class Mod', rarity: Rarity.Legendary,
    treeBonus: 'Gunslinger',
    nodeBoosts: { gs_crit_1: 3, gs_boss_2: 2, demo_exp_2: 1, fix_quality_1: 2 },
    affixes: affixes(5),
  }),
  'gunslinger-common-plain': mod({
    id: 'cm_gs_3', name: 'Prototype Gunslinger Class Mod', rarity: Rarity.Common,
    treeBonus: 'Gunslinger', nodeBoosts: {}, affixes: affixes(0),
  }),
  'demolition-rare-boosted': mod({
    id: 'cm_dm_1', name: 'Tactical Demolition Class Mod', rarity: Rarity.Rare,
    treeBonus: 'Demolition',
    nodeBoosts: { demo_ord_1: 2, demo_stag_2: 3 },
    affixes: affixes(2),
  }),
  'demolition-common-plain': mod({
    id: 'cm_dm_2', name: 'Prototype Demolition Class Mod', rarity: Rarity.Common,
    treeBonus: 'Demolition', nodeBoosts: {}, affixes: affixes(0),
  }),
  'demolition-legendary-boosted': mod({
    id: 'cm_dm_3', name: 'Optimized Demolition Class Mod', rarity: Rarity.Legendary,
    treeBonus: 'Demolition',
    nodeBoosts: { demo_heavy_1: 3, demo_exp_1: 2, scav_scrap_1: 1 },
    affixes: affixes(5),
  }),
  'scavenger-uncommon-boosted': mod({
    id: 'cm_sc_1', name: 'Field-Issue Scavenger Class Mod', rarity: Rarity.Uncommon,
    treeBonus: 'Scavenger',
    nodeBoosts: { scav_drop_1: 1, scav_scrap_2: 2 },
    affixes: affixes(1),
  }),
  'scavenger-epic-plain': mod({
    id: 'cm_sc_2', name: 'Elite Scavenger Class Mod', rarity: Rarity.Epic,
    treeBonus: 'Scavenger', nodeBoosts: {}, affixes: affixes(3),
  }),
  'scavenger-common-plain': mod({
    id: 'cm_sc_3', name: 'Prototype Scavenger Class Mod', rarity: Rarity.Common,
    treeBonus: 'Scavenger', nodeBoosts: {}, affixes: affixes(0),
  }),
  'scavenger-legendary-boosted': mod({
    id: 'cm_sc_4', name: 'Optimized Scavenger Class Mod', rarity: Rarity.Legendary,
    treeBonus: 'Scavenger',
    nodeBoosts: { scav_cache_1: 3, scav_qty_2: 2, fix_vehicle_yield_1: 1 },
    affixes: affixes(5),
  }),
  'fixer-epic-boosted': mod({
    id: 'cm_fx_1', name: 'Elite Fixer Class Mod', rarity: Rarity.Epic,
    treeBonus: 'Fixer',
    nodeBoosts: { fix_quality_1: 3, fix_repair_eff_2: 2, gs_speed_1: 1 },
    affixes: affixes(4),
  }),
  'fixer-common-plain': mod({
    id: 'cm_fx_2', name: 'Prototype Fixer Class Mod', rarity: Rarity.Common,
    treeBonus: 'Fixer', nodeBoosts: {}, affixes: affixes(0),
  }),
  'fixer-legendary-boosted': mod({
    id: 'cm_fx_3', name: 'Optimized Fixer Class Mod', rarity: Rarity.Legendary,
    treeBonus: 'Fixer',
    nodeBoosts: { fix_craft_time_2: 2, fix_vendor_1: 3, demo_armor_1: 1 },
    affixes: affixes(5),
  }),
};

const cardOf = (item: ClassMod): GearRender => composeGear(classModInputFromItem(item), classModGrammar, 'card');
const thumbOf = (item: ClassMod): GearRender => composeGear(classModInputFromItem(item), classModGrammar, 'thumb');
/** Form cells only: frame (F/f) and outline (K/k) are finishes —
 *  the core test's mask. (This grammar also uses k/K structurally,
 *  but those cells are seed-identical across rarities, so the mask
 *  still isolates exactly the frame delta.) */
const formMaskOf = (render: GearRender) =>
  render.rows.map((r) => [...r].map((c) => (c === '.' || c === 'F' || c === 'f' || c === 'K' || c === 'k' ? '0' : '1')).join('')).join('/');

describe('class-mod marriage — registration + dispatch', () => {
  it('the grammar is registered and the classMod flag is on; unflipped kinds stay svg', () => {
    expect(GEAR_GRAMMARS.classMod).toBe(classModGrammar);
    expect(GEAR_PIXEL_KINDS.classMod).toBe(true);
    expect(gearRenderRoute('classMod')).toBe('pixel');
    // Shields (slice 1) and ordnance (slice 2) flipped too and route
    // pixel; only relics — the kind no slice has flipped yet — stay
    // on the SVG route.
    expect(gearRenderRoute('shield')).toBe('pixel');
    expect(gearRenderRoute('ordnance')).toBe('pixel');
    for (const kind of ['relic'] as const) {
      expect(gearRenderRoute(kind)).toBe('svg');
    }
  });

  it('GearIllustration renders a class mod as a canvas with the core signature', () => {
    const item = FIXTURES['fixer-epic-boosted'];
    const { container } = render(<GearIllustration item={item} size="showcase" showBadges={false} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas!.dataset.signature).toBe(cardOf(item).signature);
  });

  it('a relic still renders its SVG (the one kind no slice has flipped yet)', () => {
    // Slices 1–3 flipped shields, ordnance, and class mods to pixel;
    // relics keep the SVG route until their own slice lands.
    const relic: Relic = {
      id: 'test_relic', name: 'Test Relic', level: 5, rarity: Rarity.Rare,
      affixes: [], sourceTag: 'World Drop', isLocked: false,
    };
    const { container } = render(<GearIllustration item={relic} size="card" showBadges={false} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });
});

describe('class-mod marriage — input derivation from the real record', () => {
  it('tree colorway comes from SKILL_TREE_VISUALS for every tree', () => {
    for (const tree of Object.values(SkillTreeType)) {
      const input = classModInputFromItem(mod({ treeBonus: tree }));
      expect(input.tree).toBe(tree);
      expect(input.baseColor).toBe(SKILL_TREE_VISUALS[tree].color);
      expect(input.variant).toBe(tree);
      expect(input.element).toBeNull();
      expect(input.kind).toBe('classMod');
    }
  });

  it('seed is stable per instance and differs across instances', () => {
    const a = classModInputFromItem(FIXTURES['fixer-epic-boosted']);
    const b = classModInputFromItem({ ...FIXTURES['fixer-epic-boosted'] });
    expect(a.seed).toBe(b.seed);
    expect(a.seed).not.toBe(classModInputFromItem(FIXTURES['fixer-common-plain']).seed);
  });

  it('an unrecognized treeBonus resolves to NO tree — never another tree', () => {
    expect(resolveClassModTree('Balanced')).toBeNull();
    expect(resolveClassModTree('')).toBeNull();
    expect(resolveClassModTree(undefined)).toBeNull();
    const input = classModInputFromItem(mod({ treeBonus: 'Balanced' }));
    expect(input.tree).toBeNull();
    expect(input.baseColor).not.toBe(SKILL_TREE_VISUALS[SkillTreeType.Scavenger].color);
  });
});

describe('class-mod marriage — the Fixer family exists (no fallthrough)', () => {
  it('a Fixer mod carries the Fixer colorway, not the Scavenger one', () => {
    const fixer = classModInputFromItem(FIXTURES['fixer-epic-boosted']);
    expect(fixer.baseColor).toBe('#2EC4B6');
    expect(cardOf(FIXTURES['fixer-epic-boosted']).colors.P).toBe('#2EC4B6');
  });

  it('Fixer and Scavenger renders differ for otherwise-identical records', () => {
    const base = { id: 'cm_same', name: 'Twin Class Mod', rarity: Rarity.Epic, affixes: affixes(2) };
    const fixer = cardOf(mod({ ...base, treeBonus: 'Fixer', nodeBoosts: { fix_quality_1: 2 } }));
    const scav = cardOf(mod({ ...base, treeBonus: 'Scavenger', nodeBoosts: { scav_drop_1: 2 } }));
    expect(fixer.rows).not.toEqual(scav.rows);
    expect(fixer.signature).not.toBe(scav.signature);
  });

  it('all four family silhouettes are pairwise distinct', () => {
    const renders = Object.values(SkillTreeType).map((tree) =>
      cardOf(mod({ id: `cm_${tree}`, name: `${tree} Class Mod`, treeBonus: tree, rarity: Rarity.Rare })),
    );
    for (let i = 0; i < renders.length; i++) {
      for (let j = i + 1; j < renders.length; j++) {
        expect(renders[i].signature).not.toBe(renders[j].signature);
        expect(renders[i].rows).not.toEqual(renders[j].rows);
      }
    }
  });
});

describe('class-mod marriage — nodeBoost pip truth', () => {
  it('placement is the node registry slot: row = its tree, col = its slot among that tree\u2019s smalls', () => {
    // SKILL_NODES order: gs_dmg_1, gs_dmg_2, gs_crit_1, … (append-only registry)
    expect(nodeBoostMarks({ gs_crit_1: 2 })).toEqual([{ nodeId: 'gs_crit_1', row: 0, col: 2, value: 2 }]);
    expect(nodeBoostMarks({ demo_ord_1: 1 })).toEqual([{ nodeId: 'demo_ord_1', row: 1, col: 0, value: 1 }]);
    const fx = nodeBoostMarks({ fix_quality_1: 3 });
    expect(fx).toHaveLength(1);
    expect(fx[0].row).toBe(3);
    expect(fx[0].value).toBe(3);
  });

  it('values clamp to the pip stack; unknown nodes are skipped like skillBonuses skips them', () => {
    expect(nodeBoostMarks({ gs_dmg_1: 9 })[0].value).toBe(3);
    expect(nodeBoostMarks({ not_a_node: 2 })).toEqual([]);
    expect(nodeBoostMarks({ gs_dmg_1: 0 })).toEqual([]);
    expect(nodeBoostMarks(undefined)).toEqual([]);
  });

  it('two mods differing ONLY in boosts render differently', () => {
    const base = mod({ id: 'cm_pip', name: 'Pip Class Mod', treeBonus: 'Gunslinger', rarity: Rarity.Epic });
    const plain = cardOf(base);
    const boosted = cardOf({ ...base, nodeBoosts: { gs_crit_1: 2 } });
    expect(boosted.signature).not.toBe(plain.signature);
    expect(boosted.rows).not.toEqual(plain.rows);
  });

  it('boost VALUE changes the render (the brightness stack is the roll)', () => {
    const base = mod({ id: 'cm_pip', name: 'Pip Class Mod', treeBonus: 'Gunslinger', rarity: Rarity.Epic });
    const v1 = cardOf({ ...base, nodeBoosts: { gs_dmg_1: 1 } });
    const v2 = cardOf({ ...base, nodeBoosts: { gs_dmg_1: 2 } });
    const v3 = cardOf({ ...base, nodeBoosts: { gs_dmg_1: 3 } });
    expect(new Set([v1.signature, v2.signature, v3.signature]).size).toBe(3);
    // Only the +3 stack reaches the white-hot texel inside the deck.
    const countW = (r: GearRender) => r.rows.reduce((n, row) => n + [...row].filter((c) => c === 'W').length, 0);
    expect(countW(v3)).toBeGreaterThan(countW(v1));
  });

  it('boost PLACEMENT changes the render (adjacent nodes, same value)', () => {
    const base = mod({ id: 'cm_pip', name: 'Pip Class Mod', treeBonus: 'Gunslinger', rarity: Rarity.Epic });
    const a = cardOf({ ...base, nodeBoosts: { gs_dmg_1: 2 } });
    const b = cardOf({ ...base, nodeBoosts: { gs_dmg_2: 2 } });
    const cross = cardOf({ ...base, nodeBoosts: { demo_ord_1: 2 } });
    expect(a.signature).not.toBe(b.signature);
    expect(a.signature).not.toBe(cross.signature);
  });
});

describe('class-mod marriage — determinism + density discipline', () => {
  it('same record → same render, twice, rows and signature', () => {
    const item = FIXTURES['gunslinger-legendary-boosted'];
    const a = cardOf(item);
    const b = cardOf({ ...item });
    expect(a.signature).toBe(b.signature);
    expect(a.rows).toEqual(b.rows);
  });

  it('card renders at the incumbent 240×120 plate; thumb at the quarter grid', () => {
    const item = FIXTURES['demolition-rare-boosted'];
    const card = cardOf(item);
    expect(card.width).toBe(240);
    expect(card.height).toBe(120);
    const thumb = thumbOf(item);
    expect(thumb.width).toBe(60);
    expect(thumb.height).toBe(30);
  });

  it('thumb is detail level 0: boosts invisible, family identity intact', () => {
    const base = mod({ id: 'cm_pip', name: 'Pip Class Mod', treeBonus: 'Fixer', rarity: Rarity.Epic });
    const plain = thumbOf(base);
    const boosted = thumbOf({ ...base, nodeBoosts: { fix_quality_1: 3, gs_dmg_1: 2 } });
    expect(boosted.rows).toEqual(plain.rows);
    const thumbs = Object.values(SkillTreeType).map((tree) =>
      thumbOf(mod({ id: `cm_t_${tree}`, name: `${tree} Class Mod`, treeBonus: tree, rarity: Rarity.Rare })),
    );
    for (let i = 0; i < thumbs.length; i++) {
      for (let j = i + 1; j < thumbs.length; j++) {
        expect(thumbs[i].signature).not.toBe(thumbs[j].signature);
      }
    }
  });

  it('rarity is finish only: Common and Legendary share the form mask', () => {
    // Same input, only the rarity changes — the seed (which drives
    // wear and fin picks) is held fixed so the frame is the ONLY delta.
    const base = classModInputFromItem(FIXTURES['gunslinger-common-plain']);
    const common = composeGear({ ...base, rarity: Rarity.Common }, classModGrammar, 'card');
    const legendary = composeGear({ ...base, rarity: Rarity.Legendary }, classModGrammar, 'card');
    expect(formMaskOf(legendary)).toBe(formMaskOf(common));
    expect(legendary.signature).not.toBe(common.signature);
  });
});

describe('class-mod marriage — golden signature pins', () => {
  // Regression tripwires over the reviewed capture set: any
  // intentional art change re-pins these deliberately (and the
  // capture sheets get re-read).
  const GOLDENS: Record<string, string> = {
    'gunslinger-epic-boosted': '3bc85e0e',
    'gunslinger-legendary-boosted': '37646577',
    'gunslinger-common-plain': 'f01c12db',
    'demolition-rare-boosted': 'b7a64ad3',
    'demolition-common-plain': '28a2ab3',
    'demolition-legendary-boosted': 'ba99d865',
    'scavenger-uncommon-boosted': 'a69fabd9',
    'scavenger-epic-plain': '6ecda35f',
    'scavenger-common-plain': '85c1486a',
    'scavenger-legendary-boosted': 'f1c8015c',
    'fixer-epic-boosted': 'b945e9b9',
    'fixer-common-plain': '15fe9265',
    'fixer-legendary-boosted': '93e17f70',
  };
  for (const [name, sig] of Object.entries(GOLDENS)) {
    it(`pins ${name} (card)`, () => {
      expect(cardOf(FIXTURES[name]).signature).toBe(sig);
    });
  }

  const THUMB_GOLDENS: Record<string, string> = {
    'gunslinger-epic-boosted': '9eeff1e6',
    'fixer-epic-boosted': '2842de39',
  };
  for (const [name, sig] of Object.entries(THUMB_GOLDENS)) {
    it(`pins ${name} (thumb)`, () => {
      expect(thumbOf(FIXTURES[name]).signature).toBe(sig);
    });
  }
});
