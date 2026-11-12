/**
 * A-10 (partial — the boot-fallback copy branch only) — on web,
 * offline presented as "App did not boot": index.html's 3-second
 * boot watchdog renders a JS-error diagnosis when the bundle can't
 * load, which is exactly what happens with no connection.
 *
 * The audit's CI assertion (its no-service-worker alternative):
 * "assert index.html's boot fallback contains a connectivity
 * branch — navigator.onLine === false → 'You're offline' copy."
 * The watchdog is an inline classic script in index.html (it must
 * run before/without the bundle), so the branch is pinned at the
 * source level, scoped to the watchdog block itself.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const watchdogStart = html.indexOf('__cybercacheBootTimeout');
const watchdog = watchdogStart >= 0 ? html.slice(watchdogStart) : '';

describe('the boot fallback knows offline from broken (audit A-10, copy branch)', () => {
  it('the watchdog block exists', () => {
    expect(watchdogStart).toBeGreaterThan(-1);
    expect(watchdog).toContain('App did not boot');
  });

  it('the watchdog branches on navigator.onLine === false', () => {
    expect(watchdog).toContain('navigator.onLine === false');
  });

  it('the offline branch renders the offline copy, before the boot-failure render', () => {
    const branchAt = watchdog.indexOf('navigator.onLine === false');
    // The copy sits inside a single-quoted JS string in the inline
    // script, so the source carries it backslash-escaped.
    const offlineCopyAt = watchdog.indexOf("You\\'re offline");
    const bootFailureAt = watchdog.indexOf('App did not boot');
    expect(offlineCopyAt).toBeGreaterThan(branchAt);
    expect(offlineCopyAt).toBeLessThan(bootFailureAt);
    expect(watchdog).toContain('no connection');
  });
});
