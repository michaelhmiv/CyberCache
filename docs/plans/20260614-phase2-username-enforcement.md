# Phase 2 Implementation Plan: Username Enforcement Gate

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make username a hard requirement before any social/identifiable surface (leaderboards, public profiles) is reachable. Existing players without a username get a one-time setup prompt; new registrations must supply a valid, unique username. Guests receive an auto-generated handle. Players may rename their handle with a cooldown.

**Why this is Phase 2:** Phase 1 added the stats backend and expanded the private profile. Phase 3 will add leaderboards and public profile lookup. Before those go live we must ensure every visible identity has a human-readable, unique handle.

## Architecture decisions

1. **Server-authoritative username validation.** All uniqueness/format checks happen in Supabase RPCs. The client validates for UX but the RPC is the gate.
2. **Case-insensitive uniqueness.** Stored as-entered for display, but uniqueness is checked on `lower(trim(username))`.
3. **Auto-assign guests.** Anonymous/guest accounts get a generated handle (`guest_xxxxxxxx`) on profile creation so they are trackable without forcing a choice.
4. **Rename support with cooldown.** Players may change their handle; enforce a 7-day cooldown and increment a change counter for audit.
5. **Soft gate, not hard lock.** Players without a username can still play and access their own stats. They cannot access leaderboards, public profiles, or any feature that exposes them to other players.
6. **Reuse `FeatureGate`.** Extend `GatedFeature` and `canUseFeature` with a `username` requirement rather than building a parallel permission system.

---

## Current state

- `profiles.username` exists, nullable, no unique constraint.
- `handle_new_user()` writes username from `raw_user_meta_data ->> 'username'` on signup.
- `AuthScreen.tsx` already requires a non-empty username at registration, but does not validate format/uniqueness.
- `FeatureGate` + `accountState.ts` already gate `leaderboards` behind verified email.
- Most existing prod profiles have `username = null`.

---

## Task 0: Verify current prod username state

**Command:**
```bash
cd /data/cybercache && python3 - <<'PY'
import os, json, urllib.request
SUPABASE_URL = os.environ['VITE_SUPABASE_URL']
SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
url = f"{SUPABASE_URL}/rest/v1/profiles?select=count"
req = urllib.request.Request(url, headers={'apikey': SERVICE_KEY, 'Authorization': f'Bearer {SERVICE_KEY}'})
with urllib.request.urlopen(req) as resp:
    total = len(json.loads(resp.read()))
url2 = f"{SUPABASE_URL}/rest/v1/profiles?select=count&username=is.null"
req2 = urllib.request.Request(url2, headers={'apikey': SERVICE_KEY, 'Authorization': f'Bearer {SERVICE_KEY}'})
with urllib.request.urlopen(req2) as resp:
    nulls = len(json.loads(resp.read()))
print(f"total={total}, null_username={nulls}")
PY
```

**Expected:** A number. Keep it for the final report.

---

## Task 1: Migration — username constraints and RPCs

**File:** `supabase/migrations/20260614190000_username_enforcement.sql`

**Schema changes:**
1. Case-insensitive unique index on trimmed username.
2. Add to `profiles`:
   - `username_updated_at timestamptz`
   - `username_change_count int default 0`
3. Guest auto-assignment in `handle_new_user()`:
   - If `new.is_anonymous` or `new.raw_user_meta_data` lacks username, generate `guest_{random_8_chars}`.
   - Retry loop if collision.
4. RPC `cc_set_username(_username text, _is_rename boolean default false)`:
   - Trim + lowercase for uniqueness check.
   - Validate length 3–24, allowed charset `[a-zA-Z0-9_-]`.
   - Reject reserved words: `admin`, `mod`, `system`, `support`, `null`, `guest`, `cybercache`.
   - Check uniqueness via `lower(trim(...))`.
   - If `_is_rename` is true, enforce 7-day cooldown since `username_updated_at`.
   - Update `profiles.username`, `username_updated_at`, `username_change_count` for `auth.uid()`.
   - Return JSON `{ ok: boolean, error?: text }`.
5. RPC `cc_is_username_available(_username text)`:
   - Returns boolean.
   - Same normalization.
6. RPC `cc_my_profile_summary()`:
   - Returns `{ user_id, username, display_name, account_type, has_username, username_updated_at, can_rename_at }`.

**Draft SQL:**
```sql
-- Migration 20260614190000: Username enforcement

alter table public.profiles
  add column if not exists username_updated_at timestamptz,
  add column if not exists username_change_count int not null default 0;

create unique index if not exists idx_profiles_username_lower_unique
  on public.profiles (lower(trim(username)))
  where username is not null;

create index if not exists idx_profiles_username_lookup
  on public.profiles (lower(trim(username)));

-- Reserved usernames
create table if not exists public.username_reservations (
  username text primary key
);

truncate public.username_reservations restart identity;
insert into public.username_reservations (username)
values
  ('admin'), ('administrator'), ('mod'), ('moderator'),
  ('system'), ('support'), ('help'), ('null'),
  ('guest'), ('anonymous'), ('cybercache'), ('nousresearch')
on conflict do nothing;

-- Generate a collision-resistant guest handle
create or replace function public.cc_generate_guest_username()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
  attempts int := 0;
begin
  loop
    candidate := 'guest_' || upper(substring(md5(random()::text) from 1 for 8));
    attempts := attempts + 1;
    if not exists (select 1 from public.profiles where lower(trim(username)) = lower(candidate)) then
      return candidate;
    end if;
    if attempts > 20 then
      return 'guest_' || extract(epoch from now())::bigint;
    end if;
  end loop;
end;
$$;

create or replace function public.cc_validate_username(_username text)
returns table (
  ok boolean,
  error text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cleaned text;
begin
  if _username is null then
    return query select false, 'Username is required.';
    return;
  end if;

  cleaned := lower(trim(_username));

  if length(cleaned) < 3 then
    return query select false, 'Username must be at least 3 characters.';
    return;
  end if;

  if length(cleaned) > 24 then
    return query select false, 'Username must be 24 characters or fewer.';
    return;
  end if;

  if cleaned ~ '[^a-z0-9_-]' then
    return query select false, 'Username can only use letters, numbers, underscores, and hyphens.';
    return;
  end if;

  if exists (select 1 from public.username_reservations where username = cleaned) then
    return query select false, 'That username is reserved.';
    return;
  end if;

  return query select true, null::text;
end;
$$;

create or replace function public.cc_is_username_available(_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_error text;
  cleaned text;
begin
  select * into v_ok, v_error from public.cc_validate_username(_username);
  if not v_ok then
    return false;
  end if;

  cleaned := lower(trim(_username));
  return not exists (
    select 1 from public.profiles
    where lower(trim(username)) = cleaned
  );
end;
$$;

create or replace function public.cc_set_username(_username text, _is_rename boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_error text;
  cleaned text;
  current_username text;
  current_updated_at timestamptz;
  cooldown_until timestamptz;
begin
  select * into v_ok, v_error from public.cc_validate_username(_username);
  if not v_ok then
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  cleaned := lower(trim(_username));

  select username, username_updated_at
  into current_username, current_updated_at
  from public.profiles
  where id = auth.uid();

  -- If caller already owns this exact username, no-op success
  if lower(trim(coalesce(current_username, ''))) = cleaned then
    return jsonb_build_object('ok', true);
  end if;

  -- Rename cooldown: 7 days since last change
  if _is_rename and current_updated_at is not null then
    cooldown_until := current_updated_at + interval '7 days';
    if now() < cooldown_until then
      return jsonb_build_object(
        'ok', false,
        'error', format('You can rename again after %s.', cooldown_until::text)
      );
    end if;
  end if;

  if not public.cc_is_username_available(_username) then
    return jsonb_build_object('ok', false, 'error', 'That username is already taken.');
  end if;

  update public.profiles
  set
    username = trim(_username),
    username_updated_at = now(),
    username_change_count = username_change_count + 1,
    updated_at = now()
  where id = auth.uid();

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found.');
  end if;

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'That username is already taken.');
end;
$$;

create or replace function public.cc_my_profile_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'account_type', p.account_type,
    'has_username', p.username is not null,
    'username_updated_at', p.username_updated_at,
    'can_rename_at', p.username_updated_at + interval '7 days'
  )
  from public.profiles p
  where p.id = auth.uid();
$$;

-- Update handle_new_user to auto-assign guests and preserve chosen usernames
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  chosen_username text;
  assigned_username text;
begin
  chosen_username := nullif(trim(new.raw_user_meta_data ->> 'username'), '');

  if chosen_username is null and coalesce(new.is_anonymous, false) then
    assigned_username := public.cc_generate_guest_username();
  else
    assigned_username := chosen_username;
  end if;

  insert into public.profiles (
    id,
    username,
    display_name,
    account_type,
    email,
    email_verified_at,
    verification_grace_expires_at
  ) values (
    new.id,
    assigned_username,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    public.resolve_account_type(new.is_anonymous, new.email_confirmed_at),
    new.email,
    new.email_confirmed_at,
    now() + interval '7 days'
  )
  on conflict (id) do update set
    username = coalesce(
      excluded.username,
      public.profiles.username,
      case when public.profiles.account_type = 'guest' then public.cc_generate_guest_username() end
    ),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    account_type = excluded.account_type,
    email = excluded.email,
    email_verified_at = excluded.email_verified_at,
    verification_grace_expires_at = coalesce(public.profiles.verification_grace_expires_at, public.profiles.created_at + interval '7 days');

  return new;
end;
$$;

-- Backfill existing guest profiles without usernames
update public.profiles
set username = public.cc_generate_guest_username(),
    username_updated_at = now()
where username is null and account_type = 'guest';

-- Grants
revoke execute on function public.cc_validate_username(text) from public, anon, authenticated;
revoke execute on function public.cc_generate_guest_username() from public, anon, authenticated;
revoke execute on function public.cc_is_username_available(text) from public, anon;
revoke execute on function public.cc_set_username(text, boolean) from public, anon;
revoke execute on function public.cc_my_profile_summary() from public, anon;

grant execute on function public.cc_is_username_available(text) to authenticated;
grant execute on function public.cc_set_username(text, boolean) to authenticated;
grant execute on function public.cc_my_profile_summary() to authenticated;

revoke all on public.username_reservations from public, anon, authenticated;
```

**Authority test additions:** in `src/test/supabaseAuthority.test.ts`, verify:
- `public.cc_set_username(text)` is granted to authenticated.
- `public.cc_is_username_available(text)` is granted to authenticated.
- `public.cc_validate_username(text)` is **not** granted to authenticated (internal helper).

---

## Task 2: Client username service

**File:** `src/lib/supabase/usernameService.ts`

```ts
import { supabase } from './client';

export interface SetUsernameResult {
  ok: boolean;
  error?: string;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cc_is_username_available', {
    _username: username.trim(),
  });
  if (error) {
    console.error('isUsernameAvailable failed:', error.message);
    return false;
  }
  return Boolean(data);
}

export async function setUsername(username: string, isRename = false): Promise<SetUsernameResult> {
  const { data, error } = await supabase.rpc('cc_set_username', {
    _username: username.trim(),
    _is_rename: isRename,
  });
  if (error) {
    console.error('setUsername failed:', error.message);
    return { ok: false, error: error.message };
  }
  return (data as SetUsernameResult) ?? { ok: false, error: 'Unknown error.' };
}

export interface ProfileSummary {
  user_id: string;
  username: string | null;
  display_name: string | null;
  account_type: string;
  has_username: boolean;
  username_updated_at: string | null;
  can_rename_at: string | null;
}

export async function getMyProfileSummary(): Promise<ProfileSummary | null> {
  const { data, error } = await supabase.rpc('cc_my_profile_summary');
  if (error) {
    console.error('getMyProfileSummary failed:', error.message);
    return null;
  }
  return (data as ProfileSummary) ?? null;
}
```

Export from `src/lib/supabase/index.ts`.

---

## Task 3: Username validation helper

**File:** `src/lib/validation/username.ts`

```ts
export interface UsernameValidationResult {
  ok: boolean;
  error?: string;
}

const RESERVED = new Set([
  'admin', 'administrator', 'mod', 'moderator',
  'system', 'support', 'help', 'null',
  'guest', 'anonymous', 'cybercache', 'nousresearch',
]);

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

export function validateUsername(username: string): UsernameValidationResult {
  const cleaned = username.trim();

  if (!cleaned) {
    return { ok: false, error: 'Username is required.' };
  }

  if (cleaned.length < 3) {
    return { ok: false, error: 'Username must be at least 3 characters.' };
  }

  if (cleaned.length > 24) {
    return { ok: false, error: 'Username must be 24 characters or fewer.' };
  }

  if (!USERNAME_RE.test(cleaned)) {
    return { ok: false, error: 'Username can only use letters, numbers, underscores, and hyphens.' };
  }

  if (RESERVED.has(cleaned.toLowerCase())) {
    return { ok: false, error: 'That username is reserved.' };
  }

  return { ok: true };
}
```

**Tests:** `src/test/usernameValidation.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { validateUsername } from '../lib/validation/username';

describe('validateUsername', () => {
  it('accepts valid usernames', () => {
    expect(validateUsername('shrimps_23').ok).toBe(true);
    expect(validateUsername('a-b-c').ok).toBe(true);
  });

  it('rejects empty and short usernames', () => {
    expect(validateUsername('').ok).toBe(false);
    expect(validateUsername('ab').ok).toBe(false);
  });

  it('rejects long usernames', () => {
    expect(validateUsername('a'.repeat(25)).ok).toBe(false);
    expect(validateUsername('a'.repeat(24)).ok).toBe(true);
  });

  it('rejects invalid characters', () => {
    expect(validateUsername('has space').ok).toBe(false);
    expect(validateUsername('bad@name').ok).toBe(false);
  });

  it('rejects reserved names', () => {
    expect(validateUsername('Admin').ok).toBe(false);
    expect(validateUsername('cybercache').ok).toBe(false);
  });
});
```

---

## Task 4: Extend AccountState with username flag

**File:** `src/auth/accountState.ts`

1. Add `hasUsername: boolean` to `AccountState`.
2. Update `profileRowToAccountState` to set it from `profile.username`.
3. Add helper `hasUsernameSet(account)`.
4. Update `canUseFeature`:
   - For `'leaderboards'`: require `isVerifiedAccount(account) && hasUsernameSet(account)`.
   - For `'social'`: require `hasUsernameSet(account)` (verified already required by callers).
   - Update `GatedFeature` type if needed.

```ts
export function hasUsernameSet(account: AccountState | null): boolean {
  return Boolean(account?.hasUsername);
}

export function canUseFeature(account: AccountState | null, feature: GatedFeature): GateDecision {
  // ... existing checks ...

  if (feature === 'leaderboards') {
    if (!isVerifiedAccount(account)) {
      return { allowed: false, reason: 'Verify your email to unlock leaderboards.' };
    }
    if (!hasUsernameSet(account)) {
      return { allowed: false, reason: 'Set a username to appear on leaderboards.' };
    }
    return { allowed: true };
  }

  if (feature === 'social') {
    if (!hasUsernameSet(account)) {
      return { allowed: false, reason: 'Set a username to use social features.' };
    }
    return { allowed: true };
  }

  // ... rest of existing logic ...
}
```

**Impact:** `AuthProvider` calls `profileRowToAccountState` — no other changes needed there because `profile.username` is already fetched.

**Tests:** Update `src/test/accountState.test.ts` or create `src/test/usernameFeatureGate.test.ts` to assert gating logic.

---

## Task 5: Username setup / rename modal

**File:** `src/components/profile/UsernameSetupModal.tsx`

A full-screen modal or card that:
- Explains why a username is needed (first-time) or shows rename rules.
- Has an input with real-time client validation.
- Optional "Check availability" debounced call to `isUsernameAvailable`.
- Submit calls `setUsername(value, mode === 'rename')`.
- On success, calls `auth.refreshAccount()` to update `AccountState`.
- On error, shows the server error.
- Is not dismissible if shown as a forced gate.
- In rename mode, shows `can_rename_at` and disables submit until cooldown is over.

```tsx
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
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isRename = mode === 'rename';
  const isLocked = useMemo(() => {
    if (!isRename || !canRenameAt) return false;
    return new Date() < new Date(canRenameAt);
  }, [isRename, canRenameAt]);

  useEffect(() => {
    if (!value.trim()) {
      setError(null);
      return;
    }
    const validation = validateUsername(value);
    if (!validation.ok) {
      setError(validation.error ?? null);
      return;
    }
    if (isRename && value.trim().toLowerCase() === (currentUsername ?? '').trim().toLowerCase()) {
      setError('This is already your current username.');
      return;
    }
    setError(null);

    const timer = setTimeout(async () => {
      setChecking(true);
      const available = await isUsernameAvailable(value);
      setChecking(false);
      if (!available) {
        setError('That username is already taken.');
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [value, isRename, currentUsername]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    const validation = validateUsername(value);
    if (!validation.ok) {
      setError(validation.error ?? 'Invalid username.');
      return;
    }
    setSubmitting(true);
    const result = await setUsername(value, isRename);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not set username.');
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
```

**Note:** If `force` is true, do not render a close button. If `force` is false, allow an optional close action.

---

## Task 6: Prompt registered users once

**File:** `src/App.tsx` or root layout

After auth loads, if `account.hasUsername === false` and the user is **not** a guest (registered or registered_unverified), render `<UsernameSetupModal force />`. Guests are auto-assigned `guest_xxxxxxxx` handles by `handle_new_user()` and never see this prompt.

Where to inject:
- In `App.tsx`, after the auth loading spinner, before the main screen router.
- Gate on `!account?.hasUsername && !account?.isAnonymous && !auth.loading`.

```tsx
{account && !account.hasUsername && !account.isAnonymous && (
  <UsernameSetupModal force />
)}
```

**Important:** This must appear after `AuthProvider` hydration is complete, not during initial loading.

---

## Task 7: Add username display and rename to ProfileScreen

**File:** `src/screens/ProfileScreen.tsx`

- Show `username` prominently under the player name on the profile header card.
- Add a small "Rename" button if the user is looking at their own profile; opens `<UsernameSetupModal mode="rename" currentUsername={username} canRenameAt={summary?.can_rename_at} />`.
- If username is missing for a registered user, show a "Set username" button that opens `<UsernameSetupModal />`.

```tsx
<div className="truncate text-lg font-black uppercase tracking-wide text-text-primary">{player.name}</div>
<div className="flex items-center gap-2 text-xs text-text-muted">
  {account?.hasUsername ? (
    <>
      <span className="text-amber">@{account.username ?? stats?.username}</span>
      <button
        onClick={() => setRenameOpen(true)}
        className="text-[10px] underline hover:text-amber"
      >
        Rename
      </button>
    </>
  ) : (
    <button onClick={() => setSetupOpen(true)} className="text-amber underline">
      Set username
    </button>
  )}
</div>
```

**Decision:** add `username: string | null` to `AccountState` and `profileRowToAccountState` so the header can read it without waiting for the stats RPC.

---

## Task 8: Harden registration client validation

**File:** `src/screens/AuthScreen.tsx`

Before calling `auth.registerWithEmail`, run `validateUsername(username)`. If invalid, show `localError`.

```ts
import { validateUsername } from '@/lib/validation/username';

if (auth.authMode === 'register') {
  const validation = validateUsername(username);
  if (!validation.ok) {
    setLocalError(validation.error);
    return;
  }
  if (!requireEmail() || !requireMatchingSecret()) return;
  await auth.registerWithEmail(email.trim(), secret, username.trim());
}
```

This prevents obviously invalid usernames before the server roundtrip.

---

## Task 9: Gate leaderboards and public stats

**File:** `src/lib/supabase/statsService.ts`

Update `getPublicStats(userId: string)` to check the target user's username before returning. The RPC `cc_public_stats` currently returns the full row regardless. Options:

1. Keep RPC as-is and gate at UI layer (only call from leaderboard/profile screens which are already FeatureGated).
2. Harden RPC to return null if the caller has no username (mutual gate).

Recommended: Option 2 for defense in depth. Update `cc_public_stats` to:

```sql
create or replace function public.cc_public_stats(_user_id uuid)
returns public.player_public_stats
language sql
stable
security definer
set search_path = public
as $$
  -- Caller must have a username to look up other players.
  select null::public.player_public_stats
  where not exists (
    select 1 from public.profiles where id = auth.uid() and username is not null
  );

  select *
  from public.player_public_stats
  where user_id = _user_id;
$$;
```

This returns nothing if the caller lacks a username. Update `statsService.ts` to handle null gracefully.

**Tests:** Add a server-side behavior note; integration test requires two users, so document it for manual QA.

---

## Task 10: Tests

1. **`src/test/usernameValidation.test.ts`** — client validation rules.
2. **Update `src/test/supabaseAuthority.test.ts`** — verify new RPC grants.
3. **Update/create `src/test/accountState.test.ts`** — verify `canUseFeature('leaderboards')` requires username.
4. **Manual QA script:** (see Task 12)

---

## Task 11: Build, typecheck, deploy

```bash
cd /data/cybercache
npx tsc --noEmit
npx vitest run
npm run build

# Deploy migration
cd /data/cybercache && GOMAXPROCS=1 SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" npx supabase db query --linked --file supabase/migrations/20260614190000_username_enforcement.sql

# Register migration version (only after manual apply succeeds)
GOMAXPROCS=1 SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" npx supabase migration repair --status applied 20260614190000 --linked

# Push code
git add -A
git commit -m "feat(auth): enforce username before social/leaderboard features"
git pull --rebase origin master
git push origin master
```

---

## Task 12: Verification checklist

- [ ] `npx tsc --noEmit` passes.
- [ ] All tests pass.
- [ ] `cc_set_username` rejects invalid/duplicate names.
- [ ] `cc_is_username_available` returns correct boolean.
- [ ] `cc_my_profile_summary` returns `has_username`.
- [ ] Existing account with `username = null` sees forced modal on next login.
- [ ] Setting username dismisses modal and refreshes account state.
- [ ] New registration with invalid username shows inline error.
- [ ] `FeatureGate feature="leaderboards"` blocks until username is set.
- [ ] `cc_public_stats` returns null for caller without username.
- [ ] Prod build deploys and health check passes.

---

## Task 13: Edge cases and follow-ups

- **Google OAuth users:** They currently may not have a username. The forced modal will catch them on first login after this deploy.
- **Username rename:** Not supported in Phase 2. Add cooldown/rename token later.
- **Display name vs username:** Keep `display_name` optional and separate. Username is the canonical handle.
- **Case sensitivity:** Display shows original casing; uniqueness is case-insensitive.
- **Reserved list:** Expand as needed via `username_reservations` table or hardcoded list.

---

## Open questions for the user

1. **Minimum username length** — I chose 3. Want 2? 4?
2. **Allow rename after set?** — I assumed no for Phase 2.
3. **Should guests be forced to set username too, or only registered/verified users?** — I assumed only registered/verified (guests stay anonymous).
4. **Should username appear in the top ResourceBar or only on profile?** — I added it to profile header only.

Once you approve, I can proceed task-by-task.