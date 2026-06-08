# PR 15 Agent Prompt: Guest-First Supabase Auth Foundation

You are working in `michaelhmiv/CyberCache` on the `auth-client-guest-foundation` branch.

## Mandatory checks

Before editing, verify:

- repo is `michaelhmiv/CyberCache`
- branch is `auth-client-guest-foundation`
- package name is `cybercache`

Read:

- `AGENTS.md`
- `docs/AUTH_ONBOARDING_PLAN.md`
- `src/auth/accountState.ts`
- `src/auth/authTypes.ts`
- `src/lib/supabase/config.ts`
- `supabase/migrations/202606080002_account_state_and_verification.sql`

## Product requirements

CyberCache must support three account states:

1. Guest
   - uses Supabase anonymous sign-in
   - can play solo
   - can persist solo progress
   - cannot use market/service/escrow/trading/social/leaderboards

2. Registered unverified
   - email/password account
   - can play solo
   - can persist profile and inventory
   - gets daily verification reminders
   - cannot use inter-user economy/social features

3. Verified
   - email-confirmed account
   - full access to player economy/social systems

The 7-day verification grace date is a reminder/escalation date, not a solo-play blocker.

## Supabase settings assumed

- Email provider is enabled.
- Anonymous sign-ins are enabled.
- Railway has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Supabase redirects should include:
  - `https://cybercache-production.up.railway.app/**`
  - `http://localhost:5173/**`

Use query-string auth modes because the app does not currently use React Router:

- `?auth=confirmed`
- `?auth=reset-password`

## Required implementation

### 1. Install Supabase JS

Run locally:

```bash
npm install @supabase/supabase-js
```

Commit both `package.json` and `package-lock.json`.

### 2. Create Supabase client

Add `src/lib/supabase/client.ts`.

Use `requireSupabaseConfig()` from `src/lib/supabase/config.ts` and create a browser client.

Export the client from `src/lib/supabase/index.ts`.

### 3. Add auth service

Add `src/lib/supabase/authService.ts` with helpers:

- `getCurrentSession()`
- `onAuthStateChange(callback)`
- `signInAsGuest()` using anonymous sign-in
- `signInWithEmail(email, password)`
- `registerWithEmail(email, password, username)`
- `sendPasswordReset(email)` using redirect `?auth=reset-password`
- `updatePassword(password)`
- `signOut()`

For signup/register, pass useful metadata such as username if supported.

### 4. Add profile service

Add `src/lib/supabase/profileService.ts`.

Implement:

- `getProfile(userId)`
- `ensureProfile(user)`
- `markVerificationReminderSeen(userId)`
- `getAccountState(user)`

Profile bootstrap logic:

- If Supabase user is anonymous, create/upsert `profiles` row with `account_type = 'guest'`.
- If user has email but is not confirmed, create/upsert with `account_type = 'registered_unverified'`.
- If user email is confirmed, create/upsert with `account_type = 'verified'` and `email_verified_at` set.
- Set `verification_grace_expires_at = created_at + 7 days` where applicable.

Be careful not to overwrite existing username/display fields unnecessarily.

### 5. Add AuthProvider

Add `src/auth/AuthProvider.tsx`.

It should:

- load initial session
- subscribe to auth changes
- call `ensureProfile`
- expose `AuthContextValue`
- expose `useAuth()`
- track `authMode` from query string
- expose refresh/sign-in/sign-out helpers

### 6. Add AuthScreen

Add `src/screens/AuthScreen.tsx`.

Keep it simple and CyberCache-styled:

- Continue as Guest
- Login
- Create Account
- Forgot Password
- Reset Password mode

Do not overbuild. This is foundation work.

### 7. Gate App shell

Update `src/main.tsx` to wrap `App` with `AuthProvider`.

Update `src/App.tsx`:

- If auth is loading, show loading screen.
- If no user/session, show `AuthScreen`.
- If user exists, show current game shell.
- Add a small verification reminder banner in the game shell when `shouldShowVerificationReminder(account)` is true.

Do not block solo play for unverified users.

### 8. Feature gates

Use `src/auth/accountState.ts` for market/service/social gates.

For this PR, at minimum gate `MarketScreen` or market entry points with `canUseFeature(account, 'market')`.

If blocked, show a message explaining:

- guests need to create and verify an account
- registered users need to verify email

### 9. Tests

Keep existing tests green.

Add or update tests for:

- account state gates if needed
- auth redirect parsing
- profile account-state mapping if practical without mocking Supabase heavily

## Commands to run

```bash
npm test
npm run mechanics:validate
npm run mechanics:report
npm run build
npm run lint
```

## Important constraints

- Do not add React Router in this PR unless absolutely necessary.
- Do not remove existing game tabs/screens.
- Do not wire marketplace persistence yet.
- Do not save secrets in the repo.
- Keep changes focused on auth foundation and account gating.

## Expected result

A user can:

- open the app
- continue as guest
- create an email/password account
- log in
- log out
- request password reset
- reset password via query-string mode
- play solo as guest/unverified
- see verification reminders
- be blocked from player economy features until verified
