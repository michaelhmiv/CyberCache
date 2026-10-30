-- 0013_death_resurrection.sql
--
-- Phase 0 death & resurrection truth (Slice 4): death itself was
-- already server-computed (the Chef claim sim kills the hunter and
-- the ticker halts), but resurrection had NO server path at all —
-- the death screen's Paid revive deducted credits only from the
-- local display store (never charged server-side), the Free timer
-- was enforced only by the client's own clock, and the Revive Token
-- button was permanently disabled fiction (an item that exists in
-- no def, enum, migration, or server code — removed client-side in
-- this slice, not implemented here).
--
-- What lands here:
-- * profiles.death_state (jsonb, '{}' = alive): the server death
--   record, written by cc_record_death at the moment the claim sim
--   kills the hunter — { diedAtMs, areaId, monsterId, monsterName }.
--   This is the authority the resurrection op validates against;
--   the runtime display snapshot is NOT death authority.
-- * profiles.death_log (jsonb array, newest first, capped at 20):
--   the server-side copy of the death log the profile screen shows —
--   { monsterId, monsterName, areaId, at } entries, the client
--   DeathLogEntry shape.
-- * cc_record_death: first-death-wins. Once a death stands, later
--   lethal claims do NOT move diedAtMs (the free timer and the paid
--   price's area anchor to the real death, not a re-report).
-- * cc_resurrect: the resurrection op. Nonce-idempotent through
--   verified_action_ledger (key '<actor>:resurrect:<nonce>'), like
--   the other Chef appliers. method 'free' validates the free timer
--   against the SERVER clock (recorded diedAtMs + the free-timer
--   duration the route passes from the shared
--   RESURRECTION_FREE_TIMER_MS constant); method 'paid' charges
--   exactly the price the route derived from the shared
--   resurrectionCostForArea() over the RECORDED death area (never a
--   client-supplied area or price), balance-checked, atomically
--   with clearing the death state. Validation failures RETURN a
--   { resurrected: false, reason } payload (the settle-offline
--   precedent) so the route can map reasons to HTTP statuses;
--   nothing is charged and no ledger row is written on failure, so
--   the same nonce may be retried once the player qualifies.
--
-- MUST be applied live on Railway after merge (same pattern as
-- 0009–0012): until then the Chef's record/resurrect calls fail
-- against the missing columns/functions.

alter table public.profiles
  add column if not exists death_state jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists death_log jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- cc_record_death — persist the claim sim's kill (first death wins)
-- ---------------------------------------------------------------------------

create or replace function public.cc_record_death(
  _player_id uuid,
  _died_at_ms bigint,
  _area_id text,
  _monster_id text,
  _monster_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  existing jsonb;
  record jsonb;
  entry jsonb;
  next_log jsonb;
  old_entry jsonb;
  kept integer := 0;
begin
  if _player_id is null then raise exception '_player_id is required'; end if;
  if _died_at_ms is null or _died_at_ms <= 0 then raise exception 'died_at_ms is required'; end if;

  perform pg_advisory_xact_lock(hashtext(_player_id::text));

  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  existing := coalesce(p.death_state, '{}'::jsonb);
  if existing ? 'diedAtMs' then
    -- A death already stands: it stays the truth (its timestamp
    -- anchors the free timer; its area anchors the paid price).
    return jsonb_build_object('recorded', false, 'death', existing);
  end if;

  record := jsonb_build_object(
    'diedAtMs', _died_at_ms,
    'areaId', coalesce(_area_id, ''),
    'monsterId', coalesce(_monster_id, ''),
    'monsterName', coalesce(_monster_name, '')
  );
  entry := jsonb_build_object(
    'monsterId', coalesce(_monster_id, ''),
    'monsterName', coalesce(_monster_name, ''),
    'areaId', coalesce(_area_id, ''),
    'at', _died_at_ms
  );

  -- Prepend the new entry, keeping at most 19 prior entries (cap 20,
  -- the client death log's cap).
  next_log := jsonb_build_array(entry);
  for old_entry in select value from jsonb_array_elements(coalesce(p.death_log, '[]'::jsonb)) loop
    kept := kept + 1;
    if kept > 19 then exit; end if;
    next_log := next_log || jsonb_build_array(old_entry);
  end loop;

  update public.profiles
     set death_state = record,
         death_log = next_log,
         updated_at = now()
   where id = _player_id;

  return jsonb_build_object('recorded', true, 'death', record);
end;
$$;

-- ---------------------------------------------------------------------------
-- cc_resurrect — the server-side resurrection op
-- ---------------------------------------------------------------------------

create or replace function public.cc_resurrect(
  _player_id uuid,
  _nonce text,
  _method text,
  _paid_cost bigint,
  _free_timer_ms bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := _player_id;
  p public.profiles%rowtype;
  prior jsonb;
  nonce_key text;
  death jsonb;
  died_at_ms bigint;
  now_ms bigint;
  free_ready_at_ms bigint;
  cost bigint := 0;
  cleared_entry jsonb;
  result jsonb;
begin
  if actor is null then raise exception '_player_id is required'; end if;
  if _nonce is null or length(trim(_nonce)) < 8 then
    raise exception 'nonce is required (min 8 chars)';
  end if;
  if _method is null or _method not in ('free', 'paid') then
    raise exception 'method must be ''free'' or ''paid''';
  end if;

  nonce_key := actor::text || ':resurrect:' || _nonce;
  select vl.result_payload into prior
    from public.verified_action_ledger vl
   where vl.user_id = actor
     and vl.idempotency_key = nonce_key;
  if prior is not null then
    return prior || jsonb_build_object('idempotent_replay', true);
  end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  death := coalesce(p.death_state, '{}'::jsonb);
  if not (death ? 'diedAtMs') then
    return jsonb_build_object('resurrected', false, 'reason', 'no_death_recorded');
  end if;
  died_at_ms := (death ->> 'diedAtMs')::bigint;

  if _method = 'free' then
    -- Server-clock validation: the DB's now(), not the caller's.
    now_ms := (extract(epoch from now()) * 1000)::bigint;
    free_ready_at_ms := died_at_ms + greatest(0, coalesce(_free_timer_ms, 0));
    if now_ms < free_ready_at_ms then
      return jsonb_build_object(
        'resurrected', false,
        'reason', 'free_not_ready',
        'diedAtMs', died_at_ms,
        'freeReadyAtMs', free_ready_at_ms
      );
    end if;
  else
    -- Paid: the route derived _paid_cost from the shared price rule
    -- over the recorded death area; here it is only ever CHARGED —
    -- balance-checked and deducted in the same transaction that
    -- clears the death state.
    cost := greatest(0, coalesce(_paid_cost, 0));
    if coalesce(p.credits, 0) < cost then
      return jsonb_build_object(
        'resurrected', false,
        'reason', 'insufficient_credits',
        'cost', cost,
        'credits', coalesce(p.credits, 0)
      );
    end if;
  end if;

  cleared_entry := jsonb_build_object(
    'monsterId', coalesce(death ->> 'monsterId', ''),
    'monsterName', coalesce(death ->> 'monsterName', ''),
    'areaId', coalesce(death ->> 'areaId', ''),
    'at', died_at_ms
  );

  update public.profiles
     set credits = credits - cost,
         death_state = '{}'::jsonb,
         updated_at = now()
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'resurrected', true,
    'method', _method,
    'creditsCharged', cost,
    'death', cleared_entry,
    'deathLog', coalesce(p.death_log, '[]'::jsonb),
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_resurrect', nonce_key, result);

  return result;
end;
$$;
