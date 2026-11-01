import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, RotateCcw } from 'lucide-react';
import { getSkillTreeNodes } from '@/constants/skillTrees';
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
    <div className="bl-card space-y-2 p-3" data-testid="action-skill-picker">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Action Skill</div>
        {view.selected && (
          <div className="font-mono text-[11px] font-black text-text-primary">
            {Math.floor(view.charge)}/{ACTION_SKILL_CHARGE_MAX} charge
          </div>
        )}
      </div>
      {view.qualified.length === 0 ? (
        <div className="text-[11px] leading-snug text-text-muted" data-testid="action-skill-picker-none">
          {NO_KEYSTONE_NOTE}
        </div>
      ) : (
        <>
          <div className="text-[11px] leading-snug text-text-muted">
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
                  className={`border-2 p-2 text-left disabled:opacity-50 ${isActive ? 'ring-2 ring-amber/70' : ''}`}
                  style={{ borderLeftColor: visual.color, borderLeftWidth: 5 }}
                >
                  <div className="flex items-center gap-1.5">
                    <span style={{ color: visual.color, fontSize: 14 }}>{visual.sigil}</span>
                    <span className="text-[11px] font-black text-text-primary">{def.name}</span>
                  </div>
                  <div className="mt-0.5 text-[9px] leading-tight text-text-muted">{def.summary}</div>
                  <div className="mt-1 text-[9px] font-black uppercase" style={{ color: visual.color }}>
                    {isActive ? 'Active — tap to clear' : `${tree} signature`}
                  </div>
                </button>
              );
            })}
          </div>
          {pickError && (
            <div role="alert" className="text-[10px] font-black uppercase text-red">{pickError}</div>
          )}
        </>
      )}
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
      className="bl-secondary flex shrink-0 items-center gap-1 px-2 py-1.5 text-xs font-black text-amber disabled:opacity-50"
    >
      <RotateCcw size={12} /> Respec
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

  const stats = (
    <div className="grid grid-cols-3 gap-2">
      <div className="bl-card p-2"><div className="text-[10px] uppercase text-text-muted">Available</div><div className="text-xl font-black text-amber">{pointsAvailable}</div></div>
      <div className="bl-card p-2"><div className="text-[10px] uppercase text-text-muted">Spent</div><div className="text-xl font-black text-text-primary">{pointsSpent}</div></div>
      <div className="bl-card p-2"><div className="text-[10px] uppercase text-text-muted">Respec</div><div className="text-xl font-black text-text-primary">{pointsSpent * 100}cr</div></div>
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
          spent from its inspect panel, and cc_retrain refunds every
          spent point at pointsSpent × 100cr. */}
      <div className="text-[10px] leading-snug text-text-muted">
        Skill points come from levels — 1 per level ({pointsEarned} earned at level {player.level}). Tap a node to inspect it and spend its listed cost. Respec refunds every spent point for 100cr per point.
      </div>
      {embedded && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] text-text-muted">Respec refunds every spent point for {pointsSpent * 100}cr.</div>
          {respecButton}
        </div>
      )}

      <ActionSkillPicker />

      <div className={embedded ? '' : 'space-y-4'}>
        {TREES.map((tree) => (
          <button
            key={tree.id}
            onClick={() => {
              setActiveTree(tree.id);
              setSelectedNodeId(null);
            }}
            className={`bl-card p-2 text-left transition-colors ${activeTree === tree.id ? 'ring-2 ring-amber/70' : ''}`}
            style={{ borderLeftColor: tree.color, borderLeftWidth: 5 }}
          >
            <div className="text-xs font-black uppercase" style={{ color: tree.color }}>{tree.label}</div>
            <div className="mt-0.5 text-[9px] leading-tight text-text-muted">{tree.desc}</div>
          </button>
        ))}
      </div>

      <div className="bl-card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b-2 border-border px-3 py-2">
          <div>
            <div className="text-xs font-black uppercase tracking-wide" style={{ color: activeTreeDef.color }}>{activeTreeDef.label} Board</div>
            <div className="text-[10px] text-text-muted">Horizontal scroll is intentional on mobile. Tap a node to inspect or spend.</div>
          </div>
          <span className="font-black" style={{ color: activeTreeDef.color, fontSize: '16px' }}>✦</span>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="border-b-2 border-red/40 bg-red/10 px-3 py-2 text-[10px] font-black uppercase text-red"
          >
            {errorMessage}
          </div>
        )}

        <div className="overflow-x-auto p-3">
          <div className="min-w-[520px] space-y-3">
            {tiers.map(([tier, tierNodes], tierIndex) => (
              <div key={tier} className="relative">
                {tierIndex > 0 && <div className="absolute -top-3 left-1/2 h-3 w-[2px] bg-amber/30" />}
                <div className="grid grid-cols-[58px_1fr] items-center gap-2">
                  <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Tier {tier}</div>
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
                      const size = node.type === 'keystone' ? 'min-h-[76px]' : node.type === 'major' ? 'min-h-[68px]' : 'min-h-[58px]';

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
                                locked={!prerequisitesMet && currentPoints === 0 && !isMaxed}
                                size={20}
                                animate={node.type === 'keystone' && currentPoints > 0}
                              />
                              <div className="truncate text-[10px] font-black text-text-primary">{node.name}</div>
                            </div>
                            {isMaxed && <Lock size={11} className="shrink-0 text-green" />}
                          </div>
                          <div className="mt-1 line-clamp-2 text-[9px] text-text-muted">{node.description}</div>
                          <div className="absolute bottom-1 right-2 text-[10px] font-black" style={{ color: isMaxed ? '#22C55E' : isAvailable ? '#F59E0B' : '#6B7280' }}>
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
      </div>

      {selectedNode && (
        <div className="bl-card space-y-2 p-3" style={{ borderLeftColor: activeTreeDef.color, borderLeftWidth: 5 }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black uppercase tracking-wide text-text-primary">{selectedNode.name}</div>
              <div className="text-[10px] uppercase text-text-muted">{selectedNode.type} · Tier {selectedNode.tier}</div>
            </div>
            <div className="text-xs font-black text-amber">{skillStore.spent[selectedNode.id] || 0}/{selectedNode.maxPoints}</div>
          </div>
          <div className="text-xs text-text-secondary">{selectedNode.description}</div>
          {selectedNode.requires && selectedNode.requires.length > 0 && (
            <div className="text-[10px] text-text-muted">Requires: {selectedNode.requires.join(', ')}</div>
          )}
          {canSpend(selectedNode.id) && (
            <button
              onClick={() => spendPoint(selectedNode.id)}
              disabled={pendingNodeId !== null}
              className="bl-primary w-full py-2 text-xs font-black disabled:opacity-50"
            >
              {pendingNodeId === selectedNode.id ? 'Training…' : `Spend ${selectedNode.cost} Point${selectedNode.cost === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
