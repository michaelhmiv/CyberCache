/**
 * Roaming areas — the 7 areas with unlock gates, danger, enemy types,
 * and baseline earning rates. Owner: src/constants/roamingAreas.ts.
 * Drop-pool probability weights are deliberately NOT printed: they are
 * internal tuning the game never surfaces, and this annex prints what
 * the game itself presents (identity and earning rates).
 */
import { ROAMING_AREAS } from '../../src/constants/roamingAreas';
import { type GenBlock, num, table } from './lib';

function areasBody(): string {
  const rows = ROAMING_AREAS.map((a) => [
    `**${a.name}**`,
    a.unlockLevel,
    a.dangerRating,
    a.enemyType,
    a.idleCreditsPerMinute,
    a.idleScrapPerMinute,
    num(a.idleXpPerTick),
    a.materialBias.join(', ') || '—',
    a.lootBias.join(', ') || '—',
    a.manufacturerInfluence,
  ]);
  return [
    'Baseline rates are the area design rates before gear, skills, vehicles, and the hot-area rotation multiply them.',
    '',
    table(
      ['Area', 'Unlock level', 'Danger', 'Enemies', 'Credits/min', 'Scrap/min', 'XP/tick', 'Material bias', 'Signature loot', 'Influence'],
      rows,
    ),
  ].join('\n');
}

export const areasBlock: GenBlock = {
  id: 'areas',
  owners: ['src/constants/roamingAreas.ts'],
  render: areasBody,
};
