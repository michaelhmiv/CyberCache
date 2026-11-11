import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESUME_PROBE_MAX_EVENTS,
  RESUME_PROBE_STORAGE_KEY,
  attachResumeProbeDomLifecycle,
  buildHeartbeatData,
  createResumeProbeBuffer,
  getResumeProbeBuffer,
  isResumeProbeEnabled,
  logResumeProbeEvent,
  type ResumeProbeEvent,
} from '@/lib/pixel/resumeProbe';

const row = (n: number): ResumeProbeEvent => ({ kind: 'resize', t: n, source: 'pixi', data: { n } });

describe('resume probe ring buffer', () => {
  it('keeps the last ~300 events, oldest evicted first', () => {
    const buffer = createResumeProbeBuffer();
    for (let i = 0; i < RESUME_PROBE_MAX_EVENTS + 25; i += 1) buffer.push(row(i));
    expect(buffer.size()).toBe(RESUME_PROBE_MAX_EVENTS);
    const snap = buffer.snapshot();
    expect(snap[0].data).toEqual({ n: 25 });
    expect(snap[snap.length - 1].data).toEqual({ n: RESUME_PROBE_MAX_EVENTS + 24 });
  });

  it('snapshot is a copy — mutating it never touches the buffer', () => {
    const buffer = createResumeProbeBuffer();
    buffer.push(row(1));
    const snap = buffer.snapshot();
    snap.length = 0;
    expect(buffer.size()).toBe(1);
    expect(buffer.snapshot()[0].data).toEqual({ n: 1 });
  });

  it('clear empties the buffer', () => {
    const buffer = createResumeProbeBuffer();
    buffer.push(row(1));
    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.snapshot()).toEqual([]);
  });

  it('both stages share one singleton buffer', () => {
    getResumeProbeBuffer().clear();
    logResumeProbeEvent('visibilitychange', 'pixi', { hidden: true });
    logResumeProbeEvent('visibilitychange', 'dom', { hidden: true });
    const snap = getResumeProbeBuffer().snapshot();
    expect(snap.map((e) => e.source)).toEqual(['pixi', 'dom']);
    expect(snap.every((e) => typeof e.t === 'number')).toBe(true);
    getResumeProbeBuffer().clear();
  });
});

describe('resume probe gate', () => {
  it('is off by default (no dev, no flag)', () => {
    expect(isResumeProbeEnabled({ dev: false, search: '', storage: null })).toBe(false);
    expect(isResumeProbeEnabled({ dev: false, search: '?other=1', storage: null })).toBe(false);
  });

  it('turns on for a DEV build', () => {
    expect(isResumeProbeEnabled({ dev: true, search: '', storage: null })).toBe(true);
  });

  it('turns on for the ?resumeProbe=1 query flag only at value 1', () => {
    expect(isResumeProbeEnabled({ dev: false, search: '?resumeProbe=1', storage: null })).toBe(true);
    expect(isResumeProbeEnabled({ dev: false, search: '?resumeProbe=0', storage: null })).toBe(false);
    expect(isResumeProbeEnabled({ dev: false, search: '?x=2&resumeProbe=1', storage: null })).toBe(true);
  });

  it('turns on for the on-device storage flag', () => {
    const storage = { getItem: (k: string) => (k === RESUME_PROBE_STORAGE_KEY ? '1' : null) };
    expect(isResumeProbeEnabled({ dev: false, search: '', storage })).toBe(true);
    const off = { getItem: () => null };
    expect(isResumeProbeEnabled({ dev: false, search: '', storage: off })).toBe(false);
  });

  it('survives a throwing storage (hardened WebView)', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    expect(isResumeProbeEnabled({ dev: false, search: '', storage })).toBe(false);
  });
});

describe('resume probe heartbeat math', () => {
  it('reports the age of the last tick and passes extras through', () => {
    expect(
      buildHeartbeatData({ count: 42, lastAt: 900, now: 1400, extra: { tickerStarted: true, hidden: false } }),
    ).toEqual({ tickCount: 42, deltaSinceLastTick: 500, tickerStarted: true, hidden: false });
  });

  it('reports a null delta before the first tick', () => {
    expect(buildHeartbeatData({ count: 0, lastAt: null, now: 1400 })).toEqual({
      tickCount: 0,
      deltaSinceLastTick: null,
    });
  });
});

describe('resume probe DOM lifecycle', () => {
  afterEach(() => {
    getResumeProbeBuffer().clear();
    vi.restoreAllMocks();
  });

  it('logs visibilitychange / pageshow / pagehide rows with the spec fields', () => {
    const detach = attachResumeProbeDomLifecycle('dom');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const snap = getResumeProbeBuffer().snapshot();
    expect(snap.map((e) => e.kind)).toEqual(['visibilitychange', 'pageshow', 'pagehide']);
    expect(snap[0].data).toEqual({ hidden: document.hidden });
    expect(snap[1].data).toEqual({ persisted: true });
    expect(snap[2].data).toEqual({ persisted: false });
    expect(snap.every((e) => e.source === 'dom')).toBe(true);
    detach();
  });

  it('cleanup removes every listener it added', () => {
    const detach = attachResumeProbeDomLifecycle('pixi');
    detach();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(getResumeProbeBuffer().size()).toBe(0);
  });
});
