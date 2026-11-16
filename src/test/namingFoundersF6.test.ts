/**
 * F6 — manufacturer founders + slogans (world-names audit Decision 2 /
 * §6 row 2; DESIGN.md 2026-11-14 entry item 2, the naming pass's
 * follow-on unit).
 *
 * Copy/data only: the six manufacturers gain a founder (a person, in
 * the hunters' wasteland-outlaw register) and a one-line house slogan
 * (dry — slogans are seen often, so the dosage law keeps them in the
 * Ledger's deadpan register, never ad copy). Both live on the ONE
 * manufacturer def in src/constants/manufacturers.ts; every surface
 * renders from that source:
 *   - gun cards: the shared MakerLine in components/gear/itemStatDeck
 *     (stat deck + GearInspectSheet),
 *   - Manufacturer Standing: buildStandingStateView carries the pair
 *     into RepDeskPanel's per-maker header,
 *   - wiki: the generated Manufacturers table in wiki/Reference.md
 *     (scripts/wiki-gen/weapons.ts reads the same defs) and the
 *     founders passage in wiki/Manufacturer-Standing.md.
 *
 * The mechanics pins at the bottom are the no-mechanics proof at the
 * def level: identity, mechanic, and stat bias are byte-identical to
 * pre-F6 master for all six makers; ids never moved.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MANUFACTURERS } from '../constants/manufacturers';
import { buildStandingStateView } from '../content/manufacturerStanding';
import { Manufacturer } from '../types/game';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIKI_DIR = join(ROOT, '..', 'wiki');

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Every shipped source file under src (tests excluded — they pin strings). */
function shippedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'test') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  walk(ROOT);
  return out;
}

const EXPECTED: Record<Manufacturer, { founder: string; slogan: string }> = {
  [Manufacturer.Redline]: { founder: 'Della Voss', slogan: 'It only gets faster.' },
  [Manufacturer.Ironwood]: { founder: 'Amos Thorne', slogan: 'Ironwood takes its time. Once.' },
  [Manufacturer.BlastForge]: { founder: 'Hollis Brandt', slogan: 'Subtlety was not in the budget.' },
  [Manufacturer.Prismatek]: { founder: 'Iris Calloway', slogan: 'Every element, accounted for.' },
  [Manufacturer.ThrowTech]: { founder: 'Tobin Larkin', slogan: 'Built to be left behind.' },
  [Manufacturer.HelixWorks]: { founder: 'Ada Kessler', slogan: 'No two alike. All of them calibrated.' },
};

describe('F6 · the six founders and their slogans (the def is the one source)', () => {
  it('every manufacturer def carries the pinned founder + slogan', () => {
    for (const m of Object.values(Manufacturer)) {
      const def = MANUFACTURERS[m];
      expect(def.founder, m).toBe(EXPECTED[m].founder);
      expect(def.slogan, m).toBe(EXPECTED[m].slogan);
    }
  });

  it('founders are six distinct people, named like people (two words, no titles)', () => {
    const founders = Object.values(MANUFACTURERS).map((d) => d.founder);
    expect(new Set(founders).size).toBe(6);
    for (const name of founders) {
      expect(name.split(' '), name).toHaveLength(2);
      expect(name).not.toMatch(/^(The|Doctor|Captain|Boss|Chief|Master)\b/);
    }
  });

  it('no founder collides with a person already named in the world', () => {
    // The standing cast: Vesper Cole, Silas Boone, Josie Lode, Doc
    // Sutter, Marla Quill, Harrow, Pell, Gromm. A shared surname would
    // silently imply a relation the world has not written.
    const taken = ['Cole', 'Boone', 'Lode', 'Sutter', 'Quill', 'Harrow', 'Pell', 'Gromm'];
    for (const def of Object.values(MANUFACTURERS)) {
      const surname = def.founder.split(' ')[1];
      expect(taken, def.founder).not.toContain(surname);
    }
  });

  it('slogans are one dry line each — no numbers, no prices, no exclamation', () => {
    for (const def of Object.values(MANUFACTURERS)) {
      expect(def.slogan, def.name).not.toMatch(/[0-9!]/);
      expect(def.slogan.length, def.name).toBeLessThan(45);
    }
  });
});

describe('F6 · the surfaces render from the def', () => {
  it('the standing view carries founder + slogan from the def, per maker', () => {
    const view = buildStandingStateView({
      accountType: 'verified',
      canUsePlayerEconomy: true,
      credits: 0,
      playerLevel: 1,
      rows: [],
      weeklyPurchases: [],
    });
    expect(view.manufacturers).toHaveLength(6);
    for (const m of view.manufacturers) {
      expect(m.founder, m.manufacturer).toBe(MANUFACTURERS[m.manufacturer].founder);
      expect(m.slogan, m.manufacturer).toBe(MANUFACTURERS[m.manufacturer].slogan);
    }
  });

  it('the Rep Desk header prints the pair off the view (m.founder / m.slogan)', () => {
    const panel = readSrc('components/vendor/RepDeskPanel.tsx');
    expect(panel).toContain('m.founder');
    expect(panel).toContain('m.slogan');
  });

  it('gun cards share one MakerLine that reads the def; both card surfaces mount it', () => {
    const deck = readSrc('components/gear/itemStatDeck.tsx');
    expect(deck).toContain('MANUFACTURERS[manufacturer]');
    expect(deck).toContain('def.founder');
    expect(deck).toContain('def.slogan');
    expect(deck).toContain('<MakerLine manufacturer={item.manufacturer} />');
    const sheet = readSrc('components/gear/GearInspectSheet.tsx');
    expect(sheet).toContain('MakerLine');
    expect(sheet).toContain('<MakerLine manufacturer={item.manufacturer} />');
  });

  it('no shipped source file hard-codes a founder name or slogan outside the def', () => {
    const defFile = join(ROOT, 'constants', 'manufacturers.ts');
    const strings = Object.values(MANUFACTURERS).flatMap((d) => [d.founder, d.slogan]);
    for (const file of shippedFiles()) {
      if (file === defFile) continue;
      const text = readFileSync(file, 'utf8');
      for (const s of strings) {
        expect(text, `${file} must render "${s}" from the def, not copy it`).not.toContain(s);
      }
    }
  });

  it('the wiki carries the founders: generated Reference table + the Standing page', () => {
    const reference = readFileSync(join(WIKI_DIR, 'Reference.md'), 'utf8');
    const standing = readFileSync(join(WIKI_DIR, 'Manufacturer-Standing.md'), 'utf8');
    for (const def of Object.values(MANUFACTURERS)) {
      expect(reference, def.name).toContain(def.founder);
      expect(reference, def.name).toContain(def.slogan);
      expect(standing, def.name).toContain(def.founder);
      expect(standing, def.name).toContain(def.slogan);
    }
  });
});

describe('F6 · no mechanics moved (def-level pins, byte-identical to pre-F6 master)', () => {
  it('identity, mechanic, and stat bias are unchanged for all six makers', () => {
    const pins: Record<Manufacturer, { identity: string; mechanic: string; bias: Record<string, number> }> = {
      [Manufacturer.Redline]: {
        identity: 'Attack speed, ramping damage, sustained DPS',
        mechanic: 'Attack speed +15% baked into every roll; its ramping damage is folded into base damage (+8%)',
        bias: { attackSpeed: 1.15, baseDamage: 0.95 },
      },
      [Manufacturer.Ironwood]: {
        identity: 'Crits, precision, boss killing',
        mechanic: 'High crit chance/damage; strong single-target modifiers (+20% crit damage vs bosses)',
        bias: { critChance: 1.2, critDamage: 1.25, baseDamage: 1.05 },
      },
      [Manufacturer.BlastForge]: {
        identity: 'Explosions, splash, stagger, armor cracking',
        mechanic: 'Explosive damage helps armor break and boss phase checks (+25% armor damage)',
        bias: { armorDamageMod: 1.25, baseDamage: 1.1, attackSpeed: 0.9 },
      },
      [Manufacturer.Prismatek]: {
        identity: 'Elemental specialization',
        mechanic: 'Elemental specialization baked into every roll: +30% status chance and status damage, non-Kinetic elements favored',
        bias: { statusChance: 1.3, statusDamage: 1.3, baseDamage: 0.95 },
      },
      [Manufacturer.ThrowTech]: {
        identity: 'Deployables and disposable tech',
        mechanic: 'Deployable-tech frames: +20% wave damage baked into every roll',
        bias: { waveDamageMod: 1.2, baseDamage: 0.9 },
      },
      [Manufacturer.HelixWorks]: {
        identity: 'Modular, flexible, better stat variance',
        mechanic: 'Modular frames: +10 roll quality floor on every roll',
        bias: { baseDamage: 1.0 },
      },
    };
    for (const m of Object.values(Manufacturer)) {
      const def = MANUFACTURERS[m];
      expect(def.identity, m).toBe(pins[m].identity);
      expect(def.mechanic, m).toBe(pins[m].mechanic);
      expect(def.baseStatBias, m).toEqual(pins[m].bias);
    }
  });
});
