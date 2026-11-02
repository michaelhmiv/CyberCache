/**
 * Progression tables — skill-tree node lists and the Cache Rank
 * tracks. Owners: src/constants/skillTrees.ts and
 * src/content/cacheRank.ts. Earning/cost figures are computed with
 * the content module's own functions at the shipped lever defaults,
 * never restated by hand.
 */
import { SKILL_NODES } from '../../src/constants/skillTrees';
import {
  CACHE_RANK_BONUS_DEFS,
  CACHE_RANK_LEVER_DEFAULTS,
  CACHE_RANK_MILESTONE_LEVELS,
  cacheRankEntitlement,
  cacheRankMilestoneBundle,
  cacheRankCostForRank,
  cacheRankTrackCost,
} from '../../src/content/cacheRank';
import { type GenBlock, pct, table } from './lib';

function skillTreesBody(): string {
  const trees: string[] = [];
  for (const node of SKILL_NODES) {
    if (!trees.includes(node.tree)) trees.push(node.tree);
  }
  const parts: string[] = [];
  const totalPoints = SKILL_NODES.reduce((sum, n) => sum + n.cost * n.maxPoints, 0);
  parts.push(
    `The four trees hold **${SKILL_NODES.length} nodes** and **${totalPoints} points** of spending room. A hunter earns 1 point per level from level 2 — **99 points by level 100** — so the trees are deliberately wider than any single build: choosing is the game.`,
  );
  for (const tree of trees) {
    const nodes = SKILL_NODES.filter((n) => n.tree === tree);
    const rows = nodes.map((n) => [
      n.tier,
      `**${n.name}**`,
      n.type,
      n.cost,
      n.maxPoints,
      n.description,
      n.requires?.length ? n.requires.map((r) => nodes.find((x) => x.id === r)?.name ?? r).join(', ') : '—',
    ]);
    parts.push('', `### ${tree}`, '', table(['Tier', 'Node', 'Type', 'Cost', 'Max points', 'Effect', 'Requires'], rows));
  }
  return parts.join('\n');
}

function cacheRankBody(): string {
  const levers = CACHE_RANK_LEVER_DEFAULTS;
  const rows = CACHE_RANK_BONUS_DEFS.map((d) => [
    `**${d.name}**`,
    d.summary,
    `+${pct(levers[d.leverKey])}`,
    d.maxRanks,
    cacheRankTrackCost(d.maxRanks),
  ]);
  const totalMenu = CACHE_RANK_BONUS_DEFS.reduce((sum, d) => sum + cacheRankTrackCost(d.maxRanks), 0);
  const bundles = CACHE_RANK_MILESTONE_LEVELS.map(
    (lvl) => `Level ${lvl}: +${cacheRankMilestoneBundle(lvl)}`,
  ).join(' · ');
  const costCurve = Array.from({ length: 10 }, (_, r) => cacheRankCostForRank(r)).join(', ');
  return [
    `- **Earning:** ${levers.cacheRankTokensPerLevel} token per level gained, plus milestone bundles — ${bundles}. Lifetime earnable by level 100: **${cacheRankEntitlement(100)} tokens**.`,
    `- **Costs:** the next rank on a track costs ${costCurve} across its ten ranks (${cacheRankTrackCost(10)} tokens to max one track). Maxing all ${CACHE_RANK_BONUS_DEFS.length} tracks costs **${totalMenu} tokens** against ${cacheRankEntitlement(100)} earnable — the menu is deliberately wider than the wallet.`,
    '',
    table(['Track', 'Bonus applies to', 'Per rank', 'Max ranks', 'Tokens to max'], rows),
  ].join('\n');
}

export const skillTreesBlock: GenBlock = {
  id: 'skill-trees',
  owners: ['src/constants/skillTrees.ts'],
  render: skillTreesBody,
};

export const cacheRankBlock: GenBlock = {
  id: 'cache-rank',
  owners: ['src/content/cacheRank.ts'],
  render: cacheRankBody,
};
