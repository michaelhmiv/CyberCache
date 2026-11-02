# The Market

The player marketplace is server-authoritative: listings are escrowed by the server, sales settle through the verified ledger, and nothing about a trade is client-trusted. You can list gear, consumable batches (with their quantity, quality %, and origin shown), and materials; essences are not listable.

A **5% fee is destroyed** on every completed player-to-player sale — it leaves the economy entirely, which is the game's main credit sink. The listing flow shows recent-sales price guidance for what you're selling, and the market carries per-category price history and trend charts built from real sales, so pricing is informed rather than guessed. Guests can browse every tab with real data; transacting (buying, listing, cancelling) requires signing in. The market screen also hosts the [[Repair Board]] and [[Shield-Tech]] service boards as their own tabs.

_Phase 1 stub — the full page (tables, worked examples, screenshots) lands in Wiki Phase 2._

---

_Source of truth: `src/screens/MarketScreen.tsx`, `src/server/economy/config.ts` (`marketFeeRate`), `docs/ECONOMY.md`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
