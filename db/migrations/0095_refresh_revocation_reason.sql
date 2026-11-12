-- 0095 — Refresh rows record WHY they were revoked (audit A-05, partial).
--
-- Logout marked a refresh row revoked_at with no reason, so a later
-- refresh attempt with that token was indistinguishable from theft:
-- the reuse branch revoked EVERY session for the account, and one
-- device signing out could nuke the player's sessions on all their
-- devices when anything retried the dead token. Logout now stamps
-- revoked_reason = 'logout'; the refresh handler reads a logout-
-- revoked token as a plain invalid token and revokes nothing, while
-- rotated-token reuse (reason null) keeps the theft response.
-- Existing rows keep null — rotation semantics unchanged.

alter table public.auth_refresh_tokens
  add column if not exists revoked_reason text;
