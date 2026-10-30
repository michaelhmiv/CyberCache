const NETWORK_ERROR_TEXTS = ['failed to fetch', 'networkerror', 'load failed', 'network request failed'];

/**
 * Player-facing error text. Raw engine strings must never reach the
 * auth screen (audit A1: a failed sign-in showed the literal
 * "Failed to fetch"). Network failures get a human explanation;
 * server-provided messages pass through untouched.
 */
export function toMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : null;
  if (raw) {
    const lower = raw.toLowerCase();
    if (NETWORK_ERROR_TEXTS.some((t) => lower.includes(t))) {
      return "Couldn't reach the server. Check your connection and try again.";
    }
    return raw;
  }
  return 'Something went wrong.';
}
