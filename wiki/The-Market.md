# The Market

The Market is where hunters trade with each other. It lives on the Market
screen, alongside the [[Vendor]], the [[Repair Board]], and [[Shield-Tech]].
Every trade is settled by the server: when you list something, the server
holds it in escrow until it sells or you cancel, and when a sale completes
the credits move buyer → seller through the verified ledger. Nothing about
a trade is trusted to your device, so a listing you see is a listing that
really exists, at the price shown.

## Who can use it

Guests can browse everything. Every tab renders with real listings and real
prices, so you can learn the economy before you ever sign in. Transacting —
buying, listing, and cancelling your own listings — requires a signed-in
(verified) account. If you tap a buy or list button as a guest, you'll get
the sign-in prompt at the button instead of a silent refusal.

## What you can list

Three kinds of things trade on the Market:

- **Gear** — individual items: weapons, shields, relics, class mods,
  ordnance, and vehicles. Each piece is listed on its own, with its own
  stats, rarity, and level. Locked gear can't be listed; unequip and unlock
  it first.
- **Consumable batches** — a stack of one consumable type, listed with its
  quantity, its quality %, and its origin shown on the card. Quality matters
  here: a 140% batch is a different product from a 90% batch of the same
  consumable, and the listing says so.
- **Materials** — units of a crafting material, listed by quantity at a
  total price.

**Essences are not listable.** There is no essence category and no way to
put essences up for sale — if you want to move essences, the [[Vendor]]
buyback desk is the only counter that takes them.

## Buying

1. Open the **Buy** tab.
2. Narrow the list with the category chips (Weapons, Shields, Relics, Class
   Mods, Ordnance, Consumables, Materials, Vehicles), the rarity chips, and
   the filters: weapon type and element on weapon searches, plus level
   range and price range.
3. Sort by newest, cheapest, most expensive, highest level, or rarity.
4. Tap a listing and confirm. You pay exactly the listed price — the fee
   (below) comes out of the seller's side, never added on top for you.

## Selling

1. Open the **Sell** tab. It shows everything you own that can be listed:
   gear, consumable batches, and material stacks.
2. Pick the item or stack, set the quantity (for stacks), and set your
   price.
3. Before you confirm, the form shows recent-sales guidance for that exact
   item — the median recent price, the last sale price, and how many have
   sold — and pre-fills a sensible price from the median. Price above or
   below it as you like; the guidance is information, not a rule.
4. Confirm. The item leaves your inventory into escrow. If it doesn't sell,
   cancel from **My Listings** and it comes straight back.

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

- The **History** tab keeps your own record of buys and sales.
- Service work doesn't trade here as items — hiring a mechanic or a shield
  tech happens on the [[Repair Board]] and [[Shield-Tech]] tabs of this
  same screen, under the same escrow-and-fee rules.
- Standing with a weapon maker is a separate counter entirely — see
  [[Manufacturer Standing]].

---

_Source of truth: `src/screens/MarketScreen.tsx`, `src/server/economy/config.ts` (`marketFeeRate`), `src/lib/market/marketFee.ts`, `src/lib/market/identityKey.ts`, `docs/ECONOMY.md`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
