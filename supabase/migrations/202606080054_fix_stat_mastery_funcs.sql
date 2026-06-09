-- Fix: cc_add_stat, cc_add_mastery_xp, cc_set_stat, cc_set_mastery_xp
-- all use 'user_id' as a parameter name, which is ambiguous with
-- table columns of the same name in SQL statements inside PL/pgSQL.
-- Fix by dropping and recreating with p_ prefixed parameter names.

drop function if exists public.cc_add_stat(uuid, text, bigint);
drop function if exists public.cc_set_stat(uuid, text, bigint);
drop function if exists public.cc_add_mastery_xp(uuid, text, bigint);
drop function if exists public.cc_set_mastery_xp(uuid, text, bigint);

create function public.cc_add_stat(p_user_id uuid, p_stat_key text, p_amount bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
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
$$;

create function public.cc_set_stat(p_user_id uuid, p_stat_key text, p_stat_value bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
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
$$;

create function public.cc_add_mastery_xp(p_user_id uuid, p_mastery_id text, p_xp_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

create function public.cc_set_mastery_xp(p_user_id uuid, p_mastery_id text, p_xp_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke execute on function public.cc_add_stat(uuid, text, bigint) from public, anon;
revoke execute on function public.cc_set_stat(uuid, text, bigint) from public, anon;
revoke execute on function public.cc_add_mastery_xp(uuid, text, bigint) from public, anon;
revoke execute on function public.cc_set_mastery_xp(uuid, text, bigint) from public, anon;

grant execute on function public.cc_add_stat(uuid, text, bigint) to authenticated, service_role;
grant execute on function public.cc_set_stat(uuid, text, bigint) to authenticated, service_role;
grant execute on function public.cc_add_mastery_xp(uuid, text, bigint) to authenticated, service_role;
grant execute on function public.cc_set_mastery_xp(uuid, text, bigint) to authenticated, service_role;
