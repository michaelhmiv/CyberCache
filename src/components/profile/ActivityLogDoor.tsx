import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';

/**
 * Activity Log door (AL-3, DESIGN.md §3 Hunter → Profile) — the
 * second door to the full record, seated directly under the
 * Lifetime Record panel: the totals say what you have, the log
 * says how it happened. Anatomy mirrors the Standings door beside
 * it (bl-card, amber edge, icon plate, Door-15 title, chevron).
 * The first door is Home's feed foot ("See full log").
 */
export const ActivityLogDoor: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    data-testid="activity-log-door"
    className="bl-card flex w-full items-center gap-3 p-3 text-left transition-transform active:scale-[0.98]"
    style={{ borderLeftColor: '#FF9000', borderLeftWidth: 5 }}
  >
    <div className="bl-icon-plate flex h-11 w-11 shrink-0 items-center justify-center bg-amber/15 text-amber">
      <PxIcon name="diamondIn" size={26} />
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-[15px] font-black uppercase tracking-wide text-text-primary">
        Activity Log
      </div>
      <div className="text-[11px] leading-snug text-text-muted">
        Every drop, trade, craft, and fight — with its receipt and the odds it rolled
      </div>
    </div>
    <PxIcon name="chevR" size={17} className="shrink-0 text-text-muted" />
  </button>
);
