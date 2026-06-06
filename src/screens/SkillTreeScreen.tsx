import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, Lock } from 'lucide-react';
import { getSkillTreeNodes } from '@/constants/skillTrees';
import { SkillTreeType } from '@/types/game';
import { usePlayerStore, useSkillStore } from '@/store';

const TREES = [
  { id: SkillTreeType.Gunslinger, label: 'Gunslinger', color: '#FF4B5C', desc: 'Weapon damage, crits, speed' },
  { id: SkillTreeType.Demolition, label: 'Demolition', color: '#FF9000', desc: 'Explosives, armor break' },
  { id: SkillTreeType.Scavenger, label: 'Scavenger', color: '#7CFC00', desc: 'Idle, loot, economy' },
];

export const SkillTreeScreen: React.FC = () => {
  const [activeTree, setActiveTree] = useState(SkillTreeType.Gunslinger);
  const player = usePlayerStore();
  const skillStore = useSkillStore();

  const pointsSpent = skillStore.getTotalSpent();
  const pointsEarned = Math.max(0, player.level - 1); // Start earning at level 2
  const pointsAvailable = Math.max(0, pointsEarned - pointsSpent);
  const nodes = getSkillTreeNodes(activeTree);
  const activeTreeDef = TREES.find((tree) => tree.id === activeTree) || TREES[0];

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
      <div className="flex items-center justify-between">
        <div className="bl-title text-3xl leading-none text-text-primary">Skill Trees</div>
        <button onClick={respec} className="flex items-center gap-1 text-xs text-amber bg-amber/10 px-2 py-1 rounded-xl border border-amber/30">
          <RotateCcw size={12} />
          Respec ({pointsSpent * 100}cr)
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="text-xs text-text-muted">Points: <span className="text-amber font-bold">{pointsAvailable}</span> available ({pointsSpent} spent · 1 per level)</div>
      </div>

      {/* Tree Selector */}
      <div className="grid grid-cols-3 gap-2">
        {TREES.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTree(t.id)}
            className={`p-2 rounded-xl border-2 text-left transition-colors ${
              activeTree === t.id ? 'border-amber bg-amber/10 shadow-[0_0_14px_rgba(255,144,0,0.35)]' : 'border-border bg-surface-raised'
            }`}
            style={{ borderLeftColor: t.color, borderLeftWidth: 5 }}
          >
            <div className="text-xs font-bold" style={{ color: t.color }}>{t.label}</div>
            <div className="text-[9px] text-text-muted mt-0.5">{t.desc}</div>
          </button>
        ))}
      </div>

      {/* Nodes */}
      <div className="space-y-2">
        {nodes.map((node) => {
          const currentPoints = skillStore.spent[node.id] || 0;
          const isMaxed = currentPoints >= node.maxPoints;
          const isAvailable = canSpend(node.id);
          const isKeystone = node.type === 'keystone';
          const isMajor = node.type === 'major';

          return (
            <motion.div
              key={node.id}
              whileTap={isAvailable ? { scale: 0.98 } : {}}
              onClick={() => spendPoint(node.id)}
              className={`rounded-xl p-3 border-2 cursor-pointer transition-colors shadow-[0_4px_12px_rgba(0,0,0,0.5)] ${
                isMaxed ? 'border-green/40 bg-green/5' : isAvailable ? 'border-amber bg-amber/5' : 'border-border bg-surface opacity-60'
              }`}
              style={{ borderLeftColor: isMaxed ? '#7CFC00' : activeTreeDef.color, borderLeftWidth: 5 }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isKeystone && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber text-bg font-bold">KEYSTONE</span>}
                  {isMajor && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple/20 text-purple font-bold">MAJOR</span>}
                  <div className="text-xs font-bold text-text-primary">{node.name}</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-bold" style={{ color: isMaxed ? '#22C55E' : isAvailable ? '#F59E0B' : '#6B7280' }}>
                    {currentPoints}/{node.maxPoints}
                  </span>
                  {isMaxed && <Lock size={12} className="text-green" />}
                </div>
              </div>
              <div className="text-[10px] text-text-secondary mt-1">{node.description}</div>
              {!isMaxed && isAvailable && (
                <div className="text-[10px] text-amber mt-1 font-bold">Tap to spend {node.cost}pt</div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
