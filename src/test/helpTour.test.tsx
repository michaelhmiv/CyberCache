import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpScreen } from '@/screens/HelpScreen';

describe('HelpScreen guided tour', () => {
  it('renders the Guided Tour card on initial load', () => {
    render(<HelpScreen />);
    expect(screen.getByText('Guided Tour')).toBeTruthy();
    expect(screen.getByText(/Step 1 of 7/)).toBeTruthy();
  });

  it('shows the first step by default', () => {
    render(<HelpScreen />);
    expect(screen.getByText('1. Pick a turf')).toBeTruthy();
    expect(screen.getByText('Go to Board')).toBeTruthy();
  });

  it('advances to the next step when Next is clicked', () => {
    render(<HelpScreen />);
    fireEvent.click(screen.getByText('Next →'));
    expect(screen.getByText(/Step 2 of 7/)).toBeTruthy();
    expect(screen.getByText('2. Start a roam')).toBeTruthy();
  });

  it('calls onTourJump with the target tab when the CTA is pressed', () => {
    const jumps: string[] = [];
    render(<HelpScreen onTourJump={(tab) => jumps.push(tab)} />);
    fireEvent.click(screen.getByText('Go to Board'));
    expect(jumps).toEqual(['dashboard']);
  });

  it('advances the tour cursor after a CTA press (so re-entry shows progress)', () => {
    render(<HelpScreen onTourJump={() => {}} />);
    fireEvent.click(screen.getByText('Go to Board'));
    expect(screen.getByText(/Step 2 of 7/)).toBeTruthy();
  });

  it('back button is disabled at step 1', () => {
    render(<HelpScreen />);
    const back = screen.getByText('← Back') as HTMLButtonElement;
    expect(back.disabled).toBe(true);
  });

  it('next button is disabled at the last step', () => {
    render(<HelpScreen />);
    // Click Next six times to reach step 7
    const next = screen.getByText('Next →');
    for (let i = 0; i < 6; i++) fireEvent.click(next);
    expect((screen.getByText('Next →') as HTMLButtonElement).disabled).toBe(true);
  });

  it('restart button resets to step 1', () => {
    render(<HelpScreen />);
    fireEvent.click(screen.getByText('Next →'));
    fireEvent.click(screen.getByText('Next →'));
    fireEvent.click(screen.getByText('Restart'));
    expect(screen.getByText(/Step 1 of 7/)).toBeTruthy();
  });
});
