export function generateItemId(): string {
  // Weapons/cosmetics/loot come from the server in production, but generators
  // still run client-side for the NPC market and seed data. The server expects
  // UUID-shaped item ids for loadout/equip RPCs, so use crypto.randomUUID()
  // where available (https) and fall back to a timestamped slug in test/jsdom.
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
