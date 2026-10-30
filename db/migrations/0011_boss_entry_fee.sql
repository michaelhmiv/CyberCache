-- 0011_boss_entry_fee.sql
--
-- Phase 0 boss loop (Slice 1): boss attempts become real, resolved
-- encounters. The Chef/route changes are TypeScript (prepared
-- consumables honored, unlock gate, dedicated drops); this migration
-- covers the one persistence change they need.
--
-- cc_apply_chef_boss_attempt (ported in 0007, amended in 0008) gains
-- an eleventh argument, _entry_fee (default 0): the attempt's entry
-- fee, derived server-side by the verify-boss route from the boss def
-- (entryCost, or rematchCost when the boss was already defeated).
--
-- The fee amount itself is folded into _credits_delta by the Chef —
-- the credits update below is unchanged. _entry_fee exists so the
-- applier can (a) guard affordability atomically under the profile
-- row lock (backstop to the route's pre-check; the fee was charged
-- on top of a clamped-negative balance before this, i.e. never), and
-- (b) record 'entry_fee' in the result/ledger payload so the charge
-- is auditable per attempt.
--
-- The replay branch also changes: a nonce replay now returns the
-- stored ledger payload merged with 'idempotent_replay': true (the
-- stored payload itself is untouched). Before this, the route could
-- not tell a replay from a first application and re-stored the
-- freshly re-rolled loot, duplicating boss items on client retries.
--
-- The 0008 ten-argument signature is dropped first so ten-argument
-- calls cannot resolve ambiguously; the rest of the body is the 0008
-- definition verbatim apart from the fee guard and payload fields.

drop function if exists public.cc_apply_chef_boss_attempt(uuid, text, bigint, boolean, bigint, bigint, jsonb, jsonb, text, bigint);

create or replace function public.cc_apply_chef_boss_attempt(
  _player_id uuid,
  _boss_id text,
  _attempt_nonce bigint,
  _victory boolean,
  _credits_delta bigint,
  _xp bigint,
  _consumables jsonb,
  _attempt jsonb,
  _unlocked_boss_id text default null,
  _scrap_delta bigint default 0,
  _entry_fee bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  result jsonb;
  prior jsonb;
  nonce_key text;
  xp_state jsonb;
  next_level integer;
  next_xp bigint;
  next_consumables jsonb;
  con_key text;
  con_val integer;
  current_count integer;
  consumed_batches jsonb := '[]'::jsonb;
  consumed_one jsonb;
  boss_state_next jsonb;
  defeated_ids jsonb;
  unlocked_ids jsonb;
  pity_counters jsonb;
  current_pity integer;
begin
  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  nonce_key := _player_id::text || ':chef-boss:' || _boss_id || ':' || _attempt_nonce::text;
  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id
     and idempotency_key = nonce_key;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  -- 0011: entry-fee affordability guard, under the row lock. A replay
  -- returned above never reaches this — its fee was already charged.
  if coalesce(_entry_fee, 0) > 0 and p.credits < _entry_fee then
    raise exception 'Insufficient credits for boss entry fee';
  end if;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, greatest(_xp, 0));
  next_level := (xp_state ->> 'player_level')::integer;
  next_xp := (xp_state ->> 'player_xp')::bigint;

  next_consumables := coalesce(p.consumables, '{}'::jsonb);
  for con_key, con_val in select key, value::integer from jsonb_each_text(coalesce(_consumables, '{}'::jsonb)) loop
    current_count := coalesce((next_consumables ->> con_key)::integer, 0);
    if current_count < con_val then raise exception 'Insufficient consumable quantity for %', con_key; end if;

    if not exists (select 1 from public.consumable_batches where owner_user_id = _player_id and consumable_type = con_key and quantity > 0) then
      perform public.cc_add_consumable_batch(_player_id, con_key, current_count, 100, 'vendor', null, null, 'admin_adjust', 'Backfilled legacy count into 100% batch before boss consumption', '{}'::jsonb);
    end if;

    consumed_one := public.cc_consume_consumable_batch(_player_id, con_key, con_val, 'boss', 'Boss attempt consumption', jsonb_build_object('boss_id', _boss_id, 'attempt_nonce', _attempt_nonce));
    consumed_batches := consumed_batches || jsonb_build_array(consumed_one);
    next_consumables := jsonb_set(next_consumables, array[con_key], to_jsonb(greatest(current_count - con_val, 0)), true);
  end loop;

  boss_state_next := coalesce(p.boss_state, '{}'::jsonb);
  defeated_ids := coalesce(boss_state_next -> 'defeatedBossIds', '[]'::jsonb);
  unlocked_ids := coalesce(boss_state_next -> 'unlockedBossIds', '["dune_tyrant"]'::jsonb);
  pity_counters := coalesce(boss_state_next -> 'pityCounters', '{}'::jsonb);
  current_pity := coalesce((pity_counters ->> _boss_id)::integer, 0);

  if _victory then
    if not defeated_ids ? _boss_id then defeated_ids := defeated_ids || to_jsonb(_boss_id); end if;
    if _unlocked_boss_id is not null and not unlocked_ids ? _unlocked_boss_id then unlocked_ids := unlocked_ids || to_jsonb(_unlocked_boss_id); end if;
    pity_counters := jsonb_set(pity_counters, array[_boss_id], '0'::jsonb, true);
  else
    pity_counters := jsonb_set(pity_counters, array[_boss_id], to_jsonb(current_pity + 1), true);
  end if;

  boss_state_next := boss_state_next || jsonb_build_object('defeatedBossIds', defeated_ids, 'unlockedBossIds', unlocked_ids, 'pityCounters', pity_counters, 'lastBossAttempt', _attempt);

  update public.profiles
     set credits = greatest(0, credits + _credits_delta),
         scrap = scrap + coalesce(_scrap_delta, 0),
         player_level = next_level,
         player_xp = next_xp,
         consumables = next_consumables,
         boss_state = boss_state_next,
         updated_at = now()
   where id = _player_id
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_apply_boss_attempt',
    'profile', public.cc_profile_snapshot(p),
    'boss_id', _boss_id,
    'attempt', _attempt,
    'consumed_batches', consumed_batches,
    'scrap_awarded', coalesce(_scrap_delta, 0),
    'entry_fee', coalesce(_entry_fee, 0)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_boss_attempt', nonce_key, result);

  return result;
end;
$$;
