-- Fix authority regression from 20260612170000.
--
-- The atomic settlement migration accidentally granted cc_apply_chef_rewards
-- and cc_settle_offline_roaming to authenticated. Migration 20260612021247
-- correctly revoked these from authenticated (Chef/server-only functions).
-- This reinstates the correct boundary: service_role only.

revoke execute on function public.cc_apply_chef_rewards(uuid, bigint, bigint, bigint, integer, jsonb, jsonb, integer, bigint, text) from authenticated;
grant execute on function public.cc_apply_chef_rewards(uuid, bigint, bigint, bigint, integer, jsonb, jsonb, integer, bigint, text) to service_role;

revoke execute on function public.cc_settle_offline_roaming(text, bigint, bigint, bigint, integer, jsonb, jsonb, integer) from authenticated;
grant execute on function public.cc_settle_offline_roaming(text, bigint, bigint, bigint, integer, jsonb, jsonb, integer) to service_role;
