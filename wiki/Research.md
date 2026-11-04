# Research

Research is schooling: enroll in a course and it completes on **pure wall-clock time** while everything else in the game goes on without it. It is the one deliberate exception to the [[Actions and Occupations|one-action law]] — an education track that runs **in parallel** with your personal action, because it uses your calendar, not your hunter's hands. Roam, craft, fight bosses, die, resurrect — none of it pauses, speeds, or even touches an enrollment.

That is also why nothing caps it. Research pays out **nothing farmable** — no credits, no materials, no drops — so there is no offline cap and no accrual window. A course enrolled for 7 days completes 7 days later, whether you played every day or never opened the app.

## How enrollment works

- **One course at a time.** The slot scarcity is the calendar. A second course waits until the first completes or is cancelled.
- **Fees are charged at enrollment and destroyed.** Research is the game's largest structured credit sink: the full catalog costs **310,000 credits**, priced to be steep but reachable.
- **Your fee and duration are frozen at enrollment.** The terms on the card when you tap Enroll are the terms you get, whatever changes later.
- **Completion pays no player XP.** It pays mastery XP to the `research.scholarship` track instead — **10 XP per course hour** (60 for a tier-1 course, 480 for tier 2, 1,680 for tier 3; **8,880 XP** for the whole catalog) — and, more importantly, the course's **unlock**: a permanent passive, a recipe family, or a system bonus that real engines read from that moment on.
- **Cancelling forfeits everything.** Progress is lost and the fee is **not refunded**; re-enrolling restarts from zero at the full price. Enroll when you mean it.
- **Tap any course** to open its full brief before you commit: its gates, the fee and duration as they stand right now, what it unlocks, and — when a gate is unmet — exactly what is still needed.

## The catalog

**12 courses in 4 faculties, three tiers each**, chained by prerequisites within a faculty. Every faculty runs the same shape — a 6-hour Foundation, a 2-day Practice, a 7-day Certification — and the same fees (2,500 / 15,000 / 60,000 credits, **77,500 per faculty**). Taken back-to-back, the whole catalog is **888 hours (37 days)** of wall-clock.

### Fabrication — home: the Workshop

Production study for crafters: quality, batch work, and the temper roll.

| Course | Tier | Duration | Fee | Requires | Unlocks |
|---|---|---|---|---|---|
| Shop Fundamentals | 1 | 6 h | 2,500 | — | Craft quality shift **+2** on every completed craft unit (inside the shared −10…+20 clamp) |
| Production Systems | 2 | 48 h | 15,000 | Shop Fundamentals | The three **batch recipes** — Shield Cell ×3, Patch Kit ×3, Ordnance Charge ×3 — at 2.5× inputs and 2.2× unit time per 3 units: fewer materials and less time per unit than three singles (see [[Crafting]]) |
| Master Fabricator Certification | 3 | 168 h | 60,000 | Production Systems | Crafted gear **temper chance +0.03** (inside the 0.30 cap) and **+1 generation draw** on every crafted gear frame |

### Field Mechanics — home: the bay + the road

Wrench credentials: faster work, gentler miles, a master's XP rate.

| Course | Tier | Duration | Fee | Requires | Unlocks |
|---|---|---|---|---|---|
| Wrench Basics | 1 | 6 h | 2,500 | — | **Repair work rate ×1.05** on board jobs you accept and your own self-repair (see [[Repair Board]]) |
| Powertrain Systems | 2 | 48 h | 15,000 | Wrench Basics | Your vehicles' **condition decay −10%** — stacks multiplicatively with the Fixer Fleet Engineer term (see [[Vehicles and the Garage]]) |
| Master Mechanic Certification | 3 | 168 h | 60,000 | Powertrain Systems | Repair work you perform pays **+1 player XP per condition point** restored |

### Logistics & Markets — home: the economy

Supply-chain theory that pays in buyback, offline hours, and thinner fees.

| Course | Tier | Duration | Fee | Requires | Unlocks |
|---|---|---|---|---|---|
| Street Economics | 1 | 6 h | 2,500 | — | NPC **vendor buyback rate +0.02** on everything you sell (under the 0.90 ceiling — see [[Vendor]]), and **offline earnings cap +2 hours** |
| Supply Chains | 2 | 48 h | 15,000 | Street Economics | **Offline earnings cap +4 hours** (the 24-hour absolute ceiling still binds — see [[Progression]]) |
| Syndicate Ledger | 3 | 168 h | 60,000 | Supply Chains | **Market fee reduction +0.05** on all your sales (see [[The Market]]), and **offline earnings cap +4 hours** |

### Xenotech — home: theory

Combat theory: small, permanent, engine-read passives.

| Course | Tier | Duration | Fee | Requires | Unlocks |
|---|---|---|---|---|---|
| Ballistics Theory | 1 | 6 h | 2,500 | — | **Weapon damage +1%** everywhere damage is priced |
| Shield Dynamics | 2 | 48 h | 15,000 | Ballistics Theory | **Shield capacity +2%** in the survival composite |
| Void Theory Certification | 3 | 168 h | 60,000 | Shield Dynamics | **Boss dedicated-drop chance +0.01** on every victory roll, on top of the base 0.10 (see [[Bosses]]) |

## Reading the catalog

The faculties reward the playstyle they are named for. Fabrication is the crafter's ladder — its tier 2 is the only door to batch production. No faculty gates on your hunter level — and, since the Workshop's benches collapsed into one, none gates on a bench either: every course asks only for its prerequisite in the chain, its fee, and its time. Every unlock is permanent and small on purpose: Research is the slow way to buy what skill points buy faster, and its real price is never the fee — it is the weeks the single enrollment slot spends getting there.

---

_Source of truth: `src/content/research.ts`, `src/server/routes/research.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
