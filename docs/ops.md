# CyberCache Operations Runbook

## Progression Snapshot Cron Jobs

Snapshot maintenance runs as Chef job routes on Railway cron services
(Route B, slice B5) — the June system ran the same functions under
Supabase `pg_cron`. The runner contract (schedules, auth, payloads)
lives in `docs/railway-jobs.md` and `ops/railway-cron-jobs.json`;
provisioning steps are in `docs/railway.md`.

### Jobs

| Job | Schedule (UTC) | Route | Function |
|---|---|---|---|
| `cybercache-daily-heartbeat` | `0 6 * * *` | `POST /api/jobs/daily-heartbeat` | `public.cc_record_daily_heartbeats()` |
| `cybercache-prune-snapshots` | `0 7 * * 0` | `POST /api/jobs/prune-snapshots` | `public.cc_prune_progression_snapshots()` |

The SQL bodies live in `db/migrations/0006_jobs.sql`. Job routes are
authenticated by the `x-chef-job-secret` header (`CHEF_JOB_SECRET`)
and are not mounted at all when the secret is unset.

### Monitoring

Cron services log the Chef's `{ "ok": true, ... }` response, which
carries the work counts (`recorded` / `pruned`).

Check for duplicate daily snapshots (should be at most one per player within 20 hours):

```sql
select player_id, count(*)
from public.player_progression_snapshots
where source = 'daily_heartbeat'
  and snapshot_at > now() - interval '20 hours'
group by player_id
having count(*) > 1;
```

### Rollback

Both jobs are idempotent (the heartbeat skips players snapshotted in
the last 20 hours; the prune deletes a fixed predicate), so a missed
or duplicated cron fire is harmless — re-run the route by hand with
the job secret to recover a missed window.
