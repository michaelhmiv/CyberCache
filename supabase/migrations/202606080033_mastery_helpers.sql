create or replace function public.cc_mastery_level(total_xp bigint)
returns integer
language plpgsql
immutable
set search_path = public
as $$
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
$$;

create or replace function public.cc_add_stat(user_id uuid, stat_key text, amount bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value bigint;
begin
  if user_id is null or stat_key is null or amount is null or amount = 0 then
    return 0;
  end if;

  insert into public.player_stat_counters(user_id, stat_key, stat_value)
  values (user_id, stat_key, greatest(0, amount))
  on conflict (user_id, stat_key) do update set
    stat_value = greatest(0, public.player_stat_counters.stat_value + amount),
    updated_at = now()
  returning stat_value into next_value;

  return next_value;
end;
$$;

create or replace function public.cc_add_mastery_xp(user_id uuid, mastery_id text, xp_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_xp bigint;
  next_level integer;
begin
  if user_id is null or mastery_id is null or xp_amount is null or xp_amount = 0 then
    return jsonb_build_object('mastery_id', mastery_id, 'mastery_xp', 0, 'mastery_level', 1);
  end if;

  insert into public.player_masteries(user_id, mastery_id, mastery_xp, mastery_level)
  values (user_id, mastery_id, greatest(0, xp_amount), public.cc_mastery_level(greatest(0, xp_amount)))
  on conflict (user_id, mastery_id) do update set
    mastery_xp = greatest(0, public.player_masteries.mastery_xp + xp_amount),
    mastery_level = public.cc_mastery_level(greatest(0, public.player_masteries.mastery_xp + xp_amount)),
    updated_at = now()
  returning mastery_xp, mastery_level into next_xp, next_level;

  return jsonb_build_object('mastery_id', mastery_id, 'mastery_xp', next_xp, 'mastery_level', next_level);
end;
$$;

revoke execute on function public.cc_mastery_level(bigint) from public, anon;
revoke execute on function public.cc_add_stat(uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public.cc_add_mastery_xp(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.cc_add_stat(uuid, text, bigint) to service_role;
grant execute on function public.cc_add_mastery_xp(uuid, text, bigint) to service_role;
