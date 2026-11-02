# Slots

At the foot of the [[Vendor]] stall sits the **Data Slots** machine — the
game's declared gambling lane. Its math is not vibes: the full paytable
is printed on the machine, and the numbers on this page are the numbers
in the game. Play it for the prizes and the swing, not as an income plan:
the machine is a credit sink with prizes, not a faucet.

## Bets and limits

- **Three bet tiers:** 50 cr (**Chump Change**), 250 cr (**Working
  Stiff**), and 1,000 cr (**High Roller**).
- **100 pulls per day**, resetting at 00:00 UTC. The counters — pulls
  today, pulls left, and your cache budget — are shown on the machine.
- Every pull is decided by the server the moment you pull the lever; the
  reels are a reveal of the result, not the roll.

## The printed paytable

| Outcome | Chance | Pays |
|---|---|---|
| Bust | 54.8% | Nothing |
| Kickback | 20% | 0.5× bet back |
| Break-even | 12% | 1× bet back |
| Triple | 6% | 3× bet |
| Vendor Bundle | 4.2% | Staple goods ≈ 2× bet |
| Fragment Drop | 2% | 5 cache fragments |
| Ten-Spot | 0.8% | 10× bet |
| Cache Key | 0.15% | 1 cache key (see below) |
| Jackpot | 0.05% | 50× bet |

Credit payouts are the bet × the multiplier, rounded down.

## The return: exactly 50.5%

Add up only the credit outcomes and their odds:

- Kickback 20% × 0.5 = 10%
- Break-even 12% × 1 = 12%
- Triple 6% × 3 = 18%
- Ten-Spot 0.8% × 10 = 8%
- Jackpot 0.05% × 50 = 2.5%

That's a credit **return-to-player of exactly 50.5%**: wager 1,000 cr
over time and about 505 cr comes back as credits. The bundle, fragment,
and key prizes pay on top of that in goods — but on credits alone, the
machine keeps roughly half of everything wagered. That's the deal, in
writing, before you pull.

## The non-credit prizes

- **Vendor Bundle (4.2%):** a bundle of [[Vendor]] staples at flat 100%
  quality, composed to be the smallest combination of staple goods worth
  **at least 2× your bet** at vendor prices.
- **Fragment Drop (2%):** 5 cache fragments — a full key's worth by the
  standard conversion (see [[Caches]]).
- **Cache Key (0.15%):** the machine's best prize, and it plays by the
  cache lane's rules: the key is **charged against your daily cache-box
  budget** (10 openings a day) like any other key. If your budget is
  already full for the day, the pull pays **5 fragments instead** and the
  result tells you so in plain language. Either way, the key still has to
  survive the cache's own roll like every other key.

The machine **never pays gear, legendary cores, scrap, or essences** — if
a prize isn't credits, staples, fragments, or a key, it isn't on the
table.

## Guests

Anyone can see the machine — cabinet, reels, printed odds, and counters.
Pulling the lever moves real economy, so **pulls require a signed-in
(verified) account**; guests get the sign-in lock at the lever.

---

_Source of truth: `src/content/slots.ts`, `src/server/economy/config.ts` (slot levers). Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
