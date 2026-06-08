import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, RotateCcw, Sparkles, Zap } from 'lucide-react';
import { getSkillTreeNodes } from '@/constants/skillTrees';
import { SkillTreeType } from '@/types/game';
import { SkillNode } from '@/types/skill';
import { usePlayerStore, useSkillStore } from '@/store';

const TREES = [
  { id: SkillTreeType.Gunslinger, label: 'Gunslinger', color: '#FF4B5C', desc: 'Weapon damage, crits, speed' },
  { id: SkillTreeType.Demolition, label: 'Demolition', color: '#FF9000', desc: 'Explosives, armor break' },
  { id: SkillTreeType.Scavenger, label: 'Scavenger', color: '#7CFC00', desc: 'Idle, loot, economy' },
];

const nodeTone = (node: SkillNode, isAvailable: boolean, isMaxed: boolean) => {
  if (isMaxed) return 'border-green/60 bg-green/10 text-green';
  if (isAvailable) return 'border-amber bg-amber/10 text-amber';
  if (node.type === 'keystone') return 'border-purple/40 bg-purple/10 text-purple opacity-70';
  if (node.type === 'major') return 'border-amber/25 bg-surface text-text-secondary opacity-75';
  return 'border-border bg-surface text-text-muted opacity-65';
};

export const SkillTreeScreen: React.FC = () => {
  const [activeTree, setActiveTree] = useState(SkillTreeType.Gunslinger);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const player = usePlayerStore();
  const skillStore = useSkillStore();

  const pointsSpent = skillStore.getTotalSpent();
  const pointsEarned = Math.max(0, player.level - 1);
  const pointsAvailable = Math.max(0, pointsEarned - pointsSpent);
  const nodes = getSkillTreeNodes(activeTree);
  const activeTreeDef = TREES.find((tree) => tree.id === activeTree) || TREES[0];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0];

  const tiers = useMemo(() => {
    const grouped = new Map<number, SkillNode[]>();
    nodes.forEach((node) => {
      const current = grouped.get(node.tier) || [];
      current.push(node);
      grouped.set(node.tier, current.sort((a, b) => a.index - b.index));
    });
    return Array.from(grouped.entries()).sort(([a], [b]) => a - b);
  }, [nodes]);

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

  const spendPoint = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    if (!canSpend(nodeId)) return;
    skillStore.spendPoint(nodeId);
  };

  const respec = () => {
    const cost = skillStore.respecCost();
    if (skillStore.respec(player.credits)) {
      player.removeCredits(cost);
    }
  };

  return (
    <div className="bl-page p-4 space-y-4 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Skill Trees</div>
          <div className="text-xs text-text-muted mt-1">Choose a build path. Small nodes feed majors; majors unlock keystones.</div>
        </div>
        <button
          onClick={respec}
          className="shrink-0 flex items-center gap-1 text-xs text-amber bg-amber/10 px-2 py-1.5 rounded-xl border border-amber/30"
        >
          <RotateCcw size={12} />
          Respec
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-border bg-surface-raised p-2">
          <div className="text-[10px] text-text-muted uppercase">Available</div>
          <div className="text-xl font-black text-amber">{pointsAvailable}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface-raised p-2">
          <div className="text-[10px] text-text-muted uppercase">Spent</div>
          <div className="text-xl font-black text-text-primary">{pointsSpent}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface-raised p-2">
          <div className="text-[10px] text-text-muted uppercase">Cost</div>
          <div className="text-xl font-black text-text-primary">{pointsSpent * 100}cr</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {TREES.map((tree) => (
          <button
            key={tree.id}
            onClick={() => {
              setActiveTree(tree.id);
              setSelectedNodeId(null);
            }}
            className={`p-2 rounded-xl border-2 text-left transition-colors ${
              activeTree === tree.id ? 'border-amber bg-amber/10 shadow-[0_0_14px_rgba(255,144,0,0.35)]' : 'border-border bg-surface-raised'
            }`}
            style={{ borderLeftColor: tree.color, borderLeftWidth: 5 }}
          >
            <div className="text-xs font-black" style={{ color: tree.color }}>{tree.label}</div>
            <div className="text-[9px] text-text-muted mt-0.5 leading-tight">{tree.desc}</div>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border-2 border-border bg-surface/70 overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-xs font-black" style={{ color: activeTreeDef.color }}>{activeTreeDef.label} Board</div>
            <div className="text-[10px] text-text-muted">Scroll the board. Tap a node to inspect or spend points.</div>
          </div>
          <Sparkles size={16} style={{ color: activeTreeDef.color }} />
        </div>

        <div className="overflow-x-auto p-3">
          <div className="min-w-[520px] space-y-3">
            {tiers.map(([tier, tierNodes], tierIndex) => (
              <div key={tier} className="relative">
                {tierIndex > 0 && (
                  <div className="absolute -top-3 left-1/2 h-3 w-px bg-border" />
                )}
                <div className="grid grid-cols-[58px_1fr] gap-2 items-center">
                  <div className="text-[10px] uppercase tracking-wide text-text-muted font-bold">Tier {tier}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 3 }).map((_, idx) => {
                      const node = tierNodes.find((n) => n.index === idx + 1) || (tierNodes.length === 1 && idx === 1 ? tierNodes[0] : undefined);
                      if (!node) return <div key={`empty-${tier}-${idx}`} />;

                      const currentPoints = skillStore.spent[node.id] || 0;
                      const isMaxed = currentPoints >= node.maxPoints;
                      const isAvailable = canSpend(node.id);
                      const isSelected = selectedNode?.id === node.id;
                      const size = node.type === 'keystone' ? 'min-h-[76px]' : node.type === 'major' ? 'min-h-[68px]' : 'min-h-[58px]';

                      return (
                        <motion.button
                          key={node.id}
                          whileTap={isAvailable ? { scale: 0.96 } : { scale: 0.98 }}
                          onClick={() => spendPoint(node.id)}
                          className={`relative rounded-xl border-2 p-2 text-left shadow-[0_4px_12px_rgba(0,0,0,0.45)] ${size} ${nodeTone(node, isAvailable, isMaxed)} ${isSelected ? 'ring-2 ring-amber/70' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1 min-w-0">
                              {node.type === 'keystone' && <Zap size={12} className="text-amber shrink-0" />}
                              {node.type === 'major' && <Sparkles size={11} className="text-purple shrink-0" />}
                              <div className="text-[10px] font-black text-text-primary truncate">{node.name}</div>
                            </div>
                            {isMaxed && <Lock size={11} className="text-green shrink-0" />}
                          </div>
                          <div className="text-[9px] text-text-muted mt-1 line-clamp-2">{node.description}</div>
                          <div className="absolute right-2 bottom-1 text-[10px] font-black" style={{ color: isMaxed ? '#22C55E' : isAvailable ? '#F59E0B' : '#6B7280' }}>
                            {currentPoints}/{node.maxPoints}
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
        <div className="rounded-2xl border-2 border-border bg-surface p-3 space-y-2" style={{ borderLeftColor: activeTreeDef.color, borderLeftWidth: 5 }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-text-primary">{selectedNode.name}</div>
              <div className="text-[10px] text-text-muted uppercase">{selectedNode.type} · Tier {selectedNode.tier}</div>
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
              className="w-full rounded-xl bg-amber text-bg text-xs font-black py-2 active:scale-95 transition-transform"
            >
              Spend {selectedNode.cost} Point{selectedNode.cost === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
