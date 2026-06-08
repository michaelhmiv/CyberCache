# Workshop Activity Enforcement

Workshop craft dispatch now participates in the active activity model while preserving passive bench queues.

## Enforced in this PR

Starting a craft job now transitions through `crafting` before materials are deducted and a bench queue is created. After the queue is dispatched, the activity is cleared back to standby.

This makes the character action real without turning every bench timer into a blocking character activity.

## Passive queue rule

Bench queues are passive machine work. They may continue while the character roams, prepares for a boss, or views another screen.

The active character action is the dispatch, not the entire timer duration.

## Salvage preparation

A `salvaging` activity builder is added so item scrapping can be wired through the same activity path. The larger inventory/loot modal should be a follow-up if we want every scrap action to briefly claim character activity before materials are awarded.

## Non-negotiable rule

No active character work at the workshop should be represented as progress unless it has an activity row and the actual economy mutation is applied through the existing material, essence, consumable, and queue systems.
