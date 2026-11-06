/**
 * WebGL capability probe for the Pixi stage pilot (2026-11-06).
 * The DOM stage stays as the automatic fallback (owner ruling
 * §6.3): when no WebGL context can be created, BossFightStage
 * renders the DOM choreography exactly as before. The result is
 * cached module-wide — one probe per session.
 */

let cached: boolean | null = null;

export function detectWebGL(): boolean {
  if (cached !== null) return cached;
  try {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      cached = false;
      return cached;
    }
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    cached = gl != null;
  } catch {
    cached = false;
  }
  return cached;
}

/** Test seam: forget the cached probe result. */
export function resetWebGLCacheForTests(): void {
  cached = null;
}
