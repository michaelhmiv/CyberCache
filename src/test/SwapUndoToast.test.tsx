import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SwapUndoToast } from '@/components/action/SwapUndoToast';

describe('SwapUndoToast', () => {
  it('renders item name and previous name', () => {
    render(
      <SwapUndoToast
        visible
        itemName="Nova Blaster"
        previousName="Rusty Pistol"
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
        durationMs={10000}
      />,
    );
    expect(screen.getByText('Nova Blaster')).toBeInTheDocument();
    expect(screen.getByText(/Was Rusty Pistol/)).toBeInTheDocument();
  });

  it('calls onUndo when Undo tapped', () => {
    const onUndo = vi.fn();
    render(
      <SwapUndoToast
        visible
        itemName="Nova Blaster"
        previousName="Rusty Pistol"
        onUndo={onUndo}
        onDismiss={vi.fn()}
        durationMs={10000}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /UNDO/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after duration', async () => {
    const onDismiss = vi.fn();
    render(
      <SwapUndoToast
        visible
        itemName="Nova Blaster"
        onUndo={vi.fn()}
        onDismiss={onDismiss}
        durationMs={100}
      />,
    );
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1), { timeout: 500 });
  });

  it('renders empty-slot copy when previousName is missing', () => {
    render(
      <SwapUndoToast
        visible
        itemName="Nova Blaster"
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
        durationMs={10000}
      />,
    );
    expect(screen.getByText('Slot was empty')).toBeInTheDocument();
  });
});
