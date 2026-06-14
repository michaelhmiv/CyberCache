import { describe, expect, it } from 'vitest';
import { validateUsername } from '../lib/validation/username';

describe('validateUsername', () => {
  it('accepts valid usernames', () => {
    expect(validateUsername('shrimps_23').ok).toBe(true);
    expect(validateUsername('a-b-c').ok).toBe(true);
    expect(validateUsername('CacheHunter').ok).toBe(true);
  });

  it('rejects empty and short usernames', () => {
    expect(validateUsername('').ok).toBe(false);
    expect(validateUsername('ab').ok).toBe(false);
    expect(validateUsername('   ').ok).toBe(false);
  });

  it('rejects long usernames', () => {
    expect(validateUsername('a'.repeat(25)).ok).toBe(false);
    expect(validateUsername('a'.repeat(24)).ok).toBe(true);
  });

  it('rejects invalid characters', () => {
    expect(validateUsername('has space').ok).toBe(false);
    expect(validateUsername('bad@name').ok).toBe(false);
    expect(validateUsername('emoji✨').ok).toBe(false);
  });

  it('rejects reserved names', () => {
    expect(validateUsername('Admin').ok).toBe(false);
    expect(validateUsername('cybercache').ok).toBe(false);
    expect(validateUsername('GUEST').ok).toBe(false);
  });
});
