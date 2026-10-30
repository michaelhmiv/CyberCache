/**
 * BossSelectModal — App-level boss target selection.
 *
 * The modal is only a shell: the boss list itself is the shared
 * BossPickerList (the one boss picker). Selecting a boss here sets it
 * as the current target; the Fight tab's picker sheet renders the
 * same list with an onSelect that starts prep instead.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useBossStore } from '@/store/slices/bossSlice';
import { BossPickerList } from '@/components/fight/BossPickerList';
import type { BossDef } from '@/types/boss';

interface BossSelectModalProps {
  onClose: () => void;
}

export const BossSelectModal: React.FC<BossSelectModalProps> = ({ onClose }) => {
  const bossStore = useBossStore();

  const selectBoss = (boss: BossDef) => {
    bossStore.setCurrentBoss(boss.id);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 flex flex-col"
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-black text-text-primary">Select Target</div>
            <div className="text-xs text-text-muted">Choose which boss to hunt</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full bg-surface border border-border">
            <X size={20} />
          </button>
        </div>

        <BossPickerList onSelect={selectBoss} />
      </div>

      <div className="shrink-0 p-4 border-t border-border bg-surface">
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-amber text-bg font-bold text-sm"
        >
          Done
        </button>
      </div>
    </motion.div>
  );
};
