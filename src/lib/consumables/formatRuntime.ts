import type { ConsumableRuntimeEffects } from '@/constants/consumables';

/**
 * Format a runtime value (delta-style) for a consumable effect key.
 * Multipliers → `1.05×`, chances/reductions/bias/bypass/pct → `5%`, seconds → `12s`.
 */
export function formatRuntimeValue(key: keyof ConsumableRuntimeEffects, value: number): string {
  if (key.toLowerCase().includes('multiplier')) return `${value.toFixed(2)}×`;
  if (
    key.toLowerCase().includes('chance') ||
    key.toLowerCase().includes('reduction') ||
    key.toLowerCase().includes('bias') ||
    key.toLowerCase().includes('bypass') ||
    key.toLowerCase().includes('pct')
  ) {
    return `${(value * 100).toFixed(0)}%`;
  }
  if (key.toLowerCase().includes('seconds')) return `${Math.round(value)}s`;
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

/**
 * Humanize a runtime effect key like `healHp` → `Heal Hp`.
 */
export function labelizeRuntimeKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}
