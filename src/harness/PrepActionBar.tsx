import React from 'react';

/**
 * R2 bars-render: the sticky in-panel action bar (presentation
 * only, dash/bars-render — never merged).
 *
 * Grammar precedent: the consumable inspect sheet's sticky
 * bottom bar (sticky bottom-0, border-t-2, bg/95 + blur) — the
 * one action surface in the shipped game that stays on the
 * first screen while its content scrolls. Here the bar is the
 * prep container's last child with `sticky bottom-2`, so it
 * pins at the fold while the panel scrolls under it and
 * settles at the panel's end where the buried button used to
 * sit. It REPLACES the in-flow action button in the variant —
 * one Start control per surface, never two.
 *
 * Contents law (Intel Law): surface name + true fee + the
 * action. Nothing computed, nothing about odds.
 */
export const PrepActionBar: React.FC<{
  testId: string;
  title: string;
  detail: React.ReactNode;
  buttonLabel: string;
  onAction: () => void;
  disabled?: boolean;
}> = ({ testId, title, detail, buttonLabel, onAction, disabled }) => (
  <div
    data-testid={testId}
    className="sticky bottom-2 z-20 border-2 border-border bg-bg/95 px-3 py-2 shadow-[0_10px_22px_rgba(0,0,0,0.45)] backdrop-blur"
  >
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-black leading-tight text-text-primary">{title}</div>
        <div className="mt-0.5 truncate text-[11px] font-bold leading-tight text-text-muted">{detail}</div>
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className="bl-primary min-h-[48px] shrink-0 px-4 text-xs font-black uppercase tracking-wider disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </div>
  </div>
);
