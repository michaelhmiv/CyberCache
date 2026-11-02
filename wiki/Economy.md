# Economy (player view)

CyberCache runs on credits, and the credit economy is a faucet-and-sink
system: credits are created by play and destroyed by play, and the
balance between the two is what keeps prices meaningful. This page is
the whole player-facing contract. The exact tuning behind these systems
is adjusted server-side from time to time, but the *shape* below — what
pays, what charges, and at what headline rates — is the game.

New accounts start with a one-time bundle that includes **5,000
credits**, so a fresh hunter can shop the [[Vendor]] and post a first
job before earning anything.

## Where credits come from (faucets)

- **Roaming** — your hunter earns credits as they roam, foreground and
  claimed.
- **Offline earnings** — roaming keeps paying while you're away, settled
  when you return (subject to the offline cap on [[Progression]]).
- **Boss victories** — a win pays credits on top of the loot; see
  [[Bosses]].
- **[[Endless Mode]] payouts** — banked run rewards pay credits.
- **Contracts** — completing contracts from [[The Board]] pays their
  credit rewards.
- **Login streaks** — daily streak claims include small credit grants;
  see [[Leaderboards and Streaks]].
- **Dispatch missions** — completed dispatches pay credits; see
  [[Actions and Occupations]].
- **Selling on [[The Market]]** — another player's credits become yours
  (minus the fee below). A transfer, not a creation — except that the
  fee share leaves the economy for good.
- **[[Vendor]] buyback** — the vendor pays **40% of an item's value**,
  on demand, for gear, consumables, materials, and essences.
- **[[Slots]] credit prizes** — real, but remember the machine's other
  side of the ledger below.

## Where credits are destroyed (sinks)

Destroyed means gone: credited to nobody, removed from the economy
entirely.

- **The 5% market fee** on every completed player-to-player sale — the
  game's main credit sink. Service payouts on the [[Repair Board]] and
  [[Shield-Tech]] pay the same 5%.
- **[[Vendor]] purchases** — every credit spent at the NPC counter is
  destroyed (the counter doesn't bank it for anyone).
- **Boss entry and rematch fees**, and the extra defeat charges beyond
  the entry fee — full detail on [[Bosses]].
- **Resurrection charges** — dying costs credits to undo; see [[Bosses]].
- **[[Endless Mode]] entry fees** — destroyed at entry; see that page.
- **Skill respecs** — re-training your skill trees costs **100 cr per
  spent point** refunded.
- **[[Actions and Occupations|Research]] enrollment fees** — destroyed
  the moment you enroll, never refunded: **310,000 cr across the full
  12-course catalog**, the game's largest structured sink.
- **[[Manufacturer Standing]] tributes and desk prices** — a full
  six-rank ladder with one maker destroys **410,000 cr in tributes**,
  and Parts Crates and the 150,000 cr Signature Order are destroyed on
  purchase too.
- **The [[Slots]] machine** — every wager is destroyed at the pull, and
  the credit prizes pay back an exact **50.5%** over time. Net: roughly
  495 cr destroyed per 1,000 cr wagered.

## Transfers are neither

Some big credit movements create and destroy nothing: a market sale's
principal moves buyer → seller, and a service job's escrowed price moves
owner → mechanic. Only the 5% fee share leaves supply. When you're
pricing your time — crafting, repairing, recalibrating — that fee is the
tax to plan around, not a cost on top of your price.

## The other economies

Credits are only one ledger. These run on their own rules and don't
convert freely into credits:

- **Scrap** — from salvage; spent on crafting and reforge. See
  [[Collections]] and [[Crafting]].
- **Cache fragments and keys** — 5 fragments make a key, and openings
  share a daily budget of 10. See [[Caches]].
- **Legendary cores** — minted only by salvaging Legendary gear, spent
  on top-end crafting and reforge. See [[Collections]].
- **Materials and essences** — the crafting supply chain; see
  [[Crafting]].
- **Standing** — reputation per manufacturer, never spent, never traded.
  See [[Manufacturer Standing]].

## The one-paragraph version

Play creates credits — roaming, bosses, contracts, streaks, dispatch.
Trading moves them around and skims 5% into the void. Permanence costs
them: research, standing, respecs, boss fees, and the slot machine all
destroy credits on purpose, so the credits you earn keep meaning
something. If you ever wonder why a price on [[The Market]] is what it
is, this page is most of the answer.

---

_Source of truth: `src/server/economy/config.ts`, `docs/ECONOMY.md`, `src/content/research.ts`, `src/content/manufacturerStanding.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
