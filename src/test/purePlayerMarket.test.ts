/**
 * Pure player market (owner ruling, 2026-11-02): "weapons from npc
 * vendor are not in the buy or sell tab, that's only for pure player
 * market."
 *
 * Covered here:
 *   1. NPC seed generation no longer emits weapons at all (the seed
 *      job's item source — both the job route and the legacy seed
 *      route build from buildNpcSeedItems), while the rest of the
 *      stock mix (shields / class mods / relics / ordnance) is intact.
 *   2. Source pins for the enforcement seams that the HTTP tests in
 *      marketDepth.test.ts cannot reach directly: the Pg browse's
 *      SQL exclusion (the twin of the listingQuery fold) and the
 *      Pg write store's vendor-weapon refusal. The Pg paths themselves
 *      are exercised against embedded Postgres in the slice harness.
 *
 * The browse fold, the read routes, and the write-route refusal are
 * covered behaviorally in marketDepth.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNpcSeedItems, generateNpcItem } from '../server/jobs/npcItems';

describe('NPC seed generation — weapons are out (owner ruling, 2026-11-02)', () => {
  it('buildNpcSeedItems emits the full count, none of them weapons', () => {
    const items = buildNpcSeedItems(300, 10);
    expect(items).toHaveLength(300);
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.has('gear:weapon')).toBe(false);
    for (const kind of kinds) {
      expect(['gear:shield', 'gear:classMod', 'gear:relic', 'gear:ordnance']).toContain(kind);
    }
    // The rest of the mix is intact: every remaining kind shows up.
    expect(kinds.size).toBe(4);
    // Every seeded item is priced by the standing rules (floor 100).
    expect(items.every((i) => i.price_credits >= 100)).toBe(true);
  });

  it('generateNpcItem never returns a weapon payload', () => {
    for (let n = 0; n < 500; n += 1) {
      const item = generateNpcItem(10) as unknown as Record<string, unknown>;
      expect('weaponType' in item).toBe(false);
    }
  });
});

describe('pure player market — Pg seam source pins', () => {
  const readsStore = readFileSync(resolve(__dirname, '../server/reads/store.ts'), 'utf8');
  const writesStore = readFileSync(resolve(__dirname, '../server/writes/store.ts'), 'utf8');
  const writesMemory = readFileSync(resolve(__dirname, '../server/writes/memory.ts'), 'utf8');
  const npcItems = readFileSync(resolve(__dirname, '../server/jobs/npcItems.ts'), 'utf8');

  it('the Pg browse carries the npc-weapon exclusion twin', () => {
    // Seller read the browseRowFor way (stamped column OR item supply
    // mode), category derived by the 0019 SQL helper when unstamped.
    expect(readsStore).toContain("ml.seller_type = 'npc' or ii.supply_mode = 'npc_market'");
    expect(readsStore).toContain('public.cc_market_gear_category');
    // The count query joins item_instances so totals agree with rows.
    expect(readsStore).toContain('left join public.item_instances ii on ii.id = ml.item_instance_id\n       where ${whereSql}');
  });

  it('both write stores share the vendor-weapon refusal', () => {
    expect(writesStore).toContain('NPC_VENDOR_WEAPON_REFUSAL');
    expect(writesStore).toContain('isNpcVendorWeapon');
    expect(writesMemory).toContain('NPC_VENDOR_WEAPON_REFUSAL');
    expect(writesMemory).toContain('isNpcVendorWeapon(item)');
  });

  it('the NPC generator no longer imports the weapon generator', () => {
    expect(npcItems).not.toContain('generateWeapon(');
    expect(npcItems).not.toContain('weaponGenerator');
  });
});
