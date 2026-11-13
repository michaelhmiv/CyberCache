# Vendor

The NPC vendor is the beginner on-ramp: a counter that is always open,
never out of stock, and happy to sell you the basics so a new hunter can
always gear up for the next roam. What the vendor sells is deliberately
baseline — flat **100% quality**, no rarities, no surprises. Anything
better (quality above 100%, crafter-only types, the good ammo) comes only
from [[Crafting|crafters]] and [[The Market]].

You'll find the vendor as a stop on the Market rail. The stop opens on
the buy counter; a dashed **Sell to Vendor — Buyback** row at the top of
the stop opens the buyback desk. Standing with the makers has moved out
of the stall entirely — the [[Manufacturer Standing|Rep Desk]] is its
own stop on the same rail. Every item on the counter is one compact row: its icon,
its family and what it does, how many you already own, and the Buy
button with its price.

Tapping Buy opens a quantity sheet for that item: quick picks of
1 / 20 / 50 / 100 / 1,000 / MAX, a slider, and the total with your
credits after the purchase shown before you confirm. Stock is
unlimited, so MAX is simply as many as your credits cover; picks
past what you can afford stay visible but disabled.

## The staples — always in stock

Nine consumables are stocked every day, in unlimited quantity:

| Staple | Price |
|---|---|
| Generic Fuel Cell | 40 cr |
| Ammo Pack | 150 cr |
| Patch Kit | 150 cr |
| Med Kit | 250 cr |
| Shield Cell | 300 cr |
| Luck Booster | 350 cr |
| Ordnance Charge | 400 cr |
| Boss Scanner | 600 cr |
| Insurance Token | 800 cr |

These are the floor of the consumable economy. A crafter who can't beat
the vendor's price *and* quality on a staple has no product — and a hunter
in a hurry never has to wait for the player market to restock the basics.

The Ordnance Charge staple is the merged form of two items that used to
share this name: the vendor's old "Grenade" stock and the crafted Ordnance
Charge were the same item on paper, but only Ordnance Charge units counted
as ordnance in a boss fight. They are one item now — the vendor sells
Ordnance Charge, and any Grenade stock a hunter held was converted to
Ordnance Charge 1:1.

## Today's rotation

On top of the staples, the counter runs a small daily rotation:

- **2 rotating consumables**, drawn from the wider priced catalog
  (refined med kits, the elemental ammos, charges, tactical tools, and
  the Workshop Rush Ticket among them),
- **1 rotating material or essence**, drawn from the four remaining
  profile materials and the five essences.

The rotation is seeded by the UTC date — every player sees the same stock
on the same day, and new stock lands at **00:00 UTC**. Rotation prices for
the materials and essences, when they come up:

| Material / Essence | Price |
|---|---|
| Ballistic Parts | 15 cr |
| Reactive Components | 20 cr |
| Ignition Fluid, Conduit Wire, Acid Compound, Cryo Gel | 30 cr each |
| Tech | 35 cr |
| Void Dust | 75 cr |
| Void Essence | 90 cr |

Buying materials from the vendor is a convenience, priced so that
crafting a staple from vendor-bought materials always costs more than
just buying the staple.

**Scrap is not sold here.** The engine material left the vendor
catalog entirely — no sale line, no rotation slot, and no buyback
price (below). Scrap comes from playing the game — the roaming
trickle and salvaging gear you don't need — or from other hunters on
[[The Market|the player market]], where its price floats free.

## Item of the Day

One item on sale each day — drawn from the staples plus that day's
rotating consumables — is the **Item of the Day at 25% off**. It leads
the counter as its own row, marked with an ITEM OF THE DAY −25% chip.
The discount
is applied per unit and rounded down. If you burn through a staple, the
day it's featured is the day to stock up.

## Buyback: selling to the vendor

The **Sell to Vendor** desk — the dashed row at the top of the Vendor
stop — buys back almost anything, instantly, at
**40% of the item's vendor value**:

- **Gear** pays 40% of its estimated value (level, rarity, and stats set
  the value). Equipped and locked gear can't be sold — unequip and unlock
  first.
- **Consumable batches** pay 40% of base price scaled by the batch's
  quality % — a 140% batch is worth 40% more per unit than a 100% batch.
  Sell one at a time or the whole stack.
- **Materials and essences** pay 40% of their unit value in the table
  above — except **Scrap**, which the vendor places no value on at
  all: it can't be sold here. Sell Scrap to other hunters on the
  player market instead.

The payout for a sale is rounded down once, on the total. The screen shows
an estimate before you sell and the confirmed payout after. Buyback is the
fast, guaranteed exit — the [[The Market|player market]] usually pays
more, but it makes you wait for a buyer.

## Guests

The vendor is the friendliest counter in the game: **guests can buy and
sell here freely**. It's the one storefront whose transacting never
required an account, which makes it the right first stop for a brand-new
hunter.

The full consumables catalog — every item pictured with its in-game
icon — is in [[Reference-Consumables]].

---

_Source of truth: `src/lib/vendor/catalog.ts`, `src/screens/VendorScreen.tsx`, `src/constants/consumables.ts`, `docs/ECONOMY.md`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
