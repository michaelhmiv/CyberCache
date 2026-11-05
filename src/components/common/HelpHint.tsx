/**
 * HelpHint — the no-paragraphs law's affordance (owner ruling
 * 2026-11-05, generalizing the 2026-11-03 card-face law).
 *
 * Screens carry labels and controls only — mobile space is too
 * precious for explanatory sentences. A section that needs its
 * explanation gets this small "?" beside its label instead, and
 * the explanation lives in the sheet the "?" opens. First shipped
 * on the Loadout's Consumable Belt; future screens adopt this
 * component rather than growing their own pop-up or, worse,
 * printing the paragraph.
 *
 * The button is visually small (a 20px plate) but its hit area is
 * the full 44px the tap-target floor demands — negative margins
 * keep the layout footprint at the plate's size while the touch
 * box overflows invisibly, the claim-row precedent (PR #410).
 *
 * The sheet is the app's bottom-sheet grammar (ConsumableLedger):
 * backdrop, spring rise, clipped panel, close on backdrop tap,
 * the X, or Escape.
 */
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { PxIcon } from '@/components/pixelArt/PxIcon';

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };

export const HelpHint: React.FC<{
  /** Sheet title — the section's own label, so the sheet reads as
   *  that section's explanation and nothing else. */
  title: string;
  /** Accessible name for the "?" button. Defaults to the title. */
  label?: string;
  children: React.ReactNode;
}> = ({ title, label, children }) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open ]);

  return (
    <>
      <button
        type="button"
        aria-label={label ?? `About ${title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="help-hint-button"
        onClick={() => setOpen(true)}
        className="-m-[12px] flex h-11 w-11 shrink-0 items-center justify-center"
      >
        <span
          className={`flex h-5 w-5 items-center justify-center border transition-colors ${
            open ? 'border-amber/70 bg-amber/15 text-amber' : 'border-border bg-bg/60 text-text-muted'
          }`}
        >
          <PxIcon name="help" size={13} />
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[85] flex items-end justify-center bg-black/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              data-testid="help-hint-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="w-full max-w-[480px] border-t-2 border-border bg-bg p-4 pb-6 shadow-[0_-12px_32px_rgba(0,0,0,0.7)]"
              style={panelClip}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <PxIcon name="help" size={17} className="shrink-0 text-amber" />
                  <div className="text-base font-black text-text-primary">{title}</div>
                </div>
                <button
                  type="button"
                  aria-label={`Close ${title}`}
                  onClick={() => setOpen(false)}
                  className="bl-secondary shrink-0 p-2 text-text-muted"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="space-y-2 text-[13px] leading-relaxed text-text-secondary">{children}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
