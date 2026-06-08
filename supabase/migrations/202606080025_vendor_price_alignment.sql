create or replace function public.cc_vendor_price(item_key text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case item_key
    when 'MedKit' then 250
    when 'ShieldCell' then 300
    when 'AmmoPack' then 150
    when 'Grenade' then 400
    when 'BossScanner' then 500
    when 'InsuranceToken' then 750
    else null
  end;
$$;

revoke execute on function public.cc_vendor_price(text) from public, anon;
