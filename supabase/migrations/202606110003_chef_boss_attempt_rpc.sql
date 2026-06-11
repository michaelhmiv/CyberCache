-- Migration 202606110003: Chef-authoritative boss attempt application
--
-- The browser may request a boss attempt, but only the Chef server rolls the
-- outcome and calls this RPC. This function applies the already-computed
-- canonical result to progression state without re-simulating combat in SQL.

create or replace function public.cc_apply_chef_boss_attempt(
  _player_id uuid,
  _boss_id text,
  _attempt_nonce bigint,
  _victory boolean,
  _credits_delta bigint,
  _xp bigint,
  _consumables jsonb,
  _attempt jsonb,
  _unlocked_boss_id text default null
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
  if prior is not null then return prior; end if;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, greatest(_xp, 0));
  next_level := (xp_state ->> 'player_level')::integer;
  next_xp := (xp_state ->> 'player_xp')::bigint;

  next_consumables := coalesce(p.consumables, '{}'::jsonb);
  for con_key, con_val in select * from jsonb_each(coalesce(_consumables, '{}'::jsonb)) loop
    next_consumables := jsonb_set(
      next_consumables,
      array[con_key],
      to_jsonb(greatest(coalesce((next_consumables ->> con_key)::integer, 0) - con_val, 0)),
      true
    );
  end loop;

  boss_state_next := coalesce(p.boss_state, '{}'::jsonb);
  defeated_ids := coalesce(boss_state_next -> 'defeatedBossIds', '[]'::jsonb);
  unlocked_ids := coalesce(boss_state_next -> 'unlockedBossIds', '["dune_tyrant"]'::jsonb);
  pity_counters := coalesce(boss_state_next -> 'pityCounters', '{}'::jsonb);
  current_pity := coalesce((pity_counters ->> _boss_id)::integer, 0);

  if _victory then
    if not defeated_ids ? _boss_id then
      defeated_ids := defeated_ids || to_jsonb(_boss_id);
    end if;
    if _unlocked_boss_id is not null and not unlocked_ids ? _unlocked_boss_id then
      unlocked_ids := unlocked_ids || to_jsonb(_unlocked_boss_id);
    end if;
    pity_counters := jsonb_set(pity_counters, array[_boss_id], '0'::jsonb, true);
  else
    pity_counters := jsonb_set(pity_counters, array[_boss_id], to_jsonb(current_pity + 1), true);
  end if;

  boss_state_next :=
    boss_state_next ||
    jsonb_build_object(
      'defeatedBossIds', defeated_ids,
      'unlockedBossIds', unlocked_ids,
      'pityCounters', pity_counters,
      'lastBossAttempt', _attempt
    );

  update public.profiles
     set credits = greatest(0, credits + _credits_delta),
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
    'attempt', _attempt
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_boss_attempt', nonce_key, result);

  return result;
end;
$$;

revoke execute on function public.cc_apply_chef_boss_attempt(uuid, text, bigint, boolean, bigint, bigint, jsonb, jsonb, text) from public, anon;
grant execute on function public.cc_apply_chef_boss_attempt(uuid, text, bigint, boolean, bigint, bigint, jsonb, jsonb, text) to service_role;
