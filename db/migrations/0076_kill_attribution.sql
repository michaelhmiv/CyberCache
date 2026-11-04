-- 0076: Kill attribution reads the real weapon slots
-- (gear-truth follow-up to PR #377, which fixed the in-memory twin
-- and root-caused this SQL twin).
--
-- THE DEFECT: cc_record_kill_stats derived the held weapon from the
-- equipped row at equipped_slot = 'weapon' — a slot the equip path
-- has never written (weapons equip to primary / secondary / heavy;
-- see the 0004 equip applier's slot list). The lookup therefore
-- never matched, and every kill ever recorded in production sits
-- under 'unarmed' in both player_kill_stats and
-- player_kill_element_stats, whatever the hunter actually held.
--
-- What lands here:
--   cc_record_kill_stats — restated VERBATIM from 0051 (its chain
--   head; created 0034, element accumulation added 0051) with ONE
--   block changed: the weapon lookup. It now reads the equipped
--   rows in the real weapon slots with primary-first precedence
--   (primary, then secondary, then heavy) — the exact semantics the
--   twin's recordKillStats shipped in #377: the first OCCUPIED slot
--   decides, and a payload field that is missing or an empty string
--   reads 'unarmed' rather than falling through to the next slot or
--   inventing a value (nullif folds the empty-string case into the
--   coalesce both inserts already carried).
--
-- The repaired starter needs no handling here: the 0004 seed row
-- sits at equipped_slot = 'primary' and its sparse payload already
-- declares weaponType 'Pistol' / element 'Kinetic' — the same
-- identity the #377 canonical repair materializes — so a fresh
-- hunter's kills attribute to the Starter Pistol the moment this
-- lands, repaired row or not.
--
-- Historical rows are NOT backfilled: kills recorded 'unarmed'
-- before this migration stay 'unarmed' — they are history, and the
-- record cannot retroactively know what each hunter held.
-- ---------------------------------------------------------------------
create or replace function public.cc_record_kill_stats(_player_id uuid, _kills integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_weapon_type text;
  v_element text;
begin
  if _kills is null or _kills <= 0 then return; end if;
  select nullif(payload ->> 'weaponType', ''), nullif(payload ->> 'element', '')
    into v_weapon_type, v_element
    from public.item_instances
   where owner_user_id = _player_id
     and runtime_state = 'equipped'
     and equipped_slot in ('primary', 'secondary', 'heavy')
   order by case equipped_slot
              when 'primary' then 0
              when 'secondary' then 1
              else 2
            end
   limit 1;
  insert into public.player_kill_stats(user_id, weapon_type, kills)
  values (_player_id, coalesce(v_weapon_type, 'unarmed'), _kills)
  on conflict (user_id, weapon_type)
  do update set kills = public.player_kill_stats.kills + excluded.kills,
                updated_at = now();
  insert into public.player_kill_element_stats(user_id, element, kills)
  values (_player_id, coalesce(v_element, 'unarmed'), _kills)
  on conflict (user_id, element)
  do update set kills = public.player_kill_element_stats.kills + excluded.kills,
                updated_at = now();
end;
$$;
