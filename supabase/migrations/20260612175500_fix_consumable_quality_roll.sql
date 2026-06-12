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
  rolled_quality := round((qmin + (random()::numeric * greatest(0, qmax - qmin)))::numeric, 2);

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
