create or replace function public.cc_consumable_quality_bounds(item_key text)
returns table(craft_min numeric, craft_max numeric)
language sql
immutable
set search_path = public
as $$
  select craft_min, craft_max from (values
    ('MedKit', 75::numeric, 125::numeric),
    ('MedKitRefined', 80::numeric, 140::numeric),
    ('ShieldCell', 75::numeric, 130::numeric),
    ('NanoSwarm', 80::numeric, 145::numeric),
    ('AdrenalineShot', 75::numeric, 150::numeric),
    ('AmmoPack', 70::numeric, 125::numeric),
    ('HighCapacityAmmoPack', 75::numeric, 140::numeric),
    ('ArmorPiercingAmmo', 75::numeric, 135::numeric),
    ('IncendiaryAmmo', 75::numeric, 140::numeric),
    ('ShockAmmo', 75::numeric, 140::numeric),
    ('CorrosiveAmmo', 75::numeric, 140::numeric),
    ('CryoAmmo', 75::numeric, 140::numeric),
    ('VoidAmmo', 70::numeric, 155::numeric),
    ('OrdnanceCharge', 75::numeric, 145::numeric),
    ('EMPCharge', 75::numeric, 145::numeric),
    ('CorrosiveCharge', 75::numeric, 145::numeric),
    ('OverchargeStim', 70::numeric, 150::numeric),
    ('TargetPainter', 75::numeric, 145::numeric),
    ('PhaseShiftGrenade', 75::numeric, 155::numeric),
    ('LuckBooster', 75::numeric, 135::numeric),
    ('BossScanner', 80::numeric, 160::numeric),
    ('InsuranceToken', 80::numeric, 145::numeric),
    ('DataSkimmer', 75::numeric, 150::numeric),
    ('Jammer', 75::numeric, 150::numeric),
    ('MagnetizedPayload', 75::numeric, 150::numeric),
    ('SignalScrambler', 75::numeric, 145::numeric),
    ('LootBeacon', 70::numeric, 150::numeric),
    ('SalvageContract', 75::numeric, 150::numeric),
    ('WorkshopRushTicket', 75::numeric, 150::numeric)
  ) as bounds(consumable_type, craft_min, craft_max)
  where consumable_type = item_key;
$$;

revoke execute on function public.cc_consumable_quality_bounds(text) from public, anon;
grant execute on function public.cc_consumable_quality_bounds(text) to authenticated, service_role;

create or replace function public.cc_consumable_recipe_materials(recipe_id text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case recipe_id
    when 'recipe_medkit' then '{"ScrapAlloy":15,"ReactiveComponents":8}'::jsonb
    when 'recipe_medkit_refined' then '{"ScrapAlloy":25,"ReactiveComponents":15,"VoidDust":1}'::jsonb
    when 'recipe_shieldcell' then '{"ScrapAlloy":20,"ReactiveComponents":12}'::jsonb
    when 'recipe_nanoswarm' then '{"ScrapAlloy":30,"ReactiveComponents":20,"VoidDust":2}'::jsonb
    when 'recipe_adrenaline' then '{"ScrapAlloy":40,"ReactiveComponents":25,"VoidDust":3}'::jsonb
    when 'recipe_ammo_pack' then '{"ScrapAlloy":10,"BallisticParts":6}'::jsonb
    when 'recipe_high_capacity_ammo_pack' then '{"ScrapAlloy":18,"BallisticParts":12,"TechFragments":2}'::jsonb
    when 'recipe_ap_ammo' then '{"ScrapAlloy":15,"BallisticParts":10}'::jsonb
    when 'recipe_fire_ammo' then '{"ScrapAlloy":15,"BallisticParts":8,"IgnitionFluid":3}'::jsonb
    when 'recipe_shock_ammo' then '{"ScrapAlloy":15,"BallisticParts":8,"ConduitWire":3}'::jsonb
    when 'recipe_corrosive_ammo' then '{"ScrapAlloy":15,"BallisticParts":8,"AcidCompound":3}'::jsonb
    when 'recipe_cryo_ammo' then '{"ScrapAlloy":15,"BallisticParts":8,"CryoGel":3}'::jsonb
    when 'recipe_void_ammo' then '{"ScrapAlloy":20,"BallisticParts":10,"VoidEssence":5}'::jsonb
    when 'recipe_ordnance' then '{"ScrapAlloy":12,"BallisticParts":10}'::jsonb
    when 'recipe_emp_charge' then '{"ScrapAlloy":18,"BallisticParts":8,"ConduitWire":4,"TechFragments":2}'::jsonb
    when 'recipe_corrosive_charge' then '{"ScrapAlloy":18,"BallisticParts":8,"AcidCompound":4,"TechFragments":2}'::jsonb
    when 'recipe_overcharge' then '{"ScrapAlloy":25,"BallisticParts":15,"VoidDust":2}'::jsonb
    when 'recipe_targetpainter' then '{"ScrapAlloy":20,"BallisticParts":10,"TechFragments":2}'::jsonb
    when 'recipe_phaseshift' then '{"ScrapAlloy":30,"BallisticParts":15,"VoidDust":5}'::jsonb
    when 'recipe_luck' then '{"ScrapAlloy":15,"TechFragments":8}'::jsonb
    when 'recipe_scanner' then '{"ScrapAlloy":20,"TechFragments":12}'::jsonb
    when 'recipe_insurance' then '{"ScrapAlloy":30,"TechFragments":15,"VoidDust":2}'::jsonb
    when 'recipe_dataskimmer' then '{"ScrapAlloy":25,"TechFragments":15,"VoidDust":3}'::jsonb
    when 'recipe_jammer' then '{"ScrapAlloy":20,"TechFragments":10,"ConduitWire":2}'::jsonb
    when 'recipe_magnetized' then '{"ScrapAlloy":15,"BallisticParts":10,"TechFragments":5}'::jsonb
    when 'recipe_signal_scrambler' then '{"ScrapAlloy":15,"TechFragments":10,"ConduitWire":2}'::jsonb
    when 'recipe_loot_beacon' then '{"ScrapAlloy":20,"TechFragments":14,"VoidDust":2}'::jsonb
    when 'recipe_salvage_contract' then '{"ScrapAlloy":12,"TechFragments":8}'::jsonb
    when 'recipe_workshop_rush_ticket' then '{"ScrapAlloy":18,"TechFragments":12,"VoidDust":1}'::jsonb
    else null
  end;
$$;

revoke execute on function public.cc_consumable_recipe_materials(text) from public, anon;
grant execute on function public.cc_consumable_recipe_materials(text) to authenticated, service_role;

create or replace function public.cc_claim_crafted_consumable(nonce text, recipe_id text, item_key text, quantity integer default 1)
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
  qty integer := greatest(1, coalesce(quantity, 1));
  mats jsonb;
  mat_key text;
  mat_required integer;
  current_amount integer;
  materials_next jsonb;
  essences_next jsonb;
  qmin numeric;
  qmax numeric;
  mastery_level integer;
  rolled_quality numeric;
  batch_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if recipe_id is null or item_key is null then raise exception 'recipe_id and item_key are required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  mats := public.cc_consumable_recipe_materials(recipe_id);
  if mats is null then raise exception 'Unknown consumable recipe'; end if;

  select craft_min, craft_max into qmin, qmax from public.cc_consumable_quality_bounds(item_key);
  if qmin is null or qmax is null then raise exception 'Unknown craftable consumable'; end if;

  materials_next := coalesce(p.materials, '{}'::jsonb);
  essences_next := coalesce(p.essences, '{}'::jsonb);

  for mat_key, mat_required in select key, value::integer from jsonb_each_text(mats) loop
    if mat_key in ('ScrapAlloy', 'BallisticParts', 'ReactiveComponents', 'TechFragments', 'VoidDust') then
      current_amount := coalesce((materials_next ->> mat_key)::integer, 0);
      if current_amount < mat_required then raise exception 'Insufficient material %', mat_key; end if;
      materials_next := jsonb_set(materials_next, array[mat_key], to_jsonb(current_amount - mat_required), true);
    else
      current_amount := coalesce((essences_next ->> mat_key)::integer, 0);
      if current_amount < mat_required then raise exception 'Insufficient essence %', mat_key; end if;
      essences_next := jsonb_set(essences_next, array[mat_key], to_jsonb(current_amount - mat_required), true);
    end if;
  end loop;

  select coalesce(max(mastery_level), 1) into mastery_level
  from public.player_masteries
  where user_id = actor and mastery_id in ('crafting_consumables', 'workshop_consumables', 'consumable_crafting');

  qmin := least(qmax, qmin + least(20, greatest(0, mastery_level - 1) * 1.5));
  qmax := least(175, qmax + least(25, greatest(0, mastery_level - 1) * 2));
  rolled_quality := round((qmin + random() * greatest(0, qmax - qmin))::numeric, 2);

  update public.profiles
     set materials = materials_next,
         essences = essences_next,
         consumables = public.cc_jsonb_add_int(consumables, item_key, qty),
         updated_at = now()
   where id = actor
   returning * into p;

  batch_id := public.cc_add_consumable_batch(
    actor,
    item_key,
    qty,
    rolled_quality,
    'crafted',
    actor,
    recipe_id,
    'crafted',
    'Crafted consumable quality roll',
    jsonb_build_object('recipe_id', recipe_id, 'mastery_level', mastery_level, 'quality_min', qmin, 'quality_max', qmax)
  );

  insert into public.player_stat_counters(user_id, stat_key, stat_value, updated_at)
  values (actor, 'consumables_crafted', qty, now())
  on conflict (user_id, stat_key) do update
    set stat_value = public.player_stat_counters.stat_value + excluded.stat_value,
        updated_at = now();

  insert into public.player_masteries(user_id, mastery_id, mastery_xp, mastery_level, updated_at)
  values (actor, 'crafting_consumables', qty * 10, 1, now())
  on conflict (user_id, mastery_id) do update
    set mastery_xp = public.player_masteries.mastery_xp + excluded.mastery_xp,
        mastery_level = greatest(1, floor(sqrt((public.player_masteries.mastery_xp + excluded.mastery_xp)::numeric / 100))::integer + 1),
        updated_at = now();

  result := jsonb_build_object(
    'action_type', 'cc_claim_crafted_consumable',
    'profile', public.cc_profile_snapshot(p),
    'recipe_id', recipe_id,
    'item_key', item_key,
    'quantity', qty,
    'quality_percent', rolled_quality,
    'batch_id', batch_id
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_claim_crafted_consumable', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_claim_crafted_consumable(text, text, text, integer) from public, anon;
grant execute on function public.cc_claim_crafted_consumable(text, text, text, integer) to authenticated, service_role;

create or replace function public.cc_consume_consumable(nonce text, item_key text, quantity integer default 1, activity_type text default null, reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  p public.profiles%rowtype;
  qty integer := greatest(1, coalesce(quantity, 1));
  current_count integer;
  consumed jsonb;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  current_count := coalesce((coalesce(p.consumables, '{}'::jsonb) ->> item_key)::integer, 0);
  if current_count < qty then raise exception 'Insufficient consumable quantity for %', item_key; end if;

  if not exists (select 1 from public.consumable_batches where owner_user_id = actor and consumable_type = item_key and quantity > 0) then
    perform public.cc_add_consumable_batch(actor, item_key, current_count, 100, 'vendor', null, null, 'admin_adjust', 'Backfilled legacy count into 100% batch before consumption', '{}'::jsonb);
  end if;

  consumed := public.cc_consume_consumable_batch(actor, item_key, qty, activity_type, reason, '{}'::jsonb);

  update public.profiles
     set consumables = jsonb_set(coalesce(consumables, '{}'::jsonb), array[item_key], to_jsonb(greatest(current_count - qty, 0)), true),
         updated_at = now()
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_consume_consumable',
    'profile', public.cc_profile_snapshot(p),
    'item_key', item_key,
    'quantity', qty,
    'consumed_batches', consumed
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_consume_consumable', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_consume_consumable(text, text, integer, text, text) from public, anon;
grant execute on function public.cc_consume_consumable(text, text, integer, text, text) to authenticated, service_role;

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
  current_count integer;
  consumed_batches jsonb := '[]'::jsonb;
  consumed_one jsonb;
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
  for con_key, con_val in select key, value::integer from jsonb_each_text(coalesce(_consumables, '{}'::jsonb)) loop
    current_count := coalesce((next_consumables ->> con_key)::integer, 0);
    if current_count < con_val then raise exception 'Insufficient consumable quantity for %', con_key; end if;

    if not exists (select 1 from public.consumable_batches where owner_user_id = _player_id and consumable_type = con_key and quantity > 0) then
      perform public.cc_add_consumable_batch(_player_id, con_key, current_count, 100, 'vendor', null, null, 'admin_adjust', 'Backfilled legacy count into 100% batch before boss consumption', '{}'::jsonb);
    end if;

    consumed_one := public.cc_consume_consumable_batch(_player_id, con_key, con_val, 'boss', 'Boss attempt consumption', jsonb_build_object('boss_id', _boss_id, 'attempt_nonce', _attempt_nonce));
    consumed_batches := consumed_batches || jsonb_build_array(consumed_one);
    next_consumables := jsonb_set(next_consumables, array[con_key], to_jsonb(greatest(current_count - con_val, 0)), true);
  end loop;

  boss_state_next := coalesce(p.boss_state, '{}'::jsonb);
  defeated_ids := coalesce(boss_state_next -> 'defeatedBossIds', '[]'::jsonb);
  unlocked_ids := coalesce(boss_state_next -> 'unlockedBossIds', '["dune_tyrant"]'::jsonb);
  pity_counters := coalesce(boss_state_next -> 'pityCounters', '{}'::jsonb);
  current_pity := coalesce((pity_counters ->> _boss_id)::integer, 0);

  if _victory then
    if not defeated_ids ? _boss_id then defeated_ids := defeated_ids || to_jsonb(_boss_id); end if;
    if _unlocked_boss_id is not null and not unlocked_ids ? _unlocked_boss_id then unlocked_ids := unlocked_ids || to_jsonb(_unlocked_boss_id); end if;
    pity_counters := jsonb_set(pity_counters, array[_boss_id], '0'::jsonb, true);
  else
    pity_counters := jsonb_set(pity_counters, array[_boss_id], to_jsonb(current_pity + 1), true);
  end if;

  boss_state_next := boss_state_next || jsonb_build_object('defeatedBossIds', defeated_ids, 'unlockedBossIds', unlocked_ids, 'pityCounters', pity_counters, 'lastBossAttempt', _attempt);

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
    'attempt', _attempt,
    'consumed_batches', consumed_batches
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_boss_attempt', nonce_key, result);

  return result;
end;
$$;

revoke execute on function public.cc_apply_chef_boss_attempt(uuid, text, bigint, boolean, bigint, bigint, jsonb, jsonb, text) from public, anon;
grant execute on function public.cc_apply_chef_boss_attempt(uuid, text, bigint, boolean, bigint, bigint, jsonb, jsonb, text) to service_role;
