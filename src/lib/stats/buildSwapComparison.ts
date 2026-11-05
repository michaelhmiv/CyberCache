/**
 * buildSwapComparison — "The Trade": what a gear swap actually
 * does to the build.
 *
 * Pure. Takes two ALREADY-ASSEMBLED summary inputs (current loadout
 * and the candidate loadout, both from assembleStatSummaryInput so
 * the class-mod boost fold is identical on both sides) and diffs
 * the two character stat summaries + mechanics snapshots metric by
 * metric, plus the non-numeric consequences no metric can carry:
 * legendary effects lost/gained (name AND description — an effect
 * is the item's identity, not a number), affixes by displayText,
 * class-mod node boosts by node name, action-skill qualification
 * crossings, and neutral identity changes (element, shield
 * behavior, ordnance effect).
 *
 * Presentation law (DESIGN.md §9 numbers-emphasis, memo §3): only
 * CHANGED lines print; the candidate's RESULTING value is the hero
 * and the signed delta sits beside it; gains and losses are
 * separate groups; when nothing numeric changes the answer is an
 * honest "No build change", never a wall of '=' rows.
 *
 * FREEZE RULE: this runs summary+snapshot math TWICE (once per
 * side). It is called only from an opened inspect sheet, memoized
 * there — never from a list, picker, or market row.
 */
import type { GearItem, Weapon } from '@/types/items';
import type { CharacterStatSummaryInput, StatMetric } from './characterStats';
import { buildCharacterStatSummary } from './characterStats';
import { buildCharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { stageStatDelta } from './heroRundown';
import { formatSignedPct, formatWhole } from './formatStat';
import { LEGENDARY_EFFECTS, legendaryEffectName } from '@/constants/legendaryEffects';
import { SKILL_NODES } from '@/constants/skillTrees';
import { ACTION_SKILL_DEFS } from '@/content/actionSkills';
import { SHIELD_BEHAVIORS, shieldBehaviorOf } from '@/lib/combat/shieldBehaviors';

export interface TradeMetricLine {
  kind: 'metric';
  label: string;
  /** The candidate's resulting value — the hero number. */
  hero: string;
  /** Signed delta beside the hero (e.g. "+8%", "-30"). */
  delta: string;
  tone: 'gain' | 'loss';
}

export interface TradeNoteLine {
  kind: 'note';
  label: string;
  text: string;
  tone: 'gain' | 'loss' | 'neutral';
}

export type TradeLine = TradeMetricLine | TradeNoteLine;

export interface SwapComparison {
  gains: TradeLine[];
  losses: TradeLine[];
  neutrals: TradeNoteLine[];
  /** True when any metric or gain/loss note changed. */
  hasBuildChange: boolean;
}

export interface SwapComparisonFacts {
  currentItem: GearItem | undefined;
  candidateItem: GearItem;
  /** Raw skill spends (the same map both assembled inputs started from). */
  spent: Record<string, number>;
  /** Qualified action-skill trees on each side (qualifiedActionSkillTrees). */
  currentQualified: string[];
  candidateQualified: string[];
}

/** Metrics whose delta reads as a percentage OF the current value. */
const RATIO_METRIC_KEYS = new Set(['health', 'dps', 'shieldBreak', 'armorBreak', 'ordnance']);

function metricKey(metric: StatMetric): string {
  return metric.sourceActivity ? `${metric.key}:${metric.sourceActivity}` : metric.key;
}

function legendaryDescription(effectId: string): string | undefined {
  // LEGENDARY_EFFECTS is the definition table; legendaryEffectName
  // resolves the name. Description lookup stays local to the same
  // table so the trade never invents effect text.
  return LEGENDARY_EFFECT_LOOKUP.get(effectId);
}

const LEGENDARY_EFFECT_LOOKUP = new Map(LEGENDARY_EFFECTS.map((def) => [def.id, def.description]));

export function buildSwapComparison(
  currentInput: CharacterStatSummaryInput,
  candidateInput: CharacterStatSummaryInput,
  facts: SwapComparisonFacts,
): SwapComparison {
  const current = buildCharacterStatSummary(currentInput);
  const candidate = buildCharacterStatSummary(candidateInput);
  const currentSnapshot = buildCharacterMechanicsSnapshot(currentInput);
  const candidateSnapshot = buildCharacterMechanicsSnapshot(candidateInput);

  const gains: TradeLine[] = [];
  const losses: TradeLine[] = [];
  const neutrals: TradeNoteLine[] = [];

  // ── Metric lines ────────────────────────────────────────────────
  const currentByKey = new Map(current.all.map((metric) => [metricKey(metric), metric]));
  for (const cand of candidate.all) {
    if (cand.key === 'boss') continue; // the sim sibling of dps — never a trade line
    const cur = currentByKey.get(metricKey(cand));
    if (!cur) continue;
    if (RATIO_METRIC_KEYS.has(cand.key)) {
      const staged = stageStatDelta(cur.value, cand.value);
      if (!staged) {
        // Zero base (empty slot — the build has none of this yet):
        // a percentage of zero is meaningless, but the gain is
        // real. The hero carries the value; the delta says "New".
        if (cur.value === 0 && cand.value > 0) {
          gains.push({
            kind: 'metric',
            label: cand.key === 'dps' ? (currentInput.boss ? 'Eff. DPS' : 'DPS') : cand.label,
            hero: cand.key === 'health' ? formatWhole(cand.value) : cand.display,
            delta: 'New',
            tone: 'gain',
          });
        }
        continue;
      }
      const line: TradeMetricLine = {
        kind: 'metric',
        // The summary names its dps metric 'Base DPS' / 'Effective
        // DPS'; the trade speaks the rundown's words (heroRundown:
        // 'DPS', 'Eff. DPS' in boss context) — the value itself is
        // already boss-priced when the inputs carry a boss.
        label: cand.key === 'dps' ? (currentInput.boss ? 'Eff. DPS' : 'DPS') : cand.label,
        // HP's own display carries a vs-base suffix; the hero is the value itself.
        hero: cand.key === 'health' ? formatWhole(cand.value) : cand.display,
        delta: staged.display,
        tone: staged.tone === 'green' ? 'gain' : 'loss',
      };
      (line.tone === 'gain' ? gains : losses).push(line);
    } else {
      // Modifier metric: the delta is signed percentage POINTS.
      const diff = cand.value - cur.value;
      const deltaText = formatSignedPct(diff);
      if (deltaText === '+0%' || deltaText === '-0%' || deltaText === '0%') continue;
      const line: TradeMetricLine = {
        kind: 'metric',
        label: cand.label,
        hero: cand.display,
        delta: deltaText,
        tone: diff > 0 ? 'gain' : 'loss',
      };
      (line.tone === 'gain' ? gains : losses).push(line);
    }
  }

  // XP lives in the snapshot, not the summary — the trade prices
  // it too (memo §3 worked example: "−8%" on XP is a real loss).
  const xpDiff = candidateSnapshot.xpModifier.value - currentSnapshot.xpModifier.value;
  const xpDeltaText = formatSignedPct(xpDiff);
  if (xpDeltaText !== '+0%' && xpDeltaText !== '-0%' && xpDeltaText !== '0%') {
    const line: TradeMetricLine = {
      kind: 'metric',
      label: 'XP',
      hero: formatSignedPct(candidateSnapshot.xpModifier.value),
      delta: xpDeltaText,
      tone: xpDiff > 0 ? 'gain' : 'loss',
    };
    (line.tone === 'gain' ? gains : losses).push(line);
  }

  // ── Non-numeric lines ───────────────────────────────────────────
  const { currentItem, candidateItem } = facts;

  // Legendary effect — weapons only (legendaryEffectId exists only there).
  const curEffect = (currentItem as Weapon | undefined)?.legendaryEffectId;
  const candEffect = (candidateItem as Weapon).legendaryEffectId;
  if (curEffect && curEffect !== candEffect) {
    losses.push({
      kind: 'note', label: 'Legendary', tone: 'loss',
      text: `Loses ${legendaryEffectName(curEffect)}${legendaryDescription(curEffect) ? ` — ${legendaryDescription(curEffect)}` : ''}`,
    });
  }
  if (candEffect && candEffect !== curEffect) {
    gains.push({
      kind: 'note', label: 'Legendary', tone: 'gain',
      text: `Gains ${legendaryEffectName(candEffect)}${legendaryDescription(candEffect) ? ` — ${legendaryDescription(candEffect)}` : ''}`,
    });
  }

  // Affixes by displayText (multiset) — every kind.
  const remaining = new Map<string, number>();
  for (const affix of currentItem?.affixes ?? []) {
    remaining.set(affix.displayText, (remaining.get(affix.displayText) ?? 0) + 1);
  }
  for (const affix of candidateItem.affixes ?? []) {
    const left = remaining.get(affix.displayText) ?? 0;
    if (left > 0) remaining.set(affix.displayText, left - 1);
    else gains.push({ kind: 'note', label: 'Affix', text: affix.displayText, tone: 'gain' });
  }
  for (const [text, count] of remaining) {
    for (let i = 0; i < count; i += 1) {
      losses.push({ kind: 'note', label: 'Affix', text, tone: 'loss' });
    }
  }

  // Class-mod node boosts by name + tree change (class-mod swaps only).
  const curMod = currentItem && 'treeBonus' in currentItem ? currentItem : undefined;
  const candMod = 'treeBonus' in candidateItem ? candidateItem : undefined;
  if (curMod || candMod) {
    const nodeIds = new Set([
      ...Object.keys(curMod?.nodeBoosts ?? {}),
      ...Object.keys(candMod?.nodeBoosts ?? {}),
    ]);
    for (const nodeId of nodeIds) {
      const diff = (candMod?.nodeBoosts[nodeId] ?? 0) - (curMod?.nodeBoosts[nodeId] ?? 0);
      if (diff === 0) continue;
      const name = SKILL_NODES.find((node) => node.id === nodeId)?.name ?? nodeId;
      const line: TradeNoteLine = {
        kind: 'note', label: name, tone: diff > 0 ? 'gain' : 'loss',
        text: `${diff > 0 ? '+' : ''}${diff} skill points`,
      };
      (diff > 0 ? gains : losses).push(line);
    }
    if (curMod && candMod && curMod.treeBonus !== candMod.treeBonus) {
      neutrals.push({
        kind: 'note', label: 'Skill tree', tone: 'neutral',
        text: `${curMod.treeBonus} tree bonus replaced by ${candMod.treeBonus}`,
      });
    }
  }

  // Action-skill qualification crossings — a boost can carry a
  // keystone over the line (or drop it); the metric lines alone
  // would never say so.
  for (const tree of facts.candidateQualified) {
    if (facts.currentQualified.includes(tree)) continue;
    const def = ACTION_SKILL_DEFS[tree as keyof typeof ACTION_SKILL_DEFS];
    if (def) gains.push({ kind: 'note', label: 'Action skill', text: `Qualifies for ${def.name}`, tone: 'gain' });
  }
  for (const tree of facts.currentQualified) {
    if (facts.candidateQualified.includes(tree)) continue;
    const def = ACTION_SKILL_DEFS[tree as keyof typeof ACTION_SKILL_DEFS];
    if (def) losses.push({ kind: 'note', label: 'Action skill', text: `Loses ${def.name} qualification`, tone: 'loss' });
  }

  // Neutral identity changes.
  const curElement = (currentItem as Weapon | undefined)?.element;
  const candElement = (candidateItem as Weapon).element;
  if (curElement && candElement && curElement !== candElement) {
    neutrals.push({ kind: 'note', label: 'Element', text: `${curElement} to ${candElement}`, tone: 'neutral' });
  }
  if (currentItem && 'hp' in currentItem && 'hp' in candidateItem) {
    const curBehavior = SHIELD_BEHAVIORS[shieldBehaviorOf(currentItem)].name;
    const candBehavior = SHIELD_BEHAVIORS[shieldBehaviorOf(candidateItem)].name;
    if (curBehavior !== candBehavior) {
      neutrals.push({ kind: 'note', label: 'Behavior', text: `${curBehavior} to ${candBehavior}`, tone: 'neutral' });
    }
  }
  if (currentItem && 'effect' in currentItem && 'effect' in candidateItem && currentItem.effect !== candidateItem.effect) {
    neutrals.push({ kind: 'note', label: 'Effect', text: `${currentItem.effect} to ${candidateItem.effect}`, tone: 'neutral' });
  }

  return { gains, losses, neutrals, hasBuildChange: gains.length > 0 || losses.length > 0 };
}
