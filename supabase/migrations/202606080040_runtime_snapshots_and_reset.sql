create table if not exists public.player_runtime_snapshots (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version >= 1),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.player_runtime_snapshots enable row level security;

drop policy if exists "player_runtime_snapshots_select_own" on public.player_runtime_snapshots;
drop policy if exists "player_runtime_snapshots_insert_own" on public.player_runtime_snapshots;
drop policy if exists "player_runtime_snapshots_update_own" on public.player_runtime_snapshots;
drop policy if exists "player_runtime_snapshots_delete_own" on public.player_runtime_snapshots;

create policy "player_runtime_snapshots_select_own"
  on public.player_runtime_snapshots
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "player_runtime_snapshots_insert_own"
  on public.player_runtime_snapshots
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "player_runtime_snapshots_update_own"
  on public.player_runtime_snapshots
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "player_runtime_snapshots_delete_own"
  on public.player_runtime_snapshots
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.player_runtime_snapshots is 'Per-player UI/runtime snapshot. Supabase, not browser storage, is the refresh source of truth for screen-visible client state that has not yet been normalized into first-class runtime tables.';

create or replace function public.cc_reset_progress(nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  p public.profiles%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger
  where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  delete from public.service_jobs
  where owner_user_id = actor or provider_user_id = actor;

  delete from public.market_listings
  where seller_user_id = actor
     or item_instance_id in (
       select id from public.item_instances where owner_user_id = actor
     );

  delete from public.escrow_records
  where payer_user_id = actor or payee_user_id = actor;

  delete from public.item_instances
  where owner_user_id = actor;

  delete from public.player_professions where user_id = actor;
  delete from public.active_actions where user_id = actor;
  delete from public.player_stat_counters where user_id = actor;
  delete from public.player_masteries where user_id = actor;
  delete from public.player_runtime_snapshots where user_id = actor;

  update public.profiles
  set player_level = 1,
      player_xp = 0,
      credits = 5000,
      scrap = 500,
      cache_tokens = 3,
      cache_token_parts = 0,
      materials = '{}'::jsonb,
      essences = '{}'::jsonb,
      consumables = '{}'::jsonb,
      skill_spends = '{}'::jsonb,
      boss_state = jsonb_build_object('initial_bundle_claimed', true),
      last_idle_claim_at = now(),
      updated_at = now()
  where id = actor
  returning * into p;

  if not found then raise exception 'Profile not found'; end if;

  result := jsonb_build_object('action_type', 'cc_reset_progress', 'profile', public.cc_profile_snapshot(p));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_reset_progress', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_reset_progress(text) from public, anon;
grant execute on function public.cc_reset_progress(text) to authenticated, service_role;
