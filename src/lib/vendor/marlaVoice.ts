/**
 * Marla Quill's counter lines (slice (f1) — naming pass).
 *
 * The vendor is a person: Marla Quill. Her voice is a FIXED pool of
 * Ledger-register counter lines (deadpan money/paper wit, the same
 * register as the legendary flavor lines in lootMoment). Presentation
 * only: nothing here touches prices, fees, stock, or notices — those
 * stay byte-plain on her surface (humor dosage law, brief §3 floor 11:
 * numbers, prices, and fees are never funny).
 *
 * Rotation: within a session, lines draw without repeat until the
 * pool is exhausted; the pool then resets, never immediately
 * repeating the last line shown. Session state is module-level, so
 * it survives Vendor stop mounts/unmounts inside one app session.
 */
export const MARLA_QUILL_NAME = 'Marla Quill';

export const MARLA_COUNTER_LINES: readonly string[] = [
  'Priced to move. Marla does not say from where.',
  "Credit's good here. Hers, not yours.",
  'Everything on the counter is priced. Everything behind it is not for sale.',
  'She keeps two ledgers. You are in the honest one.',
  'Returns are heard on Thursdays. There are no Thursdays.',
  'Buy it broke, sell it fixed. Marla handles the middle.',
];

const shownThisSession = new Set<number>();
let lastShownIndex = -1;

/** Next counter line for this session (no repeat until exhausted). */
export function nextMarlaCounterLine(): string {
  if (shownThisSession.size >= MARLA_COUNTER_LINES.length) {
    shownThisSession.clear();
  }
  const remaining = MARLA_COUNTER_LINES.map((_, i) => i).filter(
    (i) => !shownThisSession.has(i) && !(shownThisSession.size === 0 && MARLA_COUNTER_LINES.length > 1 && i === lastShownIndex),
  );
  const pick = remaining[Math.floor(Math.random() * remaining.length)];
  shownThisSession.add(pick);
  lastShownIndex = pick;
  return MARLA_COUNTER_LINES[pick];
}

/** Test hook: forget this session's rotation state. */
export function resetMarlaCounterRotation(): void {
  shownThisSession.clear();
  lastShownIndex = -1;
}
