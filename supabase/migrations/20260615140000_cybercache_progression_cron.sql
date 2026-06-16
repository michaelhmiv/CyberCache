-- Migration 20260615140000: CyberCache progression snapshot cron jobs
--
-- Move the daily heartbeat and weekly prune from an external Hermes runner
-- into native Supabase Cron (pg_cron) schedules.

-- ---------------------------------------------------------------------------
-- Ensure pg_cron is available
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- Remove any existing schedules so this migration stays idempotent
-- ---------------------------------------------------------------------------
select cron.unschedule(jobid)
from cron.job
where jobname in ('cybercache-daily-heartbeat', 'cybercache-prune-snapshots');

-- ---------------------------------------------------------------------------
-- Daily progression heartbeat: snapshot active players at 06:00 UTC
-- ---------------------------------------------------------------------------
select cron.schedule(
  'cybercache-daily-heartbeat',
  '0 6 * * *',
  'select public.cc_record_daily_heartbeats();'
);

-- ---------------------------------------------------------------------------
-- Weekly snapshot prune: remove throttled snapshots older than 30 days
-- at 07:00 UTC on Sundays
-- ---------------------------------------------------------------------------
select cron.schedule(
  'cybercache-prune-snapshots',
  '0 7 * * 0',
  'select public.cc_prune_progression_snapshots();'
);
