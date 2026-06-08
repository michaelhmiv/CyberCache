# PR 15 Agent Prompt: Guest-First Supabase Auth Foundation

You are working on CyberCache in repo `michaelhmiv/CyberCache`, branch `auth-client-guest-foundation`, PR #15.

## 0. Mandatory verification

Before editing anything, verify:

- repo is exactly `michaelhmiv/CyberCache`
- branch is exactly `auth-client-guest-foundation`
- `package.json` has `"name": "cybercache"`
- this is not Sportfolio or any other repo

If any check fails, stop and switch to the correct repo/branch.

## 1. Read these first

Read these files before changing code:

```txt
AGENTS.md
docs/AUTH_ONBOARDING_PLAN.md
docs/PR15_AUTH_AGENT_PROMPT.md
src/auth/accountState.ts
src/auth/authTypes.ts
src/lib/supabase/config.ts
src/lib/supabase/index.ts
src/App.tsx
src/main.tsx
src/screens/MarketScreen.tsx
supabase/migrations/202606080001_content_runtime_foundation.sql
supabase/migrations/202606080002_account_state_and_verification.sql
```

These files define the source-of-truth direction and the account-state model. Do not bypass them.

## 2. Current architecture context

CyberCache is a Vite + React + TypeScript app.

The repo already has:

- `src/content` static gameplay framework
- mechanics validation/report utilities
- Supabase runtime schema migrations
- GitHub Actions CI
- Supabase migration deployment workflow
- account-state schema from PR #14
- draft PR #15 scaffolding for account gates and auth types

PR #15 currently contains:

```txt
src/auth/accountState.ts
src/auth/authTypes.ts
src/test/accountState.test.ts
docs/PR15_AUTH_AGENT_PROMPT.md
```

Your job is to complete the real app-side Supabase auth implementation.

## 3. Product requirements

CyberCache must support three account states.

### Guest

A guest is a Supabase anonymous user.

Guest users can:

- enter immediately
- play solo
- persist solo progress once runtime persistence is wired
- eventually upgrade to a full account without losing progress

Guest users cannot:

- use marketplace
- trade
- create service jobs
- use escrow
- use player-to-player systems
- affect social systems
- affect leaderboards

### Registered unverified

A registered unverified user has an email/password account but has not confirmed email ownership.

Registered unverified users can:

- log in
- play solo
- persist profile and inventory
- see daily verification reminders

Registered unverified users cannot:

- use marketplace
- trade
- create service jobs
- use escrow
- use player-to-player systems
- affect social systems
- affect leaderboards

### Verified

Verified users have confirmed email ownership.

Verified users can:

- play solo
- use marketplace
- use service jobs
- use escrow
- use future social systems
- affect future leaderboards
- access the full player economy

## 4. Verification grace rule

The 7-day verification grace date is a reminder/escalation deadline, not a solo-play hard block.

Before the grace date, show light copy:

```txt
Verify your email to unlock trading, shops, and player services.
```

After the grace date, show stronger copy:

```txt
Email verification is required to use marketplace, shops, services, and social features.
```

Do not block Fight, Loot, Loadout, or other solo gameplay because the user is unverified. Only block inter-user/economy/social features.

## 5. Supabase and redirect assumptions

Production public URL:

```txt
https://cybercache-production.up.railway.app
```

Supabase project ref:

```txt
dyrmcwutjdzontjawqii
```

Railway already provides the Vite Supabase environment values used by `src/lib/supabase/config.ts`.

Supabase Auth settings should allow:

```txt
https://cybercache-production.up.railway.app/**
http://localhost:5173/**
```

The Railway internal port does not matter for redirects. Supabase should redirect to the public browser URL.

This app does not currently use React Router. Do not add React Router in this PR unless absolutely unavoidable.

Use query-string modes:

```txt
?auth=confirmed
?auth=reset-password
```

Code should use the current browser origin for redirect construction. Do not hardcode localhost or production inside the app code.

## 6. Install Supabase JS

Run locally:

```bash
npm install @supabase/supabase-js
```

Commit the resulting `package.json` and `package-lock.json` changes. Do not hand-edit the lockfile.

## 7. Create Supabase client

Add:

```txt
src/lib/supabase/client.ts
```

Use `requireSupabaseConfig()` from:

```txt
src/lib/supabase/config.ts
```

Create and export the Supabase browser client.

Update:

```txt
src/lib/supabase/index.ts
```

to export the client and all new services.

Keep typing lightweight. Do not overbuild generated database types in this PR unless it is simple and compile-safe.

## 8. Add auth service

Add:

```txt
src/lib/supabase/authService.ts
```

Implement:

```ts
getCurrentSession()
onAuthStateChange(callback)
signInAsGuest()
signInWithEmail(email, password)
registerWithEmail(email, password, username)
sendPasswordReset(email)
updatePassword(password)
signOut()
```

Implementation notes:

- guest login should use Supabase anonymous sign-in
- email login should use Supabase password login
- registration should include username metadata if possible
- reset email should redirect to `?auth=reset-password`
- password update should update the current authenticated user
- sign out should clear the Supabase session
- use `getAuthRedirectConfig()` from `src/auth/authTypes.ts`

Do not hardcode production or localhost URLs in these functions.

## 9. Add profile service

Add:

```txt
src/lib/supabase/profileService.ts
```

Implement:

```ts
getProfile(userId)
ensureProfile(user, options?)
markVerificationReminderSeen(userId)
getAccountState(user)
```

The `profiles` table includes:

```txt
id
username
display_name
player_level
player_xp
credits
created_at
updated_at
account_type
email
email_verified_at
verification_grace_expires_at
verification_reminder_last_seen_at
```

Valid account types:

```txt
guest
registered_unverified
verified
```

Profile bootstrap rules:

- Anonymous user -> `account_type = guest`
- Email user without confirmed email -> `account_type = registered_unverified`
- Email user with confirmed email -> `account_type = verified`
- Set `email` from the Supabase user when available
- Set `email_verified_at` when confirmation timestamp exists
- Set `verification_grace_expires_at` to roughly seven days after profile creation when missing
- Do not overwrite existing `username` or `display_name` unnecessarily

If registration supplies a username, preserve it. If username was passed through auth metadata, `ensureProfile()` should be able to write it during profile creation.

If profile insert/update fails, surface a clear app error.

## 10. AccountState mapping

Use:

```txt
src/auth/accountState.ts
```

`getAccountState(user)` should produce:

```ts
{
  userId,
  accountType,
  email,
  emailVerifiedAt,
  verificationGraceExpiresAt,
  verificationReminderLastSeenAt,
  isAnonymous
}
```

Anonymous detection should prefer a Supabase-provided anonymous flag if available. If not available, derive conservatively from profile `account_type = guest` or missing email.

## 11. Add AuthProvider

Add:

```txt
src/auth/AuthProvider.tsx
```

It must:

- create a React auth context
- load initial session
- subscribe to auth changes
- call `ensureProfile(user)` after session load/change
- keep `user`, `account`, and `loading` state
- expose `AuthContextValue` from `src/auth/authTypes.ts`
- expose `useAuth()`
- track auth mode from query string using `parseInitialAuthMode()`
- expose `refreshAccount()`
- expose guest/login/register/reset/logout functions

Expected exposed methods:

```txt
continueAsGuest
signInWithEmail
registerWithEmail
sendPasswordReset
updatePassword
signOut
refreshAccount
```

If Supabase configuration is missing, show a controlled error rather than failing silently.

## 12. Add AuthScreen

Add:

```txt
src/screens/AuthScreen.tsx
```

It should support these modes:

```txt
guest
login
register
forgot_password
reset_password
```

Default screen should prioritize seamless onboarding.

Primary action:

```txt
Continue as Guest
```

Secondary actions:

```txt
Create Account
Login
```

Registration fields:

```txt
username
email
password
confirm password
```

Login fields:

```txt
email
password
```

Forgot password field:

```txt
email
```

Reset password fields:

```txt
new password
confirm new password
```

Basic UI requirements:

- validate required fields
- validate matching confirmation password
- show clear errors from Supabase/app logic
- disable submit buttons while loading
- do not overbuild styling
- match current CyberCache style enough to be usable

## 13. Wrap app with provider

Update:

```txt
src/main.tsx
```

Wrap `<App />` with `<AuthProvider>` while preserving existing StrictMode/root behavior.

## 14. Gate app shell

Update:

```txt
src/App.tsx
```

Behavior:

- if auth is loading, show a loading screen
- if no user/session, show `<AuthScreen />`
- if user/session exists, show the existing game shell

Do not remove existing tab navigation or screens.

Do not introduce React Router.

## 15. Verification reminder banner

Inside the authenticated game shell, show a small reminder banner when:

```ts
shouldShowVerificationReminder(account)
```

Rules:

- show only for registered unverified users
- do not show for guests
- do not show for verified users
- include copy about unlocking trading/shops/services
- include a dismiss/mark-seen button
- dismiss should call `markVerificationReminderSeen(userId)`
- refresh account state after marking seen
- after grace expiry, use the stronger copy from section 4

Do not block solo play.

## 16. Gate Market

At minimum, gate the Market feature in this PR.

Use:

```ts
canUseFeature(account, 'market')
```

If blocked for guest, show:

```txt
Create and verify an account to use player economy features.
```

If blocked for registered unverified, show:

```txt
Verify your email to unlock player economy features.
```

Verified users should see the existing market UI.

Do not wire full marketplace persistence yet.

## 17. Guest upgrade expectations

Do not fully implement guest-to-registered upgrade if it becomes complex, but do not make design choices that prevent it.

Guest progress should eventually stay attached when a guest upgrades to email/password.

If upgrade is not completed in this PR, add a clear TODO and document the next PR.

Minimum acceptable for this PR:

- guest sign-in works
- email registration works
- email login works
- profile/account state works
- logout works
- password reset flow works
- market is gated by account state

## 18. Reset and confirmation handling

When the app loads with:

```txt
?auth=reset-password
```

show reset password mode.

After successful password update:

- show success
- transition to login or game depending on session state
- do not leave the user stuck

When the app loads with:

```txt
?auth=confirmed
```

refresh account/profile state and show confirmation success if feasible.

If confirmation success UI is awkward, do not block the rest of the auth foundation. At minimum, profile/account should refresh after auth state changes.

## 19. Tests

Keep existing tests green, especially:

```txt
src/test/accountState.test.ts
```

Add pure-function tests where practical.

Preferred additions:

- `parseInitialAuthMode('?auth=reset-password')` returns `reset_password`
- default auth mode is `guest`
- account-state gates still pass
- any pure mapping helper from profile row to `AccountState` is tested

Avoid tests that require a live Supabase project or real environment values.

## 20. Do not do these things

- Do not add React Router unless absolutely necessary
- Do not remove existing game tabs/screens
- Do not rewrite the game loop
- Do not wire full inventory persistence yet
- Do not wire market persistence yet
- Do not create unrelated Supabase tables
- Do not commit private credentials
- Do not hardcode Supabase project credentials
- Do not hardcode production or localhost URLs in app logic
- Do not make verification a hard blocker for solo play
- Do not allow guest/unverified accounts into market/service/escrow/social features

## 21. Likely file changes

Expected changed/added files:

```txt
package.json
package-lock.json
src/lib/supabase/client.ts
src/lib/supabase/index.ts
src/lib/supabase/authService.ts
src/lib/supabase/profileService.ts
src/auth/AuthProvider.tsx
src/auth/accountState.ts
src/auth/authTypes.ts
src/screens/AuthScreen.tsx
src/App.tsx
src/main.tsx
src/screens/MarketScreen.tsx
src/test/accountState.test.ts
```

Optional useful test files:

```txt
src/test/authTypes.test.ts
src/test/profileMapping.test.ts
```

Only add optional files if they materially help.

## 22. Required commands before marking ready

Run:

```bash
npm test
npm run mechanics:validate
npm run mechanics:report
npm run build
npm run lint
```

If anything fails:

- fix it if introduced by this PR
- if pre-existing, document why you believe it is pre-existing
- do not mark PR ready without explaining failures

## 23. Manual QA checklist

Run locally:

```bash
npm run dev
```

Verify guest flow:

- fresh visitor sees auth screen
- Continue as Guest signs in anonymously
- guest enters game shell
- guest can access solo tabs
- guest cannot use Market
- guest can log out

Verify registration:

- create account with username, email, and password
- profile row is created
- account is `registered_unverified` unless confirmed timestamp already exists
- user enters game shell
- user sees verification reminder
- user cannot use Market

Verify login:

- existing user can log in
- profile loads
- account state loads
- game shell appears

Verify forgot/reset password:

- forgot password sends reset email
- reset link returns with `?auth=reset-password`
- reset password form appears
- password update succeeds

Verify verified behavior if practical:

- after email verification, account becomes verified
- verified account can access Market

If verified behavior cannot be tested locally, document what was tested and what still needs production validation.

## 24. Final PR state

When complete:

- update PR description with what was implemented
- mark PR #15 ready for review
- include command results in the PR description or comment
- mention known limitations, especially guest-to-registered upgrade if not completed
