import { describe, expect, it } from 'vitest';
import { beamScheduleEnvelope } from '@/components/pixelArt/PixelFx';

describe('beamScheduleEnvelope', () => {
  it('is full strength at and before the start of the fade tail', () => {
    expect(beamScheduleEnvelope(0, 3150, 300)).toBe(1);
    expect(beamScheduleEnvelope(2850, 3150, 300)).toBe(1);
  });

  it('eases through the fade tail (smoothstep midpoint is 0.5)', () => {
    const mid = beamScheduleEnvelope(3000, 3150, 300);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeCloseTo(0.5, 5);
  });

  it('is zero at and after the schedule end', () => {
    expect(beamScheduleEnvelope(3150, 3150, 300)).toBe(0);
    expect(beamScheduleEnvelope(4000, 3150, 300)).toBe(0);
  });

  it('with no tail, is 1 before the end and 0 from it on', () => {
    expect(beamScheduleEnvelope(100, 3150, 0)).toBe(1);
    expect(beamScheduleEnvelope(4000, 3150, 0)).toBe(0);
  });
});
