-- 0022_salvage_skill_bonuses.sql
--
-- Phase 2d (keystone skill layer): cc_recycle_item gains the
-- Scavenger salvage wiring. Three skill effects live on the salvage
-- path and previously had no consumer anywhere:
--
--   - Hoarder's Instinct (scav_major_1) `salvageBonus` 0.25:
--     every salvage pays +25% bonus scrap.
--   - King of Scrap (scav_keystone) `lowRarityScrapBonus` 1.0:
--     Common/Uncommon salvage pays double.
--   - King of Scrap (scav_keystone) `commonMaterialChance` 0.25:
--     salvaging a Common yields a bonus crafting material, mapped
--     from the item kind by the salvageRules convention (weapon →
--     BallisticParts, shield/ordnance → ReactiveComponents,
--     classMod/relic → TechFragments, anything else → ScrapAlloy).
--
-- The bonuses are derived from the player's OWN database records —
-- profiles.skill_spends plus the equipped class mod payload —
-- inside the transaction, mirroring computeSkillBonuses for these
-- two nodes with the exact pattern migration 0017 established for
-- the market fee (effective points = spends + nodeBoosts, then the
-- class mod's Scavenger treeBonus adds +1 capped at maxPoints = 1).
-- The TS owner of the math is src/lib/skills/salvageBonuses.ts; the
-- in-memory store twins call it directly and parity tests pin both.
--
-- Everything else is the 0008 definition verbatim: same validation,
-- same nonce replay, same Market Crash 4x, same result shape plus
-- one additive field ('bonus_material', null when no grant).

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
    'bonus_material', bonus_material,
    'loadout', public.cc_loadout_snapshot(actor)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_recycle_item', nonce, result);

  return result;
end;
$function$;

-- Dormant seed-copy sync: public.skill_node_definitions (seeded by
-- 0004) is read by nothing at runtime — src/constants/skillTrees.ts
-- is the single source of truth for node defs — but the two nodes
-- whose effects were REPLACED in this slice, and Insurance Fraud's
-- corrected description, are updated here so the seeded copy cannot
-- drift from the shipped defs.
update public.skill_node_definitions
set description = 'Salvaging gear grants +25% bonus scrap.',
    effects = '{"salvageBonus":0.25}'::jsonb
where id = 'scav_major_1';

update public.skill_node_definitions
set description = 'Consumables used in a victorious boss fight have a 50% chance to be refunded.'
where id = 'scav_major_2';

update public.skill_node_definitions
set description = '+15% Rare Drop Chance.',
    effects = '{"rareDropChance":0.15}'::jsonb
where id = 'scav_major_4';
