/**
 * Legendary effects — all 25, with the honest implementation status.
 *
 * Names, descriptions, sources, and tier gates come from the defs in
 * src/constants/legendaryEffects.ts. The STATUS column is derived
 * from src/lib/legendaryEffects.ts, which declares itself "the honest
 * map": every case in applyLegendaryEffects() is labelled by its own
 * comments — SIM PROXY (a flat approximation of a mechanic that does
 * not exist), PART WIRED / no-counterpart (partial), ELSEWHERE (fully
 * implemented in the Chef/SQL paths, a deliberate no-op in the sim),
 * or a plain wired multiplier (fully live). This generator parses
 * those labels out of the case comments; if a future edit rewords a
 * label, the rendered status changes with it and the freshness gate
 * surfaces the diff for review — the status can never silently drift
 * from the file that owns the honesty call.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGENDARY_EFFECTS } from '../../src/constants/legendaryEffects';
import { type GenBlock, REPO_ROOT, table } from './lib';

type Status = 'Fully live' | 'Simulated proxy' | 'Partial';

function classify(caseText: string): Status {
  if (/SIM PROXY/.test(caseText)) return 'Simulated proxy';
  if (/PART WIRED|PART PROXY|no counterpart/.test(caseText)) return 'Partial';
  return 'Fully live';
}

function statusByEffectId(): Map<string, Status> {
  const source = readFileSync(join(REPO_ROOT, 'src/lib/legendaryEffects.ts'), 'utf8');
  const switchStart = source.indexOf('switch (effect.id)');
  if (switchStart < 0) throw new Error('legendaryEffects: applyLegendaryEffects switch not found');
  let body = source.slice(switchStart);
  // Bound the scan at the function's return so the helper functions
  // below the switch can never bleed comments into the last case.
  const returnAt = body.indexOf('\n  return {');
  if (returnAt > 0) body = body.slice(0, returnAt);
  const caseRe = /case '([a-z0-9_]+)':/g;
  const positions: { id: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(body)) !== null) {
    if (positions.length) positions[positions.length - 1].end = m.index;
    positions.push({ id: m[1], start: m.index, end: body.length });
  }
  const out = new Map<string, Status>();
  for (const pos of positions) {
    out.set(pos.id, classify(body.slice(pos.start, pos.end)));
  }
  return out;
}

const SOURCE_LABELS: Record<string, string> = {
  BossDrop: 'Boss drops',
  CacheForged: 'Cache-forged (eligible — see note)',
};

function effectsBody(): string {
  const statuses = statusByEffectId();
  const rows = LEGENDARY_EFFECTS.map((e) => {
    const status = statuses.get(e.id);
    if (!status) throw new Error(`legendaryEffects: no applyLegendaryEffects case found for '${e.id}'`);
    return [
      `**${e.name}**`,
      e.description,
      e.eligibleSources.map((s) => SOURCE_LABELS[s] ?? s).join(' + '),
      e.minBossTier ?? 1,
      status,
    ];
  });
  return table(['Effect', 'What it does', 'Source', 'Min boss tier', 'Status'], rows);
}

export const legendaryEffectsBlock: GenBlock = {
  id: 'legendary-effects',
  owners: ['src/constants/legendaryEffects.ts', 'src/lib/legendaryEffects.ts'],
  render: effectsBody,
};
