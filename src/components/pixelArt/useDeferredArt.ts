import { useEffect, useRef, useState } from 'react';

/**
 * Viewport-deferred art activation (Gear cold-load fix, 2026-11-05).
 *
 * The Gear tab mounts its whole inventory in one scroll. Composing
 * every item's pixel art synchronously inside that commit priced a
 * cold mount at ~180 composes + ~180 canvas paints before the first
 * row could paint (profiled: ~0.5s of compose alone at 4x CPU
 * throttle on a 180-item fixture, inside a single ~1.5s long task).
 *
 * Deferred art splits the two halves of a row: the row's GEOMETRY
 * renders immediately (the art element mounts at its final size —
 * the compositor grids are fixed per density, so the placeholder
 * canvas is pixel-for-pixel the same box the painted canvas will
 * occupy; zero layout shift), while the compose + paint wait until
 * the element is in or near the viewport.
 *
 * Activation is throttled through a shared rAF queue with a small
 * per-frame time budget, so a scroll fling that sweeps fifty rows
 * into the margin activates them a few per frame instead of one
 * long task. A row that unmounts before its turn cancels its job.
 * Once active, a row stays active — activation is a latch, never a
 * toggle, so scrolling back never blanks art.
 *
 * Environments without IntersectionObserver (jsdom) activate
 * immediately: deferral is a scheduling refinement, never a gate on
 * the art existing.
 */

const FRAME_BUDGET_MS = 8;
const ROOT_MARGIN = '600px 0px 600px 0px';

interface ArtJob {
  run: () => void;
  dead: boolean;
}

const queue: ArtJob[] = [];
let pumpScheduled = false;

function schedulePump(): void {
  if (pumpScheduled) return;
  pumpScheduled = true;
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(pump);
  } else {
    setTimeout(pump, 16);
  }
}

function pump(): void {
  pumpScheduled = false;
  const frameStart = performance.now();
  while (queue.length > 0) {
    const job = queue.shift()!;
    if (!job.dead) job.run();
    if (performance.now() - frameStart >= FRAME_BUDGET_MS) break;
  }
  if (queue.length > 0) schedulePump();
}

/** Queue an activation; returns a cancel function (unmount). */
export function requestArtActivation(run: () => void): () => void {
  const job: ArtJob = { run, dead: false };
  queue.push(job);
  schedulePump();
  return () => {
    job.dead = true;
  };
}

/**
 * Latch hook: `active` starts true when `defer` is false. When
 * deferred, it flips true once the referenced element comes within
 * ROOT_MARGIN of the viewport (via the shared activation queue).
 */
export function useDeferredArt<T extends HTMLElement>(defer: boolean): {
  ref: React.RefObject<T | null>;
  active: boolean;
} {
  const ref = useRef<T | null>(null);
  const [active, setActive] = useState(!defer);

  useEffect(() => {
    if (!defer || active) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setActive(true);
      return;
    }
    let cancel: (() => void) | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          io.disconnect();
          cancel = requestArtActivation(() => setActive(true));
        }
      },
      { rootMargin: ROOT_MARGIN },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancel?.();
    };
  }, [defer, active]);

  return { ref, active };
}
