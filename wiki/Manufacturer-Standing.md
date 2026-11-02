# Manufacturer Standing

Six weapon manufacturers keep reputations in CyberCache: **Redline,
Ironwood, BlastForge, Prismatek, ThrowTech, and HelixWorks**. Each maker
keeps its **own independent standing ladder**. There is no opposed
standing and no negative standing — raising one maker never lowers
another, and standing never decays. It only moves up.

You work the ladders at the **Rep Desk**, the third mode of the
[[Vendor]] screen. Standing is reputation only: it grants access and
cosmetics — never stats, drop rates, or discounts.

## Earning standing

Two ways in:

- **Turn-ins.** Hand the Rep Desk a piece of that maker's gear and it's
  destroyed for standing. The award is the item's salvage scrap value
  divided by 10 (rounded, minimum 1 point), so higher-level, higher-rarity
  gear is worth more standing. The item must be yours to give: not a
  vehicle, not locked, not equipped, and not listed or in escrow.
- **The kill drip.** Kills made with a maker's equipped weapon drip
  standing to that maker: **1 point per kill, up to 100 points per maker
  per day**. Slow, free, and it adds up while you play normally.

Your standing balance is **never spent**. Reaching a threshold makes you
*eligible* for a rank; the rank itself is granted when you pay the
tribute.

## Ranks and tributes

Five ranks per ladder. Each rank-up costs a one-time tribute — credits
(destroyed), plus a tribute item of that maker at Ranks 3–5:

| Rank | Title | Standing needed | Tribute credits | Tribute item |
|---|---|---|---|---|
| 1 | Recognized | 500 | 5,000 cr | — |
| 2 | Supplier | 2,000 | 15,000 cr | — |
| 3 | Partner | 5,000 | 40,000 cr | a Rare item of the maker |
| 4 | Insider | 11,000 | 100,000 cr | an Epic item of the maker |
| 5 | Factory Friend | 25,000 | 250,000 cr | an Epic item of the maker |

A **full ladder costs 410,000 credits plus 3 items**. Each maker also
gives its ranks flavor titles of its own — Redline's road runs Throttle →
Redliner → Pace Setter → Apex → Redline Royalty, and the other five
ladders are themed the same way. Six makers means six full ladders for a
completionist.

## The five unlocks

Every ladder pays out the same five unlocks, one per rank, themed per
maker:

- **Rank 1 — Rep Shelf.** One consumable matched to the maker's identity,
  always stocked at the Rep Desk at list price, flat 100% quality:
  Redline sells the Overcharge Stim (800 cr), Ironwood the Boss Scanner
  (600 cr), BlastForge the Ordnance Charge (400 cr), Prismatek Void Ammo
  (700 cr), ThrowTech the Magnetized Payload (650 cr), and HelixWorks the
  Luck Booster (350 cr).
- **Rank 2 — Exclusive recipe.** A maker-only consumable you can craft:
  the Redline Tonic, Heartwood Sight Oil, Forgeheart Charge, Prism
  Coating, ThrowTech Decoy Kit, or Helix Calibration Kit. Crafted, so it
  quality-scales like anything from the bench (see [[Crafting]]).
- **Rank 3 — Cosmetic.** A maker head variant and rig decal tint for your
  hunter, chosen in Settings. Looks only — no stats, by law.
- **Rank 4 — Weekly Parts Crate.** A bundle of that maker's workshop
  materials from the Rep Desk, once a week: 5,000 cr for most makers
  (Prismatek 6,000 cr, HelixWorks 5,500 cr). The conversion is
  deliberately poor — it's a convenience for the loyal, not a supply
  line.
- **Rank 5 — Weekly Signature Order.** Commission a weapon from that
  maker, forged at your level, for **150,000 cr**, once a week. The
  rarity lands **Rare (75%) or Epic (25%) — never Legendary**, and the
  weapon never carries a legendary effect.

## Read the fine print

- Turning in a **Legendary** earns standing only: it pays **no scrap and
  mints no legendary core**. Cores come from salvage alone (see
  [[Collections]]). Think twice before feeding a legendary to the desk.
- Tributes, crate prices, and the Signature Order price are destroyed
  credits — standing is one of the game's structured sinks (see
  [[Economy]]).
- Weekly means weekly per maker: a crate or order from one maker doesn't
  touch your cadence with the other five.

## Guests

Guests can read the Rep Desk — all six ladders, unlocks, and prices.
Turning in gear, paying a tribute, buying from a shelf or crate, and
placing a Signature Order all require a signed-in (verified) account.

---

_Source of truth: `src/content/manufacturerStanding.ts`, `src/server/routes/standing.ts`, `src/server/gameplay/standingOrder.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
