/**
 * R2 bars-render seam (presentation only, dash/bars-render —
 * never merged). Every R2 treatment sits behind `?bars=1`:
 * absent the param, the screen is the shipped picture byte for
 * byte. `?panel=endless|extract` opens the view panels on first
 * render (the harness cannot click the mode rail's doors).
 */
export function barsEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('bars') === '1';
  } catch {
    return false;
  }
}

export function barsPanel(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('panel');
  } catch {
    return null;
  }
}
