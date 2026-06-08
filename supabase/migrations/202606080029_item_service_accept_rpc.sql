create or replace function public.cc_item_service_accept(nonce text, job_id uuid, price_credits bigint, duration_minutes integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  job public.service_jobs%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;
  if price_credits < 0 then raise exception 'Invalid price'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  select * into job from public.service_jobs where id = job_id for update;
  if not found or job.status <> 'listed' then raise exception 'Service job not available'; end if;
  if job.owner_user_id = actor then raise exception 'Cannot accept own job'; end if;

  update public.service_jobs
  set provider_user_id = actor,
      status = 'accepted',
      quoted_price_credits = price_credits,
      quoted_duration_minutes = duration_minutes,
      accepted_at = now()
  where id = job.id
  returning * into job;

  result := jsonb_build_object('action_type', 'cc_item_service_accept', 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_item_service_accept', nonce, result);
  return result;
end;
$$;

revoke execute on function public.cc_item_service_accept(text, uuid, bigint, integer) from public, anon;
grant execute on function public.cc_item_service_accept(text, uuid, bigint, integer) to authenticated, service_role;
