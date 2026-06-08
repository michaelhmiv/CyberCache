# CyberCache Auth and Onboarding Plan

CyberCache should support seamless onboarding without exposing market or social systems to unverified accounts.

## Account States

### Guest

Guest users can enter the game quickly and play solo. They may persist solo progress if backed by Supabase anonymous sign-in.

Allowed:

- fight solo
- earn solo progress
- receive personal item instances
- explore loadout and loot systems
- upgrade to a registered account later

Blocked:

- market listings
- trading
- service jobs
- escrow
- player-to-player interactions
- social/leaderboard-impacting features

### Registered Unverified

Registered but unverified users have an email/password account but have not confirmed their email.

Allowed:

- solo play
- persisted profile and inventory
- daily verification reminder on dashboard

Blocked:

- market listings
- trading
- service jobs
- escrow
- player-to-player interactions
- social/leaderboard-impacting features

### Verified

Verified users have confirmed email ownership.

Allowed:

- full solo play
- market systems
- service jobs
- escrow
- future social systems
- future leaderboard-impacting systems

## Verification Grace

CyberCache uses a soft seven-day verification reminder window.

The app should not fully block solo play when the grace date passes. Instead:

- before expiration, show a light reminder to verify email to unlock player economy features
- after expiration, show stronger daily reminders
- keep market/service/social features locked until verified

## Redirects

Production public URL:

```txt
https://cybercache-production.up.railway.app
```

Supabase Auth URL settings should allow:

```txt
https://cybercache-production.up.railway.app/**
http://localhost:5173/**
```

The Railway internal port does not matter for Supabase redirects. Supabase should use the externally reachable public URL.

Because the app is currently a Vite single-page app without a router, auth redirects should use query-string state initially:

```txt
https://cybercache-production.up.railway.app/?auth=confirmed
https://cybercache-production.up.railway.app/?auth=reset-password
http://localhost:5173/?auth=confirmed
http://localhost:5173/?auth=reset-password
```

## Required Supabase Auth Settings

Enable:

- Email provider
- Anonymous sign-ins

Recommended during early testing:

- allow users to sign in immediately
- rely on CyberCache account-state gates for market/service/social restrictions

## Implementation PR Sequence

1. Account-state schema and RLS gates.
2. Install Supabase JS client and create auth service.
3. Add AuthProvider and guest/login/register UI.
4. Add profile bootstrap and upgrade flow.
5. Add dashboard verification reminders.
6. Persist first solo runtime state to Supabase.
7. Wire market/service/social gates to verified-account checks.
