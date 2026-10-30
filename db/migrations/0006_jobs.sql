-- Route B — B5: background job functions (pg_cron replacements).
--
-- The June Supabase system ran exactly two pg_cron jobs, both defined in
-- supabase/migrations/20260615140000_cybercache_progression_cron.sql:
--
--   cybercache-daily-heartbeat  '0 6 * * *'   select cc_record_daily_heartbeats();
--   cybercache-prune-snapshots  '0 7 * * 0'   select cc_prune_progression_snapshots();
--
-- Route B replaces pg_cron with a Railway cron service calling secret-
-- protected Chef routes (POST /api/jobs/*, see src/server/jobs/). The job
-- bodies stay SQL functions so the Chef route is a thin authenticated
-- trigger — same pattern as the B2/B3 cc_* ports. Their helpers
-- (cc_compute_player_snapshot, cc_record_player_snapshot) already landed
-- in 0004_write_apis.sql; neither function used auth.uid(), so both port
-- verbatim from the Supabase migrations
-- (20260614210000_player_progression_snapshots.sql and
-- 20260614220000_progression_snapshot_retention.sql).
--
-- Both jobs are idempotent by construction, which is what makes the cron
-- replacement safe to fire twice:
--   - heartbeats skip players who already have a daily_heartbeat snapshot
--     in the last 20 hours (and cc_record_player_snapshot throttles the
--     same source to one row per 5 minutes per player);
--   - prune deletes a fixed predicate (throttled sources older than 30
--     days), so a second run deletes nothing more.
--
-- Idempotent migration: create or replace only; safe to apply twice.

-- ---------------------------------------------------------------------------
-- Daily heartbeat batch (was: pg_cron 'cybercache-daily-heartbeat', 06:00 UTC)
-- ---------------------------------------------------------------------------
create or replace function public.cc_record_daily_heartbeats()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_id bigint;
  rec record;
begin
  for rec in
    select id
    from public.profiles
    where updated_at > now() - interval '7 days'
      and not exists (
        select 1 from public.player_progression_snapshots
        where player_id = profiles.id
          and source = 'daily_heartbeat'
          and snapshot_at > now() - interval '20 hours'
      )
  loop
    v_id := public.cc_record_player_snapshot(rec.id, 'daily_heartbeat');
    if v_id is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot retention prune (was: pg_cron 'cybercache-prune-snapshots',
-- Sundays 07:00 UTC). Milestone sources (boss_defeat, …) are kept forever;
-- only throttled event sources older than 30 days are removed.
-- ---------------------------------------------------------------------------
create or replace function public.cc_prune_progression_snapshots()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.player_progression_snapshots
  where source in ('daily_heartbeat', 'chef_claim', 'settlement')
    and snapshot_at < now() - interval '30 days';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
