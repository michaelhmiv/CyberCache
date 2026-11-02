/**
 * Consumables catalog — every shipped consumable type with its
 * effect, price anchor, vendor status, and crafted quality range.
 * Owner: src/constants/consumables.ts (the single contract; effect
 * text is each def's own resolved `effect` string, vendor status is
 * derived from the shipped market flags, exactly as the Vendor page
 * describes them).
 */
import { CONSUMABLES, type ConsumableDef } from '../../src/constants/consumables';
import { type GenBlock, table, titleCase } from './lib';

function vendorStatus(def: ConsumableDef): string {
  if (def.market.vendorExcluded) return 'Crafter-only';
  if (def.market.vendorStocked) return 'Vendor staple';
  if (def.market.rotatingVendorOnly) return 'Vendor rotation';
  return 'Not stocked';
}

function consumablesBody(): string {
  const rows = Object.values(CONSUMABLES).map((d) => [
    `**${d.name}**`,
    titleCase(d.family),
    d.effect,
    d.basePrice,
    vendorStatus(d),
    d.market.craftable ? `${d.quality.craftMin}–${d.quality.craftMax}% (cap ${d.quality.cap}%)` : '—',
  ]);
  return table(['Consumable', 'Family', 'Effect', 'Price (cr)', 'Vendor', 'Crafted quality range'], rows);
}

export const consumablesBlock: GenBlock = {
  id: 'consumables',
  owners: ['src/constants/consumables.ts'],
  render: consumablesBody,
};
