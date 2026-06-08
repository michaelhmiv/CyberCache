# Dashboard HUD Redesign Notes

The dashboard should operate like a game console rather than a stack of neutral status cards.

Implementation goals:

- Keep core resources visible in compact HUD chips.
- Treat level progress as a primary mechanic with a dedicated progress rail.
- Make XP, level, loot, resource, and cache changes visible through short-lived reward telemetry.
- Anchor the page around the active route or boss target so the player sees what the idle loop is working on.
- Use angled panels, gauges, command buttons, and route selector chips to avoid a generic rectangular-card layout.

The dashboard remains a command surface only. It visualizes existing store state and routes players to Fight, Inventory, Cache, Mastery, Workshop, and Market without duplicating reward-generation logic.
