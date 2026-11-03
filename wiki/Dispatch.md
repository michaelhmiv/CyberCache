# Dispatch

Dispatch sends what you are *not* using. A **foot contract** commits a spare, unequipped loadout; a **courier contract** commits a spare, unequipped vehicle. The gear goes out, works a fixed term, and settles in full when the term ends — all of it **in parallel** with your personal action. Dispatch never occupies the [[Actions and Occupations|action slot]], is never paused by what your hunter is doing, and is never truncated by the offline cap: a 24-hour contract pays a 24-hour contract.

**Spare means spare.** Committed gear is locked for the duration — it cannot be equipped, sold, salvaged, reforged, or repaired mid-contract. Foot and courier contracts share **one queue with 2 slots**, so the bay runs at most two missions at once, in any mix.

## The daily board

The board is re-dealt every UTC day and is the same for every hunter: **6 offers — 4 foot, 2 courier** — each naming a destination area and a duration of **2, 8, or 24 hours**. You pick which offers to staff from your spares; unstaffed offers simply wait for tomorrow's board. Every number on a contract — payout, fuel, wear — is **fixed at departure** and shown before anything leaves. Nothing about a running contract is ever repriced.

## Foot contracts

A foot contract pays for the destination, the duration, and the strength of the loadout you send:

- **Credits and scrap at 40% of the destination area's roaming idle rates**, scaled by the loadout's **strength factor**.
- **Materials** from the destination area — roughly 1 unit per hour in the earliest areas, more in richer ones — also scaled by strength.
- **No XP, no gear, no legendaries, no cores.** Your hunter did not go; dispatch is a side faucet for the gear sitting in your stash, priced clearly below roaming it yourself.

**Strength** compares the dispatched set's power — item levels weighted by rarity, from 1.0 for Common up to 1.8 for Legendary — against a full seven-slot loadout appropriate to the destination. A token single item floors at **0.5×**; an over-geared spare set caps at **1.5×**. Send real gear, get real rates.

## Courier contracts

A courier contract sends a vehicle instead of a loadout, on one of three tiers. The gate reads **the vehicle's class — never your level**:

| Tier | Duration | Vehicle class required | Pays |
|---|---|---|---|
| Local Run | 2 h | Any class | Credit line ×1.6 |
| Regional Haul | 8 h | Utility Rover class or stronger | Credit line ×1.6 |
| Deep Haul | 24 h | Armored Crawler class or stronger | Credit line ×1.6 |

- **Credits** pay a **1.6× premium** over the same-duration foot line to the same destination (priced at full strength — no loadout rides). **Scrap** pays the plain foot line, unpremiated.
- **Materials** pay the foot amount **plus a cargo bonus** from the vehicle's hauling bonuses — hauling rigs earn their keep here.
- **Fuel is real and shared.** Courier routes burn from the same vehicle tank roaming does — 100 units per Generic Fuel Cell, loaded in the Garage — priced from the route's length and the vehicle's own burn rate, and shown to the unit before departure. See [[Vehicles and the Garage]].
- **Short on fuel?** When the tank cannot cover a route, the preview's fuel line carries the quick-buy **+** — it opens the [[Crafting|quick-buy sheet]] priced for exactly the cells the route is short. Bought cells land in your inventory; loading them into the tank stays the Garage's step, so the departure unblocks once the loaded tank covers the route.
- **Wear is exact arithmetic, not luck.** Projected wear comes from the vehicle's decay rate against the destination's danger, computed before departure — there is **no random breakdown roll**. If the projected wear would consume the vehicle's whole condition before the route ends, it breaks down at exactly the point the math says, and you see that point at prep, not as a surprise.

## Settlement

Contracts settle in full at term, from server timestamps, the next time the bay is read. A contract that ends **early** — you recall it, or the vehicle breaks down — settles **pro-rata**: you are paid for the fraction of the route actually covered, the unflown fraction of the fuel is refunded, and only the flown fraction of the wear is applied. Partial work pays the fraction done, never a rounded-up whole.

Where spares come from: roaming drops and the vendor for gear, the [[The Market|player market]] for vehicles.

---

_Source of truth: `src/content/dispatch.ts`, `src/server/routes/dispatch.ts`, `src/lib/vehicles/vehicles.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
