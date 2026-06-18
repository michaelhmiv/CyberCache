import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, RotateCcw } from 'lucide-react';
import { getSkillTreeNodes } from '@/constants/skillTrees';
import { SkillTreeType } from '@/types/game';
import { SkillNode } from '@/types/skill';
import { usePlayerStore, useSkillStore } from '@/store';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import { SkillKeystoneArt } from '@/components/common/SkillKeystoneArt';

const TREES = [
  { id: SkillTreeType.Gunslinger, label: 'Gunslinger', color: '#FF4B5C', desc: 'Weapon damage, crits, speed' },
  { id: SkillTreeType.Demolition, label: 'Demolition', color: '#FF9000', desc: 'Explosives, armor break' },
  { id: SkillTreeType.Scavenger, label: 'Scavenger', color: '#7CFC00', desc: 'Idle, loot, economy' },
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

  const header = embedded ? null : (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="bl-title text-3xl leading-none text-text-primary">Skill Trees</div>
        <div className="text-xs text-text-muted mt-1">Spend points on crooked branches. Small nodes feed majors; majors unlock keystones.</div>
      </div>
      <button
        onClick={respec}
        disabled={pendingNodeId !== null}
        className="bl-secondary flex shrink-0 items-center gap-1 px-2 py-1.5 text-xs font-black text-amber disabled:opacity-50"
      >
        <RotateCcw size={12} /> Respec
      </button>
    </div>
  );

  const stats = embedded ? null : (
    <div className="grid grid-cols-3 gap-2">
      <div className="bl-card p-2"><div className="text-[10px] uppercase text-text-muted">Available</div><div className="text-xl font-black text-amber">{pointsAvailable}</div></div>
      <div className="bl-card p-2"><div className="text-[10px] uppercase text-text-muted">Spent</div><div className="text-xl font-black text-text-primary">{pointsSpent}</div></div>
      <div className="bl-card p-2"><div className="text-[10px] uppercase text-text-muted">Respec</div><div className="text-xl font-black text-text-primary">{pointsSpent * 100}cr</div></div>
    </div>
  );

  return (
    <div className={embedded ? '' : 'bl-page space-y-4 p-4 pb-20'}>
      {header}
      {stats}

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
                      const node = tierNodes.find((n) => n.index === idx + 1) || (tierNodes.length === 1 && idx === 1 ? tierNodes[0] : undefined);
                      if (!node) return <div key={`empty-${tier}-${idx}`} />;

                      const currentPoints = skillStore.spent[node.id] || 0;
                      const isMaxed = currentPoints >= node.maxPoints;
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
                              <SkillKeystoneArt tree={activeTree} nodeType={node.type} unlocked={currentPoints > 0} size={20} animate={node.type === 'keystone' && currentPoints > 0} />
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
