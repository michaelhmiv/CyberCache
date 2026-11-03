# Reference — Legendary Effects

Every legendary effect in the game, with the exact text the game
prints for it and an honest account of how it is implemented. See
[[Legendary Effects]] for how effects are hunted and why the status
column matters.

**How to read the Status column.** *Fully live* means the mechanic
does exactly what the text says in the real game systems. *Simulated
proxy* means the described mechanic depends on a system the boss
engine doesn't have (per-hit chains, charge refunds, DoT stacks), so
the boss simulator approximates its value as a flat combat bonus —
the weapon is genuinely stronger in boss fights, just by the
approximation. *Partial* means part of the text is wired exactly and
part has no counterpart yet.

**A note on sources.** The effect definitions mark eight effects as
eligible to roll on cache-forged weapons. In the shipped game, no
forging path actually assigns an effect — cache-forged weapons never
carry one, and boss drops are the only live source. The table prints
the eligibility data as it stands in the definitions; this note
prints the shipped behavior.

**A note on weapon types.** Every effect's bespoke art depicts one
specific weapon type, and a legendary carrying the effect always
drops as that type — the **Weapon type** column below is the frame
each effect lives on. Manufacturer, element, parts, and affixes
still roll freely. Legendaries already in inventories keep the type
they originally rolled; the rule governs new drops.

**The plates.** The **Plate** column shows each weapon's bespoke
art, generated from the game's own sprites by the wiki generator —
the same art, resolved the same way the game resolves it, so a plate
can never picture the wrong gun. The table closes with Emberfall,
the one named legendary that has art but no effect; its row says so
rather than inventing stats for it.

<!-- GENERATED from src/constants/legendaryEffects.ts, src/lib/legendaryEffects.ts, src/lib/pixel/manifest.ts, src/test/legendaryParityTable.ts — do not edit by hand -->
<!-- wiki-gen:legendary-effects -->
| Plate | Effect | What it does | Weapon type | Source | Min boss tier | Status |
| --- | --- | --- | --- | --- | --- | --- |
| <img src="images/weapons/legendary/debt-collector.png" alt="Debt Collector" width="240"> | **Debt Collector** | Each failed attempt vs. the same boss grants +3% win chance next time, stacking to a cap of +30%. | Pistol | Boss Drop | 1 | Fully live |
| <img src="images/weapons/legendary/warranty-void.png" alt="Warranty Void" width="240"> | **Warranty Void** | Each failed boss attempt permanently increases this weapon's base damage by +2%, up to +20%. | SMG | Boss Drop | 1 | Fully live |
| <img src="images/weapons/legendary/ricochet-gospel.png" alt="Ricochet Gospel" width="240"> | **Ricochet Gospel** | Crits bounce to an additional target. Against a single boss, the bounce returns 40% damage. | Sniper | Boss Drop | 1 | Fully live |
| <img src="images/weapons/legendary/bad-decision.png" alt="Bad Decision" width="240"> | **Bad Decision** | Win chance estimate is hidden, but victory reward multiplier is +25%. | Shotgun | Boss Drop | 1 | Fully live |
| <img src="images/weapons/legendary/glass-sun.png" alt="Glass Sun" width="240"> | **Glass Sun** | +50% Fire damage, but -30% Shield effectiveness. | SMG | Boss Drop | 1 | Fully live |
| <img src="images/weapons/legendary/the-accountant.png" alt="The Accountant" width="240"> | **The Accountant** | Every 100 enemies defeated increases the rarity roll tier of your next drop by +1 stage. | Sniper | Boss Drop | 1 | Simulated proxy |
| <img src="images/weapons/legendary/armor-eater.png" alt="Armor Eater" width="240"> | **Armor Eater** | Corrosive procs reduce boss repair/healing by 50% and grant +20% armor break contribution. | Sniper | Boss Drop | 1 | Partial |
| <img src="images/weapons/legendary/thunder-receipt.png" alt="Thunder Receipt" width="240"> | **Thunder Receipt** | A Shock proc that breaks a shield refunds one Ordnance charge or 10% Action Skill charge. | Sniper | Boss Drop | 1 | Simulated proxy |
| <img src="images/weapons/legendary/second-opinion.png" alt="Second Opinion" width="240"> | **Second Opinion** | On boss victory, the loot roll happens twice. You keep the stronger weapon; the other is auto-scrapped. | Pistol | Boss Drop | 4 | Fully live |
| <img src="images/weapons/legendary/salvage-rights.png" alt="Salvage Rights" width="240"> | **Salvage Rights** | Kills with this weapon yield +50% scrap. | Launcher | Boss Drop | 4 | Fully live |
| <img src="images/weapons/legendary/overclocked.png" alt="Overclocked" width="240"> | **Overclocked** | Attack speed ramps +5% every 5 seconds during a fight, but crit chance drops -2% per ramp. | SMG | Boss Drop | 4 | Simulated proxy |
| <img src="images/weapons/legendary/borrowed-time.png" alt="Borrowed Time" width="240"> | **Borrowed Time** | Once per boss attempt, if you would fail the Survival Check, auto-consume 1 Med Kit and pass instead. | Pistol | Boss Drop | 4 | Simulated proxy |
| <img src="images/weapons/legendary/kickback.png" alt="Kickback" width="240"> | **Kickback** | Every 7th hit deals 300% bonus damage as a burst spike. | Shotgun | Boss Drop | 4 | Fully live |
| <img src="images/weapons/legendary/vampiric-ledger.png" alt="Vampiric Ledger" width="240"> | **Vampiric Ledger** | Converts 5% of damage dealt into bonus credits on victory. | SMG | Boss Drop | 4 | Simulated proxy |
| <img src="images/weapons/legendary/echo-chamber.png" alt="Echo Chamber" width="240"> | **Echo Chamber** | Status effects applied by this weapon have a 30% chance to re-apply themselves once. | Launcher | Boss Drop | 4 | Fully live |
| <img src="images/weapons/legendary/insurance-fraud.png" alt="Insurance Fraud" width="240"> | **Insurance Fraud** | If equipped during a defeat, 50% of consumed consumables are refunded. | Pistol | Boss Drop | 4 | Fully live |
| <img src="images/weapons/legendary/market-crash.png" alt="Market Crash" width="240"> | **Market Crash** | This weapon's scrap value is 4x normal when recycled. | SMG | Boss Drop | 4 | Fully live |
| <img src="images/weapons/legendary/stable-loop.png" alt="Stable Loop" width="240"> | **Stable Loop** | Action Skill charges 25% faster while this is your Primary weapon. | Beam | Boss Drop + Cache-Forged | 4 | Simulated proxy |
| <img src="images/weapons/legendary/phase-shifter.png" alt="Phase Shifter" width="240"> | **Phase Shifter** | First hit against each boss shield/armor phase ignores 40% of that layer. | Beam | Boss Drop + Cache-Forged | 4 | Simulated proxy |
| <img src="images/weapons/legendary/hot-swapper.png" alt="Hot Swapper" width="240"> | **Hot Swapper** | Your Secondary weapon contributes 60% of its passive stats instead of the normal reduced rate. | SMG | Boss Drop + Cache-Forged | 4 | Fully live |
| <img src="images/weapons/legendary/chain-lightning.png" alt="Chain Lightning" width="240"> | **Chain Lightning** | Shock procs chain to up to 2 additional nearby targets (or back to the boss for reduced damage). | Beam | Boss Drop + Cache-Forged | 7 | Simulated proxy |
| <img src="images/weapons/legendary/molten-core.png" alt="Molten Core" width="240"> | **Molten Core** | Fire DoT stacks up to 5 times. Each stack reduces boss healing by an additional 10%. | Sniper | Boss Drop + Cache-Forged | 7 | Simulated proxy |
| <img src="images/weapons/legendary/cryo-stasis.png" alt="Cryo Stasis" width="240"> | **Cryo Stasis** | Cryo procs have a 20% chance to trigger a mini-stagger, interrupting the boss for +5% DPS window. | Beam | Boss Drop + Cache-Forged | 7 | Simulated proxy |
| <img src="images/weapons/legendary/void-bargain.png" alt="Void Bargain" width="240"> | **Void Bargain** | +40% Void damage, but every hit has a 5% chance to deal 10% damage to your own shield. | Pistol | Boss Drop + Cache-Forged | 7 | Partial |
| <img src="images/weapons/legendary/jackpot.png" alt="Jackpot" width="240"> | **Jackpot** | Every 150th enemy killed by this weapon drops a Cache Key fragment. | SMG | Boss Drop + Cache-Forged | 7 | Fully live |
| <img src="images/weapons/legendary/emberfall.png" alt="Emberfall" width="240"> | **Emberfall** | Name-keyed proof art — no legendary effect carries this sprite. A weapon literally named Emberfall renders this art; it never rolls from an effect. | Sniper (as depicted) | — | — | Name-keyed art only |
<!-- /wiki-gen:legendary-effects -->

---

_Source of truth: `src/constants/legendaryEffects.ts`, `src/lib/legendaryEffects.ts` — rendered by `scripts/wiki-gen/`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
