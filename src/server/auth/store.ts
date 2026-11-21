/**
 * Auth persistence (Route B, slice B1).
 *
 * AuthStore is the seam between the Chef's auth routes and storage:
 * InMemoryAuthStore for tests, PgAuthStore (db/migrations/0001_auth.sql)
 * for Railway Postgres. Accounts own identity only; game state stays in
 * the existing profile/item tables keyed by the same account id.
 */
import { randomUUID } from 'node:crypto';
import { hashPassword, hashPasswordAsync, MAX_PASSWORD_LENGTH, verifyPasswordAsync } from './passwords';
import { hashRefreshToken, newRefreshToken, REFRESH_TOKEN_TTL_MS } from './tokens';

export interface Account {
  id: string;
  email: string | null;
  isGuest: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface Session {
  account: Account;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type AuthErrorCode =
  | 'email_taken'
  | 'identity_link_conflict'
  | 'invalid_credentials'
  | 'invalid_refresh'
  | 'refresh_reuse'
  | 'not_guest'
  | 'validation';

/** Audit A-12 refusal copy, shared by both stores' link-conflict throw. */
export const IDENTITY_LINK_CONFLICT_MESSAGE =
  'This Google account is already linked to another hunter — sign in with it instead, or link a different Google account';

export class AuthStoreError extends Error {
  constructor(public readonly code: AuthErrorCode, message: string) {
    super(message);
  }
}

export interface PlayerReportResult {
  ok: true;
  deduplicated: boolean;
}

export interface AuthStore {
  createGuest(now: Date): Promise<Session>;
  register(email: string, password: string, now: Date, upgradeAccountId?: string): Promise<Session>;
  login(email: string, password: string, now: Date): Promise<Session>;
  refresh(refreshToken: string, now: Date): Promise<Session>;
  loginWithIdentity(provider: string, identity: { subject: string; email: string | null; emailVerified: boolean }, now: Date, linkAccountId?: string): Promise<Session>;
  logout(refreshToken: string): Promise<void>;
  getAccount(id: string): Promise<Account | null>;
  deleteAccount(accountId: string): Promise<boolean>;
  createReport(reporterId: string, reportedAccountId: string, context: string, now: Date): Promise<PlayerReportResult>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized) || normalized.length > 254) {
    throw new AuthStoreError('validation', 'A valid email address is required');
  }
  return normalized;
}

export function validatePassword(password: string): void {
  if (typeof password !== 'string' || password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
    throw new AuthStoreError('validation', 'Password must be 8–128 characters');
  }
}

const REPORT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// In-memory implementation (tests; single-process dev)
// ---------------------------------------------------------------------------

interface MemAccount extends Account {
  passwordHash: string | null;
}
interface MemRefresh {
  hash: string;
  accountId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByHash: string | null;
  /**
   * Why the row was revoked (audit A-05 partial): 'logout' marks an
   * explicit sign-out, so a later refresh attempt with that token is
   * a plain invalid token — NOT token theft. Null covers rotation
   * and theft-revocation, whose reuse keeps the nuke-all response.
   */
  revokedReason: string | null;
}

interface MemReport {
  id: string;
  reporterId: string;
  reportedAccountId: string;
  context: string;
  createdAt: Date;
}

export class InMemoryAuthStore implements AuthStore {
  private accounts = new Map<string, MemAccount>();
  private byEmail = new Map<string, string>();
  private refreshTokens = new Map<string, MemRefresh>();
  private reports: MemReport[] = [];

  private issueSession(account: MemAccount, now: Date): Session {
    const { token, hash } = newRefreshToken();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    this.refreshTokens.set(hash, { hash, accountId: account.id, expiresAt, revokedAt: null, replacedByHash: null, revokedReason: null });
    return { account: publicAccount(account), refreshToken: token, refreshExpiresAt: expiresAt };
  }

  async createGuest(now: Date): Promise<Session> {
    const account: MemAccount = {
      id: randomUUID(), email: null, isGuest: true, emailVerifiedAt: null, createdAt: now, passwordHash: null,
    };
    this.accounts.set(account.id, account);
    return this.issueSession(account, now);
  }

  async register(email: string, password: string, now: Date, upgradeAccountId?: string): Promise<Session> {
    const normalized = normalizeEmail(email);
    validatePassword(password);
    if (this.byEmail.has(normalized)) throw new AuthStoreError('email_taken', 'That email is already registered');
    const passwordHash = await hashPasswordAsync(password);
    let account: MemAccount;
    if (upgradeAccountId) {
      const existing = this.accounts.get(upgradeAccountId);
      if (!existing || !existing.isGuest) throw new AuthStoreError('not_guest', 'Only a guest session can be upgraded');
      account = existing;
      account.email = normalized;
      account.isGuest = false;
      account.passwordHash = passwordHash;
    } else {
      account = {
        id: randomUUID(), email: normalized, isGuest: false, emailVerifiedAt: null, createdAt: now,
        passwordHash,
      };
      this.accounts.set(account.id, account);
    }
    this.byEmail.set(normalized, account.id);
    return this.issueSession(account, now);
  }

  async login(email: string, password: string, now: Date): Promise<Session> {
    const normalized = normalizeEmail(email);
    if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
      throw new AuthStoreError('invalid_credentials', 'Email or password is incorrect');
    }
    const id = this.byEmail.get(normalized);
    const account = id ? this.accounts.get(id) : undefined;
    // Verify against a hash either way so timing does not reveal existence.
    const ok = account?.passwordHash
      ? await verifyPasswordAsync(password, account.passwordHash)
      : (await verifyPasswordAsync(password, DUMMY_HASH), false);
    if (!account || !ok) throw new AuthStoreError('invalid_credentials', 'Email or password is incorrect');
    return this.issueSession(account, now);
  }

  async refresh(refreshToken: string, now: Date): Promise<Session> {
    const hash = hashRefreshToken(refreshToken);
    const row = this.refreshTokens.get(hash);
    if (!row) throw new AuthStoreError('invalid_refresh', 'Refresh token is not recognized');
    if (row.revokedAt) {
      // A token revoked by an explicit sign-out is not theft
      // (audit A-05 partial): the client's own refresh can race the
      // sign-out, and reading that as reuse revoked every session on
      // every device. Refuse it plainly and touch nothing else.
      if (row.revokedReason === 'logout') {
        throw new AuthStoreError('invalid_refresh', 'Refresh token revoked');
      }
      // A rotated/revoked token was presented again: treat as theft and
      // revoke every session for the account.
      for (const t of this.refreshTokens.values()) {
        if (t.accountId === row.accountId && !t.revokedAt) t.revokedAt = now;
      }
      throw new AuthStoreError('refresh_reuse', 'Refresh token reuse detected; all sessions revoked');
    }
    if (row.expiresAt.getTime() <= now.getTime()) throw new AuthStoreError('invalid_refresh', 'Refresh token expired');
    const account = this.accounts.get(row.accountId);
    if (!account) throw new AuthStoreError('invalid_refresh', 'Account no longer exists');
    const session = this.issueSession(account, now);
    row.revokedAt = now;
    row.replacedByHash = hashRefreshToken(session.refreshToken);
    return session;
  }

  private identities = new Map<string, string>();

  async loginWithIdentity(provider: string, identity: { subject: string; email: string | null; emailVerified: boolean }, now: Date, linkAccountId?: string): Promise<Session> {
    const key = `${provider}:${identity.subject}`;
    const linkedId = this.identities.get(key);
    if (linkedId) {
      // Audit A-12: a live link request (signed-in caller) that meets an
      // identity bound to a DIFFERENT account is a conflict, never a
      // silent account switch — the caller's progress would be left
      // behind with a bare 200 for the other account. Re-linking one's
      // own identity and bare sign-in (no link id) are unaffected.
      if (linkAccountId && linkedId !== linkAccountId) {
        throw new AuthStoreError('identity_link_conflict', IDENTITY_LINK_CONFLICT_MESSAGE);
      }
      const account = this.accounts.get(linkedId);
      if (account) return this.issueSession(account, now);
    }
    if (linkAccountId) {
      const account = this.accounts.get(linkAccountId);
      if (!account) throw new AuthStoreError('invalid_refresh', 'Linking account no longer exists');
      if (!account.email && identity.email) {
        const existingOwner = this.byEmail.get(identity.email);
        if (existingOwner && existingOwner !== account.id) {
          throw new AuthStoreError('email_taken', 'That email already belongs to another account');
        }
      }
      this.identities.set(key, account.id);
      if (!account.email && identity.email) {
        account.email = identity.email;
        this.byEmail.set(identity.email, account.id);
      }
      if (identity.emailVerified && account.email === identity.email && !account.emailVerifiedAt) {
        account.emailVerifiedAt = now;
      }
      // Linking a real identity promotes the account in place (audit A-01):
      // it stops being a guest, exactly as the email-register upgrade does.
      account.isGuest = false;
      return this.issueSession(account, now);
    }
    // Cross-provider resolution (iOS launch Track 3, brief account
    // rule): a bare identity sign-in whose VERIFIED email matches an
    // existing identity-backed account resolves to THAT account —
    // an Apple identity and a Google identity with the same verified
    // email are the same player, so the new identity links to the
    // account that already owns the address. The guards keep audit
    // A-13 intact: the owner must itself be identity-backed (a
    // password-only account is never claimed this way — it still
    // refuses below) and its email must be verified on the account,
    // and the incoming email must be verified by its provider.
    // Differing or unverified emails never reach this branch.
    if (identity.email && identity.emailVerified) {
      const ownerId = this.byEmail.get(identity.email);
      const owner = ownerId ? this.accounts.get(ownerId) : undefined;
      if (
        owner &&
        owner.emailVerifiedAt &&
        [...this.identities.values()].includes(owner.id)
      ) {
        this.identities.set(key, owner.id);
        return this.issueSession(owner, now);
      }
    }
    // No silent merge (audit A-13): the Postgres store refuses this
    // exact case — its insert hits the email unique constraint and
    // surfaces email_taken. This twin previously just overwrote
    // byEmail, silently re-pointing email login to the brand-new
    // Google account and orphaning the password account that owned
    // the address. Same contract, same error.
    if (identity.email && this.byEmail.has(identity.email)) {
      throw new AuthStoreError('email_taken', 'That email already has an account; sign in and link Google from inside the app');
    }
    const account: MemAccount = {
      id: randomUUID(),
      email: identity.email,
      isGuest: false,
      emailVerifiedAt: identity.emailVerified && identity.email ? now : null,
      createdAt: now,
      passwordHash: null,
    };
    this.accounts.set(account.id, account);
    if (identity.email) this.byEmail.set(identity.email, account.id);
    this.identities.set(key, account.id);
    return this.issueSession(account, now);
  }

  async logout(refreshToken: string): Promise<void> {
    const row = this.refreshTokens.get(hashRefreshToken(refreshToken));
    if (row && !row.revokedAt) {
      row.revokedAt = new Date();
      row.revokedReason = 'logout';
    }
  }

  async getAccount(id: string): Promise<Account | null> {
    const account = this.accounts.get(id);
    return account ? publicAccount(account) : null;
  }

  async deleteAccount(accountId: string): Promise<boolean> {
    const existing = this.accounts.get(accountId);
    if (!existing) return false;
    if (existing.email) this.byEmail.delete(existing.email);
    this.accounts.delete(accountId);
    for (const [k, v] of this.identities.entries()) {
      if (v === accountId) this.identities.delete(k);
    }
    for (const [hash, row] of this.refreshTokens.entries()) {
      if (row.accountId === accountId) this.refreshTokens.delete(hash);
    }
    return true;
  }

  async createReport(reporterId: string, reportedAccountId: string, context: string, now: Date): Promise<PlayerReportResult> {
    if (reporterId === reportedAccountId) {
      throw new AuthStoreError('validation', 'You cannot report your own account');
    }
    const cutoff = now.getTime() - REPORT_DEDUP_WINDOW_MS;
    const dup = this.reports.find(
      (r) =>
        r.reporterId === reporterId &&
        r.reportedAccountId === reportedAccountId &&
        r.context === context &&
        r.createdAt.getTime() >= cutoff,
    );
    if (dup) return { ok: true, deduplicated: true };
    this.reports.push({
      id: randomUUID(),
      reporterId,
      reportedAccountId,
      context,
      createdAt: now,
    });
    return { ok: true, deduplicated: false };
  }

  /** Test inspection helper. */
  getReports(): readonly MemReport[] {
    return this.reports;
  }
}

function publicAccount(a: MemAccount): Account {
  return { id: a.id, email: a.email, isGuest: a.isGuest, emailVerifiedAt: a.emailVerifiedAt, createdAt: a.createdAt };
}

const DUMMY_HASH = hashPassword('dummy-password-for-timing-parity');

// ---------------------------------------------------------------------------
// Postgres implementation (Railway) — see db/migrations/0001_auth.sql
// ---------------------------------------------------------------------------

export interface PgClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

export interface PgQuery {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect?(): Promise<PgClient>;
}

interface PgAccountRow {
  id: string;
  email: string | null;
  is_guest: boolean;
  email_verified_at: Date | null;
  created_at: Date;
  password_hash?: string | null;
}

function rowToAccount(r: PgAccountRow): Account & { passwordHash: string | null } {
  return {
    id: r.id, email: r.email, isGuest: r.is_guest, emailVerifiedAt: r.email_verified_at,
    createdAt: r.created_at, passwordHash: r.password_hash ?? null,
  };
}

export class PgAuthStore implements AuthStore {
  constructor(private readonly db: PgQuery) {}

  private async withTx<T>(fn: (q: Pick<PgQuery, 'query'>) => Promise<T>): Promise<T> {
    if (!this.db.connect) {
      return fn(this.db);
    }
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore rollback error */ }
      throw err;
    } finally {
      client.release();
    }
  }

  private async issueSession(account: Account, now: Date, q: PgQuery = this.db): Promise<Session> {
    const { token, hash } = newRefreshToken();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    await q.query(
      'insert into auth_refresh_tokens (token_hash, account_id, expires_at) values ($1, $2, $3)',
      [hash, account.id, expiresAt],
    );
    return { account, refreshToken: token, refreshExpiresAt: expiresAt };
  }

  async createGuest(now: Date): Promise<Session> {
    const { rows } = await this.db.query(
      'insert into auth_accounts (is_guest) values (true) returning id, email, is_guest, email_verified_at, created_at',
    );
    return this.issueSession(rowToAccount(rows[0] as unknown as PgAccountRow), now);
  }

  async register(email: string, password: string, now: Date, upgradeAccountId?: string): Promise<Session> {
    const normalized = normalizeEmail(email);
    validatePassword(password);
    const passwordHash = await hashPasswordAsync(password);
    try {
      if (upgradeAccountId) {
        const { rows } = await this.db.query(
          `update auth_accounts set email = $2, is_guest = false, password_hash = $3, updated_at = now()
           where id = $1 and is_guest = true
           returning id, email, is_guest, email_verified_at, created_at`,
          [upgradeAccountId, normalized, passwordHash],
        );
        if (rows.length === 0) throw new AuthStoreError('not_guest', 'Only a guest session can be upgraded');
        return this.issueSession(rowToAccount(rows[0] as unknown as PgAccountRow), now);
      }
      const { rows } = await this.db.query(
        `insert into auth_accounts (email, is_guest, password_hash) values ($1, false, $2)
         returning id, email, is_guest, email_verified_at, created_at`,
        [normalized, passwordHash],
      );
      return this.issueSession(rowToAccount(rows[0] as unknown as PgAccountRow), now);
    } catch (err) {
      if (err instanceof AuthStoreError) throw err;
      if ((err as { code?: string }).code === '23505') throw new AuthStoreError('email_taken', 'That email is already registered');
      throw err;
    }
  }

  async login(email: string, password: string, now: Date): Promise<Session> {
    const normalized = normalizeEmail(email);
    if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
      throw new AuthStoreError('invalid_credentials', 'Email or password is incorrect');
    }
    const { rows } = await this.db.query(
      'select id, email, is_guest, email_verified_at, created_at, password_hash from auth_accounts where email = $1',
      [normalized],
    );
    const account = rows.length ? rowToAccount(rows[0] as unknown as PgAccountRow) : null;
    const ok = account?.passwordHash
      ? await verifyPasswordAsync(password, account.passwordHash)
      : (await verifyPasswordAsync(password, DUMMY_HASH), false);
    if (!account || !ok) throw new AuthStoreError('invalid_credentials', 'Email or password is incorrect');
    return this.issueSession(account, now);
  }

  async refresh(refreshToken: string, now: Date): Promise<Session> {
    const hash = hashRefreshToken(refreshToken);
    return this.withTx(async (q) => {
      const { rows } = await q.query(
        'select account_id, expires_at, revoked_at, revoked_reason from auth_refresh_tokens where token_hash = $1 for update',
        [hash],
      );
      if (rows.length === 0) throw new AuthStoreError('invalid_refresh', 'Refresh token is not recognized');
      const row = rows[0] as { account_id: string; expires_at: Date; revoked_at: Date | null; revoked_reason: string | null };
      if (row.revoked_at) {
        if (row.revoked_reason === 'logout') {
          throw new AuthStoreError('invalid_refresh', 'Refresh token revoked');
        }
        // Revoke all active sessions on reuse detection (commit revocation outside tx if throwing).
        await this.db.query('update auth_refresh_tokens set revoked_at = $2 where account_id = $1 and revoked_at is null', [row.account_id, now]);
        throw new AuthStoreError('refresh_reuse', 'Refresh token reuse detected; all sessions revoked');
      }
      if (new Date(row.expires_at).getTime() <= now.getTime()) throw new AuthStoreError('invalid_refresh', 'Refresh token expired');
      const acctRows = await q.query(
        'select id, email, is_guest, email_verified_at, created_at from auth_accounts where id = $1',
        [row.account_id],
      );
      const account = acctRows.rows.length ? rowToAccount(acctRows.rows[0] as unknown as PgAccountRow) : null;
      if (!account) throw new AuthStoreError('invalid_refresh', 'Account no longer exists');
      const session = await this.issueSession(account, now, q);
      const updated = await q.query(
        'update auth_refresh_tokens set revoked_at = $2, replaced_by_hash = $3 where token_hash = $1 and revoked_at is null returning token_hash',
        [hash, now, hashRefreshToken(session.refreshToken)],
      );
      if (updated.rows.length === 0) {
        throw new AuthStoreError('refresh_reuse', 'Refresh token reuse detected; all sessions revoked');
      }
      return session;
    });
  }

  async loginWithIdentity(provider: string, identity: { subject: string; email: string | null; emailVerified: boolean }, now: Date, linkAccountId?: string): Promise<Session> {
    const found = await this.db.query(
      'select account_id from auth_identities where provider = $1 and provider_subject = $2',
      [provider, identity.subject],
    );
    if (found.rows.length > 0) {
      if (linkAccountId && (found.rows[0].account_id as string) !== linkAccountId) {
        throw new AuthStoreError('identity_link_conflict', IDENTITY_LINK_CONFLICT_MESSAGE);
      }
      const account = await this.getAccount(found.rows[0].account_id as string);
      if (account) return this.issueSession(account, now);
    }
    if (linkAccountId) {
      return this.withTx(async (q) => {
        const acctRows = await q.query(
          'select id, email, is_guest, email_verified_at, created_at from auth_accounts where id = $1 for update',
          [linkAccountId],
        );
        const account = acctRows.rows.length ? rowToAccount(acctRows.rows[0] as unknown as PgAccountRow) : null;
        if (!account) throw new AuthStoreError('invalid_refresh', 'Linking account no longer exists');
        try {
          const insertedIdentity = await q.query(
            'insert into auth_identities (provider, provider_subject, account_id) values ($1, $2, $3) on conflict do nothing returning account_id',
            [provider, identity.subject, account.id],
          );
          if (insertedIdentity.rows.length === 0) {
            const existing = await q.query(
              'select account_id from auth_identities where provider = $1 and provider_subject = $2',
              [provider, identity.subject],
            );
            if (existing.rows.length > 0 && (existing.rows[0].account_id as string) !== account.id) {
              throw new AuthStoreError('identity_link_conflict', IDENTITY_LINK_CONFLICT_MESSAGE);
            }
          }
          if (!account.email && identity.email) {
            await q.query('update auth_accounts set email = $2, updated_at = now() where id = $1', [account.id, identity.email]);
            account.email = identity.email;
          }
          if (identity.emailVerified && account.email === identity.email && !account.emailVerifiedAt) {
            await q.query('update auth_accounts set email_verified_at = $2, updated_at = now() where id = $1', [account.id, now]);
            account.emailVerifiedAt = now;
          }
          if (account.isGuest) {
            await q.query('update auth_accounts set is_guest = false, updated_at = now() where id = $1', [account.id]);
            account.isGuest = false;
          }
          return this.issueSession(account, now, q);
        } catch (err) {
          if (err instanceof AuthStoreError) throw err;
          if ((err as { code?: string }).code === '23505') {
            throw new AuthStoreError('email_taken', 'That email already belongs to another account');
          }
          throw err;
        }
      });
    }
    const inserted = await this.db.query(
      `insert into auth_accounts (email, is_guest, password_hash, email_verified_at) values ($1, false, null, $2)
       returning id, email, is_guest, email_verified_at, created_at`,
      [identity.email, identity.emailVerified && identity.email ? now : null],
    ).catch((err: { code?: string }) => {
      if (err.code === '23505') return null;
      throw err;
    });
    if (inserted) {
      const account = rowToAccount(inserted.rows[0] as unknown as PgAccountRow);
      await this.db.query(
        'insert into auth_identities (provider, provider_subject, account_id) values ($1, $2, $3)',
        [provider, identity.subject, account.id],
      );
      return this.issueSession(account, now);
    }
    if (identity.email && identity.emailVerified) {
      try {
        const ownerRows = await this.db.query(
          'select id, email, is_guest, email_verified_at, created_at from auth_accounts where email = $1',
          [identity.email],
        );
        if (ownerRows.rows.length > 0) {
          const owner = rowToAccount(ownerRows.rows[0] as unknown as PgAccountRow);
          if (owner.emailVerifiedAt) {
            const linkRows = await this.db.query(
              'select 1 as one from auth_identities where account_id = $1 limit 1',
              [owner.id],
            );
            if (linkRows.rows.length > 0) {
              await this.db.query(
                'insert into auth_identities (provider, provider_subject, account_id) values ($1, $2, $3) on conflict do nothing',
                [provider, identity.subject, owner.id],
              );
              return this.issueSession(owner, now);
            }
          }
        }
      } catch { /* eligibility unproven — the A-13 refusal stands */ }
    }
    throw new AuthStoreError('email_taken', 'That email already has an account; sign in and link Google from inside the app');
  }

  async logout(refreshToken: string): Promise<void> {
    await this.db.query("update auth_refresh_tokens set revoked_at = now(), revoked_reason = 'logout' where token_hash = $1 and revoked_at is null", [hashRefreshToken(refreshToken)]);
  }

  async getAccount(id: string): Promise<Account | null> {
    const { rows } = await this.db.query(
      'select id, email, is_guest, email_verified_at, created_at from auth_accounts where id = $1',
      [id],
    );
    return rows.length ? rowToAccount(rows[0] as unknown as PgAccountRow) : null;
  }

  async deleteAccount(accountId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      'select public.cc_delete_account($1) as deleted',
      [accountId],
    );
    return Boolean(rows[0]?.deleted);
  }

  async createReport(reporterId: string, reportedAccountId: string, context: string, now: Date): Promise<PlayerReportResult> {
    if (reporterId === reportedAccountId) {
      throw new AuthStoreError('validation', 'You cannot report your own account');
    }
    const { rows } = await this.db.query(
      `with existing as (
         select id from public.player_reports
          where reporter_id = $1
            and reported_account_id = $2
            and context = $3
            and created_at >= ($4::timestamptz - interval '24 hours')
          limit 1
       ),
       ins as (
         insert into public.player_reports (reporter_id, reported_account_id, context, created_at)
         select $1, $2, $3, $4::timestamptz
          where not exists (select 1 from existing)
         returning id
       )
       select exists(select 1 from existing) as deduplicated`,
      [reporterId, reportedAccountId, context, now.toISOString()],
    );
    return { ok: true, deduplicated: Boolean(rows[0]?.deduplicated) };
  }
}
