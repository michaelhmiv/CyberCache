/**
 * Auth persistence (Route B, slice B1).
 *
 * AuthStore is the seam between the Chef's auth routes and storage:
 * InMemoryAuthStore for tests, PgAuthStore (db/migrations/0001_auth.sql)
 * for Railway Postgres. Accounts own identity only; game state stays in
 * the existing profile/item tables keyed by the same account id.
 */
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from './passwords';
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
  | 'invalid_credentials'
  | 'invalid_refresh'
  | 'refresh_reuse'
  | 'not_guest'
  | 'validation';

export class AuthStoreError extends Error {
  constructor(public readonly code: AuthErrorCode, message: string) {
    super(message);
  }
}

export interface AuthStore {
  createGuest(now: Date): Promise<Session>;
  register(email: string, password: string, now: Date, upgradeAccountId?: string): Promise<Session>;
  login(email: string, password: string, now: Date): Promise<Session>;
  refresh(refreshToken: string, now: Date): Promise<Session>;
  logout(refreshToken: string): Promise<void>;
  getAccount(id: string): Promise<Account | null>;
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
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AuthStoreError('validation', 'Password must be 8–128 characters');
  }
}

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
}

export class InMemoryAuthStore implements AuthStore {
  private accounts = new Map<string, MemAccount>();
  private byEmail = new Map<string, string>();
  private refreshTokens = new Map<string, MemRefresh>();

  private issueSession(account: MemAccount, now: Date): Session {
    const { token, hash } = newRefreshToken();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    this.refreshTokens.set(hash, { hash, accountId: account.id, expiresAt, revokedAt: null, replacedByHash: null });
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
    let account: MemAccount;
    if (upgradeAccountId) {
      const existing = this.accounts.get(upgradeAccountId);
      if (!existing || !existing.isGuest) throw new AuthStoreError('not_guest', 'Only a guest session can be upgraded');
      account = existing;
      account.email = normalized;
      account.isGuest = false;
      account.passwordHash = hashPassword(password);
    } else {
      account = {
        id: randomUUID(), email: normalized, isGuest: false, emailVerifiedAt: null, createdAt: now,
        passwordHash: hashPassword(password),
      };
      this.accounts.set(account.id, account);
    }
    this.byEmail.set(normalized, account.id);
    return this.issueSession(account, now);
  }

  async login(email: string, password: string, now: Date): Promise<Session> {
    const normalized = normalizeEmail(email);
    const id = this.byEmail.get(normalized);
    const account = id ? this.accounts.get(id) : undefined;
    // Verify against a hash either way so timing does not reveal existence.
    const ok = account?.passwordHash ? verifyPassword(password, account.passwordHash) : (verifyPassword(password, DUMMY_HASH), false);
    if (!account || !ok) throw new AuthStoreError('invalid_credentials', 'Email or password is incorrect');
    return this.issueSession(account, now);
  }

  async refresh(refreshToken: string, now: Date): Promise<Session> {
    const hash = hashRefreshToken(refreshToken);
    const row = this.refreshTokens.get(hash);
    if (!row) throw new AuthStoreError('invalid_refresh', 'Refresh token is not recognized');
    if (row.revokedAt) {
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

  async logout(refreshToken: string): Promise<void> {
    const row = this.refreshTokens.get(hashRefreshToken(refreshToken));
    if (row && !row.revokedAt) row.revokedAt = new Date();
  }

  async getAccount(id: string): Promise<Account | null> {
    const account = this.accounts.get(id);
    return account ? publicAccount(account) : null;
  }
}

function publicAccount(a: MemAccount): Account {
  return { id: a.id, email: a.email, isGuest: a.isGuest, emailVerifiedAt: a.emailVerifiedAt, createdAt: a.createdAt };
}

const DUMMY_HASH = hashPassword('dummy-password-for-timing-parity');

// ---------------------------------------------------------------------------
// Postgres implementation (Railway) — see db/migrations/0001_auth.sql
// ---------------------------------------------------------------------------

export interface PgQuery {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
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

  private async issueSession(account: Account, now: Date): Promise<Session> {
    const { token, hash } = newRefreshToken();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    await this.db.query(
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
    const passwordHash = hashPassword(password);
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
    const { rows } = await this.db.query(
      'select id, email, is_guest, email_verified_at, created_at, password_hash from auth_accounts where email = $1',
      [normalized],
    );
    const account = rows.length ? rowToAccount(rows[0] as unknown as PgAccountRow) : null;
    const ok = account?.passwordHash ? verifyPassword(password, account.passwordHash) : (verifyPassword(password, DUMMY_HASH), false);
    if (!account || !ok) throw new AuthStoreError('invalid_credentials', 'Email or password is incorrect');
    return this.issueSession(account, now);
  }

  async refresh(refreshToken: string, now: Date): Promise<Session> {
    const hash = hashRefreshToken(refreshToken);
    const { rows } = await this.db.query(
      'select account_id, expires_at, revoked_at from auth_refresh_tokens where token_hash = $1',
      [hash],
    );
    if (rows.length === 0) throw new AuthStoreError('invalid_refresh', 'Refresh token is not recognized');
    const row = rows[0] as { account_id: string; expires_at: Date; revoked_at: Date | null };
    if (row.revoked_at) {
      await this.db.query('update auth_refresh_tokens set revoked_at = $2 where account_id = $1 and revoked_at is null', [row.account_id, now]);
      throw new AuthStoreError('refresh_reuse', 'Refresh token reuse detected; all sessions revoked');
    }
    if (new Date(row.expires_at).getTime() <= now.getTime()) throw new AuthStoreError('invalid_refresh', 'Refresh token expired');
    const account = await this.getAccount(row.account_id);
    if (!account) throw new AuthStoreError('invalid_refresh', 'Account no longer exists');
    const session = await this.issueSession(account, now);
    await this.db.query(
      'update auth_refresh_tokens set revoked_at = $2, replaced_by_hash = $3 where token_hash = $1',
      [hash, now, hashRefreshToken(session.refreshToken)],
    );
    return session;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.db.query('update auth_refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null', [hashRefreshToken(refreshToken)]);
  }

  async getAccount(id: string): Promise<Account | null> {
    const { rows } = await this.db.query(
      'select id, email, is_guest, email_verified_at, created_at from auth_accounts where id = $1',
      [id],
    );
    return rows.length ? rowToAccount(rows[0] as unknown as PgAccountRow) : null;
  }
}
