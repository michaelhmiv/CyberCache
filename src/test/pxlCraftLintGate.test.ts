/**
 * Pxl Craft Sweep S2 — the lint gate (the pxl-craft skill's
 * enforcement arm; governing skill: ~/workspace/custom-skills/
 * pxl-craft, adapted from uilianks/pxl, MIT).
 *
 * Every composited render in the seeded corpus (pxlLintCorpus.ts
 * — real generated items, pinned seeds, every in-scope system at
 * every density it ships) is judged by the ported pxl lint
 * (pixelLint.ts: orphan / jaggy / pillow / colors /
 * near-duplicate, upstream semantics) plus the homegrown banding
 * rule (lintBanding: marching strips + ramp hue travel +
 * derived-step rotation).
 *
 * CALIBRATION — read before touching a number.
 *
 * Banding asserts ZERO findings on the in-scope systems. It is
 * the rule that bites on pre-S1 art: run against renders from
 * master a49d9e5 (the pre-S1 base), the identical corpus produces
 * 386 banding findings (every gear / consumable / material ramp
 * travelling ~0° of hue; 149 un-rotated derived steps on the
 * weapon card; marching strips on shields, class mods, relics).
 * Post-S1 it produces none. Full table: S2-BITE.md in
 * ~/workspace/cybercache-prep/pxl-craft-sweep/.
 *
 * Orphan and jaggy assert per-system BUDGETS — the per-render
 * maxima measured on the S1-trained master this gate landed on,
 * pinned with zero headroom. An absolute-zero orphan rule would
 * condemn this repo's sanctioned detail grammar: DESIGN.md §8
 * names single-texel rivets, vents and stripes as the detail
 * language, and the relic SALVAGE pass (the census's craft
 * exemplar) textures with deliberate single tone cells. pxl's
 * semantics are kept verbatim; the gate freezes the trained
 * baseline instead, so any NEW stray cell or doubled corner
 * beyond it fails. (Pre-S1, ordnance and relic orphan maxima
 * exceed these budgets — the gate fails on the old base through
 * those rules too. Jaggy does not bite on S1: selout's shade
 * transitions created as many thin components as they removed.
 * It guards forward.)
 *
 * Pillow asserts zero EXCEPT the three allowlisted renders
 * below. Near-duplicate asserts zero EXCEPT the two allowlisted
 * key pairs below. Every allowlist entry names its reason; an
 * allowlist is scoped to one render (and one key pair), so any
 * new firing anywhere else still fails.
 *
 * The weapon PIXEL path answers to the pxl rules but is out of
 * banding scope — see BANDING_BY_SYSTEM in pxlLintCorpus.ts for
 * the recorded reason (palette pinned by palette law; forms
 * retire with One Grammar).
 */
import { describe, expect, it } from 'vitest';
import { BANDING_BY_SYSTEM, buildCorpus, type CorpusEntry } from './pxlLintCorpus';
import { lintBanding, lintRender, type LintFinding, type LintRender } from './pixelLint';

const corpus = buildCorpus();
const bySystem = new Map<string, CorpusEntry[]>();
for (const entry of corpus) {
  const list = bySystem.get(entry.system) ?? [];
  list.push(entry);
  bySystem.set(entry.system, list);
}

/** Per-render orphan / jaggy ceilings — post-S1 measured maxima. */
const BUDGETS: Record<string, { orphan: number; jaggy: number }> = {
  'weapon-pixel': { orphan: 4, jaggy: 0 },
  'weapon-card': { orphan: 20, jaggy: 6 },
  'gear-shield': { orphan: 11, jaggy: 3 },
  'gear-ordnance': { orphan: 2, jaggy: 0 },
  'gear-classMod': { orphan: 9, jaggy: 0 },
  'gear-relic': { orphan: 185, jaggy: 3 },
  consumable: { orphan: 11, jaggy: 3 },
  material: { orphan: 15, jaggy: 0 },
};

/**
 * Pillow allowlist — render id → reason. The flagged family in
 * each is the Shock element core of a Legendary card render:
 * brightness centered in the conduit window is the emissive
 * design (hard-edged glow, DESIGN.md §8), not form shading.
 * pxl's pillow rule judges form shading; it has no emissive
 * exemption, so the exemption lives here, named, one render at
 * a time.
 */
const PILLOW_ALLOWLIST: Record<string, string> = {
  'weapon-card/weapon/Pistol/Shock/Legendary': 'emissive Shock conduit core',
  'weapon-card/weapon/SMG/Shock/Legendary': 'emissive Shock conduit core',
  'weapon-card/weapon/Launcher/Shock/Legendary': 'emissive Shock conduit core',
};

/**
 * Near-duplicate allowlist — render id → the exempt key pair.
 * Both pairs pit a system/registry identity hex against a
 * trained derivation that lands within pxl's < 10 RGB distance:
 * palette law (game hexes are identity) forbids moving either
 * side to satisfy the metric.
 *  - MasterPatchKit K~D: the small-item ink (#1A110A) vs the
 *    body ramp's deep step of that kit's dark-brown body
 *    (#1f110d) — two near-blacks; at that depth they read as
 *    one because everything does.
 *  - MagnetiteCores A~L: the registry accent hex (#CFD8DC, the
 *    material's identity color) vs its own body ramp's pale
 *    step (#d4ddde).
 */
const NEARDUP_ALLOWLIST: Record<string, [string, string]> = {
  'consumable/MasterPatchKit': ['K', 'D'],
  'material/MagnetiteCores': ['A', 'L'],
};

function keyForHex(render: LintRender, hex: string): string | null {
  for (const [key, value] of Object.entries(render.colors)) {
    if (value === hex) return key;
  }
  return null;
}

function checkEntry(entry: CorpusEntry): string[] {
  const problems: string[] = [];
  const findings = lintRender(entry.render, entry.id);
  const budget = BUDGETS[entry.system];
  const count = (rule: string) =>
    findings.filter((f) => f.rule === rule).reduce((n, f) => n + f.at.length, 0);

  const orphans = count('orphan');
  if (orphans > budget.orphan) {
    problems.push(`orphan count ${orphans} exceeds the trained baseline budget ${budget.orphan}`);
  }
  const jaggies = count('jaggy');
  if (jaggies > budget.jaggy) {
    problems.push(`jaggy count ${jaggies} exceeds the trained baseline budget ${budget.jaggy}`);
  }
  for (const f of findings) {
    if (f.rule === 'pillow' && !(entry.id in PILLOW_ALLOWLIST)) {
      problems.push(f.message);
    }
    if (f.rule === 'colors') problems.push(f.message);
    if (f.rule === 'near-duplicate') {
      const exempt = NEARDUP_ALLOWLIST[entry.id];
      for (const [a, b] of f.pairs ?? []) {
        const ka = keyForHex(entry.render, a);
        const kb = keyForHex(entry.render, b);
        const isExempt =
          exempt && ((ka === exempt[0] && kb === exempt[1]) || (ka === exempt[1] && kb === exempt[0]));
        if (!isExempt) problems.push(f.message);
      }
    }
  }

  const bandingOpts = BANDING_BY_SYSTEM[entry.system];
  if (bandingOpts) {
    for (const f of lintBanding(entry.render, entry.id, bandingOpts)) {
      problems.push(f.message);
    }
  }
  return problems;
}

describe('pxl lint gate — corpus coverage', () => {
  it('spans every in-scope system at its shipped densities', () => {
    const expected: Record<string, number> = {
      'weapon-pixel': 72,
      'weapon-card': 72,
      'gear-shield': 24,
      'gear-ordnance': 20,
      'gear-classMod': 20,
      'gear-relic': 20,
      consumable: 86,
      material: 52,
    };
    for (const [system, count] of Object.entries(expected)) {
      expect(bySystem.get(system)?.length, system).toBe(count);
    }
    expect(corpus.length).toBe(366);
  });
});

describe('pxl lint gate — the corpus is clean under the standard', () => {
  for (const [system, entries] of bySystem) {
    it(`${system}: ${entries.length} renders within budget, no unlisted defects`, () => {
      const problems: string[] = [];
      for (const entry of entries) {
        for (const p of checkEntry(entry)) problems.push(`${entry.id}: ${p}`);
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});

describe('pxl lint gate — the detectors are not vacuous (synthetic defects)', () => {
  const grid = (rows: string[], colors: Record<string, string>): LintRender => ({
    width: rows[0].length,
    height: rows.length,
    rows,
    colors,
  });

  it('orphan: a lone low-contrast cell inside a shape is flagged', () => {
    const render = grid(
      ['.....', '.PPP.', '.PdP.', '.PPP.', '.....'],
      { P: '#B35000', d: '#A34D02' },
    );
    const findings: LintFinding[] = lintRender(render, 'synthetic');
    expect(findings.some((f) => f.rule === 'orphan')).toBe(true);
  });

  it('near-duplicate: two hexes closer than 10 are flagged', () => {
    const render = grid(['PP', 'PP'], { P: '#B35000', d: '#B35001' });
    // Two keys, one hex each in the map but only P drawn: use both.
    render.rows = ['Pd', 'dP'];
    const findings = lintRender(render, 'synthetic');
    expect(findings.some((f) => f.rule === 'near-duplicate')).toBe(true);
  });

  it('banding clause 2: a straight-lerp ramp (0° travel) is flagged; a hue-shifted one is not', () => {
    const straight = grid(['DdPpL'], {
      D: '#331d00', d: '#663a00', P: '#995700', p: '#cc7400', L: '#f09c26',
    });
    const opts = { rampGroups: [['D', 'd', 'P', 'p', 'L']] };
    expect(lintBanding(straight, 'synthetic', opts).some((f) => f.rule === 'banding')).toBe(true);
    const shifted = grid(['DdPpL'], {
      D: '#241538', d: '#4a2a6e', P: '#995700', p: '#e09a2b', L: '#f6e27a',
    });
    expect(lintBanding(shifted, 'synthetic', opts)).toEqual([]);
  });
});
