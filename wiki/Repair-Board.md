# Repair Board

There is **no NPC mechanic**. When your [[Vehicles and the Garage|vehicle]]
loses condition, the only way to hire help is other players: the Repair
Board — the **Repair Services** tab inside [[The Market]] — is an open
market for repair labor. Anyone can post a job, any mechanic can take it,
and there are no private hires: if it isn't posted on the board, it isn't
a hire.

Condition runs 0–100, and every repair job is measured in **condition
points restored**.

## The two lanes

**Hire a mechanic (the board).** Post your vehicle, name the points you
want restored (up to the full deficit) and the price, and a mechanic does
the work with *their* patch kits.

**Repair it yourself (the workshop).** Use your own patch kits as a timed
workshop job from the Garage. No board, no other player, no credits change
hands — but the work occupies your action slot while it runs, and you can
hold at most **3 self-repair jobs at once** (one per vehicle).

Either way, repair is timed work, never instant. Work only accrues while
the job is your active Workshop Service activity — see [[Actions and Occupations]].

## Patch kits

Kits are the consumable both lanes burn. At 100% quality:

| Kit | Restores |
|---|---|
| Patch Kit | 30 points |
| Field Patch Kit | 45 points |
| Master Patch Kit | 80 points |

A kit's real restore is its base × its quality % × the mechanic's
efficiency (below). The basic Patch Kit is a [[Vendor]] staple; the two
bigger kits are crafted (see [[Crafting]]).

## Posting a job, step by step

1. Open **Repair Services** on the Market screen and pick the vehicle.
2. Set the target points (the form defaults to the full deficit) and the
   total price. The board shows its recent **median price per point** —
   and what your job would cost at that median — so you can price like
   the market does.
3. Post. The **full price leaves your balance into escrow immediately**,
   and the terms are fixed at posting: they never change afterwards.
4. Any mechanic can accept. When they accept, they choose which kit type
   to burn — **the mechanic supplies the kits**, so your price is kits
   plus labor, all-in.
5. The mechanic works the job as their active activity. Unaccepted
   postings expire after **7 days** and refund in full.

## Browsing the board

The open postings browse like the [[The Market|Buy tab]] — the search,
filters, and sorts run on the server, in pages:

- **Search** matches vehicle class names and the poster's name.
- **Filters:** vehicle class, rarity, a condition band (how worn the
  vehicle is, in %), a price band, and a work-size band (points to
  restore).
- **Sorts:** newest, priciest, cheapest, most worn first, and expiring
  soonest.
- **Jobs I can take** narrows the board to postings you could accept
  right now.

Your browse choices stay put when you switch tabs and come back.

## What a job card tells you before you take it

Every open posting shows its requirements on its face — nothing is
hidden behind the accept button:

- **Escrow held:** the full price the owner already put up.
- **You supply the kits.** The card estimates how many of the selected
  kit type *you* would burn to finish, priced at your efficiency and
  walking your own batches worst-quality first — the same order the
  work itself burns them — plus roughly how long the job runs at your
  pace, and how many kits you actually hold.
- **Shortfalls are stated, not hidden.** If your kits can't cover the
  whole job, the card says so. Taking it is still allowed: work stalls
  when you run dry, and the points you banked are kept and paid
  pro-rata.
- **A job you cannot take says why** — no patch kits on hand, or (for
  guests) that taking jobs needs a signed-in account. Mastery is never
  a requirement: it only changes the speed and efficiency numbers the
  card quotes you.

Money follows work actually done:

- **Finished job:** the mechanic is paid the full price, minus the fee
  below.
- **Unfinished job** (cancelled, abandoned, or expired mid-work): the
  mechanic is paid **pro-rata** — price × points restored ÷ target
  points, rounded down — and the rest refunds to you.
- If a job sits with **no progress for 48 hours**, you can reclaim it and
  settle on the same pro-rata terms.

The standard **5% market fee** applies to the mechanic's payout and is
destroyed, exactly as on a [[The Market|market sale]].

## Being the mechanic

Accepting a job means supplying the kits and spending your action slot on
the work. What you earn:

- the payout above, minus the 5% fee,
- **2 XP per condition point actually restored** — partial jobs included,
  paid on the points that landed,
- repair mastery progress, 1 point per condition point restored.

Mastery is the mechanic's edge, and it is time and efficiency, never
permission:

- **Speed:** untrained work runs at **20 points per hour**. Each mastery
  level adds a little, up to a hard cap of **twice** the untrained rate.
- **Efficiency:** each mastery level makes every kit restore a little
  more, up to **1.5×** a kit's base restore (skill nodes can compose a
  little further, to 1.8×).

Anyone can do this work — a level-1 mechanic restores slowly and burns
more kits; a master restores fast and stretches every kit. That's the
whole ladder.

## Doing it yourself

Self-repair uses the same math with *your* mastery and *your* kits.
Untrained, that means 20 points per hour and kits at face value: a single
30-point Patch Kit occupies the work slot for about an hour and a half.
It's slow on purpose — the board exists because your time is worth
something — but it always works, costs no credits, and the worst case in
this game is walking while you wait.

## Guests

Guests can browse the board and watch prices with real data. Posting,
accepting, or cancelling a job requires a signed-in (verified) account —
the lock is on the button. Working on **your own** vehicle in the
workshop is not a board transaction and doesn't need one.

---

_Source of truth: `src/content/repair.ts`, `src/content/mechanicFramework.ts`, `src/components/market/RepairBoard.tsx`, `src/lib/vehicles/vehicles.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
