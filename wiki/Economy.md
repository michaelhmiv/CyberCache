# Economy (player view)

The credit economy is a faucet-and-sink system, and the rules below are the whole contract — the tuning levers behind them are server-side and can change without a client update, but the *shape* is fixed:

**Credits come from**: roaming and offline earnings, boss victories, contract rewards, login streaks, selling on [[The Market]], vendor buyback (40% of value), and dispatch missions.

**Credits are destroyed by** (sinks): the **5% market fee** on completed player sales, NPC [[Vendor]] purchases, boss entry and rematch fees, resurrection charges, skill respecs (100 cr per spent point), [[Actions and Occupations|Research]] enrollment fees (310,000 credits across the full catalog — the game's largest structured sink), and the [[Slots]] machine (50.5% RTP). Scrap, fragments, cores, and standing are separate economies with their own rules, covered on their own pages.

_Phase 1 stub — the full page (tables, worked examples, screenshots) lands in Wiki Phase 2._

---

_Source of truth: `src/server/economy/config.ts`, `docs/ECONOMY.md`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
