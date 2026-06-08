create or replace function public.cc_apply_xp(current_level integer, current_xp bigint, xp_award bigint)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  next_level integer := greatest(1, coalesce(current_level, 1));
  next_xp bigint := greatest(0, coalesce(current_xp, 0)) + greatest(0, coalesce(xp_award, 0));
  threshold bigint;
begin
  loop
    threshold := next_level * 100;
    exit when next_xp < threshold;
    next_xp := next_xp - threshold;
    next_level := next_level + 1;
  end loop;

  return jsonb_build_object('player_level', next_level, 'player_xp', next_xp);
end;
$$;

revoke execute on function public.cc_apply_xp(integer, bigint, bigint) from public, anon;
