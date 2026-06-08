-- Keep public.profiles aligned when Supabase Auth updates verification or metadata.

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_saved on auth.users;

create trigger on_auth_user_saved
after insert or update of email, email_confirmed_at, is_anonymous, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();
