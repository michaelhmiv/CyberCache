/**
 * DeleteAccountControl — the Danger Zone's account-deletion block
 * (Build 7 — App Review hardening, Guideline 5.1.1(v)).
 *
 * Deletion is an IN-APP flow now: the button opens a confirmation
 * sheet in the shared PickerSheet grammar (the app's one sheet
 * language) that names exactly what is deleted and that it cannot
 * be undone; the explicit confirm calls POST /api/account/delete
 * (authService.deleteAccount — identity from the session, no body),
 * which clears the local session on success so the app returns to
 * the sign-in screen. A failure keeps the sheet open with a plain
 * player-language error and a retry — the raw server error text
 * never reaches this surface (the same law as the ad lanes, #621).
 * The web data-deletion page survives only as a secondary
 * "Learn more" link under the button.
 */
import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { PickerSheet } from '@/components/common/PickerSheet';
import { deleteAccount } from '@/lib/api/authService';

const DATA_DELETION_URL = 'https://chef-production.up.railway.app/data-deletion.html';

const DELETE_FAILURE_MESSAGE = 'Could not delete your account. Check your connection and try again.';

export const DeleteAccountControl: React.FC = () => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openSheet = () => {
    setError(null);
    setSheetOpen(true);
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      // The session is cleared: the signed-in tree unmounts and the
      // app lands on the sign-in screen. Close the sheet on the way.
      setSheetOpen(false);
    } catch {
      // The account still exists and the session is untouched —
      // say so plainly and let the player retry from the same sheet.
      setError(DELETE_FAILURE_MESSAGE);
      setDeleting(false);
    }
  };

  return (
    <div className="border-t border-border/60 pt-3">
      <div className="mb-2 text-[11px] leading-snug text-text-muted">
        Delete your CyberCache account and all of its server-side data, right here in the app. This cannot be undone.
      </div>
      <button
        type="button"
        data-testid="delete-account-open"
        onClick={openSheet}
        className="bl-secondary flex min-h-[44px] w-full items-center justify-center gap-2 py-2 text-xs font-black text-red"
      >
        Delete Account / Data
      </button>
      <button
        type="button"
        data-testid="delete-account-learn-more"
        onClick={() => window.open(DATA_DELETION_URL, '_blank', 'noopener,noreferrer')}
        className="mt-1.5 flex min-h-[44px] w-full items-center justify-center gap-1.5 py-1 text-[11px] font-bold text-text-muted"
      >
        <ExternalLink size={12} />
        Learn more about deletion
      </button>

      {sheetOpen && (
        <PickerSheet
          title="Delete account"
          subtitle="This cannot be undone"
          subtitleClassName="text-[11px] text-text-muted"
          onClose={() => {
            if (!deleting) setSheetOpen(false);
          }}
        >
          <div data-testid="delete-account-sheet">
            <div className="text-sm font-black text-text-primary">
              Delete your account and everything on it?
            </div>
            <p className="mt-1 text-[11px] font-bold leading-snug text-text-muted">
              Your account, profile and username, saved progress, hunters, gear and inventory, market
              listings, and leaderboard places are deleted from the server, and you are signed out
              everywhere. Guest accounts delete the same way. There is no undo and no recovery.
            </p>
            {error && (
              <div data-testid="delete-account-error" className="mt-3 text-[11px] font-bold text-red">
                {error}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                data-testid="delete-account-confirm"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-red/40 bg-red/10 px-3 py-2.5 text-xs font-black text-red disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete my account'}
              </button>
              <button
                type="button"
                data-testid="delete-account-cancel"
                onClick={() => setSheetOpen(false)}
                disabled={deleting}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-border bg-surface px-3 py-2.5 text-xs font-black text-text-muted disabled:opacity-50"
              >
                Keep my account
              </button>
            </div>
          </div>
        </PickerSheet>
      )}
    </div>
  );
};
