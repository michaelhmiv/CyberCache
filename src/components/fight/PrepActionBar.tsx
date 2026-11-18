import type { ReactNode } from 'react';

/**
 * The prep action bar (first-screen fix R2, owner-approved layout
 * 2026-11-17).
 *
 * A prep panel's start action used to live at the very bottom of a
 * long scroll — below the fold on the first screen. The bar pins
 * the decision at the fold instead: the subject's name, the true
 * price line (composed by the panel from its own shipped fee math
 * — this component never derives a fee), and the start button.
 *
 * Placement law: the bar must be a DIRECT CHILD of the panel root.
 * The prep content above it animates inside an AnimatePresence
 * motion wrapper whose transform creates a containing block — a
 * sticky element inside that wrapper can never travel. As a root
 * child the bar's sticky range is the whole panel, so it rides at
 * the fold for the full prep scroll and settles in flow at the
 * panel's foot.
 *
 * `bottom-2` parks it one step above the page's bottom edge, the
 * same parking the shipped sheets use. Type: 13px title / 11px
 * detail — on the floor. The button is 48px tall.
 */
export function PrepActionBar({
  testId,
  buttonTestId,
  title,
  detail,
  buttonLabel,
  onAction,
  disabled,
}: {
  testId: string;
  buttonTestId: string;
  title: string;
  detail: ReactNode;
  buttonLabel: string;
  onAction: () => void;
  disabled: boolean;
}) {
  return (
    <div
      data-testid={testId}
      className="sticky bottom-2 z-20 border-2 border-border bg-bg/95 px-3 py-2 shadow-[0_10px_22px_rgba(0,0,0,0.45)] backdrop-blur"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-black leading-tight text-text-primary">{title}</p>
          <p className="mt-0.5 truncate text-[11px] font-bold leading-tight text-text-muted">{detail}</p>
        </div>
        <button
          type="button"
          data-testid={buttonTestId}
          onClick={onAction}
          disabled={disabled}
          className="bl-primary min-h-[48px] shrink-0 px-4 text-xs font-black uppercase tracking-wider disabled:opacity-50"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
