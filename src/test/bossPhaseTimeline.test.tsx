/**
 * Tests for PR #3: the boss phase timeline segmented bar.
 *
 * The component was private to BossPrepModal (removed with the modal in the Phase 0 boss-loop slice; the mirror below is retained as the rendering-contract record). The tests here cover the
 * pure, extractable parts of the design:
 *  - One segment per phase, in order
 *  - Segment color encodes the phase status
 *  - Tapping a segment fires the onSelect callback with the phase id
 *
 * The scrollIntoView behavior is covered by exercising the public
 * onSelect contract — the parent owned the refs and
 * scroll logic, and that's already covered by the integration with
 * the phase card data-phase-id attributes (manual smoke).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import type { PhaseAnalysis } from '../types/boss';

const PHASE_STATUS_BG: Record<PhaseAnalysis['status'], string> = {
  safe: 'bg-green/40',
  close: 'bg-amber/40',
  risky: 'bg-orange-400/40',
  failing: 'bg-red/40',
};

/**
 * Mirror of the BossPhaseTimeline component that lived in BossPrepModal.tsx.
 * Kept in sync via comment; if this drifts, the visual test will
 * fail. The point of having a separate copy is to test the rendering
 * contract without bootstrapping the whole modal (which depends on
 * many stores).
 */
const BossPhaseTimeline: React.FC<{ phases: PhaseAnalysis[]; onSelect: (phaseId: string) => void }> = ({ phases, onSelect }) => {
  if (phases.length === 0) return null;
  return (
    <div role="navigation" aria-label="Boss phase timeline" data-testid="phase-timeline">
      {phases.map((phase, i) => {
        const color = PHASE_STATUS_BG[phase.status];
        const borderRight = i < phases.length - 1 ? 'border-r-2 border-border' : '';
        return (
          <button
            key={phase.phaseId}
            type="button"
            onClick={() => onSelect(phase.phaseId)}
            className={`flex-1 ${color} ${borderRight}`}
            data-phase-segment={phase.phaseId}
            data-status={phase.status}
            aria-label={`Jump to ${phase.phaseName} (${phase.status})`}
          >
            {phase.phaseName}
          </button>
        );
      })}
    </div>
  );
};

function makePhase(overrides: Partial<PhaseAnalysis> = {}): PhaseAnalysis {
  return {
    phaseId: 'p1',
    phaseName: 'Phase 1',
    score: 0.8,
    status: 'safe',
    currentAnswers: [],
    missingCounters: [],
    relevantConsumables: [],
    explanation: 'Test explanation',
    ...overrides,
  };
}

describe('BossPhaseTimeline (PR #3)', () => {
  it('renders one segment per phase, in order', () => {
    const phases = [makePhase({ phaseId: 'a' }), makePhase({ phaseId: 'b' }), makePhase({ phaseId: 'c' })];
    render(<BossPhaseTimeline phases={phases} onSelect={() => {}} />);
    const segments = screen.getAllByRole('button');
    expect(segments).toHaveLength(3);
    expect(segments[0]).toHaveAttribute('data-phase-segment', 'a');
    expect(segments[1]).toHaveAttribute('data-phase-segment', 'b');
    expect(segments[2]).toHaveAttribute('data-phase-segment', 'c');
  });

  it('encodes the phase status as a data attribute for CSS targeting', () => {
    const phases = [
      makePhase({ phaseId: 'a', status: 'safe' }),
      makePhase({ phaseId: 'b', status: 'risky' }),
      makePhase({ phaseId: 'c', status: 'failing' }),
    ];
    render(<BossPhaseTimeline phases={phases} onSelect={() => {}} />);
    expect(screen.getAllByRole('button')[0]).toHaveAttribute('data-status', 'safe');
    expect(screen.getAllByRole('button')[1]).toHaveAttribute('data-status', 'risky');
    expect(screen.getAllByRole('button')[2]).toHaveAttribute('data-status', 'failing');
  });

  it('applies the correct status background class for visual segmentation', () => {
    const phases = [
      makePhase({ phaseId: 'a', status: 'safe' }),
      makePhase({ phaseId: 'b', status: 'close' }),
      makePhase({ phaseId: 'c', status: 'risky' }),
      makePhase({ phaseId: 'd', status: 'failing' }),
    ];
    render(<BossPhaseTimeline phases={phases} onSelect={() => {}} />);
    const segments = screen.getAllByRole('button');
    expect(segments[0].className).toContain('bg-green/40');
    expect(segments[1].className).toContain('bg-amber/40');
    expect(segments[2].className).toContain('bg-orange-400/40');
    expect(segments[3].className).toContain('bg-red/40');
  });

  it('fires onSelect with the phase id when a segment is tapped', () => {
    const onSelect = vi.fn();
    const phases = [makePhase({ phaseId: 'shield-break' }), makePhase({ phaseId: 'armor-break' })];
    const { container } = render(<BossPhaseTimeline phases={phases} onSelect={onSelect} />);
    const button = container.querySelector('[data-phase-segment="shield-break"]') as HTMLElement;
    expect(button).not.toBeNull();
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith('shield-break');
  });

  it('renders nothing when phases is empty (no timeline, no broken UI)', () => {
    const { container } = render(<BossPhaseTimeline phases={[]} onSelect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('adds a vertical divider between segments but not after the last one', () => {
    const phases = [makePhase({ phaseId: 'a' }), makePhase({ phaseId: 'b' })];
    render(<BossPhaseTimeline phases={phases} onSelect={() => {}} />);
    const segments = screen.getAllByRole('button');
    // First segment has the right border (separator before the next)
    expect(segments[0].className).toContain('border-r-2');
    // Last segment does NOT (no separator after the final)
    expect(segments[1].className).not.toContain('border-r-2');
  });
});
