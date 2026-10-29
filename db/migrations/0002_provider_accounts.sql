-- Route B, slice B1.5: provider-created accounts (Google first) hold an
-- email with NO password — the password lives with the provider. The B1
-- check constraint wrongly required a password for any non-guest account
-- with an email; drop it. Password presence stays enforced by the
-- application for email/password accounts.
alter table auth_accounts drop constraint if exists auth_accounts_password_for_non_guest;
