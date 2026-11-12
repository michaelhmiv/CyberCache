import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { installWebglContextRecovery } from '@/lib/pixel/webglContextRecovery';

/**
 * X-01 / A-07 (audit 2026-11-11): a lost WebGL context froze the
 * Pixi stages permanently — production's only contextlost handler
 * lived inside the gated-off resume probe. These tests pin the
 * recovery helper's contract (preventDefault + callback, teardown)
 * and the unconditional wiring in both stages.
 */

class FakeCanvas extends EventTarget {
  dispatchLost(): Event {
    const event = new Event('webglcontextlost', { cancelable: true });
    this.dispatchEvent(event);
    return event;
  }
  dispatchRestored(): void {
    this.dispatchEvent(new Event('webglcontextrestored'));
  }
}

const asCanvas = (c: FakeCanvas) => c as unknown as HTMLCanvasElement;

describe('installWebglContextRecovery', () => {
  it('preventDefaults the loss and fires onContextLost exactly once per event', () => {
    const canvas = new FakeCanvas();
    const onContextLost = vi.fn();
    installWebglContextRecovery(asCanvas(canvas), { onContextLost });
    const event = canvas.dispatchLost();
    expect(event.defaultPrevented).toBe(true);
    expect(onContextLost).toHaveBeenCalledTimes(1);
    canvas.dispatchLost();
    expect(onContextLost).toHaveBeenCalledTimes(2);
  });

  it('fires onContextRestored when provided, and tolerates its absence', () => {
    const withHandler = new FakeCanvas();
    const onContextRestored = vi.fn();
    installWebglContextRecovery(asCanvas(withHandler), { onContextLost: () => {}, onContextRestored });
    withHandler.dispatchRestored();
    expect(onContextRestored).toHaveBeenCalledTimes(1);

    const bare = new FakeCanvas();
    installWebglContextRecovery(asCanvas(bare), { onContextLost: () => {} });
    expect(() => bare.dispatchRestored()).not.toThrow();
  });

  it('teardown detaches both listeners', () => {
    const canvas = new FakeCanvas();
    const onContextLost = vi.fn();
    const onContextRestored = vi.fn();
    const teardown = installWebglContextRecovery(asCanvas(canvas), { onContextLost, onContextRestored });
    teardown();
    const event = canvas.dispatchLost();
    canvas.dispatchRestored();
    expect(event.defaultPrevented).toBe(false);
    expect(onContextLost).not.toHaveBeenCalled();
    expect(onContextRestored).not.toHaveBeenCalled();
  });
});

const readSource = (rel: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', rel), 'utf8');

describe('stage wiring — source pins', () => {
  it('RoamPixiStage installs recovery on its canvas, outside the probe installer', () => {
    const src = readSource('src/components/pixelArt/pixi/RoamPixiStage.tsx');
    expect(src).toContain("installWebglContextRecovery(app.canvas, {");
    expect(src).toContain('contextRecoveryCleanup?.()');
    // The install must not live inside the probe-gated installer:
    // the probe function body ends before the component's own code,
    // and the recovery import is unconditional module scope.
    const probeBody = src.slice(src.indexOf('function installRoamResumeProbe'), src.indexOf('export const RoamPixiStage'));
    expect(probeBody).not.toContain('installWebglContextRecovery');
    // The probe's own handler is untouched.
    expect(src).toContain("logResumeProbeEvent('webglcontextlost', 'pixi', sizeSnapshot())");
  });

  it('BossPixiStage installs recovery on its canvas and tears it down', () => {
    const src = readSource('src/components/pixelArt/pixi/BossPixiStage.tsx');
    expect(src).toContain("installWebglContextRecovery(app.canvas, {");
    expect(src).toContain('contextRecoveryCleanup?.()');
    expect(src).toContain('if (!cancelled) setFailed(true);');
  });

  it('neither stage conditions recovery on the resume probe flag', () => {
    for (const rel of ['src/components/pixelArt/pixi/RoamPixiStage.tsx', 'src/components/pixelArt/pixi/BossPixiStage.tsx']) {
      const src = readSource(rel);
      const installAt = src.indexOf('installWebglContextRecovery(app.canvas');
      const context = src.slice(Math.max(0, installAt - 400), installAt);
      expect(context).not.toContain('probeEnabled');
    }
  });
});
