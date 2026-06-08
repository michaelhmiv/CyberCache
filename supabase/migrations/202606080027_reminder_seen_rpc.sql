create or replace function public.cc_mark_reminder_seen()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  p public.profiles%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;

  update public.profiles
  set verification_reminder_last_seen_at = now()
  where id = actor
  returning * into p;

  if not found then raise exception 'Profile not found'; end if;
  return p;
end;
$$;

revoke execute on function public.cc_mark_reminder_seen() from public, anon;
grant execute on function public.cc_mark_reminder_seen() to authenticated, service_role;
