export function formatWhole(value: number): string {
  return Math.round(value).toLocaleString();
}

export function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatSignedPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
}

export function formatMultiplierOrWhole(value: number): string {
  if (Math.abs(value) < 10) return `${value.toFixed(2)}×`;
  return formatWhole(value);
}
