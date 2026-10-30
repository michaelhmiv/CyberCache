-- Route B, slice B3: write-side game schema + write functions on plain
-- Postgres (Railway). Ports the final state of the Supabase migrations
-- that the write surface depends on (B0 rehearsal: the source migrations
-- apply cleanly; this file consolidates their end state, minus RLS and
-- minus every auth.uid()).
--
-- What lands here:
-- * The game tables the write APIs need that 0003 did not already
--   create: verified_action_ledger (the nonce/idempotency ledger every
--   verified op writes), active_actions, player_runtime_snapshots,
--   user_push_devices, user_notification_settings, notification_events,
--   ad_reward_grants, consumable_batches, consumable_events,
--   service_jobs, escrow_records, player_professions, odds_tables,
--   odds_outcomes, roaming_areas, skill_node_definitions.
-- * Content seeds the write functions read, at their final migrated
--   state: odds tables/outcomes, skill node definitions, roaming
--   areas, mastery definitions (0003 created mastery_definitions
--   unseeded; player_masteries FK + the ledger mastery trigger need
--   the rows).
-- * The cc_* write functions and their helper closure. Authorization
--   used to be RLS + auth.uid(); here the Chef is the only caller
--   (service connection) and identity is an explicit p_player_id
--   parameter, resolved by the Chef from the verified JWT. The 29
--   client-facing ops gained p_player_id as their first parameter and
--   every auth.uid() became that parameter; internal helpers that
--   already took explicit ids keep their signatures verbatim.
--   (cc_validate_username / cc_is_username_available are not repeated:
--   0003 already defines them.)
-- * The write-path triggers that used to ride along in Supabase:
--   touch_updated_at on profiles/item_instances/active_actions,
--   item net-worth recalculation, the starter-weapon seed on profile
--   insert, and the verified_action_ledger triggers (mastery/stat
--   application + progression snapshots for Chef-applied rewards).
--
-- Chef-internal appliers (cc_apply_chef_rewards, cc_settle_offline_
-- roaming, cc_apply_chef_boss_attempt, cc_store_chef_items) are NOT
-- ported here: they take explicit player ids already and belong to
-- the TS Chef claim/settle/boss routes, which still run on the
-- Supabase service client in this slice.
--
-- THREE deliberate deviations from the extracted source state, all
-- cases where the extracted text cannot execute on plain Postgres:
-- 1. cc_hash_string and cc_mulberry32_next multiply two 32-bit values
--    in bigint arithmetic, and the intermediate product overflows
--    bigint for most inputs ('bigint out of range') — in production
--    the roaming claim's failure is masked by the client's idle-
--    claim fallback. Both multiplications are computed via numeric
--    + mod here, yielding the identical low-32-bit result the
--    algorithm intends (matching the TS mirror's Math.imul math).
-- 2. Two plpgsql name collisions of the same class: in
--    cc_consume_consumable's legacy-batch probe a bare `quantity > 0`
--    inside a subquery on consumable_batches matches both the column
--    and the function parameter, and in cc_claim_crafted_consumable
--    `max(mastery_level)` matches both the player_masteries column
--    and the declared variable. plpgsql raises 'column reference
--    ... is ambiguous' for both. The column references are qualified
--    (consumable_batches.quantity / player_masteries.mastery_level),
--    which is the only meaning either site can have.
-- 3. A 'crafting_consumables' mastery_definitions row is seeded
--    alongside the extracted 19: cc_claim_crafted_consumable inserts
--    player_masteries rows under that id and player_masteries
--    FK-references mastery_definitions(id), so without the row every
--    craft fails on the foreign key.

-- ---------------------------------------------------------------------------
-- Tables (final migrated state; no RLS — Chef scoping replaces it)
-- ---------------------------------------------------------------------------

create table if not exists public.verified_action_ledger (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  action_type text not null,
  idempotency_key text not null,
  request_payload jsonb default '{}'::jsonb not null,
  result_payload jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  constraint verified_action_ledger_pkey PRIMARY KEY (id),
  constraint verified_action_ledger_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key),
  constraint verified_action_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
create index if not exists verified_action_ledger_user_action_idx on public.verified_action_ledger USING btree (user_id, action_type, created_at DESC);

create table if not exists public.active_actions (
  user_id uuid not null,
  active_action text default 'none'::text not null,
  started_at timestamptz,
  completes_at timestamptz,
  target_id text,
  notes text,
  updated_at timestamptz default now() not null,
  target_type text,
  target_label text,
  scene_key text,
  activity_payload jsonb default '{}'::jsonb not null,
  public_payload jsonb default '{}'::jsonb not null,
  last_heartbeat_at timestamptz,
  public_visible boolean default true not null,
  schema_version integer default 1 not null,
  constraint active_actions_pkey PRIMARY KEY (user_id),
  constraint active_actions_active_action_check CHECK ((active_action = ANY (ARRAY['none'::text, 'idle_standby'::text, 'roaming_loot'::text, 'boss_prep'::text, 'boss_fight'::text, 'crafting'::text, 'salvaging'::text, 'workshop_service'::text, 'market_listing'::text]))),
  constraint active_actions_schema_version_check CHECK ((schema_version >= 1)),
  constraint active_actions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
create index if not exists active_actions_public_visible_idx on public.active_actions USING btree (public_visible, updated_at DESC) WHERE (public_visible = true);
create index if not exists active_actions_kind_idx on public.active_actions USING btree (active_action, updated_at DESC);

create table if not exists public.player_runtime_snapshots (
  user_id uuid not null,
  schema_version integer default 1 not null,
  snapshot jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint player_runtime_snapshots_pkey PRIMARY KEY (user_id),
  constraint player_runtime_snapshots_schema_version_check CHECK ((schema_version >= 1)),
  constraint player_runtime_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
create index if not exists player_runtime_snapshots_updated_idx on public.player_runtime_snapshots USING btree (updated_at DESC);

create table if not exists public.user_push_devices (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  token text not null,
  platform text default 'android'::text not null,
  app_version text,
  enabled boolean default true not null,
  last_registered_at timestamptz default now() not null,
  last_seen_at timestamptz default now() not null,
  disabled_at timestamptz,
  metadata jsonb default '{}'::jsonb not null,
  constraint user_push_devices_pkey PRIMARY KEY (id),
  constraint user_push_devices_token_key UNIQUE (token),
  constraint user_push_devices_platform_check CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text, 'web'::text]))),
  constraint user_push_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

create table if not exists public.user_notification_settings (
  user_id uuid not null,
  offline_rewards boolean default true not null,
  crafting_complete boolean default true not null,
  marketplace_events boolean default true not null,
  cache_ready boolean default true not null,
  limited_events boolean default false not null,
  inactivity_nudges boolean default false not null,
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz default now() not null,
  constraint user_notification_settings_pkey PRIMARY KEY (user_id),
  constraint user_notification_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

create table if not exists public.notification_events (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  category text not null,
  title text not null,
  body text not null,
  payload jsonb default '{}'::jsonb not null,
  status text default 'queued'::text not null,
  provider_message_id text,
  error_message text,
  created_at timestamptz default now() not null,
  sent_at timestamptz,
  constraint notification_events_pkey PRIMARY KEY (id),
  constraint notification_events_category_check CHECK ((category = ANY (ARRAY['offline_rewards'::text, 'crafting_complete'::text, 'marketplace_events'::text, 'cache_ready'::text, 'limited_events'::text, 'inactivity_nudges'::text, 'system'::text]))),
  constraint notification_events_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))),
  constraint notification_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

create table if not exists public.ad_reward_grants (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  idempotency_key text not null,
  ad_unit_id text not null,
  reward_type text default 'cache_key'::text not null,
  reward_amount integer default 1 not null,
  status text default 'granted'::text not null,
  granted_at timestamptz default now() not null,
  metadata jsonb default '{}'::jsonb not null,
  constraint ad_reward_grants_pkey PRIMARY KEY (id),
  constraint ad_reward_grants_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key),
  constraint ad_reward_grants_reward_amount_check CHECK ((reward_amount = 1)),
  constraint ad_reward_grants_reward_type_check CHECK ((reward_type = 'cache_key'::text)),
  constraint ad_reward_grants_status_check CHECK ((status = ANY (ARRAY['granted'::text, 'rejected'::text]))),
  constraint ad_reward_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

create table if not exists public.consumable_batches (
  id uuid default gen_random_uuid() not null,
  owner_user_id uuid not null,
  consumable_type text not null,
  quality_percent numeric(6,2) default 100 not null,
  quantity integer default 0 not null,
  origin text default 'vendor'::text not null,
  creator_user_id uuid,
  source_recipe_id text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint consumable_batches_pkey PRIMARY KEY (id),
  constraint consumable_batches_origin_check CHECK ((origin = ANY (ARRAY['vendor'::text, 'crafted'::text, 'market'::text, 'reward'::text, 'admin'::text]))),
  constraint consumable_batches_quality_percent_check CHECK (((quality_percent >= (1)::numeric) AND (quality_percent <= (250)::numeric))),
  constraint consumable_batches_quantity_check CHECK ((quantity >= 0)),
  constraint consumable_batches_creator_user_id_fkey FOREIGN KEY (creator_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint consumable_batches_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
create index if not exists consumable_batches_owner_idx on public.consumable_batches USING btree (owner_user_id);
create index if not exists consumable_batches_owner_type_idx on public.consumable_batches USING btree (owner_user_id, consumable_type);
create index if not exists consumable_batches_market_identity_idx on public.consumable_batches USING btree (consumable_type, quality_percent, origin) WHERE (quantity > 0);

create table if not exists public.consumable_events (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  batch_id uuid,
  consumable_type text not null,
  quantity_delta integer not null,
  quality_percent numeric(6,2),
  event_type text not null,
  activity_type text,
  reason text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  constraint consumable_events_pkey PRIMARY KEY (id),
  constraint consumable_events_event_type_check CHECK ((event_type = ANY (ARRAY['vendor_buy'::text, 'crafted'::text, 'market_buy'::text, 'market_sell'::text, 'used'::text, 'expired'::text, 'admin_adjust'::text, 'reset'::text]))),
  constraint consumable_events_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.consumable_batches(id) ON DELETE SET NULL,
  constraint consumable_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
create index if not exists consumable_events_user_created_idx on public.consumable_events USING btree (user_id, created_at DESC);
create index if not exists consumable_events_type_created_idx on public.consumable_events USING btree (consumable_type, created_at DESC);

create table if not exists public.odds_tables (
  id text not null,
  version integer default 1 not null,
  description text default ''::text not null,
  is_active boolean default true not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint odds_tables_pkey PRIMARY KEY (id)
);

create table if not exists public.odds_outcomes (
  table_id text not null,
  outcome text not null,
  weight integer not null,
  payload jsonb default '{}'::jsonb not null,
  constraint odds_outcomes_pkey PRIMARY KEY (table_id, outcome),
  constraint odds_outcomes_weight_check CHECK ((weight > 0)),
  constraint odds_outcomes_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.odds_tables(id) ON DELETE CASCADE
);

create table if not exists public.roaming_areas (
  id text not null,
  display_name text not null,
  unlock_level integer default 1 not null,
  payload jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  constraint roaming_areas_pkey PRIMARY KEY (id)
);

create table if not exists public.skill_node_definitions (
  id text not null,
  tree text not null,
  tier integer not null,
  slot_index integer not null,
  name text not null,
  description text default ''::text not null,
  node_type text not null,
  max_points integer not null,
  per_point_cost integer not null,
  effects jsonb default '{}'::jsonb not null,
  requires text[] default '{}'::text[] not null,
  created_at timestamptz default now() not null,
  constraint skill_node_definitions_pkey PRIMARY KEY (id),
  constraint skill_node_definitions_max_points_check CHECK ((max_points > 0)),
  constraint skill_node_definitions_node_type_check CHECK ((node_type = ANY (ARRAY['small'::text, 'major'::text, 'keystone'::text]))),
  constraint skill_node_definitions_per_point_cost_check CHECK ((per_point_cost > 0)),
  constraint skill_node_definitions_slot_index_check CHECK (((slot_index >= 1) AND (slot_index <= 3))),
  constraint skill_node_definitions_tier_check CHECK (((tier >= 1) AND (tier <= 9)))
);
create index if not exists skill_node_definitions_tree_idx on public.skill_node_definitions USING btree (tree, tier, slot_index);

create table if not exists public.player_professions (
  user_id uuid not null,
  profession_id text not null,
  level integer default 1 not null,
  xp bigint default 0 not null,
  total_crafts bigint default 0 not null,
  total_services_completed bigint default 0 not null,
  reputation_score numeric default 0 not null,
  updated_at timestamptz default now() not null,
  constraint player_professions_pkey PRIMARY KEY (user_id, profession_id),
  constraint player_professions_level_check CHECK (((level >= 1) AND (level <= 100))),
  constraint player_professions_total_crafts_check CHECK ((total_crafts >= 0)),
  constraint player_professions_total_services_completed_check CHECK ((total_services_completed >= 0)),
  constraint player_professions_xp_check CHECK ((xp >= 0)),
  constraint player_professions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

create table if not exists public.escrow_records (
  id uuid default gen_random_uuid() not null,
  status text default 'reserved'::text not null,
  payer_user_id uuid not null,
  payee_user_id uuid,
  credit_amount bigint default 0 not null,
  locked_item_instance_ids uuid[] default '{}'::uuid[] not null,
  locked_material_instance_ids uuid[] default '{}'::uuid[] not null,
  created_at timestamptz default now() not null,
  released_at timestamptz,
  constraint escrow_records_pkey PRIMARY KEY (id),
  constraint escrow_records_credit_amount_check CHECK ((credit_amount >= 0)),
  constraint escrow_records_status_check CHECK ((status = ANY (ARRAY['none'::text, 'reserved'::text, 'locked'::text, 'released'::text, 'refunded'::text, 'disputed'::text]))),
  constraint escrow_records_payee_user_id_fkey FOREIGN KEY (payee_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint escrow_records_payer_user_id_fkey FOREIGN KEY (payer_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

create table if not exists public.service_jobs (
  id uuid default gen_random_uuid() not null,
  owner_user_id uuid not null,
  provider_user_id uuid,
  profession_id text not null,
  status text default 'draft'::text not null,
  target_item_instance_id uuid not null,
  requested_service_id text not null,
  quoted_price_credits bigint,
  quoted_duration_minutes integer,
  owner_supplied_material_ids uuid[] default '{}'::uuid[] not null,
  provider_supplied_material_ids uuid[] default '{}'::uuid[] not null,
  escrow_id uuid,
  created_at timestamptz default now() not null,
  accepted_at timestamptz,
  completed_at timestamptz,
  constraint service_jobs_pkey PRIMARY KEY (id),
  constraint service_jobs_quoted_duration_minutes_check CHECK (((quoted_duration_minutes IS NULL) OR (quoted_duration_minutes > 0))),
  constraint service_jobs_quoted_price_credits_check CHECK (((quoted_price_credits IS NULL) OR (quoted_price_credits >= 0))),
  constraint service_jobs_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'listed'::text, 'quoted'::text, 'accepted'::text, 'in_escrow'::text, 'active'::text, 'completed'::text, 'cancelled'::text, 'disputed'::text]))),
  constraint service_jobs_escrow_id_fkey FOREIGN KEY (escrow_id) REFERENCES public.escrow_records(id) ON DELETE SET NULL,
  constraint service_jobs_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  constraint service_jobs_provider_user_id_fkey FOREIGN KEY (provider_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  constraint service_jobs_target_item_instance_id_fkey FOREIGN KEY (target_item_instance_id) REFERENCES public.item_instances(id) ON DELETE RESTRICT
);
create index if not exists service_jobs_owner_idx on public.service_jobs USING btree (owner_user_id, status);
create index if not exists service_jobs_provider_idx on public.service_jobs USING btree (provider_user_id, status);

-- ---------------------------------------------------------------------------
-- Content seeds (final migrated state)
-- ---------------------------------------------------------------------------

-- odds_tables: 6 rows
insert into public.odds_tables (id, version, description, is_active, created_at, updated_at) values ('cache_primary_rarity', 1, 'Primary data cache rarity: Rare 60%, Epic 32%, Legendary 8%.', true, '2026-10-29T23:37:16.138Z'::timestamptz, '2026-10-29T23:37:16.138Z'::timestamptz) on conflict do nothing;
insert into public.odds_tables (id, version, description, is_active, created_at, updated_at) values ('cache_second_drop', 1, 'Second data cache drop: none 60%, Rare 20%, Epic 20%.', true, '2026-10-29T23:37:16.138Z'::timestamptz, '2026-10-29T23:37:16.138Z'::timestamptz) on conflict do nothing;
insert into public.odds_tables (id, version, description, is_active, created_at, updated_at) values ('cache_third_drop', 1, 'Third data cache drop: none 85%, Epic 15%.', true, '2026-10-29T23:37:16.138Z'::timestamptz, '2026-10-29T23:37:16.138Z'::timestamptz) on conflict do nothing;
insert into public.odds_tables (id, version, description, is_active, created_at, updated_at) values ('boss_attempt_balanced', 1, 'Balanced boss attempt result.', true, '2026-10-29T23:37:16.138Z'::timestamptz, '2026-10-29T23:37:16.138Z'::timestamptz) on conflict do nothing;
insert into public.odds_tables (id, version, description, is_active, created_at, updated_at) values ('boss_attempt_aggressive', 1, 'Aggressive boss attempt result.', true, '2026-10-29T23:37:16.138Z'::timestamptz, '2026-10-29T23:37:16.138Z'::timestamptz) on conflict do nothing;
insert into public.odds_tables (id, version, description, is_active, created_at, updated_at) values ('boss_attempt_defensive', 1, 'Defensive boss attempt result.', true, '2026-10-29T23:37:16.138Z'::timestamptz, '2026-10-29T23:37:16.138Z'::timestamptz) on conflict do nothing;

-- odds_outcomes: 14 rows
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('cache_primary_rarity', 'Rare', 6000, '{"rarity":"Rare"}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('cache_primary_rarity', 'Epic', 3200, '{"rarity":"Epic"}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('cache_primary_rarity', 'Legendary', 800, '{"rarity":"Legendary"}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('cache_second_drop', 'none', 6000, '{}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('cache_second_drop', 'Rare', 2000, '{"rarity":"Rare"}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('cache_second_drop', 'Epic', 2000, '{"rarity":"Epic"}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('cache_third_drop', 'none', 8500, '{}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('cache_third_drop', 'Epic', 1500, '{"rarity":"Epic"}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('boss_attempt_balanced', 'victory', 7000, '{"xp_mult":1,"credit_mult":1,"fragment_reward":1}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('boss_attempt_balanced', 'failure', 3000, '{"xp_mult":0.25,"credit_mult":0,"fragment_reward":0}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('boss_attempt_aggressive', 'victory', 6000, '{"xp_mult":1.25,"credit_mult":1.25,"fragment_reward":1}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('boss_attempt_aggressive', 'failure', 4000, '{"xp_mult":0.1,"credit_mult":0,"fragment_reward":0}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('boss_attempt_defensive', 'victory', 8000, '{"xp_mult":0.75,"credit_mult":0.75,"fragment_reward":1}'::jsonb) on conflict do nothing;
insert into public.odds_outcomes (table_id, outcome, weight, payload) values ('boss_attempt_defensive', 'failure', 2000, '{"xp_mult":0.3,"credit_mult":0,"fragment_reward":0}'::jsonb) on conflict do nothing;

-- skill_node_definitions: 50 rows
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_dmg_1', 'Gunslinger', 1, 1, 'Calibrated Iron', '+5% Weapon Damage', 'small', 5, 1, '{"weaponDamage":0.05}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_dmg_2', 'Gunslinger', 1, 2, 'Heavy Slugs', '+5% Weapon Damage', 'small', 5, 1, '{"weaponDamage":0.05}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_crit_1', 'Gunslinger', 2, 1, 'Steady Hand', '+3% Crit Chance', 'small', 5, 1, '{"critChance":0.03}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_crit_2', 'Gunslinger', 2, 2, 'Weakspot Training', '+3% Crit Chance', 'small', 5, 1, '{"critChance":0.03}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_critdmg_1', 'Gunslinger', 3, 1, 'Terminal Ballistics', '+10% Crit Damage', 'small', 5, 1, '{"critDamage":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_critdmg_2', 'Gunslinger', 3, 2, 'Overpenetration', '+10% Crit Damage', 'small', 5, 1, '{"critDamage":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_speed_1', 'Gunslinger', 4, 1, 'Quick Cycle', '+8% Attack Speed', 'small', 5, 1, '{"attackSpeed":0.08}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_speed_2', 'Gunslinger', 4, 2, 'Rapid Servos', '+8% Attack Speed', 'small', 5, 1, '{"attackSpeed":0.08}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_boss_1', 'Gunslinger', 5, 1, 'Target Priority', '+10% Boss Damage', 'small', 5, 1, '{"bossDamageMod":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_boss_2', 'Gunslinger', 5, 2, 'High-Value Execution', '+10% Boss Damage', 'small', 5, 1, '{"bossDamageMod":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_status_1', 'Gunslinger', 6, 1, 'Procedural Loads', '+5% Status Chance', 'small', 5, 1, '{"statusChance":0.05}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_shield_1', 'Gunslinger', 6, 2, 'Shield Breach', '+5% Shield Damage', 'small', 5, 1, '{"shieldDamageMod":0.05}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_major_1', 'Gunslinger', 7, 1, 'Focus Fire', '+15% Boss Damage when using Sniper or Pistol.', 'major', 1, 3, '{"bossDamageSniperPistol":0.15}'::jsonb, ARRAY['gs_boss_1', 'gs_boss_2']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_major_2', 'Gunslinger', 7, 2, 'Speedloader', '+20% Attack Speed for first 10 seconds of fight.', 'major', 1, 3, '{"openingAttackSpeed":0.2}'::jsonb, ARRAY['gs_speed_1', 'gs_speed_2']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_major_3', 'Gunslinger', 8, 1, 'Weakspot Analysis', '+25% Crit Damage against bosses below 50% HP.', 'major', 1, 3, '{"critDamageSub50":0.25}'::jsonb, ARRAY['gs_critdmg_1', 'gs_critdmg_2']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_major_4', 'Gunslinger', 8, 2, 'Elemental Overclock', 'Weakness match grants +10% overall damage.', 'major', 1, 3, '{"weaknessMatchDamage":0.1}'::jsonb, ARRAY['gs_status_1']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_keystone', 'Gunslinger', 9, 1, 'Death by a Thousand Cuts', 'Crit hits +25% DPS check; +10% boss dmg if crit>50%', 'keystone', 1, 5, '{"critDpsBonus":0.25,"highCritBossDamage":0.1}'::jsonb, ARRAY['gs_major_1', 'gs_major_2', 'gs_major_3']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_ord_1', 'Demolition', 1, 1, 'Payload Expansion', '+10% Ordnance Damage', 'small', 5, 1, '{"ordnanceDamage":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_ord_2', 'Demolition', 1, 2, 'Fragmentation', '+10% Ordnance Damage', 'small', 5, 1, '{"ordnanceDamage":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_exp_1', 'Demolition', 2, 1, 'Volatile Mix', '+8% Explosive Damage', 'small', 5, 1, '{"explosiveDamage":0.08}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_exp_2', 'Demolition', 2, 2, 'Blast Radius', '+8% Explosive Damage', 'small', 5, 1, '{"explosiveDamage":0.08}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_armor_1', 'Demolition', 3, 1, 'Penetrator Rounds', '+10% Armor Damage', 'small', 5, 1, '{"armorDamageMod":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_armor_2', 'Demolition', 3, 2, 'Crack Core', '+10% Armor Damage', 'small', 5, 1, '{"armorDamageMod":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_stag_1', 'Demolition', 4, 1, 'Concussion', '+5% Stagger Chance', 'small', 5, 1, '{"staggerChance":0.05}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_stag_2', 'Demolition', 4, 2, 'Impact Force', '+5% Stagger Chance', 'small', 5, 1, '{"staggerChance":0.05}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_heavy_1', 'Demolition', 5, 1, 'Overcharge', '+15% Heavy Weapon Burst', 'small', 5, 1, '{"heavyWeaponBurst":0.15}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_heavy_2', 'Demolition', 5, 2, 'Siege Mode', '+15% Heavy Weapon Burst', 'small', 5, 1, '{"heavyWeaponBurst":0.15}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_shield_1', 'Demolition', 6, 1, 'Ion Surge', '+10% Shield Break Contribution from Ordnance', 'small', 5, 1, '{"ordnanceShieldBreak":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_major_1', 'Demolition', 7, 1, 'Breaching Charge', 'Ordnance strips 20% extra shield before DPS phase.', 'major', 1, 3, '{"shieldStripBonus":0.2}'::jsonb, ARRAY['demo_shield_1', 'demo_ord_1']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_major_2', 'Demolition', 7, 2, 'Concussive Payload', 'Staggers last 30% longer, -15% boss damage output.', 'major', 1, 3, '{"staggerDuration":0.3,"staggerMitigation":0.15}'::jsonb, ARRAY['demo_stag_1', 'demo_stag_2']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_major_3', 'Demolition', 8, 1, 'Scorched Earth', 'Launcher as heavy: +20% armor break, +10% boss DPS', 'major', 1, 3, '{"launcherBossDps":0.1,"launcherArmorBreak":0.2}'::jsonb, ARRAY['demo_armor_1', 'demo_armor_2']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_major_4', 'Demolition', 8, 2, 'Cluster Bombs', '25% chance for ordnance to trigger twice (50% dmg).', 'major', 1, 3, '{"clusterChance":0.25,"clusterDamage":0.5}'::jsonb, ARRAY['demo_exp_1', 'demo_exp_2']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_keystone', 'Demolition', 9, 1, 'Unstable Power', 'Explosive feeds armor break; broken armor +50% hvy.', 'keystone', 1, 5, '{"explosiveArmorBreak":1,"brokenArmorHeavyBonus":0.5}'::jsonb, ARRAY['demo_major_1', 'demo_major_2', 'demo_major_3']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_idle_1', 'Scavenger', 1, 1, 'Uplink Tap', '+15% Offline Earnings', 'small', 5, 1, '{"offlineEarnings":0.15}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_idle_2', 'Scavenger', 1, 2, 'Background Processes', '+15% Offline Earnings', 'small', 5, 1, '{"offlineEarnings":0.15}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_drop_1', 'Scavenger', 2, 1, 'Data Miner', '+10% Rare Drop Chance', 'small', 5, 1, '{"rareDropChance":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_drop_2', 'Scavenger', 2, 2, 'Scrap Filter', '+10% Rare Drop Chance', 'small', 5, 1, '{"rareDropChance":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_qty_1', 'Scavenger', 3, 1, 'Bulk Transfer', '+10% Loot Quantity', 'small', 5, 1, '{"lootQuantity":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_qty_2', 'Scavenger', 3, 2, 'Parallel Download', '+10% Loot Quantity', 'small', 5, 1, '{"lootQuantity":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_scrap_1', 'Scavenger', 4, 1, 'Decompiler', '+20% Scrap Yield', 'small', 5, 1, '{"scrapYield":0.2}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_scrap_2', 'Scavenger', 4, 2, 'Compression', '+20% Scrap Yield', 'small', 5, 1, '{"scrapYield":0.2}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_cons_1', 'Scavenger', 5, 1, 'Efficient Routines', '+10% Consumable Efficiency', 'small', 5, 1, '{"consumableEfficiency":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_cons_2', 'Scavenger', 5, 2, 'Conservation', '+10% Consumable Efficiency', 'small', 5, 1, '{"consumableEfficiency":0.1}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_cache_1', 'Scavenger', 6, 1, 'Encrypted Payloads', '+5% Cache Quality Modifier', 'small', 5, 1, '{"cacheQuality":0.05}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_fee_1', 'Scavenger', 6, 2, 'Darknet Broker', '+5% Marketplace Listing Fee Reduction', 'small', 5, 1, '{"marketFeeReduction":0.05}'::jsonb, ARRAY[]::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_major_1', 'Scavenger', 7, 1, 'Hoarder''s Instinct', 'Auto-salvage: +25% scrap, 10% chance bonus consum.', 'major', 1, 3, '{"autoSalvageBonus":0.25,"autoSalvageConsumableChance":0.1}'::jsonb, ARRAY['scav_scrap_1', 'scav_scrap_2']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_major_2', 'Scavenger', 7, 2, 'Insurance Fraud', '50% chance unused consumables recovered on win.', 'major', 1, 3, '{"consumableRecovery":0.5}'::jsonb, ARRAY['scav_cons_1', 'scav_cons_2']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_major_3', 'Scavenger', 8, 1, 'Market Manipulator', 'Personal-found items: -15% listing fee.', 'major', 1, 3, '{"foundItemFeeReduction":0.15}'::jsonb, ARRAY['scav_fee_1']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_major_4', 'Scavenger', 8, 2, 'Lucky Find', '+15% rare drop chance for next 3 farming sessions.', 'major', 1, 3, '{"postBossSessions":3,"postBossDropChance":0.15}'::jsonb, ARRAY['scav_drop_1', 'scav_drop_2']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_keystone', 'Scavenger', 9, 1, 'King of Scrap', 'Common loot: +100% scrap, 25% bonus material, +4h cap.', 'keystone', 1, 5, '{"offlineCapBonus":4,"lowRarityScrapBonus":1,"commonMaterialChance":0.25}'::jsonb, ARRAY['scav_major_1', 'scav_major_2', 'scav_major_4']::text[], '2026-10-29T23:37:16.434Z'::timestamptz) on conflict do nothing;

-- roaming_areas: 7 rows
insert into public.roaming_areas (id, display_name, unlock_level, payload, created_at) values ('dustwaste_frontier', 'Dustwaste Frontier', 1, '{"xp_per_tick":1,"essence_bias":[],"material_bias":["ScrapAlloy","BallisticParts"],"scrap_per_tick":0,"credits_per_tick":1}'::jsonb, '2026-10-29T23:37:16.328Z'::timestamptz) on conflict do nothing;
insert into public.roaming_areas (id, display_name, unlock_level, payload, created_at) values ('redline_circuit', 'Redline Circuit', 4, '{"xp_per_tick":1.2,"essence_bias":[],"material_bias":["ScrapAlloy","BallisticParts"],"scrap_per_tick":0,"credits_per_tick":1}'::jsonb, '2026-10-29T23:37:16.328Z'::timestamptz) on conflict do nothing;
insert into public.roaming_areas (id, display_name, unlock_level, payload, created_at) values ('ironwood_bastion', 'Ironwood Bastion', 8, '{"xp_per_tick":1.4,"essence_bias":[],"material_bias":["BallisticParts","TechFragments"],"scrap_per_tick":0,"credits_per_tick":1}'::jsonb, '2026-10-29T23:37:16.328Z'::timestamptz) on conflict do nothing;
insert into public.roaming_areas (id, display_name, unlock_level, payload, created_at) values ('blastforge_yards', 'BlastForge Yards', 12, '{"xp_per_tick":1.65,"essence_bias":["IgnitionFluid"],"material_bias":["ScrapAlloy","BallisticParts","ReactiveComponents"],"scrap_per_tick":0,"credits_per_tick":1}'::jsonb, '2026-10-29T23:37:16.328Z'::timestamptz) on conflict do nothing;
insert into public.roaming_areas (id, display_name, unlock_level, payload, created_at) values ('prismatek_reactor', 'Prismatek Reactor', 16, '{"xp_per_tick":1.9,"essence_bias":["IgnitionFluid","ConduitWire","AcidCompound","CryoGel","VoidEssence"],"material_bias":["TechFragments"],"scrap_per_tick":0,"credits_per_tick":1}'::jsonb, '2026-10-29T23:37:16.328Z'::timestamptz) on conflict do nothing;
insert into public.roaming_areas (id, display_name, unlock_level, payload, created_at) values ('throwtech_dumpnet', 'ThrowTech Dumpnet', 20, '{"xp_per_tick":2.15,"essence_bias":["ConduitWire"],"material_bias":["TechFragments","ReactiveComponents"],"scrap_per_tick":0,"credits_per_tick":1}'::jsonb, '2026-10-29T23:37:16.328Z'::timestamptz) on conflict do nothing;
insert into public.roaming_areas (id, display_name, unlock_level, payload, created_at) values ('helixworks_labyrinth', 'HelixWorks Labyrinth', 25, '{"xp_per_tick":2.4,"essence_bias":["VoidEssence"],"material_bias":["TechFragments","VoidDust","ScrapAlloy","ReactiveComponents"],"scrap_per_tick":0,"credits_per_tick":1}'::jsonb, '2026-10-29T23:37:16.328Z'::timestamptz) on conflict do nothing;

-- mastery_definitions: 19 rows
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('account.net_worth', 'account', 'Net Worth', 'Competitive account value across credits, inventory, and economy.', 'value', 1, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('combat.boss_defeats', 'combat', 'Boss Defeats', 'Total verified boss and battle victories.', 'defeats', 100, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('combat.boss_attempts', 'combat', 'Boss Attempts', 'All verified boss and battle attempts.', 'attempts', 20, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('inventory.cache_draws', 'inventory', 'Cache Draws', 'Server-verified data cache item draws.', 'draws', 30, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('inventory.recycle', 'inventory', 'Recycling', 'Items recycled into scrap and materials.', 'items', 25, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('inventory.scrap_generated', 'inventory', 'Scrap Generated', 'Total scrap created through verified item recycling.', 'scrap', 1, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('economy.vendor_buys', 'economy', 'Vendor Supply', 'Consumables purchased from the vendor.', 'buys', 15, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('economy.market_listings', 'economy', 'Market Listings', 'Items listed on the market.', 'listings', 20, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('economy.market_sales', 'economy', 'Market Sales', 'Listings accepted by other players.', 'sales', 50, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('economy.trade_volume', 'economy', 'Trade Volume', 'Credits moved through market trades.', 'credits', 1, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('skills.training', 'skills', 'Training', 'Skill tree investment and retraining activity.', 'actions', 25, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('locations.dustwaste', 'locations', 'Dustwaste Mastery', 'Activity completed in the Dustwaste region.', 'activity', 25, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('services.repair', 'services', 'Repair Services', 'Repairs and item services completed for other players.', 'jobs', 50, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('weapons.pistol', 'weapons', 'Pistol Mastery', 'Pistol usage and pistol-driven victories.', 'XP', 1, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('weapons.smg', 'weapons', 'SMG Mastery', 'SMG usage and SMG-driven victories.', 'XP', 1, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('weapons.shotgun', 'weapons', 'Shotgun Mastery', 'Shotgun usage and shotgun-driven victories.', 'XP', 1, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('weapons.ordnance', 'weapons', 'Ordnance Mastery', 'Ordnance use, explosive damage, and ordnance-driven wins.', 'XP', 1, true, true, '2026-10-29T23:37:16.273Z'::timestamptz, '2026-10-29T23:37:16.273Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('combat.ordnance', 'combat', 'Ordnance Mastery', 'Mastery over ordnance deployment during roaming. Reduces ordnance fire interval.', 'fires', 10, true, true, '2026-10-29T23:37:16.441Z'::timestamptz, '2026-10-29T23:37:16.441Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('consumable.efficiency', 'economy', 'Consumable Efficiency', 'Mastery over consumable usage during roaming. Higher levels reduce consumption rate.', 'uses', 15, true, true, '2026-10-29T23:37:16.441Z'::timestamptz, '2026-10-29T23:37:16.441Z'::timestamptz) on conflict do nothing;
-- Added by B3 (not in the extracted seed state): cc_claim_crafted_
-- consumable inserts player_masteries rows with this id, and
-- player_masteries.mastery_id FK-references mastery_definitions(id),
-- so the definition must exist for crafting to succeed at all.
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('crafting_consumables', 'economy', 'Consumable Crafting', 'Workshop consumable crafting experience. Higher levels widen the crafted quality roll.', 'crafts', 10, true, true, '2026-10-29T23:37:16.441Z'::timestamptz, '2026-10-29T23:37:16.441Z'::timestamptz) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Functions (helpers first, then the 29 client-facing write ops with
-- p_player_id as the first parameter)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_verified_player(user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = user_id
      and p.account_type = 'verified'
      and p.email_verified_at is not null
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_use_player_economy(user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_verified_player(user_id);
$function$;

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
    'skill_spends', profile_row.skill_spends,
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at
  );
$function$;

CREATE OR REPLACE FUNCTION public.cc_accept_listing(p_player_id uuid, nonce text, listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  listing public.market_listings%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into listing from public.market_listings where id = listing_id for update;
  if not found or listing.status <> 'active' then raise exception 'Active listing not found'; end if;
  if listing.seller_user_id = actor then raise exception 'Cannot accept own listing'; end if;
  if p.credits < listing.price_credits then raise exception 'Insufficient credits'; end if;

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + listing.price_credits where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;
  update public.item_instances set owner_user_id = actor, runtime_state = 'available', is_locked = false, equipped_slot = null where id = listing.item_instance_id returning * into item;

  result := jsonb_build_object('action_type', 'cc_accept_listing', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_accept_listing', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_active_action_snapshot(a active_actions)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'user_id', a.user_id,
    'active_action', a.active_action,
    'started_at', a.started_at,
    'completes_at', a.completes_at,
    'target_type', a.target_type,
    'target_id', a.target_id,
    'target_label', a.target_label,
    'scene_key', a.scene_key,
    'notes', a.notes,
    'activity_payload', coalesce(a.activity_payload, '{}'::jsonb),
    'public_payload', coalesce(a.public_payload, '{}'::jsonb),
    'last_heartbeat_at', a.last_heartbeat_at,
    'public_visible', a.public_visible,
    'schema_version', a.schema_version,
    'updated_at', a.updated_at
  );
$function$;

CREATE OR REPLACE FUNCTION public.cc_active_action_heartbeat(p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  result_row public.active_actions%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;

  update public.active_actions
  set last_heartbeat_at = now(), updated_at = now()
  where user_id = actor
  returning * into result_row;

  if not found then
    insert into public.active_actions (
      user_id,
      active_action,
      started_at,
      last_heartbeat_at,
      public_visible,
      updated_at
    ) values (actor, 'idle_standby', now(), now(), true, now())
    returning * into result_row;
  end if;

  return jsonb_build_object(
    'action_type', 'cc_active_action_heartbeat',
    'activity', public.cc_active_action_snapshot(result_row)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_add_consumable_batch(p_owner_id uuid, p_item_key text, p_quantity integer, p_quality_percent numeric DEFAULT 100, p_origin text DEFAULT 'vendor'::text, p_creator_id uuid DEFAULT NULL::uuid, p_source_recipe_id text DEFAULT NULL::text, p_event_type text DEFAULT 'vendor_buy'::text, p_reason text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  qty integer := greatest(1, coalesce(p_quantity, 1));
  q numeric := greatest(1, least(250, coalesce(p_quality_percent, 100)));
  batch_id uuid;
begin
  if p_owner_id is null then raise exception 'owner_id is required'; end if;
  if p_item_key is null or length(trim(p_item_key)) = 0 then raise exception 'item_key is required'; end if;
  if p_origin not in ('vendor', 'crafted', 'market', 'reward', 'admin') then raise exception 'invalid consumable origin'; end if;
  if p_event_type not in ('vendor_buy', 'crafted', 'market_buy', 'market_sell', 'used', 'expired', 'admin_adjust', 'reset') then raise exception 'invalid consumable event type'; end if;

  select b.id into batch_id
  from public.consumable_batches b
  where b.owner_user_id = p_owner_id
    and b.consumable_type = p_item_key
    and b.quality_percent = q
    and b.origin = p_origin
    and coalesce(b.creator_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_creator_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(b.source_recipe_id, '') = coalesce(p_source_recipe_id, '')
  for update
  limit 1;

  if batch_id is null then
    insert into public.consumable_batches(owner_user_id, consumable_type, quality_percent, quantity, origin, creator_user_id, source_recipe_id, metadata)
    values (p_owner_id, p_item_key, q, qty, p_origin, p_creator_id, p_source_recipe_id, coalesce(p_metadata, '{}'::jsonb))
    returning id into batch_id;
  else
    update public.consumable_batches
    set quantity = quantity + qty,
        metadata = coalesce(public.consumable_batches.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where id = batch_id;
  end if;

  insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, reason, metadata)
  values (p_owner_id, batch_id, p_item_key, qty, q, p_event_type, p_reason, coalesce(p_metadata, '{}'::jsonb));

  return batch_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_mastery_level(total_xp bigint)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  level_value integer := 1;
  remaining_xp bigint := greatest(0, coalesce(total_xp, 0));
  threshold bigint;
begin
  loop
    threshold := level_value * level_value * 100;
    exit when remaining_xp < threshold;
    remaining_xp := remaining_xp - threshold;
    level_value := level_value + 1;
  end loop;

  return level_value;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_add_mastery_xp(p_user_id uuid, p_mastery_id text, p_xp_amount bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  next_xp bigint;
  next_level integer;
begin
  if p_user_id is null or p_mastery_id is null or p_xp_amount is null or p_xp_amount = 0 then
    return jsonb_build_object('mastery_id', p_mastery_id, 'mastery_xp', 0, 'mastery_level', 1);
  end if;

  insert into public.player_masteries(user_id, mastery_id, mastery_xp, mastery_level)
  values (p_user_id, p_mastery_id, greatest(0, p_xp_amount), public.cc_mastery_level(greatest(0, p_xp_amount)))
  on conflict (user_id, mastery_id) do update set
    mastery_xp = greatest(0, public.player_masteries.mastery_xp + p_xp_amount),
    mastery_level = public.cc_mastery_level(greatest(0, public.player_masteries.mastery_xp + p_xp_amount)),
    updated_at = now()
  returning mastery_xp, mastery_level into next_xp, next_level;

  return jsonb_build_object('mastery_id', p_mastery_id, 'mastery_xp', next_xp, 'mastery_level', next_level);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_add_stat(p_user_id uuid, p_stat_key text, p_amount bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  next_value bigint;
begin
  if p_user_id is null or p_stat_key is null or p_amount is null or p_amount = 0 then
    return 0;
  end if;

  insert into public.player_stat_counters(user_id, stat_key, stat_value)
  values (p_user_id, p_stat_key, greatest(0, p_amount))
  on conflict (user_id, stat_key) do update set
    stat_value = greatest(0, public.player_stat_counters.stat_value + p_amount),
    updated_at = now()
  returning stat_value into next_value;

  return next_value;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_apply_xp(current_level integer, current_xp bigint, xp_award bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  next_level integer := greatest(1, coalesce(current_level, 1));
  next_xp bigint := greatest(0, coalesce(current_xp, 0)) + greatest(0, coalesce(xp_award, 0));
  threshold bigint;
begin
  loop
    -- New curve: 50*level + 20*level^1.4
    -- Mirrored client-side in src/content/simulation.ts (xpToNextLevel).
    threshold := floor(50::numeric * next_level + 20::numeric * power(next_level::numeric, 1.4))::bigint;
    exit when next_xp < threshold;
    next_xp := next_xp - threshold;
    next_level := next_level + 1;
  end loop;

  return jsonb_build_object('player_level', next_level, 'player_xp', next_xp);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_draw_odds(table_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  total integer;
  pick integer;
  running integer := 0;
  candidate record;
begin
  select sum(weight)::integer into total
  from public.odds_outcomes
  where table_id = table_name;

  if total is null or total <= 0 then
    raise exception 'No outcomes configured for %', table_name;
  end if;

  pick := floor(random() * total)::integer + 1;

  for candidate in
    select outcome, weight, payload
    from public.odds_outcomes
    where table_id = table_name
    order by outcome
  loop
    running := running + candidate.weight;
    if pick <= running then
      return jsonb_build_object('table_id', table_name, 'outcome', candidate.outcome, 'roll', pick, 'total_weight', total, 'payload', candidate.payload);
    end if;
  end loop;

  raise exception 'Outcome resolution failed for %', table_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_battle_result(p_player_id uuid, nonce text, target_id text, stance text DEFAULT 'balanced'::text)
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
  draw jsonb;
  xp_award bigint;
  credit_award bigint;
  part_award integer;
  xp_state jsonb;
  next_parts integer;
  next_tokens integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if target_id is null or target_id = '' then raise exception 'target_id is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  if stance = 'aggressive' then draw := public.cc_draw_odds('boss_attempt_aggressive');
  elsif stance = 'defensive' then draw := public.cc_draw_odds('boss_attempt_defensive');
  else draw := public.cc_draw_odds('boss_attempt_balanced');
  end if;

  xp_award := greatest(1, round(greatest(10, p.player_level * 15) * ((draw -> 'payload' ->> 'xp_mult')::numeric))::bigint);
  credit_award := greatest(0, round(greatest(50, p.player_level * 25) * ((draw -> 'payload' ->> 'credit_mult')::numeric))::bigint);
  part_award := greatest(0, coalesce((draw -> 'payload' ->> 'fragment_reward')::integer, 0));
  next_parts := p.cache_token_parts + part_award;
  next_tokens := p.cache_tokens;
  while next_parts >= 5 loop next_parts := next_parts - 5; next_tokens := next_tokens + 1; end loop;
  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, xp_award);

  update public.profiles
  set player_level = (xp_state ->> 'player_level')::integer,
      player_xp = (xp_state ->> 'player_xp')::bigint,
      credits = credits + credit_award,
      cache_tokens = next_tokens,
      cache_token_parts = next_parts,
      boss_state = coalesce(boss_state, '{}'::jsonb) || jsonb_build_object('last_target_id', target_id, 'last_draw', draw)
  where id = actor
  returning * into p;

  result := jsonb_build_object('action_type', 'cc_battle_result', 'profile', public.cc_profile_snapshot(p), 'target_id', target_id, 'stance', stance, 'draw', draw, 'rewards', jsonb_build_object('xp', xp_award, 'credits', credit_award, 'parts', part_award));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_battle_result', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_idle_claim(p_player_id uuid, nonce text)
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
  xp_award bigint;
  credit_award bigint;
  xp_state jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  xp_award := floor(least(7200, greatest(0, extract(epoch from (now() - p.last_idle_claim_at)))) / 60)::bigint;
  credit_award := xp_award * 10;
  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, xp_award);

  update public.profiles
  set last_idle_claim_at = now(),
      player_level = (xp_state ->> 'player_level')::integer,
      player_xp = (xp_state ->> 'player_xp')::bigint,
      credits = credits + credit_award
  where id = actor
  returning * into p;

  result := jsonb_build_object('action_type', 'cc_idle_claim', 'profile', public.cc_profile_snapshot(p), 'rewards', jsonb_build_object('xp', xp_award, 'credits', credit_award));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_idle_claim', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_item_job_finish(p_player_id uuid, nonce text, job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
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
$function$;

CREATE OR REPLACE FUNCTION public.cc_item_service_accept(p_player_id uuid, nonce text, job_id uuid, price_credits bigint, duration_minutes integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  job public.service_jobs%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;
  if price_credits < 0 then raise exception 'Invalid price'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  select * into job from public.service_jobs where id = job_id for update;
  if not found or job.status <> 'listed' then raise exception 'Service job not available'; end if;
  if job.owner_user_id = actor then raise exception 'Cannot accept own job'; end if;

  update public.service_jobs
  set provider_user_id = actor,
      status = 'accepted',
      quoted_price_credits = price_credits,
      quoted_duration_minutes = duration_minutes,
      accepted_at = now()
  where id = job.id
  returning * into job;

  result := jsonb_build_object('action_type', 'cc_item_service_accept', 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_item_service_accept', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_item_service_request(p_player_id uuid, nonce text, item_id uuid, service_id text DEFAULT 'repair'::text)
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
  job public.service_jobs%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.runtime_state in ('listed','consumed','salvaged') then raise exception 'Item state invalid'; end if;

  insert into public.service_jobs(owner_user_id, profession_id, status, target_item_instance_id, requested_service_id)
  values (actor, 'repair', 'listed', item.id, service_id)
  returning * into job;

  update public.item_instances set runtime_state = 'locked', is_locked = true where id = item.id returning * into item;

  result := jsonb_build_object('action_type', 'cc_item_service_request', 'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_item_service_request', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_compute_item_estimated_value(_payload jsonb, _kind text, _rarity text, _item_level integer)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rarity_mult numeric := case _rarity
    when 'Common' then 1
    when 'Uncommon' then 2
    when 'Rare' then 5
    when 'Epic' then 10
    when 'Legendary' then 25
    else 1
  end;
  v_level numeric := greatest(1, coalesce(_item_level, 1));
  v_base numeric := v_level * 100 * v_rarity_mult;
  v_kind_bonus numeric := 0;
  v_affix_count integer;
begin
  if _kind = 'weapon' then
    v_kind_bonus := coalesce((_payload ->> 'combatPower')::numeric, 0) * 2;
  elsif _kind = 'shield' then
    v_kind_bonus := coalesce((_payload ->> 'hp')::numeric, 0) * 0.5
                  * (1 + coalesce((_payload ->> 'mitigation')::numeric, 0));
  elsif _kind = 'classMod' then
    v_affix_count := coalesce(jsonb_array_length(_payload -> 'affixes'), 0);
    v_kind_bonus := (coalesce((select count(*) from jsonb_object_keys(coalesce(_payload -> 'nodeBoosts', '{}'::jsonb))), 0) * 50 + v_affix_count * 30) * v_level;
  elsif _kind = 'relic' then
    v_affix_count := coalesce(jsonb_array_length(_payload -> 'affixes'), 0);
    v_kind_bonus := v_affix_count * 40 * v_rarity_mult;
  elsif _kind = 'ordnance' then
    v_kind_bonus := (
      coalesce((_payload ->> 'damage')::numeric, 0)
      + coalesce((_payload ->> 'shieldDamage')::numeric, 0)
      + coalesce((_payload ->> 'armorDamage')::numeric, 0)
    ) * 1.5;
  end if;

  return floor(v_base + v_kind_bonus)::bigint;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_generate_weapon_payload(_level integer, _rarity text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  _types text[] := array['Pistol','SMG','Shotgun','Sniper','Launcher','Beam'];
  _manufacturers text[] := array['Redline','Ironwood','BlastForge','Prismatek','ThrowTech','HelixWorks'];
  _elements text[] := array['Kinetic','Fire','Shock','Corrosive','Cryo','Void'];
  _type text;
  _manufacturer text;
  _element text;
  _base jsonb;
  _level_scalar numeric;
  _rarity_scalar numeric;
  _base_damage numeric;
  _attack_speed numeric;
  _crit_chance numeric;
  _crit_damage numeric;
  _status_chance numeric;
  _status_damage numeric;
  _boss_damage_mod numeric;
  _wave_damage_mod numeric;
  _shield_damage_mod numeric;
  _armor_damage_mod numeric;
  _combat_power numeric;
begin
  _type := _types[1 + floor(random() * array_length(_types, 1))::integer];
  _manufacturer := _manufacturers[1 + floor(random() * array_length(_manufacturers, 1))::integer];
  _element := _elements[1 + floor(random() * array_length(_elements, 1))::integer];

  _level_scalar := 1 + (_level - 1) * 0.08;

  _rarity_scalar := case _rarity
    when 'Common' then 1.0
    when 'Uncommon' then 1.1
    when 'Rare' then 1.25
    when 'Epic' then 1.45
    when 'Legendary' then 1.7
    else 1.0
  end;

  _base := case _type
    when 'Pistol' then '{"baseDamage":80,"attackSpeed":1.2,"critChance":0.1,"critDamage":1.5,"statusChance":0.08,"statusDamage":1.2,"bossDamageMod":1.0,"waveDamageMod":1.0,"shieldDamageMod":1.0,"armorDamageMod":1.0}'::jsonb
    when 'SMG' then '{"baseDamage":45,"attackSpeed":2.0,"critChance":0.08,"critDamage":1.4,"statusChance":0.12,"statusDamage":1.1,"bossDamageMod":0.95,"waveDamageMod":1.15,"shieldDamageMod":1.05,"armorDamageMod":0.9}'::jsonb
    when 'Shotgun' then '{"baseDamage":140,"attackSpeed":0.7,"critChance":0.06,"critDamage":1.6,"statusChance":0.1,"statusDamage":1.3,"bossDamageMod":0.9,"waveDamageMod":1.3,"shieldDamageMod":0.95,"armorDamageMod":1.05}'::jsonb
    when 'Sniper' then '{"baseDamage":200,"attackSpeed":0.5,"critChance":0.25,"critDamage":2.0,"statusChance":0.05,"statusDamage":1.0,"bossDamageMod":1.2,"waveDamageMod":0.7,"shieldDamageMod":1.0,"armorDamageMod":1.1}'::jsonb
    when 'Launcher' then '{"baseDamage":300,"attackSpeed":0.35,"critChance":0.03,"critDamage":1.8,"statusChance":0.15,"statusDamage":1.5,"bossDamageMod":1.15,"waveDamageMod":1.1,"shieldDamageMod":0.85,"armorDamageMod":1.3}'::jsonb
    when 'Beam' then '{"baseDamage":60,"attackSpeed":1.5,"critChance":0.07,"critDamage":1.35,"statusChance":0.2,"statusDamage":1.4,"bossDamageMod":1.0,"waveDamageMod":0.95,"shieldDamageMod":1.15,"armorDamageMod":1.15}'::jsonb
    else '{"baseDamage":80,"attackSpeed":1.2,"critChance":0.1,"critDamage":1.5,"statusChance":0.08,"statusDamage":1.2,"bossDamageMod":1.0,"waveDamageMod":1.0,"shieldDamageMod":1.0,"armorDamageMod":1.0}'::jsonb
  end;

  _base_damage := round((_base->>'baseDamage')::numeric * _level_scalar * _rarity_scalar);
  _attack_speed := round(((_base->>'attackSpeed')::numeric * _level_scalar * 0.98)::numeric, 2);
  _crit_chance := round(least(0.9, (_base->>'critChance')::numeric * _level_scalar * 0.95)::numeric, 3);
  _crit_damage := round(((_base->>'critDamage')::numeric * _level_scalar * 0.97)::numeric, 2);
  _status_chance := round(least(0.9, (_base->>'statusChance')::numeric * _level_scalar)::numeric, 3);
  _status_damage := round(((_base->>'statusDamage')::numeric * _level_scalar * 0.96)::numeric, 2);

  _boss_damage_mod := (_base->>'bossDamageMod')::numeric;
  _wave_damage_mod := (_base->>'waveDamageMod')::numeric;
  _shield_damage_mod := (_base->>'shieldDamageMod')::numeric;
  _armor_damage_mod := (_base->>'armorDamageMod')::numeric;

  _combat_power := round(_base_damage * _attack_speed * (1 + _crit_chance * _crit_damage) * (1 + _status_chance * _status_damage * 0.3));

  return jsonb_build_object(
    'id', null,
    'weaponType', _type,
    'manufacturer', _manufacturer,
    'element', _element,
    'name', _rarity || ' Cache ' || _type,
    'level', _level,
    'rarity', _rarity,
    'baseDamage', _base_damage,
    'attackSpeed', _attack_speed,
    'critChance', _crit_chance,
    'critDamage', _crit_damage,
    'statusChance', _status_chance,
    'statusDamage', _status_damage,
    'bossDamageMod', _boss_damage_mod,
    'waveDamageMod', _wave_damage_mod,
    'shieldDamageMod', _shield_damage_mod,
    'armorDamageMod', _armor_damage_mod,
    'offlineEarningsMod', 0,
    'rareDropChanceMod', 0,
    'scrapYieldMod', 0,
    'rollQuality', 50,
    'parts', '[]'::jsonb,
    'affixes', '[]'::jsonb,
    'sourceTag', 'Cache-Forged',
    'isLocked', false,
    'combatPower', _combat_power,
    'bossPower', _combat_power,
    'farmPower', _combat_power,
    'economyScore', 0
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_make_item(p_player_id uuid, nonce text)
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
  odds jsonb;
  rarity_value text;
  item_value bigint;
  item_level integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if p.cache_tokens < 1 then raise exception 'Not enough tokens'; end if;

  odds := public.cc_draw_odds('cache_primary_rarity');
  rarity_value := odds ->> 'outcome';

  update public.profiles set cache_tokens = cache_tokens - 1 where id = actor returning * into p;

  item_level := greatest(1, p.player_level);
  item_value := public.cc_compute_item_estimated_value(
    jsonb_build_object('odds', odds),
    'weapon',
    rarity_value,
    item_level
  );

  insert into public.item_instances (
    owner_user_id,
    kind,
    item_level,
    rarity,
    estimated_value,
    supply_mode,
    payload
  ) values (
    actor,
    'weapon',
    item_level,
    rarity_value,
    item_value,
    'verified_action',
    public.cc_generate_weapon_payload(item_level, rarity_value)
  ) returning * into item;

  result := jsonb_build_object('action_type', 'cc_make_item', 'profile', public.cc_profile_snapshot(p), 'odds', odds, 'item', to_jsonb(item));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_make_item', nonce, result);

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_market_create(p_player_id uuid, nonce text, item_id uuid, price_credits bigint)
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
  listing public.market_listings%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if price_credits <= 0 then raise exception 'price_credits must be positive'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.account_bound or not item.tradeable or item.runtime_state in ('listed','equipped','salvaged','consumed') then raise exception 'Item not listable'; end if;

  insert into public.market_listings(seller_user_id, item_instance_id, price_credits, status)
  values (actor, item.id, price_credits, 'active') returning * into listing;

  update public.item_instances set runtime_state = 'listed' where id = item.id returning * into item;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_loadout_snapshot(actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'primary', null,
    'secondary', null,
    'heavy', null,
    'ordnance', null,
    'shield', null,
    'classMod', null,
    'relic', null
  ) || coalesce(
    jsonb_object_agg(equipped_slot, id::text) filter (where equipped_slot is not null),
    '{}'::jsonb
  )
  from public.item_instances
  where owner_user_id = actor
    and runtime_state = 'equipped'
    and equipped_slot in ('primary','secondary','heavy','ordnance','shield','classMod','relic');
$function$;

CREATE OR REPLACE FUNCTION public.cc_salvage_scrap(rarity text, item_level integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select greatest(1, round((10 + greatest(1, coalesce(item_level, 1)) * 5) * case rarity
    when 'Common' then 1.0
    when 'Uncommon' then 1.5
    when 'Rare' then 2.5
    when 'Epic' then 4.0
    when 'Legendary' then 8.0
    else 1.0
  end)::integer);
$function$;

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

  award := public.cc_salvage_scrap(item.rarity, item.item_level);

  update public.item_instances
  set runtime_state = 'consumed', tradeable = false, equipped_slot = null
  where id = item.id
  returning * into item;

  update public.profiles
  set scrap = scrap + award
  where id = actor
  returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_recycle_item',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'scrap_award', award,
    'loadout', public.cc_loadout_snapshot(actor)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_recycle_item', nonce, result);

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_skill_spend_total(skill_state jsonb)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(value::integer), 0)::integer
  from jsonb_each_text(coalesce(skill_state, '{}'::jsonb));
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

  cost := public.cc_skill_spend_total(p.skill_spends) * 100;
  if p.credits < cost then raise exception 'Insufficient credits'; end if;

  update public.profiles set credits = credits - cost, skill_spends = '{}'::jsonb where id = actor returning * into p;

  result := jsonb_build_object('action_type', 'cc_retrain', 'profile', public.cc_profile_snapshot(p), 'total_price', cost);
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_retrain', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_set_mastery_xp(p_user_id uuid, p_mastery_id text, p_xp_amount bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  next_xp bigint := greatest(0, coalesce(p_xp_amount, 0));
  next_level integer := public.cc_mastery_level(greatest(0, coalesce(p_xp_amount, 0)));
begin
  if p_user_id is null or p_mastery_id is null then
    return jsonb_build_object('mastery_id', p_mastery_id, 'mastery_xp', 0, 'mastery_level', 1);
  end if;

  insert into public.player_masteries(user_id, mastery_id, mastery_xp, mastery_level)
  values (p_user_id, p_mastery_id, next_xp, next_level)
  on conflict (user_id, mastery_id) do update set
    mastery_xp = next_xp,
    mastery_level = next_level,
    updated_at = now()
  returning player_masteries.mastery_xp, player_masteries.mastery_level into next_xp, next_level;

  return jsonb_build_object('mastery_id', p_mastery_id, 'mastery_xp', next_xp, 'mastery_level', next_level);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_set_stat(p_user_id uuid, p_stat_key text, p_stat_value bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  next_value bigint := greatest(0, coalesce(p_stat_value, 0));
begin
  if p_user_id is null or p_stat_key is null then
    return 0;
  end if;

  insert into public.player_stat_counters(user_id, stat_key, stat_value)
  values (p_user_id, p_stat_key, next_value)
  on conflict (user_id, stat_key) do update set
    stat_value = next_value,
    updated_at = now()
  returning player_stat_counters.stat_value into next_value;

  return next_value;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_jsonb_int(source jsonb, key text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(nullif(source ->> key, '')::integer, 0);
$function$;

CREATE OR REPLACE FUNCTION public.cc_jsonb_add_int(source jsonb, key text, amount integer)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_set(
    coalesce(source, '{}'::jsonb),
    array[key],
    to_jsonb(greatest(0, public.cc_jsonb_int(coalesce(source, '{}'::jsonb), key) + amount)),
    true
  );
$function$;

CREATE OR REPLACE FUNCTION public.cc_vendor_price(item_key text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case item_key
    when 'MedKit' then 250
    when 'ShieldCell' then 300
    when 'AmmoPack' then 150
    when 'Grenade' then 400
    when 'BossScanner' then 600
    when 'InsuranceToken' then 800
    when 'LuckBooster' then 350
    else null
  end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_vendor_buy(p_player_id uuid, nonce text, item_key text, quantity integer DEFAULT 1)
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
  unit_price bigint;
  qty integer := greatest(1, coalesce(quantity, 1));
  total_price bigint;
  batch_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  unit_price := public.cc_vendor_price(item_key);
  if unit_price is null then raise exception 'Unknown vendor item'; end if;
  total_price := unit_price * qty;
  if p.credits < total_price then raise exception 'Insufficient credits'; end if;

  update public.profiles
  set credits = credits - total_price,
      consumables = public.cc_jsonb_add_int(consumables, item_key, qty)
  where id = actor
  returning * into p;

  batch_id := public.cc_add_consumable_batch(
    actor,
    item_key,
    qty,
    100,
    'vendor',
    null,
    null,
    'vendor_buy',
    'Vendor baseline 100% quality purchase',
    jsonb_build_object('unit_price', unit_price, 'total_price', total_price)
  );

  result := jsonb_build_object(
    'action_type', 'cc_vendor_buy',
    'profile', public.cc_profile_snapshot(p),
    'item_key', item_key,
    'quantity', qty,
    'quality_percent', 100,
    'batch_id', batch_id,
    'total_price', total_price
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_vendor_buy', nonce, result);

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_apply_mastery_for_verified_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  profile_payload jsonb := coalesce(new.result_payload -> 'profile', '{}'::jsonb);
  reward_payload jsonb := coalesce(new.result_payload -> 'rewards', '{}'::jsonb);
  action text := new.action_type;
  amount bigint;
  won boolean;
  credits_value bigint;
  scrap_value bigint;
  net_worth_value bigint;
  consumed_map jsonb;
  consumable_type text;
  consumable_count integer;
begin
  perform public.cc_add_stat(new.user_id, 'actions.total', 1);
  perform public.cc_add_stat(new.user_id, 'actions.' || action, 1);

  if action in ('cc_make_item', 'cc_draw_item') then
    perform public.cc_add_stat(new.user_id, 'inventory.cache_draws', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.cache_draws', 30);
  elsif action in ('cc_recycle_item', 'cc_salvage_item') then
    amount := greatest(0, coalesce((new.result_payload ->> 'scrap_award')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'inventory.recycle.count', 1);
    perform public.cc_add_stat(new.user_id, 'inventory.scrap_generated', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.recycle', 25);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.scrap_generated', amount);
  elsif action = 'cc_vendor_buy' then
    amount := greatest(1, coalesce((new.result_payload ->> 'quantity')::bigint, 1));
    perform public.cc_add_stat(new.user_id, 'economy.vendor_buys', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.vendor_buys', amount * 15);
  elsif action = 'cc_market_create' then
    perform public.cc_add_stat(new.user_id, 'economy.market_listings', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.market_listings', 20);
  elsif action in ('cc_accept_listing', 'cc_market_transfer') then
    amount := greatest(0, coalesce((new.result_payload -> 'listing' ->> 'price_credits')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'economy.market_sales', 1);
    perform public.cc_add_stat(new.user_id, 'economy.trade_volume', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.market_sales', 50);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.trade_volume', amount);
  elsif action in ('cc_item_service_request', 'cc_item_service_accept') then
    perform public.cc_add_stat(new.user_id, 'services.jobs_touched', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'services.repair', 10);
  elsif action = 'cc_item_job_finish' then
    amount := greatest(0, coalesce((new.result_payload ->> 'price_credits')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'services.completed', 1);
    perform public.cc_add_stat(new.user_id, 'services.revenue', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'services.repair', 50 + amount);
  elsif action in ('cc_battle_result', 'cc_boss_attempt') then
    won := coalesce(new.result_payload -> 'draw' ->> 'outcome', '') = 'victory';
    perform public.cc_add_stat(new.user_id, 'combat.boss_attempts', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_attempts', 20);
    perform public.cc_add_mastery_xp(new.user_id, 'locations.dustwaste', 25);
    if won then
      perform public.cc_add_stat(new.user_id, 'combat.boss_defeats', 1);
      perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_defeats', 100);
    end if;
  elsif action in ('cc_retrain', 'cc_skill_reset') then
    perform public.cc_add_stat(new.user_id, 'skills.retrain', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'skills.training', 25);
  elsif action = 'cc_idle_claim' then
    amount := greatest(0, coalesce((reward_payload ->> 'xp')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'combat.idle_xp_claimed', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'locations.dustwaste', greatest(1, amount));
  end if;

  -- NEW: Consumable usage mastery (from roaming claims)
  consumed_map := coalesce(new.result_payload -> 'consumedConsumables', '{}'::jsonb);
  if consumed_map <> '{}'::jsonb then
    for consumable_type, consumable_count in select key, value::integer from jsonb_each_text(consumed_map)
    loop
      if consumable_count > 0 then
        perform public.cc_add_mastery_xp(new.user_id, 'consumable.efficiency', consumable_count * 10);
        -- Ordnance family gets combat.ordnance mastery
        if consumable_type like 'Ordnance%'
           or consumable_type like 'EMP%'
           or consumable_type like 'Corrosive%'
           or consumable_type like 'Magnetized%'
           or consumable_type like 'PhaseShift%'
           or consumable_type like 'Void%'
        then
          perform public.cc_add_mastery_xp(new.user_id, 'combat.ordnance', consumable_count * 10);
        end if;
      end if;
    end loop;
  end if;

  if profile_payload ? 'credits' then
    credits_value := greatest(0, coalesce((profile_payload ->> 'credits')::bigint, 0));
    scrap_value := greatest(0, coalesce((profile_payload ->> 'scrap')::bigint, 0));
    net_worth_value := credits_value + scrap_value;
    perform public.cc_set_stat(new.user_id, 'account.net_worth', net_worth_value);
    perform public.cc_set_mastery_xp(new.user_id, 'account.net_worth', net_worth_value);
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_consumable_quality_bounds(item_key text)
 RETURNS TABLE(craft_min numeric, craft_max numeric)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.cc_consumable_recipe_materials(recipe_id text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.cc_claim_crafted_consumable(p_player_id uuid, nonce text, recipe_id text, item_key text, quantity integer DEFAULT 1)
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

  select coalesce(max(player_masteries.mastery_level), 1) into mastery_level
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
$function$;

CREATE OR REPLACE FUNCTION public.cc_claim_rewarded_cache_key(p_player_id uuid, nonce text, ad_unit_id text, reward_source text DEFAULT 'admob_rewarded'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  grant_count integer;
  result jsonb;
  clean_ad_unit_id text := nullif(trim(coalesce(ad_unit_id, '')), '');
  clean_reward_source text := nullif(trim(coalesce(reward_source, 'admob_rewarded')), '');
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if clean_ad_unit_id is null then raise exception 'ad_unit_id is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger
  where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select count(*) into grant_count
  from public.ad_reward_grants
  where user_id = actor
    and reward_type = 'cache_key'
    and status = 'granted'
    and granted_at >= date_trunc('day', now());

  if grant_count >= 3 then
    raise exception 'Daily rewarded cache key limit reached';
  end if;

  if exists (
    select 1
    from public.ad_reward_grants
    where user_id = actor
      and reward_type = 'cache_key'
      and status = 'granted'
      and granted_at > now() - interval '5 minutes'
  ) then
    raise exception 'Rewarded cache key cooldown active';
  end if;

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  update public.profiles
     set cache_tokens = cache_tokens + 1,
         updated_at = now()
   where id = actor
   returning * into p;

  insert into public.ad_reward_grants (
    user_id,
    idempotency_key,
    ad_unit_id,
    reward_type,
    reward_amount,
    status,
    metadata
  ) values (
    actor,
    nonce,
    clean_ad_unit_id,
    'cache_key',
    1,
    'granted',
    jsonb_build_object('source', coalesce(clean_reward_source, 'admob_rewarded'))
  );

  result := jsonb_build_object(
    'action_type', 'cc_claim_rewarded_cache_key',
    'profile', public.cc_profile_snapshot(p),
    'reward_type', 'cache_key',
    'reward_amount', 1,
    'daily_grants_used', grant_count + 1
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_claim_rewarded_cache_key', nonce, result);

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_hash_string(input text)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  h bigint := 1779033703;
  i integer;
  ch integer;
begin
  for i in 1..length(input) loop
    ch := ascii(substr(input, i, 1));
    -- mulberry-style mixing (approximates Math.imul with 64-bit wraparound)
    h := (((h # ch)::numeric * 3432918353) % 4294967296)::bigint;
    h := ((h << 13) | (h >> 19)) & 4294967295;
  end loop;
  return h;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_mulberry32_next()
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare
  s bigint;
  t bigint;
begin
  s := coalesce(nullif(current_setting('cc.m32_state', true), ''), '0')::bigint;
  s := (s + 18205) & 4294967295;  -- 0x6D2B79F5
  t := s;
  t := (((t # (t >> 15))::numeric * (t | 1)) % 4294967296)::bigint;
  t := (t + ((((t # (t >> 7))::numeric * (t | 61)) % 4294967296)::bigint)) & 4294967295;
  t := t # (t >> 14);
  perform set_config('cc.m32_state', s::text, true);
  return (t & 4294967295)::double precision / 4294967296.0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_mulberry32_seed(seed bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  perform set_config('cc.m32_state', seed::text, true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_claim_roaming_rewards(p_player_id uuid, ticks integer, area_id text, tick_count bigint)
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
  xp_awarded bigint := 0;
  credit_awarded bigint := 0;
  scrap_awarded bigint := 0;
  fragment_awarded smallint := 0;
  material_awarded jsonb := '{}'::jsonb;
  essence_awarded jsonb := '{}'::jsonb;
  kill_awarded integer := 0;
  gear_announced jsonb := '[]'::jsonb;
  activity_row public.active_actions%rowtype;
  tick_idx integer;
  tick_roll double precision;
  sub_roll double precision;
  material_pool text[];
  material_choice text;
  material_bias jsonb;
  essence_bias jsonb;
  credits_per_tick integer;
  scrap_per_tick integer;
  xp_per_tick double precision;
  bonus_credits integer := 0;
  bonus_scrap integer := 0;
  offline_cap_ms bigint;
  capped_ticks integer;
  now_ms bigint;
  last_heartbeat_ms bigint;
  elapsed_ms bigint;
  final_ticks integer;
  new_level integer;
  new_xp bigint;
  xp_state jsonb;
  gear_threshold double precision := 0.22;
  fragment_threshold double precision := 0.25;
  material_threshold double precision := 0.33;
  nonce_key text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if ticks is null or ticks < 1 or ticks > 2400 then raise exception 'ticks must be between 1 and 2400'; end if;
  if area_id is null or length(trim(area_id)) < 2 then raise exception 'area_id is required'; end if;
  if tick_count is null or tick_count < 1 then raise exception 'tick_count must be a positive integer'; end if;

  nonce_key := actor::text || ':' || tick_count::text;

  -- FIXED: qualify column with table alias to avoid ambiguity
  select result_payload into prior from public.verified_action_ledger vl
   where vl.user_id = actor and vl.idempotency_key = nonce_key;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  if tick_count <= p.last_claimed_tick then
    raise exception 'tick_count % is not after last claimed tick %', tick_count, p.last_claimed_tick;
  end if;

  select * into activity_row
    from public.active_actions
   where user_id = actor
   for update;
  if not found or activity_row.active_action <> 'roaming_loot' or activity_row.target_id <> area_id then
    raise exception 'No active roaming activity for area %', area_id;
  end if;

  select (payload->>'credits_per_tick')::int,
         (payload->>'scrap_per_tick')::int,
         coalesce((payload->>'xp_per_tick')::double precision, 1.0),
         coalesce(payload->'material_bias', '[]'::jsonb),
         coalesce(payload->'essence_bias', '[]'::jsonb)
    into credits_per_tick, scrap_per_tick, xp_per_tick, material_bias, essence_bias
   from public.roaming_areas
  where id = area_id;

  if credits_per_tick is null then
    credits_per_tick := 1;
    scrap_per_tick := 0;
    xp_per_tick := 1.0;
    material_bias := '["ScrapAlloy"]'::jsonb;
    essence_bias := '[]'::jsonb;
  end if;

  offline_cap_ms := greatest(0.25, coalesce(p.offline_cap_hours, 2))::bigint * 3600 * 1000;
  now_ms := (extract(epoch from now()) * 1000)::bigint;
  last_heartbeat_ms := coalesce(
    (extract(epoch from activity_row.last_heartbeat_at) * 1000)::bigint,
    now_ms
  );
  elapsed_ms := greatest(0, now_ms - last_heartbeat_ms);
  capped_ticks := least(ticks, greatest(1, (offline_cap_ms / 3000)::integer));
  final_ticks := least(ticks, capped_ticks);

  for tick_idx in 1..final_ticks loop
    perform public.cc_mulberry32_seed(public.cc_hash_string(actor::text || ':' || area_id || ':' || tick_idx::text));

    tick_roll := public.cc_mulberry32_next();

    if tick_roll < gear_threshold then
      kill_awarded := kill_awarded + 0;
      gear_announced := gear_announced || jsonb_build_object('tick', tick_idx, 'kind', 'pending');
    elsif tick_roll < fragment_threshold then
      fragment_awarded := fragment_awarded + 1;
    elsif tick_roll < material_threshold then
      material_pool := ARRAY(SELECT jsonb_array_elements_text(material_bias));
      if array_length(material_pool, 1) is null then
        material_pool := ARRAY['ScrapAlloy'];
      end if;
      sub_roll := public.cc_mulberry32_next();
      material_choice := material_pool[1 + (floor(sub_roll * array_length(material_pool, 1)))::int];
      if material_choice = any(select jsonb_array_elements_text(essence_bias)) then
        essence_awarded := jsonb_set(essence_awarded, array[material_choice], to_jsonb(coalesce((essence_awarded ->> material_choice)::int, 0) + 1), true);
      else
        material_awarded := jsonb_set(material_awarded, array[material_choice], to_jsonb(coalesce((material_awarded ->> material_choice)::int, 0) + 1), true);
      end if;
    else
      kill_awarded := kill_awarded + 1;
    end if;

    credit_awarded := credit_awarded + credits_per_tick;
    scrap_awarded := scrap_awarded + scrap_per_tick;
    xp_awarded := xp_awarded + round(xp_per_tick);
  end loop;

  bonus_credits := floor(credit_awarded * 0.0)::int;
  bonus_scrap := floor(scrap_awarded * 0.0)::int;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, xp_awarded);
  new_level := (xp_state ->> 'player_level')::int;
  new_xp := (xp_state ->> 'player_xp')::bigint;

  update public.profiles
     set credits = credits + credit_awarded + bonus_credits,
         scrap = scrap + scrap_awarded + bonus_scrap,
         player_level = new_level,
         player_xp = new_xp,
         cache_token_parts = cache_token_parts + fragment_awarded,
         last_claimed_tick = tick_count
   where id = actor
   returning * into p;

  update public.active_actions
     set last_heartbeat_at = now(),
         activity_payload = coalesce(activity_payload, '{}'::jsonb) || jsonb_build_object('last_claim_ticks', final_ticks, 'last_claim_at', now_ms)
   where user_id = actor
   returning * into activity_row;

  result := jsonb_build_object(
    'action_type', 'cc_claim_roaming_rewards',
    'profile', public.cc_profile_snapshot(p),
    'rewards', jsonb_build_object(
      'ticks', final_ticks,
      'credits_awarded', credit_awarded + bonus_credits,
      'scrap_awarded', scrap_awarded + bonus_scrap,
      'xp_awarded', xp_awarded,
      'cache_fragments_awarded', fragment_awarded,
      'materials', material_awarded,
      'essences', essence_awarded,
      'kills_recorded', kill_awarded,
      'gear_announced', gear_announced
    ),
    'activity', to_jsonb(activity_row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_claim_roaming_rewards', nonce_key, result);

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_clear_active_action(p_player_id uuid, nonce text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  result_row public.active_actions%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger vl
  where vl.user_id = actor and vl.idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  insert into public.active_actions as aa (
    user_id,
    active_action,
    started_at,
    completes_at,
    target_type,
    target_id,
    target_label,
    scene_key,
    notes,
    activity_payload,
    public_payload,
    last_heartbeat_at,
    public_visible,
    schema_version,
    updated_at
  ) values (
    actor,
    'idle_standby',
    now(),
    null,
    null,
    null,
    null,
    null,
    null,
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    true,
    1,
    now()
  )
  on conflict (user_id) do update set
    active_action = 'idle_standby',
    started_at = now(),
    completes_at = null,
    target_type = null,
    target_id = null,
    target_label = null,
    scene_key = null,
    notes = null,
    activity_payload = '{}'::jsonb,
    public_payload = '{}'::jsonb,
    last_heartbeat_at = now(),
    public_visible = true,
    schema_version = 1,
    updated_at = now()
  returning * into result_row;

  prior := jsonb_build_object(
    'action_type', 'cc_clear_active_action',
    'activity', public.cc_active_action_snapshot(result_row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_clear_active_action', nonce, prior);

  return prior;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_compute_player_snapshot(_player_id uuid)
 RETURNS player_progression_snapshots
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_stats public.player_public_stats%rowtype;
  v_snapshot public.player_progression_snapshots;
  v_action text;
begin
  select * into v_stats
  from public.player_public_stats
  where user_id = _player_id;

  select coalesce(public_payload->>'activity_label', active_action)
  into v_action
  from public.active_actions
  where user_id = _player_id
  order by updated_at desc
  limit 1;

  v_snapshot.player_id := _player_id;
  v_snapshot.snapshot_at := now();
  v_snapshot.snapshot_version := 1;
  v_snapshot.level := v_stats.player_level;
  v_snapshot.xp := v_stats.player_xp;
  v_snapshot.credits := v_stats.credits;
  v_snapshot.scrap := v_stats.scrap;
  v_snapshot.total_kills := v_stats.total_kills;
  v_snapshot.total_deaths := v_stats.total_deaths;
  v_snapshot.net_worth := v_stats.net_worth;
  v_snapshot.total_items := v_stats.total_items;
  v_snapshot.weapons_owned := v_stats.weapons_owned;
  v_snapshot.legendary_items := v_stats.legendary_items;
  v_snapshot.highest_item_level := v_stats.highest_item_level;
  v_snapshot.total_mastery_xp := v_stats.total_mastery_xp;
  v_snapshot.highest_mastery_level := v_stats.highest_mastery_level;
  v_snapshot.highest_boss_tier := v_stats.highest_boss_tier;
  v_snapshot.active_action := v_action;

  return v_snapshot;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_consume_consumable_batch(p_owner_id uuid, p_item_key text, p_quantity integer DEFAULT 1, p_activity_type text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  remaining integer := greatest(1, coalesce(p_quantity, 1));
  take_qty integer;
  consumed jsonb := '[]'::jsonb;
  batch record;
begin
  if p_owner_id is null then raise exception 'owner_id is required'; end if;
  if p_item_key is null or length(trim(p_item_key)) = 0 then raise exception 'item_key is required'; end if;

  for batch in
    select *
    from public.consumable_batches
    where owner_user_id = p_owner_id
      and consumable_type = p_item_key
      and quantity > 0
    order by quality_percent asc, created_at asc
    for update
  loop
    exit when remaining <= 0;
    take_qty := least(remaining, batch.quantity);

    update public.consumable_batches
    set quantity = quantity - take_qty,
        updated_at = now()
    where id = batch.id;

    insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, activity_type, reason, metadata)
    values (p_owner_id, batch.id, p_item_key, -take_qty, batch.quality_percent, 'used', p_activity_type, p_reason, coalesce(p_metadata, '{}'::jsonb));

    consumed := consumed || jsonb_build_array(jsonb_build_object(
      'batch_id', batch.id,
      'consumable_type', p_item_key,
      'quality_percent', batch.quality_percent,
      'quantity', take_qty
    ));
    remaining := remaining - take_qty;
  end loop;

  if remaining > 0 then
    raise exception 'Insufficient consumable quantity for %', p_item_key;
  end if;

  return jsonb_build_object('consumed', consumed, 'requested_quantity', p_quantity, 'remaining_shortfall', remaining);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_consume_consumable(p_player_id uuid, nonce text, item_key text, quantity integer DEFAULT 1, activity_type text DEFAULT NULL::text, reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
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

  if not exists (select 1 from public.consumable_batches where owner_user_id = actor and consumable_type = item_key and consumable_batches.quantity > 0) then
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
$function$;

CREATE OR REPLACE FUNCTION public.cc_disable_push_device(p_player_id uuid, push_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if push_token is null or length(trim(push_token)) < 16 then raise exception 'token is required'; end if;

  update public.user_push_devices
     set enabled = false,
         disabled_at = now(),
         last_seen_at = now()
   where user_id = actor
     and token = trim(push_token);

  return jsonb_build_object('action_type', 'cc_disable_push_device');
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_item_accepts_slot(payload jsonb, slot_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when slot_name in ('primary','secondary','heavy') then payload ? 'weaponType'
    when slot_name = 'shield' then payload ? 'hp' and not payload ? 'weaponType'
    when slot_name = 'classMod' then payload ? 'treeBonus'
    when slot_name = 'ordnance' then payload ? 'damage' and payload ? 'effect' and not payload ? 'weaponType'
    when slot_name = 'relic' then payload ? 'affixes' and not payload ? 'weaponType' and not payload ? 'hp' and not payload ? 'treeBonus' and not payload ? 'damage'
    else false
  end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_equip_item(p_player_id uuid, nonce text, item_id uuid, slot_name text)
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
  cleared_items jsonb := '[]'::jsonb;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if slot_name not in ('primary','secondary','heavy','ordnance','shield','classMod','relic') then raise exception 'Invalid slot'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.runtime_state in ('listed','consumed','salvaged') then raise exception 'Item state invalid'; end if;
  if not public.cc_item_accepts_slot(coalesce(item.payload, '{}'::jsonb), slot_name) then raise exception 'Item type does not match loadout slot'; end if;

  with cleared as (
    update public.item_instances
    set equipped_slot = null,
        runtime_state = case when is_locked then 'locked' else 'available' end
    where owner_user_id = actor
      and equipped_slot = slot_name
      and id <> item.id
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(cleared)), '[]'::jsonb) into cleared_items from cleared;

  update public.item_instances
  set equipped_slot = slot_name,
      runtime_state = 'equipped'
  where id = item.id
  returning * into item;

  result := jsonb_build_object(
    'action_type', 'cc_equip_item',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'items', cleared_items || jsonb_build_array(to_jsonb(item)),
    'loadout', public.cc_loadout_snapshot(actor)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_equip_item', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_initial_bundle(p_player_id uuid, nonce text)
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
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger
  where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if coalesce(p.boss_state ->> 'initial_bundle_claimed', 'false') = 'true' then raise exception 'Initial bundle already claimed'; end if;

  update public.profiles
  set credits = credits + 5000,
      scrap = scrap + 500,
      cache_tokens = cache_tokens + 3,
      boss_state = jsonb_set(coalesce(boss_state, '{}'::jsonb), '{initial_bundle_claimed}', 'true'::jsonb, true)
  where id = actor
  returning * into p;

  result := jsonb_build_object('action_type', 'cc_initial_bundle', 'profile', public.cc_profile_snapshot(p));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_initial_bundle', nonce, result);

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_recalculate_net_worth(_player_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_credits bigint;
  v_scrap bigint;
  v_items bigint;
  v_total bigint;
begin
  if _player_id is null then return 0; end if;

  select coalesce(credits, 0), coalesce(scrap, 0)
    into v_credits, v_scrap
    from public.profiles
   where id = _player_id;

  if not found then return 0; end if;

  select coalesce(sum(estimated_value), 0)
    into v_items
    from public.item_instances
   where owner_user_id = _player_id;

  v_total := v_credits + v_scrap + v_items;
  v_total := greatest(0, v_total);

  perform public.cc_set_stat(_player_id, 'account.net_worth', v_total);
  perform public.cc_set_mastery_xp(_player_id, 'account.net_worth', v_total);

  return v_total;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_item_instances_recalc_net_worth()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  affected_player uuid;
begin
  if tg_op = 'DELETE' then
    affected_player := old.owner_user_id;
  elsif tg_op = 'UPDATE' and old.owner_user_id is distinct from new.owner_user_id then
    -- Both old and new owners may have changed wealth.
    perform public.cc_recalculate_net_worth(old.owner_user_id);
    affected_player := new.owner_user_id;
  else
    affected_player := new.owner_user_id;
  end if;

  if affected_player is not null then
    perform public.cc_recalculate_net_worth(affected_player);
  end if;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_item_lock(p_player_id uuid, nonce text, item_id uuid, locked boolean)
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
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.runtime_state in ('listed','consumed','salvaged') then raise exception 'Item state invalid'; end if;

  update public.item_instances
  set is_locked = locked,
      runtime_state = case when locked then 'locked' else 'available' end
  where id = item.id
  returning * into item;

  result := jsonb_build_object('action_type', 'cc_item_lock', 'profile', public.cc_profile_snapshot(p), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_item_lock', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_mark_reminder_seen(p_player_id uuid)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  p public.profiles%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;

  update public.profiles
  set verification_reminder_last_seen_at = now()
  where id = actor
  returning * into p;

  if not found then raise exception 'Profile not found'; end if;
  return p;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_market_cancel(p_player_id uuid, nonce text, listing_id uuid)
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
  listing public.market_listings%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into listing from public.market_listings where id = listing_id for update;
  if not found or listing.seller_user_id <> actor then raise exception 'Listing not found'; end if;
  if listing.status <> 'active' then raise exception 'Listing not active'; end if;

  update public.market_listings set status = 'cancelled' where id = listing.id returning * into listing;
  update public.item_instances set runtime_state = case when is_locked then 'locked' else 'available' end where id = listing.item_instance_id returning * into item;

  result := jsonb_build_object('action_type', 'cc_market_cancel', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_cancel', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_record_player_snapshot(_player_id uuid, _source text, _metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_snapshot public.player_progression_snapshots%rowtype;
  v_new_id bigint;
  v_last_at timestamptz;
  v_min_interval interval := interval '5 minutes';
begin
  -- Throttle identical sources to avoid bursts.
  select snapshot_at into v_last_at
  from public.player_progression_snapshots
  where player_id = _player_id and source = _source
  order by snapshot_at desc
  limit 1;

  if v_last_at is not null and now() - v_last_at < v_min_interval then
    return null;
  end if;

  v_snapshot := public.cc_compute_player_snapshot(_player_id);
  v_snapshot.source := _source;
  v_snapshot.metadata := _metadata;

  insert into public.player_progression_snapshots (
    player_id, snapshot_at, source, snapshot_version,
    level, xp, credits, scrap, total_kills, total_deaths, net_worth,
    total_items, weapons_owned, legendary_items, highest_item_level,
    total_mastery_xp, highest_mastery_level, highest_boss_tier, active_action, metadata
  ) values (
    v_snapshot.player_id, v_snapshot.snapshot_at, v_snapshot.source, v_snapshot.snapshot_version,
    v_snapshot.level, v_snapshot.xp, v_snapshot.credits, v_snapshot.scrap,
    v_snapshot.total_kills, v_snapshot.total_deaths, v_snapshot.net_worth,
    v_snapshot.total_items, v_snapshot.weapons_owned, v_snapshot.legendary_items,
    v_snapshot.highest_item_level, v_snapshot.total_mastery_xp, v_snapshot.highest_mastery_level,
    v_snapshot.highest_boss_tier, v_snapshot.active_action, v_snapshot.metadata
  )
  returning id into v_new_id;

  return v_new_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_register_push_device(p_player_id uuid, push_token text, platform text DEFAULT 'android'::text, app_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  device public.user_push_devices%rowtype;
  normalized_platform text := lower(coalesce(platform, 'android'));
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if push_token is null or length(trim(push_token)) < 16 then raise exception 'token is required'; end if;
  if normalized_platform not in ('android', 'ios', 'web') then normalized_platform := 'android'; end if;

  insert into public.user_push_devices (
    user_id,
    token,
    platform,
    app_version,
    enabled,
    last_registered_at,
    last_seen_at,
    disabled_at
  ) values (
    actor,
    trim(push_token),
    normalized_platform,
    app_version,
    true,
    now(),
    now(),
    null
  )
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        app_version = excluded.app_version,
        enabled = true,
        last_registered_at = now(),
        last_seen_at = now(),
        disabled_at = null
  returning * into device;

  insert into public.user_notification_settings(user_id)
  values (actor)
  on conflict (user_id) do nothing;

  return jsonb_build_object(
    'action_type', 'cc_register_push_device',
    'device', to_jsonb(device)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_reset_progress(p_player_id uuid, nonce text)
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
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger
  where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  delete from public.service_jobs
  where owner_user_id = actor or provider_user_id = actor;

  delete from public.market_listings
  where seller_user_id = actor
     or item_instance_id in (
       select id from public.item_instances where owner_user_id = actor
     );

  delete from public.escrow_records
  where payer_user_id = actor or payee_user_id = actor;

  delete from public.item_instances
  where owner_user_id = actor;

  delete from public.consumable_events where user_id = actor;
  delete from public.consumable_batches where owner_user_id = actor;
  delete from public.player_professions where user_id = actor;
  delete from public.active_actions where user_id = actor;
  delete from public.player_stat_counters where user_id = actor;
  delete from public.player_masteries where user_id = actor;
  delete from public.player_runtime_snapshots where user_id = actor;

  update public.profiles
  set player_level = 1,
      player_xp = 0,
      credits = 5000,
      scrap = 500,
      cache_tokens = 3,
      cache_token_parts = 0,
      materials = '{}'::jsonb,
      essences = '{}'::jsonb,
      consumables = '{}'::jsonb,
      skill_spends = '{}'::jsonb,
      boss_state = jsonb_build_object('initial_bundle_claimed', true),
      last_idle_claim_at = now(),
      updated_at = now()
  where id = actor
  returning * into p;

  if not found then raise exception 'Profile not found'; end if;

  result := jsonb_build_object('action_type', 'cc_reset_progress', 'profile', public.cc_profile_snapshot(p));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_reset_progress', nonce, result);

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_seed_starter_weapon()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.item_instances where owner_user_id = new.id and kind = 'weapon') then
    return new;
  end if;
  insert into public.item_instances (owner_user_id, kind, supply_mode, runtime_state, is_locked, rarity, item_level, equipped_slot, payload)
  values (new.id, 'weapon', 'verified_action', 'equipped', false, 'Common', 1, 'primary',
    jsonb_build_object('id', gen_random_uuid()::text, 'name', 'Starter Pistol', 'weaponType', 'Pistol', 'element', 'Kinetic', 'manufacturer', 'Redline', 'rarity', 'Common', 'level', 1, 'combatPower', 5, 'bossPower', 3, 'dps', 5, 'sourceTag', 'Starter Kit')
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_set_active_action(p_player_id uuid, nonce text, action_kind text, target_type text DEFAULT NULL::text, target_id text DEFAULT NULL::text, target_label text DEFAULT NULL::text, scene_key text DEFAULT NULL::text, expected_finish_at timestamp with time zone DEFAULT NULL::timestamp with time zone, notes text DEFAULT NULL::text, activity_payload jsonb DEFAULT '{}'::jsonb, public_payload jsonb DEFAULT '{}'::jsonb, public_visible boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  result_row public.active_actions%rowtype;
  normalized_kind text := coalesce(nullif(trim(action_kind), ''), 'idle_standby');
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  if normalized_kind not in (
    'none',
    'idle_standby',
    'roaming_loot',
    'boss_prep',
    'boss_fight',
    'crafting',
    'salvaging',
    'workshop_service',
    'market_listing'
  ) then
    raise exception 'Unsupported active action: %', normalized_kind;
  end if;

  select result_payload into prior
  from public.verified_action_ledger vl
  where vl.user_id = actor and vl.idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  insert into public.active_actions as aa (
    user_id,
    active_action,
    started_at,
    completes_at,
    target_type,
    target_id,
    target_label,
    scene_key,
    notes,
    activity_payload,
    public_payload,
    last_heartbeat_at,
    public_visible,
    schema_version,
    updated_at
  ) values (
    actor,
    normalized_kind,
    now(),
    expected_finish_at,
    nullif(target_type, ''),
    nullif(target_id, ''),
    nullif(target_label, ''),
    nullif(scene_key, ''),
    nullif(notes, ''),
    coalesce(activity_payload, '{}'::jsonb),
    coalesce(public_payload, '{}'::jsonb),
    now(),
    coalesce(public_visible, true),
    1,
    now()
  )
  on conflict (user_id) do update set
    active_action = excluded.active_action,
    started_at = excluded.started_at,
    completes_at = excluded.completes_at,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    target_label = excluded.target_label,
    scene_key = excluded.scene_key,
    notes = excluded.notes,
    activity_payload = excluded.activity_payload,
    public_payload = excluded.public_payload,
    last_heartbeat_at = excluded.last_heartbeat_at,
    public_visible = excluded.public_visible,
    schema_version = excluded.schema_version,
    updated_at = excluded.updated_at
  returning * into result_row;

  prior := jsonb_build_object(
    'action_type', 'cc_set_active_action',
    'activity', public.cc_active_action_snapshot(result_row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_set_active_action', nonce, prior);

  return prior;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_set_username(p_player_id uuid, _username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
  v_error text;
  cleaned text;
  current_username text;
  current_updated_at timestamptz;
  cooldown_until timestamptz;
begin
  select * into v_ok, v_error from public.cc_validate_username(_username);
  if not v_ok then
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  cleaned := lower(trim(_username));

  select username, username_updated_at
  into current_username, current_updated_at
  from public.profiles
  where id = p_player_id;

  -- If caller already owns this exact username, no-op success
  if lower(trim(coalesce(current_username, ''))) = cleaned then
    return jsonb_build_object('ok', true);
  end if;

  -- Rename cooldown: 7 days since last username change (auto-detected)
  if current_username is not null and current_updated_at is not null then
    cooldown_until := current_updated_at + interval '7 days';
    if now() < cooldown_until then
      return jsonb_build_object(
        'ok', false,
        'error', format('You can rename again after %s.', cooldown_until::text)
      );
    end if;
  end if;

  if not public.cc_is_username_available(_username) then
    return jsonb_build_object('ok', false, 'error', 'That username is already taken.');
  end if;

  update public.profiles
  set
    username = trim(_username),
    username_updated_at = now(),
    username_change_count = username_change_count + 1,
    updated_at = now()
  where id = p_player_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found.');
  end if;

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'That username is already taken.');
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
$function$;

CREATE OR REPLACE FUNCTION public.cc_unequip_slot(p_player_id uuid, nonce text, slot_name text)
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
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if slot_name not in ('primary','secondary','heavy','ordnance','shield','classMod','relic') then raise exception 'Invalid slot'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;

  update public.item_instances
  set equipped_slot = null,
      runtime_state = case when is_locked then 'locked' else 'available' end
  where owner_user_id = actor and equipped_slot = slot_name
  returning * into item;

  result := jsonb_build_object(
    'action_type', 'cc_unequip_slot',
    'profile', public.cc_profile_snapshot(p),
    'item', case when item.id is null then null else to_jsonb(item) end,
    'slot_name', slot_name,
    'loadout', public.cc_loadout_snapshot(actor)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_unequip_slot', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_record_snapshot_on_verified_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.action_type = 'cc_apply_chef_rewards' then
    perform public.cc_record_player_snapshot(new.user_id, 'chef_claim', jsonb_build_object('ledger_id', new.id));
  elsif new.action_type = 'cc_settle_offline_roaming' then
    perform public.cc_record_player_snapshot(new.user_id, 'settlement', jsonb_build_object('ledger_id', new.id));
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Triggers (drop+create keeps the migration idempotent)
-- ---------------------------------------------------------------------------

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists item_instances_touch_updated_at on public.item_instances;
create trigger item_instances_touch_updated_at
  before update on public.item_instances
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_item_instances_recalc_net_worth on public.item_instances;
create trigger trg_item_instances_recalc_net_worth
  after insert or delete or update on public.item_instances
  for each row execute function public.cc_item_instances_recalc_net_worth();

drop trigger if exists trg_seed_starter_weapon on public.profiles;
create trigger trg_seed_starter_weapon
  after insert on public.profiles
  for each row execute function public.cc_seed_starter_weapon();

drop trigger if exists active_actions_touch_updated_at on public.active_actions;
create trigger active_actions_touch_updated_at
  before update on public.active_actions
  for each row execute function public.touch_updated_at();

drop trigger if exists on_verified_action_mastery on public.verified_action_ledger;
create trigger on_verified_action_mastery
  after insert on public.verified_action_ledger
  for each row execute function public.cc_apply_mastery_for_verified_action();

drop trigger if exists record_snapshot_on_verified_action on public.verified_action_ledger;
create trigger record_snapshot_on_verified_action
  after insert on public.verified_action_ledger
  for each row execute function public.trg_record_snapshot_on_verified_action();
