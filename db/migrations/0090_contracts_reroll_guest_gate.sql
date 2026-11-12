-- 0090 — Contracts reroll carries the verified-account gate (audit A-03).
--
-- cc_claim_contract has refused guests since 0042, but cc_reroll_contract
-- never got the gate: a guest could burn the board's free reroll and then
-- spend real scrap rerolling contracts whose rewards are hard-locked to
-- verified accounts. This re-creates cc_reroll_contract from its current
-- definition (0069) with exactly one change — the claim's guest gate,
-- verbatim, in the same position. The in-memory twin
-- (src/server/gameplay/memory.ts rerollContract) mirrors it.
--

create or replace function public.cc_reroll_contract(
  p_player_id uuid,
  p_nonce text,
  p_instance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  inst public.contract_instances%rowtype;
  v_replay jsonb;
  v_progress jsonb;
  v_end timestamptz;
  v_used integer;
  v_cost bigint;
  v_free boolean;
  v_exclude text[];
  v_families text[];
  v_band_index integer;
  v_draw jsonb;
  v_terms jsonb;
  v_new_id uuid;
  v_seed text;
  v_result jsonb;
begin
  if p_player_id is null then raise exception 'Authentication required'; end if;
  if p_nonce is null or length(p_nonce) < 8 then raise exception 'A reroll nonce is required'; end if;

  perform pg_advisory_xact_lock(hashtext(p_player_id::text));

  select * into p from public.profiles where id = p_player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  select result_payload into v_replay from public.verified_action_ledger
   where user_id = p_player_id and idempotency_key = p_nonce
     and action_type = 'cc_reroll_contract';
  if v_replay is not null then return v_replay; end if;

  -- Audit A-03: reroll is transact-class (it consumes the free reroll,
  -- then charges scrap) — it carries the claim's verified-account gate
  -- (cc_claim_contract, 0042), in the same position: after the replay
  -- check, before any instance state is read or moved.
  if p.account_type = 'guest' then
    raise exception 'Contracts require a verified account — link Google sign-in to claim rewards';
  end if;

  select * into inst from public.contract_instances where id = p_instance_id and user_id = p_player_id;
  if not found then raise exception 'Contract not found'; end if;
  if inst.status = 'claimed' then raise exception 'Claimed contracts cannot be rerolled'; end if;
  if inst.status = 'rerolled' then raise exception 'Contract already rerolled'; end if;

  v_end := (inst.period_key || 'T00:00:00Z')::timestamptz
    + (case when inst.period_kind = 'daily' then interval '1 day' else interval '7 days' end);
  if now() >= v_end then raise exception 'Contract expired — the window has closed'; end if;

  v_progress := public.cc_contract_progress(p_instance_id);
  if coalesce((v_progress ->> 'complete')::boolean, false) then
    raise exception 'Contract complete — claim it or let it expire';
  end if;

  select count(*) into v_used from public.contract_instances
   where user_id = p_player_id and period_kind = inst.period_kind
     and period_key = inst.period_key and status = 'rerolled';
  v_free := v_used < 1;
  if v_free then
    v_cost := 0;
  elsif inst.period_kind = 'daily' then
    v_cost := greatest(0, least(1000,
      public.cc_economy_config_number('contractRerollScrapDaily', 100)))::bigint;
  else
    v_cost := greatest(0, least(5000,
      public.cc_economy_config_number('contractRerollScrapWeekly', 400)))::bigint;
  end if;
  if v_cost > 0 and coalesce((p.materials ->> 'Scrap')::bigint, 0) < v_cost then
    raise exception 'Insufficient scrap for a reroll';
  end if;

  -- The set as it stands (current generation per slot), templates
  -- excluded wholesale; the family cap counts the OTHER members.
  select coalesce(array_agg(cur.template_id), '{}'::text[]),
         coalesce(array_agg(d.family) filter (where cur.slot <> inst.slot), '{}'::text[])
    into v_exclude, v_families
    from public.contract_instances cur
    join public.contract_template_definitions d on d.template_id = cur.template_id
   where cur.user_id = p_player_id
     and cur.period_kind = inst.period_kind
     and cur.period_key = inst.period_key
     and cur.generation = (
       select max(g.generation) from public.contract_instances g
        where g.user_id = cur.user_id and g.period_kind = cur.period_kind
          and g.period_key = cur.period_key and g.slot = cur.slot);

  select band_index into v_band_index from public.contract_bands where band_id = inst.band;

  v_seed := 'contracts:reroll:' || inst.period_kind || ':' || inst.period_key || ':'
    || p_player_id::text || ':' || inst.slot::text || ':' || (inst.generation + 1)::text;
  v_draw := public.cc_contract_draw_reroll(v_seed, inst.period_kind, v_band_index, v_exclude, v_families);
  if v_draw is null then raise exception 'No replacement contract available on this board'; end if;

  v_terms := public.cc_contract_terms(p_player_id, v_draw ->> 'template_id', inst.period_kind, v_band_index);

  if v_cost > 0 then
    update public.profiles set materials = public.cc_jsonb_add_int(materials, 'Scrap', -v_cost::integer), updated_at = now() where id = p_player_id;
  end if;

  update public.contract_instances set status = 'rerolled' where id = p_instance_id;

  insert into public.contract_instances (
    user_id, period_kind, period_key, slot, generation, template_id, band,
    params, baseline, target, reward, status
  ) values (
    p_player_id, inst.period_kind, inst.period_key, inst.slot, inst.generation + 1,
    v_draw ->> 'template_id', inst.band, coalesce(v_draw -> 'params', '{}'::jsonb),
    v_terms -> 'baseline', (v_terms ->> 'target')::integer, v_terms -> 'reward', 'active'
  ) returning id into v_new_id;

  select * into p from public.profiles where id = p_player_id;

  v_result := jsonb_build_object(
    'action_type', 'cc_reroll_contract',
    'instance_id', v_new_id,
    'replaced_instance_id', inst.id,
    'template_id', v_draw ->> 'template_id',
    'period_kind', inst.period_kind,
    'period_key', inst.period_key,
    'scrap_charged', v_cost,
    'free_reroll', v_free,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger (user_id, action_type, idempotency_key, result_payload)
  values (p_player_id, 'cc_reroll_contract', p_nonce, v_result);

  return v_result;
end;
$$;
