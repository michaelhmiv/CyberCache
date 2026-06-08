create or replace function public.cc_skill_spend_total(skill_state jsonb)
returns integer
language sql
immutable
set search_path = public
as $$
  select coalesce(sum(value::integer), 0)::integer
  from jsonb_each_text(coalesce(skill_state, '{}'::jsonb));
$$;

revoke execute on function public.cc_skill_spend_total(jsonb) from public, anon;
