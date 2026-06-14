import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { isUsernameAvailable, setUsername } from '@/lib/supabase/usernameService';
import { validateUsername } from '@/lib/validation/username';
import { MobileCard } from '@/components/layout/MobileCard';

type Mode = 'create' | 'rename';

interface Props {
  mode?: Mode;
  force?: boolean;
  currentUsername?: string | null;
  canRenameAt?: string | null;
  onComplete?: () => void;
  onClose?: () => void;
}

export const UsernameSetupModal: React.FC<Props> = ({
  mode = 'create',
  force,
  currentUsername,
  canRenameAt,
  onComplete,
  onClose,
}) => {
  const auth = useAuth();
  const [value, setValue] = useState('');
  const [submitError, setSubmitError] = useState<{ value: string; message: string } | null>(null);
  const [availabilityError, setAvailabilityError] = useState<{ value: string; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isRename = mode === 'rename';
  const isLocked = useMemo(() => {
    if (!isRename || !canRenameAt) return false;
    return new Date() < new Date(canRenameAt);
  }, [isRename, canRenameAt]);

  const validationError = useMemo(() => {
    if (!value.trim()) return null;
    const validation = validateUsername(value);
    if (!validation.ok) return validation.error ?? null;
    if (isRename && value.trim().toLowerCase() === (currentUsername ?? '').trim().toLowerCase()) {
      return 'This is already your current username.';
    }
    return null;
  }, [currentUsername, isRename, value]);

  const error = submitError?.value === value
    ? submitError.message
    : validationError ?? (availabilityError?.value === value ? availabilityError.message : null);

  useEffect(() => {
    if (!value.trim() || validationError) return;

    const timer = setTimeout(async () => {
      setChecking(true);
      const available = await isUsernameAvailable(value);
      setChecking(false);
      if (!available) {
        setAvailabilityError({ value, message: 'That username is already taken.' });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [validationError, value]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    const validation = validateUsername(value);
    if (!validation.ok) {
      setSubmitError({ value, message: validation.error ?? 'Invalid username.' });
      return;
    }
    setSubmitting(true);
    const result = await setUsername(value);
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError({ value, message: result.error ?? 'Could not set username.' });
      return;
    }
    await auth.refreshAccount();
    onComplete?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <MobileCard className="w-full max-w-sm space-y-4" rarityColor="#FF9000">
        <div className="text-lg font-black uppercase text-amber">
          {isRename ? 'Rename Your Handle' : 'Choose Your Handle'}
        </div>
        <div className="text-xs text-text-muted">
          {isRename
            ? 'You can change your hunter name once every 7 days.'
            : 'Leaderboards and public profiles require a unique hunter name. This is how other players see you.'}
        </div>
        {isLocked && canRenameAt && (
          <div className="text-xs text-amber">
            You can rename again after {new Date(canRenameAt).toLocaleString()}.
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="hunter_name"
            className="bl-input w-full px-3 py-2 text-sm"
            maxLength={24}
            autoFocus
            disabled={isLocked}
          />
          {error && <div className="text-xs text-red">{error}</div>}
          {checking && <div className="text-xs text-text-muted">Checking availability…</div>}
          <button
            type="submit"
            disabled={submitting || !!error || !value.trim() || isLocked}
            className="bl-primary w-full py-2.5 text-xs font-black uppercase disabled:opacity-50"
          >
            {submitting ? (isRename ? 'Renaming…' : 'Claiming…') : (isRename ? 'Rename Handle' : 'Claim Handle')}
          </button>
        </form>
        {!force && onClose && (
          <button onClick={onClose} className="w-full text-xs text-text-muted hover:text-amber">
            Cancel
          </button>
        )}
      </MobileCard>
    </div>
  );
};
