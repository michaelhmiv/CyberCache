create table if not exists public.consumable_batches (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  consumable_type text not null,
  quality_percent numeric(6,2) not null default 100 check (quality_percent >= 1 and quality_percent <= 250),
  quantity integer not null default 0 check (quantity >= 0),
  origin text not null default 'vendor' check (origin in ('vendor', 'crafted', 'market', 'reward', 'admin')),
  creator_user_id uuid references public.profiles(id) on delete set null,
  source_recipe_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consumable_batches_owner_idx on public.consumable_batches(owner_user_id);
create index if not exists consumable_batches_owner_type_idx on public.consumable_batches(owner_user_id, consumable_type);
create index if not exists consumable_batches_market_identity_idx on public.consumable_batches(consumable_type, quality_percent, origin) where quantity > 0;

alter table public.consumable_batches enable row level security;

drop policy if exists "consumable_batches_select_own" on public.consumable_batches;
create policy "consumable_batches_select_own"
  on public.consumable_batches
  for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

comment on table public.consumable_batches is 'Quality-aware consumable inventory. Legacy profiles.consumables remains the compatibility count map; this table is the source of truth for crafted/vendor quality stacks and future player-market listings.';

create table if not exists public.consumable_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  batch_id uuid references public.consumable_batches(id) on delete set null,
  consumable_type text not null,
  quantity_delta integer not null,
  quality_percent numeric(6,2),
  event_type text not null check (event_type in ('vendor_buy', 'crafted', 'market_buy', 'market_sell', 'used', 'expired', 'admin_adjust', 'reset')),
  activity_type text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists consumable_events_user_created_idx on public.consumable_events(user_id, created_at desc);
create index if not exists consumable_events_type_created_idx on public.consumable_events(consumable_type, created_at desc);

alter table public.consumable_events enable row level security;

drop policy if exists "consumable_events_select_own" on public.consumable_events;
create policy "consumable_events_select_own"
  on public.consumable_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.consumable_events is 'Append-only consumable economy ledger for vendor purchase, crafting, market movement, and runtime use/expiration events.';

revoke all on public.consumable_batches from public, anon, authenticated;
revoke all on public.consumable_events from public, anon, authenticated;
grant select on public.consumable_batches to authenticated;
grant select on public.consumable_events to authenticated;

create or replace function public.cc_add_consumable_batch(
  p_owner_id uuid,
  p_item_key text,
  p_quantity integer,
  p_quality_percent numeric default 100,
  p_origin text default 'vendor',
  p_creator_id uuid default null,
  p_source_recipe_id text default null,
  p_event_type text default 'vendor_buy',
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  qty integer := greatest(1, coalesce(p_quantity, 1));
  q numeric := greatest(1, least(250, coalesce(p_quality_percent, 100)));
  batch_id uuid;
begin
  if p_owner_id is null then raise exception 'owner_id is required'; end if;
  if p_item_key is null or length(trim(p_item_key)) = 0 then raise exception 'item_key is required'; end if;
  if p_origin not in ('vendor', 'crafted', 'market', 'reward', 'admin') then raise exception 'invalid consumable origin'; end if;
  if p_event_type not in ('vendor_buy', 'crafted', 'market_buy', 'market_sell', 'used', 'expired', 'admin_adjust', 'reset') then raise exception 'invalid consumable event type'; end if;

  select b.id into batch_id
  from public.consumable_batches b
  where b.owner_user_id = p_owner_id
    and b.consumable_type = p_item_key
    and b.quality_percent = q
    and b.origin = p_origin
    and coalesce(b.creator_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_creator_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(b.source_recipe_id, '') = coalesce(p_source_recipe_id, '')
  for update
  limit 1;

  if batch_id is null then
    insert into public.consumable_batches(owner_user_id, consumable_type, quality_percent, quantity, origin, creator_user_id, source_recipe_id, metadata)
    values (p_owner_id, p_item_key, q, qty, p_origin, p_creator_id, p_source_recipe_id, coalesce(p_metadata, '{}'::jsonb))
    returning id into batch_id;
  else
    update public.consumable_batches
    set quantity = quantity + qty,
        metadata = coalesce(public.consumable_batches.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where id = batch_id;
  end if;

  insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, reason, metadata)
  values (p_owner_id, batch_id, p_item_key, qty, q, p_event_type, p_reason, coalesce(p_metadata, '{}'::jsonb));

  return batch_id;
end;
$$;

revoke execute on function public.cc_add_consumable_batch(uuid, text, integer, numeric, text, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cc_add_consumable_batch(uuid, text, integer, numeric, text, uuid, text, text, text, jsonb) to service_role;

create or replace function public.cc_consume_consumable_batch(
  p_owner_id uuid,
  p_item_key text,
  p_quantity integer default 1,
  p_activity_type text default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer := greatest(1, coalesce(p_quantity, 1));
  take_qty integer;
  consumed jsonb := '[]'::jsonb;
  batch record;
begin
  if p_owner_id is null then raise exception 'owner_id is required'; end if;
  if p_item_key is null or length(trim(p_item_key)) = 0 then raise exception 'item_key is required'; end if;

  for batch in
    select *
    from public.consumable_batches
    where owner_user_id = p_owner_id
      and consumable_type = p_item_key
      and quantity > 0
    order by quality_percent asc, created_at asc
    for update
  loop
    exit when remaining <= 0;
    take_qty := least(remaining, batch.quantity);

    update public.consumable_batches
    set quantity = quantity - take_qty,
        updated_at = now()
    where id = batch.id;

    insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, activity_type, reason, metadata)
    values (p_owner_id, batch.id, p_item_key, -take_qty, batch.quality_percent, 'used', p_activity_type, p_reason, coalesce(p_metadata, '{}'::jsonb));

    consumed := consumed || jsonb_build_array(jsonb_build_object(
      'batch_id', batch.id,
      'consumable_type', p_item_key,
      'quality_percent', batch.quality_percent,
      'quantity', take_qty
    ));
    remaining := remaining - take_qty;
  end loop;

  if remaining > 0 then
    raise exception 'Insufficient consumable quantity for %', p_item_key;
  end if;

  return jsonb_build_object('consumed', consumed, 'requested_quantity', p_quantity, 'remaining_shortfall', remaining);
end;
$$;

revoke execute on function public.cc_consume_consumable_batch(uuid, text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cc_consume_consumable_batch(uuid, text, integer, text, text, jsonb) to service_role;

create or replace function public.cc_vendor_price(item_key text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case item_key
    when 'MedKit' then 250
    when 'ShieldCell' then 300
    when 'AmmoPack' then 150
    when 'Grenade' then 400
    when 'BossScanner' then 600
    when 'InsuranceToken' then 800
    when 'LuckBooster' then 350
    else null
  end;
$$;

revoke execute on function public.cc_vendor_price(text) from public, anon;
grant execute on function public.cc_vendor_price(text) to authenticated, service_role;

create or replace function public.cc_profile_snapshot(profile_row public.profiles)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', profile_row.id,
    'player_level', profile_row.player_level,
    'player_xp', profile_row.player_xp,
    'credits', profile_row.credits,
    'scrap', profile_row.scrap,
    'cache_tokens', profile_row.cache_tokens,
    'cache_token_parts', profile_row.cache_token_parts,
    'materials', profile_row.materials,
    'essences', profile_row.essences,
    'consumables', profile_row.consumables,
    'consumable_batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'consumable_type', b.consumable_type,
        'quality_percent', b.quality_percent,
        'quantity', b.quantity,
        'origin', b.origin,
        'creator_user_id', b.creator_user_id,
        'source_recipe_id', b.source_recipe_id,
        'metadata', b.metadata,
        'created_at', b.created_at,
        'updated_at', b.updated_at
      ) order by b.consumable_type, b.quality_percent desc, b.created_at)
      from public.consumable_batches b
      where b.owner_user_id = profile_row.id and b.quantity > 0
    ), '[]'::jsonb),
    'skill_spends', profile_row.skill_spends,
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at
  );
$$;

revoke execute on function public.cc_profile_snapshot(public.profiles) from public, anon;

create or replace function public.cc_vendor_buy(nonce text, item_key text, quantity integer default 1)
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
  unit_price bigint;
  qty integer := greatest(1, coalesce(quantity, 1));
  total_price bigint;
  batch_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  unit_price := public.cc_vendor_price(item_key);
  if unit_price is null then raise exception 'Unknown vendor item'; end if;
  total_price := unit_price * qty;
  if p.credits < total_price then raise exception 'Insufficient credits'; end if;

  update public.profiles
  set credits = credits - total_price,
      consumables = public.cc_jsonb_add_int(consumables, item_key, qty)
  where id = actor
  returning * into p;

  batch_id := public.cc_add_consumable_batch(
    actor,
    item_key,
    qty,
    100,
    'vendor',
    null,
    null,
    'vendor_buy',
    'Vendor baseline 100% quality purchase',
    jsonb_build_object('unit_price', unit_price, 'total_price', total_price)
  );

  result := jsonb_build_object(
    'action_type', 'cc_vendor_buy',
    'profile', public.cc_profile_snapshot(p),
    'item_key', item_key,
    'quantity', qty,
    'quality_percent', 100,
    'batch_id', batch_id,
    'total_price', total_price
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_vendor_buy', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_vendor_buy(text, text, integer) from public, anon;
grant execute on function public.cc_vendor_buy(text, text, integer) to authenticated, service_role;

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

  delete from public.consumable_events where user_id = actor;
  delete from public.consumable_batches where owner_user_id = actor;
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
