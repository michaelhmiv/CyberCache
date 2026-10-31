import type { GearItem, Vehicle, Weapon } from '@/types/items';
import type { VehicleDisplay } from '@/store/slices/vehicleSlice';

export type ServerItemRow = {
  id: string;
  item_level?: number | string | null;
  rarity?: string | null;
  is_locked?: boolean | null;
  runtime_state?: string | null;
  equipped_slot?: string | null;
  payload?: Record<string, unknown> | null;
  /** Item kind (0021) — 'vehicle' rows route to the garage, never gear. */
  kind?: string | null;
  condition_current?: number | string | null;
  condition_max?: number | string | null;
};

/** True when the row is a vehicle instance (kind column or payload marker). */
export function isVehicleRow(row: ServerItemRow): boolean {
  return row.kind === 'vehicle' || !!(row.payload && 'vehicleClassId' in row.payload);
}

/**
 * Reconstruct a vehicle display object from an item row (0021).
 * Condition rides on the row columns, not the payload.
 */
export function serverItemRowToVehicle(row: ServerItemRow): VehicleDisplay | null {
  const raw = row.payload;
  if (!raw || typeof raw !== 'object' || !('vehicleClassId' in raw) || !('id' in raw)) return null;
  const payload = raw as unknown as Vehicle;
  const max = Number(row.condition_max);
  const current = Number(row.condition_current);
  return {
    ...payload,
    id: row.id || String(raw.id),
    isLocked: Boolean(row.is_locked),
    conditionMax: Number.isFinite(max) && max > 0 ? max : 100,
    conditionCurrent: Number.isFinite(current) ? current : (Number.isFinite(max) && max > 0 ? max : 100),
  };
}

export function serverItemRowToDisplayGear(row: ServerItemRow): GearItem | null {
  // Vehicles are not gear (0021): their payloads carry affixes and
  // would otherwise reconstruct as relics. They route to the garage
  // through serverItemRowToVehicle instead.
  if (isVehicleRow(row)) return null;
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
    // numeric fields. A weapon payload missing required fields indicates
    // corruption or an incomplete migration — reject it rather than
    // silently patching with defaults, which would create a fake weapon
    // indistinguishable from a real one downstream.
    if ('weaponType' in gear) {
      const requiredWeaponFields: Array<keyof Weapon> = [
        'baseDamage', 'attackSpeed', 'critChance', 'critDamage',
        'combatPower', 'bossPower', 'farmPower',
      ];
      for (const field of requiredWeaponFields) {
        if (typeof gear[field] !== 'number') {
          console.warn('[serverItemAdapter] Weapon payload missing required field', field, 'for row', row.id, '— hiding item until payload is repaired.');
          return null;
        }
      }
      // Optional fields with safe fallbacks (non-critical for rendering/stats)
      if (!Array.isArray(gear.parts)) (gear as Record<string, unknown>).parts = [];
      if (!Array.isArray(gear.affixes)) (gear as Record<string, unknown>).affixes = [];
      if (typeof gear.pixelSeed !== 'number') {
        (gear as Record<string, unknown>).pixelSeed = Math.abs(String(gear.id ?? '').split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0));
      }
    }

    return gear;
  }

  console.warn('[serverItemAdapter] Unrecognizable item payload for row', row.id, '— hiding item until payload is repaired.');
  return null;
}
