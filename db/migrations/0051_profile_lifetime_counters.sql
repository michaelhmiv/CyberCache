-- 0051_profile_lifetime_counters.sql
--
-- Profile stat gaps closed (the #234 disclosure): the lifetime
-- record gains the three figures it could not prove — lifetime
-- deaths, lifetime credits earned/spent, and kills by element.
-- Each stat gets the strongest treatment its records support:
--
-- DEATHS — backfilled, and complete since 0013. Deaths enter the
-- server record at exactly one point (cc_record_death, first death
-- wins) and leave it at exactly one point (cc_resurrect, which
-- succeeds ONLY against a standing death, clears it, and writes
-- exactly one nonce-idempotent ledger row per success — failures
-- write none, and nothing else in any migration clears
-- death_state). Past deaths therefore reconstruct exactly:
--   deaths = (# cc_resurrect ledger rows) + (1 if a death stands)
-- for every death since 0013 created the record. Deaths before
-- 0013 were never persisted server-side (resurrection was client
-- fiction until then) and stay uncounted — the same honesty rule
-- as 0026's discovery backfill. Going forward, cc_record_death
-- increments the counter on its recorded path (below).
--
-- CREDITS EARNED/SPENT — NOT reconstructible; counting starts at
-- this migration. Credits mutate inside dozens of cc_* appliers
-- across thirty migrations and their ledger payloads do not
-- uniformly carry the delta (the signup bundle's 5000 exists only
-- as a fold constant in 0018, boss attempts net fee + winnings
-- into one delta, and whole transfer families — service payments,
-- dispatch, slots, vendor buyback — sit outside even the economy
-- metrics attribution). Any ledger fold presented as "lifetime"
-- would silently omit flows. Instead a trigger on profiles.credits
-- accumulates the ACTUAL applied delta of every update — the one
-- choke point every credit change in the game passes through,
-- however it is written (trigger precedent: 0004's touch and
-- net-worth triggers, 0031's cache-rank grant trigger). The
-- definition is per-statement netting (a boss attempt's fee and
-- winnings land as one net delta, exactly as the balance moves),
-- which buys a hard invariant: earned − spent always equals the
-- balance change since tracking began. The counter row's
-- tracking_started_at is when counting began for that player —
-- the read surfaces it, so the figure is never mistaken for
-- all-time history it cannot prove.
--
-- KILLS BY ELEMENT — NOT reconstructible; accrues from this
-- migration, the 0034 rule repeated. The 0034 kill record stored
-- only the weapon type; which element each past kill used was
-- never recorded (the client-writable combat_stats table carries
-- an element map, but it is display history the architecture
-- forbids as lifetime truth). Going forward cc_record_kill_stats
-- derives the equipped weapon's element from the same
-- item_instances row it already reads (payload ->> 'element',
-- the market/reforge derivation) and accumulates alongside the
-- weapon type; no weapon equipped records 'unarmed' in both.
--
-- MUST be applied live on Railway BEFORE the read path deploys:
-- GET /api/profile/stats selects both new tables, so the Chef
-- 500s the lifetime record until this lands.

create table if not exists public.player_lifetime_counters (
  user_id uuid not null primary key references public.profiles(id) on delete cascade,
  deaths bigint not null default 0 check (deaths >= 0),
  credits_earned bigint not null default 0 check (credits_earned >= 0),
  credits_spent bigint not null default 0 check (credits_spent >= 0),
  /** When counting began for this player (row creation). */
  tracking_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_kill_element_stats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  element text not null,
  kills bigint not null default 0 check (kills >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, element)
);

-- ---------------------------------------------------------------------
-- Deaths backfill: resurrect successes + a standing death, per the
-- bijection in the header. Runs for every profile so each existing
-- player's credit tracking also starts at this migration
-- (tracking_started_at defaults to the apply time). Re-running the
-- backfill recomputes the same deaths figure: every death counted
-- by the live counter since apply is either resurrected (a ledger
-- row) or standing (death_state), so the derivation stays exact.
-- ---------------------------------------------------------------------
insert into public.player_lifetime_counters(user_id, deaths)
select p.id,
       (select count(*)::bigint
          from public.verified_action_ledger vl
         where vl.user_id = p.id
           and vl.action_type = 'cc_resurrect')
       + case when coalesce(p.death_state, '{}'::jsonb) ? 'diedAtMs' then 1 else 0 end
  from public.profiles p
on conflict (user_id) do update set deaths = excluded.deaths;

-- ---------------------------------------------------------------------
-- cc_record_death: the 0013 definition verbatim, plus the lifetime
-- counter increment on the recorded path (after the first-death-
-- wins early return — a re-report of a standing death never
-- double-counts, and the increment commits in the same transaction
-- as the death record itself).
-- ---------------------------------------------------------------------
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

  -- 0051: the lifetime death counter moves with the record.
  insert into public.player_lifetime_counters(user_id, deaths)
  values (_player_id, 1)
  on conflict (user_id)
  do update set deaths = public.player_lifetime_counters.deaths + 1,
                updated_at = now();

  return jsonb_build_object('recorded', true, 'death', record);
end;
$$;

-- ---------------------------------------------------------------------
-- Lifetime credit tracking: every applied credits delta on the
-- profile row accumulates into the counter, positive deltas as
-- earned, negative as spent. Fires only when the credits column is
-- written; a same-value write nets to zero and records nothing.
-- ---------------------------------------------------------------------
create or replace function public.cc_track_lifetime_credit_delta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta bigint;
begin
  v_delta := coalesce(new.credits, 0) - coalesce(old.credits, 0);
  if v_delta = 0 then return new; end if;

  insert into public.player_lifetime_counters(user_id, credits_earned, credits_spent)
  values (new.id, greatest(v_delta, 0), greatest(-v_delta, 0))
  on conflict (user_id)
  do update set credits_earned = public.player_lifetime_counters.credits_earned + excluded.credits_earned,
                credits_spent = public.player_lifetime_counters.credits_spent + excluded.credits_spent,
                updated_at = now();

  return new;
end;
$$;

drop trigger if exists profiles_track_lifetime_credits on public.profiles;
create trigger profiles_track_lifetime_credits
  after update of credits on public.profiles
  for each row execute function public.cc_track_lifetime_credit_delta();

-- ---------------------------------------------------------------------
-- cc_record_kill_stats: the 0034 definition, plus the element
-- accumulation. One derivation serves both tables: the equipped
-- weapon row's payload carries weaponType and element; no weapon
-- equipped records 'unarmed' in both (a weapon whose payload
-- somehow lacks an element also reads 'unarmed' rather than
-- inventing one — generated weapons always carry an element).
-- Called solely by the two roaming appliers on their pay paths,
-- exactly as before; boss and endless kills stay out by design.
-- ---------------------------------------------------------------------
create or replace function public.cc_record_kill_stats(_player_id uuid, _kills integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_weapon_type text;
  v_element text;
begin
  if _kills is null or _kills <= 0 then return; end if;
  select payload ->> 'weaponType', payload ->> 'element'
    into v_weapon_type, v_element
    from public.item_instances
   where owner_user_id = _player_id
     and runtime_state = 'equipped'
     and equipped_slot = 'weapon'
   limit 1;
  insert into public.player_kill_stats(user_id, weapon_type, kills)
  values (_player_id, coalesce(v_weapon_type, 'unarmed'), _kills)
  on conflict (user_id, weapon_type)
  do update set kills = public.player_kill_stats.kills + excluded.kills,
                updated_at = now();
  insert into public.player_kill_element_stats(user_id, element, kills)
  values (_player_id, coalesce(v_element, 'unarmed'), _kills)
  on conflict (user_id, element)
  do update set kills = public.player_kill_element_stats.kills + excluded.kills,
                updated_at = now();
end;
$$;
