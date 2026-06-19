import type { GearItem, Weapon } from '@/types/items';

export type ServerItemRow = {
  id: string;
  item_level?: number | string | null;
  rarity?: string | null;
  is_locked?: boolean | null;
  runtime_state?: string | null;
  equipped_slot?: string | null;
  payload?: Record<string, unknown> | null;
};

export function serverItemRowToDisplayGear(row: ServerItemRow): GearItem | null {
  // Payload-based reconstruction: when the server stores the full item JSON
  // in the payload column, return it directly. Validate that the payload
  // has at least one gear-type discriminator field (weaponType, hp, damage,
  // treeBonus, or affixes) so we don't spread a stray object as a GearItem.
  if (
    row.payload &&
    typeof row.payload === 'object' &&
    'id' in row.payload &&
    'rarity' in row.payload &&
    'level' in row.payload &&
    ('weaponType' in row.payload ||
     'hp' in row.payload ||
     'damage' in row.payload ||
     'treeBonus' in row.payload ||
     'affixes' in row.payload)
  ) {
    const raw = row.payload as Record<string, unknown>;
    const gear = {
      ...(raw as unknown as GearItem),
      id: row.id || String(raw.id),
      isLocked: Boolean(row.is_locked),
    };

    // Defensive: payload-reconstructed weapons must carry all required
    // numeric fields. Missing values (from old Chef runs, partial
    // migrations, or DB corruption) will crash rendering code that calls
    // .toFixed() on them. Patch missing fields with safe defaults and
    // log a warning so we can trace the source.
    if ('weaponType' in gear) {
      const defaults: Partial<Record<keyof Weapon, number>> = {
        attackSpeed: 1.0,
        baseDamage: 10,
        critChance: 0.05,
        critDamage: 1.5,
        statusChance: 0,
        statusDamage: 0,
        bossDamageMod: 1,
        waveDamageMod: 1,
        shieldDamageMod: 1,
        armorDamageMod: 1,
        offlineEarningsMod: 0,
        rareDropChanceMod: 0,
        scrapYieldMod: 0,
        rollQuality: 50,
        combatPower: 10,
        bossPower: 10,
        farmPower: 10,
        economyScore: 0,
      };
      let patched = false;
      for (const [key, fallback] of Object.entries(defaults)) {
        if (typeof gear[key as keyof typeof gear] !== 'number') {
          (gear as Record<string, unknown>)[key] = fallback;
          patched = true;
        }
      }
      if (!Array.isArray(gear.parts)) (gear as Record<string, unknown>).parts = [];
      if (!Array.isArray(gear.affixes)) (gear as Record<string, unknown>).affixes = [];
      if (typeof gear.pixelSeed !== 'number') {
        (gear as Record<string, unknown>).pixelSeed = Math.abs(String(gear.id ?? '').split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0));
        patched = true;
      }
      if (patched) {
        console.warn('[serverItemAdapter] Patched incomplete weapon payload for', gear.id, '— check Chef generator version or DB migration state.');
      }
    }

    return gear;
  }

  console.warn('[serverItemAdapter] Unrecognizable item payload for row', row.id, '— hiding item until payload is repaired.');
  return null;
}
