# Shield-Tech

Every shield has a **behavior** — Standard, Nova, Absorb, Amp, or Turtle —
rolled when the shield is generated (see [[Combat]]). Shield-Tech is the
service economy that changes it: a **recalibration** takes a shield from
its current behavior to a different one *you choose*, and changes nothing
else about the item. It's not a re-roll and it's not luck — the tech's
skill buys speed and consumable efficiency, never a better outcome,
because the outcome is the one you picked.

Like repair, there is **no NPC shield tech**. The work runs in two lanes:
the **Shield Tech** board inside [[The Market]], or your own workshop.
You can hold at most **3 self-lane recalibration jobs at once**.

## Calibration points and Calibration Cores

The work is measured in **calibration points** — the job size is the
shield's stored capacity, so bigger shields are bigger jobs.

The consumable is the **Calibration Core**, a crafted item (see
[[Crafting]]). One core at 100% quality carries **2,500 calibration
points**; its real capacity is 2,500 × quality % × the tech's efficiency,
so a well-crafted core is visibly worth more. Cores are burned
**worst-quality first** — your best cores are spent last.

## Lane 1: post it to the board

1. Open the **Shield Tech** tab, pick the shield, and pick the target
   behavior. Equipped and locked shields can't be posted.
2. Set the total price. The board shows the recent **median price per
   1,000 points for that shield's rarity**, and what your job would cost
   at that median.
3. Post. The **full price leaves your balance into escrow immediately**;
   terms are fixed at posting.
4. Any shield tech can accept — and **the tech supplies the Calibration
   Cores**, so your price is cores plus labor, all-in.
5. Unaccepted postings expire after **7 days** and refund in full.

## Lane 2: do it yourself

Run the recalibration as a timed workshop job with your own cores. The
job escrows exactly the cores it will burn — counted worst-first until
their capacity covers the shield — and refuses cleanly if your cores
can't cover the job. Untrained work runs at **500 calibration points per
hour**; mastery raises the rate up to a hard cap of twice that, and makes
each core carry up to **1.5×** its base capacity.

## How jobs settle — and when the shield flips

Money follows the [[Repair Board]] rule exactly:

- **Full price up front in escrow.**
- At any ending, the tech is paid **pro-rata** — price × points completed
  ÷ target points, rounded down — and the remainder refunds to the owner.
- The standard **5% market fee** comes out of the tech's payout and is
  destroyed.
- A job with **no progress for 48 hours** can be reclaimed by the owner
  on the same pro-rata terms.
- The tech earns XP per point actually completed, partial jobs included.

The shield itself is all-or-nothing: **the behavior flips only at 100%
completion.** A partial, abandoned, cancelled, or expired job leaves the
shield exactly as it was when posted — you never end up with a
half-recalibrated shield. (Turtle is the one behavior that also touches
stats: moving to or from Turtle re-derives capacity and recharge, because
Turtle's bigger, slower shield is part of what the behavior *is*.)

## The one banned recalibration

A target behavior is legal only if a shield of that rarity could have
generated with it. That rule has one famous consequence:

**Legendary → Standard is banned.** Legendary shields never generate as
Standard — they always carry Nova, Absorb, Amp, or Turtle — so no
recalibration, on the board or in your own workshop, can make one plain.
A legendary shield can move freely *between* the four exotic behaviors;
it just can never stop being exotic. Every other rarity can target any
behavior it could have rolled, including Standard.

## Guests

Guests can browse the board with real prices. Posting, accepting, or
cancelling a board job requires a signed-in (verified) account. The
self-lane is not a market transaction — **guests can recalibrate their
own shields** in the workshop.

---

_Source of truth: `src/content/shieldTech.ts`, `src/lib/combat/shieldBehaviors.ts`, `src/components/market/ShieldTechBoard.tsx`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
