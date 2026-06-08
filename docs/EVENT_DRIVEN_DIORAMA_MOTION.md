# Event-Driven Diorama Motion

The Live Turf diorama must not run combat motion on a decorative loop.

## Rule

Default state is static. The runner, enemy, projectile, scrap pop, and weapon nudge only move when a real feed event is present.

Feed events are generated from actual state changes such as XP, credits, scrap, cache fragments, level changes, or gear gains.

## Why

The diorama is supposed to show what the character is actually doing. A constant repeated motion implies combat output even when no reward or state transition occurred.

## Current implementation

`LiveTurfDiorama` now keys one-shot animation pulses to `feedEvents[0].id`.

When no event is present:

- runner is posed
- enemy is posed
- projectile tape is hidden
- scrap pop is hidden
- weapon renderer is static

When an event arrives:

- runner and enemy perform a brief one-shot response
- projectile tape appears for combat-like events
- scrap pop appears for loot/cache/cash/level-like events
- weapon nudges once

Reduced-motion users still get static poses.
