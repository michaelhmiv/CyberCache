import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PickerSheet } from '@/components/common/PickerSheet';

describe('PickerSheet', () => {
  it('renders title and body content', () => {
    render(
      <PickerSheet title="Pick an item" onClose={vi.fn()}>
        <div data-testid="sheet-body-content">List goes here</div>
      </PickerSheet>,
    );

    expect(screen.getByText('Pick an item')).toBeInTheDocument();
    expect(screen.getByTestId('sheet-body-content')).toBeInTheDocument();
  });

  it('renders subtitle and header slot', () => {
    render(
      <PickerSheet
        title="Pick an item"
        subtitle="Choose wisely"
        header={<div data-testid="sheet-header">Search + filters</div>}
        onClose={vi.fn()}
      >
        <div>List</div>
      </PickerSheet>,
    );

    expect(screen.getByText('Choose wisely')).toBeInTheDocument();
    expect(screen.getByTestId('sheet-header')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(
      <PickerSheet title="Pick an item" onClose={onClose}>
        <div>List</div>
      </PickerSheet>,
    );

    fireEvent.click(screen.getByLabelText('Close picker'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(
      <PickerSheet title="Pick an item" onClose={onClose}>
        <div>List</div>
      </PickerSheet>,
    );

    // Overlay is the outer fixed div, portaled to document.body (device
    // feedback r2, via the SheetPortal wrapper from flow-fix F17), so it
    // is found on document.body, not inside the render container.
    const overlay = screen.getByTestId('picker-sheet-overlay');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders at the document root, outside any transformed ancestor (F17)', () => {
    render(
      <div style={{ transform: 'translateX(24px)' }} data-testid="transformed-ancestor">
        <PickerSheet title="Pick an item" onClose={vi.fn()}>
          <div>List</div>
        </PickerSheet>
      </div>,
    );

    const overlay = screen.getByTestId('picker-sheet-overlay');
    // Portaled: the overlay's parent is document.body, never the
    // transformed container — so `position: fixed` always anchors to
    // the viewport regardless of ancestor transforms.
    expect(overlay.parentElement).toBe(document.body);
    expect(screen.getByTestId('transformed-ancestor').contains(overlay)).toBe(false);
  });

  it('does not call onClose when sheet content is clicked', () => {
    const onClose = vi.fn();
    render(
      <PickerSheet title="Pick an item" onClose={onClose}>
        <button type="button">Inside</button>
      </PickerSheet>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Inside' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
