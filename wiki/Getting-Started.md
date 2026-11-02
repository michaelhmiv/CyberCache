# Getting Started

You can start playing **instantly as a guest** — no account, no sign-in wall, no password. Tap **Continue as Guest** and your hunter exists from that moment. A guest is a real account, not a demo: your progress is saved by the game server and kept on your device, so it survives closing and reopening the app.

## Signing in

When you're ready, sign in with **Google** from the sign-in screen. There is no password form anywhere in the app, and sign-in is never through Play Games Services.

Signing in **upgrades your guest account in place**: you keep the same account, the same hunter, and every credit, item, and streak day you earned as a guest. Nothing restarts and nothing is transferred — the account simply gains a Google identity, which also lets you pick the hunter up on another device.

## The starter bundle

Every new hunter receives the **starter bundle** automatically, once, the first time your profile loads:

| You receive | Amount |
| --- | --- |
| Credits | 5,000 |
| Scrap | 500 |
| Cache keys | 3 |
| Vehicle | Scrap Bike |

The Scrap Bike is a level 1 Common vehicle, and it is auto-equipped if your vehicle slot is empty. It is yours permanently — the bundle can only ever be granted once per account.

## What guests can and cannot do

Guests **see everything, with real data**: the player market's live listings and prices, the repair and shield-tech boards, leaderboards, the vendor's full stock — all of it. Browsing is never locked.

Only **transacting** requires signing in:

- Buying, selling, or listing on [[The Market]]
- Posting or accepting jobs on the [[Repair Board]] and [[Shield-Tech]] boards
- Claiming contract rewards on [[The Board]]
- Pulling the lever on [[Slots]]

When a guest taps a locked action, the game says so and offers the Google sign-in right there — with your progress carrying over, per the rule above.

Two things need **no account at all**:

- **Crafting.** Guests craft freely — benches, recipes, and materials all work from your first session. See [[Crafting]].
- **The NPC [[Vendor]].** The vendor yard is open to everyone: guests can buy from the vendor **and** sell gear back at the buyback desk.

Guests also earn daily login streak rewards on exactly the same terms as signed-in players — see [[Leaderboards and Streaks]].

## Your first hour

1. **Roam the Dustwaste Frontier.** It is the first area and the right place to learn the rhythm: your hunter fights and loots in ticks, and drops appear as the run goes. Start the roam from [[The Board|the Board's]] stage.
2. **Equip whatever drops.** Even a small upgrade beats the starter setup. Salvage what you won't use — scrap feeds crafting and repairs.
3. **Crack your free daily cache.** Every day includes one free cache box; more can be opened with the cache keys from your starter bundle, up to the daily cap. See [[Caches]].
4. **Check in daily.** Opening the game records your login-streak day automatically — no button to remember. The streak flame on the Board shows where you stand.
5. **Prep your first boss when a weapon feels strong.** Boss prep shows you the boss's own effects, mechanics, and stats — read them, match your loadout to them, and take the fight. See [[Bosses]].
6. **Spend your first skill point.** Level 2 earns your first point in the four skill trees. See [[Progression]].

From there, the game opens outward: new areas as you level, the [[The Market|market]] once you sign in, occupations beyond roaming, and eventually bosses, [[Endless Mode]], and [[Collections]].

---

_Source of truth: `src/auth/`, `db/migrations` (`cc_initial_bundle`), `src/server/routes/roamingHandler.ts`, `src/lib/api/authService.ts`, `src/screens/AuthScreen.tsx`, `db/migrations/0021_vehicles.sql`, `src/content/cacheLane.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
