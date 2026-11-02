# Gear

Your hunter wears **7 gear slots plus a vehicle slot**, and every rendered item on your hunter is the actual item instance — never a generic stand-in. Gear rolls across **5 rarities** (Common, Uncommon, Rare, Epic, Legendary) that set its affix count — 0–1 on Common, 1 on Uncommon, 2 on Rare, 3 on Epic, 4–5 on Legendary — drawn from the affix pool, on top of the weapon frame itself (type × manufacturer × element; see [[Reference]] for the full matrix).

There is one gear home: loadout, grid, items, and workshop tabs live together on the Gear screen, including the inspect sheet, equip/unequip, and salvage. The **reforge bench** rerolls an item for scrap priced at 3× its own salvage value; rerolling a Legendary additionally burns 2 legendary cores. What legendary gear can carry beyond affixes is [[Legendary Effects|its own subject]].

_Phase 1 stub — the full page (tables, worked examples, screenshots) lands in Wiki Phase 2._

---

_Source of truth: `src/constants/weaponTypes.ts`, `src/constants/manufacturers.ts`, `src/constants/elements.ts`, `src/constants/rarities.ts`, `src/content/reforge.ts`, `src/screens/ChestScreen.tsx`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
