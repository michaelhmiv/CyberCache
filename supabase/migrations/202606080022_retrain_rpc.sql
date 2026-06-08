create or replace function public.cc_retrain(nonce text)
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
  cost bigint;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  cost := public.cc_skill_spend_total(p.skill_spends) * 100;
  if p.credits < cost then raise exception 'Insufficient credits'; end if;

  update public.profiles set credits = credits - cost, skill_spends = '{}'::jsonb where id = actor returning * into p;

  result := jsonb_build_object('action_type', 'cc_retrain', 'profile', public.cc_profile_snapshot(p), 'total_price', cost);
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_retrain', nonce, result);
  return result;
end;
$$;

revoke execute on function public.cc_retrain(text) from public, anon;
grant execute on function public.cc_retrain(text) to authenticated, service_role;
