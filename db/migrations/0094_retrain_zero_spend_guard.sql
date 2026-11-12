-- 0094 — cc_retrain refuses a zero-spend respec (audit HTR-07).
--
-- A retrain with nothing spent used to succeed at 0cr and write a
-- verified_action_ledger record (and its mastery/stat side effects)
-- for a no-op. This restates cc_retrain from its CURRENT definition
-- in migration 0089 (the weighted-cost restatement, PR #503) with
-- exactly one change — the zero-spend refusal after the profile
-- load. DEPENDENCY: apply only after 0089; this body calls
-- cc_skill_spend_cost, which 0089 creates. The in-memory twin
-- (MemoryJobStore.retrain) carries the same guard.
--

CREATE OR REPLACE FUNCTION public.cc_retrain(p_player_id uuid, nonce text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
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

  -- Zero-spend guard (audit HTR-07): refuse before the ledger write
  -- so a no-op retrain records nothing. Point count is the
  -- predicate: zero points spent means zero weighted cost.
  if public.cc_skill_spend_total(p.skill_spends) = 0 then raise exception 'Nothing to respec'; end if;

  cost := public.cc_skill_spend_cost(p.skill_spends) * 100;
  if p.credits < cost then raise exception 'Insufficient credits'; end if;

  update public.profiles set credits = credits - cost, skill_spends = '{}'::jsonb where id = actor returning * into p;

  result := jsonb_build_object('action_type', 'cc_retrain', 'profile', public.cc_profile_snapshot(p), 'total_price', cost);
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_retrain', nonce, result);
  return result;
end;
$function$;
