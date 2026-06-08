drop policy if exists "odds_tables_select" on public.odds_tables;
drop policy if exists "odds_outcomes_select" on public.odds_outcomes;
create policy "odds_tables_select" on public.odds_tables for select to authenticated using (true);
create policy "odds_outcomes_select" on public.odds_outcomes for select to authenticated using (true);

insert into public.odds_tables (id, version, description) values
  ('cache_primary_rarity', 1, 'Primary data cache rarity: Rare 60%, Epic 32%, Legendary 8%.'),
  ('cache_second_drop', 1, 'Second data cache drop: none 60%, Rare 20%, Epic 20%.'),
  ('cache_third_drop', 1, 'Third data cache drop: none 85%, Epic 15%.'),
  ('boss_attempt_balanced', 1, 'Balanced boss attempt result.'),
  ('boss_attempt_aggressive', 1, 'Aggressive boss attempt result.'),
  ('boss_attempt_defensive', 1, 'Defensive boss attempt result.')
on conflict (id) do update set
  version = excluded.version,
  description = excluded.description,
  is_active = true,
  updated_at = now();

insert into public.odds_outcomes (table_id, outcome, weight, payload) values
  ('cache_primary_rarity', 'Rare', 6000, '{"rarity":"Rare"}'),
  ('cache_primary_rarity', 'Epic', 3200, '{"rarity":"Epic"}'),
  ('cache_primary_rarity', 'Legendary', 800, '{"rarity":"Legendary"}'),
  ('cache_second_drop', 'none', 6000, '{}'),
  ('cache_second_drop', 'Rare', 2000, '{"rarity":"Rare"}'),
  ('cache_second_drop', 'Epic', 2000, '{"rarity":"Epic"}'),
  ('cache_third_drop', 'none', 8500, '{}'),
  ('cache_third_drop', 'Epic', 1500, '{"rarity":"Epic"}'),
  ('boss_attempt_balanced', 'victory', 7000, '{"xp_mult":1.0,"credit_mult":1.0,"fragment_reward":1}'),
  ('boss_attempt_balanced', 'failure', 3000, '{"xp_mult":0.25,"credit_mult":0.0,"fragment_reward":0}'),
  ('boss_attempt_aggressive', 'victory', 6000, '{"xp_mult":1.25,"credit_mult":1.25,"fragment_reward":1}'),
  ('boss_attempt_aggressive', 'failure', 4000, '{"xp_mult":0.10,"credit_mult":0.0,"fragment_reward":0}'),
  ('boss_attempt_defensive', 'victory', 8000, '{"xp_mult":0.75,"credit_mult":0.75,"fragment_reward":1}'),
  ('boss_attempt_defensive', 'failure', 2000, '{"xp_mult":0.30,"credit_mult":0.0,"fragment_reward":0}')
on conflict (table_id, outcome) do update set
  weight = excluded.weight,
  payload = excluded.payload;
