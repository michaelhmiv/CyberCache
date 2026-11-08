/**
 * Motion M2a — the stride cycle executes on the DOM parts actor.
 *
 * The proof contract: with a stride spec bound and active, the
 * actor samples the spec on its rAF clock (the work cycle's
 * execution pattern) and the LEG parts actually move — their
 * layout positions leave the standing layout — while amplitude is
 * the only thing being driven. Reduced motion or an inactive spec
 * leaves the figure at the held base pose, byte-for-byte the
 * pre-M2a actor. The raster frames in the slice evidence are
 * composed from the same sampled poses this actor renders.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { PixelPartsActor } from '@/components/pixelArt/PixelPartsActor';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import { STRIDE_SPECS } from '@/lib/pixel/strideCycle';

const pump = async (ms: number) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

const legPositions = (root: HTMLElement) => {
  const out: Record<string, string> = {};
  for (const slot of ['thighF', 'lowerLegF', 'thighB', 'lowerLegB']) {
    const el = root.querySelector(`[data-part="${slot}"]`) as HTMLElement | null;
    out[slot] = el ? `${el.style.left}|${el.style.top}` : 'missing';
  }
  return out;
};

const mount = (props: Partial<React.ComponentProps<typeof PixelPartsActor>>) =>
  render(
    <div style={{ width: 420, height: 286, position: 'relative' }}>
      <PixelPartsActor
        set={STANDARD_ISSUE}
        xPct={22}
        heightPct={57}
        groundY={0.86}
        pose="roam"
        testId="stride-hunter"
        {...props}
      />
    </div>,
  );

describe('PixelPartsActor — stride execution (M2a)', () => {
  it('an active stride spec drives the legs off the standing layout', async () => {
    const control = mount({});
    const controlLegs = legPositions(control.container);
    control.unmount();

    const view = mount({ strideCycle: { spec: STRIDE_SPECS.stride, active: true } });
    const root = view.getByTestId('stride-hunter');
    expect(root.getAttribute('data-stride-cycle')).toBe('stride');
    // Past the SEGMENT start beat + the amplitude ramp: the cycle
    // is at full engagement and some leg is visibly displaced.
    await pump(1200);
    expect(root.getAttribute('data-stride-active')).toBe('true');
    const legs = legPositions(view.container);
    const moved = Object.keys(legs).filter((slot) => legs[slot] !== controlLegs[slot]);
    expect(moved.length).toBeGreaterThanOrEqual(2);
  });

  it('an inactive stride never drives', async () => {
    const control = mount({});
    const controlLegs = legPositions(control.container);
    control.unmount();

    const view = mount({ strideCycle: { spec: STRIDE_SPECS.stride, active: false } });
    await pump(700);
    expect(view.getByTestId('stride-hunter').getAttribute('data-stride-active')).toBeNull();
    expect(legPositions(view.container)).toEqual(controlLegs);
  });

  it('reduced motion never strides — the held pose is the whole picture', async () => {
    const control = mount({});
    const controlLegs = legPositions(control.container);
    control.unmount();

    const view = mount({ reduced: true, strideCycle: { spec: STRIDE_SPECS.stride, active: true } });
    await pump(700);
    expect(view.getByTestId('stride-hunter').getAttribute('data-stride-active')).toBeNull();
    expect(legPositions(view.container)).toEqual(controlLegs);
  });
});
