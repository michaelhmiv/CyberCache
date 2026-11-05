# The Market

The Market is where hunters trade with each other. It lives on the Market
tab, whose **rail of stops** — **Buy · Sell · Vendor · Repair · Shield
Tech · Rep Desk** — runs across the
top and scrolls sideways; everything below the rail is the stop you
picked. The Sell stop carries three segments of its own — **Sell**,
**Mine**, and **History** — switched by the segment control at the top
of the stop. Every trade is settled by the server: when you list something, the server
holds it in escrow until it sells or you cancel, and when a sale completes
the credits move buyer → seller through the verified ledger. Nothing about
a trade is trusted to your device, so a listing you see is a listing that
really exists, at the price shown.

[[images/ui/market-buy.png]]

*The Buy stop: the rail across the top, search and filters, then the listings — each with its art, its stats, its price, and its seller.*

## Who can use it

Guests can browse everything. Every stop renders with real listings and real
prices, so you can learn the economy before you ever sign in. Transacting —
buying, listing, and cancelling your own listings — requires a signed-in
(verified) account. If you tap a buy or list button as a guest, you'll get
the sign-in prompt at the button instead of a silent refusal.

If you're signed in but short on credits, the Buy button says so instead of
going quiet: it prints **Short by X cr** — the exact gap between the price
and your balance — in its own style, distinct from the guest lock. Tapping
it repeats the shortfall and names where credits come from: roaming,
running contracts, and selling loot.

## What you can list

Five kinds of things trade on the Market:

- **Gear** — individual items: weapons, shields, relics, class mods,
  and ordnance. Each piece is listed on its own, with its own
  stats, rarity, and level. Locked gear can't be listed; unequip and unlock
  it first.
- **Vehicles** — individual [[Vehicles and the Garage|vehicle]]
  instances, under their own **Vehicles** category on the Buy lane. The
  card draws the actual vehicle — class, rolled fittings, and its live
  condition — because condition is part of what you're paying for.
  Vehicles carry **no level requirement**: if you can buy it, you can
  drive it. An equipped or on-contract vehicle can't be listed; park it
  in the Garage first.
- **Consumable batches** — a stack of one consumable type, listed with its
  quantity, its quality %, and its origin shown on the card. Quality matters
  here: a 140% batch is a different product from a 90% batch of the same
  consumable, and the listing says so.
- **Materials** — units of a crafting material, listed by quantity at a
  total price. On the card, a material or essence draws as the actual
  stuff it is — its formed object, in its own colors — so a stack reads
  by form and color, never a generic pack icon. **Scrap** trades here
  too: the salvage currency is a material, so the stock you earn from
  roaming and salvage is the same stack you can list — or buy when a
  build leaves you short.
- **Resources** — cache fragments, legendary cores, and essences, listed
  by quantity like materials. Fragments and cores each trade as a single
  commodity; each of the five essence types trades as its own commodity.
- **Skin parts** — crafted [[Skins and Cosmetics]] pieces, listed one by
  one like gear. The card shows the part worn, its finish, and its tint.
  Listing a part you are wearing takes it off your hunter in the same
  motion; locked parts and parts mid-tint can't be listed.

One fragment rule worth knowing: fragments listed for sale sit in escrow
and do **not** count toward the 5-fragments-to-1-key conversion while
they're listed — the conversion only ever applies to fragments actually
in your balance. Cancel the listing and they come back as fragments;
buying fragments settles them into your balance, where they convert as
usual.

## The player-market rule

The Buy and Sell stops are a **pure player market**: every listing
there — every kind, every rarity, Common included — was put up by a
hunter, and every purchase is one hunter buying from another. There
is no NPC stock in these lanes at all. The NPC shop lives in its own
place, the [[Vendor]] stop: staples, the daily rotation, and buyback
all happen there, never in Buy or Sell.

A weapon that came from vendor stock can't be listed in Sell — if
you own one, it leaves your inventory the other ways: sell it back
to the vendor at the [[Vendor]] stop (buyback) or recycle it for
scrap. (Vendor-sourced gear of other kinds can be re-listed like
anything else you own — when a hunter lists it, it's a hunter's
listing.)

## Buying

1. Open the **Buy** stop. The listings start right under the search
   box and the category chips — the lane is listings-first.
2. Narrow the list with the category chips (Weapons, Shields, Relics, Class
   Mods, Ordnance, Consumables, Materials, Cache Fragments, Legendary
   Cores, Essences), or open the **Filters** sheet: the Filters button
   prints how many filters are active and the current sort, and the
   sheet holds the rarity chips, the weapon type and element filters
   (on weapon searches), the level range and price range, and the
   sort — newest, cheapest, most expensive, highest level, rarity,
   or name.
3. Every row names its seller by their hunter name and carries its price history under the name,
   with the price and the Buy button at the row's right edge. Tap Buy
   and confirm. You pay exactly the
   listed price — the fee
   (below) comes out of the seller's side, never added on top for you.

   [[images/ui/market-row.png]]

   *One Buy row up close: its damage readouts and its price, with the seller's hunter name on the row.*

## Selling

1. Open the **Sell** stop. It shows everything you own that can be listed:
   gear, consumable batches, material stacks, and resource stacks
   (fragments, cores, and essences).
2. Pick the item or stack, set the quantity (for stacks), and set your
   price.
3. Before you confirm, the form shows recent-sales guidance for that exact
   item — the median recent price, the last sale price, and how many have
   sold — and pre-fills a sensible price from the median. Price above or
   below it as you like; the guidance is information, not a rule.
4. Confirm. The item leaves your inventory into escrow. If it doesn't sell,
   cancel from the **Mine** segment of the Sell stop and it comes straight back.

## The 5% fee

Every completed player-to-player sale pays a **5% fee**, taken from the
sale price. The buyer pays the listed price; the seller receives the price
minus the fee. The fee is **destroyed** — credited to nobody — which makes
it the game's main credit sink (see [[Economy]]).

Worked example: you list a shield for 10,000 cr. A buyer pays 10,000 cr.
The fee takes 500 cr out of the economy and you receive 9,500 cr.

One refinement: certain skill nodes shrink the fee on *your* sales (the
reduction is relative — it shrinks the fee, not the price). See
[[Progression]] for the trees that carry them.

## Price history and trends

Pricing on the Market is informed, not guessed. Listings and sell forms
carry real sales data for the same kind of item:

- a price sparkline built from recent sales,
- the **median** recent unit price,
- a 7-day **trend** (up / down / flat, with the percentage move), comparing
  the last 7 days against the 7 days before that.

An item with no recent sales shows no chart — the game never invents a
price history. Use the median as your anchor: pricing far above it usually
means your listing sits, and pricing below it is how you sell fast at a
real cost.

## Good to know

- The **History** segment of the Sell stop keeps your own record of buys
  and sales, with the other hunter named on every entry.
- Service work doesn't trade here as items — hiring a mechanic or a shield
  tech happens on the [[Repair Board]] and [[Shield-Tech]] stops of this
  same rail, under the same escrow-and-fee rules.
- Standing with a weapon maker lives at the **Rep Desk** stop on this
  rail — see [[Manufacturer Standing]].

## The service boards browse the same way

The [[Repair Board]] and [[Shield-Tech]] stops are not bare lists: they
carry the same discovery toolkit as the Buy stop — server-side search,
filters, sorts, and paged results — pointed at jobs instead of items.
Every open job also shows its requirements on the card itself: the
escrow held, the supply the taker must bring (patch kits or Calibration
Cores), an estimate of what finishing costs *you* at your own mastery
and stock, and — when you can't take a job — the reason why, on the
card's face.

---

_Source of truth: `src/screens/MarketScreen.tsx`, `src/server/economy/config.ts` (`marketFeeRate`), `src/lib/market/marketFee.ts`, `src/lib/market/identityKey.ts`, `docs/ECONOMY.md`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
