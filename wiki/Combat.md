# Combat

Combat in CyberCache is **server-resolved**: the Chef runs every fight, roaming tick, and boss attempt from your real server-side loadout — the client only animates the outcome. Your damage flows through one DPS chain (weapon, elemental matchup, affixes, skill tree, action skill), and your survival flows through one HP formula combining level and shield capacity.

**Shields** come in five behaviors — Standard, Nova, Absorb, Amp, and Turtle — each changing how incoming damage is handled; a shield's behavior can later be recalibrated through [[Shield-Tech]]. Each skill tree has a signature **action skill** (Deadeye Salvo, Demolition saturation, loot-surge, and Overclock) usable in boss fights, endless runs, and Fixer workshop contexts.

How a specific fight reads before you commit — stats, mechanics, arena — is [[Bosses|boss intel]]; what happens when you die is covered there too.

_Phase 1 stub — the full page (tables, worked examples, screenshots) lands in Wiki Phase 2._

---

_Source of truth: `src/lib/stats/dpsChain.ts`, `src/lib/combat/shieldBehaviors.ts`, `src/content/actionSkills.ts`, `src/server/gameplay/serverLoadout.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
