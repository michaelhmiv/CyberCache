# Workshop Activity Enforcement

**Superseded doctrine (2026-10-31, crafting-as-occupation slice).** The
passive-queue model described by earlier revisions of this document —
bench timers running while the character roams, with the activity slot
claimed only for the dispatch moment — is RETIRED. Michael's occupations
law (one personal action at a time) wins; the design brief's flag F4
records the reversal.

## The rule now

Craft jobs are server state (`craft_jobs`, migration 0024) and progress
**only while `crafting` is the player's active action**:

- Progress accrues from server timestamps through `cc_settle_craft_jobs`
  (TS twin: `src/server/writes/craftEngine.ts`). No client clock takes
  part in any craft outcome; the old client queue store, its
  `Date.now()` claim math, and the offline queue processor are deleted.
- The settler runs at every activity transition (the SQL
  `cc_set_active_action` / `cc_clear_active_action` settle the outgoing
  action's jobs first, at their exact accrued values), at workshop
  state reads, at craft ops, and at offline settlement.
- Switching to roaming, boss prep/fight, or salvaging **pauses** every
  job. Paused time can never accrue later: every settle rebases each
  job's settle watermark, attended time (up to the last activity
  heartbeat + 5 minutes) is never truncated, and the away tail is
  capped by the effective offline cap (earned tier + limiter, 24h
  ceiling — brief flag F5).
- Enqueue escrows the full per-unit inputs atomically on the server;
  cancel refunds follow the brief's table (unstarted 100%, in-progress
  unit floor(50%), completed units kept). Units complete individually
  at settlement and pay XP, mastery, and their outputs (quality-rolled
  batches, refined materials, generated gear, tools) at that moment —
  never at enqueue, never on a client claim.
- Dispatch missions (a later slice) are the one parallel lane: they
  run on spare loadouts and never touch the personal action slot. The
  workshop is not dispatch.

## Non-negotiable rule

No workshop progress exists unless the server's active-action row says
`crafting` for the window it accrued in, and every economy mutation
lands through the verified craft ops (`cc_enqueue_craft_job`,
`cc_settle_craft_jobs`, `cc_cancel_craft_job`) and their ledger.
Screens display settled state; they never produce it.
