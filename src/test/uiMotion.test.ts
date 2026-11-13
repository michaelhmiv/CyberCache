import { describe, expect, it } from 'vitest';
import {
  celebrationEntranceProps,
  sheetMotionProps,
} from '@/lib/animation/uiMotion';

/**
 * The shared UI-motion helpers (DESIGN.md §10 chrome motion).
 * These pin the vocabulary the Stage Iteration C1 pass unified:
 * every bottom sheet rides the shipped 320/28 spring family with
 * an Enter-tier backdrop fade, celebration cards ride 200/24,
 * and reduced motion collapses both to their settled frame.
 */
describe('sheetMotionProps — the shared bottom-sheet motion', () => {
  it('panel rides the shipped sheet spring family (320/28) from y:100%', () => {
    const { panel } = sheetMotionProps(false);
    expect(panel.initial).toEqual({ y: '100%' });
    expect(panel.animate).toEqual({ y: 0 });
    expect(panel.exit).toEqual({ y: '100%' });
    expect(panel.transition).toEqual({ type: 'spring', damping: 28, stiffness: 320 });
  });

  it('backdrop is the Enter tier: 0.18s easeOut fade, in and out', () => {
    const { backdrop } = sheetMotionProps(false);
    expect(backdrop.initial).toEqual({ opacity: 0 });
    expect(backdrop.animate).toEqual({ opacity: 1 });
    expect(backdrop.exit).toEqual({ opacity: 0 });
    expect(backdrop.transition.duration).toBe(0.18);
  });

  it('reduced motion collapses the panel to rest and degrades the exit to a fade', () => {
    const { backdrop, panel } = sheetMotionProps(true);
    expect(panel.initial).toBe(false);
    expect(panel.exit).toEqual({ opacity: 0 });
    expect(panel.transition.duration).toBe(0);
    expect(backdrop.transition.duration).toBe(0);
  });

  it('a null preference (framer has not resolved it) gets the full motion', () => {
    const { panel } = sheetMotionProps(null);
    expect(panel.transition).toEqual({ type: 'spring', damping: 28, stiffness: 320 });
  });
});

describe('celebrationEntranceProps — the loot-adjacent card tier', () => {
  it('rides spring 200/24 from y:16', () => {
    const props = celebrationEntranceProps(false);
    expect(props.initial).toEqual({ opacity: 0, y: 16 });
    expect(props.animate).toEqual({ opacity: 1, y: 0 });
    expect(props.transition).toEqual({ type: 'spring', damping: 24, stiffness: 200 });
  });

  it('reduced motion renders the card at rest', () => {
    const props = celebrationEntranceProps(true);
    expect(props.initial).toBe(false);
    expect(props.transition.duration).toBe(0);
  });
});
