/**
 * Market v2 arrangement (redesign v2, Wave C) — the rail of stops,
 * the Rep Desk promotion with its Weekly claim surface, and the
 * parent alignment audit's Market defect list, pinned:
 *
 *  - the 7-tile sub-nav grid is gone; one scrolling rail carries
 *    exactly DESIGN.md §2's seven stops — Buy · Sell · Vendor ·
 *    Repair · Shield Tech · Rep Desk · Slots — at the 11px floor,
 *    with My Listings ("Mine") and History as segments of the
 *    Sell stop, not stops of their own (Wave D conformance);
 *  - the Vendor's hidden `rep` toggle and the Vendor-foot slot
 *    machine are deleted — standing and slots are rail stops;
 *  - buyback is a named dashed row on the Vendor stop (F2);
 *  - sellers print as hunter names (wire-joined profile name),
 *    never a raw id — the NPC seed stock that printed "00000000"
 *    is the case this suite exists to keep dead;
 *  - vendor chips never print raw trigger keys.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sellerDisplayName, historyPartyName } from '@/lib/market/sellerDisplay';
import { TRIGGER_LABELS } from '@/lib/consumables/families';

const readSource = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');

describe('sellerDisplay — sellers print as hunter names', () => {
  const NPC_ID = '00000000-0000-0000-0000-000000000000';

  it('own listing prints You', () => {
    expect(sellerDisplayName({ sellerId: 'me', sellerName: 'Dust Hawk', sellerType: 'player' }, 'me')).toBe('You');
  });

  it('NPC seed stock prints NPC Vendor, never the zero-padded id', () => {
    const label = sellerDisplayName({ sellerId: NPC_ID, sellerName: null, sellerType: 'npc' }, 'someone-else');
    expect(label).toBe('NPC Vendor');
    expect(label).not.toContain('0000');
  });

  it('a profile name passes through', () => {
    expect(sellerDisplayName({ sellerId: 'x', sellerName: 'Dust Hawk', sellerType: 'player' }, 'me')).toBe('Dust Hawk');
  });

  it('a nameless profile falls back to the generic hunter name, never an id slice', () => {
    const label = sellerDisplayName({ sellerId: '123e4567-e89b-12d3-a456-426614174000', sellerName: '', sellerType: 'player' }, 'me');
    expect(label).toBe('Vault Runner');
    expect(label).not.toContain('123e4567');
  });

  it('history parties never print an id', () => {
    expect(historyPartyName('me', 'Gunrunner', 'me')).toBe('You');
    expect(historyPartyName('player_1', 'Gunrunner', 'me')).toBe('Gunrunner');
    const label = historyPartyName('123e4567-e89b-12d3-a456-426614174000', 'Gunrunner', 'me');
    expect(label).toBe('Another hunter');
    expect(label).not.toContain('123e');
  });
});

describe('market v2 — rail of stops (source pins)', () => {
  const market = readSource('src/screens/MarketScreen.tsx');

  it('the rail replaced the tile grid and carries exactly the seven §2 stops', () => {
    expect(market).not.toContain('grid grid-cols-3');
    expect(market).toContain('<ChipRail>');
    const order = ['buy', 'sell', 'vendor', 'repair', 'shieldTech', 'repdesk', 'slots'];
    const positions = order.map((id) => market.indexOf(`{ id: '${id}'`));
    for (const pos of positions) expect(pos).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // My Listings and History are NOT rail stops (§2) — the
    // nine-stop rail from the first v2 build is retired. (The
    // stop shape carries a px icon; the Sell segments below do
    // not, which is what keeps this pin precise.)
    expect(market).not.toContain("{ id: 'mylistings', label: 'My Listings', px");
    expect(market).not.toContain("{ id: 'history', label: 'History', px");
  });

  it('My Listings and History live on the Sell stop as its Mine and History segments', () => {
    // The segment control rides the top of the Sell stop in the
    // rail's rectangular geometry; the two surfaces render under
    // the Sell stop, gated on the segment — re-homed, not removed.
    expect(market).toContain("const SELL_SEGMENTS");
    expect(market).toContain("{ id: 'mine', label: 'Mine' }");
    expect(market).toContain("{ id: 'history', label: 'History' }");
    expect(market).toContain('segmentCls');
    expect(market).toContain("market.activeTab === 'sell' && sellSegment === 'sell'");
    expect(market).toContain("market.activeTab === 'sell' && sellSegment === 'mine'");
    expect(market).toContain("market.activeTab === 'sell' && sellSegment === 'history'");
    // The Mine segment keeps the cancel action; History keeps its rows.
    expect(market).toContain('Cancel Listing');
    expect(market).toContain('historyPartyLabel');
  });

  it('Rep Desk and Slots render as first-class stops', () => {
    expect(market).toContain("market.activeTab === 'repdesk' && <RepDeskPanel />");
    expect(market).toContain("market.activeTab === 'slots' && <DataSlotsPanel />");
  });

  it('every chip row rides the one ChipRail geometry', () => {
    // Drift-fix F3 successor contract: chip rows still ride
    // ChipRail, but a rail that shares its row with the sort
    // select or the count/refresh cluster carries a layout
    // className (min-w-0 flex-1) — the pin counts ChipRail
    // openings with or without attributes. The invariant is
    // unchanged: no chip row hand-rolls its own scroller.
    expect(market.match(/<ChipRail[\s>]/g)?.length).toBeGreaterThanOrEqual(5);
    expect(market).toContain('chipCls');
    // The old ragged per-row chip markup is gone.
    expect(market).not.toContain('overflow-x-auto pb-1');
  });

  it('Buy Now is the amber primary with its lock optically centered as a group', () => {
    expect(market).toContain('items-center justify-center gap-1.5');
    expect(market).not.toContain('bg-green py-2');
    expect(market).toContain('Seller · {seller}');
    expect(market).not.toContain('id.slice(0, 8)');
    expect(market).not.toContain('formatSellerName');
  });

  it('the refresh lines share the column alignment system (left, not centered italic)', () => {
    expect(market).not.toContain('italic text-text-muted hover:text-amber');
    expect(market).not.toContain('mx-auto');
  });
});

describe('market v2 — Vendor stop (source pins)', () => {
  const vendor = readSource('src/screens/VendorScreen.tsx');

  it('the rep toggle and the stall-foot slot machine are deleted', () => {
    expect(vendor).not.toContain("'rep'");
    expect(vendor).not.toContain('RepDeskPanel');
    expect(vendor).not.toContain('DataSlotsPanel');
    expect(vendor).not.toContain("useState<'buy' | 'sell' | 'rep'>");
  });

  it('buyback is a named dashed row on the first viewport (F2)', () => {
    expect(vendor).toContain('Sell to Vendor — Buyback');
    expect(vendor).toContain('border-dashed');
    expect(vendor).toContain("setMode('sell')");
  });

  it('no skewed-parallelogram buttons remain on the stop', () => {
    expect(vendor).not.toContain('bl-primary');
    expect(vendor).toContain('vendorCtaCls');
  });

  it('trigger chips print human labels, never the raw engine key', () => {
    expect(vendor).not.toContain('{c.trigger}');
    expect(vendor).toContain('TRIGGER_LABELS[c.trigger]');
    expect(TRIGGER_LABELS.hpBelowThreshold).toBe('Low HP');
    expect(TRIGGER_LABELS.activityStart).toBe('Activity start');
    for (const [key, label] of Object.entries(TRIGGER_LABELS)) {
      expect(label, key).not.toBe(key);
      expect(label, key).not.toMatch(/^[a-z]+[A-Z]/);
    }
  });

  it('the wallet prints once — the vendor header carries no second credits block', () => {
    expect(vendor).not.toContain('uppercase">Credits');
  });
});

describe('market v2 — Rep Desk Weekly claim surface (source pins)', () => {
  const desk = readSource('src/components/vendor/RepDeskPanel.tsx');

  it('the Weekly section is the claim surface for crates and orders', () => {
    expect(desk).toContain('This Week at the Desk');
    expect(desk).toContain('Parts Crate:');
    expect(desk).toContain('Signature Order:');
    // Claims ride the #247 wire: crates via standing buy, orders
    // via the signature-order op.
    expect(desk).toContain('standingBuy({ nonce: newStandingBuyNonce(), offerKey: m.crate.offerKey, quantity: 1 })');
    expect(desk).toContain('standingOrder({ nonce: newStandingOrderNonce(), manufacturer: m.manufacturer })');
    // The weekly rows render above the per-maker cards.
    expect(desk.indexOf('{renderWeekly()}')).toBeLessThan(desk.indexOf('view.manufacturers.map(renderManufacturer)'));
  });
});
