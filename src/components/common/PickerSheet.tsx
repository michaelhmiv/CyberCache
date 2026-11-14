/**
 * PickerSheet — shared bottom-sheet chrome for pickers.
 *
 * Provides the motion wrapper, overlay, close affordance, title area,
 * and a sticky header slot + scrollable body. Callers supply the
 * search/filter/sort/list content so the chrome stays consistent
 * across SlotGearPicker, ConsumablePicker, etc.
 *
 * The panel sizes to its content, capped at 92vh — the cap is a
 * MAX, not a fixed height (QC A5): short sheets (level specifics,
 * streak ladder, weekly claims) hug their content instead of
 * floating at the top of a full-height black void, while long
 * picker lists still fill to the cap and scroll their body.
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
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { SheetPortal } from './SheetPortal';
import { sheetMotionProps } from '@/lib/animation/uiMotion';

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
  /**
   * Presence control (Stage Iteration C1): when a caller keeps the
   * sheet mounted and drives visibility through this prop, the
   * exit animation plays on close. Callers that conditionally
   * mount the sheet instead keep working unchanged — their sheet
   * unmounts with them, so no exit can play — but every caller
   * gets the shared sheet motion and reduced-motion collapse.
   */
  open?: boolean;
  /**
   * Overlay stacking class (QB-4): defaults to z-50. A sheet opened
   * from inside another sheet (e.g. the gear inspect sheet at
   * z-[70]) passes a higher class so it lands on top of its host
   * instead of underneath the host's backdrop.
   */
  overlayZClass?: string;
}

export const PickerSheet: React.FC<PickerSheetProps> = ({
  title,
  subtitle,
  headerRight,
  header,
  children,
  onClose,
  open,
  overlayZClass = 'z-50',
}) => {
  const reduceMotion = useReducedMotion();
  const sheet = sheetMotionProps(reduceMotion);
  const isOpen = open ?? true;
  return (
    <SheetPortal>
    <AnimatePresence>
      {isOpen && (
      <motion.div
        data-testid="picker-sheet-overlay"
        {...sheet.backdrop}
        className={`fixed inset-0 ${overlayZClass} flex items-end bg-black/75`}
        onClick={onClose}
      >
        <motion.div
          {...sheet.panel}
          className="max-h-[92vh] w-full flex flex-col border-t-2 border-border bg-bg"
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

          {/* Scrollable list body — min-h-0 lets it shrink below
              content height once the panel hits the 92vh cap, so
              the body scrolls instead of stretching the sheet. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6" data-testid="picker-sheet-body">
            {children}
          </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
    </SheetPortal>
  );
};
