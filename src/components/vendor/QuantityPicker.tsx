/**
 * QuantityPicker — the shared quantity picker (the vendor buy sheet
 * and the workshop recipe card). Quick-pick chips ride the stop
 * rail's chip grammar (active = amber fill); the slider draws its
 * own track with the native input riding transparent above it.
 * 44px targets throughout; chips past the max are disabled, never
 * hidden.
 */
import React, { useMemo } from 'react';

const QUICK_PICKS = [1, 20, 50, 100, 1000];

const chipCls = (selected: boolean, disabled: boolean) =>
  `flex min-h-[44px] items-center justify-center border px-1 text-[11px] font-black transition-colors ${
    selected
      ? 'border-amber bg-amber text-bg'
      : 'border-border bg-surface-raised text-text-secondary'
  } ${disabled ? 'opacity-40' : ''}`;

export interface QuantityPickerProps {
  value: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Prefix for the data-testid family: `<p>-value`, `<p>-chips`, `<p>-chip-<n>`, `<p>-chip-max`, `<p>-slider`. */
  testIdPrefix: string;
}

export const QuantityPicker: React.FC<QuantityPickerProps> = ({ value, max, onChange, disabled, testIdPrefix }) => {
  const isDisabled = disabled ?? false;
  const sliderPct = useMemo(() => {
    if (max <= 1) return 100;
    return ((value - 1) / (max - 1)) * 100;
  }, [value, max]);

  return (
    <>
      {/* Quantity readout */}
      <div className="flex items-end justify-between">
        <div className="text-[11px] font-black uppercase text-text-secondary">Quantity</div>
        <div className="text-[23px] font-black leading-none text-text-primary" data-testid={`${testIdPrefix}-value`}>
          {value.toLocaleString()}
        </div>
      </div>

      {/* Quick-pick chips: 1 / 20 / 50 / 100 / 1000 / MAX. A chip
          past the player's MAX is disabled, never hidden — the
          ladder stays put and the wallet says why. */}
      <div className="grid grid-cols-6 gap-1.5" data-testid={`${testIdPrefix}-chips`}>
        {QUICK_PICKS.map((pick) => (
          <button
            key={pick}
            type="button"
            disabled={pick > max || isDisabled}
            onClick={() => onChange(pick)}
            className={chipCls(value === pick, pick > max)}
            data-testid={`${testIdPrefix}-chip-${pick}`}
          >
            {pick.toLocaleString()}
          </button>
        ))}
        <button
          type="button"
          disabled={max < 1 || isDisabled}
          onClick={() => onChange(max)}
          className={chipCls(value === max && max > 1, max < 1)}
          data-testid={`${testIdPrefix}-chip-max`}
        >
          MAX
        </button>
      </div>

      {/* Slider: 1 .. MAX on a drawn track (amber fill to the
          selection), the native input riding transparent above
          it with the full 44px row as its tap target. */}
      <div>
        <div className="relative flex h-11 items-center">
          <div className="absolute left-0 right-0 h-2 bg-surface-raised" />
          <div className="absolute left-0 h-2 bg-amber" style={{ width: `${sliderPct}%` }} />
          <input
            type="range"
            min={1}
            max={Math.max(1, max)}
            step={1}
            value={value}
            disabled={max <= 1 || isDisabled}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label="Quantity"
            data-testid={`${testIdPrefix}-slider`}
            className="absolute inset-0 h-11 w-full cursor-pointer appearance-none bg-transparent disabled:opacity-40 [&::-moz-range-thumb]:h-[26px] [&::-moz-range-thumb]:w-[26px] [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-black [&::-moz-range-thumb]:bg-amber [&::-moz-range-thumb]:shadow-[3px_3px_0_rgba(0,0,0,0.72)] [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:h-[26px] [&::-webkit-slider-thumb]:w-[26px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-black [&::-webkit-slider-thumb]:bg-amber [&::-webkit-slider-thumb]:shadow-[3px_3px_0_rgba(0,0,0,0.72)]"
          />
        </div>
        <div className="flex justify-between text-[11px] text-text-muted">
          <span>1</span>
          <span>{max.toLocaleString()}</span>
        </div>
      </div>
    </>
  );
};
