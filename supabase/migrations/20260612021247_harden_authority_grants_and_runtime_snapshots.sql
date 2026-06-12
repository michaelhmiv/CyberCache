-- Harden authority boundaries for Chef-only and internal mutation helpers.
--
-- These functions accept a user id and mutate economy/progression state. They
-- are called by Chef/server code or triggers, not directly by browser clients.
-- User-scoped RPCs that derive actor from auth.uid() remain authenticated.

revoke execute on function public.cc_apply_chef_rewards(uuid, bigint, bigint, bigint, integer, jsonb, jsonb, integer, bigint, text) from authenticated;
grant execute on function public.cc_apply_chef_rewards(uuid, bigint, bigint, bigint, integer, jsonb, jsonb, integer, bigint, text) to service_role;

revoke execute on function public.cc_increment_pity(uuid, text) from authenticated;
grant execute on function public.cc_increment_pity(uuid, text) to service_role;

revoke execute on function public.cc_add_stat(uuid, text, bigint) from authenticated;
revoke execute on function public.cc_set_stat(uuid, text, bigint) from authenticated;
revoke execute on function public.cc_add_mastery_xp(uuid, text, bigint) from authenticated;
revoke execute on function public.cc_set_mastery_xp(uuid, text, bigint) from authenticated;

grant execute on function public.cc_add_stat(uuid, text, bigint) to service_role;
grant execute on function public.cc_set_stat(uuid, text, bigint) to service_role;
grant execute on function public.cc_add_mastery_xp(uuid, text, bigint) to service_role;
grant execute on function public.cc_set_mastery_xp(uuid, text, bigint) to service_role;

comment on table public.player_runtime_snapshots is
  'Per-player display/runtime hydration cache only. Not economy authority: never restore or trust this table for credits, XP, inventory ownership, cache tokens, boss wins, market listings, verified rewards, or other ledger facts.';
