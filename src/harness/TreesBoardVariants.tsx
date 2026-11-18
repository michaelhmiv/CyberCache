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
import React from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
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
  variant: 1 | 2 | 3;
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
      ? node.type === 'keystone' ? 'min-h-[54px]' : node.type === 'major' ? 'min-h-[48px]' : 'min-h-[44px]'
      : p.density === 'trim'
        ? node.type === 'keystone' ? 'min-h-[76px]' : node.type === 'major' ? 'min-h-[68px]' : 'min-h-[60px]'
        : node.type === 'keystone' ? 'min-h-[84px]' : node.type === 'major' ? 'min-h-[76px]' : 'min-h-[68px]';
  const artSize = p.density === 'compact' ? 22 : p.density === 'trim' ? 26 : 30;
  return (
    <motion.button
      whileTap={isAvailable ? { scale: 0.96 } : { scale: 0.98 }}
      onClick={() => p.onSpend(node.id)}
      className={`relative border-2 p-2 text-left shadow-[4px_4px_0_rgba(0,0,0,0.65)] ${size} ${nodeTone(node, isAvailable, isMaxed)} ${isSelected ? 'ring-2 ring-amber/70' : ''}`}
      style={{ clipPath: 'polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <SkillKeystoneArt
            tree={p.activeTree}
            nodeType={node.type}
            unlocked={prerequisitesMet || currentPoints > 0 || isMaxed}
            spentPoints={currentPoints}
            locked={!prerequisitesMet && currentPoints === 0 && !isMaxed}
            size={artSize}
            animate={node.type === 'keystone' && currentPoints > 0}
          />
          <div className={`truncate text-[11px] font-black text-text-primary`}>{node.name}</div>
        </div>
        {isMaxed && <Lock size={11} className="shrink-0 text-green" />}
      </div>
      {p.density !== 'compact' && (
        <div className={`mt-1 pr-8 text-[11px] leading-snug text-text-muted ${p.density === 'trim' ? 'line-clamp-2' : ''}`}>{node.description}</div>
      )}
      <div className="absolute bottom-1 right-2 text-[11px] font-black" style={{ color: isMaxed ? '#22C55E' : isAvailable ? '#F59E0B' : '#6B7280' }}>
        {isPending ? '…' : `${currentPoints}/${node.maxPoints}`}
      </div>
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
