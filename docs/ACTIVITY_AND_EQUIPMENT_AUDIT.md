# Activity and Equipment Audit

This audit re-centers the active-character goal: every productive action shown to the user should map to what the character is actually doing, and gear should render with a recognizable visual treatment wherever it appears.

## Fixed in this pass

### Dashboard activity truthfulness

The dashboard was still presenting the run loop as if ticks were always live. It now reads the active activity state and only presents the selected turf as live when the active activity is `roaming_loot` for that selected turf.

The dashboard primary run action now starts the selected roaming activity before navigating to Fight.

The dashboard secondary action now starts boss prep when a boss target exists before navigating to Fight.

The XP strip now shows `gated` / `activity required` when the selected roaming route is not actually active.

## Confirmed current coverage

### Activity state

The current stack now covers:

- auth hydration and reset
- roaming activity foundation
- roaming reward gating
- boss prep and boss fight transitions
- workshop craft dispatch as active character work
- profile current activity surface
- local world pulse panel derived from real state

### Equipment visuals

A shared `GearIcon` already exists and can render every gear family:

- weapon
- shield
- class mod
- relic
- ordnance

The audit found that some older screens still use local fallback visuals instead of `GearIcon`, especially Loadout and Loot rows for non-weapon gear. That is the next direct cleanup: replace per-screen non-weapon placeholders with the shared gear visual component so every equipment family has consistent rarity, type, and silhouette language.

## Remaining blatant follow-up

1. Replace non-weapon placeholders in `LoadoutScreen` with `GearIcon`.
2. Replace emoji/fallback non-weapon art in `LootScreen` with `GearIcon`.
3. Add a compact `GearSummaryRow` shared component so Loadout, Loot, Market, boss prep, and future profile showcases cannot drift apart.
4. Wire manual single-item salvage through the existing `salvaging` activity builder.
5. Move other-user profile activity lookup to a server-safe public activity projection instead of only the local signed-in activity store.

## Rule going forward

New productive UI should answer two questions from real state:

1. What activity row says the character is doing.
2. What economy/combat/inventory state changed because of that activity.

New equipment UI should use a shared visual component unless there is a deliberate reason to show a larger specialized renderer.
