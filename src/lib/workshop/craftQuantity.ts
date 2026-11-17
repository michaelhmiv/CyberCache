/**
 * craftUnitsMax — the crafting MAX analogue (audit §7b): credits do
 * not bind crafting; inputs and the per-job ceiling do. Queue slots
 * never bound units.
 */
export function craftUnitsMax(args: {
  recipeMaxUnits?: number | null;
  inputs: readonly { per: number; have: number }[];
  catalystPerUnit: boolean;
  catalystHave: number;
}): number {
  const { recipeMaxUnits, inputs, catalystPerUnit, catalystHave } = args;
  let max = recipeMaxUnits ?? 500;
  for (const input of inputs) {
    if (input.per > 0) max = Math.min(max, Math.floor(input.have / input.per));
  }
  if (catalystPerUnit) max = Math.min(max, catalystHave);
  return Math.max(0, max);
}
