import { describe, expect, it } from 'vitest';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import { LEGENDARY_EFFECTS } from '@/constants/legendaryEffects';
import {
  BESPOKE_LEGENDARY_SPRITES,
  bespokeSpriteIdForLegendaryEffect,
  bespokeSpriteIdForWeaponName,
  legendaryAuthoredForWeapon,
  legendaryAuthoredSetForId,
} from '@/lib/pixel/legendaryArt';
import { LEGENDARY_AUTHORED } from '@/lib/pixel/legendaryAuthoredData';
import { composeWeaponCard } from '@/lib/pixel/weaponCardCompositor';
import { composePixelWeapon } from '@/lib/pixel/weaponCompositor';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { lintBanding, lintRender } from './pixelLint';
import { BANDING_BY_SYSTEM } from './pxlLintCorpus';
import { LEGENDARY_ART_PARITY } from './legendaryParityTable';

/**
 * V4 — the 26 bespoke legendaries as authored pxl data.
 *
 * The legendaries' art is DATA now: one authored set per legendary id
 * in LEGENDARY_AUTHORED (generated from .px.js sources by
 * scripts/convert-legendary-authored.mjs), resolved through
 * legendaryArt and composed by the same two compositors as every
 * procedural weapon. These pins keep the registry complete, the
 * renders real (non-empty, distinct, lint-clean under the S2 gate),
 * and the resolution honest (a legendary input never falls through
 * to a procedural form).
 */

const representativeInput = (id: string): PixelWeaponInput => {
  const effect = LEGENDARY_EFFECTS.find((e) => bespokeSpriteIdForLegendaryEffect(e.id) === id);
  const parityRow = LEGENDARY_ART_PARITY.find((row) => row.spriteId === id);
  return {
    id: `v4-${id}`,
    name: effect?.name ?? 'Emberfall',
    // Emberfall has no effect def; its type comes from the parity
    // fixture (def type, else the depicted type), like the wiki's
    // representative instances. The final Sniper fallback is
    // Emberfall's depicted type — unreachable while the registry
    // covers exactly the parity ids (pinned above).
    weaponType: parityRow?.defType ?? parityRow?.depictedType ?? effect?.weaponType ?? WeaponType.Sniper,
    manufacturer: Manufacturer.HelixWorks,
    element: Element.Fire,
    rarity: Rarity.Legendary,
    legendaryEffectId: effect?.id,
    rollQuality: 100,
    pixelSeed: 7,
  };
};

describe('V4 authored legendary registry', () => {
  it('covers exactly the bespoke legendary ids — 26, no more, no fewer', () => {
    const bespokeIds = Object.values(BESPOKE_LEGENDARY_SPRITES).sort();
    expect(bespokeIds.length).toBe(26);
    expect(Object.keys(LEGENDARY_AUTHORED).sort()).toEqual(bespokeIds);
  });

  it('every set carries a card piece, a stage piece, palettes, and anchors', () => {
    for (const [id, set] of Object.entries(LEGENDARY_AUTHORED)) {
      expect(set.pieces.length, id).toBeGreaterThan(0);
      expect(set.stagePieces.length, id).toBeGreaterThan(0);
      expect(Object.keys(set.colors).length, id).toBe(18);
      expect(set.grip.x, id).toBeGreaterThanOrEqual(0);
      expect(set.muzzle.x, id).toBeGreaterThan(set.grip.x);
    }
  });

  it('resolves every legendary by effect and by name to the same set', () => {
    for (const effect of LEGENDARY_EFFECTS) {
      const byEffect = legendaryAuthoredForWeapon({ legendaryEffectId: effect.id });
      const byName = legendaryAuthoredForWeapon({ name: effect.name });
      expect(byEffect, effect.id).toBeDefined();
      expect(byName, effect.name).toBe(byEffect);
    }
    expect(legendaryAuthoredForWeapon({ name: 'Emberfall' })).toBe(legendaryAuthoredSetForId('legendary-emberfall'));
    expect(bespokeSpriteIdForWeaponName('Emberfall')).toBe('legendary-emberfall');
    expect(legendaryAuthoredForWeapon({ name: 'Some Procedural Rifle' })).toBeUndefined();
  });
});

describe('V4 authored legendary renders', () => {
  const ids = Object.keys(LEGENDARY_AUTHORED).sort();

  it('card, held, and stage renders are non-empty and mutually distinct per legendary', () => {
    for (const id of ids) {
      const input = representativeInput(id);
      const card = composeWeaponCard(input);
      const held = composeWeaponCard(input, undefined, { held: true });
      const stage = composePixelWeapon(input);
      for (const render of [card, held, stage]) {
        expect(render.rows.some((row) => row.replace(/\./g, '').length > 0), id).toBe(true);
      }
      expect(new Set([card.signature, held.signature, stage.signature]).size, id).toBe(3);
    }
  });

  it('no two legendaries share a card render', () => {
    const signatures = ids.map((id) => composeWeaponCard(representativeInput(id)).signature);
    expect(new Set(signatures).size).toBe(26);
  });

  it('a legendary render never equals the procedural form of the same roll', () => {
    for (const id of ids) {
      const input = representativeInput(id);
      const bespoke = composeWeaponCard(input).signature;
      const procedural = composeWeaponCard({ ...input, name: 'Unnamed Roll', legendaryEffectId: undefined }).signature;
      expect(bespoke, id).not.toBe(procedural);
    }
  });

  // The S2 gate (pxlCraftLintGate.test.ts) does not demand zero
  // findings on composed renders: it pins per-system budgets —
  // weapon-card orphan ≤ 20 / jaggy ≤ 6, weapon-pixel orphan ≤ 4 /
  // jaggy ≤ 0 — with pillow, colors, near-duplicate, and banding as
  // hard failures. The 26 bespoke renders are held to exactly those
  // budgets here (the .px.js SOURCES separately lint 0 in the pxl
  // tool; counts are summed per-cell like the gate's checkEntry).
  const countRule = (findings: ReturnType<typeof lintRender>, rule: string) =>
    findings.filter((f) => f.rule === rule).reduce((n, f) => n + f.at.length, 0);

  it('all 26 card renders sit inside the S2 weapon-card budgets (incl. banding)', () => {
    for (const id of ids) {
      const render = composeWeaponCard(representativeInput(id));
      const findings = lintRender(render, id);
      expect(countRule(findings, 'orphan'), id).toBeLessThanOrEqual(20);
      expect(countRule(findings, 'jaggy'), id).toBeLessThanOrEqual(6);
      expect(countRule(findings, 'pillow'), id).toBe(0);
      expect(countRule(findings, 'colors'), id).toBe(0);
      expect(countRule(findings, 'near-duplicate'), id).toBe(0);
      expect(lintBanding(render, id, BANDING_BY_SYSTEM['weapon-card']), id).toEqual([]);
    }
  });

  it('all 26 stage renders sit inside the S2 weapon-pixel budgets', () => {
    for (const id of ids) {
      const render = composePixelWeapon(representativeInput(id));
      const findings = lintRender(render, id);
      expect(countRule(findings, 'orphan'), id).toBeLessThanOrEqual(4);
      expect(countRule(findings, 'jaggy'), id).toBe(0);
      expect(countRule(findings, 'pillow'), id).toBe(0);
      expect(countRule(findings, 'colors'), id).toBe(0);
      expect(countRule(findings, 'near-duplicate'), id).toBe(0);
    }
  });
});
