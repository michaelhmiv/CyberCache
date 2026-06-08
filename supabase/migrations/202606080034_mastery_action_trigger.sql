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
    perform public.cc_add_stat(new.user_id, 'account.credits_seen', greatest(0, coalesce((profile_payload ->> 'credits')::bigint, 0)));
  end if;

  return new;
end;
$$;

drop trigger if exists on_verified_action_mastery on public.verified_action_ledger;
create trigger on_verified_action_mastery
after insert on public.verified_action_ledger
for each row execute function public.cc_apply_mastery_for_verified_action();

revoke execute on function public.cc_apply_mastery_for_verified_action() from public, anon, authenticated;
