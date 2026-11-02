# Reference

This page is the wiki's data annex: the place where CyberCache's
complete numbers will live in full, as tables.

## How these tables will work

The tables here are **generated, not written**. A script renders them
directly from the game's own content definitions — the same constants
the live game runs on — so a table cannot quietly drift from the game
the way a hand-copied list always eventually does. A freshness check in
the game's build pipeline fails if a published table ever falls behind
the definitions it was rendered from. If a number is in a Reference
table, it is the number the game shipped.

That generator is **Wiki Phase 3** work and has not landed yet. This
page is the frame it will fill.

## What will live here

- The full weapon matrix: 6 types × 6 manufacturers × 6 elements ×
  5 rarities, with the affix pools each gear kind rolls from.
- All 25 [[Legendary Effects]] — name, exact trigger text, source,
  minimum boss tier, and implementation status.
- The consumables catalog: effects, quality ranges, and vendor status.
- Every [[Crafting]] recipe with its inputs, times, and gates.
- The 13-boss roster with stats and gates — see also [[Bosses]].
- The 7 roaming areas.
- The [[Vehicles and the Garage|vehicle classes]] with yields, unlock
  levels, fuel burn, and wear rates.
- The [[Slots]] paytable with its derived return rate.
- Skill-tree node lists, Cache Rank tracks, and the 81
  [[Collections]] entries.

## In the meantime

Until the generators land, the per-system pages carry the headline
numbers — each verified against the game's code, each with its source
of truth in the footer. Start from [[Gear]], [[Legendary Effects]],
[[Crafting]], [[Vehicles and the Garage]], and [[Collections]] for
this cluster, and use the wiki's page list for combat, progression,
and economy numbers. When a per-system page and a future Reference
table ever disagree, the table wins: it is rendered from the game
itself.

---

_Source of truth: `src/content/`, `src/constants/`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
