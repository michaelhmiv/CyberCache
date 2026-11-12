/**
 * WebGL context-loss recovery (audit X-01 / A-07, 2026-11-12).
 *
 * A lost WebGL context that nobody preventDefault()s is terminal
 * for the canvas: the browser will not offer a restore, Pixi stops
 * drawing, and the stage freezes on its last frame forever — the
 * player stares at a still picture with a live game behind it.
 * Before this helper, production's only `webglcontextlost` handler
 * lived inside the resume probe, which is gated off in normal play;
 * a real context loss (GPU reset, driver hiccup, too many live
 * contexts after tab churn) froze the roam and boss stages with no
 * way out short of leaving the tab.
 *
 * The recovery is deliberately the boring one: on loss we
 * preventDefault() (mirroring the probe handler — it keeps the
 * browser's restore offer alive) and immediately route the stage
 * to its existing DOM fallback via the caller's `onContextLost`
 * (both Pixi stages already treat `setFailed(true)` exactly like
 * an init failure). We do NOT attempt an in-place GL rebuild: a
 * lost context invalidates every GPU resource Pixi holds, and a
 * half-rebuilt stage is a worse failure than the DOM stage, which
 * renders the same fight at full fidelity.
 *
 * Install is unconditional — this is production behavior, not
 * probe instrumentation. Returns the teardown.
 */

export interface WebglContextRecoveryHandlers {
  /** Called once per loss, after the event is preventDefault()ed. */
  onContextLost: () => void;
  /** Optional: called if the browser later restores the context. */
  onContextRestored?: () => void;
}

export function installWebglContextRecovery(
  canvas: HTMLCanvasElement,
  handlers: WebglContextRecoveryHandlers,
): () => void {
  const onLost = (event: Event) => {
    // Ask the browser to keep the restore path available (the same
    // contract the resume probe's handler uses), then hand over to
    // the stage's fallback routing.
    event.preventDefault();
    handlers.onContextLost();
  };
  const onRestored = () => {
    handlers.onContextRestored?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
}
