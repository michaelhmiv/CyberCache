/**
 * Resume Probe — device instrumentation for the resume-static defect
 * (Track A criterion 8, item 4; spec:
 * cybercache-prep/legendary-reauthor-anim-loop/track-a/DEVICE-PROBE-SPEC.md).
 *
 * The anim-replay loop refuted every clock-math hypothesis for the
 * owner's report — after backgrounding the app mid-roam and
 * returning, the Home stage can sit static while the game otherwise
 * runs. The suspected causes live BELOW the stage's clock math, in
 * the Capacitor/Android WebView lifecycle (process freeze, GPU
 * context loss, renderer resize on resume), which desktop Chromium
 * cannot reproduce. This module is the probe that instruments the
 * real path on the owner's Pixel so the fix slice targets the PROVEN
 * cause.
 *
 * Diagnostic ONLY: the probe never mutates gameplay, rendering, or
 * any store. It appends timestamped rows to one shared ring buffer
 * (last ~300 events) that the stages expose for dumping via
 * `window.__cybercacheResumeProbe` — the same DEV probe surface
 * pattern as `window.__cybercacheRoamPixiStage` in RoamPixiStage.tsx.
 *
 * Gating (spec: "a query flag or a debug build"): the probe is
 * ACTIVE only when one of these holds —
 *   1. a DEV build (`import.meta.env.DEV`),
 *   2. the query flag `?resumeProbe=1` is in the page URL,
 *   3. the on-device storage flag `cc:resumeProbe` = '1' in
 *      localStorage — the device equivalent of the query flag:
 *      a Capacitor app launched from its icon has no URL to hang a
 *      query string on, so the flag is set once from the WebView
 *      remote-debugging console and persists across launches.
 * With none of these set the probe's installers are never called by
 * the stages and this module costs one boolean check per mount.
 */

export const RESUME_PROBE_MAX_EVENTS = 300;
export const RESUME_PROBE_QUERY_FLAG = 'resumeProbe';
export const RESUME_PROBE_STORAGE_KEY = 'cc:resumeProbe';

export type ResumeProbeSource = 'pixi' | 'dom';

export type ResumeProbeEventKind =
  | 'probe-init'
  | 'visibilitychange'
  | 'pageshow'
  | 'pagehide'
  | 'appStateChange'
  | 'webglcontextlost'
  | 'webglcontextrestored'
  | 'pixi-heartbeat'
  | 'dom-heartbeat'
  | 'resize';

export interface ResumeProbeEvent {
  kind: ResumeProbeEventKind;
  /** performance.now() at log time (the spec's `{t, ...}` rows). */
  t: number;
  /** Which stage logged the row — Pixi and DOM rows share one
   *  buffer so their sequences interleave on one timeline. */
  source: ResumeProbeSource;
  data?: Record<string, unknown>;
}

export interface ResumeProbeBuffer {
  push: (event: ResumeProbeEvent) => void;
  /** A copy of the buffered rows, oldest first. Mutating the
   *  returned array never touches the buffer. */
  snapshot: () => ResumeProbeEvent[];
  clear: () => void;
  size: () => number;
}

/** A fixed-capacity ring buffer: once full, each push evicts the
 *  oldest row, so the buffer always holds the LAST `max` events. */
export function createResumeProbeBuffer(max = RESUME_PROBE_MAX_EVENTS): ResumeProbeBuffer {
  const events: ResumeProbeEvent[] = [];
  return {
    push: (event) => {
      events.push(event);
      if (events.length > max) events.splice(0, events.length - max);
    },
    snapshot: () => [...events],
    clear: () => {
      events.length = 0;
    },
    size: () => events.length,
  };
}

let sharedBuffer: ResumeProbeBuffer | null = null;

/** The one buffer both stages write to (a Pixi mount and the DOM
 *  fallback can coexist across a renderer swap; their rows must
 *  interleave on a single timeline to be comparable). */
export function getResumeProbeBuffer(): ResumeProbeBuffer {
  sharedBuffer ??= createResumeProbeBuffer();
  return sharedBuffer;
}

export function logResumeProbeEvent(
  kind: ResumeProbeEventKind,
  source: ResumeProbeSource,
  data?: Record<string, unknown>,
): void {
  getResumeProbeBuffer().push({ kind, t: performance.now(), source, ...(data ? { data } : {}) });
}

export interface ResumeProbeGateEnv {
  dev?: boolean;
  search?: string;
  storage?: Pick<Storage, 'getItem'> | null;
}

function defaultGateEnv(): ResumeProbeGateEnv {
  let search: string | undefined;
  let storage: Pick<Storage, 'getItem'> | null;
  try {
    search = typeof window !== 'undefined' ? window.location.search : undefined;
  } catch {
    search = undefined;
  }
  try {
    storage = typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    storage = null;
  }
  return {
    dev: (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true,
    search,
    storage,
  };
}

export function isResumeProbeEnabled(env: ResumeProbeGateEnv = defaultGateEnv()): boolean {
  if (env.dev) return true;
  if (env.search) {
    try {
      if (new URLSearchParams(env.search).get(RESUME_PROBE_QUERY_FLAG) === '1') return true;
    } catch {
      /* a malformed search string is not a flag */
    }
  }
  try {
    if (env.storage?.getItem(RESUME_PROBE_STORAGE_KEY) === '1') return true;
  } catch {
    /* storage can throw in hardened WebViews; absence is not a flag */
  }
  return false;
}

export interface ResumeProbeSurface {
  enabled: true;
  dump: () => ResumeProbeEvent[];
  clear: () => void;
  size: () => number;
}

/** Expose the dump surface the device procedure reads through
 *  WebView remote debugging: `window.__cybercacheResumeProbe.dump()`. */
export function exposeResumeProbeSurface(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __cybercacheResumeProbe?: ResumeProbeSurface };
  w.__cybercacheResumeProbe = {
    enabled: true,
    dump: () => getResumeProbeBuffer().snapshot(),
    clear: () => getResumeProbeBuffer().clear(),
    size: () => getResumeProbeBuffer().size(),
  };
}

/**
 * The DOM half of spec item 1 — visibility lifecycle rows, mirrored
 * by both stages:
 *   visibilitychange → {hidden}
 *   pageshow / pagehide → {persisted} (the bfcache discriminator)
 * Returns the cleanup that removes every listener it added.
 */
export function attachResumeProbeDomLifecycle(source: ResumeProbeSource): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const onVisibilityChange = () => {
    logResumeProbeEvent('visibilitychange', source, { hidden: document.hidden });
  };
  const onPageShow = (event: PageTransitionEvent) => {
    logResumeProbeEvent('pageshow', source, { persisted: event.persisted });
  };
  const onPageHide = (event: PageTransitionEvent) => {
    logResumeProbeEvent('pagehide', source, { persisted: event.persisted });
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onPageHide);
  };
}

/**
 * The heartbeat row math (spec items 3–4), pure so the device log's
 * semantics are unit-pinned: `deltaSinceLastTick` is the age of the
 * most recent tick/rAF at sample time — null until the first tick,
 * growing without bound while the driver is dead, which is exactly
 * the signal that separates ticker death from a hidden tab.
 */
export function buildHeartbeatData(sample: {
  count: number;
  lastAt: number | null;
  now: number;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    tickCount: sample.count,
    deltaSinceLastTick: sample.lastAt === null ? null : Math.round(sample.now - sample.lastAt),
    ...(sample.extra ?? {}),
  };
}
