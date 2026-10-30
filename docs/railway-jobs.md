# Railway Background Jobs (Route B, slice B5)

The June system ran its background work inside Supabase: two `pg_cron`
jobs and one Edge Function. Route B moves all of it onto the Chef. This
document is the runner contract for provisioning (slice B6): what to
schedule, what to call, and which env vars the Chef needs.

## Job inventory

| June mechanism | Schedule (UTC) | Route B replacement |
| --- | --- | --- |
| pg_cron `cybercache-daily-heartbeat` → `cc_record_daily_heartbeats()` | `0 6 * * *` | `POST /api/jobs/daily-heartbeat` |
| pg_cron `cybercache-prune-snapshots` → `cc_prune_progression_snapshots()` | `0 7 * * 0` | `POST /api/jobs/prune-snapshots` |
| NPC market seeding (Chef route, Supabase data path) | on demand | `POST /api/jobs/seed-npc-market` (alias: `POST /api/market/seed`) |
| Edge Function `send-test-push` (FCM) | on demand (player) | `POST /api/push/test` (Chef JWT) |

The SQL job bodies live in `db/migrations/0006_jobs.sql`; the routes in
`src/server/jobs/routes.ts`; machine-readable schedule definitions in
`ops/railway-cron-jobs.json`.

## Authentication

- Job routes require the shared secret in the `x-chef-job-secret`
  header. The Chef reads it from the `CHEF_JOB_SECRET` env var. When the
  var is unset, the job routes are **not mounted at all** (fail closed) —
  a cron call then 404s rather than running unauthenticated.
- Job routes accept no player JWT and read no identity from the request
  body. The two cron jobs are global maintenance; outcomes are computed
  from database state by the SQL functions, exactly as under pg_cron.
- `POST /api/push/test` is the exception: it is a player route (the Edge
  Function's caller-owned-devices semantics), authenticated by the Chef
  JWT like every other player route.

## Running the cron jobs on Railway (B6)

Create one Railway cron service per entry in `ops/railway-cron-jobs.json`,
in the same project as the Chef service, with:

- **Schedule:** the entry's cron expression (Railway cron schedules are
  UTC, matching the pg_cron originals).
- **Command:** a single HTTPS call to the Chef with the secret header.
  Any minimal HTTP client image works, e.g.:

  ```sh
  curl -fsS -X POST "$CHEF_BASE_URL/api/jobs/daily-heartbeat" \
    -H "x-chef-job-secret: $CHEF_JOB_SECRET" \
    -H 'content-type: application/json' -d '{}'
  ```

  with `CHEF_BASE_URL` set to the Chef service's public (or private
  networking) URL and the same `CHEF_JOB_SECRET` value the Chef service
  itself carries.
- **Success criteria:** HTTP 200 with `{ "ok": true, ... }`. Responses
  include the work counts (`recorded` / `pruned`) for log inspection.

Both jobs are idempotent (see the per-job notes in the JSON), so a
retried or duplicated cron fire is harmless — this is what made
pg_cron's at-least-once behavior safe in June, and it carries over.

## NPC market seeding

Run once after provisioning so the marketplace is not empty on first
launch, then on demand whenever the NPC stock should refresh:

```sh
curl -fsS -X POST "$CHEF_BASE_URL/api/jobs/seed-npc-market" \
  -H "x-chef-job-secret: $CHEF_JOB_SECRET" \
  -H 'content-type: application/json' \
  -d '{"count": 12, "level": 10}'
```

The seed writes under the fixed NPC account (`NPC_MARKET_USER_ID`,
default the nil UUID) and **replaces** that account's active listings:
prior active NPC listings are cancelled in the same transaction that
inserts the fresh items and listings. The June endpoint
`POST /api/market/seed` (header `x-npc-market-secret`, env
`NPC_MARKET_SEED_SECRET`) remains mounted as an alias onto the same
store for ops compatibility.

## Push (test push)

`POST /api/push/test` with a player Chef JWT sends a system push to the
caller's own active devices through FCM and records one
`notification_events` row per device — the Edge Function's behavior,
including its response shape. It needs `FIREBASE_ADMIN_JSON` (the
Firebase service-account JSON) in the Chef's env. When that var is
unset or invalid, the route answers `503 { "error":
"push_not_configured" }` and sends/logs nothing, so non-push
deployments are unaffected.

Device registration itself is a player write route from B3
(`POST /api/push/register` / `POST /api/push/disable` →
`cc_register_push_device` / `cc_disable_push_device`).

## Required Chef env for B5

| Var | Used by | Notes |
| --- | --- | --- |
| `CHEF_JOB_SECRET` | `/api/jobs/*` auth | Generate at B6; also set on each cron service. |
| `FIREBASE_ADMIN_JSON` | `/api/push/test` | Optional; absence disables push sending only. |
| `NPC_MARKET_USER_ID` | NPC seeding | Optional; defaults to the nil UUID, as in June. |
| `NPC_MARKET_SEED_SECRET` | `/api/market/seed` alias | Legacy; keep only if the alias stays in use. |
| `DATABASE_URL`, `CHEF_JWT_SECRET` | all Route B routes | Already required since B1. |
