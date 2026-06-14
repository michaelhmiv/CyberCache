-- Migration 20260614190000: Username enforcement gate

alter table public.profiles
  add column if not exists username_updated_at timestamptz,
  add column if not exists username_change_count int not null default 0;

create unique index if not exists idx_profiles_username_lower_unique
  on public.profiles (lower(trim(username)))
  where username is not null;

create index if not exists idx_profiles_username_lookup
  on public.profiles (lower(trim(username)));

-- Reserved usernames
create table if not exists public.username_reservations (
  username text primary key
);

truncate public.username_reservations restart identity;
insert into public.username_reservations (username)
values
  ('admin'), ('administrator'), ('mod'), ('moderator'),
  ('system'), ('support'), ('help'), ('null'),
  ('guest'), ('anonymous'), ('cybercache'), ('nousresearch')
on conflict do nothing;

-- Deterministic guest handle derived from user_id; guaranteed unique per auth user.
create or replace function public.cc_generate_guest_username(_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'guest_' || upper(substring(md5(_user_id::text) from 1 for 8));
$$;

create or replace function public.cc_validate_username(_username text)
returns table (
  ok boolean,
  error text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cleaned text;
begin
  if _username is null then
    return query select false, 'Username is required.';
    return;
  end if;

  cleaned := lower(trim(_username));

  if length(cleaned) < 3 then
    return query select false, 'Username must be at least 3 characters.';
    return;
  end if;

  if length(cleaned) > 24 then
    return query select false, 'Username must be 24 characters or fewer.';
    return;
  end if;

  if cleaned ~ '[^a-z0-9_-]' then
    return query select false, 'Username can only use letters, numbers, underscores, and hyphens.';
    return;
  end if;

  if exists (select 1 from public.username_reservations where username = cleaned) then
    return query select false, 'That username is reserved.';
    return;
  end if;

  return query select true, null::text;
end;
$$;

create or replace function public.cc_is_username_available(_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_error text;
  cleaned text;
begin
  select * into v_ok, v_error from public.cc_validate_username(_username);
  if not v_ok then
    return false;
  end if;

  cleaned := lower(trim(_username));
  return not exists (
    select 1 from public.profiles
    where lower(trim(username)) = cleaned
  );
end;
$$;

create or replace function public.cc_set_username(_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_error text;
  cleaned text;
  current_username text;
  current_updated_at timestamptz;
  cooldown_until timestamptz;
begin
  select * into v_ok, v_error from public.cc_validate_username(_username);
  if not v_ok then
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  cleaned := lower(trim(_username));

  select username, username_updated_at
  into current_username, current_updated_at
  from public.profiles
  where id = auth.uid();

  -- If caller already owns this exact username, no-op success
  if lower(trim(coalesce(current_username, ''))) = cleaned then
    return jsonb_build_object('ok', true);
  end if;

  -- Rename cooldown: 7 days since last username change (auto-detected)
  if current_username is not null and current_updated_at is not null then
    cooldown_until := current_updated_at + interval '7 days';
    if now() < cooldown_until then
      return jsonb_build_object(
        'ok', false,
        'error', format('You can rename again after %s.', cooldown_until::text)
      );
    end if;
  end if;

  if not public.cc_is_username_available(_username) then
    return jsonb_build_object('ok', false, 'error', 'That username is already taken.');
  end if;

  update public.profiles
  set
    username = trim(_username),
    username_updated_at = now(),
    username_change_count = username_change_count + 1,
    updated_at = now()
  where id = auth.uid();

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found.');
  end if;

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'That username is already taken.');
end;
$$;

create or replace function public.cc_my_profile_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'account_type', p.account_type,
    'has_username', p.username is not null,
    'username_updated_at', p.username_updated_at,
    'can_rename_at', p.username_updated_at + interval '7 days'
  )
  from public.profiles p
  where p.id = auth.uid();
$$;

-- Update handle_new_user to auto-assign guests and preserve chosen usernames.
-- Chosen usernames are validated server-side; if invalid/unavailable, fall back to guest handle.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  chosen_username text;
  assigned_username text;
  v_ok boolean;
  v_error text;
begin
  chosen_username := nullif(trim(new.raw_user_meta_data ->> 'username'), '');

  if chosen_username is not null then
    select * into v_ok, v_error from public.cc_validate_username(chosen_username);
    if v_ok and public.cc_is_username_available(chosen_username) then
      assigned_username := chosen_username;
    else
      assigned_username := public.cc_generate_guest_username(new.id);
    end if;
  elsif coalesce(new.is_anonymous, false) then
    assigned_username := public.cc_generate_guest_username(new.id);
  else
    assigned_username := null;
  end if;

  begin
    insert into public.profiles (
      id,
      username,
      display_name,
      account_type,
      email,
      email_verified_at,
      verification_grace_expires_at
    ) values (
      new.id,
      assigned_username,
      nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
      public.resolve_account_type(new.is_anonymous, new.email_confirmed_at),
      new.email,
      new.email_confirmed_at,
      now() + interval '7 days'
    )
    on conflict (id) do update set
      username = coalesce(public.profiles.username, excluded.username),
      display_name = coalesce(public.profiles.display_name, excluded.display_name),
      account_type = excluded.account_type,
      email = excluded.email,
      email_verified_at = excluded.email_verified_at,
      verification_grace_expires_at = coalesce(public.profiles.verification_grace_expires_at, public.profiles.created_at + interval '7 days');
  exception
    when unique_violation then
      -- Another flow created/upserted the profile concurrently; leave auth user intact.
      null;
  end;

  return new;
end;
$$;

-- Backfill existing guest profiles without usernames with deterministic guest handles.
update public.profiles
set username = public.cc_generate_guest_username(id),
    username_updated_at = null,
    username_change_count = 0
where username is null and account_type = 'guest';

-- Grants
revoke execute on function public.cc_validate_username(text) from public, anon, authenticated;
revoke execute on function public.cc_generate_guest_username(uuid) from public, anon, authenticated;
revoke execute on function public.cc_is_username_available(text) from public, anon;
revoke execute on function public.cc_set_username(text) from public, anon;
revoke execute on function public.cc_my_profile_summary() from public, anon;

grant execute on function public.cc_is_username_available(text) to authenticated;
grant execute on function public.cc_set_username(text) to authenticated;
grant execute on function public.cc_my_profile_summary() to authenticated;

revoke all on public.username_reservations from public, anon, authenticated;
