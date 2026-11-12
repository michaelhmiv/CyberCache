/**
 * A-13 — the in-memory auth store silently overwrote email
 * ownership that the Postgres store refuses: Pg find-or-create
 * Google sign-in hits the email unique constraint and surfaces
 * email_taken ("sign in and link Google from inside the app"),
 * while the memory twin just re-pointed byEmail at the brand-new
 * Google account, orphaning the password account that owned the
 * address. The twin is what most tests run against, so the
 * no-silent-merge guard production relies on was untestable.
 *
 * The audit's CI assertion: "A store-parity test run against both
 * implementations: register email E by password, then
 * loginWithIdentity (no link id) with a Google identity carrying
 * E → assert both stores throw email_taken."
 *
 * The Pg half runs against a scripted PgQuery fake: no identity
 * row, and the account insert raises the unique violation (23505)
 * — exactly what the real database does when the email is owned.
 */
import { describe, expect, it } from 'vitest';
import { AuthStoreError, InMemoryAuthStore, PgAuthStore, type PgQuery } from '../server/auth/store';

const NOW = new Date('2026-11-12T00:00:00.000Z');
const EMAIL = 'owner@example.com';
const PASSWORD = 'correct horse battery';

describe('identity find-or-create refuses an owned email in BOTH stores (audit A-13)', () => {
  it('InMemoryAuthStore throws email_taken and leaves email login pointing at the original account', async () => {
    const store = new InMemoryAuthStore();
    const registered = await store.register(EMAIL, PASSWORD, NOW);

    await expect(
      store.loginWithIdentity('google', { subject: 'g-new', email: EMAIL, emailVerified: true }, NOW),
    ).rejects.toMatchObject({ code: 'email_taken' });

    // The overwrite is gone: password login still lands on the
    // account that registered the email, not a fresh Google one.
    const session = await store.login(EMAIL, PASSWORD, NOW);
    expect(session.account.id).toBe(registered.account.id);
  });

  it('PgAuthStore surfaces the same email_taken contract from the unique violation', async () => {
    const db: PgQuery = {
      query: async (text: string) => {
        if (text.includes('from auth_identities')) return { rows: [] };
        if (text.includes('insert into auth_accounts')) {
          const err = new Error('duplicate key value violates unique constraint') as Error & { code?: string };
          err.code = '23505';
          throw err;
        }
        throw new Error(`unexpected query in this parity fake: ${text.slice(0, 60)}`);
      },
    };
    const store = new PgAuthStore(db);
    await expect(
      store.loginWithIdentity('google', { subject: 'g-new', email: EMAIL, emailVerified: true }, NOW),
    ).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('both stores use the same refusal message (the link-from-inside instruction)', async () => {
    const memory = new InMemoryAuthStore();
    await memory.register(EMAIL, PASSWORD, NOW);
    const memoryErr = await memory
      .loginWithIdentity('google', { subject: 'g-1', email: EMAIL, emailVerified: true }, NOW)
      .catch((e: unknown) => e);
    expect(memoryErr).toBeInstanceOf(AuthStoreError);
    expect((memoryErr as AuthStoreError).message).toBe(
      'That email already has an account; sign in and link Google from inside the app',
    );
  });

  it('a Google identity with a FREE email still creates its account in the memory store', async () => {
    const store = new InMemoryAuthStore();
    await store.register(EMAIL, PASSWORD, NOW);
    const session = await store.loginWithIdentity(
      'google',
      { subject: 'g-free', email: 'someone-else@example.com', emailVerified: true },
      NOW,
    );
    expect(session.account.email).toBe('someone-else@example.com');
    expect(session.account.isGuest).toBe(false);
  });
});
