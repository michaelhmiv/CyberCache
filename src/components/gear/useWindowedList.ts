import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * useWindowedList — scroll windowing for the Gear inventory list
 * (Gear list render fix, 2026-11-12).
 *
 * The problem (measured, latency audit 2026-11-11): GearHub mapped
 * the WHOLE filtered inventory into the DOM. At the owner's real
 * scale (2,366 items) that is 2,366 mounted rows — roughly 70k DOM
 * nodes in the list alone — each carrying a deferred-art observer
 * and a canvas, inside the Gear tab's single mount commit. The tab
 * entry long-task train scaled with inventory size, not with what
 * fits on a phone screen (~18 list rows).
 *
 * This hook keeps only the on-screen units (+ overscan) mounted:
 *
 *   - At or below GEAR_WINDOW_THRESHOLD items it is a no-op — the
 *     list renders exactly as it always has (every small-inventory
 *     test and the grid's child-count pins see the plain list).
 *   - Above the threshold it tracks the ScreenWrapper scroller (the
 *     nearest scrollable ancestor — GearHub owns no scroller of its
 *     own; the ScreenWrapper contract is untouched), measures the
 *     mounted units' real heights, and returns the item range to
 *     render plus spacer heights that keep the total scroll height
 *     (and therefore the scrollbar and scroll position) honest.
 *   - Environments without layout (jsdom) report zero rects; the
 *     hook then simply keeps its initial bounded window, which is
 *     what the scale tests pin.
 *
 * Units are ROWS: one item per unit in list mode, `cols` items per
 * unit in grid mode. Heights are measured per unit from the mounted
 * children (data-widx = item index) and cached across renders;
 * unmeasured units use the caller's estimate and self-correct as
 * they mount.
 */

export const GEAR_WINDOW_THRESHOLD = 72;
export const GEAR_WINDOW_INITIAL = 48;
const OVERSCAN_PX = 600;
const MAX_MOUNTED_ITEMS = 96;

interface WindowedListOptions {
  /** The list container's ref, owned by the caller (a ref created
   *  in the component and passed in — returning a ref from the hook
   *  taints every other returned value under the react-hooks refs
   *  lint rule). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Total (filtered) item count. */
  count: number;
  /** Items per row unit: 1 for the list, 2 for the grid. */
  cols: 1 | 2;
  /** Estimated unit height in px before measurement. */
  estimate: number;
  /** Vertical gap after each unit, px. */
  gap: number;
  /** Changing this resets measured heights and the window
   *  (view mode, kind, search, sort, filters — anything that
   *  reorders or replaces the item set wholesale). */
  resetKey: string;
}

export interface WindowedList {
  /** True when windowing is active (count above the threshold). */
  windowed: boolean;
  /** Item index range [start, end) to render. */
  start: number;
  end: number;
  /** Spacer heights (px) replacing the unmounted units. */
  topSpacer: number;
  bottomSpacer: number;
}

function findScroller(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

export function useWindowedList({ containerRef, count, cols, estimate, gap, resetKey }: WindowedListOptions): WindowedList {
  // Measured unit heights live in STATE, not a ref: the spacer math
  // reads them during render, and the lint rules (react-hooks refs)
  // bar ref reads there. recompute merges measurements into a fresh
  // map and sets it; the new identity repaints the spacers.
  const [heights, setHeights] = useState<ReadonlyMap<number, number>>(new Map());
  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: GEAR_WINDOW_INITIAL });

  const windowed = count > GEAR_WINDOW_THRESHOLD;
  const unitCount = Math.max(1, Math.ceil(count / cols));

  // Reset on a wholesale change of the item set (React's
  // render-phase adjustment pattern): measured heights are keyed by
  // index, so a reordered set must not inherit the old geometry.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setHeights(new Map());
    setRange({ start: 0, end: GEAR_WINDOW_INITIAL });
  }

  const pitchOf = (map: ReadonlyMap<number, number>, unit: number): number => (map.get(unit) ?? estimate) + gap;

  const recompute = (): void => {
    const container = containerRef.current;
    if (!container || !windowed) return;

    // Measure the mounted units (max tile height per unit).
    const measured = new Map<number, number>();
    container.querySelectorAll('[data-widx]').forEach((el) => {
      const idx = Number((el as HTMLElement).dataset.widx);
      if (!Number.isFinite(idx)) return;
      const h = (el as HTMLElement).getBoundingClientRect().height;
      if (h <= 0) return;
      const unit = Math.floor(idx / cols);
      measured.set(unit, Math.max(measured.get(unit) ?? 0, h));
    });
    const merged = new Map(heights);
    let heightsChanged = false;
    for (const [unit, h] of measured) {
      const prev = merged.get(unit);
      if (prev === undefined || Math.abs(prev - h) > 1) {
        // Keep the max: a tap-scale transform can shave ~1px off a
        // rect mid-press, and a shrinking spacer would jitter the
        // scroll position. Genuine shrinks arrive with a new item
        // set, which resets heights via resetKey.
        merged.set(unit, prev === undefined ? h : Math.max(prev, h));
        heightsChanged = true;
      }
    }

    const scroller = findScroller(container);
    const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
    const viewH = scroller ? scroller.clientHeight : window.innerHeight;
    const containerRect = container.getBoundingClientRect();
    if (containerRect.height === 0 && measured.size === 0) {
      // No layout (jsdom): keep the current bounded window.
      if (heightsChanged) setHeights(merged);
      return;
    }
    const depth = viewTop - containerRect.top;
    const visEnd = depth + viewH;

    let cumTop = 0;
    let startUnit = 0;
    let endUnit = unitCount - 1;
    let startFound = false;
    for (let u = 0; u < unitCount; u++) {
      const pitch = pitchOf(merged, u);
      if (!startFound && cumTop + pitch > depth - OVERSCAN_PX) {
        startUnit = u;
        startFound = true;
      }
      if (cumTop < visEnd + OVERSCAN_PX) endUnit = u;
      cumTop += pitch;
    }
    // Bound the mounted count even on very tall viewports.
    const start = startUnit * cols;
    let end = Math.min(count, (endUnit + 1) * cols);
    if (end - start > MAX_MOUNTED_ITEMS) end = start + MAX_MOUNTED_ITEMS;
    setRange((prev) => {
      const next = { start, end };
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
    // Spacers are derived from the range + measured heights at
    // render time (see the return below); setting the merged map
    // repaints them.
    if (heightsChanged) setHeights(merged);
  };

  // The scroll listener (attached in an effect with coarse deps)
  // always calls the latest recompute closure.
  const recomputeRef = useRef(recompute);
  useLayoutEffect(() => {
    recomputeRef.current = recompute;
  });

  // Recompute after every render (fresh measurements) and on
  // scroll / resize of the ScreenWrapper scroller.
  useLayoutEffect(() => {
    recompute();
  });
  useEffect(() => {
    if (!windowed) return;
    const container = containerRef.current;
    if (!container) return;
    const scroller = findScroller(container);
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        recomputeRef.current();
      });
    };
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [windowed, resetKey, count]);

  // Spacers from the current range + measured heights.
  let topSpacer = 0;
  let bottomSpacer = 0;
  if (windowed) {
    const startUnit = Math.floor(range.start / cols);
    const endUnit = Math.ceil(range.end / cols);
    for (let u = 0; u < startUnit; u++) topSpacer += pitchOf(heights, u);
    for (let u = endUnit; u < unitCount; u++) bottomSpacer += pitchOf(heights, u);
    // The gap after the last rendered unit belongs to the bottom
    // spacer's first unmounted unit boundary; trailing-gap drift of
    // one gap is inside the tolerance the measurement pass corrects.
    if (bottomSpacer > 0) bottomSpacer = Math.max(0, bottomSpacer - gap);
  }

  return {
    windowed,
    start: windowed ? Math.min(range.start, count) : 0,
    end: windowed ? Math.min(Math.max(range.end, Math.min(range.start + 1, count)), count) : count,
    topSpacer,
    bottomSpacer,
  };
}
