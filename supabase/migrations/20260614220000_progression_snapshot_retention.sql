-- Migration 20260614220000: Progression snapshot retention
--
-- Keep milestone events (boss_defeat) forever. Prune throttled event sources
-- (daily_heartbeat, chef_claim, settlement) after 30 days to stay within the
-- free Supabase tier storage budget.

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

revoke execute on function public.cc_prune_progression_snapshots() from anon, authenticated;
grant execute on function public.cc_prune_progression_snapshots() to service_role;
