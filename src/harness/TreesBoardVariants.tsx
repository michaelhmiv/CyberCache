/**
 * TreesBoardVariants — capture-only variant layouts for the Skill
 * Trees stop (first-screen fix program, track R1 render round,
 * branch dash/trees-render — presentation only, never merged).
 *
 * Rendered ONLY when SkillTreeScreen sees ?trees=1|2|3; the
 * shipped screen is byte-identical without the param. Every datum
 * arrives as props from the shipped screen's own derived state —
 * same stores, same node defs, same spend/respec handlers, same
 * ActionSkillPicker plate (V3). Only the composition changes.
 *
 * The audit defects designed against (cluster D, §3): ~390px of
 * preamble before the board; only ~4 of 9 tiers visible; the
 * keystone ~700–800px below the fold; the board min-w-[520px]
 * forcing a horizontal pan at 412px; no next-unlock readout
 * anywhere; the inspect panel below the entire board.
 *
 * The three variants are three different decisions:
 *   V1 — compress in place: the shipped order survives, tightened;
 *        a NEXT UNLOCK datum joins the stats, the inspect plate
 *        pins directly under it, the Action Skill plate compresses
 *        to a one-line pointer strip, the board fits 412px.
 *   V2 — density: compact node tiles (descriptions live only in
 *        the inspect plate) and a one-row stats plate, sized so
 *        all nine tiers — keystone included — fit the first
 *        screen with no scroll at all.
 *   V3 — reorder: a sticky head plate carries points + NEXT +
 *        the inspect; the board follows at full shipped node
 *        size; explainer, respec, and the full Action Skill
 *        plate sink below the board, still reachable.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { PickerSheet } from '@/components/common/PickerSheet';
import { TREE_NODE_ICONS } from '@/harness/treesIconSet';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { SkillKeystoneArt } from '@/components/common/SkillKeystoneArt';
import { SKILL_NODES } from '@/constants/skillTrees';
import { ACTION_SKILL_DEFS } from '@/content/actionSkills';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
import type { SkillNode } from '@/types/skill';
import type { SkillTreeType } from '@/types/game';
import { Bolts, PlateFootStrip } from '@/components/profile/HunterPlates';
import {
  AMBER,
  AMBER_GLOW,
  BONE,
  BONE_FAINT,
  BONE_MUTED,
  STEEL,
  plateShell,
} from '@/components/profile/hunterPlateTheme';

export interface TreesBoardVariantProps {
  variant: 1 | 2 | 3 | 4;
  /** Selection without spend (variant 4: tap selects + opens the sheet; the spend fires from the sheet). */
  onSelect?: (nodeId: string) => void;
  nodes: SkillNode[];
  tiers: [number, SkillNode[]][];
  spent: Record<string, number>;
  pointsAvailable: number;
  pointsSpent: number;
  pointsEarned: number;
  level: number;
  selectedNode: SkillNode;
  onSpend: (nodeId: string) => void;
  canSpend: (nodeId: string) => boolean;
  spendReason: (node: SkillNode) => string | null;
  pendingNodeId: string | null;
  respecButton: React.ReactNode;
  actionSkillPlate: React.ReactNode;
  activeHunter: { name: string; basePerkName: string };
  activeTree: SkillTreeType;
  activeTreeDef: { label: string; color: string; desc: string };
  errorMessage: string | null;
}

/** The shipped node tone map (SkillTreeScreen) — same states. */
const nodeTone = (node: SkillNode, isAvailable: boolean, isMaxed: boolean) => {
  if (isMaxed) return 'border-green/70 bg-green/10 text-green';
  if (isAvailable) return 'border-amber bg-amber/12 text-amber';
  if (node.type === 'keystone') return 'border-purple/45 bg-purple/10 text-purple opacity-80';
  if (node.type === 'major') return 'border-amber/30 bg-surface text-text-secondary opacity-80';
  return 'border-border bg-surface text-text-muted opacity-65';
};

interface NextUnlock {
  node: SkillNode;
  /** Points the player lacks for it (0 = buyable now). */
  short: number;
  /** Unmet prerequisite names, when the keystone fallback fired. */
  blockers?: string[];
}

/**
 * The next milestone unlock: the nearest major/keystone (tier,
 * then board index) the player has not bought whose prerequisites
 * are all met — with how many points they are short. Derived from
 * the same spent map + node defs the board renders; no new data.
 */
function nextUnlock(nodes: SkillNode[], spent: Record<string, number>, pointsAvailable: number): NextUnlock | null {
  const met = (n: SkillNode) => !n.requires || n.requires.every((r) => (spent[r] || 0) > 0);
  const owned = (n: SkillNode) => (spent[n.id] || 0) >= n.maxPoints;
  const ready = nodes
    .filter((n) => (n.type === 'major' || n.type === 'keystone') && !owned(n) && met(n))
    .sort((a, b) => a.tier - b.tier || a.index - b.index);
  if (ready.length > 0) {
    const node = ready[0];
    return { node, short: Math.max(0, node.cost - pointsAvailable) };
  }
  const ks = nodes.find((n) => n.type === 'keystone');
  if (ks && !owned(ks)) {
    const blockers = (ks.requires ?? [])
      .filter((r) => (spent[r] || 0) === 0)
      .map((r) => SKILL_NODES.find((n) => n.id === r)?.name ?? r);
    return { node: ks, short: Math.max(0, ks.cost - pointsAvailable), blockers };
  }
  return null;
}

/** NEXT UNLOCK as its own plate (V1) — name, kind, cost, shortfall. */
const NextDatumPlate: React.FC<{ next: NextUnlock }> = ({ next }) => (
  <div className="relative overflow-hidden px-3 pb-3 pt-2" style={plateShell} data-testid="trees-next-unlock">
    <div className="relative flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-[11px] font-black uppercase tracking-wide" style={{ color: BONE_FAINT }}>Next unlock</span>
        <span className="truncate text-[13px] font-black uppercase" style={{ color: BONE }}>{next.node.name}</span>
        <span className="shrink-0 text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>
          {next.node.type} · T{next.node.tier}
        </span>
      </div>
      <div className="shrink-0 text-[11px] font-black uppercase" style={{ color: next.short > 0 ? BONE_FAINT : AMBER_GLOW }}>
        {next.node.cost} pts{next.short > 0 ? ` · ${next.short} short` : ' · ready'}
      </div>
    </div>
    {next.blockers && next.blockers.length > 0 && (
      <div className="relative mt-0.5 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
        Needs {next.blockers.join(', ')} first.
      </div>
    )}
    <PlateFootStrip color={next.short > 0 ? STEEL : AMBER} height={3} />
  </div>
);

/** The shipped inspect content, verbatim — plate or bare. */
const InspectContent: React.FC<TreesBoardVariantProps> = (p) => {
  const node = p.selectedNode;
  const current = p.spent[node.id] || 0;
  const spendable = p.canSpend(node.id);
  return (
    <div className="relative space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[15px] font-black uppercase tracking-wide" style={{ color: BONE }}>{node.name}</div>
          <div className="mt-0.5 text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>{node.type} · Tier {node.tier}</div>
        </div>
        <div className="text-sm font-black" style={{ color: AMBER }}>{current}/{node.maxPoints}</div>
      </div>
      <div className="text-xs leading-snug" style={{ color: BONE_MUTED }}>{node.description}</div>
      {node.requires && node.requires.length > 0 && (
        <div className="text-[11px]" style={{ color: BONE_FAINT }}>
          Requires: {node.requires.map((reqId) => SKILL_NODES.find((n) => n.id === reqId)?.name ?? reqId).join(', ')}
        </div>
      )}
      <button
        onClick={() => p.onSpend(node.id)}
        disabled={!spendable || p.pendingNodeId !== null}
        aria-disabled={!spendable}
        className="bl-primary min-h-[44px] w-full py-3 text-xs font-black disabled:opacity-50"
      >
        {p.pendingNodeId === node.id ? 'Training…' : `Spend ${node.cost} Point${node.cost === 1 ? '' : 's'}`}
      </button>
      {!spendable && (
        <div className="text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
          {p.spendReason(node) ?? 'Not spendable right now.'}
        </div>
      )}
    </div>
  );
};

/** Full inspect plate (V1: pinned under the stats; V3: in the head plate). */
const InspectPlate: React.FC<TreesBoardVariantProps & { sticky?: boolean }> = (p) => (
  <div
    className={`relative overflow-hidden p-4 ${p.sticky ? 'sticky top-0 z-20' : ''}`}
    style={plateShell}
    data-testid="trees-inspect-plate"
  >
    <Bolts />
    <InspectContent {...p} />
    <PlateFootStrip color={p.activeTreeDef.color} height={3} />
  </div>
);

/**
 * V2's compact inspect: the same facts in two rows — name/points
 * and description on the left, the spend button riding the right
 * at the 44px tap floor. The reason line replaces Requires when
 * the spend is blocked (both never print at once).
 */
const CompactInspect: React.FC<TreesBoardVariantProps> = (p) => {
  const node = p.selectedNode;
  const current = p.spent[node.id] || 0;
  const spendable = p.canSpend(node.id);
  const reason = !spendable ? p.spendReason(node) : null;
  return (
    <div className="sticky top-0 z-20 overflow-hidden p-3 pb-4" style={plateShell} data-testid="trees-inspect-compact">
      <Bolts />
      <div className="relative flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="truncate text-[13px] font-black uppercase tracking-wide" style={{ color: BONE }}>{node.name}</div>
            <div className="shrink-0 text-[11px] font-black" style={{ color: AMBER }}>{current}/{node.maxPoints}</div>
          </div>
          <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>{node.type} · Tier {node.tier}</div>
          <div className="text-[11px] leading-snug" style={{ color: BONE_MUTED }}>{node.description}</div>
          {reason ? (
            <div className="text-[11px] leading-snug" style={{ color: BONE_FAINT }}>{reason}</div>
          ) : node.requires && node.requires.length > 0 ? (
            <div className="text-[11px]" style={{ color: BONE_FAINT }}>
              Requires: {node.requires.map((reqId) => SKILL_NODES.find((n) => n.id === reqId)?.name ?? reqId).join(', ')}
            </div>
          ) : null}
        </div>
        <button
          onClick={() => p.onSpend(node.id)}
          disabled={!spendable || p.pendingNodeId !== null}
          aria-disabled={!spendable}
          className="bl-primary min-h-[44px] shrink-0 px-3 py-2 text-[11px] font-black disabled:opacity-50"
        >
          {p.pendingNodeId === node.id ? 'Training…' : `Spend ${node.cost} Point${node.cost === 1 ? '' : 's'}`}
        </button>
      </div>
      <PlateFootStrip color={p.activeTreeDef.color} height={3} />
    </div>
  );
};

type Density = 'full' | 'trim' | 'compact';

const NodeButton: React.FC<TreesBoardVariantProps & { node: SkillNode; density: Density }> = (p) => {
  const node = p.node;
  const currentPoints = p.spent[node.id] || 0;
  const isMaxed = currentPoints >= node.maxPoints;
  const prerequisitesMet = !node.requires || node.requires.every((req) => (p.spent[req] || 0) > 0);
  const isAvailable = p.canSpend(node.id) && p.pendingNodeId === null;
  const isSelected = p.selectedNode?.id === node.id;
  const isPending = p.pendingNodeId === node.id;
  const size =
    p.density === 'compact'
      ? node.type === 'keystone' ? 'min-h-[64px]' : node.type === 'major' ? 'min-h-[58px]' : 'min-h-[54px]'
      : p.density === 'trim'
        ? node.type === 'keystone' ? 'min-h-[76px]' : node.type === 'major' ? 'min-h-[68px]' : 'min-h-[60px]'
        : node.type === 'keystone' ? 'min-h-[84px]' : node.type === 'major' ? 'min-h-[76px]' : 'min-h-[68px]';
  const artSize = p.density === 'compact' ? 22 : p.density === 'trim' ? 26 : 30;
  const pointsColor = isMaxed ? '#22C55E' : isAvailable ? '#F59E0B' : '#6B7280';
  const art = (
    <SkillKeystoneArt
      tree={p.activeTree}
      nodeType={node.type}
      unlocked={prerequisitesMet || currentPoints > 0 || isMaxed}
      spentPoints={currentPoints}
      locked={!prerequisitesMet && currentPoints === 0 && !isMaxed}
      size={artSize}
      animate={node.type === 'keystone' && currentPoints > 0}
    />
  );
  return (
    <motion.button
      whileTap={isAvailable ? { scale: 0.96 } : { scale: 0.98 }}
      onClick={() => p.onSpend(node.id)}
      className={`relative border-2 p-2 text-left shadow-[4px_4px_0_rgba(0,0,0,0.65)] ${size} ${nodeTone(node, isAvailable, isMaxed)} ${isSelected ? 'ring-2 ring-amber/70' : ''}`}
      style={{ clipPath: 'polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)' }}
    >
      {p.density === 'compact' ? (
        <div className="flex items-center gap-1.5">
          <div className="flex shrink-0 flex-col items-center gap-0.5">
            {art}
            <span className="text-[11px] font-black leading-none" style={{ color: pointsColor }}>
              {isPending ? '…' : `${currentPoints}/${node.maxPoints}`}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <div className="min-w-0 flex-1 truncate text-[11px] font-black text-text-primary">{node.name}</div>
            {isMaxed && <Lock size={11} className="shrink-0 text-green" />}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              {art}
              <div className="truncate text-[11px] font-black text-text-primary">{node.name}</div>
            </div>
            {isMaxed && <Lock size={11} className="shrink-0 text-green" />}
          </div>
          <div className={`mt-1 pr-8 text-[11px] leading-snug text-text-muted ${p.density === 'trim' ? 'line-clamp-2' : ''}`}>{node.description}</div>
          <div className="absolute bottom-1 right-2 text-[11px] font-black" style={{ color: pointsColor }}>
            {isPending ? '…' : `${currentPoints}/${node.maxPoints}`}
          </div>
        </>
      )}
    </motion.button>
  );
};

/** The shipped column placement: a lone node sits centered (COPY-03). */
function placedNodes(tierNodes: SkillNode[]): (SkillNode | undefined)[] {
  return Array.from({ length: 3 }).map((_, idx) =>
    tierNodes.length === 1 ? (idx === 1 ? tierNodes[0] : undefined) : tierNodes.find((n) => n.index === idx + 1),
  );
}

const TierChip: React.FC<{ tier: number }> = ({ tier }) => (
  <div className="flex items-center gap-2" aria-hidden="true">
    <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: BONE_FAINT }}>Tier {tier}</span>
    <span className="h-[2px] flex-1" style={{ backgroundColor: 'rgba(163,152,134,0.28)' }} />
  </div>
);

/** Board plate with chip-row tiers (V1 trim nodes / V3 full nodes). */
const BoardChips: React.FC<TreesBoardVariantProps & { density: 'trim' | 'full' }> = (p) => (
  <div className="relative" style={plateShell}>
    <Bolts />
    <div className="relative flex items-center justify-between px-4 py-3" style={{ borderBottom: '2px solid rgba(163,152,134,0.28)' }}>
      <div>
        <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: p.activeTreeDef.color }}>{p.activeTreeDef.label} Board</div>
        <div className="mt-0.5 text-[11px]" style={{ color: BONE_FAINT }}>{p.activeHunter.name}&apos;s tree · {p.activeHunter.basePerkName} base perk · tap a node to inspect or spend</div>
      </div>
      <span role="img" aria-label={`${p.activeTreeDef.label} tree sigil`} title={`${p.activeTreeDef.label} tree sigil`} className="inline-flex shrink-0">
        <PxIcon name="star" size={17} style={{ color: p.activeTreeDef.color }} />
      </span>
    </div>
    {p.errorMessage && (
      <div role="alert" className="relative border-b-2 border-red/40 bg-red/10 px-4 py-2 text-[11px] font-black uppercase text-red">
        {p.errorMessage}
      </div>
    )}
    <div className="relative space-y-2.5 p-3">
      {p.tiers.map(([tier, tierNodes]) => (
        <div key={tier} className="space-y-1.5">
          <TierChip tier={tier} />
          <div className="grid grid-cols-3 gap-2">
            {placedNodes(tierNodes).map((node, idx) =>
              node ? <NodeButton key={node.id} {...p} node={node} density={p.density} /> : <div key={`empty-${tier}-${idx}`} />,
            )}
          </div>
        </div>
      ))}
    </div>
    <PlateFootStrip color={p.activeTreeDef.color} height={3} />
  </div>
);

/** Board plate with a narrow tier-rail column (V2 compact nodes). */
const BoardRail: React.FC<TreesBoardVariantProps> = (p) => (
  <div className="relative" style={plateShell}>
    <Bolts />
    <div className="relative flex items-center justify-between px-3 py-2" style={{ borderBottom: '2px solid rgba(163,152,134,0.28)' }}>
      <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: p.activeTreeDef.color }}>
        {p.activeTreeDef.label} Board <span className="ml-1 text-[11px] font-bold normal-case" style={{ color: BONE_FAINT }}>{p.activeHunter.name} · {p.activeHunter.basePerkName}</span>
      </div>
      <span role="img" aria-label={`${p.activeTreeDef.label} tree sigil`} title={`${p.activeTreeDef.label} tree sigil`} className="inline-flex shrink-0">
        <PxIcon name="star" size={15} style={{ color: p.activeTreeDef.color }} />
      </span>
    </div>
    {p.errorMessage && (
      <div role="alert" className="relative border-b-2 border-red/40 bg-red/10 px-4 py-2 text-[11px] font-black uppercase text-red">
        {p.errorMessage}
      </div>
    )}
    <div className="relative space-y-1.5 p-2">
      {p.tiers.map(([tier, tierNodes]) => (
        <div key={tier} className="grid grid-cols-[22px_1fr] items-center gap-1.5">
          <div className="text-center text-[11px] font-black uppercase" style={{ color: BONE_FAINT }}>T{tier}</div>
          <div className="grid grid-cols-3 gap-1.5">
            {placedNodes(tierNodes).map((node, idx) =>
              node ? <NodeButton key={node.id} {...p} node={node} density="compact" /> : <div key={`empty-${tier}-${idx}`} />,
            )}
          </div>
        </div>
      ))}
    </div>
    <PlateFootStrip color={p.activeTreeDef.color} height={3} />
  </div>
);

/** The shipped stats wells, verbatim (V1 keeps them). */
const StatsWells: React.FC<TreesBoardVariantProps> = (p) => (
  <div className="grid grid-cols-3 gap-2">
    <div className="relative overflow-hidden px-3 pb-3.5 pt-2.5" style={plateShell}>
      <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>Available</div>
      <div className="text-[22px] font-black leading-tight" style={{ color: AMBER_GLOW }}>{p.pointsAvailable}</div>
      <PlateFootStrip color={p.pointsAvailable > 0 ? AMBER : STEEL} height={3} />
    </div>
    <div className="relative overflow-hidden px-3 pb-3.5 pt-2.5" style={plateShell}>
      <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>Spent</div>
      <div className="text-[22px] font-black leading-tight" style={{ color: BONE }}>{p.pointsSpent}</div>
      <PlateFootStrip color={STEEL} height={3} />
    </div>
    <div className="relative overflow-hidden px-3 pb-3.5 pt-2.5" style={plateShell}>
      <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>Respec cost</div>
      <div className="text-[22px] font-black leading-tight" style={{ color: BONE }}>{p.pointsSpent * 100}cr</div>
      <PlateFootStrip color={STEEL} height={3} />
    </div>
  </div>
);

/** V2's one-row stats plate: hero numeral + spent/respec + the button. */
const StatsRowCompact: React.FC<TreesBoardVariantProps> = (p) => (
  <div className="relative overflow-hidden px-3 pb-3.5 pt-2" style={plateShell}>
    <div className="relative flex items-center gap-3">
      <div className="shrink-0">
        <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>Available</div>
        <div className="text-[22px] font-black leading-tight" style={{ color: AMBER_GLOW }}>{p.pointsAvailable}</div>
      </div>
      <div className="min-w-0 flex-1 space-y-0.5 text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>
        <div>Spent <span style={{ color: BONE }}>{p.pointsSpent}</span></div>
        <div>Respec <span style={{ color: BONE }}>{p.pointsSpent * 100}cr</span></div>
      </div>
      {p.respecButton}
    </div>
    <PlateFootStrip color={p.pointsAvailable > 0 ? AMBER : STEEL} height={3} />
  </div>
);

/** The shipped embedded respec row, verbatim. */
const RespecRow: React.FC<TreesBoardVariantProps> = (p) => (
  <div className="flex items-center justify-between gap-3">
    <div className="text-[11px] leading-snug text-text-muted">
      Respec returns {p.activeHunter.name}&apos;s spent points — cost {p.pointsSpent * 100}cr (100cr per point spent).
    </div>
    {p.respecButton}
  </div>
);

/** The shipped explainer, verbatim. */
const Explainer: React.FC<TreesBoardVariantProps> = (p) => (
  <div className="text-[11px] leading-snug text-text-muted">
    Skill points come from levels — 1 per level ({p.pointsEarned} earned at level {p.level}). Tap a node to inspect it and spend its listed cost. Respec returns every spent point and costs 100cr per point spent. Each hunter holds their own pool — switch hunters at the Roster.
  </div>
);

/**
 * V1's Action Skill pointer strip: the full plate compresses to
 * one line naming the signature and the keystone that unlocks it
 * (the seed state is unqualified — the shipped plate's own
 * sentence, tightened). The pointer survives; the plate's ~130px
 * do not sit on the board's first screen.
 */
const ActionSkillStrip: React.FC<TreesBoardVariantProps> = (p) => {
  const def = ACTION_SKILL_DEFS[p.activeTree];
  const visual = getSkillTreeVisual(p.activeTree);
  const keystone = p.nodes.find((n) => n.type === 'keystone');
  return (
    <div className="relative overflow-hidden px-3 pb-3 pt-2" style={plateShell} data-testid="trees-action-skill-strip">
      <div className="relative flex min-h-[26px] items-center gap-2">
        <PxIcon name={visual.sigil} size={14} style={{ color: visual.color }} />
        <span className="shrink-0 text-[11px] font-black uppercase" style={{ color: BONE }}>Action Skill</span>
        <span className="text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
          {def.name} — own the {p.activeTreeDef.label} keystone{keystone ? `, ${keystone.name}` : ''}, to unlock
        </span>
      </div>
      <PlateFootStrip color={STEEL} height={3} />
    </div>
  );
};

export const TreesBoardVariant: React.FC<TreesBoardVariantProps> = (p) => {
  const next = nextUnlock(p.nodes, p.spent, p.pointsAvailable);

  if (p.variant === 4) {
    return <IconTreeVariant {...p} next={next} />;
  }

  if (p.variant === 1) {
    return (
      <div className="space-y-3" data-testid="trees-variant-1">
        <StatsWells {...p} />
        {next && <NextDatumPlate next={next} />}
        <InspectPlate {...p} sticky />
        <RespecRow {...p} />
        <ActionSkillStrip {...p} />
        <BoardChips {...p} density="trim" />
        <div className="text-[11px] leading-snug text-text-muted">
          Points come from levels — 1 per level. Each hunter holds their own pool — switch hunters at the Roster.
        </div>
      </div>
    );
  }

  if (p.variant === 2) {
    return (
      <div className="space-y-2" data-testid="trees-variant-2">
        <StatsRowCompact {...p} />
        {next && (
          <div className="flex items-baseline justify-between gap-2 px-1" data-testid="trees-next-unlock">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-[11px] font-black uppercase tracking-wide" style={{ color: BONE_FAINT }}>Next unlock</span>
              <span className="truncate text-[12px] font-black uppercase" style={{ color: BONE }}>{next.node.name}</span>
              <span className="shrink-0 text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>{next.node.type} · T{next.node.tier}</span>
            </div>
            <div className="shrink-0 text-[11px] font-black uppercase" style={{ color: next.short > 0 ? BONE_FAINT : AMBER_GLOW }}>
              {next.node.cost} pts{next.short > 0 ? ` · ${next.short} short` : ' · ready'}
            </div>
          </div>
        )}
        <CompactInspect {...p} />
        <div className="px-1 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
          Action Skill — {ACTION_SKILL_DEFS[p.activeTree].name}: own {p.nodes.find((n) => n.type === 'keystone')?.name} (Tier 9) to unlock.
        </div>
        <BoardRail {...p} />
        <Explainer {...p} />
      </div>
    );
  }

  // V3 — the head plate leads (points + NEXT + inspect, sticky);
  // the board runs at full shipped node size; explainer, respec,
  // and the full Action Skill plate sink below it.
  return (
    <div className="space-y-3" data-testid="trees-variant-3">
      <div className="sticky top-0 z-20 overflow-hidden p-3.5 pb-4" style={plateShell} data-testid="trees-head-plate">
        <Bolts />
        <div className="relative space-y-2.5">
          <div className="flex items-baseline justify-between gap-2 text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>
            <span>Available <span className="text-[15px] font-black" style={{ color: AMBER_GLOW }}>{p.pointsAvailable}</span></span>
            <span>Spent <span className="text-[15px] font-black" style={{ color: BONE }}>{p.pointsSpent}</span></span>
            <span>Respec <span className="text-[15px] font-black" style={{ color: BONE }}>{p.pointsSpent * 100}cr</span></span>
          </div>
          {next && (
            <div
              className="flex items-baseline justify-between gap-2 border-y py-1.5 text-[11px]"
              style={{ borderColor: 'rgba(163,152,134,0.28)' }}
              data-testid="trees-next-unlock"
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-black uppercase tracking-wide" style={{ color: BONE_FAINT }}>Next unlock</span>
                <span className="truncate text-[13px] font-black uppercase" style={{ color: BONE }}>{next.node.name}</span>
                <span className="shrink-0 font-bold uppercase" style={{ color: BONE_FAINT }}>{next.node.type} · T{next.node.tier}</span>
              </div>
              <div className="shrink-0 font-black uppercase" style={{ color: next.short > 0 ? BONE_FAINT : AMBER_GLOW }}>
                {next.node.cost} pts{next.short > 0 ? ` · ${next.short} short` : ' · ready'}
              </div>
            </div>
          )}
          <InspectContent {...p} />
        </div>
        <PlateFootStrip color={p.activeTreeDef.color} height={3} />
      </div>
      <BoardChips {...p} density="full" />
      <Explainer {...p} />
      <RespecRow {...p} />
      {p.actionSkillPlate}
    </div>
  );
};

/* ==================================================================
 * V4 — the icon tree (owner direction 2026-11-18, supersedes the
 * V3 text-card board): nodes are ICONS whose glyphs say what the
 * node does, laid out on the shipped tier grid and joined by
 * prerequisite lines drawn from the real `requires` data — the
 * only edges the defs declare. No names or descriptions on the
 * board; rank reads as pips under the medallion. Tapping a node
 * selects it and opens its sheet (the game's PickerSheet chrome):
 * the icon large, the name, the V3 concise description, rank,
 * cost, requirements — and the Spend button lives there
 * (confirm-then-spend). The pinned head plate stays V3's.
 *
 * State treatments (readable at a glance):
 *   maxed  — full color, green aura, green pips
 *   owned  — full color, amber aura, amber pips (points in)
 *   ready  — full color, no aura (buyable / prereqs met)
 *   locked — desaturated + darkened, lock badge (prereqs unmet)
 * ================================================================== */

type IconNodeState = 'maxed' | 'owned' | 'ready' | 'locked';

const iconNodeState = (p: TreesBoardVariantProps, node: SkillNode): IconNodeState => {
  const spentPts = p.spent[node.id] || 0;
  if (spentPts >= node.maxPoints) return 'maxed';
  if (spentPts > 0) return 'owned';
  const prereqsMet = !node.requires || node.requires.every((r) => (p.spent[r] || 0) > 0);
  return prereqsMet ? 'ready' : 'locked';
};

const iconFilter = (state: IconNodeState): string => {
  if (state === 'locked') return 'grayscale(0.7) brightness(0.58) contrast(0.95)';
  if (state === 'owned') return 'drop-shadow(0 0 7px rgba(255,144,0,0.45)) saturate(1.1)';
  if (state === 'maxed') return 'drop-shadow(0 0 7px rgba(34,197,94,0.55)) saturate(1.1)';
  return 'none';
};

/** Rank as pips: five dots for a small node, one diamond for a major/keystone. */
const RankPips: React.FC<{ node: SkillNode; spentPts: number; state: IconNodeState; large?: boolean }> = ({ node, spentPts, state, large }) => {
  const filledColor = state === 'maxed' ? '#22C55E' : AMBER;
  const emptyColor = 'rgba(163,152,134,0.30)';
  if (node.type !== 'small') {
    const s = large ? 11 : 9;
    return (
      <span
        aria-hidden="true"
        style={{ width: s, height: s, transform: 'rotate(45deg)', display: 'inline-block', backgroundColor: spentPts > 0 ? filledColor : emptyColor }}
      />
    );
  }
  const s = large ? 9 : 7;
  return (
    <span className="flex items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: node.maxPoints }).map((_, i) => (
        <span
          key={i}
          style={{ width: s, height: s, borderRadius: '50%', display: 'inline-block', backgroundColor: i < spentPts ? filledColor : emptyColor }}
        />
      ))}
    </span>
  );
};

const IconNodeButton: React.FC<
  TreesBoardVariantProps & {
    node: SkillNode;
    onTap: (node: SkillNode) => void;
    registerRef: (id: string, el: HTMLButtonElement | null) => void;
  }
> = (p) => {
  const node = p.node;
  const spentPts = p.spent[node.id] || 0;
  const state = iconNodeState(p, node);
  const isSelected = p.selectedNode?.id === node.id;
  const iconSize = node.type === 'keystone' ? 92 : node.type === 'major' ? 80 : 68;
  const minHeight = node.type === 'keystone' ? 130 : node.type === 'major' ? 120 : 108;
  return (
    <motion.button
      ref={(el) => p.registerRef(node.id, el)}
      whileTap={{ scale: 0.96 }}
      onClick={() => p.onTap(node)}
      aria-label={node.name}
      data-testid={`trees-icon-node-${node.id}`}
      className="relative flex flex-col items-center justify-start gap-1.5 px-1 pb-2 pt-2.5"
      style={{
        minHeight,
        boxShadow: isSelected ? `inset 0 0 0 2px ${AMBER}` : undefined,
      }}
    >
      <span className="relative inline-flex">
        <img
          src={TREE_NODE_ICONS[node.id]}
          width={iconSize}
          height={iconSize}
          alt=""
          draggable={false}
          style={{ filter: iconFilter(state), opacity: state === 'locked' ? 0.85 : 1 }}
        />
        {state === 'locked' && (
          <span
            className="absolute -bottom-1 -right-1 flex h-[20px] w-[20px] items-center justify-center rounded-full"
            style={{ backgroundColor: '#0C0A08', border: '1.5px solid rgba(163,152,134,0.55)' }}
          >
            <Lock size={11} style={{ color: BONE_FAINT }} />
          </span>
        )}
      </span>
      <RankPips node={node} spentPts={spentPts} state={state} />
    </motion.button>
  );
};

interface TreeLine { key: string; live: boolean; d: string }

const IconBoard: React.FC<TreesBoardVariantProps & { onTap: (node: SkillNode) => void }> = (p) => {
  const boardRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const [lines, setLines] = useState<TreeLine[]>([]);
  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const measure = () => {
      const board = boardRef.current;
      if (!board) return;
      const br = board.getBoundingClientRect();
      const out: TreeLine[] = [];
      for (const node of p.nodes) {
        if (!node.requires || node.requires.length === 0) continue;
        const tEl = nodeRefs.current.get(node.id);
        if (!tEl) continue;
        const tr = tEl.getBoundingClientRect();
        const tx = tr.left + tr.width / 2 - br.left;
        const ty = tr.top - br.top;
        for (const req of node.requires) {
          const sEl = nodeRefs.current.get(req);
          if (!sEl) continue;
          const sr = sEl.getBoundingClientRect();
          const sx = sr.left + sr.width / 2 - br.left;
          const sy = sr.bottom - br.top;
          const mid = Math.max(10, (ty - sy) / 2);
          out.push({
            key: `${req}->${node.id}`,
            live: (p.spent[req] || 0) > 0,
            d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${sx.toFixed(1)} ${(sy + mid).toFixed(1)}, ${tx.toFixed(1)} ${(ty - mid).toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`,
          });
        }
      }
      setLines(out);
      setBoardSize({ w: board.scrollWidth, h: board.scrollHeight });
    };
    measure();
    const t = setTimeout(measure, 400);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [p.nodes, p.spent]);

  return (
    <div className="relative" style={plateShell} data-testid="trees-icon-board">
      <Bolts />
      <div className="relative flex items-center justify-between px-4 py-3" style={{ borderBottom: '2px solid rgba(163,152,134,0.28)' }}>
        <div>
          <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: p.activeTreeDef.color }}>{p.activeTreeDef.label} Board</div>
          <div className="mt-0.5 text-[11px]" style={{ color: BONE_FAINT }}>{p.activeHunter.name}&apos;s tree · {p.activeHunter.basePerkName} base perk · tap a node to inspect</div>
        </div>
        <span role="img" aria-label={`${p.activeTreeDef.label} tree sigil`} title={`${p.activeTreeDef.label} tree sigil`} className="inline-flex shrink-0">
          <PxIcon name="star" size={17} style={{ color: p.activeTreeDef.color }} />
        </span>
      </div>
      {p.errorMessage && (
        <div role="alert" className="relative border-b-2 border-red/40 bg-red/10 px-4 py-2 text-[11px] font-black uppercase text-red">
          {p.errorMessage}
        </div>
      )}
      <div className="relative p-3" ref={boardRef}>
        {boardSize.w > 0 && (
          <svg
            className="pointer-events-none absolute left-0 top-0"
            width={boardSize.w}
            height={boardSize.h}
            aria-hidden="true"
            data-testid="trees-icon-lines"
          >
            {lines.map((line) => (
              <path
                key={line.key}
                d={line.d}
                fill="none"
                stroke={line.live ? 'rgba(255,144,0,0.55)' : 'rgba(163,152,134,0.32)'}
                strokeWidth={line.live ? 2.5 : 2}
              />
            ))}
          </svg>
        )}
        <div className="relative space-y-5">
          {p.tiers.map(([tier, tierNodes]) => (
            <div key={tier} className="space-y-1.5">
              <TierChip tier={tier} />
              <div className="grid grid-cols-3 gap-2">
                {placedNodes(tierNodes).map((node, idx) =>
                  node ? (
                    <IconNodeButton
                      key={node.id}
                      {...p}
                      node={node}
                      onTap={p.onTap}
                      registerRef={(id, el) => {
                        if (el) nodeRefs.current.set(id, el);
                        else nodeRefs.current.delete(id);
                      }}
                    />
                  ) : (
                    <div key={`empty-${tier}-${idx}`} />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <PlateFootStrip color={p.activeTreeDef.color} height={3} />
    </div>
  );
};

/** The node sheet — the game's PickerSheet chrome, the node's facts, the spend. */
const NodeSheet: React.FC<TreesBoardVariantProps & { node: SkillNode; onClose: () => void }> = (p) => {
  const node = p.node;
  const current = p.spent[node.id] || 0;
  const spendable = p.canSpend(node.id);
  const state = iconNodeState(p, node);
  return (
    <PickerSheet title={node.name} subtitle={`${node.type} · Tier ${node.tier}`} onClose={p.onClose}>
      <div className="space-y-3 pt-3" data-testid="trees-node-sheet">
        <div className="flex items-center gap-4">
          <img
            src={TREE_NODE_ICONS[node.id]}
            width={104}
            height={104}
            alt=""
            draggable={false}
            style={{ filter: iconFilter(state), opacity: state === 'locked' ? 0.85 : 1 }}
          />
          <div className="space-y-1.5">
            <div className="text-lg font-black leading-none" style={{ color: AMBER }}>{current}/{node.maxPoints}</div>
            <RankPips node={node} spentPts={current} state={state} large />
            <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>
              Cost {node.cost} point{node.cost === 1 ? '' : 's'}{node.maxPoints > 1 ? ' per rank' : ''}
            </div>
            {node.requires && node.requires.length > 0 && (
              <div className="text-[11px]" style={{ color: BONE_FAINT }}>
                Requires: {node.requires.map((reqId) => SKILL_NODES.find((n) => n.id === reqId)?.name ?? reqId).join(', ')}
              </div>
            )}
          </div>
        </div>
        <div className="text-xs leading-snug" style={{ color: BONE_MUTED }}>{node.description}</div>
        <button
          onClick={() => p.onSpend(node.id)}
          disabled={!spendable || p.pendingNodeId !== null}
          aria-disabled={!spendable}
          className="bl-primary min-h-[44px] w-full py-3 text-xs font-black disabled:opacity-50"
        >
          {p.pendingNodeId === node.id ? 'Training…' : `Spend ${node.cost} Point${node.cost === 1 ? '' : 's'}`}
        </button>
        {!spendable && (
          <div className="text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
            {p.spendReason(node) ?? 'Not spendable right now.'}
          </div>
        )}
      </div>
    </PickerSheet>
  );
};

const IconTreeVariant: React.FC<TreesBoardVariantProps & { next: NextUnlock | null }> = (p) => {
  const sheetParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('sheet') : null;
  const [sheetOpen, setSheetOpen] = useState(sheetParam === '1');
  const onTap = (node: SkillNode) => {
    p.onSelect?.(node.id);
    setSheetOpen(true);
  };
  return (
    <div className="space-y-3" data-testid="trees-variant-4">
      {/* The pinned head plate — V3's, verbatim: points + NEXT + inspect. */}
      <div className="sticky top-0 z-20 overflow-hidden p-3.5 pb-4" style={plateShell} data-testid="trees-head-plate">
        <Bolts />
        <div className="relative space-y-2.5">
          <div className="flex items-baseline justify-between gap-2 text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>
            <span>Available <span className="text-[15px] font-black" style={{ color: AMBER_GLOW }}>{p.pointsAvailable}</span></span>
            <span>Spent <span className="text-[15px] font-black" style={{ color: BONE }}>{p.pointsSpent}</span></span>
            <span>Respec <span className="text-[15px] font-black" style={{ color: BONE }}>{p.pointsSpent * 100}cr</span></span>
          </div>
          {p.next && (
            <div
              className="flex items-baseline justify-between gap-2 border-y py-1.5 text-[11px]"
              style={{ borderColor: 'rgba(163,152,134,0.28)' }}
              data-testid="trees-next-unlock"
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-black uppercase tracking-wide" style={{ color: BONE_FAINT }}>Next unlock</span>
                <span className="truncate text-[13px] font-black uppercase" style={{ color: BONE }}>{p.next.node.name}</span>
                <span className="shrink-0 font-bold uppercase" style={{ color: BONE_FAINT }}>{p.next.node.type} · T{p.next.node.tier}</span>
              </div>
              <div className="shrink-0 font-black uppercase" style={{ color: p.next.short > 0 ? BONE_FAINT : AMBER_GLOW }}>
                {p.next.node.cost} pts{p.next.short > 0 ? ` · ${p.next.short} short` : ' · ready'}
              </div>
            </div>
          )}
          <InspectContent {...p} />
        </div>
        <PlateFootStrip color={p.activeTreeDef.color} height={3} />
      </div>
      <IconBoard {...p} onTap={onTap} />
      <Explainer {...p} />
      <RespecRow {...p} />
      {p.actionSkillPlate}
      {sheetOpen && <NodeSheet {...p} node={p.selectedNode} onClose={() => setSheetOpen(false)} />}
    </div>
  );
};
