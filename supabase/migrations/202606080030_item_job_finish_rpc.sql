create or replace function public.cc_item_job_finish(nonce text, job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  owner_profile public.profiles%rowtype;
  provider_profile public.profiles%rowtype;
  job public.service_jobs%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
  price bigint;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  select * into job from public.service_jobs where id = job_id for update;
  if not found or job.provider_user_id <> actor then raise exception 'Job not found'; end if;
  if job.status <> 'accepted' then raise exception 'Job state invalid'; end if;

  price := coalesce(job.quoted_price_credits, 0);
  select * into owner_profile from public.profiles where id = job.owner_user_id for update;
  select * into provider_profile from public.profiles where id = actor for update;
  if owner_profile.credits < price then raise exception 'Insufficient credits'; end if;

  update public.profiles set credits = credits - price where id = job.owner_user_id returning * into owner_profile;
  update public.profiles set credits = credits + price where id = actor returning * into provider_profile;

  update public.item_instances
  set runtime_state = 'available', is_locked = false, condition_current = condition_max
  where id = job.target_item_instance_id
  returning * into item;

  update public.service_jobs set status = 'completed', completed_at = now() where id = job.id returning * into job;

  insert into public.player_professions(user_id, profession_id, xp, total_services_completed, reputation_score)
  values (actor, job.profession_id, 50, 1, 1)
  on conflict (user_id, profession_id) do update set
    xp = public.player_professions.xp + 50,
    total_services_completed = public.player_professions.total_services_completed + 1,
    reputation_score = public.player_professions.reputation_score + 1,
    updated_at = now();

  result := jsonb_build_object('action_type', 'cc_item_job_finish', 'profile', public.cc_profile_snapshot(provider_profile), 'owner_profile', public.cc_profile_snapshot(owner_profile), 'job', to_jsonb(job), 'item', to_jsonb(item), 'price_credits', price);
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_item_job_finish', nonce, result);
  return result;
end;
$$;

revoke execute on function public.cc_item_job_finish(text, uuid) from public, anon;
grant execute on function public.cc_item_job_finish(text, uuid) to authenticated, service_role;
