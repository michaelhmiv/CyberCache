# Active Activity State

CyberCache activity must be grounded in authoritative state. The game should not show a character looting, fighting, crafting, or servicing gear unless that activity exists as real persisted player state.

## Rule

Each player has exactly one primary active activity row in `public.active_actions`.

A player can still browse inventory, profile, market, or settings while an activity is active. Those are UI views, not world activities. Productive world activities are mutually exclusive.

## Activity kinds

Current first-class kinds:

- `idle_standby`
- `roaming_loot`
- `boss_prep`
- `boss_fight`
- `crafting`
- `salvaging`
- `workshop_service`
- `market_listing`

`none` remains accepted for compatibility with the original table default, but new client code should prefer `idle_standby`.

## Server ownership

Direct client writes to `active_actions` stay disallowed. Activity transitions go through RPCs:

- `cc_set_active_action`
- `cc_clear_active_action`
- `cc_active_action_heartbeat`

The RPC layer owns started timestamps, heartbeat timestamps, and one-row-per-user upserts.

## Public profile readiness

The activity row includes both private and public payloads:

- `activity_payload`: detailed internal context for the player/app.
- `public_payload`: sanitized fields safe for future profile/world-pulse views.

Future public user profiles should read only profile-safe fields. They should never expose private inventory internals, exact reward timers, or unfiltered runtime snapshots.

## Current client integration

The client now has:

- `src/types/activity.ts`
- `src/lib/supabase/activityService.ts`
- `src/store/slices/activitySlice.ts`
- `src/lib/activity/activityBuilders.ts`

`AuthProvider` hydrates the active activity row after profile/runtime state is restored. This PR is the persistence and client-state foundation; the next PR should enforce single-activity UX transitions across Fight, Boss, Workshop, and Salvage screens.
