/**
 * NPC stock ceiling (owner ruling, 2026-11-03): "make them just basic
 * common… gotta give mainly beginners something to get comfortable
 * with." This widens the pure player market of 2026-11-02 (#300):
 * above Common the Buy lane is player listings only in EVERY gear
 * kind, and NPC Common stock of every kind (weapons included) is the
 * beginner comfort stock.
 *
 * Covered here:
 *   1. NPC seed generation stocks all five gear kinds again (weapons
 *      restored to their original 45% share) but every seeded item is
 *      Common — the rarity ceiling is the whole point.
 *   2. Source pins for the enforcement seams that the HTTP tests in
 *      marketDepth.test.ts cannot reach directly: the Pg browse's
 *      SQL ceiling (the twin of the listingQuery fold) and the Pg
 *      write store's vendor-weapon refusal (UNCHANGED by this ruling
 *      — the create path stays refused for vendor weapons).
 *
 * The browse fold, the read routes, and the write-route refusal are
 * covered behaviorally in marketDepth.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNpcSeedItems, generateNpcItem } from '../server/jobs/npcItems';

describe('NPC seed generation — all kinds, Common only (owner ruling, 2026-11-03)', () => {
  it('buildNpcSeedItems emits the full count, all five kinds, every item Common', () => {
    const items = buildNpcSeedItems(300, 10);
    expect(items).toHaveLength(300);
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds).toEqual(new Set(['gear:weapon', 'gear:shield', 'gear:classMod', 'gear:relic', 'gear:ordnance']));
    // The ceiling: not one seeded item above Common.
    expect(items.every((i) => i.rarity === 'Common')).toBe(true);
    // Weapons are back at roughly their original 45% share (loose
    // statistical band — the kind roll is Math.random).
    const weapons = items.filter((i) => i.kind === 'gear:weapon').length;
    expect(weapons).toBeGreaterThan(90);
    expect(weapons).toBeLessThan(180);
    // Every seeded item is priced by the standing rules (floor 100).
    expect(items.every((i) => i.price_credits >= 100)).toBe(true);
  });

  it('generateNpcItem returns Common items, weapons included', () => {
    let sawWeapon = false;
    for (let n = 0; n < 500; n += 1) {
      const item = generateNpcItem(10) as unknown as Record<string, unknown>;
      expect(item.rarity).toBe('Common');
      if ('weaponType' in item) sawWeapon = true;
    }
    expect(sawWeapon).toBe(true);
  });
});

describe('NPC stock ceiling — Pg seam source pins', () => {
  const readsStore = readFileSync(resolve(__dirname, '../server/reads/store.ts'), 'utf8');
  const writesStore = readFileSync(resolve(__dirname, '../server/writes/store.ts'), 'utf8');
  const writesMemory = readFileSync(resolve(__dirname, '../server/writes/memory.ts'), 'utf8');
  const listingQuery = readFileSync(resolve(__dirname, '../lib/market/listingQuery.ts'), 'utf8');
  const npcItems = readFileSync(resolve(__dirname, '../server/jobs/npcItems.ts'), 'utf8');

  it('the Pg browse carries the npc above-Common exclusion twin', () => {
    // Seller read the browseRowFor way (stamped column OR item supply
    // mode), rarity derived stamped-first like browseRowFor.
    expect(readsStore).toContain("ml.seller_type = 'npc' or ii.supply_mode = 'npc_market'");
    expect(readsStore).toContain("coalesce(ml.rarity, ii.rarity, ii.payload ->> 'rarity') in ('Uncommon', 'Rare', 'Epic', 'Legendary')");
    // The count query joins item_instances so totals agree with rows.
    expect(readsStore).toContain('left join public.item_instances ii on ii.id = ml.item_instance_id\n       where ${whereSql}');
  });

  it('the browse fold carries the same ceiling', () => {
    expect(listingQuery).toContain("row.sellerType === 'npc'");
    expect(listingQuery).toContain("row.kind === 'gear'");
    expect(listingQuery).toContain('> RARITY_RANK.Common');
  });

  it('both write stores still share the vendor-weapon refusal (unchanged)', () => {
    expect(writesStore).toContain('NPC_VENDOR_WEAPON_REFUSAL');
    expect(writesStore).toContain('isNpcVendorWeapon');
    expect(writesMemory).toContain('NPC_VENDOR_WEAPON_REFUSAL');
    expect(writesMemory).toContain('isNpcVendorWeapon(item)');
  });

  it('the NPC generator stocks weapons again, pinned to Common', () => {
    expect(npcItems).toContain('generateWeapon(');
    expect(npcItems).toContain('forcedRarity: Rarity.Common');
    expect(npcItems).toContain('NPC_COMMON_ONLY');
  });
});
