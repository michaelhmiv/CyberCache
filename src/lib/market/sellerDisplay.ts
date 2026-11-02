/**
 * sellerDisplay — how a listing's seller prints on a card (DESIGN.md
 * §1: no raw identifiers in player text; sellers print as hunter
 * names). The name itself rides the listings wire from the seller's
 * profile (server join in src/server/reads/store.ts); this helper
 * only owns the fallbacks, and none of them is an id:
 *
 *   own listing        -> "You"
 *   NPC seed stock     -> "NPC Vendor"
 *   profile name       -> the hunter name itself
 *   profile without one -> "Vault Runner" (the game's generic
 *                          hunter name, cf. the 0003 read APIs)
 */
export interface SellerIdentity {
  sellerId: string;
  sellerName?: string | null;
  sellerType?: 'player' | 'npc' | string | null;
}

export function sellerDisplayName(seller: SellerIdentity, currentUserId?: string | null): string {
  if (currentUserId && seller.sellerId === currentUserId) return 'You';
  if (seller.sellerType === 'npc') return 'NPC Vendor';
  const name = typeof seller.sellerName === 'string' ? seller.sellerName.trim() : '';
  if (name) return name;
  return 'Vault Runner';
}

/**
 * History rows store only the counterparty's id (no name snapshot),
 * so a past trade prints a role label — never the id itself.
 */
export function historyPartyName(otherPartyId: string, ownName: string, currentUserId?: string | null): string {
  if (currentUserId && otherPartyId === currentUserId) return 'You';
  if (otherPartyId === 'player_1') return ownName;
  return 'Another hunter';
}
