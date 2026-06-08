create or replace function public.cc_idle_claim(nonce text)
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
  xp_award bigint;
  credit_award bigint;
  xp_state jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  xp_award := floor(least(7200, greatest(0, extract(epoch from (now() - p.last_idle_claim_at)))) / 60)::bigint;
  credit_award := xp_award * 10;
  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, xp_award);

  update public.profiles
  set last_idle_claim_at = now(),
      player_level = (xp_state ->> 'player_level')::integer,
      player_xp = (xp_state ->> 'player_xp')::bigint,
      credits = credits + credit_award
  where id = actor
  returning * into p;

  result := jsonb_build_object('action_type', 'cc_idle_claim', 'profile', public.cc_profile_snapshot(p), 'rewards', jsonb_build_object('xp', xp_award, 'credits', credit_award));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_idle_claim', nonce, result);
  return result;
end;
$$;

revoke execute on function public.cc_idle_claim(text) from public, anon;
grant execute on function public.cc_idle_claim(text) to authenticated, service_role;
