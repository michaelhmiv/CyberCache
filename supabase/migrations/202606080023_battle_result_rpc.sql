create or replace function public.cc_battle_result(nonce text, target_id text, stance text default 'balanced')
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
  draw jsonb;
  xp_award bigint;
  credit_award bigint;
  part_award integer;
  xp_state jsonb;
  next_parts integer;
  next_tokens integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if target_id is null or target_id = '' then raise exception 'target_id is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  if stance = 'aggressive' then draw := public.cc_draw_odds('boss_attempt_aggressive');
  elsif stance = 'defensive' then draw := public.cc_draw_odds('boss_attempt_defensive');
  else draw := public.cc_draw_odds('boss_attempt_balanced');
  end if;

  xp_award := greatest(1, round(greatest(10, p.player_level * 15) * ((draw -> 'payload' ->> 'xp_mult')::numeric))::bigint);
  credit_award := greatest(0, round(greatest(50, p.player_level * 25) * ((draw -> 'payload' ->> 'credit_mult')::numeric))::bigint);
  part_award := greatest(0, coalesce((draw -> 'payload' ->> 'fragment_reward')::integer, 0));
  next_parts := p.cache_token_parts + part_award;
  next_tokens := p.cache_tokens;
  while next_parts >= 5 loop next_parts := next_parts - 5; next_tokens := next_tokens + 1; end loop;
  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, xp_award);

  update public.profiles
  set player_level = (xp_state ->> 'player_level')::integer,
      player_xp = (xp_state ->> 'player_xp')::bigint,
      credits = credits + credit_award,
      cache_tokens = next_tokens,
      cache_token_parts = next_parts,
      boss_state = coalesce(boss_state, '{}'::jsonb) || jsonb_build_object('last_target_id', target_id, 'last_draw', draw)
  where id = actor
  returning * into p;

  result := jsonb_build_object('action_type', 'cc_battle_result', 'profile', public.cc_profile_snapshot(p), 'target_id', target_id, 'stance', stance, 'draw', draw, 'rewards', jsonb_build_object('xp', xp_award, 'credits', credit_award, 'parts', part_award));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_battle_result', nonce, result);
  return result;
end;
$$;

revoke execute on function public.cc_battle_result(text, text, text) from public, anon;
grant execute on function public.cc_battle_result(text, text, text) to authenticated, service_role;
