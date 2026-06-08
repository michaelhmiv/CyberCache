create or replace function public.cc_my_mastery_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(summary_rows)), '[]'::jsonb)
  from (
    select
      pm.mastery_id,
      md.category,
      md.label,
      pm.mastery_xp,
      pm.mastery_level,
      1 + (
        select count(*)
        from public.player_masteries other
        where other.mastery_id = pm.mastery_id
          and other.mastery_xp > pm.mastery_xp
      ) as rank
    from public.player_masteries pm
    join public.mastery_definitions md on md.id = pm.mastery_id
    where pm.user_id = auth.uid()
    order by md.category, pm.mastery_xp desc
  ) summary_rows;
$$;

create or replace function public.cc_mastery_leaderboard(target_mastery_id text, limit_count integer default 25)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(board_rows)), '[]'::jsonb)
  from (
    select
      rank() over (order by pm.mastery_xp desc) as rank,
      pm.user_id,
      coalesce(p.display_name, p.username, 'Vault Runner') as display_name,
      pm.mastery_id,
      pm.mastery_xp,
      pm.mastery_level
    from public.player_masteries pm
    join public.profiles p on p.id = pm.user_id
    join public.mastery_definitions md on md.id = pm.mastery_id
    where pm.mastery_id = target_mastery_id
      and md.is_ranked = true
      and md.is_active = true
    order by pm.mastery_xp desc
    limit greatest(1, least(100, coalesce(limit_count, 25)))
  ) board_rows;
$$;

revoke execute on function public.cc_my_mastery_summary() from public, anon;
revoke execute on function public.cc_mastery_leaderboard(text, integer) from public, anon;
grant execute on function public.cc_my_mastery_summary() to authenticated, service_role;
grant execute on function public.cc_mastery_leaderboard(text, integer) to authenticated, service_role;
