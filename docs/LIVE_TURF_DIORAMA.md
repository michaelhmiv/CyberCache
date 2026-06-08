# Live Turf Diorama

The dashboard hero panel is now treated as a non-authoritative idle visualization layer: it shows what the player is already doing in the current CyberCache loop without adding new controls, rewards, or combat resolution.

## Product intent

Live Turf should make the idle loop visible. The player should be able to glance at the dashboard and understand:

1. Which turf or marked boss is active.
2. Which weapon is being represented.
3. What enemy family is being engaged.
4. Which element/effect language is active.
5. Whether recent idle rewards are flowing.

This is not a playable side-scroller. It is a deterministic combat diorama driven by existing state.

## Current implementation

- `src/components/dashboard/LiveTurfDiorama.tsx` renders the dashboard scene.
- `src/constants/liveTurfVisuals.ts` defines the turf color, prop, enemy, and projectile registry.
- `src/components/weapon/WeaponIllustration.tsx` is reused so the dashboard shows the same deterministic SVG weapon language as inventory and item cards.
- `DashboardScreen` passes current turf, marked boss, equipped weapon, player level, equipped gear count, cache keys, and recent gain feed events into the visualizer.

## Source-of-truth rule

The diorama must never grant or roll rewards. It can show ambient movement and attacks, but actual gains must continue to come from existing stores/backend synchronization. The current implementation only reads state and callback navigation props.

## SVG-first asset rule

For now, Live Turf is deliberately SVG/React-based. That keeps the first pass aligned with the app-wide vector asset sweep and avoids adding a heavier rendering engine before the visual grammar is proven.

Future PixiJS/canvas migration should only happen after the SVG scene has answered these questions:

1. Are the character, enemy, weapon, terrain, and effect layers readable on mobile?
2. Does the dashboard feel more alive without overwhelming the action board?
3. Are weapon rarity, element, turf identity, and enemy family legible at a glance?
4. Do we need more than lightweight SVG animation for performance?

## Future expansion path

1. Add a proper character/gear SVG part registry.
2. Add enemy-family SVG registries instead of one generic enemy body.
3. Convert scene props into reusable named asset components.
4. Add event-tape types for `scrap_found`, `enemy_spawned`, `enemy_hit`, `enemy_killed`, `loot_dropped`, and `weapon_proc_triggered`.
5. Keep backend/store state authoritative; event tape should dramatize already-known state, not calculate outcomes.
6. If the scene grows beyond SVG performance limits, migrate the renderer to PixiJS while preserving the same visual registry and deterministic asset recipe structure.

## Design constraint

No random one-off art assets. New visual pieces should enter through a registry with stable names, color tokens, and intended usage. The goal is a consistent vector-first CyberCache art system, not a pile of unrelated generated images.
