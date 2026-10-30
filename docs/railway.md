# Railway Provisioning Runbook (Route B)

The checklist for standing CyberCache up on Railway. Everything here is
owner-executed (slice B6 provisioning): the code is already cut over —
the Chef runs with zero Supabase dependency — so provisioning is
creating the services below and setting their variables. No credential
values are recorded in this repo; each secret is generated or copied
from its issuing console at provisioning time.

## Topology

One Railway project, four things in it:

| Piece | Kind | Source |
| --- | --- | --- |
| Postgres | Railway database | `db/migrations/` applied in order (below) |
| Chef | service (this repo) | `npm start` (Express server in `src/server/`) |
| `cybercache-daily-heartbeat` | cron service | `ops/railway-cron-jobs.json` |
| `cybercache-prune-snapshots` | cron service | `ops/railway-cron-jobs.json` |

## 1. Postgres

1. Create the Railway Postgres service in the project.
2. Apply the migrations in filename order against its `DATABASE_URL`:

   ```
   db/migrations/0001_auth.sql
   db/migrations/0002_provider_accounts.sql
   db/migrations/0003_read_apis.sql
   db/migrations/0004_write_apis.sql
   db/migrations/0005_profile_bootstrap.sql
   db/migrations/0006_jobs.sql
   db/migrations/0007_chef_gameplay_appliers.sql
   db/migrations/0008_legendary_honesty.sql
   db/migrations/0009_scrap_remainder.sql
   ```

   The migrations are plain
   Postgres: no extensions beyond what a stock Railway Postgres ships,
   no roles to create. Fresh start by design — there is no data
   migration from the retired Supabase project.

## 2. Chef service

Build from this repo; the start command runs the Express server
(`src/server/index.ts` via the package's server entry). Set:

| Variable | Value / source |
| --- | --- |
| `DATABASE_URL` | Reference to the Postgres service's connection string (Railway variable reference). |
| `CHEF_JWT_SECRET` | Fresh random secret (≥32 bytes), generated at provisioning time. Signs the Chef access/refresh tokens. |
| `CHEF_JOB_SECRET` | Fresh random secret, generated at provisioning time. Shared with the cron services (header `x-chef-job-secret`). |
| `GOOGLE_OAUTH_CLIENT_IDS` | Comma-separated OAuth client IDs for the Android (and later iOS) app, from the Google Cloud console for the CyberCache project. Used to verify Google ID tokens at sign-in. |
| `FIREBASE_ADMIN_JSON` | The Firebase service-account JSON (single line), from the Firebase console. Enables FCM test pushes (`POST /api/push/test`); optional — push sending is disabled without it. |
| `PORT` | Provided by Railway. |
| `NPC_MARKET_USER_ID` | Optional. The NPC seller account id; defaults to the well-known zero-UUID service account, which is created on first seed. |
| `NPC_MARKET_SEED_SECRET` | Optional. Gates the legacy `POST /api/market/seed` alias; generate if the alias will be used. |

Fail-closed behavior to expect: the Route B surfaces (auth, reads,
writes, gameplay, jobs) mount **only** when `CHEF_JWT_SECRET` and
`DATABASE_URL` are both set; job routes additionally require
`CHEF_JOB_SECRET`. A boot missing them serves the SPA and
`GET /api/health` only.

The client build needs the Chef's public URL as `VITE_CHEF_URL` (the
June client reads it via `chefUrl()` in `src/lib/chef/chefClient.ts`).

## 3. Cron services

Create one Railway cron service per entry in
`ops/railway-cron-jobs.json` (`cybercache-daily-heartbeat`,
`cybercache-prune-snapshots`), each a single HTTPS POST to the Chef with
the `x-chef-job-secret` header, per the runner contract in
`docs/railway-jobs.md`. Schedules are UTC, copied from the June pg_cron
jobs they replace.

## 4. First-boot checklist

1. `GET /api/health` → `{ "status": "ok", "chef": "ready" }`.
2. Guest sign-in (`POST /api/auth/guest`) returns a token pair; a
   follow-up authed read (`GET /api/profile`) succeeds with it.
3. Seed the NPC market once (`POST /api/jobs/seed-npc-market` with the
   job secret, or the `/api/market/seed` alias) so the marketplace is
   not empty on day one.
4. Fire each cron route once by hand and confirm `{ "ok": true, ... }`.
5. Retire the Supabase project (dashboard) — nothing in this repo
   references it after B6, and the fresh-start decision means no data
   needs to move.
