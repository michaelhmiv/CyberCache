# Getting Started

You can start playing **instantly as a guest** — no account, no sign-in wall, no password. Tap **Continue as Guest** and your hunter exists from that moment. A guest is a real account, not a demo: your progress is saved by the game server and kept on your device, so it survives closing and reopening the app.

[[images/ui/home-top.png]]

*The Board as a brand-new guest sees it: your resources across the top, your hunter on the stage, and the Roam workspace one tap from starting.*

## Signing in

When you're ready, sign in with **Google** from the sign-in screen. There is no password form anywhere in the app, and sign-in is never through Play Games Services.

Signing in **upgrades your guest account in place**: you keep the same account, the same hunter, and every credit, item, and streak day you earned as a guest. Nothing restarts and nothing is transferred — the account simply gains a Google identity, which also lets you pick the hunter up on another device. Everything account-shaped — including your [[Skins-and-Cosmetics|wardrobe]] of skin parts and the look you have equipped — belongs to the account and loads fresh for whoever is signed in.

## The starter bundle

Every new hunter receives the **starter bundle** automatically, once, the first time your profile loads:

| You receive | Amount |
| --- | --- |
| Credits | 5,000 |
| Scrap | 500 |
| Cache keys | 3 |
| Vehicle | Scrap Bike |

The Scrap Bike is a level 1 Common vehicle, and it is auto-equipped if your vehicle slot is empty. It is yours permanently — the bundle can only ever be granted once per account.

Your hunter's own page is the **Hunter** tab — profile, trophy shelf, wardrobe, and the long-game trackers:

[[images/ui/hunter-profile.png]]

*The Hunter tab on day one: an empty trophy shelf, Cache Rank at zero, and the wardrobe waiting for its first crafted part.*

## What guests can and cannot do

Guests **see everything, with real data**: the player market's live listings and prices, the repair and shield-tech boards, leaderboards, the vendor's full stock — all of it. Browsing is never locked.

Only **transacting** requires signing in:

- Buying, selling, or listing on [[The Market]]
- Posting or accepting jobs on the [[Repair Board]] and [[Shield-Tech]] boards
- Claiming contract rewards on [[The Board]]

When a guest taps a locked action, the game says so and offers the Google sign-in right there — with your progress carrying over, per the rule above.

One platform note: sign-in exists **only in the CyberCache app**. The web build is a guest preview — browsing everything works exactly as described above, but its sign-in buttons and locked-action prompts will point you at the app instead of signing you in, because there is no web sign-in flow.

Two things need **no account at all**:

- **Crafting.** Guests craft freely — benches, recipes, and materials all work from your first session. See [[Crafting]].
- **The NPC [[Vendor]].** The vendor yard is open to everyone: guests can buy from the vendor **and** sell gear back at the buyback desk.

The Workshop — crafting's home — is fully readable as a guest, too: the whole recipe catalog, your benches, and your standing:

[[images/ui/workshop.png]]

*The Workshop as a new hunter sees it: one basic bench working, the Forge and Lab priced in the open, and every recipe naming what stands between you and making it.*

Guests also earn daily login streak rewards on exactly the same terms as signed-in players — see [[Leaderboards and Streaks]].

Guests also **see the weekly Rep Desk offers**: while a [[Manufacturer Standing|Parts Crate or Signature Order]] is claimable, Home's Weekly chip shows it with its real price — claiming is a locked action that asks for Google sign-in, per the rule above.

## Your first hour

1. **Roam the Dustwaste Frontier.** It is the first area and the right place to learn the rhythm: your hunter fights and loots in ticks, and drops appear as the run goes. Start the roam from [[The Board|the Board's]] stage — tap **Roam** on the mode rail and the area picker opens as the roam starts; tap Roam again any time to change areas without stopping.
2. **Equip whatever drops.** Even a small upgrade beats the starter setup. Salvage what you won't use — scrap feeds crafting and repairs.
3. **Crack your free daily cache.** Every day includes one free cache box; more can be opened with the cache keys from your starter bundle, up to the daily cap. See [[Caches]].
4. **Check in daily.** Opening the game records your login-streak day automatically — no button to remember. The streak flame on the Board shows where you stand.
5. **Prep your first boss.** Your first boss is the **Dune Tyrant** — a level-5 tutorial fight, free to attempt (a rematch costs 100 credits), and beating it unlocks the next boss up the ladder. Open the **Boss** stop on the Board and do the prep in three beats:
   - **Read the intel.** Prep shows the boss itself: its health, shield, armor, and damage, its mechanic, its phases, its weaknesses and resistances, and the consumables it recommends. The Tyrant has no special mechanic — its one phase is a basic survival check. Prep never prints a win chance or a readiness score: the intel is the boss's facts, and judging your build against them is your job.
   - **Match the element.** The Tyrant is weak to **Kinetic** and resists nothing, so the best weapon you own is the right weapon. That stops being true up the ladder — a weakness pays ×1.3 damage, a resistance only ×0.7.
   - **Load your belt.** The phase intel recommends a **Med Kit** and a **Shield Cell** for this fight. Belt consumables are burned by the attempt, so make sure yours are loaded before you start — and if your stacks are empty, the [[Vendor]] sells both (250 and 300 credits).

   [[images/ui/boss-prep.png]]

   *Boss prep for the Dune Tyrant: the boss itself on its arena plate — Kinetic weakness chip and all — above its own numbers and the phase's recommended counters: Med Kit and Shield Cell. No odds, anywhere.*

   See [[Bosses]] for risk settings, fees, and the dedicated-drop chase.
6. **Spend your first skill point.** Level 2 earns your first point in the four skill trees. See [[Progression]].

From there, the game opens outward: all seven areas are open from the start — the area picker warns you in real numbers when one outmatches your build, but it never locks you out — the [[The Market|market]] once you sign in, occupations beyond roaming, and eventually bosses, [[Endless Mode]], and [[Collections]].

---

_Source of truth: `src/auth/`, `db/migrations` (`cc_initial_bundle`), `src/server/routes/roamingHandler.ts`, `src/constants/roamingAreas.ts`, `src/lib/api/authService.ts`, `src/screens/AuthScreen.tsx`, `db/migrations/0021_vehicles.sql`, `src/content/cacheLane.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
