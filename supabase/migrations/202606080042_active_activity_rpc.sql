-- Server-authoritative single active activity state.
-- The table existed from the runtime foundation, but direct writes were locked until RPCs could own transitions.

alter table public.active_actions
  add column if not exists target_type text,
  add column if not exists target_label text,
  add column if not exists scene_key text,
  add column if not exists activity_payload jsonb not null default '{}'::jsonb,
  add column if not exists public_payload jsonb not null default '{}'::jsonb,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists public_visible boolean not null default true,
  add column if not exists schema_version integer not null default 1 check (schema_version >= 1);

alter table public.active_actions
  drop constraint if exists active_actions_active_action_check;

alter table public.active_actions
  add constraint active_actions_active_action_check check (
    active_action in (
      'none',
      'idle_standby',
      'roaming_loot',
      'boss_prep',
      'boss_fight',
      'crafting',
      'salvaging',
      'workshop_service',
      'market_listing'
    )
  );

create index if not exists active_actions_public_visible_idx
  on public.active_actions(public_visible, updated_at desc)
  where public_visible = true;

create index if not exists active_actions_kind_idx
  on public.active_actions(active_action, updated_at desc);

create or replace function public.cc_active_action_snapshot(a public.active_actions)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', a.user_id,
    'active_action', a.active_action,
    'started_at', a.started_at,
    'completes_at', a.completes_at,
    'target_type', a.target_type,
    'target_id', a.target_id,
    'target_label', a.target_label,
    'scene_key', a.scene_key,
    'notes', a.notes,
    'activity_payload', coalesce(a.activity_payload, '{}'::jsonb),
    'public_payload', coalesce(a.public_payload, '{}'::jsonb),
    'last_heartbeat_at', a.last_heartbeat_at,
    'public_visible', a.public_visible,
    'schema_version', a.schema_version,
    'updated_at', a.updated_at
  );
$$;

create or replace function public.cc_set_active_action(
  nonce text,
  action_kind text,
  target_type text default null,
  target_id text default null,
  target_label text default null,
  scene_key text default null,
  expected_finish_at timestamptz default null,
  notes text default null,
  activity_payload jsonb default '{}'::jsonb,
  public_payload jsonb default '{}'::jsonb,
  public_visible boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  row public.active_actions%rowtype;
  normalized_kind text := coalesce(nullif(trim(action_kind), ''), 'idle_standby');
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  if normalized_kind not in (
    'none',
    'idle_standby',
    'roaming_loot',
    'boss_prep',
    'boss_fight',
    'crafting',
    'salvaging',
    'workshop_service',
    'market_listing'
  ) then
    raise exception 'Unsupported active action: %', normalized_kind;
  end if;

  select result_payload into prior
  from public.verified_action_ledger
  where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  insert into public.active_actions as aa (
    user_id,
    active_action,
    started_at,
    completes_at,
    target_type,
    target_id,
    target_label,
    scene_key,
    notes,
    activity_payload,
    public_payload,
    last_heartbeat_at,
    public_visible,
    schema_version,
    updated_at
  ) values (
    actor,
    normalized_kind,
    now(),
    expected_finish_at,
    nullif(target_type, ''),
    nullif(target_id, ''),
    nullif(target_label, ''),
    nullif(scene_key, ''),
    nullif(notes, ''),
    coalesce(activity_payload, '{}'::jsonb),
    coalesce(public_payload, '{}'::jsonb),
    now(),
    coalesce(public_visible, true),
    1,
    now()
  )
  on conflict (user_id) do update set
    active_action = excluded.active_action,
    started_at = excluded.started_at,
    completes_at = excluded.completes_at,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    target_label = excluded.target_label,
    scene_key = excluded.scene_key,
    notes = excluded.notes,
    activity_payload = excluded.activity_payload,
    public_payload = excluded.public_payload,
    last_heartbeat_at = excluded.last_heartbeat_at,
    public_visible = excluded.public_visible,
    schema_version = excluded.schema_version,
    updated_at = excluded.updated_at
  returning * into row;

  prior := jsonb_build_object(
    'action_type', 'cc_set_active_action',
    'activity', public.cc_active_action_snapshot(row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_set_active_action', nonce, prior);

  return prior;
end;
$$;

create or replace function public.cc_clear_active_action(nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  row public.active_actions%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger
  where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  insert into public.active_actions as aa (
    user_id,
    active_action,
    started_at,
    completes_at,
    target_type,
    target_id,
    target_label,
    scene_key,
    notes,
    activity_payload,
    public_payload,
    last_heartbeat_at,
    public_visible,
    schema_version,
    updated_at
  ) values (
    actor,
    'idle_standby',
    now(),
    null,
    null,
    null,
    null,
    null,
    null,
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    true,
    1,
    now()
  )
  on conflict (user_id) do update set
    active_action = 'idle_standby',
    started_at = now(),
    completes_at = null,
    target_type = null,
    target_id = null,
    target_label = null,
    scene_key = null,
    notes = null,
    activity_payload = '{}'::jsonb,
    public_payload = '{}'::jsonb,
    last_heartbeat_at = now(),
    public_visible = true,
    schema_version = 1,
    updated_at = now()
  returning * into row;

  prior := jsonb_build_object(
    'action_type', 'cc_clear_active_action',
    'activity', public.cc_active_action_snapshot(row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_clear_active_action', nonce, prior);

  return prior;
end;
$$;

create or replace function public.cc_active_action_heartbeat()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  row public.active_actions%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;

  update public.active_actions
  set last_heartbeat_at = now(), updated_at = now()
  where user_id = actor
  returning * into row;

  if not found then
    insert into public.active_actions (
      user_id,
      active_action,
      started_at,
      last_heartbeat_at,
      public_visible,
      updated_at
    ) values (actor, 'idle_standby', now(), now(), true, now())
    returning * into row;
  end if;

  return jsonb_build_object(
    'action_type', 'cc_active_action_heartbeat',
    'activity', public.cc_active_action_snapshot(row)
  );
end;
$$;

revoke execute on function public.cc_active_action_snapshot(public.active_actions) from public, anon;
revoke execute on function public.cc_set_active_action(text, text, text, text, text, text, timestamptz, text, jsonb, jsonb, boolean) from public, anon;
revoke execute on function public.cc_clear_active_action(text) from public, anon;
revoke execute on function public.cc_active_action_heartbeat() from public, anon;

grant execute on function public.cc_active_action_snapshot(public.active_actions) to authenticated, service_role;
grant execute on function public.cc_set_active_action(text, text, text, text, text, text, timestamptz, text, jsonb, jsonb, boolean) to authenticated, service_role;
grant execute on function public.cc_clear_active_action(text) to authenticated, service_role;
grant execute on function public.cc_active_action_heartbeat() to authenticated, service_role;

grant select on public.active_actions to authenticated;

comment on column public.active_actions.active_action is 'Server-authoritative primary activity. A player has exactly one active action row.';
comment on column public.active_actions.public_payload is 'Sanitized activity payload intended for future public profile/world pulse views.';
