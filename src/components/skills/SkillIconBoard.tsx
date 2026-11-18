/**
 * The icon skill tree (owner-approved 2026-11-18, supersedes the
 * V3 text-card board): nodes are medallion ICONS whose glyphs say
 * what the node does, laid out on the shipped tier grid and joined
 * by prerequisite lines drawn from the real `requires` data — the
 * only edges the defs declare. No names or descriptions on the
 * board; rank reads as pips under the medallion.
 *
 * Tapping a node selects it and opens its sheet (the game's
 * PickerSheet chrome): the icon large, the name, the concise
 * description, rank, cost, requirements — and the Spend button
 * lives there. The sheet is the ONLY spend surface
 * (confirm-then-spend); the pinned head's Next Unlock card is a
 * shortcut that opens the same sheet for that node.
 *
 * State treatments (readable at a glance):
 *   maxed  — full color, green aura, green pips
 *   owned  — full color, amber aura, amber pips (points in)
 *   ready  — full color, no aura (buyable / prereqs met)
 *   locked — desaturated + darkened, lock badge (prereqs unmet)
 *
 * Every datum arrives as props from SkillTreeScreen's own derived
 * state — same stores, same node defs, same spend/respec handlers.
 * Only the composition is here. Icons resolve through the sprite
 * registry (src/lib/pixel/skillNodeIcons.ts).
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { PickerSheet } from '@/components/common/PickerSheet';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { SKILL_NODES } from '@/constants/skillTrees';
import { skillNodeIconUrl } from '@/lib/pixel/skillNodeIcons';
import { type NextUnlock } from '@/lib/skillNextUnlock';
import type { SkillNode } from '@/types/skill';
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

export interface SkillTreeBoardProps {
  nodes: SkillNode[];
  tiers: [number, SkillNode[]][];
  spent: Record<string, number>;
  pointsAvailable: number;
  selectedNode: SkillNode;
  /** Select a node without spending (the sheet opens on it). */
  onSelect: (nodeId: string) => void;
  /** The spend — fires only from the node sheet's button. */
  onSpend: (nodeId: string) => void;
  canSpend: (nodeId: string) => boolean;
  spendReason: (node: SkillNode) => string | null;
  pendingNodeId: string | null;
  errorMessage: string | null;
  activeHunter: { name: string; basePerkName: string };
  activeTreeDef: { label: string; color: string };
}

/**
 * The Next Unlock card — a SHORTCUT, not a second spend surface:
 * tapping it opens the named node's sheet, where the spend lives.
 */
export const NextUnlockCard: React.FC<{ next: NextUnlock; onOpen: (nodeId: string) => void }> = ({ next, onOpen }) => (
  <button
    type="button"
    onClick={() => onOpen(next.node.id)}
    data-testid="trees-next-unlock"
    className="relative block w-full overflow-hidden px-3 pb-3 pt-2 text-left"
    style={plateShell}
  >
    <div className="relative flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-[11px] font-black uppercase tracking-wide" style={{ color: BONE_FAINT }}>Next unlock</span>
        <span className="truncate text-[13px] font-black uppercase" style={{ color: BONE }}>{next.node.name}</span>
        <span className="shrink-0 text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>
          {`${next.node.type} · Tier ${next.node.tier}`}
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
  </button>
);

type IconNodeState = 'maxed' | 'owned' | 'ready' | 'locked';

const iconNodeState = (spent: Record<string, number>, node: SkillNode): IconNodeState => {
  const spentPts = spent[node.id] || 0;
  if (spentPts >= node.maxPoints) return 'maxed';
  if (spentPts > 0) return 'owned';
  const prereqsMet = !node.requires || node.requires.every((r) => (spent[r] || 0) > 0);
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
  SkillTreeBoardProps & {
    node: SkillNode;
    onTap: (node: SkillNode) => void;
    registerRef: (id: string, el: HTMLButtonElement | null) => void;
  }
> = (p) => {
  const node = p.node;
  const spentPts = p.spent[node.id] || 0;
  const state = iconNodeState(p.spent, node);
  const isSelected = p.selectedNode?.id === node.id;
  const iconSize = node.type === 'keystone' ? 92 : node.type === 'major' ? 80 : 68;
  const minHeight = node.type === 'keystone' ? 130 : node.type === 'major' ? 120 : 108;
  const iconUrl = skillNodeIconUrl(node.id);
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
        {iconUrl && (
          <img
            src={iconUrl}
            width={iconSize}
            height={iconSize}
            alt=""
            draggable={false}
            style={{ filter: iconFilter(state), opacity: state === 'locked' ? 0.85 : 1 }}
          />
        )}
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

/** The shipped column placement: a lone node sits centered (COPY-03). */
function placedNodes(tierNodes: SkillNode[]): (SkillNode | undefined)[] {
  return Array.from({ length: 3 }).map((_, idx) =>
    tierNodes.length === 1 ? (idx === 1 ? tierNodes[0] : undefined) : tierNodes.find((n) => n.index === idx + 1),
  );
}

const TierChip: React.FC<{ tier: number }> = ({ tier }) => (
  <div className="flex items-center gap-2">
    <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: BONE_FAINT }}>Tier {tier}</span>
    <span className="h-[2px] flex-1" style={{ backgroundColor: 'rgba(163,152,134,0.28)' }} />
  </div>
);

export const SkillIconBoard: React.FC<SkillTreeBoardProps> = (p) => {
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
    // Late layout shifts (icon images landing, font swap) move the
    // nodes after first paint — a ResizeObserver on the board
    // re-measures on any size change, no timer needed.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && boardRef.current) ro.observe(boardRef.current);
    window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
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
                      onTap={(n) => p.onSelect(n.id)}
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

/**
 * The node sheet — the game's PickerSheet chrome, the node's
 * facts, the spend. The subtitle (type · tier) is player-read
 * state text, so this sheet passes the 11px-floor subtitle class;
 * the shared chrome's 10px default stays for the dense pickers.
 */
export const SkillNodeSheet: React.FC<SkillTreeBoardProps & { node: SkillNode; onClose: () => void }> = (p) => {
  const node = p.node;
  const current = p.spent[node.id] || 0;
  const spendable = p.canSpend(node.id);
  const state = iconNodeState(p.spent, node);
  const iconUrl = skillNodeIconUrl(node.id);
  return (
    <PickerSheet
      title={node.name}
      subtitle={`${node.type} · Tier ${node.tier}`}
      subtitleClassName="text-[11px] text-text-muted truncate"
      onClose={p.onClose}
    >
      <div className="space-y-3 pt-3" data-testid="trees-node-sheet">
        <div className="flex items-center gap-4">
          {iconUrl && (
            <img
              src={iconUrl}
              width={104}
              height={104}
              alt=""
              draggable={false}
              style={{ filter: iconFilter(state), opacity: state === 'locked' ? 0.85 : 1 }}
            />
          )}
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
          data-testid={spendable ? undefined : 'skill-spend-unavailable'}
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
