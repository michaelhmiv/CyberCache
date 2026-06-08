create or replace function public.cc_apply_mastery_for_verified_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_payload jsonb := coalesce(new.result_payload -> 'profile', '{}'::jsonb);
  reward_payload jsonb := coalesce(new.result_payload -> 'rewards', '{}'::jsonb);
  action text := new.action_type;
  amount bigint;
  won boolean;
  credits_value bigint;
  scrap_value bigint;
  net_worth_value bigint;
begin
  perform public.cc_add_stat(new.user_id, 'actions.total', 1);
  perform public.cc_add_stat(new.user_id, 'actions.' || action, 1);

  if action in ('cc_make_item', 'cc_draw_item') then
    perform public.cc_add_stat(new.user_id, 'inventory.cache_draws', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.cache_draws', 30);
  elsif action in ('cc_recycle_item', 'cc_salvage_item') then
    amount := greatest(0, coalesce((new.result_payload ->> 'scrap_award')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'inventory.recycle.count', 1);
    perform public.cc_add_stat(new.user_id, 'inventory.scrap_generated', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.recycle', 25);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.scrap_generated', amount);
  elsif action = 'cc_vendor_buy' then
    amount := greatest(1, coalesce((new.result_payload ->> 'quantity')::bigint, 1));
    perform public.cc_add_stat(new.user_id, 'economy.vendor_buys', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.vendor_buys', amount * 15);
  elsif action = 'cc_market_create' then
    perform public.cc_add_stat(new.user_id, 'economy.market_listings', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.market_listings', 20);
  elsif action in ('cc_accept_listing', 'cc_market_transfer') then
    amount := greatest(0, coalesce((new.result_payload -> 'listing' ->> 'price_credits')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'economy.market_sales', 1);
    perform public.cc_add_stat(new.user_id, 'economy.trade_volume', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.market_sales', 50);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.trade_volume', amount);
  elsif action in ('cc_item_service_request', 'cc_item_service_accept') then
    perform public.cc_add_stat(new.user_id, 'services.jobs_touched', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'services.repair', 10);
  elsif action = 'cc_item_job_finish' then
    amount := greatest(0, coalesce((new.result_payload ->> 'price_credits')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'services.completed', 1);
    perform public.cc_add_stat(new.user_id, 'services.revenue', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'services.repair', 50 + amount);
  elsif action in ('cc_battle_result', 'cc_boss_attempt') then
    won := coalesce(new.result_payload -> 'draw' ->> 'outcome', '') = 'victory';
    perform public.cc_add_stat(new.user_id, 'combat.boss_attempts', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_attempts', 20);
    perform public.cc_add_mastery_xp(new.user_id, 'locations.dustwaste', 25);
    if won then
      perform public.cc_add_stat(new.user_id, 'combat.boss_defeats', 1);
      perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_defeats', 100);
    end if;
  elsif action in ('cc_retrain', 'cc_skill_reset') then
    perform public.cc_add_stat(new.user_id, 'skills.retrain', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'skills.training', 25);
  elsif action = 'cc_idle_claim' then
    amount := greatest(0, coalesce((reward_payload ->> 'xp')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'combat.idle_xp_claimed', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'locations.dustwaste', greatest(1, amount));
  end if;

  if profile_payload ? 'credits' then
    credits_value := greatest(0, coalesce((profile_payload ->> 'credits')::bigint, 0));
    scrap_value := greatest(0, coalesce((profile_payload ->> 'scrap')::bigint, 0));
    net_worth_value := credits_value + scrap_value;
    perform public.cc_set_stat(new.user_id, 'account.net_worth', net_worth_value);
    perform public.cc_set_mastery_xp(new.user_id, 'account.net_worth', net_worth_value);
  end if;

  return new;
end;
$$;

revoke execute on function public.cc_apply_mastery_for_verified_action() from public, anon, authenticated;
