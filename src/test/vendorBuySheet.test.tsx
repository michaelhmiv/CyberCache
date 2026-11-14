/**
 * Vendor buy-quantity picker (owner-approved rendering, 2026-11-13:
 * "Build the picker exactly as shown").
 *
 * The vendor's stock is infinite (src/lib/vendor/catalog.ts) and
 * cc_vendor_buy clamps quantity only at >= 1 with no upper cap, so
 * the pickable range is set purely by the wallet:
 * MAX = floor(credits / unitPrice). These tests pin the math from
 * the approved captures (MAX 218 at 800cr/175,000cr; MAX 7 at
 * 40cr/290cr; chip 1,000 at 150cr), the chip ladder's
 * disabled-never-hidden rule, the slider geometry (QC flags from
 * the rendering review), reset-to-1 per open, clamp-on-balance-drop,
 * and the quantity handed to onBuy on confirm.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorBuySheet, type VendorBuySheetTarget } from '@/components/vendor/VendorBuySheet';
import type { VendorOffer } from '@/lib/vendor/catalog';
import { usePlayerStore } from '@/store';

const offer = (unitPrice: number, itemKey = 'InsuranceToken', kind: VendorOffer['kind'] = 'consumable'): VendorOffer => ({
  itemKey,
  kind,
  basePrice: unitPrice,
  unitPrice,
  itemOfTheDay: false,
  staple: true,
});

const target = (unitPrice: number, name = 'Insurance Token'): VendorBuySheetTarget => ({
  offer: offer(unitPrice),
  name,
  kindLabel: 'Economy',
  hasSprite: false,
});

const renderSheet = (t: VendorBuySheetTarget | null, onBuy = vi.fn()) => {
  const utils = render(<VendorBuySheet target={t} busy={false} onClose={vi.fn()} onBuy={onBuy} />);
  return { ...utils, onBuy };
};

describe('VendorBuySheet — quantity picker', () => {
  beforeEach(() => {
    usePlayerStore.setState({ credits: 175000, consumables: {}, materials: {}, essences: {} });
  });
  afterEach(() => cleanup());

  it('renders nothing without a target', () => {
    renderSheet(null);
    expect(screen.queryByTestId('vendor-qty-value')).not.toBeInTheDocument();
  });

  it('opens at quantity 1 with exact totals (approved state a: 40cr staple)', () => {
    usePlayerStore.setState({ credits: 175000 });
    renderSheet(target(40, 'Generic Fuel Cell'));
    expect(screen.getByTestId('vendor-qty-value')).toHaveTextContent('1');
    expect(screen.getByTestId('vendor-qty-total')).toHaveTextContent('40cr');
    expect(screen.getByTestId('vendor-qty-after')).toHaveTextContent('174,960cr');
    expect(screen.getByTestId('vendor-qty-confirm')).toHaveTextContent('Buy 1 • 40cr');
    // Slider range is 1..MAX where MAX = floor(175000 / 40) = 4,375.
    const slider = screen.getByTestId('vendor-qty-slider') as HTMLInputElement;
    expect(slider.max).toBe('4375');
  });

  it('chip 1,000 selects 1,000 with exact totals (approved state b: 150cr, MAX 1,166)', () => {
    renderSheet(target(150, 'Ammo Pack'));
    fireEvent.click(screen.getByTestId('vendor-qty-chip-1000'));
    expect(screen.getByTestId('vendor-qty-value')).toHaveTextContent('1,000');
    expect(screen.getByTestId('vendor-qty-total')).toHaveTextContent('150,000cr');
    expect(screen.getByTestId('vendor-qty-after')).toHaveTextContent('25,000cr');
    const slider = screen.getByTestId('vendor-qty-slider') as HTMLInputElement;
    expect(slider.max).toBe('1166');
    expect(slider.value).toBe('1000');
    expect(screen.getByTestId('vendor-qty-confirm')).toHaveTextContent('Buy 1,000 • 150,000cr');
  });

  it('MAX = floor(credits / price) = 218 at 800cr with 175,000cr (approved state c)', () => {
    renderSheet(target(800));
    // The 1,000 chip is beyond MAX: disabled, never hidden.
    expect(screen.getByTestId('vendor-qty-chip-1000')).toBeDisabled();
    expect(screen.getByTestId('vendor-qty-chip-100')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('vendor-qty-chip-max'));
    expect(screen.getByTestId('vendor-qty-value')).toHaveTextContent('218');
    expect(screen.getByTestId('vendor-qty-total')).toHaveTextContent('174,400cr');
    expect(screen.getByTestId('vendor-qty-after')).toHaveTextContent('600cr');
    const slider = screen.getByTestId('vendor-qty-slider') as HTMLInputElement;
    expect(slider.max).toBe('218');
    expect(slider.value).toBe('218');
  });

  it('tiny purse: MAX = 7 at 40cr with 290cr; chips above MAX disabled, chip 1 stays enabled (approved state d)', () => {
    usePlayerStore.setState({ credits: 290 });
    renderSheet(target(40, 'Generic Fuel Cell'));
    for (const chip of ['20', '50', '100', '1000']) {
      expect(screen.getByTestId(`vendor-qty-chip-${chip}`)).toBeDisabled();
    }
    expect(screen.getByTestId('vendor-qty-chip-1')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('vendor-qty-chip-max'));
    expect(screen.getByTestId('vendor-qty-value')).toHaveTextContent('7');
    expect(screen.getByTestId('vendor-qty-total')).toHaveTextContent('280cr');
    expect(screen.getByTestId('vendor-qty-after')).toHaveTextContent('10cr');
  });

  it('slider drives the quantity and totals live', () => {
    renderSheet(target(150, 'Ammo Pack'));
    const slider = screen.getByTestId('vendor-qty-slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '20' } });
    expect(screen.getByTestId('vendor-qty-value')).toHaveTextContent('20');
    expect(screen.getByTestId('vendor-qty-total')).toHaveTextContent('3,000cr');
    expect(screen.getByTestId('vendor-qty-after')).toHaveTextContent('172,000cr');
  });

  it('confirm hands the picked quantity to onBuy', () => {
    const t = target(800);
    const { onBuy } = renderSheet(t);
    fireEvent.click(screen.getByTestId('vendor-qty-chip-max'));
    fireEvent.click(screen.getByTestId('vendor-qty-confirm'));
    expect(onBuy).toHaveBeenCalledTimes(1);
    expect(onBuy).toHaveBeenCalledWith(t, 218);
  });

  it('resets to 1 on every open', () => {
    const t = target(150, 'Ammo Pack');
    const { rerender } = renderSheet(t);
    fireEvent.click(screen.getByTestId('vendor-qty-chip-100'));
    expect(screen.getByTestId('vendor-qty-value')).toHaveTextContent('100');
    rerender(<VendorBuySheet target={null} busy={false} onClose={vi.fn()} onBuy={vi.fn()} />);
    rerender(<VendorBuySheet target={t} busy={false} onClose={vi.fn()} onBuy={vi.fn()} />);
    expect(screen.getByTestId('vendor-qty-value')).toHaveTextContent('1');
  });

  it('clamps the selection down when the balance drops mid-sheet', () => {
    renderSheet(target(800));
    fireEvent.click(screen.getByTestId('vendor-qty-chip-max'));
    expect(screen.getByTestId('vendor-qty-value')).toHaveTextContent('218');
    // Balance falls to 4,000cr: MAX becomes floor(4000 / 800) = 5.
    act(() => usePlayerStore.setState({ credits: 4000 }));
    expect(screen.getByTestId('vendor-qty-value')).toHaveTextContent('5');
    expect(screen.getByTestId('vendor-qty-total')).toHaveTextContent('4,000cr');
    expect(screen.getByTestId('vendor-qty-after')).toHaveTextContent('0cr');
  });

  it('QC geometry pins: confirm box is >= 44px incl. border; slider is a native 44px-row range input; chips are 44px', () => {
    renderSheet(target(40, 'Generic Fuel Cell'));
    const confirm = screen.getByTestId('vendor-qty-confirm');
    // border-box sizing: min-h-[44px] + border-2 => the element BOX is
    // 44px (the rendering QC measured the 40px orange fill inside the
    // 2px black border — 44 - 2*2 = 40 — not the box).
    expect(confirm.className).toContain('min-h-[44px]');
    expect(confirm.className).toContain('border-2');
    const slider = screen.getByTestId('vendor-qty-slider') as HTMLInputElement;
    expect(slider.tagName).toBe('INPUT');
    expect(slider.type).toBe('range');
    expect(slider.className).toContain('h-11');
    expect(screen.getByTestId('vendor-qty-chip-1').className).toContain('min-h-[44px]');
  });
});
