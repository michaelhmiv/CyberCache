# World Pulse Feed

The first World Pulse surface is a read-only profile panel derived from real current state.

## What it uses

The feed derives entries from:

- current active activity
- player level and XP
- defeated boss IDs
- strongest weapon currently in inventory
- passive workshop queue state

## What it does not do

The feed does not mint rewards, roll loot, simulate events, or invent social activity.

It is a presentation layer over state the app already owns.

## Future server path

A multiplayer world pulse should eventually read from a server event ledger or server-safe projection of verified actions. That future feed should be based on real boss defeats, cache opens, legendary drops, craft completions, and activity transitions.
