# Vendor

The NPC vendor is the beginner on-ramp: a counter that is always open,
never out of stock, and happy to sell you the basics so a new hunter can
always gear up for the next roam. What the vendor sells is deliberately
baseline — flat **100% quality**, no rarities, no surprises. Anything
better (quality above 100%, crafter-only types, the good ammo) comes only
from [[Crafting|crafters]] and [[The Market]].

You'll find the vendor on its own tab of the Market screen. It has three
modes — **Buy**, **Sell to Vendor**, and **Rep Desk** (the Rep Desk is
[[Manufacturer Standing]]) — plus the [[Slots|slot machine]] at the foot
of the stall.

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

## Today's rotation

On top of the staples, the counter runs a small daily rotation:

- **2 rotating consumables**, drawn from the wider priced catalog
  (refined med kits, the elemental ammos, charges, tactical tools, and
  the Workshop Rush Ticket among them),
- **1 rotating material or essence**, drawn from the five profile
  materials and five essences.

The rotation is seeded by the UTC date — every player sees the same stock
on the same day, and new stock lands at **00:00 UTC**. Rotation prices for
the materials and essences, when they come up:

| Material / Essence | Price |
|---|---|
| Scrap Alloy | 10 cr |
| Ballistic Parts | 15 cr |
| Reactive Components | 20 cr |
| Ignition Fluid, Conduit Wire, Acid Compound, Cryo Gel | 30 cr each |
| Tech Fragments | 35 cr |
| Void Dust | 75 cr |
| Void Essence | 90 cr |

Buying materials from the vendor is a convenience, priced so that
crafting a staple from vendor-bought materials always costs more than
just buying the staple.

## Item of the Day

One item on sale each day — drawn from the staples plus that day's
rotating consumables — is the **Item of the Day at 25% off**. The discount
is applied per unit and rounded down. If you burn through a staple, the
day it's featured is the day to stock up.

## Buyback: selling to the vendor

The **Sell to Vendor** desk buys back almost anything, instantly, at
**40% of the item's vendor value**:

- **Gear** pays 40% of its estimated value (level, rarity, and stats set
  the value). Equipped and locked gear can't be sold — unequip and unlock
  first.
- **Consumable batches** pay 40% of base price scaled by the batch's
  quality % — a 140% batch is worth 40% more per unit than a 100% batch.
  Sell one at a time or the whole stack.
- **Materials and essences** pay 40% of their unit value in the table
  above.

The payout for a sale is rounded down once, on the total. The screen shows
an estimate before you sell and the confirmed payout after. Buyback is the
fast, guaranteed exit — the [[The Market|player market]] usually pays
more, but it makes you wait for a buyer.

## Guests

The vendor is the friendliest counter in the game: **guests can buy and
sell here freely**. It's the one storefront whose transacting never
required an account, which makes it the right first stop for a brand-new
hunter. (The [[Slots|slot machine]] at the same stall is the exception —
guests can look, but pulling takes a signed-in account.)

---

_Source of truth: `src/lib/vendor/catalog.ts`, `src/screens/VendorScreen.tsx`, `src/constants/consumables.ts`, `docs/ECONOMY.md`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
