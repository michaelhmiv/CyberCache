# Event-Driven Diorama Motion

The Live Turf diorama must not run motion on a decorative loop.

## Rule

Default state is static. Motion only fires when a real feed event is present.

Feed events are generated from actual state changes such as XP, credits, scrap, cache fragments, level changes, or gear gains.

## Action-specific appearance rule

The diorama must also change its static appearance based on the actual active activity kind. A player should be able to glance at the board and understand what the character is doing before any event fires.

Current action modes:

- `idle_standby` / `none`: camp standby pose, no target motion.
- `roaming_loot`: roaming/target tableau with target silhouette.
- `boss_prep`: planning board and counter-check pose, no attack pose.
- `boss_fight`: target tableau with event-gated hit motion.
- `crafting`: workshop bench tableau.
- `salvaging`: scrap breakdown tableau.
- `workshop_service`: machine service tableau.
- `market_listing`: trade kiosk tableau.

## Current implementation

`DashboardScreen` passes the active activity kind, label, and target into `LiveTurfDiorama`.

`LiveTurfDiorama` maps each activity kind to a specific static mode. Runner arms, central set piece, target visibility, labels, and motion rules change by mode.

When no event is present:

- runner is posed for the current activity
- combat target only appears for roaming and boss fight modes
- projectile tape is hidden
- reward/scrap pop is hidden except for the static salvage tableau
- weapon renderer is static

When an event arrives:

- runner performs a brief one-shot response
- target responds only in target modes
- projectile tape appears only for roaming or boss-fight output
- reward/scrap pop appears for loot/cache/cash/level-like events
- weapon nudges once

Reduced-motion users still get static poses.
