/**
 * Slice (f) — the naming pass (Cache Hunters brief §4(f), checks F1–F4, F7).
 *
 * Copy/strings only: every id below is pinned unchanged; only display
 * names moved. Two coordinator rulings shape this suite:
 *
 *  - RULING 1 (Ordnance excluded): the two consumable defs named
 *    "Ordnance Charge" are ONE item — the first is the legacy Grenade
 *    save-compat alias (migration 0078; implementationStatus 'legacy',
 *    never player-visible). Neither def is renamed; the F4 census
 *    scopes to player-visible IMPLEMENTED consumables and asserts the
 *    alias arrangement explicitly.
 *  - RULING 2 (Tech proceeds): the material displays "Tech Fragments"
 *    on every surface, superseding the 2026-11-02 "Tech" pin (see the
 *    rewritten techRename.test.ts). The original collision partner,
 *    Cache Fragments, is deleted from the game's face.
 *
 * (f4) Pell was EXCLUDED from slice (f) by coordinator ruling (option
 * C): contract issuance is DB-driven and dispatch has no named-line
 * channel, so a copy-only recurrence could not land, and per the brief
 * the naming did not ship alone. The negative pin that guarded the
 * exclusion is SUPERSEDED by follow-on unit F5 (owner-approved
 * 2026-11-15): the recurrence channel turned out to be the contract
 * template name itself — card titles are composed in code from
 * CONTRACT_TEMPLATES, so a template rename lands on every issued card
 * despite DB-driven issuance. F5 names Pell in the roaming event AND
 * renames the long_haul template to "Pell's Run" in the same slice;
 * the (f4) block below is now the positive F5 census.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '../constants/bosses';
import { CONSUMABLES } from '../constants/consumables';
import { LEGENDARY_EFFECTS } from '../constants/legendaryEffects';
import { SKILL_NODES } from '../constants/skillTrees';
import { ACTION_SKILL_DEFS } from '../content/actionSkills';
import { MARLA_COUNTER_LINES, MARLA_QUILL_NAME, nextMarlaCounterLine, resetMarlaCounterRotation } from '../lib/vendor/marlaVoice';
import { ROAMING_EVENTS } from '../content/roamingEvents';
import { CONTRACT_TEMPLATES, CONTRACT_TEMPLATE_BY_ID } from '../content/contracts';
import { LEGENDARY_ART_PARITY } from './legendaryParityTable';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIKI_DIR = join(ROOT, '..', 'wiki');

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Every shipped source file (src + wiki), for whole-face censuses. */
function shippedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'test') continue; // tests pin strings; they are not shipped content
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  walk(ROOT);
  return out;
}

// ---------------------------------------------------------------- F1
describe('F1 · Marla Quill is the vendor', () => {
  it('the Vendor screen presents Marla Quill as the counter persona', () => {
    const screen = readSrc('screens/VendorScreen.tsx');
    expect(screen).toContain('MARLA_QUILL_NAME');
    expect(MARLA_QUILL_NAME).toBe('Marla Quill');
    expect(screen).toContain('nextMarlaCounterLine');
    expect(screen).toContain('marla-counter-line');
  });

  it('the wiki Vendor page carries her name', () => {
    const page = readFileSync(join(WIKI_DIR, 'Vendor.md'), 'utf8');
    expect(page).toContain('Marla Quill');
  });

  it('no other shipped surface introduces a vendor persona name', () => {
    for (const file of shippedFiles()) {
      const text = readFileSync(file, 'utf8');
      if (file.endsWith('marlaVoice.ts') || file.endsWith('VendorScreen.tsx')) continue;
      expect(text, file).not.toContain('Marla');
    }
  });
});

// ---------------------------------------------------------------- F2
describe('F2 · Marla’s voice rotates; her prices don’t joke', () => {
  it('the pool is fixed at 4–6 Ledger-register lines', () => {
    expect(MARLA_COUNTER_LINES.length).toBeGreaterThanOrEqual(4);
    expect(MARLA_COUNTER_LINES.length).toBeLessThanOrEqual(6);
    expect(MARLA_COUNTER_LINES).toContain('Priced to move. Marla does not say from where.');
    expect(new Set(MARLA_COUNTER_LINES).size).toBe(MARLA_COUNTER_LINES.length);
  });

  it('rotation never repeats inside a session until the pool is exhausted', () => {
    resetMarlaCounterRotation();
    const drawn = Array.from({ length: MARLA_COUNTER_LINES.length }, () => nextMarlaCounterLine());
    expect(new Set(drawn).size).toBe(MARLA_COUNTER_LINES.length);
    expect([...drawn].sort()).toEqual([...MARLA_COUNTER_LINES].sort());
    // Pool exhausted → a fresh cycle begins (still a pool line).
    expect(MARLA_COUNTER_LINES).toContain(nextMarlaCounterLine());
  });

  it('no counter line jokes about a number, price, fee, or credit amount', () => {
    for (const line of MARLA_COUNTER_LINES) {
      expect(line).not.toMatch(/\d/);
      expect(line.toLowerCase()).not.toMatch(/price is|fee is|costs? \d|cr\b/);
    }
  });
});

// ---------------------------------------------------------------- F3
const KEEP_BOSS_NAMES: Record<string, string> = {
  dune_tyrant: 'Harrow, the Dune Tyrant',
  siltstalker: 'The Siltstalker',
  heap_guard: 'Gromm, the Heap Guard',
  ashgut: 'Ashgut',
  mirage_duster: 'The Mirage Duster',
  rust_prophet: 'The Rust Prophet',
  scrap_bishop: 'Scrap Bishop',
  spinneret_widow: 'Widow-9, the Spinneret',
  mnemosyne_mirror: 'The Mnemosyne Mirror',
  static_choir: 'The Static Choir',
  verdant_maw: 'The Verdant Maw',
  sister_null: 'Sister Null, the Void Anchor',
  vaultkeeper_omega: 'Vaultkeeper Omega',
};

/** Boss intel/mechanics projection hashes, pinned from pre-pass master
 *  (92f39ab7): every BossDef field except the display `name` and the
 *  new display-only `dossier`, FNV-1a over the stable JSON. An intel
 *  or mechanics change moves the hash; the naming pass must not. */
const INTEL_HASHES: Record<string, string> = {
  dune_tyrant: 'd6e8ef10',
  siltstalker: '5646ca33',
  heap_guard: '31fab080',
  ashgut: '1d6d1410',
  mirage_duster: '77e83982',
  rust_prophet: '5a3df6ca',
  scrap_bishop: 'a75d4564',
  spinneret_widow: 'cb738539',
  mnemosyne_mirror: 'f2b72712',
  static_choir: '8904932b',
  verdant_maw: '53dbe88e',
  sister_null: '298f13d0',
  vaultkeeper_omega: '468a32d2',
};

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('F3 · Bosses are people; intel is byte-clean', () => {
  it('all 13 bosses present in person+title form, ids unchanged', () => {
    expect(REGION_1_BOSSES).toHaveLength(13);
    for (const boss of REGION_1_BOSSES) {
      expect(KEEP_BOSS_NAMES[boss.id], boss.id).toBeDefined();
      expect(boss.name).toBe(KEEP_BOSS_NAMES[boss.id]);
    }
  });

  it('each boss carries exactly one dossier line — persona, no win-intel', () => {
    for (const boss of REGION_1_BOSSES) {
      expect(typeof boss.dossier, boss.id).toBe('string');
      expect(boss.dossier!.length, boss.id).toBeGreaterThan(10);
      expect(boss.dossier!, boss.id).not.toMatch(/win|chance|ready|odds|beat it|survive/i);
    }
    expect(REGION_1_BOSSES.find((b) => b.id === 'vaultkeeper_omega')?.dossier).toBe(
      'It has counted every key ever spent. It would like yours back.',
    );
    // One line each: no dossier text repeats across bosses.
    const lines = REGION_1_BOSSES.map((b) => b.dossier);
    expect(new Set(lines).size).toBe(13);
  });

  it('the prep surface renders the dossier line', () => {
    const panel = readSrc('components/fight/BossEncounterPanel.tsx');
    expect(panel).toContain('boss.dossier');
    expect(panel).toContain('boss-dossier');
  });

  it('intel/mechanics fields are hash-identical to pre-pass master', () => {
    for (const boss of REGION_1_BOSSES) {
      const { name: _name, dossier: _dossier, ...intel } = boss;
      expect(fnv1a(JSON.stringify(intel)), boss.id).toBe(INTEL_HASHES[boss.id]);
    }
  });
});

// ---------------------------------------------------------------- F4
describe('F4 · Clash pass — zero remainder (Ruling 1 scoping)', () => {
  it('“Insurance Fraud” names the legendary effect only; the node is Fine Print', () => {
    const named = [
      ...LEGENDARY_EFFECTS.filter((e) => e.name === 'Insurance Fraud'),
      ...SKILL_NODES.filter((n) => n.name === 'Insurance Fraud'),
      ...Object.values(CONSUMABLES).filter((c) => c.name === 'Insurance Fraud'),
    ];
    expect(named).toHaveLength(1);
    expect(LEGENDARY_EFFECTS.find((e) => e.id === 'insurance_fraud_weapon')?.name).toBe('Insurance Fraud');
    const node = SKILL_NODES.find((n) => n.id === 'scav_major_2');
    expect(node?.name).toBe('Fine Print');
  });

  it('no fuel cell is “Generic”; the crafted Fuel Cell keeps its name; Jerrican is the baseline cell', () => {
    const names = Object.values(CONSUMABLES).map((c) => c.name);
    expect(names).not.toContain('Generic Fuel Cell');
    expect(names.filter((n) => n === 'Fuel Cell')).toHaveLength(1);
    expect(CONSUMABLES.GenericFuelCell?.name).toBe('Jerrican');
  });

  it('Ordnance (Ruling 1): the implemented staple keeps its name exactly once among implemented consumables; the second def is the invisible legacy alias', () => {
    const implemented = Object.values(CONSUMABLES).filter((c) => c.implementationStatus === 'implemented');
    expect(implemented.filter((c) => c.name === 'Ordnance Charge')).toHaveLength(1);
    expect(CONSUMABLES.OrdnanceCharge?.name).toBe('Ordnance Charge');
    expect(CONSUMABLES.OrdnanceCharge?.implementationStatus).toBe('implemented');
    // The alias: same display name, legacy status, boss-prep invisible —
    // the migration-0078 save-compat arrangement, documented not renamed.
    expect(CONSUMABLES.Grenade?.name).toBe('Ordnance Charge');
    expect(CONSUMABLES.Grenade?.implementationStatus).toBe('legacy');
    expect(CONSUMABLES.Grenade?.isBossPrepVisible).toBe(false);
  });

  it('no two player-visible implemented consumables share a name', () => {
    const implemented = Object.values(CONSUMABLES).filter((c) => c.implementationStatus === 'implemented');
    const names = implemented.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the crafter keystone is not “The Fixer” — it is Sutter’s Hands, id unchanged', () => {
    expect(SKILL_NODES.find((n) => n.id === 'fix_keystone')?.name).toBe("Sutter's Hands");
    expect(SKILL_NODES.some((n) => n.name === 'The Fixer')).toBe(false);
  });

  it('no effect is named “Overclocked” — it is Runaway, id unchanged; the Overclock skill and Overclock Serum keep their names', () => {
    expect(LEGENDARY_EFFECTS.some((e) => e.name === 'Overclocked')).toBe(false);
    expect(LEGENDARY_EFFECTS.find((e) => e.id === 'overclocked')?.name).toBe('Runaway');
    expect(Object.values(ACTION_SKILL_DEFS).map((d) => d.name)).toContain('Overclock');
    expect(Object.values(CONSUMABLES).some((c) => c.name === 'Overclock Serum')).toBe(true);
  });

  it('the material displays “Tech Fragments” (full pin lives in techRename.test.ts)', () => {
    // Spot pin here so F4 stands alone; techRename.test.ts carries the census.
    expect(readSrc('content/gameContent.ts')).toContain("id: 'tech_fragments', name: 'Tech Fragments'");
  });
});

// ------------------------------------------------------- (f4) → F5 Pell
// Supersedes the slice-(f) exclusion pin (see the header note): F5 ships
// the naming WITH the recurrence, per the audit's honesty condition —
// ≥2 player-visible surfaces or he is orphan #4.
describe('(f4) → F5 · Pell is named in the event and recurs on the board', () => {
  it('the Wounded Scavenger event names Pell (id unchanged)', () => {
    const ev = ROAMING_EVENTS.find((e) => e.id === 'dustwaste_wounded_scavenger');
    expect(ev).toBeDefined();
    expect(ev!.name).toBe('Pell, the Wounded Scavenger');
    expect(ev!.blurb).toContain('Pell flags you down, wounded.');
    // The story thread: Josie Lode's people owe him a debt.
    expect(ev!.blurb).toContain("Josie Lode's people still owe him.");
  });

  it("the long_haul contract template is Pell's Run (id unchanged)", () => {
    expect(CONTRACT_TEMPLATE_BY_ID.get('long_haul')!.name).toBe("Pell's Run");
    // Exactly one template carries his name — the recurrence is his alone.
    expect(CONTRACT_TEMPLATES.filter((t) => /\bPell\b/.test(t.name))).toHaveLength(1);
  });

  it('census: “Pell” lives on exactly the intended shipped surfaces', () => {
    const hits = shippedFiles().filter((file) => /\bPell\b/.test(readFileSync(file, 'utf8')));
    const rel = hits.map((file) => file.slice(ROOT.length + 1)).sort();
    expect(rel).toEqual(['content/contracts.ts', 'content/roamingEvents.ts', 'server/chef.ts']);
    // …and the two wiki pages that tell his story.
    expect(readFileSync(join(WIKI_DIR, 'Contracts.md'), 'utf8')).toMatch(/\bPell\b/);
    expect(readFileSync(join(WIKI_DIR, 'Actions-and-Occupations.md'), 'utf8')).toMatch(/\bPell\b/);
  });
});

// ---------------------------------------------------------------- F7
describe('F7 · Emberfall stays parked', () => {
  it('no legendary effect def claims Emberfall and no effect is named for it', () => {
    expect(LEGENDARY_EFFECTS.some((e) => e.name === 'Emberfall')).toBe(false);
    expect(LEGENDARY_EFFECTS.some((e) => e.id.toLowerCase().includes('emberfall'))).toBe(false);
  });

  it('the parity table keeps Emberfall exactly as before: name-keyed proof art, no effect, never minted', () => {
    const row = LEGENDARY_ART_PARITY.find((r) => r.name === 'Emberfall');
    expect(row).toBeDefined();
    expect(row!.effectId).toBeNull();
  });
});
