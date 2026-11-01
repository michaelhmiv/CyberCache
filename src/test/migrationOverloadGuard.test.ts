/**
 * Migration overload guard (hotfix 0039).
 *
 * THE INCIDENT: migration 0021 restated cc_store_chef_items as
 * (uuid, jsonb, text default 'chef_claim') without dropping the
 * 2-arg original from 0007. Both overloads stayed live, and every
 * TypeScript call site — which passes UNTYPED parameters — became
 * ambiguous to Postgres: "function cc_store_chef_items(unknown,
 * unknown) is not unique". Boss attempts 500'd and no roaming /
 * endless / offline gear drop could be stored, from 0021 until the
 * 0039 drop. SQL-internal callers never noticed (typed arguments
 * resolve exactly), and the SQL-driven slice harnesses stayed green.
 *
 * THE INVARIANT: simulating the migration chain in order (a CREATE
 * OR REPLACE adds its exact signature; a DROP FUNCTION removes one),
 * no function name may end with two live signatures where one is a
 * strict prefix of the other AND every extra argument of the longer
 * signature carries a DEFAULT. That pair is exactly the set Postgres
 * cannot resolve for a call with the shorter argument count.
 *
 * Signatures that differ only by appended NON-defaulted arguments
 * are fine (resolution is by exact count) and are common in this
 * codebase's applier family — this test must not flag them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(__dirname, '../..', 'db', 'migrations');

const KNOWN_TYPES = new Set([
  'uuid', 'text', 'jsonb', 'json', 'integer', 'int', 'bigint', 'smallint',
  'boolean', 'bool', 'numeric', 'decimal', 'real', 'float', 'double',
  'date', 'time', 'timestamp', 'timestamptz', 'interval', 'bytea',
  'void', 'record', 'void[]', 'text[]', 'uuid[]', 'integer[]', 'bigint[]',
  'jsonb[]', 'anyelement', 'varchar', 'char', 'character',
]);

interface ArgSig {
  type: string;
  hasDefault: boolean;
}

interface FnSig {
  args: ArgSig[];
}

/** Split a parenthesised argument list at top-level commas. */
function splitArgs(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of raw) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Extract the balanced (...) that starts at index `open`. */
function balanced(sql: string, open: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return { inner: sql.slice(open + 1, i), end: i };
    }
  }
  throw new Error('unbalanced parentheses in migration SQL');
}

/** Normalise one CREATE-side argument to { type, hasDefault }. */
function parseCreateArg(arg: string): ArgSig {
  const hasDefault = /\bdefault\b/i.test(arg);
  const noDefault = arg.replace(/\bdefault\b[\s\S]*$/i, '').trim();
  const tokens = noDefault.split(/\s+/);
  let typeTokens = tokens;
  if (tokens.length > 1) {
    const first = tokens[0].toLowerCase().replace(/\[\]$/, '');
    // A leading token that is not a known type is the parameter name.
    if (!KNOWN_TYPES.has(first)) typeTokens = tokens.slice(1);
  }
  return { type: typeTokens.join(' ').toLowerCase(), hasDefault };
}

/** Normalise one DROP-side argument (types only, no names/defaults). */
function parseDropArg(arg: string): ArgSig {
  return { type: arg.trim().toLowerCase().replace(/\s+/g, ' '), hasDefault: false };
}

function sigKey(sig: FnSig): string {
  return sig.args.map((a) => a.type).join(', ');
}

function simulateChain(): Map<string, Map<string, FnSig>> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const live = new Map<string, Map<string, FnSig>>();
  const createRe = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi;
  const dropRe = /drop\s+function\s+(?:if\s+exists\s+)?public\.(\w+)\s*\(/gi;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const events: { at: number; kind: 'create' | 'drop'; name: string; sig: FnSig }[] = [];
    for (const [re, kind] of [[createRe, 'create'], [dropRe, 'drop']] as const) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql)) !== null) {
        const open = m.index + m[0].length - 1;
        const { inner } = balanced(sql, open);
        const args = splitArgs(inner).map(kind === 'create' ? parseCreateArg : parseDropArg);
        events.push({ at: m.index, kind, name: m[1].toLowerCase(), sig: { args } });
      }
    }
    events.sort((a, b) => a.at - b.at);
    for (const ev of events) {
      if (!live.has(ev.name)) live.set(ev.name, new Map());
      const sigs = live.get(ev.name)!;
      if (ev.kind === 'create') sigs.set(sigKey(ev.sig), ev.sig);
      else sigs.delete(sigKey(ev.sig));
    }
  }
  return live;
}

/** True when `shorter` is a strict type-prefix of `longer` and every
 * extra argument of `longer` has a default (the ambiguity shape). */
function isAmbiguousPair(shorter: FnSig, longer: FnSig): boolean {
  if (shorter.args.length >= longer.args.length) return false;
  for (let i = 0; i < shorter.args.length; i += 1) {
    if (shorter.args[i].type !== longer.args[i].type) return false;
  }
  return longer.args.slice(shorter.args.length).every((a) => a.hasDefault);
}

describe('migration overload guard', () => {
  it('leaves no ambiguous overload pair live at the end of the chain', () => {
    const live = simulateChain();
    const offenders: string[] = [];
    for (const [name, sigs] of live) {
      const list = [...sigs.values()];
      for (const a of list) {
        for (const b of list) {
          if (a !== b && isAmbiguousPair(a, b)) {
            offenders.push(
              `${name}: (${sigKey(a)}) is shadowed by (${sigKey(b)}) whose extra args all default`,
            );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps exactly one cc_store_chef_items signature live (the 0039 regression)', () => {
    const live = simulateChain();
    const sigs = live.get('cc_store_chef_items');
    expect(sigs).toBeDefined();
    expect([...sigs!.keys()]).toEqual(['uuid, jsonb, text']);
  });
});
