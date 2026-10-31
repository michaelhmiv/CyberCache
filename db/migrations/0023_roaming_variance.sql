-- 0023_roaming_variance.sql
--
-- Roaming Variance + Visual Overhaul slice (the flagship slice):
-- server support for the per-tick roaming event system, named-elite
-- kills, and the Tier-2 area-signature materials. Three changes:
--
--   1. cc_market_create_material restated (0019 verbatim) with the
--      listable material set extended from the 5 base materials to
--      all 12 MaterialType ids — the 7 Tier-2 signature materials
--      (Siltglass, NitrocellGel, HeartwoodResin, ForgeheartIngots,
--      PrismShards, MagnetiteCores, MycoSteelFiber) become tradable.
--      The TS twin is MARKET_MATERIAL_IDS = Object.values(MaterialType)
--      (src/lib/market/identityKey.ts), which picks the new ids up
--      from the enum directly; the memory writes store's MATERIAL_KEYS
--      is extended in the same slice.
--
--   2. cc_record_roaming_events: the claim routes report a claim's
--      fired roaming events and escalated-elite kills AFTER the claim
--      has been paid through the ordinary reward channels (event
--      payouts fold into cc_apply_chef_rewards / the settlement —
--      there is no event side-channel). This function writes the
--      verified-ledger rows the economy observability reads:
--        - 'roaming.event'     one row per claim, payload carries the
--                              fired events [{event_id, family}] and
--                              their count (realized event EV input).
--        - 'roaming.elite_kill' one row per claim with elite kills,
--                              payload carries the kill count.
--      Idempotency keys derive from the claim's end tick
--      (<player>:events:<tick> / <player>:elites:<tick>), so a route
--      retry can never double-record a claim. Recording is telemetry:
--      the routes call it log-and-continue — a failure here never
--      fails a paid claim.
--
--   3. Mastery: a 'combat.elite_kills' definition (boss-defeat XP
--      scale) plus a dedicated ledger trigger for the two new action
--      types. The main mastery trigger (0014) has an if/elsif chain
--      that falls through safely on unknown action types, so the new
--      rows need no restatement of it; this trigger adds only the
--      roaming-specific stats/mastery.
--
-- Nothing here changes how claims pay out. The AFK limiter needs
-- almost no SQL: cc_settle_offline_roaming already takes its cap as
-- an argument, and the settlement route now passes
-- min(earned, user limiter, 24h) computed by src/content/offlineCap.ts
-- (effectiveOfflineCapHours). The user's limiter itself is the
-- existing profiles.offline_cap_hours column; change 4 below is its
-- write path (section 4 at the end of this file).

-- ---------------------------------------------------------------------
-- 1. cc_market_create_material — 0019 definition verbatim, material
--    list extended to the full MaterialType enum (12 ids).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_market_create_material(p_player_id uuid, nonce text, material_id text, quantity integer, price_credits bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  listing public.market_listings%rowtype;
  qty integer := coalesce(quantity, 0);
  owned integer := 0;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if price_credits <= 0 then raise exception 'price_credits must be positive'; end if;
  if qty <= 0 then raise exception 'quantity must be positive'; end if;
  if material_id not in ('ScrapAlloy','BallisticParts','ReactiveComponents','TechFragments','VoidDust','Siltglass','NitrocellGel','HeartwoodResin','ForgeheartIngots','PrismShards','MagnetiteCores','MycoSteelFiber') then
    raise exception 'Unknown material';
  end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  owned := public.cc_jsonb_int(coalesce(p.materials, '{}'::jsonb), material_id);
  if owned < qty then raise exception 'Insufficient material quantity'; end if;

  update public.profiles
     set materials = public.cc_jsonb_add_int(materials, material_id, -qty)
   where id = actor
  returning * into p;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, material_id, identity_key, category,
    display_name, seller_type)
  values (
    actor, null, price_credits, 'active',
    'material', qty, material_id, 'mat:' || material_id, 'material',
    material_id, 'player')
  returning * into listing;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', null, 'delivery', jsonb_build_object('kind', 'material', 'material_id', material_id, 'quantity', qty));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------
-- 2. cc_record_roaming_events — ledger rows for a claim's events and
--    elite kills. Telemetry only; pays nothing.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_record_roaming_events(
  _player_id uuid,
  _events jsonb,
  _elite_kills integer,
  _area_id text,
  _tick_count bigint
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  event_count integer := 0;
  recorded_events integer := 0;
  recorded_elites integer := 0;
begin
  if _player_id is null then raise exception 'Authentication required'; end if;

  if _events is not null and jsonb_typeof(_events) = 'array' then
    event_count := jsonb_array_length(_events);
  end if;

  if event_count > 0 then
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (
      _player_id,
      'roaming.event',
      _player_id::text || ':events:' || coalesce(_tick_count, 0)::text,
      jsonb_build_object(
        'area_id', _area_id,
        'tick_count', _tick_count,
        'event_count', event_count,
        'events', _events
      )
    )
    on conflict (user_id, idempotency_key) do nothing;
    get diagnostics recorded_events = row_count;
  end if;

  if coalesce(_elite_kills, 0) > 0 then
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (
      _player_id,
      'roaming.elite_kill',
      _player_id::text || ':elites:' || coalesce(_tick_count, 0)::text,
      jsonb_build_object(
        'area_id', _area_id,
        'tick_count', _tick_count,
        'elite_kills', _elite_kills
      )
    )
    on conflict (user_id, idempotency_key) do nothing;
    get diagnostics recorded_elites = row_count;
  end if;

  return jsonb_build_object(
    'recorded_event_rows', recorded_events,
    'recorded_elite_rows', recorded_elites,
    'event_count', event_count,
    'elite_kills', coalesce(_elite_kills, 0)
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. Elite-kill mastery definition + the roaming ledger trigger.
-- ---------------------------------------------------------------------

insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('combat.elite_kills', 'combat', 'Elite Hunter', 'Named roaming elites eliminated (Epic-floor drops).', 'elite kill', 100, true, true, '2026-10-30T00:00:00.000Z'::timestamptz, '2026-10-30T00:00:00.000Z'::timestamptz) on conflict do nothing;

CREATE OR REPLACE FUNCTION public.cc_apply_roaming_event_mastery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n bigint;
begin
  if new.action_type = 'roaming.event' then
    n := greatest(0, coalesce((new.result_payload ->> 'event_count')::bigint, 0));
    if n > 0 then
      perform public.cc_add_stat(new.user_id, 'roaming.events_fired', n);
    end if;
  elsif new.action_type = 'roaming.elite_kill' then
    n := greatest(0, coalesce((new.result_payload ->> 'elite_kills')::bigint, 0));
    if n > 0 then
      perform public.cc_add_stat(new.user_id, 'combat.elite_kills', n);
      perform public.cc_add_mastery_xp_if_defined(new.user_id, 'combat.elite_kills', n * 100);
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists verified_action_ledger_roaming_events on public.verified_action_ledger;
create trigger verified_action_ledger_roaming_events
  after insert on public.verified_action_ledger
  for each row execute function public.cc_apply_roaming_event_mastery();

-- ---------------------------------------------------------------------
-- 4. cc_set_offline_cap_limiter — the Settings AFK limiter write.
--    Validation reports as data ({ok:false, error}) like
--    cc_set_username; null clears the limiter. The limiter can only
--    ever SHORTEN a settlement: the settlement route takes
--    min(earned, limiter, 24h) server-side.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_set_offline_cap_limiter(_player_id uuid, _cap_hours integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if _player_id is null then raise exception 'Authentication required'; end if;
  if _cap_hours is not null and (_cap_hours < 1 or _cap_hours > 24) then
    return jsonb_build_object('ok', false, 'error', 'Limiter must be between 1 and 24 hours, or unset.');
  end if;
  update public.profiles set offline_cap_hours = _cap_hours where id = _player_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found.');
  end if;
  return jsonb_build_object('ok', true, 'offline_cap_hours', _cap_hours);
end;
$function$;
