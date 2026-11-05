import React, { useCallback, useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { motion } from 'framer-motion';
import { Lock, RotateCcw } from 'lucide-react';
import { getSkillTreeNodes, SKILL_NODES } from '@/constants/skillTrees';
import { SkillTreeType } from '@/types/game';
import { SkillNode } from '@/types/skill';
import { usePlayerStore, useSkillStore } from '@/store';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { SkillKeystoneArt } from '@/components/common/SkillKeystoneArt';
import {
  getActionSkillState,
  newActionSkillNonce,
  selectActionSkill,
} from '@/lib/chef/chefClient';
import {
  ACTION_SKILL_DEFS,
  ACTION_SKILL_CHARGE_MAX,
  NO_KEYSTONE_NOTE,
  type ActionSkillStateView,
} from '@/content/actionSkills';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
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

/**
 * ActionSkillPicker — the ONE active signature choice (0030). The
 * server derives qualification from skill spends + the equipped
 * class mod; this picker only sends the player's pick. It lives
 * here, where respec happens — changing keystones changes what can
 * be picked, and a respec that drops the selected keystone clears
 * the signature server-side.
 */
const ActionSkillPicker: React.FC = () => {
  const [view, setView] = useState<ActionSkillStateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const load = useCallback(() => {
    getActionSkillState()
      .then((r) => setView(r.actionSkill))
      .catch(() => { /* no picker without the server's word */ });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!view) return null;

  const pick = async (tree: SkillTreeType | null) => {
    if (busy) return;
    setBusy(true);
    setPickError(null);
    try {
      const result = await selectActionSkill({ nonce: newActionSkillNonce('select'), tree });
      setView(result.actionSkill);
    } catch (error) {
      setPickError(error instanceof Error ? error.message : 'Selection failed');
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative overflow-hidden p-3.5" style={plateShell} data-testid="action-skill-picker">
      <Bolts />
      <div className="relative space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: BONE }}>Action Skill</div>
          {view.selected && (
            <div className="font-mono text-[11px] font-black" style={{ color: BONE }}>
              {Math.floor(view.charge)}/{ACTION_SKILL_CHARGE_MAX} charge
            </div>
          )}
        </div>
        {view.qualified.length === 0 ? (
          <div className="text-[11px] leading-snug" style={{ color: BONE_FAINT }} data-testid="action-skill-picker-none">
            {NO_KEYSTONE_NOTE}
          </div>
        ) : (
          <>
            <div className="text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
              Owning a tree&apos;s keystone unlocks its signature. Pick ONE active signature — it charges through boss attempts and endless fights (Fixers also charge at the benches and the repair bay).
            </div>
            <div className="grid grid-cols-2 gap-2">
              {view.qualified.map((tree) => {
                const def = ACTION_SKILL_DEFS[tree];
                const visual = getSkillTreeVisual(tree);
                const isActive = view.selected === tree;
                return (
                  <button
                    key={tree}
                    type="button"
                    data-testid={`action-skill-pick-${tree}`}
                    onClick={() => void pick(isActive ? null : tree)}
                    disabled={busy}
                    className="relative min-h-[44px] overflow-hidden p-2.5 pb-3.5 text-left disabled:opacity-50"
                    style={{
                      border: '2px solid #000',
                      background: 'linear-gradient(158deg, #1D1811 0%, #0C0A08 100%)',
                      boxShadow: isActive
                        ? `3px 3px 0 rgba(0,0,0,0.7), inset 0 0 0 2px ${AMBER}`
                        : '3px 3px 0 rgba(0,0,0,0.7)',
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <PxIcon name={visual.sigil} size={13} style={{ color: visual.color }} />
                      <span className="text-xs font-black" style={{ color: BONE }}>{def.name}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>{def.summary}</div>
                    <div className="mt-1 text-[11px] font-black uppercase" style={{ color: visual.color }}>
                      {isActive ? 'Active — tap to clear' : `${tree} signature`}
                    </div>
                    {/* The tree's color rides the foot strip — never
                        a side bar (Arena Plates law). */}
                    <PlateFootStrip color={visual.color} height={3} />
                  </button>
                );
              })}
            </div>
            {pickError && (
              <div role="alert" className="text-[11px] font-black uppercase text-red">{pickError}</div>
            )}
          </>
        )}
      </div>
      <PlateFootStrip color={STEEL} height={3} />
    </div>
  );
};

const TREES = [
  { id: SkillTreeType.Gunslinger, label: 'Gunslinger', color: '#FF4B5C', desc: 'Weapon damage, crits, speed' },
  { id: SkillTreeType.Demolition, label: 'Demolition', color: '#FF9000', desc: 'Explosives, armor break' },
  { id: SkillTreeType.Scavenger, label: 'Scavenger', color: '#7CFC00', desc: 'Idle, loot, economy' },
  { id: SkillTreeType.Fixer, label: 'Fixer', color: '#2EC4B6', desc: 'Crafting, repair, vehicles, trade' },
];

const nodeTone = (node: SkillNode, isAvailable: boolean, isMaxed: boolean) => {
  if (isMaxed) return 'border-green/70 bg-green/10 text-green';
  if (isAvailable) return 'border-amber bg-amber/12 text-amber';
  if (node.type === 'keystone') return 'border-purple/45 bg-purple/10 text-purple opacity-80';
  if (node.type === 'major') return 'border-amber/30 bg-surface text-text-secondary opacity-80';
  return 'border-border bg-surface text-text-muted opacity-65';
};

export const SkillTreeScreen: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  const [activeTree, setActiveTree] = useState(SkillTreeType.Gunslinger);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pendingNodeId, setPendingNodeId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const player = usePlayerStore();
  const skillStore = useSkillStore();

  const pointsSpent = skillStore.getTotalSpent();
  const pointsEarned = Math.max(0, player.level - 1);
  const pointsAvailable = Math.max(0, pointsEarned - pointsSpent);
  const nodes = getSkillTreeNodes(activeTree);
  const activeTreeDef = TREES.find((tree) => tree.id === activeTree) || TREES[0];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0];
  const groupedTiers = new Map<number, SkillNode[]>();
  nodes.forEach((node) => {
    const current = groupedTiers.get(node.tier) || [];
    current.push(node);
    groupedTiers.set(node.tier, current.sort((a, b) => a.index - b.index));
  });
  const tiers = Array.from(groupedTiers.entries()).sort(([a], [b]) => a - b);

  const canSpend = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return false;
    if (pointsAvailable < node.cost) return false;
    if ((skillStore.spent[nodeId] || 0) >= node.maxPoints) return false;
    if (node.requires) {
      for (const req of node.requires) {
        if ((skillStore.spent[req] || 0) === 0) return false;
      }
    }
    return true;
  };

  // QC A7: the inspect panel used to render its Spend button ONLY when
  // the spend was already possible — a player with no points (every
  // level-1 guest) saw a node brief with no spend affordance at all
  // and no way to learn how a point is spent. The button now always
  // renders; when the spend is not possible this returns the plain
  // reason printed under the disabled button.
  const spendReason = (node: SkillNode): string | null => {
    const current = skillStore.spent[node.id] || 0;
    if (current >= node.maxPoints) return 'This node is maxed out.';
    if (pendingNodeId !== null && pendingNodeId !== node.id) {
      return 'Another node is training — one spend at a time.';
    }
    if (node.requires) {
      const unmet = node.requires.filter((req) => (skillStore.spent[req] || 0) === 0);
      if (unmet.length > 0) {
        const names = unmet.map((req) => nodes.find((n) => n.id === req)?.name ?? req);
        return `Spend a point in ${names.join(', ')} first.`;
      }
    }
    if (pointsAvailable < node.cost) {
      return `Needs ${node.cost} point${node.cost === 1 ? '' : 's'} — you have ${pointsAvailable}. Skill points come from levels: 1 per level.`;
    }
    return null;
  };

  const spendPoint = async (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setErrorMessage(null);
    if (!canSpend(nodeId) || pendingNodeId) return;
    const previousSpent = skillStore.spent;
    // Optimistic local update — the server-authoritative snapshot from
    // syncVerifiedResult will overwrite this on success. On RPC failure we
    // roll back to the pre-tap state so the UI never disagrees with the
    // server's skill_spends.
    skillStore.spendPoint(nodeId);
    setPendingNodeId(nodeId);
    try {
      await verifiedOps.trainSkill(nodeId);
    } catch (error) {
      useSkillStore.setState({ spent: previousSpent });
      setErrorMessage(error instanceof Error ? error.message : 'Failed to train skill');
    } finally {
      setPendingNodeId(null);
    }
  };

  const respec = async () => {
    setErrorMessage(null);
    try {
      await verifiedOps.retrain();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to respec');
    }
  };

  // The Respec affordance + points summary used to live ONLY in the
  // non-embedded header/stats, but this screen is only ever rendered
  // embedded (Profile) — which suppressed both and made the working
  // cc_retrain flow unreachable. They now render in both modes, with
  // the exact cost semantics of the original header: cc_retrain
  // charges total spent × 100cr server-side; the button is the whole
  // confirmation (same as it ever was standalone).
  const respecButton = (
    <button
      onClick={respec}
      disabled={pendingNodeId !== null}
      className="flex min-h-[44px] shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-wide disabled:opacity-50"
      style={{
        color: AMBER,
        border: '2px solid #000',
        background: 'linear-gradient(158deg, #1D1811 0%, #0C0A08 100%)',
        boxShadow: '3px 3px 0 rgba(0,0,0,0.7)',
      }}
    >
      <RotateCcw size={13} /> Respec
    </button>
  );

  const header = embedded ? null : (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="bl-title text-3xl leading-none text-text-primary">Skill Trees</div>
        <div className="text-xs text-text-muted mt-1">Spend points on crooked branches. Small nodes feed majors; majors unlock keystones.</div>
      </div>
      {respecButton}
    </div>
  );

  // The points read as gauges on plate wells (Arena Plates): the
  // available count is the screen's hero numeral in amber glow;
  // the foot strip goes amber only while points wait to be spent.
  // Label and value stay adjacent siblings — the respec suite reads
  // the value as the label's next sibling.
  const stats = (
    <div className="grid grid-cols-3 gap-2">
      <div className="relative overflow-hidden px-3 pb-3.5 pt-2.5" style={plateShell}>
        <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>Available</div>
        <div className="text-[22px] font-black leading-tight" style={{ color: AMBER_GLOW }}>{pointsAvailable}</div>
        <PlateFootStrip color={pointsAvailable > 0 ? AMBER : STEEL} height={3} />
      </div>
      <div className="relative overflow-hidden px-3 pb-3.5 pt-2.5" style={plateShell}>
        <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>Spent</div>
        <div className="text-[22px] font-black leading-tight" style={{ color: BONE }}>{pointsSpent}</div>
        <PlateFootStrip color={STEEL} height={3} />
      </div>
      <div className="relative overflow-hidden px-3 pb-3.5 pt-2.5" style={plateShell}>
        <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>Respec cost</div>
        <div className="text-[22px] font-black leading-tight" style={{ color: BONE }}>{pointsSpent * 100}cr</div>
        <PlateFootStrip color={STEEL} height={3} />
      </div>
    </div>
  );

  return (
    <div className={embedded ? 'space-y-4' : 'bl-page space-y-4 p-4 pb-20'}>
      {header}
      {stats}
      {/* Audit UX-07: the board never said where points come from or
          what spending costs before the tap. One explainer line in
          both render modes, matching the shipped math exactly:
          pointsEarned = level − 1 (1 per level), a node's cost is
          spent from its inspect panel, and cc_retrain returns every
          spent point at a cost of pointsSpent × 100cr. */}
      <div className="text-[11px] leading-snug text-text-muted">
        Skill points come from levels — 1 per level ({pointsEarned} earned at level {player.level}). Tap a node to inspect it and spend its listed cost. Respec returns every spent point and costs 100cr per point spent.
      </div>
      {embedded && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] leading-snug text-text-muted">Respec returns every spent point — cost {pointsSpent * 100}cr (100cr per point spent).</div>
          {respecButton}
        </div>
      )}

      <ActionSkillPicker />

      {/* Tree selector — plates, one per tree. The tree's color is
          data (its identity): it rides the label and the foot
          strip, never a side bar. The active plate takes an inset
          frame in its own color; each plate gauges its spent
          count on the right. */}
      <div className="space-y-2">
        {TREES.map((tree) => {
          const treeSpentPts = getSkillTreeNodes(tree.id).reduce((sum, n) => sum + (skillStore.spent[n.id] || 0), 0);
          const isActiveTree = activeTree === tree.id;
          return (
            <button
              key={tree.id}
              type="button"
              onClick={() => {
                setActiveTree(tree.id);
                setSelectedNodeId(null);
              }}
              className="relative block min-h-[44px] w-full overflow-hidden px-3.5 pb-3.5 pt-2.5 text-left transition-transform active:scale-[0.99]"
              style={{
                ...plateShell,
                boxShadow: isActiveTree
                  ? `5px 5px 0 rgba(0,0,0,0.75), inset 0 0 0 2px ${tree.color}`
                  : plateShell.boxShadow,
              }}
            >
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: tree.color }}>{tree.label}</div>
                  <div className="mt-0.5 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>{tree.desc}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[19px] font-black leading-none" style={{ color: BONE }}>{treeSpentPts}</div>
                  <div className="mt-0.5 text-[11px] font-bold uppercase leading-none" style={{ color: BONE_FAINT }}>pts in</div>
                </div>
              </div>
              <PlateFootStrip color={tree.color} height={isActiveTree ? 4 : 3} />
            </button>
          );
        })}
      </div>

      <div className="relative" style={plateShell}>
        <Bolts />
        <div className="relative flex items-center justify-between px-4 py-3" style={{ borderBottom: '2px solid rgba(163,152,134,0.28)' }}>
          <div>
            <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: activeTreeDef.color }}>{activeTreeDef.label} Board</div>
            <div className="mt-0.5 text-[11px]" style={{ color: BONE_FAINT }}>Horizontal scroll is intentional on mobile. Tap a node to inspect or spend.</div>
          </div>
          {/* The tree sigil is decorative (QC A7: an unexplained red
              glyph at the board's top-right read as a button). It now
              carries an accessible name saying what it is. */}
          <span
            role="img"
            aria-label={`${activeTreeDef.label} tree sigil`}
            title={`${activeTreeDef.label} tree sigil`}
            className="inline-flex shrink-0"
          >
            <PxIcon name="star" size={17} style={{ color: activeTreeDef.color }} />
          </span>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="relative border-b-2 border-red/40 bg-red/10 px-4 py-2 text-[11px] font-black uppercase text-red"
          >
            {errorMessage}
          </div>
        )}

        <div className="relative overflow-x-auto p-3">
          <div className="min-w-[520px] space-y-3">
            {tiers.map(([tier, tierNodes], tierIndex) => (
              <div key={tier} className="relative">
                {tierIndex > 0 && <div className="absolute -top-3 left-1/2 h-3 w-[2px] bg-amber/30" />}
                <div className="grid grid-cols-[58px_1fr] items-center gap-2">
                  <div className="text-[11px] font-black uppercase tracking-wide" style={{ color: BONE_FAINT }}>Tier {tier}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 3 }).map((_, idx) => {
                      // Audit COPY-03: a single-node tier renders its
                      // node exactly once, centered. The old expression
                      // matched an index-1 lone node (every keystone
                      // tier) at column 0 via find AND at column 1 via
                      // the centering fallback — the keystone listed
                      // twice on its own board.
                      const node = tierNodes.length === 1
                        ? (idx === 1 ? tierNodes[0] : undefined)
                        : tierNodes.find((n) => n.index === idx + 1);
                      if (!node) return <div key={`empty-${tier}-${idx}`} />;

                      const currentPoints = skillStore.spent[node.id] || 0;
                      const isMaxed = currentPoints >= node.maxPoints;
                      const prerequisitesMet = !node.requires || node.requires.every((req) => (skillStore.spent[req] || 0) > 0);
                      const isAvailable = canSpend(node.id) && pendingNodeId === null;
                      const isSelected = selectedNode?.id === node.id;
                      const isPending = pendingNodeId === node.id;
                      const size = node.type === 'keystone' ? 'min-h-[84px]' : node.type === 'major' ? 'min-h-[76px]' : 'min-h-[68px]';

                      return (
                        <motion.button
                          key={node.id}
                          whileTap={isAvailable ? { scale: 0.96 } : { scale: 0.98 }}
                          onClick={() => spendPoint(node.id)}
                          className={`relative border-2 p-2 text-left shadow-[4px_4px_0_rgba(0,0,0,0.65)] ${size} ${nodeTone(node, isAvailable, isMaxed)} ${isSelected ? 'ring-2 ring-amber/70' : ''}`}
                          style={{ clipPath: 'polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)' }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1">
                              <SkillKeystoneArt
                                tree={activeTree}
                                nodeType={node.type}
                                unlocked={prerequisitesMet || currentPoints > 0 || isMaxed}
                                spentPoints={currentPoints}
                                locked={!prerequisitesMet && currentPoints === 0 && !isMaxed}
                                size={20}
                                animate={node.type === 'keystone' && currentPoints > 0}
                              />
                              <div className="truncate text-[11px] font-black text-text-primary">{node.name}</div>
                            </div>
                            {isMaxed && <Lock size={11} className="shrink-0 text-green" />}
                          </div>
                          <div className="mt-1 pr-8 text-[11px] leading-snug text-text-muted">{node.description}</div>
                          <div className="absolute bottom-1 right-2 text-[11px] font-black" style={{ color: isMaxed ? '#22C55E' : isAvailable ? '#F59E0B' : '#6B7280' }}>
                            {isPending ? '…' : `${currentPoints}/${node.maxPoints}`}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <PlateFootStrip color={activeTreeDef.color} height={3} />
      </div>

      {selectedNode && (
        <div className="relative overflow-hidden p-4" style={plateShell}>
          <Bolts />
          <div className="relative space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[15px] font-black uppercase tracking-wide" style={{ color: BONE }}>{selectedNode.name}</div>
                <div className="mt-0.5 text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>{selectedNode.type} · Tier {selectedNode.tier}</div>
              </div>
              <div className="text-sm font-black" style={{ color: AMBER }}>{skillStore.spent[selectedNode.id] || 0}/{selectedNode.maxPoints}</div>
            </div>
            <div className="text-xs leading-snug" style={{ color: BONE_MUTED }}>{selectedNode.description}</div>
            {selectedNode.requires && selectedNode.requires.length > 0 && (
              <div className="text-[11px]" style={{ color: BONE_FAINT }}>Requires: {selectedNode.requires.map((reqId) => SKILL_NODES.find((n) => n.id === reqId)?.name ?? reqId).join(', ')}</div>
            )}
            {canSpend(selectedNode.id) ? (
              <button
                onClick={() => spendPoint(selectedNode.id)}
                disabled={pendingNodeId !== null}
                className="bl-primary min-h-[44px] w-full py-3 text-xs font-black disabled:opacity-50"
              >
                {pendingNodeId === selectedNode.id ? 'Training…' : `Spend ${selectedNode.cost} Point${selectedNode.cost === 1 ? '' : 's'}`}
              </button>
            ) : (
              <>
                <button
                  disabled
                  aria-disabled="true"
                  data-testid="skill-spend-unavailable"
                  className="bl-primary min-h-[44px] w-full py-3 text-xs font-black disabled:opacity-50"
                >
                  {pendingNodeId === selectedNode.id ? 'Training…' : `Spend ${selectedNode.cost} Point${selectedNode.cost === 1 ? '' : 's'}`}
                </button>
                <div className="text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
                  {spendReason(selectedNode) ?? 'Not spendable right now.'}
                </div>
              </>
            )}
          </div>
          {/* The tree's color rides the inspect plate's foot strip. */}
          <PlateFootStrip color={activeTreeDef.color} height={3} />
        </div>
      )}
    </div>
  );
};
