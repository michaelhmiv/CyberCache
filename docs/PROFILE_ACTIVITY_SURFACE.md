# Profile Activity Surface

The profile now renders the current active activity from the activity store.

## What is shown

The panel shows only sanitized activity fields:

- activity label
- target label
- scene key

The profile does not display reward timers, internal runtime snapshots, or inventory internals.

## Why this matters

This is the first visible surface for the persistent-world idea. A profile can now honestly show what the character is doing because the panel is backed by the same active activity state used by roaming, boss prep, boss fights, and workshop dispatch.

## Future expansion

The next step is a richer public profile lookup for other users. That should read a server-safe projection of `active_actions`, not raw runtime state.
