/**
 * Boss roster — INTEL ONLY, following the line the Bosses page and
 * the boss-intel law draw: stats, mechanics, phases, and the
 * counters the prep screen itself recommends. Nothing here prints
 * drop odds, win chance, or pity numbers — the generic drop table is
 * deliberately omitted; only each boss's dedicated drops (which the
 * prep screen and Collections both name) are listed.
 * Owner: src/constants/bosses.ts (effect names resolve through
 * src/constants/legendaryEffects.ts). W6: each section also carries
 * the boss's bespoke sprite plate and its arena painting, resolved
 * through the game's own art maps by images-w6.ts.
 */
import { REGION_1_BOSSES } from '../../src/constants/bosses';
import type { BossDef } from '../../src/types/boss';
import { LEGENDARY_EFFECTS } from '../../src/constants/legendaryEffects';
import { type GenBlock, listOrDash } from './lib';
import { bossArenaImgTag, bossPlates, bossSpriteImgTag } from './images-w6';

function effectName(id: string): string {
  return LEGENDARY_EFFECTS.find((e) => e.id === id)?.name ?? id;
}

function bossSection(b: BossDef): string {
  const lines: string[] = [
    `### ${b.name} — Tier ${b.tier}`,
    '',
    bossSpriteImgTag(b),
    '',
    `- **Boss level:** ${b.level} · **Recommended power:** ${b.recommendedPower}`,
    `- **Health / Shield / Armor:** ${b.health} / ${b.shield} / ${b.armor} · **Boss DPS:** ${b.dps}`,
    `- **Weaknesses:** ${listOrDash([...b.weaknesses])} · **Resistances:** ${listOrDash([...b.resistances])}`,
    `- **Mechanic — ${b.mechanic.name}:** ${b.mechanic.description}`,
    ...(b.cadence
      ? [
          `- **Attack pattern:** hits every ${b.cadence.hitIntervalSeconds}s; special **${b.cadence.specialName}** every ${b.cadence.specialEverySeconds}s after a ${b.cadence.windupSeconds}s wind-up, carrying ~${Math.round(b.cadence.specialShare * 100)}% of its damage`,
        ]
      : []),
    `- **Entry / rematch:** ${b.entryCost} cr / ${b.rematchCost} cr`,
    `- **Dedicated drops:** ${listOrDash((b.dedicatedDrops ?? []).map(effectName))}`,
    '',
    '**Phases**',
    '',
    ...b.phases.map(
      (p) => `- **${p.name}** (${p.type} check) — ${p.description} Counters: ${p.recommendedCounters.join(', ')}.`,
    ),
    '',
    '**The arena** — every boss fights on its own ground:',
    '',
    bossArenaImgTag(b),
  ];
  return lines.join('\n');
}

function bossesBody(): string {
  return REGION_1_BOSSES.map(bossSection).join('\n\n');
}

export const bossesBlock: GenBlock = {
  id: 'bosses',
  owners: ['src/constants/bosses.ts', 'src/content/areaPalettes.ts', 'src/lib/pixel/manifest.ts'],
  render: bossesBody,
  assets: bossPlates,
};
