/**
 * Vehicles — the 7 classes, the yield/fuel/condition model constants,
 * and the vehicle affix pool. Owner: src/lib/vehicles/vehicles.ts.
 */
import {
  VEHICLE_CLASSES,
  VEHICLE_AFFIX_POOL,
  FUEL_UNITS_PER_CELL,
  PATCH_KIT_BASES,
  VEHICLE_BASE_DECAY_PER_TICK,
  VEHICLE_DROP_SHARE,
  AREA_DANGER_DECAY,
} from '../../src/lib/vehicles/vehicles';
import { type GenBlock, mult, num, pct, table } from './lib';

function vehiclesBody(): string {
  const classRows = VEHICLE_CLASSES.map((v) => [
    `**${v.displayName}**`,
    v.unlockLevel,
    mult(v.baseYield),
    num(v.fuelBurnPerTick),
    mult(v.conditionLossMultiplier),
    v.materialYieldBonus === 0 ? '—' : `+${pct(v.materialYieldBonus)}`,
    v.role,
  ]);
  const dangerRows = Object.entries(AREA_DANGER_DECAY).map(([danger, factor]) => [danger, mult(factor)]);
  const affixRows = VEHICLE_AFFIX_POOL.map((d) => [
    d.text.replace('{v}', `${num(d.min * 100)}–${num(d.max * 100)}`),
    d.stat,
  ]);
  return [
    '### Vehicle classes',
    '',
    table(['Class', 'Unlock level', 'Yield', 'Fuel / tick', 'Wear rate', 'Material bonus', 'Role'], classRows),
    '',
    '### The model in numbers',
    '',
    `- One fuel cell loads **${FUEL_UNITS_PER_CELL} fuel units** into the tank.`,
    `- Condition decays **${num(VEHICLE_BASE_DECAY_PER_TICK)} points per fueled tick** before the class wear rate and area danger scaling:`,
    '',
    table(['Area danger', 'Decay scaling'], dangerRows),
    '',
    `- Patch kits restore condition at 100% quality: ${Object.entries(PATCH_KIT_BASES)
      .map(([type, points]) => `${type} **${points}**`)
      .join(' · ')}.`,
    `- Vehicles arrive as gear drops: **${pct(VEHICLE_DROP_SHARE)}** of gear drops are replaced by a vehicle drop.`,
    '',
    '### Vehicle affix pool',
    '',
    table(['Affix roll', 'Stat'], affixRows),
  ].join('\n');
}

export const vehiclesBlock: GenBlock = {
  id: 'vehicles',
  owners: ['src/lib/vehicles/vehicles.ts'],
  render: vehiclesBody,
};
