-- 0080: Auto-Salvage Rules made real — the profile-owned rule + the
-- claim-settlement salvage pass (owner-approved scope, 2026-11-04).
--
-- The defect: Settings' "Auto-Salvage Rules" card (max rarity, max
-- roll quality, yield toggle) wrote only the client store and the
-- runtime snapshot. NOTHING consumed them — the client engine that
-- honored the rule died in the architecture-hardening era, and when
-- the Chef took over drops the rule was never re-implemented
-- server-side. The Chef (src/server) had zero references to it and
-- the reserved 'auto_salvage' tick tone was never emitted. Players'
-- Commons piled up exactly as if the rule were off.
--
-- This migration gives the rule its first real implementation:
--
--   §1 profiles gains the rule columns (the runtime snapshot is
--      hydration support, NOT economy authority — AGENTS.md — so the
--      rule lives on the profile row). Defaults are the client's
--      shipped defaults: enabled, Common, roll quality 20, scrap
--      yield. A one-time backfill adopts each player's saved rule
--      from their runtime snapshot's idle block, validated value by
--      value; anything unreadable keeps the default.
--
--   §2 cc_set_auto_salvage_rule — the Settings write path (the Chef
--      route derives the actor from the JWT; validation reports as
--      data, the cc_set_offline_cap_limiter / cc_set_username
--      pattern). 'Legendary' is refused as a ceiling at EVERY
--      layer — the §1 column check, this setter, the §3 ceiling
--      map, and the Settings card's options all stop at Epic —
--      exactly like cc_recycle_batch (0055): legendaries are never
--      swept by a bulk rule — they recycle one at a time,
--      deliberately. (The §3 eligible-set CASE still ranks a
--      Legendary ITEM 5: that is the item's own rarity, and ranking
--      it above every legal ceiling is what keeps it unsalvageable.)
--
--   §3 cc_auto_salvage_claim_items — the settlement pass. The claim
--      routes call it with the ids of the items THIS claim just
--      stored (roaming claims and offline settlements only — the
--      function's callers are those two routes; boss attempts, cache
--      openings, market deliveries and craft completions never reach
--      it, and it re-derives eligibility from the item rows
--      themselves). Each eligible item is recycled by the EXISTING
--      cc_recycle_item (chain head: 0069) under the derived nonce
--      'autosalvage:<source>:<claim nonce>:<item id>', so the yield
--      is the manual-salvage formula verbatim — cc_salvage_scrap
--      base, Market Crash 4x, Hoarder's Instinct salvageBonus
--      (scav_major_1), King of Scrap lowRarityScrapBonus +
--      commonMaterialChance (scav_keystone), legendary cores — and
--      every item lands its own verified_action_ledger row, which
--      the Activity Log projection renders as a salvage record (the
--      projection reads the ':autosalvage:' nonce marker to label it
--      as an auto-salvage). NOTHING is retroactive: only the ids
--      handed in are candidates; existing inventory is never swept.
--
-- Eligibility mirrors cc_recycle_batch's set discipline, narrowed
-- to the Settings card's own semantics:
--   owned by the actor, runtime_state = 'available', not locked,
--   gear kinds only (weapon / shield / ordnance / classMod / relic —
--   vehicles and cosmetics keep their own lanes), rarity at or
--   under the rule's ceiling, AND roll quality at or under the
--   rule's cap. The quality leg reads the payload's rollQuality —
--   the one persisted roll (weapons carry it; other gear kinds
--   persist no roll, so for them the rarity leg alone decides).
--
-- Yield toggle (auto_salvage_to_materials): manual salvage has no
-- materials mode — cc_recycle_item pays scrap (into the unified
-- materials['Scrap'] stock), cores, and the King of Scrap bonus
-- material. So the toggle's semantics are BUILT here, plainly: with
-- the toggle on, the item's scrap award (the full cc_recycle_item
-- computation, skill bonuses included) is converted instead of
-- paid — the award is removed from the Scrap stock and the item
-- breaks down into +1 of its kind-mapped crafting material (the
-- SALVAGE_MATERIAL_BY_KIND convention cc_recycle_item itself uses
-- for the King of Scrap bonus: weapon → BallisticParts, shield /
-- ordnance → ReactiveComponents, classMod / relic → TechFragments).
-- Cores and the King of Scrap bonus-material roll are unaffected.
-- The summary reports the converted amount as converted_scrap so
-- the trade is never invisible.
--
-- Exactly-once: the claim routes' own guards (tick watermark 409 /
-- settlement nonce) keep a settlement from ever running twice, and
-- the pass itself is replay-safe — eligible items are 'available'
-- only until recycled, and cc_recycle_item's derived-nonce ledger
-- rows return the original award instead of paying twice.
--
-- Provenance: cc_recycle_item is CALLED, not restated (chain head
-- 0069_scrap_merge.sql §3, itself restated from 0053). No existing
-- function is restated by this migration; cc_apply_chef_rewards and
-- cc_settle_offline_roaming (chain head 0069) are deliberately NOT
-- touched — the pass runs as its own call so claim amounts for
-- non-salvaged items cannot move (a parallel fix made the claim
-- tests hermetic against the hot-area rotation; this migration
-- stays out of that blast radius entirely).

-- ---------------------------------------------------------------------
-- §1. The rule columns + snapshot backfill.
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists auto_salvage_enabled boolean not null default true,
  add column if not exists auto_salvage_max_rarity text not null default 'Common',
  add column if not exists auto_salvage_max_quality integer not null default 20,
  add column if not exists auto_salvage_to_materials boolean not null default false;

alter table public.profiles
  drop constraint if exists profiles_auto_salvage_max_rarity_check,
  add constraint profiles_auto_salvage_max_rarity_check
    check (auto_salvage_max_rarity in ('Common', 'Uncommon', 'Rare', 'Epic')),
  drop constraint if exists profiles_auto_salvage_max_quality_check,
  add constraint profiles_auto_salvage_max_quality_check
    check (auto_salvage_max_quality between 0 and 100);

-- One-time backfill: adopt the rule each player already saved into
-- their runtime snapshot (snapshot.idle.*, written by
-- runtimeSupabaseSync). Every value is validated before adoption —
-- an out-of-set rarity or unreadable quality keeps the column
-- default; the snapshot carries no enabled flag (the shipped card
-- had no off switch), so enabled stays at its default true.
update public.profiles p
   set auto_salvage_max_rarity = case
         when s.snapshot -> 'idle' ->> 'autoSalvageRarity' in ('Common', 'Uncommon', 'Rare', 'Epic')
           then s.snapshot -> 'idle' ->> 'autoSalvageRarity'
         else p.auto_salvage_max_rarity
       end,
       auto_salvage_max_quality = case
         when (s.snapshot -> 'idle' ->> 'autoSalvageQuality') ~ '^[0-9]{1,3}$'
           then least(100, greatest(0, (s.snapshot -> 'idle' ->> 'autoSalvageQuality')::integer))
         else p.auto_salvage_max_quality
       end,
       auto_salvage_to_materials = case
         when (s.snapshot -> 'idle' -> 'autoSalvageToMaterials') = 'true'::jsonb then true
         when (s.snapshot -> 'idle' -> 'autoSalvageToMaterials') = 'false'::jsonb then false
         else p.auto_salvage_to_materials
       end
  from public.player_runtime_snapshots s
 where s.user_id = p.id
   and s.snapshot ? 'idle';

-- ---------------------------------------------------------------------
-- §2. cc_set_auto_salvage_rule — the Settings write.
-- ---------------------------------------------------------------------

create or replace function public.cc_set_auto_salvage_rule(
  _player_id uuid,
  _enabled boolean,
  _max_rarity text,
  _max_quality integer,
  _to_materials boolean
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if _player_id is null then raise exception 'Authentication required'; end if;
  if _max_rarity is null or _max_rarity not in ('Common', 'Uncommon', 'Rare', 'Epic') then
    return jsonb_build_object('ok', false, 'error', 'Max rarity must be Common, Uncommon, Rare, or Epic — legendaries are never auto-salvaged.');
  end if;
  if _max_quality is null or _max_quality < 0 or _max_quality > 100 then
    return jsonb_build_object('ok', false, 'error', 'Max roll quality must be between 0 and 100.');
  end if;

  update public.profiles
     set auto_salvage_enabled = coalesce(_enabled, true),
         auto_salvage_max_rarity = _max_rarity,
         auto_salvage_max_quality = _max_quality,
         auto_salvage_to_materials = coalesce(_to_materials, false),
         updated_at = now()
   where id = _player_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'auto_salvage', jsonb_build_object(
      'enabled', coalesce(_enabled, true),
      'max_rarity', _max_rarity,
      'max_quality', _max_quality,
      'to_materials', coalesce(_to_materials, false)
    )
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- §3. cc_auto_salvage_claim_items — the settlement pass.
-- ---------------------------------------------------------------------

create or replace function public.cc_auto_salvage_claim_items(
  p_player_id uuid,
  p_nonce text,
  p_source text,
  p_item_ids text[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  p public.profiles%rowtype;
  ceiling_rank integer;
  item_ids uuid[] := '{}'::uuid[];
  item_rarities text[] := '{}'::text[];
  item_kinds text[] := '{}'::text[];
  item_names text[] := '{}'::text[];
  item_levels integer[] := '{}'::integer[];
  r jsonb;
  i integer;
  n integer := 0;
  scrap_total integer := 0;
  converted_total integer := 0;
  cores_total integer := 0;
  counts_by_rarity jsonb := '{}'::jsonb;
  materials_out jsonb := '{}'::jsonb;
  items_out jsonb := '[]'::jsonb;
  award integer;
  mat text;
  bm text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_nonce is null or length(trim(p_nonce)) < 8 then raise exception 'nonce is required'; end if;
  if p_source is null or p_source not in ('roam', 'offline') then
    raise exception 'Invalid auto-salvage source';
  end if;

  select * into p from public.profiles where id = actor;
  if not found then raise exception 'Profile not found'; end if;

  -- Rule off (or no candidates): an honest empty settlement.
  if p.auto_salvage_enabled is distinct from true
     or p_item_ids is null or coalesce(array_length(p_item_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'action_type', 'cc_auto_salvage',
      'source', p_source,
      'enabled', coalesce(p.auto_salvage_enabled, true),
      'rule', jsonb_build_object(
        'max_rarity', p.auto_salvage_max_rarity,
        'max_quality', p.auto_salvage_max_quality,
        'to_materials', coalesce(p.auto_salvage_to_materials, false)
      ),
      'salvaged_count', 0,
      'counts_by_rarity', '{}'::jsonb,
      'scrap_award', 0,
      'converted_scrap', 0,
      'cores_award', 0,
      'materials', '{}'::jsonb,
      'items', '[]'::jsonb,
      'profile', public.cc_profile_snapshot(p)
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  ceiling_rank := case p.auto_salvage_max_rarity
    when 'Common' then 1
    when 'Uncommon' then 2
    when 'Rare' then 3
    when 'Epic' then 4
    else 0
  end;

  -- Resolve the eligible set up front (id order for determinism —
  -- the loop below mutates runtime_state as it goes). Candidates
  -- are ONLY the ids this claim stored, re-derived from the item
  -- rows themselves: owned, available, unlocked, gear kinds,
  -- rarity at/under the ceiling, and — where the payload carries a
  -- roll — roll quality at/under the cap.
  select coalesce(array_agg(e.id order by e.id), '{}'::uuid[]),
         coalesce(array_agg(e.rarity order by e.id), '{}'::text[]),
         coalesce(array_agg(e.kind order by e.id), '{}'::text[]),
         coalesce(array_agg(coalesce(e.payload ->> 'name', '') order by e.id), '{}'::text[]),
         coalesce(array_agg(coalesce(e.item_level, 1) order by e.id), '{}'::integer[])
    into item_ids, item_rarities, item_kinds, item_names, item_levels
    from (
      select ii.*,
             case
               when (ii.payload ->> 'rollQuality') ~ '^[0-9]+(\.[0-9]+)?$'
                 then (ii.payload ->> 'rollQuality')::numeric
               else null
             end as roll_q
        from public.item_instances ii
       where ii.owner_user_id = actor
         and (ii.id::text = any(p_item_ids) or ii.payload ->> 'id' = any(p_item_ids))
    ) e
   where e.runtime_state = 'available'
     and e.is_locked = false
     and e.kind in ('weapon', 'shield', 'ordnance', 'classMod', 'relic')
     and (case e.rarity
            when 'Common' then 1
            when 'Uncommon' then 2
            when 'Rare' then 3
            when 'Epic' then 4
            when 'Legendary' then 5
            else 99
          end) <= ceiling_rank
     and (e.roll_q is null or e.roll_q <= p.auto_salvage_max_quality);

  n := coalesce(array_length(item_ids, 1), 0);

  for i in 1 .. n loop
    r := public.cc_recycle_item(
      actor,
      'autosalvage:' || p_source || ':' || p_nonce || ':' || item_ids[i]::text,
      item_ids[i]
    );
    award := coalesce((r ->> 'scrap_award')::integer, 0);
    cores_total := cores_total + coalesce((r ->> 'cores_award')::integer, 0);
    counts_by_rarity := jsonb_set(
      counts_by_rarity,
      array[item_rarities[i]],
      to_jsonb(coalesce((counts_by_rarity ->> item_rarities[i])::integer, 0) + 1),
      true
    );

    mat := null;
    if coalesce(p.auto_salvage_to_materials, false) and award > 0 then
      -- Yield conversion (the header's built semantics): the scrap
      -- award comes back out of the unified Scrap stock and the
      -- item breaks down into +1 of its kind-mapped material.
      mat := case item_kinds[i]
        when 'weapon' then 'BallisticParts'
        when 'shield' then 'ReactiveComponents'
        when 'ordnance' then 'ReactiveComponents'
        when 'classMod' then 'TechFragments'
        when 'relic' then 'TechFragments'
        else 'Scrap'
      end;
      if mat = 'Scrap' then
        -- Kinds outside the map keep their scrap (the fallback
        -- material IS scrap) — nothing converts, nothing is lost.
        mat := null;
        scrap_total := scrap_total + award;
      else
        converted_total := converted_total + award;
        update public.profiles
           set materials = jsonb_set(
                 jsonb_set(
                   coalesce(materials, '{}'::jsonb),
                   '{Scrap}',
                   to_jsonb(greatest(0, coalesce((materials ->> 'Scrap')::bigint, 0) - award)),
                   true
                 ),
                 array[mat],
                 to_jsonb(coalesce((materials ->> mat)::bigint, 0) + 1),
                 true
               )
         where id = actor;
        materials_out := jsonb_set(
          materials_out,
          array[mat],
          to_jsonb(coalesce((materials_out ->> mat)::integer, 0) + 1),
          true
        );
      end if;
    else
      scrap_total := scrap_total + award;
    end if;

    -- King of Scrap bonus material (already paid by cc_recycle_item).
    bm := r ->> 'bonus_material';
    if bm is not null then
      materials_out := jsonb_set(
        materials_out,
        array[bm],
        to_jsonb(coalesce((materials_out ->> bm)::integer, 0) + 1),
        true
      );
    end if;

    items_out := items_out || jsonb_build_array(jsonb_build_object(
      'id', item_ids[i]::text,
      'name', item_names[i],
      'kind', item_kinds[i],
      'rarity', item_rarities[i],
      'level', item_levels[i],
      'scrap_award', award,
      'bonus_material', bm,
      'converted_material', mat
    ));
  end loop;

  select * into p from public.profiles where id = actor;

  return jsonb_build_object(
    'action_type', 'cc_auto_salvage',
    'source', p_source,
    'enabled', true,
    'rule', jsonb_build_object(
      'max_rarity', p.auto_salvage_max_rarity,
      'max_quality', p.auto_salvage_max_quality,
      'to_materials', coalesce(p.auto_salvage_to_materials, false)
    ),
    'salvaged_count', n,
    'counts_by_rarity', counts_by_rarity,
    'scrap_award', scrap_total,
    'converted_scrap', converted_total,
    'cores_award', cores_total,
    'materials', materials_out,
    'items', items_out,
    'profile', public.cc_profile_snapshot(p)
  );
end;
$function$;
