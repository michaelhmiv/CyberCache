/**
 * SwapUndoToast — transient "Equipped X (was Y) — UNDO" banner.
 *
 * Appears at the bottom of the screen for ~4 seconds after a gear swap.
 * Tapping UNDO re-equips the previous item. The toast auto-dismisses when
 * the timeout expires or when the caller stops rendering it.
 *
 * This component is view-only; the caller owns the swap state and undo
 * action. That keeps verified equip logic in one place per caller.
 *
 * Rendered through a portal to document.body (device feedback r2):
 * the toast is position:fixed, and its only caller mounts it inside
 * the loadout panel whose clip-path + overflow:hidden would trap the
 * toast inside the panel's box instead of the bottom of the screen.
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Undo2 } from 'lucide-react';

interface SwapUndoToastProps {
  visible: boolean;
  itemName: string;
  previousName?: string | null;
  onUndo: () => void;
  onDismiss: () => void;
  /** Duration in milliseconds before auto-dismiss. */
  durationMs?: number;
}

export const SwapUndoToast: React.FC<SwapUndoToastProps> = ({
  visible,
  itemName,
  previousName,
  onUndo,
  onDismiss,
  durationMs = 4000,
}) => {
  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [visible, durationMs, onDismiss]);

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          data-testid="swap-undo-toast"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="pointer-events-auto fixed bottom-4 left-4 right-4 z-[60] border-2 border-amber/60 bg-surface/95 p-3 shadow-lg"
          style={{ clipPath: 'polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-black text-text-primary truncate">
                Equipped <span className="text-amber">{itemName}</span>
              </div>
              {previousName ? (
                <div className="text-[10px] text-text-muted truncate">Was {previousName}</div>
              ) : (
                <div className="text-[10px] text-text-muted">Slot was empty</div>
              )}
            </div>
            <button
              type="button"
              onClick={onUndo}
              className="flex shrink-0 items-center gap-1.5 rounded bg-amber px-3 py-1.5 text-[10px] font-black text-bg hover:bg-amber/90"
            >
              <Undo2 size={12} />
              UNDO
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
