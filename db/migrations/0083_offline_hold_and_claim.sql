-- =====================================================================
-- 0083 — Offline earnings: HOLD-AND-CLAIM (owner decision 2026-11-05;
-- the streak's true-claim model, migration 0079, carried to offline
-- settlement).
--
-- The model changes, the arithmetic doesn't. Through 0082,
-- cc_settle_offline_roaming computed the away window AND credited it
-- in one call, fired automatically at session load and on resume —
-- the player was informed about money that had already moved, the
-- exact model the owner rejected for the streak. From here:
--
--   - cc_settle_offline_roaming (restated from its TRUE chain head,
--     0082 §9 — provenance below) still computes the window with the
--     existing machinery (watermark, nonce dedupe, cap, remainders,
--     the consumable burn fold + audit rows — the burn is a window
--     COST and stays at settle), but credits NOTHING: the payable
--     result accumulates into a new one-row-per-player hold
--     (public.offline_settlement_holds). Its ledger row is written
--     under action_type 'cc_hold_offline_settlement' with the SAME
--     nonce key, so the function's replay lookup (user + key, no
--     action filter) still short-circuits.
--   - cc_hold_offline_items (new) appends the window's item grants +
--     feed events to the hold, idempotent per settlement nonce —
--     items are route-stored JSON (the cc_items lane), so they
--     cannot ride the settle's own call; the settle upserts the hold
--     row on every settled window, so this call always has a home.
--   - cc_claim_offline_settlement (new) pays the hold atomically and
--     exactly once: credits, XP through cc_apply_xp on the profile's
--     then-current level/XP, cache tokens, the materials merge (the
--     held scrap joining the unified stock, 0069's rule at claim),
--     essences, and 0034's lifetime kill record with the held total.
--     The hold row is deleted in the same transaction; its existence
--     under the advisory + row locks IS the exactly-once anchor (the
--     paid_at analogue). A second claim finds no row and pays
--     nothing. The claim writes the verified_action_ledger row under
--     action_type 'cc_settle_offline_roaming' (key
--     '<actor>:offline_claim:<hold_id>') with the settle-shaped
--     payload every consumer already reads — so the economy fold
--     (minted_offline), the 0014 mastery/stat trigger, the 0042
--     contracts-stat trigger, the 0004 snapshot trigger and the
--     Activity Log projection all fire AT CLAIM, per 0079's doctrine
--     that meters move at claim, not at record. Item storage,
--     discoveries and the 0080 auto-salvage pass run in the claim
--     ROUTE off this result (same posture as the settle route's
--     post-steps today — nonce-held exactly-once at the SQL anchor).
--   - cc_profile_snapshot (restated from its TRUE chain head, 0082
--     §13) gains ONE additive key, 'offline_hold': the held totals
--     (zeros object when no hold), so the Home OFFLINE button and
--     the Return Sheet read server truth, never client math.
--
-- ACCUMULATION: repeated settles before a claim accumulate into the
-- single hold — each settle consumes only its own new window (the
-- watermark already guarantees no window is computed twice), so the
-- hold is exactly the sum of unpaid windows. HOLDS NEVER EXPIRE
-- (unlike streak rewards): the watermark has already consumed the
-- window, so expiring a hold would confiscate earned rewards.
--
-- Guests claim identically — everything keys on the profile row,
-- never on account state (0079's posture).
--
-- PROVENANCE (each restated function line-diffed against its head;
-- the diff contains ONLY the deltas named in its section):
--   - cc_settle_offline_roaming: head = 0082 §9 (chain: 0082 §9 ←
--     0069 ← 0034/0015/0012/0010/0009/0007). Deltas: hold-row lock;
--     materials/essences merge into the hold's maps; applied-
--     consumables accumulation; profile UPDATE reduced to window
--     bookkeeping (remainders, consumable fold, watermark, nonce);
--     hold upsert; 'held' + 'hold' keys in the result; kill-stats
--     perform removed (claim performs it); ledger action_type
--     'cc_hold_offline_settlement'. The window math, cap, tick
--     counting, remainder handling, consumable clamp + audit rows
--     and the active-action payload stamp are byte-identical.
--   - cc_profile_snapshot: head = 0082 §13 (chain: 0082 §13 ← 0069
--     ← 0031/0012/0010/0009/0003). Delta: the one additive
--     'offline_hold' key; every other key byte-identical.
--   - cc_hold_offline_items, cc_claim_offline_settlement: new.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The hold: one row per player, the unpaid settlement. Payable
-- accumulators + the window's item grants and feed events (filled by
-- cc_hold_offline_items) + accumulated window metadata. The row's
-- existence is the claim's exactly-once anchor.
-- ---------------------------------------------------------------------
create table if not exists public.offline_settlement_holds (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  hold_id uuid not null default gen_random_uuid(),
  credits bigint not null default 0,
  scrap bigint not null default 0,
  xp bigint not null default 0,
  cache_keys integer not null default 0,
  kills integer not null default 0,
  ticks integer not null default 0,
  materials jsonb not null default '{}'::jsonb,
  essences jsonb not null default '{}'::jsonb,
  applied_consumables jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  feed_events jsonb not null default '[]'::jsonb,
  item_nonces text[] not null default '{}'::text[],
  elapsed_ms bigint not null default 0,
  cap_reached boolean not null default false,
  cap_hours numeric,
  area_id text,
  settle_from timestamptz,
  last_settled_at timestamptz,
  start_tick bigint not null default 0,
  end_tick bigint not null default 0,
  windows integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. cc_settle_offline_roaming — restated from 0082 §9 (the chain
-- head) with ONLY the hold deltas named in the header. Same
-- signature, so no drop is needed (0082's own posture).
-- ---------------------------------------------------------------------
create or replace function public.cc_settle_offline_roaming(
  _player_id uuid,
  _settlement_nonce text,
  _credits bigint,
  _scrap bigint,
  _xp bigint,
  _keys integer,
  _materials jsonb,
  _essences jsonb,
  _kills integer,
  _scrap_remainder numeric default null,
  _credits_remainder numeric default null,
  _xp_remainder numeric default null,
  _keys_remainder numeric default null,
  _consumed_consumables jsonb default null,
  _cap_hours numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := _player_id;
  p public.profiles%rowtype;
  aa public.active_actions%rowtype;
  h public.offline_settlement_holds%rowtype;
  prior jsonb;
  settle_from timestamptz;
  now_ts timestamptz := now();
  raw_elapsed_ms bigint;
  cap_ms bigint;
  elapsed_ms bigint;
  cap_reached boolean;
  ticks_requested integer;
  new_tick_count bigint;
  tick_ms constant integer := 3000;
  next_materials jsonb;
  next_essences jsonb;
  next_consumables jsonb;
  applied_consumables jsonb := '{}'::jsonb;
  held_applied_consumables jsonb := '{}'::jsonb;
  cons_key text;
  cons_val integer;
  applied_val integer;
  mat_key text;
  mat_val integer;
  ess_key text;
  ess_val integer;
  nonce_key text;
  result jsonb;
begin
  if actor is null then raise exception '_player_id is required'; end if;
  if _settlement_nonce is null or length(trim(_settlement_nonce)) < 8 then
    raise exception 'settlement_nonce is required (min 8 chars)';
  end if;

  nonce_key := actor::text || ':offline_settle:' || _settlement_nonce;
  select vl.result_payload into prior
    from public.verified_action_ledger vl
   where vl.user_id = actor
     and vl.idempotency_key = nonce_key;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into aa from public.active_actions where user_id = actor for update;
  if not found or aa.active_action <> 'roaming_loot' then
    return jsonb_build_object('settled', false, 'reason', 'not_roaming', 'active_action', coalesce(aa.active_action, 'none'));
  end if;

  -- 0083: lock the player's offline hold row (if any) — this window
  -- accumulates into it below instead of crediting the profile.
  select * into h from public.offline_settlement_holds where player_id = actor for update;

  settle_from := coalesce(p.last_roaming_settled_at, aa.started_at);
  if settle_from is null then
    return jsonb_build_object('settled', false, 'reason', 'no_elapsed', 'detail', 'No settlement start timestamp available');
  end if;

  raw_elapsed_ms := (extract(epoch from now_ts) * 1000)::bigint - (extract(epoch from settle_from) * 1000)::bigint;
  if raw_elapsed_ms < 0 then raw_elapsed_ms := 0; end if;

  -- 0015: the route's server-derived earned cap wins over the stored
  -- preference whenever it is supplied.
  cap_ms := (greatest(0.25, coalesce(_cap_hours, p.offline_cap_hours, 2)) * 3600 * 1000)::bigint;
  cap_reached := raw_elapsed_ms > cap_ms;
  elapsed_ms := least(raw_elapsed_ms, cap_ms);

  ticks_requested := floor(elapsed_ms / tick_ms)::integer;
  if ticks_requested <= 0 then
    return jsonb_build_object('settled', false, 'reason', 'no_elapsed', 'elapsed_ms', elapsed_ms);
  end if;

  new_tick_count := coalesce(p.last_claimed_tick, 0) + ticks_requested;

  -- 0083: no cc_apply_xp here — the window's XP is held raw and the
  -- claim applies it through cc_apply_xp against the profile's
  -- then-current level/XP.

  -- 0083: the window's materials/essences merge into the HOLD's maps
  -- (0069's profile merge moved to the claim). Scrap is the hold's own
  -- accumulator — it joins the unified materials stock at claim.
  next_materials := coalesce(h.materials, '{}'::jsonb);
  for mat_key, mat_val in select key, value::integer from jsonb_each_text(coalesce(_materials, '{}'::jsonb)) loop
    next_materials := jsonb_set(next_materials, array[mat_key], to_jsonb(coalesce((next_materials ->> mat_key)::integer, 0) + mat_val), true);
  end loop;

  next_essences := coalesce(h.essences, '{}'::jsonb);
  for ess_key, ess_val in select key, value::integer from jsonb_each_text(coalesce(_essences, '{}'::jsonb)) loop
    next_essences := jsonb_set(next_essences, array[ess_key], to_jsonb(coalesce((next_essences ->> ess_key)::integer, 0) + ess_val), true);
  end loop;

  -- 0012: fold the engine's consumed set into the settlement, clamped
  -- per type to the owned count (same rule as
  -- cc_consume_roaming_consumables). The SRF columns are aliased for
  -- the same reason as in that function (0007 note): unaliased
  -- key/value output columns collide with the loop variables.
  next_consumables := coalesce(p.consumables, '{}'::jsonb);
  for cons_key, cons_val in select e.key, e.value::integer from jsonb_each_text(coalesce(_consumed_consumables, '{}'::jsonb)) as e loop
    if cons_val <= 0 then continue; end if;
    applied_val := least(cons_val, coalesce((next_consumables ->> cons_key)::integer, 0));
    if applied_val <= 0 then continue; end if;
    next_consumables := jsonb_set(next_consumables, array[cons_key], to_jsonb(coalesce((next_consumables ->> cons_key)::integer, 0) - applied_val), true);
    applied_consumables := jsonb_set(applied_consumables, array[cons_key], to_jsonb(applied_val), true);
  end loop;

  -- 0083: the hold's applied-consumables map accumulates per key
  -- (the claim's ledger payload carries the totals, so the 0014/0042
  -- trigger folds see the whole held consumption at claim time).
  held_applied_consumables := coalesce(h.applied_consumables, '{}'::jsonb);
  for cons_key, applied_val in select e.key, e.value::integer from jsonb_each_text(applied_consumables) as e loop
    held_applied_consumables := jsonb_set(held_applied_consumables, array[cons_key], to_jsonb(coalesce((held_applied_consumables ->> cons_key)::integer, 0) + applied_val), true);
  end loop;

  -- 0083: the profile UPDATE is bookkeeping only — fractional
  -- remainders (0082: the key remainder banks here, as before), the
  -- consumable burn fold + its audit rows below, the settlement
  -- watermark and the nonce. Credits, level/XP, cache tokens,
  -- materials and essences are NOT credited: they accumulate into
  -- the hold (the upsert after the audit rows) and land at claim.
  update public.profiles
     set credits_remainder = coalesce(_credits_remainder, credits_remainder),
         scrap_remainder = coalesce(_scrap_remainder, scrap_remainder),
         xp_remainder = coalesce(_xp_remainder, xp_remainder),
         cache_key_remainder = coalesce(_keys_remainder, cache_key_remainder),
         consumables = next_consumables,
         last_claimed_tick = new_tick_count,
         last_roaming_settled_at = now_ts,
         last_settlement_nonce = _settlement_nonce,
         updated_at = now_ts
   where id = actor
   returning * into p;

  -- 0012: audit rows for the applied decrements (same shape the
  -- foreground consumption function writes).
  for cons_key, applied_val in select e.key, e.value::integer from jsonb_each_text(applied_consumables) as e loop
    insert into consumable_events (
      user_id, consumable_type, quantity_delta,
      event_type, activity_type, reason
    )
    values (
      actor, cons_key, -applied_val,
      'used', 'roaming_loot',
      'Consumed during offline settlement in ' || coalesce(aa.target_id, '')
    );
  end loop;

  update public.active_actions
     set last_heartbeat_at = now_ts,
         activity_payload = coalesce(activity_payload, '{}'::jsonb) || jsonb_build_object('last_offline_settle_at', (extract(epoch from now_ts) * 1000)::bigint, 'last_offline_settle_ticks', ticks_requested)
   where user_id = actor;

  -- 0083: accumulate the window into the hold (one row per player;
  -- settle_from / start_tick stay the FIRST window's, the rest add
  -- or take the latest). Item payloads + feed events arrive through
  -- cc_hold_offline_items — the settle upserts the row on every
  -- settled window, so the items call always has a home.
  insert into public.offline_settlement_holds as oh (
    player_id, credits, scrap, xp, cache_keys, kills, ticks,
    materials, essences, applied_consumables,
    elapsed_ms, cap_reached, cap_hours, area_id,
    settle_from, last_settled_at, start_tick, end_tick, windows
  ) values (
    actor, _credits, _scrap, _xp, _keys, _kills, ticks_requested,
    next_materials, next_essences, held_applied_consumables,
    elapsed_ms, cap_reached, coalesce(_cap_hours, p.offline_cap_hours, 2)::numeric, aa.target_id,
    settle_from, now_ts, new_tick_count - ticks_requested, new_tick_count, 1
  )
  on conflict (player_id) do update set
    credits = oh.credits + excluded.credits,
    scrap = oh.scrap + excluded.scrap,
    xp = oh.xp + excluded.xp,
    cache_keys = oh.cache_keys + excluded.cache_keys,
    kills = oh.kills + excluded.kills,
    ticks = oh.ticks + excluded.ticks,
    materials = excluded.materials,
    essences = excluded.essences,
    applied_consumables = excluded.applied_consumables,
    elapsed_ms = oh.elapsed_ms + excluded.elapsed_ms,
    cap_reached = oh.cap_reached or excluded.cap_reached,
    cap_hours = excluded.cap_hours,
    area_id = excluded.area_id,
    last_settled_at = excluded.last_settled_at,
    end_tick = excluded.end_tick,
    windows = oh.windows + 1,
    updated_at = now()
  returning * into h;

  result := jsonb_build_object(
    'settled', true,
    'held', true,
    'atomic', true,
    'area_id', aa.target_id,
    'settle_from', settle_from,
    'settled_at', now_ts,
    'raw_elapsed_ms', raw_elapsed_ms,
    'elapsed_ms', elapsed_ms,
    'capped_ms', cap_ms,
    'cap_reached', cap_reached,
    'cap_hours', coalesce(_cap_hours, p.offline_cap_hours, 2)::numeric,
    'ticks_requested', ticks_requested,
    'ticks_settled', ticks_requested,
    'new_tick_count', new_tick_count,
    'start_tick', new_tick_count - ticks_requested,
    'end_tick', new_tick_count,
    'profile', public.cc_profile_snapshot(p),
    'rewards', jsonb_build_object('credits_awarded', _credits, 'scrap_awarded', _scrap, 'xp_awarded', _xp, 'cache_keys_awarded', _keys, 'materials', coalesce(_materials, '{}'::jsonb), 'essences', coalesce(_essences, '{}'::jsonb), 'kills_recorded', _kills, 'ticks', ticks_requested),
    'consumed_consumables', applied_consumables,
    'hold', jsonb_build_object(
      'hold_id', h.hold_id,
      'credits', h.credits,
      'scrap', h.scrap,
      'xp', h.xp,
      'cache_keys', h.cache_keys,
      'kills', h.kills,
      'ticks', h.ticks,
      'materials', h.materials,
      'essences', h.essences,
      'applied_consumables', h.applied_consumables,
      'items', h.items,
      'item_count', jsonb_array_length(h.items),
      'feed_events', h.feed_events,
      'elapsed_ms', h.elapsed_ms,
      'cap_reached', h.cap_reached,
      'cap_hours', h.cap_hours,
      'area_id', h.area_id,
      'start_tick', h.start_tick,
      'end_tick', h.end_tick,
      'windows', h.windows
    )
  );

  -- 0083: NO cc_record_kill_stats here — 0034's lifetime kill record
  -- is a payment-side fact and moves to the claim, which performs it
  -- with the held kill total (the claim function carries the note).

  -- 0083: the settle's ledger row is the HOLD record, under its own
  -- action_type — per the 0079 doctrine, meters move at claim, not
  -- at record: the economy fold (0074/0082 §14), the 0014 mastery /
  -- stat trigger, the 0042 contracts-stat trigger, the 0004
  -- snapshot trigger and the Activity Log projection all key on
  -- 'cc_settle_offline_roaming', which the CLAIM writes. The nonce
  -- key shape is unchanged, so this function's replay lookup above
  -- (user + key, no action filter) still short-circuits replays.
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_hold_offline_settlement', nonce_key, result);

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. cc_hold_offline_items (new): append a settled window's item
-- grants + feed events to the hold. Items are engine results the
-- route holds (cc_items payloads), so they cannot ride the settle
-- call itself; the settle upserts the hold row on every settled
-- window, so the row is here. Idempotent per settlement nonce — a
-- replayed call appends nothing. Returns the hold totals (post
-- append) in the settle result's 'hold' shape.
-- ---------------------------------------------------------------------
create or replace function public.cc_hold_offline_items(
  _player_id uuid,
  _settlement_nonce text,
  _items jsonb,
  _feed_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := _player_id;
  h public.offline_settlement_holds%rowtype;
begin
  if actor is null then raise exception '_player_id is required'; end if;
  if _settlement_nonce is null or length(trim(_settlement_nonce)) < 8 then
    raise exception 'settlement_nonce is required (min 8 chars)';
  end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into h from public.offline_settlement_holds where player_id = actor for update;
  if not found then
    return jsonb_build_object('held_items', false, 'reason', 'no_hold');
  end if;

  if not (h.item_nonces @> array[_settlement_nonce]) then
    update public.offline_settlement_holds
       set items = items || coalesce(_items, '[]'::jsonb),
           feed_events = feed_events || coalesce(_feed_events, '[]'::jsonb),
           item_nonces = item_nonces || array[_settlement_nonce],
           updated_at = now()
     where player_id = actor
     returning * into h;
  end if;

  return jsonb_build_object(
    'held_items', true,
    'hold', jsonb_build_object(
      'hold_id', h.hold_id,
      'credits', h.credits,
      'scrap', h.scrap,
      'xp', h.xp,
      'cache_keys', h.cache_keys,
      'kills', h.kills,
      'ticks', h.ticks,
      'materials', h.materials,
      'essences', h.essences,
      'applied_consumables', h.applied_consumables,
      'items', h.items,
      'item_count', jsonb_array_length(h.items),
      'feed_events', h.feed_events,
      'elapsed_ms', h.elapsed_ms,
      'cap_reached', h.cap_reached,
      'cap_hours', h.cap_hours,
      'area_id', h.area_id,
      'start_tick', h.start_tick,
      'end_tick', h.end_tick,
      'windows', h.windows
    )
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 4. cc_claim_offline_settlement (new): pay the hold, exactly once.
-- The payment block is the settle's own application (0082 §9's
-- UPDATE + merges + 0034 kill record), moved to claim time and fed
-- the HOLD's accumulated totals. The ledger row carries the
-- settle's action_type and payload shape, so every existing
-- consumer fires at claim. No client nonce: the hold row under the
-- locks is the anchor; a replay finds no row and pays nothing.
-- ---------------------------------------------------------------------
create or replace function public.cc_claim_offline_settlement(
  _player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := _player_id;
  p public.profiles%rowtype;
  h public.offline_settlement_holds%rowtype;
  xp_state jsonb;
  new_level integer;
  new_xp bigint;
  next_materials jsonb;
  next_essences jsonb;
  mat_key text;
  mat_val integer;
  ess_key text;
  ess_val integer;
  result jsonb;
begin
  if actor is null then raise exception '_player_id is required'; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into h from public.offline_settlement_holds where player_id = actor for update;
  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'nothing_held',
      'profile', public.cc_profile_snapshot(p)
    );
  end if;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, h.xp);
  new_level := (xp_state ->> 'player_level')::integer;
  new_xp := (xp_state ->> 'player_xp')::bigint;

  next_materials := coalesce(p.materials, '{}'::jsonb);
  for mat_key, mat_val in select key, value::integer from jsonb_each_text(coalesce(h.materials, '{}'::jsonb)) loop
    next_materials := jsonb_set(next_materials, array[mat_key], to_jsonb(coalesce((next_materials ->> mat_key)::integer, 0) + mat_val), true);
  end loop;
  -- 0069's rule, at claim: the held scrap lands in the unified
  -- materials stock.
  next_materials := jsonb_set(next_materials, '{Scrap}', to_jsonb(coalesce((next_materials ->> 'Scrap')::bigint, 0) + h.scrap), true);

  next_essences := coalesce(p.essences, '{}'::jsonb);
  for ess_key, ess_val in select key, value::integer from jsonb_each_text(coalesce(h.essences, '{}'::jsonb)) loop
    next_essences := jsonb_set(next_essences, array[ess_key], to_jsonb(coalesce((next_essences ->> ess_key)::integer, 0) + ess_val), true);
  end loop;

  update public.profiles
     set credits = credits + h.credits,
         player_level = new_level,
         player_xp = new_xp,
         cache_tokens = cache_tokens + h.cache_keys,
         materials = next_materials,
         essences = next_essences,
         updated_at = now()
   where id = actor
   returning * into p;

  -- 0034: lifetime kill record — same rule as the foreground claim,
  -- performed with the held kill total.
  perform public.cc_record_kill_stats(actor, h.kills);

  -- The anchor: the hold is consumed. A second claim (concurrent or
  -- replayed) finds no row above and pays nothing.
  delete from public.offline_settlement_holds where player_id = actor;

  result := jsonb_build_object(
    'claimed', true,
    'hold_id', h.hold_id,
    'area_id', h.area_id,
    'settle_from', h.settle_from,
    'settled_at', h.last_settled_at,
    'elapsed_ms', h.elapsed_ms,
    'cap_reached', h.cap_reached,
    'cap_hours', h.cap_hours,
    'ticks_settled', h.ticks,
    'start_tick', h.start_tick,
    'end_tick', h.end_tick,
    'windows', h.windows,
    'profile', public.cc_profile_snapshot(p),
    'rewards', jsonb_build_object('credits_awarded', h.credits, 'scrap_awarded', h.scrap, 'xp_awarded', h.xp, 'cache_keys_awarded', h.cache_keys, 'materials', h.materials, 'essences', h.essences, 'kills_recorded', h.kills, 'ticks', h.ticks),
    'consumed_consumables', h.applied_consumables,
    'items', h.items,
    'feed_events', h.feed_events
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_settle_offline_roaming', actor::text || ':offline_claim:' || h.hold_id::text, result);

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. cc_profile_snapshot — restated from 0082 §13 (the chain head)
-- with ONE additive key ('offline_hold'); every other key is
-- byte-identical to the head.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_profile_snapshot(profile_row profiles)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', profile_row.id,
    'player_level', profile_row.player_level,
    'player_xp', profile_row.player_xp,
    'credits', profile_row.credits,
    'scrap', coalesce((profile_row.materials ->> 'Scrap')::bigint, 0),
    'cache_tokens', profile_row.cache_tokens,
    'cache_key_remainder', coalesce(profile_row.cache_key_remainder, 0),
    'legendary_cores', coalesce(profile_row.legendary_cores, 0),
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
    'vehicle_fuel', profile_row.vehicle_fuel,
    'skill_spends', profile_row.skill_spends,
    'action_skill_charge', coalesce(profile_row.action_skill_charge, 0),
    'action_skill_selection', profile_row.action_skill_selection,
    'cache_rank_tokens', coalesce(profile_row.cache_rank_tokens, 0),
    'cache_rank_grant_level', coalesce(profile_row.cache_rank_grant_level, 0),
    'cache_rank_spends', coalesce(profile_row.cache_rank_spends, '{}'::jsonb),
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at,
    -- 0083: the held (unpaid) offline settlement, so the Home
    -- OFFLINE button and the Return Sheet read server truth — the
    -- same one-row subquery shape as consumable_batches above; the
    -- zeros object is the no-hold shape.
    'offline_hold', coalesce((
      select jsonb_build_object(
        'credits', oh.credits,
        'scrap', oh.scrap,
        'xp', oh.xp,
        'cache_keys', oh.cache_keys,
        'kills', oh.kills,
        'ticks', oh.ticks,
        'materials', oh.materials,
        'essences', oh.essences,
        'item_count', jsonb_array_length(oh.items),
        'elapsed_ms', oh.elapsed_ms,
        'area_id', oh.area_id
      )
      from public.offline_settlement_holds oh
      where oh.player_id = profile_row.id
    ), jsonb_build_object(
      'credits', 0, 'scrap', 0, 'xp', 0, 'cache_keys', 0, 'kills', 0,
      'ticks', 0, 'materials', '{}'::jsonb, 'essences', '{}'::jsonb,
      'item_count', 0, 'elapsed_ms', 0, 'area_id', null
    ))
  );
$function$;
