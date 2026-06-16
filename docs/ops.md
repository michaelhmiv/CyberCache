# CyberCache Operations Runbook

## Progression Snapshot Cron Jobs

Snapshot maintenance is handled by Supabase Cron (`pg_cron`), not by an external runner.

### Jobs

| Job | Schedule (UTC) | Function | Purpose |
|---|---|---|---|
| `cybercache-daily-heartbeat` | `0 6 * * *` | `public.cc_record_daily_heartbeats()` | Snapshot active players' progression once per day |
| `cybercache-prune-snapshots` | `0 7 * * 0` | `public.cc_prune_progression_snapshots()` | Remove `daily_heartbeat` snapshots older than 30 days |

### Migration

The schedules are defined in:

```
supabase/migrations/20260615140000_cybercache_progression_cron.sql
```

Apply with the linked Supabase CLI:

```bash
cd /data/cybercache
npx supabase migration up --linked
```

### Monitoring

List scheduled jobs:

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname like 'cybercache-%'
order by jobname;
```

Inspect recent runs:

```sql
select j.jobname, d.status, d.start_time, d.end_time, d.return_message
from cron.job_run_details d
join cron.job j on d.jobid = j.jobid
where j.jobname in ('cybercache-daily-heartbeat', 'cybercache-prune-snapshots')
order by d.start_time desc
limit 20;
```

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

If Supabase cron fails, the old Hermes cron jobs are paused but still present:

- `cybercache-daily-heartbeat` (Hermes job ID `6a2657d60bd9`)
- `cybercache-prune-snapshots` (Hermes job ID `531f9996c0a3`)

Resume them with:

```bash
hermes cron resume 6a2657d60bd9
hermes cron resume 531f9996c0a3
```

Then unschedule the Supabase cron jobs:

```sql
select cron.unschedule('cybercache-daily-heartbeat');
select cron.unschedule('cybercache-prune-snapshots');
```
