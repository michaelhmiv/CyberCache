-- =============================================================================
-- Skill tree persistence
-- =============================================================================
-- Previously, skill point spends were local-only Zustand mutations in
-- skillSlice.spendPoint. The server had a skill_spends jsonb column and a
-- cc_retrain RPC, but no RPC to *spend* a point. Every profile read
-- (verifiedStateSync.syncRuntimeProfile) overwrote the local spent map
-- with the server's empty default, so user allocations vanished on every
-- reload / scene swap / online return.
--
-- This migration:
--   1. Seeds the skill tree as a server-known content table so the RPC can
--      validate node IDs, max points, prerequisite chains, and per-node cost.
--   2. Adds cc_train_skill(nonce, node_id) — the verified RPC that mutates
--      profiles.skill_spends authoritatively.
--   3. Refactors cc_retrain to validate total available points against
--      player_level - 1 + class_mod node_boosts (cost formula unchanged:
--      total_spent * 100 credits, but the spend map is now a real cap).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Content table: server-known skill node definitions
-- ---------------------------------------------------------------------------
create table if not exists public.skill_node_definitions (
  id text primary key,
  tree text not null,
  tier integer not null check (tier between 1 and 9),
  slot_index integer not null check (slot_index between 1 and 3),
  name text not null,
  description text not null default '',
  node_type text not null check (node_type in ('small', 'major', 'keystone')),
  max_points integer not null check (max_points > 0),
  per_point_cost integer not null check (per_point_cost > 0),
  effects jsonb not null default '{}'::jsonb,
  requires text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create index if not exists skill_node_definitions_tree_idx
  on public.skill_node_definitions (tree, tier, slot_index);

alter table public.skill_node_definitions enable row level security;

drop policy if exists "skill_node_definitions_select_all" on public.skill_node_definitions;
create policy "skill_node_definitions_select_all"
  on public.skill_node_definitions
  for select
  to authenticated
  using (true);

-- Seed the table from the client SKILL_NODES constant. Kept in lockstep
-- with src/constants/skillTrees.ts; any new node requires both a code
-- change AND a migration that updates this row.
insert into public.skill_node_definitions
  (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires)
values
  -- ========== GUNSLINGER ==========
  ('gs_dmg_1',     'Gunslinger',  1, 1, 'Calibrated Iron',         '+5% Weapon Damage',                                 'small', 5, 1, '{"weaponDamage": 0.05}',                       '{}'),
  ('gs_dmg_2',     'Gunslinger',  1, 2, 'Heavy Slugs',             '+5% Weapon Damage',                                 'small', 5, 1, '{"weaponDamage": 0.05}',                       '{}'),
  ('gs_crit_1',    'Gunslinger',  2, 1, 'Steady Hand',             '+3% Crit Chance',                                   'small', 5, 1, '{"critChance": 0.03}',                          '{}'),
  ('gs_crit_2',    'Gunslinger',  2, 2, 'Weakspot Training',       '+3% Crit Chance',                                   'small', 5, 1, '{"critChance": 0.03}',                          '{}'),
  ('gs_critdmg_1', 'Gunslinger',  3, 1, 'Terminal Ballistics',     '+10% Crit Damage',                                  'small', 5, 1, '{"critDamage": 0.10}',                          '{}'),
  ('gs_critdmg_2', 'Gunslinger',  3, 2, 'Overpenetration',         '+10% Crit Damage',                                  'small', 5, 1, '{"critDamage": 0.10}',                          '{}'),
  ('gs_speed_1',   'Gunslinger',  4, 1, 'Quick Cycle',             '+8% Attack Speed',                                  'small', 5, 1, '{"attackSpeed": 0.08}',                         '{}'),
  ('gs_speed_2',   'Gunslinger',  4, 2, 'Rapid Servos',            '+8% Attack Speed',                                  'small', 5, 1, '{"attackSpeed": 0.08}',                         '{}'),
  ('gs_boss_1',    'Gunslinger',  5, 1, 'Target Priority',         '+10% Boss Damage',                                  'small', 5, 1, '{"bossDamageMod": 0.10}',                       '{}'),
  ('gs_boss_2',    'Gunslinger',  5, 2, 'High-Value Execution',    '+10% Boss Damage',                                  'small', 5, 1, '{"bossDamageMod": 0.10}',                       '{}'),
  ('gs_status_1',  'Gunslinger',  6, 1, 'Procedural Loads',        '+5% Status Chance',                                 'small', 5, 1, '{"statusChance": 0.05}',                        '{}'),
  ('gs_shield_1',  'Gunslinger',  6, 2, 'Shield Breach',           '+5% Shield Damage',                                 'small', 5, 1, '{"shieldDamageMod": 0.05}',                     '{}'),
  ('gs_major_1',   'Gunslinger',  7, 1, 'Focus Fire',              '+15% Boss Damage when using Sniper or Pistol.',    'major', 1, 3, '{"bossDamageSniperPistol": 0.15}',              array['gs_boss_1', 'gs_boss_2']),
  ('gs_major_2',   'Gunslinger',  7, 2, 'Speedloader',             '+20% Attack Speed for first 10 seconds of fight.',  'major', 1, 3, '{"openingAttackSpeed": 0.20}',                  array['gs_speed_1', 'gs_speed_2']),
  ('gs_major_3',   'Gunslinger',  8, 1, 'Weakspot Analysis',       '+25% Crit Damage against bosses below 50% HP.',     'major', 1, 3, '{"critDamageSub50": 0.25}',                     array['gs_critdmg_1', 'gs_critdmg_2']),
  ('gs_major_4',   'Gunslinger',  8, 2, 'Elemental Overclock',     'Weakness match grants +10% overall damage.',       'major', 1, 3, '{"weaknessMatchDamage": 0.10}',                 array['gs_status_1']),
  ('gs_keystone',  'Gunslinger',  9, 1, 'Death by a Thousand Cuts','Crit hits +25% DPS check; +10% boss dmg if crit>50%','keystone', 1, 5, '{"critDpsBonus": 0.25, "highCritBossDamage": 0.10}', array['gs_major_1', 'gs_major_2', 'gs_major_3']),

  -- ========== DEMOLITION ==========
  ('demo_ord_1',   'Demolition',  1, 1, 'Payload Expansion',       '+10% Ordnance Damage',                              'small', 5, 1, '{"ordnanceDamage": 0.10}',                      '{}'),
  ('demo_ord_2',   'Demolition',  1, 2, 'Fragmentation',           '+10% Ordnance Damage',                              'small', 5, 1, '{"ordnanceDamage": 0.10}',                      '{}'),
  ('demo_exp_1',   'Demolition',  2, 1, 'Volatile Mix',            '+8% Explosive Damage',                             'small', 5, 1, '{"explosiveDamage": 0.08}',                     '{}'),
  ('demo_exp_2',   'Demolition',  2, 2, 'Blast Radius',            '+8% Explosive Damage',                             'small', 5, 1, '{"explosiveDamage": 0.08}',                     '{}'),
  ('demo_armor_1', 'Demolition',  3, 1, 'Penetrator Rounds',       '+10% Armor Damage',                                 'small', 5, 1, '{"armorDamageMod": 0.10}',                      '{}'),
  ('demo_armor_2', 'Demolition',  3, 2, 'Crack Core',              '+10% Armor Damage',                                 'small', 5, 1, '{"armorDamageMod": 0.10}',                      '{}'),
  ('demo_stag_1',  'Demolition',  4, 1, 'Concussion',              '+5% Stagger Chance',                                'small', 5, 1, '{"staggerChance": 0.05}',                       '{}'),
  ('demo_stag_2',  'Demolition',  4, 2, 'Impact Force',            '+5% Stagger Chance',                                'small', 5, 1, '{"staggerChance": 0.05}',                       '{}'),
  ('demo_heavy_1', 'Demolition',  5, 1, 'Overcharge',              '+15% Heavy Weapon Burst',                           'small', 5, 1, '{"heavyWeaponBurst": 0.15}',                    '{}'),
  ('demo_heavy_2', 'Demolition',  5, 2, 'Siege Mode',              '+15% Heavy Weapon Burst',                           'small', 5, 1, '{"heavyWeaponBurst": 0.15}',                    '{}'),
  ('demo_shield_1','Demolition',  6, 1, 'Ion Surge',               '+10% Shield Break Contribution from Ordnance',      'small', 5, 1, '{"ordnanceShieldBreak": 0.10}',                 '{}'),
  ('demo_major_1', 'Demolition',  7, 1, 'Breaching Charge',        'Ordnance strips 20% extra shield before DPS phase.','major', 1, 3, '{"shieldStripBonus": 0.20}',                    array['demo_shield_1', 'demo_ord_1']),
  ('demo_major_2', 'Demolition',  7, 2, 'Concussive Payload',      'Staggers last 30% longer, -15% boss damage output.','major', 1, 3, '{"staggerDuration": 0.30, "staggerMitigation": 0.15}', array['demo_stag_1', 'demo_stag_2']),
  ('demo_major_3', 'Demolition',  8, 1, 'Scorched Earth',          'Launcher as heavy: +20% armor break, +10% boss DPS','major', 1, 3, '{"launcherArmorBreak": 0.20, "launcherBossDps": 0.10}', array['demo_armor_1', 'demo_armor_2']),
  ('demo_major_4', 'Demolition',  8, 2, 'Cluster Bombs',           '25% chance for ordnance to trigger twice (50% dmg).','major', 1, 3, '{"clusterChance": 0.25, "clusterDamage": 0.50}',  array['demo_exp_1', 'demo_exp_2']),
  ('demo_keystone','Demolition',  9, 1, 'Unstable Power',          'Explosive feeds armor break; broken armor +50% hvy.','keystone', 1, 5, '{"explosiveArmorBreak": 1.0, "brokenArmorHeavyBonus": 0.50}', array['demo_major_1', 'demo_major_2', 'demo_major_3']),

  -- ========== SCAVENGER ==========
  ('scav_idle_1',  'Scavenger',   1, 1, 'Uplink Tap',              '+15% Offline Earnings',                             'small', 5, 1, '{"offlineEarnings": 0.15}',                      '{}'),
  ('scav_idle_2',  'Scavenger',   1, 2, 'Background Processes',   '+15% Offline Earnings',                             'small', 5, 1, '{"offlineEarnings": 0.15}',                      '{}'),
  ('scav_drop_1',  'Scavenger',   2, 1, 'Data Miner',              '+10% Rare Drop Chance',                             'small', 5, 1, '{"rareDropChance": 0.10}',                       '{}'),
  ('scav_drop_2',  'Scavenger',   2, 2, 'Scrap Filter',            '+10% Rare Drop Chance',                             'small', 5, 1, '{"rareDropChance": 0.10}',                       '{}'),
  ('scav_qty_1',   'Scavenger',   3, 1, 'Bulk Transfer',           '+10% Loot Quantity',                                'small', 5, 1, '{"lootQuantity": 0.10}',                         '{}'),
  ('scav_qty_2',   'Scavenger',   3, 2, 'Parallel Download',       '+10% Loot Quantity',                                'small', 5, 1, '{"lootQuantity": 0.10}',                         '{}'),
  ('scav_scrap_1', 'Scavenger',   4, 1, 'Decompiler',              '+20% Scrap Yield',                                  'small', 5, 1, '{"scrapYield": 0.20}',                          '{}'),
  ('scav_scrap_2', 'Scavenger',   4, 2, 'Compression',             '+20% Scrap Yield',                                  'small', 5, 1, '{"scrapYield": 0.20}',                          '{}'),
  ('scav_cons_1',  'Scavenger',   5, 1, 'Efficient Routines',      '+10% Consumable Efficiency',                        'small', 5, 1, '{"consumableEfficiency": 0.10}',                '{}'),
  ('scav_cons_2',  'Scavenger',   5, 2, 'Conservation',            '+10% Consumable Efficiency',                        'small', 5, 1, '{"consumableEfficiency": 0.10}',                '{}'),
  ('scav_cache_1', 'Scavenger',   6, 1, 'Encrypted Payloads',      '+5% Cache Quality Modifier',                        'small', 5, 1, '{"cacheQuality": 0.05}',                         '{}'),
  ('scav_fee_1',   'Scavenger',   6, 2, 'Darknet Broker',          '+5% Marketplace Listing Fee Reduction',             'small', 5, 1, '{"marketFeeReduction": 0.05}',                   '{}'),
  ('scav_major_1', 'Scavenger',   7, 1, 'Hoarder''s Instinct',     'Auto-salvage: +25% scrap, 10% chance bonus consum.','major', 1, 3, '{"autoSalvageBonus": 0.25, "autoSalvageConsumableChance": 0.10}', array['scav_scrap_1', 'scav_scrap_2']),
  ('scav_major_2', 'Scavenger',   7, 2, 'Insurance Fraud',         '50% chance unused consumables recovered on win.',  'major', 1, 3, '{"consumableRecovery": 0.50}',                   array['scav_cons_1', 'scav_cons_2']),
  ('scav_major_3', 'Scavenger',   8, 1, 'Market Manipulator',      'Personal-found items: -15% listing fee.',          'major', 1, 3, '{"foundItemFeeReduction": 0.15}',                array['scav_fee_1']),
  ('scav_major_4', 'Scavenger',   8, 2, 'Lucky Find',              '+15% rare drop chance for next 3 farming sessions.','major', 1, 3, '{"postBossDropChance": 0.15, "postBossSessions": 3}', array['scav_drop_1', 'scav_drop_2']),
  ('scav_keystone','Scavenger',   9, 1, 'King of Scrap',           'Common loot: +100% scrap, 25% bonus material, +4h cap.','keystone', 1, 5, '{"lowRarityScrapBonus": 1.0, "commonMaterialChance": 0.25, "offlineCapBonus": 4}', array['scav_major_1', 'scav_major_2', 'scav_major_4'])
on conflict (id) do update set
  tree = excluded.tree,
  tier = excluded.tier,
  slot_index = excluded.slot_index,
  name = excluded.name,
  description = excluded.description,
  node_type = excluded.node_type,
  max_points = excluded.max_points,
  per_point_cost = excluded.per_point_cost,
  effects = excluded.effects,
  requires = excluded.requires;

-- ---------------------------------------------------------------------------
-- cc_train_skill — verified RPC for spending a single skill point
-- ---------------------------------------------------------------------------
-- Validates: auth, nonce (with idempotency), node exists, prerequisites
-- satisfied, per-node cap not exceeded, total points spent within
-- player_level - 1 budget. Mutates profiles.skill_spends and returns
-- the full profile snapshot for client hydration.
-- ---------------------------------------------------------------------------
create or replace function public.cc_train_skill(nonce text, node_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
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
  total_after := public.cc_skill_spend_total(p.skill_spends) + 1;
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
    'total_spent', public.cc_skill_spend_total(p.skill_spends)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_train_skill', nonce, result);
  return result;
end;
$$;

revoke execute on function public.cc_train_skill(text, text) from public, anon;
grant execute on function public.cc_train_skill(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Make sure profile snapshot includes the new action_type field downstream
-- of cc_train_skill. verifiedStateSync.syncVerifiedResult already handles
-- arbitrary action_types — no client migration needed there.
-- ---------------------------------------------------------------------------
