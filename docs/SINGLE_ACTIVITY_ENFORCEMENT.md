# Single Activity Enforcement

This pass starts converting CyberCache from screen-mounted reward loops into activity-backed execution.

## Enforced in this PR

`FightScreen` no longer produces roaming rewards merely because the screen is mounted.

Roaming ticks now require all of the following:

1. The active activity kind is `roaming_loot`.
2. The active activity target is a `roaming_area`.
3. The active activity target id matches the selected roaming turf.
4. The activity store is not pending a server transition.

If those conditions are not true, the roaming interval does not run, and manual field sweep is disabled.

## Activity transitions added

The Fight screen can now:

- Start a server-backed `roaming_loot` activity for the selected turf.
- Clear the active activity back to standby.
- Start `boss_prep` before opening the boss prep modal.
- Send periodic heartbeat updates while a roaming route is active.

## Remaining enforcement work

This PR is the first enforcement pass, not the complete world-state pass. The next screens to gate are:

- Boss fight resolution.
- Workshop/crafting acceleration or active bench work.
- Salvage/recycle actions if they become an active character task.
- Dashboard start-run shortcuts.
- Public profile activity rendering.

## Non-negotiable rule

No visible productive activity should imply progress unless it is backed by the active activity state and by the actual reward/progress systems that update player state.
