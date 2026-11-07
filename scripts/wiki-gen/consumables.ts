/**
 * Consumables catalog — every shipped consumable type with its
 * effect, price anchor, vendor status, and crafted quality range.
 * Owner: src/constants/consumables.ts (the single contract; effect
 * text is each def's own resolved `effect` string, vendor status is
 * derived from the shipped market flags, exactly as the Vendor page
 * describes them).
 */
import { CONSUMABLES, type ConsumableDef } from '../../src/constants/consumables';
import { consumablePlateImgTag, consumablePlates } from './images-w5';
import { type GenBlock, table, titleCase } from './lib';

function vendorStatus(def: ConsumableDef): string {
  if (def.market.vendorExcluded) return 'Crafter-only';
  if (def.market.vendorStocked) return 'Vendor staple';
  if (def.market.rotatingVendorOnly) return 'Vendor rotation';
  return 'Not stocked';
}

function consumablesBody(): string {
  const rows = Object.entries(CONSUMABLES).map(([id, d]) => [
    consumablePlateImgTag(id, d.name),
    `**${d.name}**`,
    titleCase(d.family),
    d.effect,
    d.basePrice,
    vendorStatus(d),
    d.market.craftable ? `${d.quality.craftMin}–${d.quality.craftMax}% (cap ${d.quality.cap}%)` : '—',
  ]);
  return table(['Icon', 'Consumable', 'Family', 'Effect', 'Price (cr)', 'Vendor', 'Crafted quality range'], rows);
}

export const consumablesBlock: GenBlock = {
  id: 'consumables',
  owners: ['src/constants/consumables.ts', 'src/lib/pixel/consumableArt.ts', 'src/lib/pixel/smallItemCore.ts', 'src/constants/visualAssets.ts'],
  render: consumablesBody,
  assets: consumablePlates,
};
