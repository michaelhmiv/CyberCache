create or replace function public.cc_set_stat(user_id uuid, stat_key text, stat_value bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value bigint := greatest(0, coalesce(stat_value, 0));
begin
  if user_id is null or stat_key is null then
    return 0;
  end if;

  insert into public.player_stat_counters(user_id, stat_key, stat_value)
  values (user_id, stat_key, next_value)
  on conflict (user_id, stat_key) do update set
    stat_value = next_value,
    updated_at = now()
  returning player_stat_counters.stat_value into next_value;

  return next_value;
end;
$$;

create or replace function public.cc_set_mastery_xp(user_id uuid, mastery_id text, xp_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_xp bigint := greatest(0, coalesce(xp_amount, 0));
  next_level integer := public.cc_mastery_level(greatest(0, coalesce(xp_amount, 0)));
begin
  if user_id is null or mastery_id is null then
    return jsonb_build_object('mastery_id', mastery_id, 'mastery_xp', 0, 'mastery_level', 1);
  end if;

  insert into public.player_masteries(user_id, mastery_id, mastery_xp, mastery_level)
  values (user_id, mastery_id, next_xp, next_level)
  on conflict (user_id, mastery_id) do update set
    mastery_xp = next_xp,
    mastery_level = next_level,
    updated_at = now()
  returning player_masteries.mastery_xp, player_masteries.mastery_level into next_xp, next_level;

  return jsonb_build_object('mastery_id', mastery_id, 'mastery_xp', next_xp, 'mastery_level', next_level);
end;
$$;

revoke execute on function public.cc_set_stat(uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public.cc_set_mastery_xp(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.cc_set_stat(uuid, text, bigint) to service_role;
grant execute on function public.cc_set_mastery_xp(uuid, text, bigint) to service_role;
