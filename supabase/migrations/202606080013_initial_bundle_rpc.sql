create or replace function public.cc_initial_bundle(nonce text)
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

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if coalesce(p.boss_state ->> 'initial_bundle_claimed', 'false') = 'true' then raise exception 'Initial bundle already claimed'; end if;

  update public.profiles
  set credits = credits + 5000,
      scrap = scrap + 500,
      cache_tokens = cache_tokens + 3,
      boss_state = jsonb_set(coalesce(boss_state, '{}'::jsonb), '{initial_bundle_claimed}', 'true'::jsonb, true)
  where id = actor
  returning * into p;

  result := jsonb_build_object('action_type', 'cc_initial_bundle', 'profile', public.cc_profile_snapshot(p));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_initial_bundle', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_initial_bundle(text) from public, anon;
grant execute on function public.cc_initial_bundle(text) to authenticated, service_role;
