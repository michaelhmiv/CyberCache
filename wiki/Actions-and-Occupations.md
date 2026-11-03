# Actions & Occupations

CyberCache is built on one scheduling law: **your hunter has one personal action at a time.** At any moment you are roaming *or* crafting *or* extracting — and boss fights and endless runs use that same slot while they resolve. Choosing an action is choosing what your time is worth, and switching settles whatever the outgoing action had earned up to that moment.

Two systems deliberately run **in parallel** with your action, because they do not use your hunter's hands:

- **Dispatch** — spare loadouts and spare vehicles you send out on missions.
- **Research** — the education track, a deliberate exception for schooling only.

Everything else on this page competes for the one slot.

Whichever action holds the slot, the stage's bottom ribbon shows its numbers: the **stats band** prints your effective stats for the action you are in — damage and gathering rates for roaming, job and mastery figures for crafting, pass survival math for extraction, boss-relative damage for a fight — each value shown effective, with the modifier gain beside it in green (or the loss in red) wherever your build moved it off base. At standby it previews the roaming set your current loadout will run, so the choice of action starts from your real numbers. The band ends in a **Loadout** button: gear changes live on the Gear tab's loadout, and changing gear mid-action follows the same rules it always has — the stage's numbers simply re-read your new build on the next tick. See [[The-Board]] for the band's full layout.

You run your action from **the stage on the Home tab** — pick an area, tap Start Roam in the standby workspace directly under the stage, and the rundown begins right there. Under the stage runs the **mode rail** — Area · Roam · Boss · Endless · Extract · Craft, one tap per stop — so every occupation on this page is a single tap from Home, and the Switch Action sheet remains as the complete list (Salvage rides the sheet, not the rail). Switching actions settles the outgoing one first. The controls live **on the stage itself**: the **Switch Action** chip floats at the stage's top-left corner in every state, and while an action runs, a **Stop** chip joins it — there is no separate controls row.

## Roaming

Roaming is the core idle activity and the default state of the game. Your hunter works one of **7 areas**, resolved in **3-second ticks**, earning credits, XP, scrap, materials, and gear drops as the ticks land. **Every area is open from the start** — there are no level locks. Higher areas pay better against tougher opposition, and the area picker tells you honestly when an area outmatches your build: it shows the duel in real numbers (their damage per tick against your HP + shield pool, your damage against their health) and warns you before you switch — but the warning never blocks you. **Roam anyway** is always there.

One earning rule keeps an open world honest: roaming pays its per-tick earnings (credits, scrap, XP, and the drop rolls) only while you have **killed something since your last death**. Die in an area too strong for you and the earnings pause until your next kill — presence alone never pays. The same rule settles your time away: if an area's basic wildlife would kill you before you could kill it, the away window settles at zero instead of paying for standing there.

While you are watching the stage in the foreground, the screen **syncs with the server on the game's 3-second tick**, so settled results show up as each tick lands; nothing syncs while the app is hidden. The moment you come back, the sync restarts immediately — a brief app switch (under 15 seconds) picks the action back up mid-stride, and the gains from those few ticks fold quietly into your feed record instead of bursting in as catch-up pop-ups. A longer absence settles on your return through the **While You Were Away** recap (see [[Progression]]).

Roaming is also where the open world can kill you — death and resurrection are covered under [[Bosses]]. Pacing, XP rates, and offline earnings (including the 24-hour absolute offline cap) are covered in [[Progression]]. Every area, pictured in its own painting with its signature loot and named elite: [[Reference-Areas]].

## Crafting

Crafting turns materials into gear frames, consumables, refining output, and vehicle supplies through timed jobs at your workshop benches — and it only progresses **while crafting is your active action**. A job left mid-progress waits for you; it does not finish in the background while you roam.

Crafting pays player XP at **0.775× roaming's rate** — pegged to what an hour of roaming at your strongest area would pay, priced per completed unit. That is deliberately a little below roaming: a dedicated crafter trades a slice of XP rate for the value of what they make, and the good consumables in this game come from crafters, not shops.

The full system — benches, recipes, quality, mastery — lives on the [[Crafting]] page.

Salvaging from the action sheet settles instantly through the same
verified recycle path as the Gear tab, and the feed names exactly
what the server paid: the Scrap, any legendary cores from a
Legendary, and the occasional King of Scrap bonus material — never
a broader yield than the one that landed.

## Extraction

Extraction is the gathering occupation: dedicated material work at a site in any area, and the supply lane the crafting economy eats from.

- Work is priced in **10-minute passes** at one site and method. Passes run back-to-back while extraction is your active action; accrued time carries across pauses, and changing site or method takes effect at the next pass boundary.
- A pass yields **materials and essences only** — no gear, no credits, no scrap, no legendaries. At full rate a pass performs draws at **192 draws per hour**, twice roaming's byproduct drip, because gathering is the whole job.
- Yield scales with a **gear factor**: how safely your current loadout can work that site, priced from your real HP pool against the damage the site would deal over a pass. Under-geared gathering is slower, never impossible — the factor has a floor of 0.4.
- Extraction pays player XP at **0.75× roaming's rate** (the same peg machinery as crafting), and each completed pass grants **20 XP to the `gathering.extraction` mastery track**. Mastery widens yield by 0.5% per level past 1, up to +25%.
- **Deep Delve** is the second method: it needs extraction mastery **level 5 or higher** to select, and at settlement the pass must price at a gear factor of **0.80 or better** — then it pays at **1.5× the draw rate** (288 draws per hour). A deep pass that settles below the gear gate pays as a normal surface pass.
- Extraction requires a **signed-in account** — guests are refused at the start gate, because extraction feeds the player economy — and you cannot start while a death record stands. Crafted goods need materials; materials, at scale, come from here and from [[The Market]].

## Boss fights and endless runs

Discrete fights use the slot differently: a [[Bosses|boss attempt]] takes the slot for its resolution, and an [[Endless Mode]] run **holds the slot for the whole run** — starting a run settles your current action, and the Chamber stays your action until you bank, die, or abandon.

## Dispatch

Dispatch sends what you are *not* using: a foot contract commits a spare, unequipped loadout; a courier contract commits a spare, unequipped vehicle. Committed gear is locked for the duration, and the missions run on their own clock — never touching your personal action, never paused by it, and never truncated by the offline cap. Foot and courier contracts share **one queue, 2 slots**, at durations of **2, 8, or 24 hours** with terms fixed at departure.

The full system — the daily board, foot payout and strength rules, the courier tiers and their vehicle-class gates, fuel and breakdown arithmetic, pro-rata settlement — lives on the [[Dispatch]] page. See [[Vehicles and the Garage]] for the vehicles themselves.

## Research

Research is schooling: enroll in one course at a time and it progresses on **pure wall-clock time** — offline, while you roam, while you craft, even while you are dead. Nothing caps or pauses it, because it pays out nothing farmable. The catalog is **12 courses in 4 faculties**, totalling **888 hours and 310,000 credits** taken sequentially; completion grants no player XP, only scholarship mastery and the course's permanent unlock.

Every course — duration, fee, prerequisites, and exactly what it unlocks — is catalogued on the [[Research]] page. No course gates on your hunter level: the prerequisite chain, the wall-clock duration, and the fee are the whole price (Fabrication's upper courses also ask for the workshop benches they teach on).

## Contracts board

Separate from Dispatch (the names are close; the systems are not), the **Contracts Board** posts rotating work orders — kills, boss victories, crafts, sales, extractions, and more — that progress from what you actually do while you play. Contracts are never an action and never occupy the slot: a **daily set of 3** (the same for every player in your level band) and a **weekly set of 5** (seeded per player), each paying credits and cache-key fragments on claim — and never XP, gear, or legendary cores.

The full board — bands, every contract type and its targets, reward and reroll rules — lives on the [[Contracts]] page.

---

_Source of truth: `src/content/activityModuleDefs.ts`, `src/content/crafting.ts`, `src/content/extraction.ts`, `src/content/research.ts`, `src/content/dispatch.ts`, `src/content/contracts.ts`, `src/content/gameContent.ts`, `src/constants/roamingAreas.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
