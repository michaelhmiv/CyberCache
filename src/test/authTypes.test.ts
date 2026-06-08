import { describe, expect, it } from 'vitest';
import {
  getAuthRedirectConfig,
  parseAuthStatusMessage,
  parseInitialAuthMode,
  toAuthSessionUser,
} from '../auth/authTypes';

describe('auth type helpers', () => {
  describe('parseInitialAuthMode', () => {
    it('returns reset_password for query auth=reset-password', () => {
      expect(parseInitialAuthMode('?auth=reset-password')).toBe('reset_password');
    });

    it('returns guest for empty query', () => {
      expect(parseInitialAuthMode('')).toBe('guest');
    });

    it('returns guest for query auth=confirmed', () => {
      expect(parseInitialAuthMode('?auth=confirmed')).toBe('guest');
    });

    it('returns guest for unknown auth values', () => {
      expect(parseInitialAuthMode('?auth=unknown')).toBe('guest');
    });
  });

  describe('getAuthRedirectConfig', () => {
    it('returns query-string redirect URLs based on origin', () => {
      const config = getAuthRedirectConfig('https://example.test');
      expect(config.confirmedUrl).toBe('https://example.test/?auth=confirmed');
      expect(config.resetPasswordUrl).toBe('https://example.test/?auth=reset-password');
    });
  });

  describe('parseAuthStatusMessage', () => {
    it('returns a confirmation message for auth=confirmed', () => {
      const message = parseAuthStatusMessage('?auth=confirmed');
      expect(message).toContain('Email confirmed');
    });

    it('returns a reset/recovery message for auth=reset-password', () => {
      const message = parseAuthStatusMessage('?auth=reset-password');
      expect(message).toContain('new password');
    });

    it('returns null for unrecognized auth values', () => {
      expect(parseAuthStatusMessage('?auth=guest')).toBeNull();
      expect(parseAuthStatusMessage('')).toBeNull();
    });
  });

  describe('toAuthSessionUser', () => {
    it('maps anonymous Supabase user to AuthSessionUser', () => {
      const result = toAuthSessionUser({ id: 'u1', email: null, is_anonymous: true });
      expect(result).toEqual({
        id: 'u1',
        email: null,
        isAnonymous: true,
      });
    });

    it('maps non-anonymous Supabase user with email to AuthSessionUser', () => {
      const result = toAuthSessionUser({ id: 'u2', email: 'p@example.test' });
      expect(result).toEqual({
        id: 'u2',
        email: 'p@example.test',
        isAnonymous: false,
      });
    });

    it('returns null for null user', () => {
      expect(toAuthSessionUser(null)).toBeNull();
    });

    it('returns null for non-object user', () => {
      expect(toAuthSessionUser('bad')).toBeNull();
      expect(toAuthSessionUser(undefined)).toBeNull();
    });

    it('returns null for object without id', () => {
      expect(toAuthSessionUser({ email: 'test@example.test' })).toBeNull();
    });
  });
});
