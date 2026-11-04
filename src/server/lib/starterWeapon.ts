/**
 * The Starter Pistol — canonical form and seed-row repair.
 *
 * Migration 0004's profile-bootstrap trigger (cc_seed_starter_weapon)
 * seeds every new account's first weapon as a SPARSE payload:
 * { id, name, weaponType, element, manufacturer, rarity, level,
 *   combatPower, bossPower, dps, sourceTag: 'Starter Kit' }
 * — no baseDamage / attackSpeed / critChance / critDamage /
 * farmPower. Every downstream truth surface rejects that shape, by
 * design, as corrupt data: the client item adapter hides the row
 * (Gear shows "No weapon", 0/7), the server loadout derivation
 * (isUsableWeaponPayload) treats the primary slot as empty, the
 * roaming engine prices the hunter as unarmed, kills attribute to
 * 'unarmed', and the area-danger duel reads a 0-DPS hunter and calls
 * even the starter area lethal. The row was only ever a server-side
 * placeholder ("exists so fresh-guest claims have a server-side
 * starter", migration 0040) — but no real weapon ever replaced it.
 *
 * The repair: the Chef — the authoritative engine — materializes the
 * seed row into the REAL weapon it was always meant to be, the first
 * time it serves the player's items or equipped gear, and persists
 * the repaired payload back onto the row. The weapon is a genuine
 * generated level-1 Common Redline Kinetic Pistol (the identity the
 * seed row declares), produced by the shared generator — no invented
 * stats: every number on it is the generator's own output, and
 * combatPower is the DPS chain's standard-target score, exactly like
 * every other weapon in the game. Generation is seeded from the
 * row's own id, so the repair is deterministic: any store, any
 * process, any number of runs produce the identical payload, and the
 * UPDATE only ever fires while the row is still sparse.
 *
 * The SQL trigger still seeds the sparse shape for new accounts
 * (restating it is a migration, out of this slice's scope); the
 * repair makes that harmless — the row is whole before any surface
 * can read it.
 */
import { generateWeapon } from './generators/weaponGenerator';
import { createRNG, hashString } from '@/lib/utils/rng';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

export const STARTER_WEAPON_NAME = 'Starter Pistol';
export const STARTER_SOURCE_TAG = 'Starter Kit';

/**
 * True when a stored payload is the sparse bootstrap seed: it claims
 * the Starter Kit provenance and a weapon type, but carries none of
 * the combat numbers a real generated weapon always has. A genuinely
 * corrupt payload from any other source does NOT match (no
 * sourceTag) and keeps hitting the corrupt-data guards downstream.
 */
export function isSparseStarterPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  return (
    typeof record.weaponType === 'string' &&
    record.sourceTag === STARTER_SOURCE_TAG &&
    typeof record.baseDamage !== 'number'
  );
}

/**
 * The canonical Starter Pistol payload for one item row, keyed by
 * the ROW id (migration 0047's identity rule: the payload's own id
 * is the row's id, so the item the client holds is the item the
 * server can find). Deterministic in the row id — see the header.
 */
export function buildStarterWeaponPayload(rowId: string): Record<string, unknown> {
  const seed = hashString(`starter-weapon:${rowId}`);
  const weapon: Weapon = generateWeapon(
    {
      source: DropSource.WorldDrop,
      level: 1,
      forcedType: WeaponType.Pistol,
      forcedRarity: Rarity.Common,
      forcedManufacturer: Manufacturer.Redline,
      forcedElement: Element.Kinetic,
    },
    createRNG(seed),
  );
  return {
    ...weapon,
    id: rowId,
    name: STARTER_WEAPON_NAME,
    sourceTag: STARTER_SOURCE_TAG,
    pixelSeed: seed,
  } as unknown as Record<string, unknown>;
}

/**
 * Repair one in-memory item record in place (the in-memory stores'
 * rows). Returns true when the payload was sparse and is now whole.
 */
export function repairStarterItemInPlace(item: { id: string; payload: unknown }): boolean {
  if (!isSparseStarterPayload(item.payload)) return false;
  item.payload = buildStarterWeaponPayload(item.id);
  return true;
}

type PgQuery = (sql: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;

/**
 * Repair a player's sparse starter rows in Postgres: find the
 * Starter-Kit-tagged weapon rows, keep the ones the TS predicate
 * calls sparse, and persist the canonical payload onto each. Runs
 * before the caller's own read so no surface ever serves the sparse
 * shape; once repaired, the predicate never matches again.
 */
export async function repairSparseStarterRowsPg(query: PgQuery, playerId: string): Promise<number> {
  const candidates = await query(
    `select id, payload from public.item_instances
      where owner_user_id = $1 and kind = 'weapon'
        and payload ->> 'sourceTag' = $2`,
    [playerId, STARTER_SOURCE_TAG],
  );
  let repaired = 0;
  for (const row of candidates) {
    if (!isSparseStarterPayload(row.payload)) continue;
    const id = String(row.id);
    await query(
      `update public.item_instances
          set payload = $2::jsonb, updated_at = now()
        where id = $1::uuid and owner_user_id = $3::uuid`,
      [id, JSON.stringify(buildStarterWeaponPayload(id)), playerId],
    );
    repaired += 1;
  }
  return repaired;
}
