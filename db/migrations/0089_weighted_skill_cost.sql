-- 0089 — Weighted skill costs (audit HTR-01).
--
-- Node definitions have always carried a price — small 1 / major 3 /
-- keystone 5 (skill_node_definitions.per_point_cost, seeded in 0004) —
-- and the design law prices trees at 303 budget points against the
-- 99-point lifetime budget (MECHANICS.md). But cc_train_skill debited a
-- flat 1 per train and cc_retrain priced the raw point count, so full
-- trees cost 255 instead of 303 and a keystone was reachable at level
-- 10 instead of 21. This migration charges the listed cost in both
-- functions, via the new cc_skill_spend_cost helper.
--
-- NO RETRO-CHARGE: stored profiles.skill_spends are untouched and no
-- credits are clawed back. Existing spends keep the points they trained;
-- the weighted accounting applies to the budget gate and the respec
-- price from this migration forward, exactly as the client and the
-- in-memory Chef twin now compute it (skillSpendCost).

CREATE OR REPLACE FUNCTION public.cc_skill_spend_cost(skill_state jsonb)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(sum((e.value)::integer * coalesce(d.per_point_cost, 1)), 0)::integer
    from jsonb_each_text(coalesce(skill_state, '{}'::jsonb)) as e(key, value)
    left join public.skill_node_definitions d on d.id = e.key;
$function$;

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

  cost := public.cc_skill_spend_cost(p.skill_spends) * 100;
  if p.credits < cost then raise exception 'Insufficient credits'; end if;

  update public.profiles set credits = credits - cost, skill_spends = '{}'::jsonb where id = actor returning * into p;

  result := jsonb_build_object('action_type', 'cc_retrain', 'profile', public.cc_profile_snapshot(p), 'total_price', cost);
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_retrain', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_train_skill(p_player_id uuid, nonce text, node_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  node public.skill_node_definitions%rowtype;
  next_spends jsonb;
  current_node_points integer;
  next_node_points integer;
  total_after integer;
  budget integer;
  result jsonb;
  clean_node_id text := nullif(trim(coalesce(node_id, '')), '');
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if clean_node_id is null then raise exception 'node_id is required'; end if;

  -- Idempotency: a retry with the same nonce returns the prior payload.
  select result_payload into prior
    from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  -- Serialize per-actor mutations to avoid races on skill_spends.
  perform pg_advisory_xact_lock(hashtext(actor::text));

  -- Lock the profile row + look up the node definition in one shot.
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into node from public.skill_node_definitions where id = clean_node_id;
  if not found then raise exception 'Unknown skill node'; end if;

  -- Per-node cap: cannot exceed the node's own max_points.
  current_node_points := coalesce((p.skill_spends ->> clean_node_id)::integer, 0);
  if current_node_points >= node.max_points then
    raise exception 'Skill node % is already maxed', clean_node_id;
  end if;
  next_node_points := current_node_points + 1;

  -- Prerequisite chain: every requires[] entry must have at least 1 point.
  declare
    missing text[];
  begin
    select array_agg(req) into missing
      from unnest(node.requires) as req
     where coalesce((p.skill_spends ->> req)::integer, 0) = 0;
    if missing is not null and array_length(missing, 1) > 0 then
      raise exception 'Missing prerequisites: %', array_to_string(missing, ', ');
    end if;
  end;

  -- Total budget: total points spent must remain <= player_level - 1.
  -- (Mirrors SkillTreeScreen.pointsEarned = max(0, player.level - 1).)
  total_after := public.cc_skill_spend_cost(p.skill_spends) + node.per_point_cost;
  budget := greatest(0, p.player_level - 1);
  if total_after > budget then
    raise exception 'Insufficient skill points: have %, need %', budget, total_after;
  end if;

  -- Apply the increment. jsonb_set with create_missing=true handles the
  -- first-ever spend on a node cleanly.
  next_spends := jsonb_set(
    p.skill_spends,
    array[clean_node_id],
    to_jsonb(next_node_points),
    true
  );

  update public.profiles
     set skill_spends = next_spends
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_train_skill',
    'profile', public.cc_profile_snapshot(p),
    'node_id', clean_node_id,
    'node_points', next_node_points,
    'total_spent', public.cc_skill_spend_cost(p.skill_spends)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_train_skill', nonce, result);
  return result;
end;
$function$;
