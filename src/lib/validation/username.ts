export interface UsernameValidationResult {
  ok: boolean;
  error?: string;
}

const RESERVED = new Set([
  'admin',
  'administrator',
  'mod',
  'moderator',
  'system',
  'support',
  'help',
  'null',
  'guest',
  'anonymous',
  'cybercache',
  'nousresearch',
]);

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

export function validateUsername(username: string): UsernameValidationResult {
  const cleaned = username.trim();

  if (!cleaned) {
    return { ok: false, error: 'Username is required.' };
  }

  if (cleaned.length < 3) {
    return { ok: false, error: 'Username must be at least 3 characters.' };
  }

  if (cleaned.length > 24) {
    return { ok: false, error: 'Username must be 24 characters or fewer.' };
  }

  if (!USERNAME_RE.test(cleaned)) {
    return { ok: false, error: 'Username can only use letters, numbers, underscores, and hyphens.' };
  }

  if (RESERVED.has(cleaned.toLowerCase())) {
    return { ok: false, error: 'That username is reserved.' };
  }

  return { ok: true };
}
