/**
 * PickerSheet — shared full-height bottom-sheet chrome for pickers.
 *
 * Provides the motion wrapper, overlay, close affordance, title area,
 * and a sticky header slot + scrollable body. Callers supply the
 * search/filter/sort/list content so the chrome stays consistent
 * across SlotGearPicker, ConsumablePicker, etc.
 *
 * The sheet renders through a portal to document.body (device
 * feedback r2): the overlay is position:fixed, and a fixed element is
 * trapped by any ancestor carrying clip-path / overflow:hidden /
 * transform — the loadout panel's angled clip-path did exactly that
 * to the Slot Picker on device, squeezing the "full-screen" sheet
 * into the panel's box where its rows could not be reached. Sheets
 * must never be descendants of panel chrome.
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { SheetPortal } from './SheetPortal';

interface PickerSheetProps {
  title: string;
  subtitle?: string;
  /** Optional right-side header content (e.g. a count badge). */
  headerRight?: React.ReactNode;
  /** Sticky header slot for search bar, filter chips, sort row. */
  header?: React.ReactNode;
  /** Scrollable body content (the item list). */
  children: React.ReactNode;
  onClose: () => void;
}

export const PickerSheet: React.FC<PickerSheetProps> = ({
  title,
  subtitle,
  headerRight,
  header,
  children,
  onClose,
}) => {
  return (
    <SheetPortal>
    <AnimatePresence>
      <motion.div
        data-testid="picker-sheet-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end bg-black/75"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          className="h-[92vh] w-full flex flex-col border-t-2 border-border bg-bg"
          onClick={(event) => event.stopPropagation()}
        >
          {/* Header title */}
          <div className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-3 border-b border-border/50">
            <div className="min-w-0">
              <div className="bl-title text-2xl text-text-primary">{title}</div>
              {subtitle && (
                <div className="text-[10px] text-text-muted truncate">{subtitle}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {headerRight && <div className="shrink-0">{headerRight}</div>}
              <button
                type="button"
                onClick={onClose}
                className="bl-secondary p-2 text-text-muted"
                aria-label="Close picker"
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </div>

          {/* Sticky header slot (search / filter / sort) */}
          {header && (
            <div className="shrink-0 px-4 py-2 space-y-2 border-b border-border/30">
              {header}
            </div>
          )}

          {/* Scrollable list body */}
          <div className="flex-1 overflow-y-auto px-4 pb-6" data-testid="picker-sheet-body">
            {children}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
    </SheetPortal>
  );
};
