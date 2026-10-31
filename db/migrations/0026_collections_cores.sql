-- =====================================================================
-- 0026 — Collections + Legendary Cores
-- =====================================================================
-- APPLY ORDER: apply this migration BEFORE merging the PR that ships
-- it (the standing drill). Every restated function stays callable
-- under its pre-0026 signature from the old server's perspective:
-- cc_enqueue_craft_job gains ONE trailing parameter with a default
-- (the old 9-argument call resolves to it), and all other restated
-- functions keep their exact signatures. New columns are additive
-- with defaults; new tables are new. Safe to apply ahead of deploy.
--
-- Contents:
--   1. profiles.legendary_cores — the sink-loop currency balance
--      (profile-level, like cache_token_parts / fragments).
--   2. collection_discoveries — the trophy record. One row per
--      (player, family, entry) PROVEN by a server-side fact.
--      Families: legendary_effect / boss / weapon_frame /
--      named_elite (catalog in src/content/collections.ts: 25
--      effects + 13 bosses + 36 frames + 7 elites = 81 entries).
--   3. cc_record_discoveries — the service RPC the Chef routes call
--      at the moment the underlying fact settles (item stored after
--      a claim / boss loot / offline settlement, cache forged,
--      market purchase delivered, boss victory applied, elite kill
--      recorded). Insert-on-conflict-do-nothing: replays and
--      re-derivations are no-ops. It records; it never pays.
--   4. cc_recycle_item restated (0022 body): salvaging a Legendary
--      ALSO mints legendary cores — 1 base, +1 at item level 25,
--      +1 at item level 50, +1 for a weapon carrying a legendary
--      effect (range 1-4). Mirrors legendaryCoreYieldFor in
--      src/content/collections.ts; the scrap multipliers (Market
--      Crash 4x, Hoarder's Haul, King of Scrap) deliberately do NOT
--      scale cores — they are scrap economy, cores stay scarce.
--   5. Legendary Core Catalyst (the in-slice core spend): gear-frame
--      craft jobs may escrow 1 legendary core per unit at enqueue
--      (craft_jobs.escrow_cores; job snapshot 'coreCatalyst'); each
--      completed unit generates with +2 draws (best-of-N rollQuality
--      — the gear system's quality currency, the same lever tempering
--      uses). Mutually exclusive with the material catalyst,
--      Forge-gated (bench 2+) like it, refunded on cancel on the
--      material catalyst's schedule. cc_enqueue_craft_job /
--      cc_craft_job_json / cc_settle_craft_jobs / cc_cancel_craft_job
--      restated accordingly.
--   6. Economy metrics gain legendaries_salvaged (a ledger fact —
--      the recycle result carries the consumed item),
--      legendary_cores_minted and legendary_cores_spent. Creation
--      meters (legendaries by source, from item_instances) are
--      untouched: minting and destruction stay separate meters, no
--      double counting.
--   7. Backfill (section at the end): discoveries are seeded ONLY
--      where a surviving server record proves them — items the
--      player currently owns, items in surviving verified-ledger
--      results (salvaged / market-bought / cache-forged),
--      profiles.boss_state.defeatedBossIds, and roaming.elite_kill
--      ledger rows. HONEST LIMIT: a legendary that was sold or
--      salvaged before its record survived (or whose only record
--      predates the ledger) starts UNDISCOVERED. History is never
--      faked.
-- =====================================================================

-- ─── 1. Schema ───────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists legendary_cores integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_legendary_cores_nonneg'
  ) then
    alter table public.profiles
      add constraint profiles_legendary_cores_nonneg check (legendary_cores >= 0);
  end if;
end $$;

alter table public.craft_jobs
  add column if not exists escrow_cores integer not null default 0;

alter table public.economy_metrics
  add column if not exists legendaries_salvaged integer not null default 0,
  add column if not exists legendary_cores_minted bigint not null default 0,
  add column if not exists legendary_cores_spent bigint not null default 0;

create table if not exists public.collection_discoveries (
  user_id uuid not null references public.profiles(id) on delete cascade,
  family text not null check (family in ('legendary_effect', 'boss', 'weapon_frame', 'named_elite')),
  entry_key text not null,
  source text not null,
  discovered_at timestamptz not null default now(),
  primary key (user_id, family, entry_key)
);

create index if not exists collection_discoveries_user_idx
  on public.collection_discoveries (user_id, family);

-- ─── 2. cc_record_discoveries — the discovery service RPC ────────────
-- Called by Chef routes AFTER the underlying server-side fact has
-- settled, with entries derived server-side from the settled records
-- (src/content/collections.ts). Never trusted from the client: the
-- route handlers build the entry list from Chef/store results, and
-- this function additionally validates family + key shape.

create or replace function public.cc_record_discoveries(
  p_player_id uuid,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  v_inserted integer := 0;
  e jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    return jsonb_build_object('recorded', 0);
  end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    if (e ->> 'family') in ('legendary_effect', 'boss', 'weapon_frame', 'named_elite')
       and coalesce(length(e ->> 'entry_key'), 0) between 1 and 128 then
      insert into public.collection_discoveries(user_id, family, entry_key, source)
      values (actor, e ->> 'family', e ->> 'entry_key',
              coalesce(nullif(e ->> 'source', ''), 'unknown'))
      on conflict (user_id, family, entry_key) do nothing;
      if found then v_inserted := v_inserted + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('recorded', v_inserted);
end;
$$;


-- ─── 3. cc_profile_snapshot restated (0021 body + legendary_cores) ───

CREATE OR REPLACE FUNCTION public.cc_apply_vehicle_usage(p_player_id uuid, item_id uuid, fuel_units numeric, condition_current numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  item public.item_instances%rowtype;
  new_fuel numeric;
begin
  if actor is null then raise exception 'Authentication required'; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor
     and runtime_state = 'equipped' and equipped_slot = 'vehicle'
   for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'vehicle_not_equipped');
  end if;

  update public.profiles
     set vehicle_fuel = greatest(0, coalesce(fuel_units, 0)), updated_at = now()
   where id = actor
   returning vehicle_fuel into new_fuel;

  update public.item_instances
     set condition_current = greatest(0, least(coalesce(condition_max, 100), coalesce(condition_current, 0))),
         updated_at = now()
   where id = item.id
   returning * into item;

  return jsonb_build_object(
    'applied', true,
    'vehicle_fuel', new_fuel,
    'condition_current', item.condition_current,
    'condition_max', item.condition_max
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5b. cc_profile_snapshot — 0004 body + vehicle_fuel.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_profile_snapshot(profile_row profiles)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', profile_row.id,
    'player_level', profile_row.player_level,
    'player_xp', profile_row.player_xp,
    'credits', profile_row.credits,
    'scrap', profile_row.scrap,
    'cache_tokens', profile_row.cache_tokens,
    'cache_token_parts', profile_row.cache_token_parts,
    'legendary_cores', coalesce(profile_row.legendary_cores, 0),
    'materials', profile_row.materials,
    'essences', profile_row.essences,
    'consumables', profile_row.consumables,
    'consumable_batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'consumable_type', b.consumable_type,
        'quality_percent', b.quality_percent,
        'quantity', b.quantity,
        'origin', b.origin,
        'creator_user_id', b.creator_user_id,
        'source_recipe_id', b.source_recipe_id,
        'metadata', b.metadata,
        'created_at', b.created_at,
        'updated_at', b.updated_at
      ) order by b.consumable_type, b.quality_percent desc, b.created_at)
      from public.consumable_batches b
      where b.owner_user_id = profile_row.id and b.quantity > 0
    ), '[]'::jsonb),
    'vehicle_fuel', profile_row.vehicle_fuel,
    'skill_spends', profile_row.skill_spends,
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at
  );
$function$;

-- ─── 4. cc_recycle_item restated (0022 body + legendary cores) ───

CREATE OR REPLACE FUNCTION public.cc_recycle_item(p_player_id uuid, nonce text, item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
  award integer;
  mod_payload jsonb;
  hoarder_pts numeric := 0;
  keystone_pts numeric := 0;
  salvage_bonus numeric := 0;
  low_rarity_bonus numeric := 0;
  material_chance numeric := 0;
  skill_mult numeric := 1;
  bonus_material text := null;
  cores integer := 0;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.is_locked then raise exception 'Locked item'; end if;
  if item.runtime_state not in ('available','equipped') then raise exception 'Item state invalid'; end if;

  select * into p from public.profiles where id = actor;

  -- Salvage skill bonuses (0022): effective points for the two
  -- Scavenger salvage nodes from the player's own records — the
  -- equipped gear whose payload carries treeBonus is the class mod
  -- (mirrors classModBoostsFromGear).
  select payload into mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  hoarder_pts := coalesce((p.skill_spends ->> 'scav_major_1')::numeric, 0)
               + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_major_1')::numeric, 0);
  keystone_pts := coalesce((p.skill_spends ->> 'scav_keystone')::numeric, 0)
                + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_keystone')::numeric, 0);
  if mod_payload ->> 'treeBonus' = 'Scavenger' then
    hoarder_pts := least(1::numeric, hoarder_pts + 1);
    keystone_pts := least(1::numeric, keystone_pts + 1);
  end if;
  salvage_bonus := 0.25 * hoarder_pts;
  low_rarity_bonus := 1.0 * keystone_pts;
  material_chance := 0.25 * keystone_pts;

  award := public.cc_salvage_scrap(item.rarity, item.item_level);

  -- Legendary Honesty (0008): Market Crash — this weapon's scrap value
  -- is 4x normal when recycled. The weapon payload is the full item
  -- JSON stored by cc_store_chef_items, which carries legendaryEffectId
  -- for Chef-generated (boss-drop) weapons.
  if item.payload ->> 'legendaryEffectId' = 'market_crash' then
    award := award * 4;
  end if;

  -- Skill multipliers stack on the post-legendary award, rounded
  -- once (cc_salvage_scrap's own rounding convention).
  skill_mult := (1 + salvage_bonus);
  if item.rarity in ('Common', 'Uncommon') then
    skill_mult := skill_mult * (1 + low_rarity_bonus);
  end if;
  award := round(award * skill_mult)::integer;

  -- Legendary cores (0026): salvaging a Legendary also mints cores.
  -- The formula mirrors legendaryCoreYieldFor in
  -- src/content/collections.ts (parity-tested): 1 base, +1 at item
  -- level 25, +1 at item level 50, +1 for a weapon carrying a
  -- legendary effect. Deliberately NOT scaled by the scrap
  -- multipliers above (Market Crash 4x, Hoarder's Haul, King of
  -- Scrap): those are scrap economy; cores stay scarce by design.
  if item.rarity = 'Legendary' then
    cores := 1
      + case when coalesce(item.item_level, 1) >= 25 then 1 else 0 end
      + case when coalesce(item.item_level, 1) >= 50 then 1 else 0 end
      + case when item.kind = 'weapon'
                  and nullif(item.payload ->> 'legendaryEffectId', '') is not null
             then 1 else 0 end;
  end if;

  -- King of Scrap: a salvaged Common can yield a bonus crafting
  -- material, mapped from the item kind (salvageRules convention).
  if item.rarity = 'Common' and material_chance > 0 and random() < material_chance then
    bonus_material := case item.kind
      when 'weapon' then 'BallisticParts'
      when 'shield' then 'ReactiveComponents'
      when 'ordnance' then 'ReactiveComponents'
      when 'classMod' then 'TechFragments'
      when 'relic' then 'TechFragments'
      else 'ScrapAlloy'
    end;
  end if;

  update public.item_instances
  set runtime_state = 'consumed', tradeable = false, equipped_slot = null
  where id = item.id
  returning * into item;

  update public.profiles
  set scrap = scrap + award,
      legendary_cores = legendary_cores + cores,
      materials = case when bonus_material is not null then
        jsonb_set(coalesce(materials, '{}'::jsonb), array[bonus_material], to_jsonb(coalesce((materials ->> bonus_material)::integer, 0) + 1), true)
      else materials end
  where id = actor
  returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_recycle_item',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'scrap_award', award,
    'cores_award', cores,
    'bonus_material', bonus_material,
    'loadout', public.cc_loadout_snapshot(actor)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_recycle_item', nonce, result);

  return result;
end;
$function$;

-- ─── 5a. cc_craft_job_json + cc_enqueue_craft_job restated (0024 bodies + core catalyst) ───

drop function if exists public.cc_enqueue_craft_job(uuid, text, integer, text, integer, text, boolean, boolean, numeric);

create or replace function public.cc_craft_job_json(j public.craft_jobs)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', j.id,
    'owner_user_id', j.owner_user_id,
    'bench', j.bench,
    'kind', j.kind,
    'recipe_id', j.recipe_id,
    'units_total', j.units_total,
    'units_completed', j.units_completed,
    'unit_duration_ms', j.unit_duration_ms,
    'accrued_ms', j.accrued_ms,
    'status', j.status,
    'escrow_inputs', j.escrow_inputs,
    'escrow_catalyst', j.escrow_catalyst,
    'escrow_cores', j.escrow_cores,
    'rush_ticket_quality', j.rush_ticket_quality,
    'rush_ticket_origin', j.rush_ticket_origin,
    'snapshot', j.snapshot,
    'xp_awarded', j.xp_awarded,
    'outputs', j.outputs,
    'tool_charged', j.tool_charged,
    'created_at_ms', (extract(epoch from j.created_at) * 1000)::bigint,
    'last_settled_ms', (extract(epoch from j.last_settled_at) * 1000)::bigint,
    'completed_at_ms', case when j.completed_at is null then null
      else (extract(epoch from j.completed_at) * 1000)::bigint end
  )
$$;

-- Enqueue: settle first, gate, verify the FULL escrow, take it, and
-- insert the job with its snapshotted modifiers. The efficiency
-- bonus is a trusted server parameter: the Chef derives it from the
-- player's skill spends + equipped class mod (skillBonusesFromRecords)
-- and passes it in — it never comes from the request body (§2.7).
create or replace function public.cc_enqueue_craft_job(
  p_player_id uuid,
  nonce text,
  p_bench integer,
  p_recipe_id text,
  p_units integer,
  p_rarity text,
  p_use_catalyst boolean,
  p_use_rush_ticket boolean,
  p_efficiency_bonus numeric,
  p_use_core_catalyst boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  recipe jsonb;
  v_units integer := coalesce(p_units, 0);
  v_bench integer := coalesce(p_bench, 0);
  v_kind text;
  v_rarity text := nullif(coalesce(p_rarity, ''), '');
  v_rarity_bench integer := 1;
  v_catalyst text := null;
  v_escrow jsonb := '{}'::jsonb;
  v_escrow_catalyst jsonb := '{}'::jsonb;
  v_key text;
  v_per_unit numeric;
  v_available integer;
  v_tools jsonb;
  v_fitted text;
  v_tool_quality numeric := 1;
  v_tool_duration numeric := 1;
  v_tool_yield numeric := 0;
  v_tool_bonus numeric := 0;
  v_rush_quality numeric := null;
  v_rush_origin text := null;
  v_rush_reduction numeric := 0;
  v_ticket_count integer;
  v_core_catalyst boolean := coalesce(p_use_core_catalyst, false);
  v_escrow_cores integer := 0;
  v_consumed jsonb;
  v_skill_mult numeric;
  v_scalar numeric := least(2.0, greatest(0.5,
    public.cc_economy_config_number('craftTimeScalar', 1.0)));
  v_base_duration bigint;
  v_duration bigint;
  v_job public.craft_jobs%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  -- Settle first: gates and snapshots read post-settle state.
  perform public.cc_settle_craft_jobs(actor);
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  -- Guest gate (§2.1): enqueueing is a verified-account action, the
  -- player-market lock treatment; vendor staples stay the guest path.
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  recipe := public.cc_craft_recipe(p_recipe_id);
  if recipe is null then raise exception 'Unknown craft recipe'; end if;
  v_kind := recipe ->> 'kind';

  if v_units < 1 then raise exception 'units must be a positive integer'; end if;
  if v_units > 500 then raise exception 'units exceeds the per-job maximum of 500'; end if;
  if v_bench < 1 or v_bench > 3 then raise exception 'bench must be 1, 2 or 3'; end if;
  if v_bench > coalesce(p.workshop_benches, 1) then raise exception 'Bench not unlocked'; end if;
  if v_bench < (recipe ->> 'requiresBench')::integer then
    raise exception 'Recipe requires bench % or higher', recipe ->> 'requiresBench';
  end if;
  if p.player_level < (recipe ->> 'requiresLevel')::integer then
    raise exception 'Requires level %', recipe ->> 'requiresLevel';
  end if;
  if recipe -> 'requiresMastery' is not null
     and public.cc_player_mastery_level(actor, recipe -> 'requiresMastery' ->> 'track')
         < (recipe -> 'requiresMastery' ->> 'level')::integer then
    raise exception 'Requires % mastery %',
      recipe -> 'requiresMastery' ->> 'track', recipe -> 'requiresMastery' ->> 'level';
  end if;

  -- Gear rarity: forced at enqueue, Epic-capped by law.
  if v_kind = 'gear' then
    if v_rarity is null or v_rarity not in ('Common', 'Uncommon', 'Rare', 'Epic') then
      if v_rarity = 'Legendary' then
        raise exception 'Legendary gear cannot be crafted';
      end if;
      raise exception 'A craftable rarity (Common–Epic) is required';
    end if;
    v_rarity_bench := case v_rarity when 'Epic' then 3 when 'Rare' then 2 else 1 end;
    if v_bench < v_rarity_bench then
      raise exception '% frames require bench %', v_rarity, v_rarity_bench;
    end if;
    if v_rarity = 'Epic'
       and public.cc_player_mastery_level(actor, 'crafting.gear') < 10 then
      raise exception 'Epic frames require crafting.gear mastery 10';
    end if;
  end if;

  -- Tools are unique workshop assets: no duplicates owned or queued.
  if v_kind = 'tool' then
    if coalesce(p.workshop_tools -> 'owned' ->> (recipe ->> 'toolId'), 'false') = 'true' then
      raise exception 'Tool already fitted in the workshop';
    end if;
    if exists (select 1 from public.craft_jobs
                where owner_user_id = actor and status = 'active'
                  and recipe_id = p_recipe_id) then
      raise exception 'A job for this tool is already queued';
    end if;
  end if;

  -- Queue capacity: one running + five queued per bench.
  if (select count(*) from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench) >= 6 then
    raise exception 'Bench queue is full';
  end if;

  -- Catalyst (§2.5b): first match in the TS CATALYSTS order wins.
  if coalesce(p_use_catalyst, false) then
    v_catalyst := case
      when recipe ->> 'consumableType' in ('BossScanner', 'DataSkimmer') then 'Siltglass'
      when recipe ->> 'consumableType' in ('OverchargeStim', 'IncendiaryAmmo', 'ShockAmmo', 'CorrosiveAmmo', 'CryoAmmo', 'VoidAmmo') then 'NitrocellGel'
      when recipe ->> 'consumableType' in ('ShieldCell', 'PatchKit', 'FieldPatchKit', 'MasterPatchKit') then 'HeartwoodResin'
      when recipe ->> 'consumableType' in ('OrdnanceCharge', 'EMPCharge', 'CorrosiveCharge') then 'ForgeheartIngots'
      when recipe ->> 'consumableType' = 'LuckBooster' then 'PrismShards'
      when recipe ->> 'consumableType' in ('SalvageContract', 'MagnetizedPayload') then 'MagnetiteCores'
      when recipe ->> 'consumableType' in ('NanoSwarm', 'AdrenalineShot') then 'MycoSteelFiber'
      when v_kind = 'gear' then 'ForgeheartIngots'
      else null
    end;
    if v_catalyst is null then raise exception 'Recipe takes no catalyst'; end if;
    if v_bench < 2 then raise exception 'Catalysts require the Forge (bench 2)'; end if;
  end if;

  -- Legendary Core Catalyst (0026): gear frames only — one legendary
  -- core per unit escrowed at enqueue buys +2 generation draws per
  -- completed unit (the gear system's quality currency; consumables
  -- keep the material catalyst family). Mutually exclusive with the
  -- material catalyst, Forge-gated like it.
  if v_core_catalyst then
    if v_catalyst is not null then
      raise exception 'Choose one catalyst: material or legendary core';
    end if;
    if v_kind <> 'gear' then
      raise exception 'Legendary core catalyst applies to gear frames only';
    end if;
    if v_bench < 2 then raise exception 'Catalysts require the Forge (bench 2)'; end if;
    v_escrow_cores := v_units;
  end if;

  -- Verify the full escrow before taking any of it (atomicity).
  for v_key, v_per_unit in
    select key, value::numeric from jsonb_each_text(recipe -> 'inputs')
  loop
    v_escrow := jsonb_set(v_escrow, array[v_key], to_jsonb((v_per_unit * v_units)::bigint));
    if public.cc_is_material_key(v_key) then
      v_available := coalesce((p.materials ->> v_key)::integer, 0);
      if v_available < v_per_unit * v_units then
        raise exception 'Insufficient material %', v_key;
      end if;
    else
      v_available := coalesce((p.essences ->> v_key)::integer, 0);
      if v_available < v_per_unit * v_units then
        raise exception 'Insufficient essence %', v_key;
      end if;
    end if;
  end loop;
  if v_catalyst is not null then
    v_escrow_catalyst := jsonb_build_object(v_catalyst, v_units);
    if coalesce((p.materials ->> v_catalyst)::integer, 0) < v_units then
      raise exception 'Insufficient material %', v_catalyst;
    end if;
  end if;
  if v_escrow_cores > 0 and coalesce(p.legendary_cores, 0) < v_escrow_cores then
    raise exception 'Insufficient legendary cores';
  end if;
  v_ticket_count := coalesce((p.consumables ->> 'WorkshopRushTicket')::integer, 0);
  if coalesce(p_use_rush_ticket, false) and v_ticket_count < 1 then
    raise exception 'No Workshop Rush Ticket available';
  end if;

  -- Fitted tool snapshot for this bench.
  v_tools := coalesce(p.workshop_tools, '{}'::jsonb);
  v_fitted := v_tools -> 'fitted' ->> v_bench::text;
  if v_fitted is not null
     and coalesce((v_tools -> 'charges' ->> v_fitted)::integer, 0) <= 0 then
    v_fitted := null;
  end if;
  if v_fitted = 'tool_precision_calipers' then
    v_tool_quality := 1.08;
  elsif v_fitted = 'tool_servo_bench_rig' then
    v_tool_duration := 0.85;
  elsif v_fitted = 'tool_reclaimer_head' then
    v_tool_yield := 0.05;
    v_tool_bonus := 0.10;
  elsif v_fitted is not null then
    v_fitted := null;
  end if;

  -- Rush ticket: escrowed at enqueue, burned at job start (FIFO,
  -- lowest quality first — the shipped burn order); its quality
  -- prices the reduction through the def's own scaling (0.2 base,
  -- capped at 0.45 — getConsumableRuntimeEffects' FULL_CHANCE mode).
  if coalesce(p_use_rush_ticket, false) then
    if not exists (select 1 from public.consumable_batches
                    where owner_user_id = actor
                      and consumable_type = 'WorkshopRushTicket' and quantity > 0) then
      perform public.cc_add_consumable_batch(actor, 'WorkshopRushTicket',
        v_ticket_count, 100, 'vendor', null, null, 'admin_adjust',
        'Backfilled legacy count into 100% batch before consumption', '{}'::jsonb);
    end if;
    select origin into v_rush_origin from public.consumable_batches
     where owner_user_id = actor and consumable_type = 'WorkshopRushTicket'
       and quantity > 0
     order by quality_percent asc, created_at asc
     limit 1;
    v_consumed := public.cc_consume_consumable_batch(actor, 'WorkshopRushTicket', 1,
      'crafting', 'Workshop Rush Ticket', '{}'::jsonb);
    v_rush_quality := (v_consumed -> 'consumed' -> 0 ->> 'quality_percent')::numeric;
    v_rush_reduction := least(0.45, 0.2 * coalesce(v_rush_quality, 100) / 100);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, 'WorkshopRushTicket', -1),
           updated_at = now()
     where id = actor;
  end if;

  -- Take the escrow.
  for v_key, v_per_unit in select key, value::numeric from jsonb_each_text(v_escrow)
  loop
    if public.cc_is_material_key(v_key) then
      update public.profiles
         set materials = public.cc_jsonb_add_int(materials, v_key, -v_per_unit::integer),
             updated_at = now()
       where id = actor;
    else
      update public.profiles
         set essences = public.cc_jsonb_add_int(essences, v_key, -v_per_unit::integer),
             updated_at = now()
       where id = actor;
    end if;
  end loop;
  if v_catalyst is not null then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, v_catalyst, -v_units),
           updated_at = now()
     where id = actor;
  end if;
  if v_escrow_cores > 0 then
    update public.profiles
       set legendary_cores = legendary_cores - v_escrow_cores,
           updated_at = now()
     where id = actor;
  end if;

  -- Snapshotted unit duration: base x skill x tool x scalar x rush.
  v_skill_mult := 1 - least(0.20, 0.02 * round(greatest(0, coalesce(p_efficiency_bonus, 0)) * 10));
  if v_kind = 'gear' then
    v_base_duration := (recipe -> 'durationByRarityMs' ->> v_rarity)::bigint;
  else
    v_base_duration := (recipe ->> 'unitDurationMs')::bigint;
  end if;
  v_duration := greatest(1, round(
    v_base_duration * v_skill_mult * v_tool_duration * v_scalar * (1 - v_rush_reduction)
  ))::bigint;

  insert into public.craft_jobs(
    owner_user_id, bench, kind, recipe_id, units_total, unit_duration_ms,
    escrow_inputs, escrow_catalyst, escrow_cores, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (
    actor, v_bench, v_kind, p_recipe_id, v_units, v_duration,
    v_escrow, v_escrow_catalyst, v_escrow_cores, v_rush_quality, v_rush_origin,
    jsonb_build_object(
      'toolId', v_fitted,
      'toolQualityMultiplier', v_tool_quality,
      'toolDurationMultiplier', v_tool_duration,
      'toolRefineYieldBonus', v_tool_yield,
      'toolBonusUnitChance', v_tool_bonus,
      'skillDurationMultiplier', v_skill_mult,
      'rushReduction', v_rush_reduction,
      'craftTimeScalar', v_scalar,
      'catalystMaterialId', v_catalyst,
      'coreCatalyst', v_core_catalyst,
      'gearRarity', case when v_kind = 'gear' then v_rarity else null end
    ))
  returning * into v_job;

  select * into p from public.profiles where id = actor;
  result := jsonb_build_object(
    'action_type', 'cc_enqueue_craft_job',
    'profile', public.cc_profile_snapshot(p),
    'job', public.cc_craft_job_json(v_job),
    'escrow_cores', v_escrow_cores
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enqueue_craft_job', nonce, result);
  return result;
end;
$$;

-- ─── 5b. cc_settle_craft_jobs restated (0025 body + core-catalyst draws) ───

create or replace function public.cc_complete_craft_unit(
  p_job_id uuid,
  p_xp_rate numeric,
  p_quality_shift numeric,
  p_temper_base numeric,
  p_refine_base numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  job public.craft_jobs%rowtype;
  p public.profiles%rowtype;
  recipe jsonb;
  v_xp bigint;
  v_output jsonb;
  v_next jsonb;
  v_mastery_track text;
  v_mastery_xp integer;
  -- consumable completion
  v_type text;
  v_ml integer;
  v_bounds jsonb;
  v_roll numeric;
  v_qty integer;
  v_bonus boolean;
  -- refine completion
  v_yield numeric;
  v_count integer;
  -- gear completion
  v_tempered boolean;
  -- repair completion (0025)
  v_item public.item_instances%rowtype;
  v_kit_base numeric;
  v_quality numeric;
  v_before numeric;
  v_restore numeric;
  v_restored numeric;
begin
  select * into job from public.craft_jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  actor := job.owner_user_id;
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if job.kind = 'repair' then
    -- Self-repair unit (0025): apply the next escrowed patch kit.
    -- Restoration = kit base x kit quality% x the owner's repair
    -- efficiency snapshot, clamped at the vehicle's max; the kit is
    -- spent even when the clamp wastes part of it. No player XP
    -- (consumption); repair mastery trains by points restored.
    v_output := jsonb_build_object(
      'unit', job.units_completed + 1,
      'kind', 'repair',
      'xp', 0,
      'completedAtMs', (extract(epoch from now()) * 1000)::bigint
    );
    select * into v_item from public.item_instances
     where id = (job.snapshot -> 'repair' ->> 'itemId')::uuid
       and owner_user_id = actor;
    if not found or v_item.kind <> 'vehicle'
       or v_item.runtime_state in ('listed', 'consumed', 'salvaged', 'in_service')
       or coalesce(v_item.condition_current, v_item.condition_max, 100)
          >= coalesce(v_item.condition_max, 100) then
      -- The unit never starts: the settler ends the job here and
      -- refunds this and every later kit at its recorded quality.
      return v_output || jsonb_build_object('vehicleFull', true);
    end if;
    v_kit_base := case job.snapshot -> 'repair' ->> 'kitType'
      when 'PatchKit' then 30 when 'FieldPatchKit' then 45
      when 'MasterPatchKit' then 80 else 0 end;
    v_quality := coalesce(
      (job.snapshot -> 'repair' -> 'kitQualities' ->> job.units_completed)::numeric, 100);
    v_before := coalesce(v_item.condition_current, v_item.condition_max, 100);
    v_restore := round(v_kit_base * v_quality / 100
      * coalesce((job.snapshot -> 'repair' ->> 'efficiency')::numeric, 1), 2);
    update public.item_instances
       set condition_current = least(coalesce(condition_max, 100), v_before + v_restore),
           updated_at = now()
     where id = v_item.id
     returning condition_current into v_item.condition_current;
    v_restored := round(v_item.condition_current - v_before, 2);
    if v_restored > 0 then
      perform public.cc_add_mastery_xp(actor, 'services.repair', ceil(v_restored)::integer);
    end if;
    v_output := v_output || jsonb_build_object(
      'itemId', v_item.id,
      'quality', v_quality,
      'pointsRestored', v_restored,
      'conditionCurrent', v_item.condition_current
    );
    v_output := public.cc_jsonb_strip_nulls(v_output);
    update public.craft_jobs
       set units_completed = units_completed + 1,
           outputs = outputs || jsonb_build_array(v_output)
     where id = job.id;
    return v_output;
  end if;

  recipe := public.cc_craft_recipe(job.recipe_id);
  if recipe is null then raise exception 'Unknown craft recipe'; end if;

  v_xp := public.cc_craft_unit_xp(job.unit_duration_ms, p.player_level, p_xp_rate);
  v_output := jsonb_build_object(
    'unit', job.units_completed + 1,
    'kind', job.kind,
    'xp', v_xp,
    -- The settle instant is the production instant for metrics: the
    -- outputs (and their XP/materials) observably land at settlement.
    'completedAtMs', (extract(epoch from now()) * 1000)::bigint
  );

  if job.kind = 'consumable' then
    v_type := recipe ->> 'consumableType';
    v_ml := public.cc_player_mastery_level(actor, 'crafting_consumables');
    v_bounds := public.cc_craft_quality_bounds(
      v_type, v_ml, job.bench,
      (job.snapshot ->> 'catalystMaterialId') is not null,
      p_quality_shift
    );
    v_roll := round((
      ((v_bounds ->> 'min')::numeric
        + random() * greatest(0, (v_bounds ->> 'max')::numeric - (v_bounds ->> 'min')::numeric))
      * case job.bench when 2 then 1.05 when 3 then 1.10 else 1.0 end
      * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
    )::numeric, 2);
    v_roll := least((v_bounds ->> 'cap')::numeric, greatest(1, v_roll));
    v_qty := 1;
    v_bonus := false;
    if coalesce((job.snapshot ->> 'toolBonusUnitChance')::numeric, 0) > 0
       and random() < (job.snapshot ->> 'toolBonusUnitChance')::numeric then
      v_qty := 2;
      v_bonus := true;
    end if;
    perform public.cc_add_consumable_batch(
      actor, v_type, v_qty, v_roll, 'crafted', actor, job.recipe_id,
      'crafted', 'Crafted at the Workshop', '{}'::jsonb);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, v_type, v_qty),
           updated_at = now()
     where id = actor;
    perform public.cc_add_stat(actor, 'consumables_crafted', v_qty);
    v_output := v_output || jsonb_build_object(
      'consumableType', v_type,
      'quality', v_roll,
      'quantity', v_qty,
      'bonusUnit', v_bonus
    );
  elsif job.kind = 'refine' then
    v_ml := public.cc_player_mastery_level(actor, 'crafting.refining');
    v_yield := least(1, p_refine_base + 0.004 * v_ml
      + coalesce((job.snapshot ->> 'toolRefineYieldBonus')::numeric, 0));
    if coalesce((recipe ->> 'outputBase')::numeric, 0) <= 0 or p_refine_base <= 0 then
      v_count := coalesce((recipe ->> 'outputBase')::integer, 0);
    else
      v_count := floor((recipe ->> 'outputBase')::numeric * v_yield / p_refine_base)::integer;
    end if;
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, recipe ->> 'outputMaterial', v_count),
           updated_at = now()
     where id = actor;
    v_output := v_output || jsonb_build_object(
      'outputMaterial', recipe ->> 'outputMaterial',
      'outputQuantity', v_count
    );
  elsif job.kind = 'gear' then
    v_ml := public.cc_player_mastery_level(actor, 'crafting.gear');
    v_tempered := random() < least(0.3, greatest(0, p_temper_base) + 0.01 * v_ml);
    v_output := v_output || jsonb_build_object(
      'pending', true,
      'slot', recipe ->> 'gearSlot',
      'rarity', job.snapshot ->> 'gearRarity',
      'item_level', p.player_level,
      'draws', (case when v_tempered then 3 else 1 end)
        + case when job.snapshot ->> 'coreCatalyst' = 'true' then 2 else 0 end,
      'tempered', v_tempered
    );
  elsif job.kind = 'tool' then
    -- All three fitted tools carry 25 jobs of durability (§2.5e).
    update public.profiles
       set workshop_tools = jsonb_set(
             jsonb_set(coalesce(workshop_tools, '{}'::jsonb),
               array['owned', recipe ->> 'toolId'], 'true'::jsonb, true),
             array['charges', recipe ->> 'toolId'], '25'::jsonb, true),
           updated_at = now()
     where id = actor;
    v_output := v_output || jsonb_build_object('toolId', recipe ->> 'toolId');
  end if;

  -- Mastery + player XP land after the output is priced.
  if job.kind = 'refine' then
    v_mastery_track := 'crafting.refining'; v_mastery_xp := 10;
  elsif job.kind in ('gear', 'tool') then
    v_mastery_track := 'crafting.gear'; v_mastery_xp := 25;
  else
    v_mastery_track := 'crafting_consumables'; v_mastery_xp := 10;
  end if;
  perform public.cc_add_mastery_xp(actor, v_mastery_track, v_mastery_xp);
  v_next := public.cc_apply_xp(p.player_level, p.player_xp, v_xp);
  update public.profiles
     set player_level = (v_next ->> 'player_level')::integer,
         player_xp = (v_next ->> 'player_xp')::bigint,
         updated_at = now()
   where id = actor;

  v_output := public.cc_jsonb_strip_nulls(v_output);
  update public.craft_jobs
     set units_completed = units_completed + 1,
         xp_awarded = xp_awarded + v_xp,
         outputs = outputs || jsonb_build_array(v_output)
   where id = job.id;
  return v_output;
end;
$$;

create or replace function public.cc_settle_craft_jobs(
  p_player_id uuid,
  p_max_advance_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  p public.profiles%rowtype;
  v_now timestamptz := now();
  v_now_ms bigint := (extract(epoch from v_now) * 1000)::bigint;
  v_action text;
  v_heartbeat_ms bigint;
  v_away_cap_ms bigint;
  v_xp_rate numeric := least(0.85, greatest(0.70,
    public.cc_economy_config_number('craftXpRate', 0.775)));
  v_shift numeric := least(10, greatest(-10,
    public.cc_economy_config_number('craftQualityShift', 0)));
  v_temper numeric := least(0.30, greatest(0,
    public.cc_economy_config_number('gearTemperBaseChance', 0.05)));
  v_yield_base numeric := least(1.0, greatest(0.5,
    public.cc_economy_config_number('refineBaseYield', 0.8)));
  v_ids uuid[] := '{}';
  v_benches integer[] := '{}';
  v_advances bigint[] := '{}';
  v_job record;
  v_start_ms bigint;
  v_raw bigint;
  v_attended bigint;
  v_advance bigint;
  v_bench integer;
  v_budget bigint;
  v_need bigint;
  v_output jsonb;
  v_tools jsonb;
  v_tool_id text;
  v_charges integer;
  v_fitted_key text;
  v_total_xp bigint := 0;
  v_jobs_completed integer := 0;
  v_max_advance bigint := 0;
  v_completions jsonb := '[]'::jsonb;
  v_i integer;
  v_force_complete boolean := false;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into p from public.profiles where id = actor for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'no_profile',
      'advanced_ms', 0, 'xp_awarded', 0, 'jobs_completed', 0,
      'completions', '[]'::jsonb);
  end if;

  select active_action, (extract(epoch from last_heartbeat_at) * 1000)::bigint
    into v_action, v_heartbeat_ms
    from public.active_actions where user_id = actor;

  -- Internal away cap: min(earned tier, limiter when set), [1h, 24h].
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours(p.player_level),
      coalesce(nullif(p.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours(p.player_level))
    )) * 3600000)::bigint;

  -- Pass 1: rebase every active job and price its advance.
  for v_job in
    select * from public.craft_jobs
     where owner_user_id = actor and status = 'active'
     order by created_at asc, id asc
     for update
  loop
    v_start_ms := (extract(epoch from v_job.last_settled_at) * 1000)::bigint;
    v_raw := greatest(0, v_now_ms - v_start_ms);
    update public.craft_jobs set last_settled_at = v_now where id = v_job.id;
    if v_action is distinct from (case when v_job.kind = 'repair'
          then 'workshop_service' else 'crafting' end) or v_raw <= 0 then
      v_advance := 0;
    elsif p_max_advance_ms is not null then
      v_advance := least(v_raw, greatest(0, p_max_advance_ms));
    else
      v_attended := least(v_raw, greatest(0,
        coalesce(v_heartbeat_ms, v_start_ms) + 300000 - v_start_ms));
      v_advance := v_attended + least(v_raw - v_attended, v_away_cap_ms);
    end if;
    v_ids := v_ids || v_job.id;
    v_benches := v_benches || v_job.bench;
    v_advances := v_advances || v_advance;
    v_max_advance := greatest(v_max_advance, v_advance);
  end loop;

  if v_action is distinct from 'crafting' and v_action is distinct from 'workshop_service' then
    return jsonb_build_object('settled', true, 'advanced_ms', v_max_advance,
      'xp_awarded', 0, 'jobs_completed', 0, 'completions', '[]'::jsonb);
  end if;

  -- Pass 2: each bench's queue consumes its window in order; leftover
  -- flows to the next job on the bench.
  for v_bench in
    select distinct bench from public.craft_jobs
     where owner_user_id = actor and status = 'active'
     order by bench asc
  loop
    select coalesce(max(adv), 0) into v_budget
      from unnest(v_ids, v_benches, v_advances) as t(jid, b, adv)
     where b = v_bench;
    for v_job in
      select * from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench
       order by created_at asc, id asc
       for update
    loop
      exit when v_budget <= 0;
      -- A fitted tool's charge is spent when the job actually starts.
      if not v_job.tool_charged and (v_job.snapshot ->> 'toolId') is not null then
        v_tool_id := v_job.snapshot ->> 'toolId';
        update public.craft_jobs set tool_charged = true where id = v_job.id;
        select * into p from public.profiles where id = actor;
        v_tools := coalesce(p.workshop_tools, '{}'::jsonb);
        v_charges := coalesce((v_tools -> 'charges' ->> v_tool_id)::integer, 0) - 1;
        v_tools := jsonb_set(v_tools, array['charges', v_tool_id],
          to_jsonb(greatest(0, v_charges)), true);
        if v_charges <= 0 then
          v_tools := jsonb_set(v_tools, array['owned', v_tool_id], 'false'::jsonb, true);
          for v_fitted_key in
            select key from jsonb_each(coalesce(v_tools -> 'fitted', '{}'::jsonb))
          loop
            if v_tools -> 'fitted' ->> v_fitted_key = v_tool_id then
              v_tools := jsonb_set(v_tools, array['fitted', v_fitted_key], 'null'::jsonb, true);
            end if;
          end loop;
        end if;
        update public.profiles set workshop_tools = v_tools, updated_at = now()
         where id = actor;
      end if;
      v_force_complete := false;
      while v_budget > 0 and v_job.units_completed < v_job.units_total loop
        v_need := v_job.unit_duration_ms - v_job.accrued_ms;
        if v_budget < v_need then
          update public.craft_jobs
             set accrued_ms = accrued_ms + v_budget where id = v_job.id;
          v_budget := 0;
        else
          v_budget := v_budget - v_need;
          update public.craft_jobs set accrued_ms = 0 where id = v_job.id;
          v_output := public.cc_complete_craft_unit(
            v_job.id, v_xp_rate, v_shift, v_temper, v_yield_base);
          if coalesce((v_output ->> 'vehicleFull')::boolean, false) then
            -- Repair job whose vehicle is already whole (or gone):
            -- end it and refund every unstarted kit at its escrowed
            -- quality/origin (0025).
            for v_i in v_job.units_completed .. v_job.units_total - 1 loop
              perform public.cc_add_consumable_batch(actor,
                v_job.snapshot -> 'repair' ->> 'kitType', 1,
                (v_job.snapshot -> 'repair' -> 'kitQualities' ->> v_i)::numeric,
                coalesce(v_job.snapshot -> 'repair' -> 'kitOrigins' ->> v_i, 'crafted'),
                actor, null, 'repair_refund',
                'Patch kit refunded (vehicle already at full condition)',
                '{}'::jsonb);
            end loop;
            if v_job.units_total - v_job.units_completed > 0 then
              update public.profiles
                 set consumables = public.cc_jsonb_add_int(consumables,
                       v_job.snapshot -> 'repair' ->> 'kitType',
                       v_job.units_total - v_job.units_completed),
                     updated_at = now()
               where id = actor;
            end if;
            v_force_complete := true;
            exit;
          end if;
          v_total_xp := v_total_xp + (v_output ->> 'xp')::bigint;
          v_completions := v_completions || jsonb_build_array(
            v_output || jsonb_build_object('jobId', v_job.id, 'recipeId', v_job.recipe_id));
          v_job.units_completed := v_job.units_completed + 1;
        end if;
      end loop;
      if v_force_complete or v_job.units_completed >= v_job.units_total then
        update public.craft_jobs
           set status = 'complete', completed_at = v_now where id = v_job.id;
        v_jobs_completed := v_jobs_completed + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('settled', true, 'advanced_ms', v_max_advance,
    'xp_awarded', v_total_xp, 'jobs_completed', v_jobs_completed,
    'completions', v_completions);
end;
$$;

-- ─── 5c. cc_cancel_craft_job restated (0025 body + core refunds) ───

create or replace function public.cc_cancel_craft_job(
  p_player_id uuid,
  nonce text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  job public.craft_jobs%rowtype;
  v_started boolean;
  v_in_progress integer;
  v_unstarted integer;
  v_key text;
  v_total numeric;
  v_per_unit numeric;
  v_amount bigint;
  v_refunded jsonb := '{}'::jsonb;
  v_rush_refunded boolean := false;
  v_cores_refunded bigint := 0;
  v_i integer;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  perform public.cc_settle_craft_jobs(actor);
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into job from public.craft_jobs
   where id = p_job_id and owner_user_id = actor for update;
  if not found then raise exception 'Job not found'; end if;
  if job.status <> 'active' then raise exception 'Job is not active'; end if;

  if job.kind = 'repair' then
    -- Repair jobs (0025): kits are discrete items, not divisible
    -- inputs — every kit not yet applied refunds whole, including
    -- the in-progress unit's kit (it has not been applied yet).
    v_refunded := '{}'::jsonb;
    for v_i in job.units_completed .. job.units_total - 1 loop
      perform public.cc_add_consumable_batch(actor,
        job.snapshot -> 'repair' ->> 'kitType', 1,
        (job.snapshot -> 'repair' -> 'kitQualities' ->> v_i)::numeric,
        coalesce(job.snapshot -> 'repair' -> 'kitOrigins' ->> v_i, 'crafted'),
        actor, null, 'repair_refund',
        'Patch kit refunded (repair job cancelled)', '{}'::jsonb);
    end loop;
    if job.units_total - job.units_completed > 0 then
      update public.profiles
         set consumables = public.cc_jsonb_add_int(consumables,
               job.snapshot -> 'repair' ->> 'kitType',
               job.units_total - job.units_completed),
             updated_at = now()
       where id = actor;
      v_refunded := jsonb_build_object(
        job.snapshot -> 'repair' ->> 'kitType',
        job.units_total - job.units_completed);
    end if;
    update public.craft_jobs set status = 'cancelled' where id = job.id;
    select * into p from public.profiles where id = actor;
    result := jsonb_build_object(
      'action_type', 'cc_cancel_craft_job',
      'profile', public.cc_profile_snapshot(p),
      'job_id', job.id,
      'refunded_inputs', v_refunded,
      'rush_ticket_refunded', false
    );
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_cancel_craft_job', nonce, result);
    return result;
  end if;

  v_started := job.units_completed > 0 or job.accrued_ms > 0;
  v_in_progress := case when job.accrued_ms > 0 then 1 else 0 end;
  v_unstarted := job.units_total - job.units_completed - v_in_progress;

  for v_key, v_total in
    select key, value::numeric from jsonb_each_text(job.escrow_inputs)
  loop
    v_per_unit := v_total / job.units_total;
    v_amount := (v_per_unit * v_unstarted)::bigint
      + case when v_in_progress = 1 then floor(v_per_unit * 0.5)::bigint else 0 end;
    if v_amount > 0 then
      v_refunded := jsonb_set(v_refunded, array[v_key],
        to_jsonb(coalesce((v_refunded ->> v_key)::bigint, 0) + v_amount), true);
      if public.cc_is_material_key(v_key) then
        update public.profiles
           set materials = public.cc_jsonb_add_int(materials, v_key, v_amount::integer),
               updated_at = now()
         where id = actor;
      else
        update public.profiles
           set essences = public.cc_jsonb_add_int(essences, v_key, v_amount::integer),
               updated_at = now()
         where id = actor;
      end if;
    end if;
  end loop;
  for v_key, v_total in
    select key, value::numeric from jsonb_each_text(job.escrow_catalyst)
  loop
    v_per_unit := v_total / job.units_total;
    v_amount := (v_per_unit * v_unstarted)::bigint
      + case when v_in_progress = 1 then floor(v_per_unit * 0.5)::bigint else 0 end;
    if v_amount > 0 then
      v_refunded := jsonb_set(v_refunded, array[v_key],
        to_jsonb(coalesce((v_refunded ->> v_key)::bigint, 0) + v_amount), true);
      update public.profiles
         set materials = public.cc_jsonb_add_int(materials, v_key, v_amount::integer),
             updated_at = now()
       where id = actor;
    end if;
  end loop;

  -- Legendary cores (0026): escrowed cores refund on the material
  -- catalyst's schedule — full for unstarted units, half (floored)
  -- for the in-progress unit.
  if coalesce(job.escrow_cores, 0) > 0 then
    v_per_unit := job.escrow_cores::numeric / job.units_total;
    v_cores_refunded := (v_per_unit * v_unstarted)::bigint
      + case when v_in_progress = 1 then floor(v_per_unit * 0.5)::bigint else 0 end;
    if v_cores_refunded > 0 then
      update public.profiles
         set legendary_cores = legendary_cores + v_cores_refunded::integer,
             updated_at = now()
       where id = actor;
    end if;
  end if;

  if job.rush_ticket_quality is not null and not v_started then
    perform public.cc_add_consumable_batch(actor, 'WorkshopRushTicket', 1,
      job.rush_ticket_quality, coalesce(job.rush_ticket_origin, 'crafted'),
      actor, null, 'crafted', 'Rush ticket refunded (job cancelled before start)',
      '{}'::jsonb);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, 'WorkshopRushTicket', 1),
           updated_at = now()
     where id = actor;
    v_rush_refunded := true;
  end if;

  update public.craft_jobs set status = 'cancelled' where id = job.id;
  select * into p from public.profiles where id = actor;
  result := jsonb_build_object(
    'action_type', 'cc_cancel_craft_job',
    'profile', public.cc_profile_snapshot(p),
    'job_id', job.id,
    'refunded_inputs', v_refunded,
    'rush_ticket_refunded', v_rush_refunded,
    'cores_refunded', v_cores_refunded
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_cancel_craft_job', nonce, result);
  return result;
end;
$$;

-- ─── 6. cc_compute_economy_metrics restated (0025 body + core meters) ───

create or replace function public.cc_compute_economy_metrics(_day date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := (_day::timestamp) at time zone 'UTC';
  v_end timestamptz := ((_day + 1)::timestamp) at time zone 'UTC';
  m record;
  v_minted_total bigint;
  v_destroyed_total bigint;
  cj record;
  rj record;
begin
  select
    -- Mints -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_apply_chef_rewards'), 0) as minted_roaming,
    coalesce(sum(
      case when coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)
        then coalesce((result_payload -> 'attempt' ->> 'creditsGained')::bigint, 0)
           + coalesce((result_payload ->> 'entry_fee')::bigint, 0)
        else 0 end)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as minted_boss,
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_settle_offline_roaming'), 0) as minted_offline,
    (coalesce(sum((result_payload -> 'rewards' ->> 'credits')::bigint)
        filter (where action_type = 'cc_idle_claim'), 0)
     + coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
        filter (where action_type = 'cc_claim_roaming_rewards'), 0)
     + 5000 * count(*) filter (where action_type = 'cc_initial_bundle')
    ) as minted_other,
    -- Sinks -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'market_fee' ->> 'fee_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as destroyed_market_fees,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_vendor_buy'), 0) as destroyed_vendor,
    coalesce(sum((result_payload ->> 'creditsCharged')::bigint)
      filter (where action_type = 'cc_resurrect'), 0) as destroyed_resurrection,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_retrain'), 0) as destroyed_respec,
    coalesce(sum((result_payload ->> 'entry_fee')::bigint)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as destroyed_boss_entry_fees,
    coalesce(sum(greatest(0,
        coalesce((result_payload -> 'attempt' ->> 'creditsLost')::bigint, 0)
        - coalesce((result_payload ->> 'entry_fee')::bigint, 0)))
      filter (where action_type = 'cc_apply_boss_attempt'
        and not coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)),
      0) as destroyed_boss_death_fees,
    -- Market ----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_market_create') as market_listings_created,
    count(*) filter (where action_type = 'cc_accept_listing') as market_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as market_volume,
    -- Crafted market sales (0024) -------------------------------------------
    count(*) filter (where action_type = 'cc_accept_listing'
      and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
        or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')) as crafted_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'
        and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
          or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')), 0) as crafted_volume,
    -- Cache -----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_claim_rewarded_cache_key') as cache_keys_from_ads,
    count(*) filter (where action_type in ('cc_make_item', 'cc_draw_item')) as cache_opens,
    coalesce(sum((result_payload -> 'rewards' ->> 'cache_fragments_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_fragments_awarded,
    -- Legendary salvage + cores (0026): destroyed legendaries are a
    -- LEDGER fact (the recycle result carries the consumed item) —
    -- distinct from legendaries_minted_by_source above, which counts
    -- item_instances at creation. No double counting: creation and
    -- destruction are separate meters by design.
    count(*) filter (where action_type = 'cc_recycle_item'
      and result_payload -> 'item' ->> 'rarity' = 'Legendary') as legendaries_salvaged,
    coalesce(sum((result_payload ->> 'cores_award')::bigint)
      filter (where action_type = 'cc_recycle_item'), 0) as legendary_cores_minted,
    (coalesce(sum((result_payload -> 'job' ->> 'escrow_cores')::bigint)
        filter (where action_type = 'cc_enqueue_craft_job'), 0)
     - coalesce(sum((result_payload ->> 'cores_refunded')::bigint)
        filter (where action_type = 'cc_cancel_craft_job'), 0)) as legendary_cores_spent
  into m
  from public.verified_action_ledger
  where created_at >= v_start and created_at < v_end;

  -- Craft job meters (0024): jobs_completed is a job-level fact
  -- (status + completed_at); units / XP / refined output are counted
  -- per OUTPUT at the unit's settle-day stamp, across jobs of ANY
  -- status — units produced inside a job that is later cancelled (or
  -- still running at day's end) are real production and real XP.
  select
    (select count(*) from public.craft_jobs j
      where j.status = 'complete'
        and j.completed_at >= v_start and j.completed_at < v_end) as jobs_completed,
    count(*)::integer as units_completed,
    coalesce(sum((o ->> 'xp')::bigint), 0)::bigint as xp_awarded,
    coalesce(sum((o ->> 'outputQuantity')::integer)
      filter (where o ->> 'kind' = 'refine'), 0)::integer as refined_units
  into cj
  from public.craft_jobs j,
       lateral jsonb_array_elements(j.outputs) o
  where (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
    and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint;

  -- Repair meters (0025): job-level facts from service_jobs at
  -- their terminal day (posted counted at posting day); self-repair
  -- kit consumption counted per completed repair UNIT output, the
  -- same settle-day stamp the craft meters use.
  select
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.created_at >= v_start and j.created_at < v_end) as jobs_posted,
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair' and j.status = 'completed'
        and j.completed_at >= v_start and j.completed_at < v_end)::integer as jobs_completed,
    (select coalesce(sum(j.points_restored), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled')) as points_restored,
    (select coalesce(sum(j.paid_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as credits_volume,
    (select coalesce(sum(j.fee_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as fees_destroyed,
    (select coalesce(sum(j.xp_awarded), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as xp_awarded,
    ((select coalesce(sum(jsonb_array_length(j.kits_consumed)), 0)
        from public.service_jobs j
       where j.profession_id = 'repair'
         and j.completed_at >= v_start and j.completed_at < v_end
         and j.status in ('completed', 'cancelled'))
     + (select count(*) from public.craft_jobs j,
              lateral jsonb_array_elements(j.outputs) o
         where o ->> 'kind' = 'repair'
           and (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
           and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint))::integer as kits_consumed
  into rj;

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees
    + rj.fees_destroyed;

  insert into public.economy_metrics (
    day,
    credits_minted_roaming, credits_minted_boss, credits_minted_offline,
    credits_minted_other, credits_minted_total,
    credits_destroyed_market_fees, credits_destroyed_vendor,
    credits_destroyed_resurrection, credits_destroyed_respec,
    credits_destroyed_boss_entry_fees, credits_destroyed_boss_death_fees,
    credits_destroyed_total, net_credit_change,
    legendaries_roaming, legendaries_boss, legendaries_cache, legendaries_total,
    market_listings_created, market_sales, market_volume,
    market_median_price, market_median_by_rarity,
    cache_keys_from_ads, cache_opens, cache_fragments_awarded,
    craft_jobs_completed, craft_units_completed, craft_xp_awarded,
    materials_destroyed_crafting, refined_units_produced,
    gear_items_crafted, crafted_market_sales, crafted_market_volume,
    repair_jobs_posted, repair_jobs_completed, repair_points_restored,
    repair_credits_volume, repair_fees_destroyed, repair_kits_consumed,
    repair_xp_awarded,
    legendaries_salvaged, legendary_cores_minted, legendary_cores_spent,
    computed_at
  )
  select
    _day,
    m.minted_roaming, m.minted_boss, m.minted_offline, m.minted_other,
    v_minted_total,
    m.destroyed_market_fees, m.destroyed_vendor, m.destroyed_resurrection,
    m.destroyed_respec, m.destroyed_boss_entry_fees, m.destroyed_boss_death_fees,
    v_destroyed_total, v_minted_total - v_destroyed_total,
    leg.roaming, leg.boss, leg.cache, leg.roaming + leg.boss + leg.cache,
    m.market_listings_created, m.market_sales, m.market_volume,
    (select percentile_cont(0.5) within group (
        order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric)
       from public.verified_action_ledger l
      where l.action_type = 'cc_accept_listing'
        and l.created_at >= v_start and l.created_at < v_end),
    (select coalesce(jsonb_object_agg(g.rarity, g.median), '{}'::jsonb)
       from (
         select l.result_payload -> 'item' ->> 'rarity' as rarity,
                percentile_cont(0.5) within group (
                  order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric) as median
           from public.verified_action_ledger l
          where l.action_type = 'cc_accept_listing'
            and l.created_at >= v_start and l.created_at < v_end
            and l.result_payload -> 'item' ->> 'rarity' is not null
          group by 1
       ) g),
    m.cache_keys_from_ads, m.cache_opens, m.cache_fragments_awarded,
    cj.jobs_completed, cj.units_completed, cj.xp_awarded,
    (select coalesce(jsonb_object_agg(key, net), '{}'::jsonb)
       from (
         select d.key, sum(d.delta) as net
           from (
             select e.key as key, (e.value)::bigint as delta
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, (e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_catalyst', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, -(e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'refunded_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_cancel_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
           ) d
          group by d.key
         having sum(d.delta) > 0
       ) nets),
    cj.refined_units,
    (select count(*)::integer from public.item_instances
      where payload ->> 'origin' = 'crafted'
        and created_at >= v_start and created_at < v_end),
    m.crafted_sales, m.crafted_volume,
    rj.jobs_posted, rj.jobs_completed, rj.points_restored,
    rj.credits_volume, rj.fees_destroyed, rj.kits_consumed,
    rj.xp_awarded,
    m.legendaries_salvaged, m.legendary_cores_minted, m.legendary_cores_spent,
    now()
  from (
    select
      count(*) filter (where payload ->> 'sourceTag' = 'World Drop') as roaming,
      count(*) filter (where payload ->> 'sourceTag' = 'Boss Drop') as boss,
      count(*) filter (where payload ->> 'sourceTag' = 'Cache-Forged') as cache
    from public.item_instances
    where rarity = 'Legendary' and created_at >= v_start and created_at < v_end
  ) leg
  on conflict (day) do update set
    credits_minted_roaming = excluded.credits_minted_roaming,
    credits_minted_boss = excluded.credits_minted_boss,
    credits_minted_offline = excluded.credits_minted_offline,
    credits_minted_other = excluded.credits_minted_other,
    credits_minted_total = excluded.credits_minted_total,
    credits_destroyed_market_fees = excluded.credits_destroyed_market_fees,
    credits_destroyed_vendor = excluded.credits_destroyed_vendor,
    credits_destroyed_resurrection = excluded.credits_destroyed_resurrection,
    credits_destroyed_respec = excluded.credits_destroyed_respec,
    credits_destroyed_boss_entry_fees = excluded.credits_destroyed_boss_entry_fees,
    credits_destroyed_boss_death_fees = excluded.credits_destroyed_boss_death_fees,
    credits_destroyed_total = excluded.credits_destroyed_total,
    net_credit_change = excluded.net_credit_change,
    legendaries_roaming = excluded.legendaries_roaming,
    legendaries_boss = excluded.legendaries_boss,
    legendaries_cache = excluded.legendaries_cache,
    legendaries_total = excluded.legendaries_total,
    market_listings_created = excluded.market_listings_created,
    market_sales = excluded.market_sales,
    market_volume = excluded.market_volume,
    market_median_price = excluded.market_median_price,
    market_median_by_rarity = excluded.market_median_by_rarity,
    cache_keys_from_ads = excluded.cache_keys_from_ads,
    cache_opens = excluded.cache_opens,
    cache_fragments_awarded = excluded.cache_fragments_awarded,
    craft_jobs_completed = excluded.craft_jobs_completed,
    craft_units_completed = excluded.craft_units_completed,
    craft_xp_awarded = excluded.craft_xp_awarded,
    materials_destroyed_crafting = excluded.materials_destroyed_crafting,
    refined_units_produced = excluded.refined_units_produced,
    gear_items_crafted = excluded.gear_items_crafted,
    crafted_market_sales = excluded.crafted_market_sales,
    crafted_market_volume = excluded.crafted_market_volume,
    repair_jobs_posted = excluded.repair_jobs_posted,
    repair_jobs_completed = excluded.repair_jobs_completed,
    repair_points_restored = excluded.repair_points_restored,
    repair_credits_volume = excluded.repair_credits_volume,
    repair_fees_destroyed = excluded.repair_fees_destroyed,
    repair_kits_consumed = excluded.repair_kits_consumed,
    repair_xp_awarded = excluded.repair_xp_awarded,
    legendaries_salvaged = excluded.legendaries_salvaged,
    legendary_cores_minted = excluded.legendary_cores_minted,
    legendary_cores_spent = excluded.legendary_cores_spent,
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;
$$;

-- ─── 7. Backfill — only where a surviving server record proves it ──
-- All inserts are on-conflict-do-nothing: re-running this migration
-- (or the live recording path racing it) can never duplicate a row.
-- The hardcoded id lists below are parity-pinned against the TS
-- content defs by src/test/collections.test.ts (the 0024
-- vendor-catalog precedent).

-- Effects + frames from items currently owned (any live state).
insert into public.collection_discoveries(user_id, family, entry_key, source)
select distinct i.owner_user_id, 'legendary_effect',
       i.payload ->> 'legendaryEffectId', 'backfill_owned'
  from public.item_instances i
 where i.runtime_state <> 'consumed'
   and i.payload ->> 'legendaryEffectId' in ('debt_collector', 'warranty_void', 'ricochet_gospel', 'bad_decision', 'glass_sun', 'the_accountant', 'armor_eater', 'thunder_receipt', 'second_opinion', 'salvage_rights', 'overclocked', 'borrowed_time', 'kickback', 'vampiric_ledger', 'echo_chamber', 'insurance_fraud_weapon', 'market_crash', 'stable_loop', 'phase_shifter', 'hot_swapper', 'chain_lightning', 'molten_core', 'cryo_stasis', 'void_bargain', 'jackpot')
on conflict do nothing;

insert into public.collection_discoveries(user_id, family, entry_key, source)
select distinct i.owner_user_id, 'weapon_frame',
       (i.payload ->> 'weaponType') || ':' || (i.payload ->> 'manufacturer'),
       'backfill_owned'
  from public.item_instances i
 where i.runtime_state <> 'consumed'
   and i.kind = 'weapon' and i.rarity = 'Legendary'
   and i.payload ->> 'weaponType' in ('Pistol', 'SMG', 'Shotgun', 'Sniper', 'Launcher', 'Beam')
   and i.payload ->> 'manufacturer' in ('Redline', 'Ironwood', 'BlastForge', 'Prismatek', 'ThrowTech', 'HelixWorks')
on conflict do nothing;

-- Effects + frames from items in surviving verified-ledger results:
-- salvaged (cc_recycle_item), market-bought (cc_accept_listing),
-- cache-forged (cc_make_item). The result item is the item_instances
-- row JSON in all three.
insert into public.collection_discoveries(user_id, family, entry_key, source)
select distinct l.user_id, 'legendary_effect',
       l.result_payload -> 'item' -> 'payload' ->> 'legendaryEffectId',
       case l.action_type
         when 'cc_recycle_item' then 'backfill_salvaged'
         when 'cc_accept_listing' then 'backfill_market'
         else 'backfill_cache'
       end
  from public.verified_action_ledger l
 where l.action_type in ('cc_recycle_item', 'cc_accept_listing', 'cc_make_item')
   and l.result_payload -> 'item' -> 'payload' ->> 'legendaryEffectId'
       in ('debt_collector', 'warranty_void', 'ricochet_gospel', 'bad_decision', 'glass_sun', 'the_accountant', 'armor_eater', 'thunder_receipt', 'second_opinion', 'salvage_rights', 'overclocked', 'borrowed_time', 'kickback', 'vampiric_ledger', 'echo_chamber', 'insurance_fraud_weapon', 'market_crash', 'stable_loop', 'phase_shifter', 'hot_swapper', 'chain_lightning', 'molten_core', 'cryo_stasis', 'void_bargain', 'jackpot')
on conflict do nothing;

insert into public.collection_discoveries(user_id, family, entry_key, source)
select distinct l.user_id, 'weapon_frame',
       (l.result_payload -> 'item' -> 'payload' ->> 'weaponType') || ':'
         || (l.result_payload -> 'item' -> 'payload' ->> 'manufacturer'),
       case l.action_type
         when 'cc_recycle_item' then 'backfill_salvaged'
         when 'cc_accept_listing' then 'backfill_market'
         else 'backfill_cache'
       end
  from public.verified_action_ledger l
 where l.action_type in ('cc_recycle_item', 'cc_accept_listing', 'cc_make_item')
   and l.result_payload -> 'item' ->> 'kind' = 'weapon'
   and l.result_payload -> 'item' ->> 'rarity' = 'Legendary'
   and l.result_payload -> 'item' -> 'payload' ->> 'weaponType'
       in ('Pistol', 'SMG', 'Shotgun', 'Sniper', 'Launcher', 'Beam')
   and l.result_payload -> 'item' -> 'payload' ->> 'manufacturer'
       in ('Redline', 'Ironwood', 'BlastForge', 'Prismatek', 'ThrowTech', 'HelixWorks')
on conflict do nothing;

-- Boss victories recorded on the profile.
insert into public.collection_discoveries(user_id, family, entry_key, source)
select p.id, 'boss', b.boss_id, 'backfill_victory'
  from public.profiles p,
       jsonb_array_elements_text(
         coalesce(p.boss_state -> 'defeatedBossIds', '[]'::jsonb)) as b(boss_id)
 where b.boss_id in ('dune_tyrant', 'siltstalker', 'heap_guard', 'ashgut', 'mirage_duster', 'rust_prophet', 'scrap_bishop', 'spinneret_widow', 'mnemosyne_mirror', 'static_choir', 'verdant_maw', 'sister_null', 'vaultkeeper_omega')
on conflict do nothing;

-- Named elites from surviving roaming.elite_kill ledger rows.
insert into public.collection_discoveries(user_id, family, entry_key, source)
select distinct l.user_id, 'named_elite', l.result_payload ->> 'area_id',
       'backfill_elite'
  from public.verified_action_ledger l
 where l.action_type = 'roaming.elite_kill'
   and l.result_payload ->> 'area_id' in ('dustwaste_frontier', 'redline_circuit', 'ironwood_bastion', 'blastforge_yards', 'prismatek_reactor', 'throwtech_dumpnet', 'helixworks_labyrinth')
on conflict do nothing;
