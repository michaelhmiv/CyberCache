/**
 * Phase 1 UX restructure — structural pins.
 *
 * The consolidation claims are genuinely structural (one equip
 * surface, one boss picker, one area picker, one crafting home,
 * locks before the tap, vocabulary freeze), so they are pinned at
 * the source level alongside the behavior tests:
 *
 *  - GearHub and ChestScreen contain NO equip calls — equipping
 *    lives only in the gear home's Slot Picker path (ActionLoadout
 *    manage mode + preset application, both hosted by the home).
 *    SUPERSEDED IN PART by the 2026-11-01 UX audit (same exception
 *    class as flow-fix F11): UX-01 makes the cache reveal's Equip
 *    button equip in place (ChestScreen), and UX-02 adds an Unequip
 *    action to GearHub's inspect sheet — the audit found both
 *    surfaces promising an equip/unequip they did not perform.
 *    Equips from GearHub still route through the home; the picker
 *    remains the one placement surface.
 *  - Both boss-picker entry points render the shared BossPickerList;
 *    both area-picker entry points render the shared AreaPickerList.
 *  - The Fight tab mounts ActionLoadout read-only with a Manage door.
 *  - The Action screen has no private recipe picker (crafting's one
 *    home is the Workshop) and no private area/boss lists.
 *  - Market player tabs carry the lock badge when the market feature
 *    is gated, computed from the same canUseFeature decision.
 *  - Vocabulary: areas are "Areas" (no "Choose Turf" / "Change
 *    Route" UI copy), the crafting home is the "Workshop" (no
 *    "Bench"/"Workbench" labels for it).
 *  - constants/zones.ts stays unreferenced by app code (the dead
 *    parallel system is not built on; only the legacy game test
 *    still imports it).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../..');
const readSource = (rel: string) => readFileSync(resolve(REPO, rel), 'utf8');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('Phase 1 structure — one gear home', () => {
  it('GearHub routes equips through the home; unequip runs the shipped op (audit UX-02)', () => {
    const gearHub = readSource('src/components/gear/GearHub.tsx');
    expect(gearHub).not.toContain('verifiedOps.equipItem');
    expect(gearHub).toContain('onEquipRequest');
    // UX audit UX-02 (2026-11-01): the inspect sheet's reforge copy
    // said "unequip it first" but offered no Unequip. Unequip is a
    // slot operation, not an equip intent, so the sheet runs the
    // shipped verified op directly — the one deliberate exception
    // to this pin's original "never equips itself" wording.
    expect(gearHub).toContain('verifiedOps.unequipSlot');
  });

  it('ChestScreen equips the revealed weapon in place (audit UX-01)', () => {
    const chest = readSource('src/screens/ChestScreen.tsx');
    // The 2026-11-01 UX audit reversed this surface's Phase 1 pin:
    // the "Equip in Gear" button only navigated while claiming to
    // equip (the real equip took 3 more taps). It now equips via
    // the shipped verified op with the loadout panel's undo toast.
    expect(chest).toContain('verifiedOps.equipItem');
    expect(chest).toContain('SwapUndoToast');
    expect(chest).not.toContain("onNavigate?.('inventory')");
    expect(chest).not.toContain('Equip in Gear');
  });

  it('the Fight tab loadout is read-only with a Manage door into the home', () => {
    const action = readSource('src/screens/ActionScreenContextual.tsx');
    expect(action).toContain('<ActionLoadout readOnly');
    // Device-feedback r2 / flow audit F2: the Manage door fires the
    // 'loadout' target so the gear home opens ON its Loadout tab —
    // the bare 'inventory' target deposited the player on the Gear
    // list, one undiscovered tab-switch from the equip surface.
    expect(action).toContain("onManageLoadout={() => onNavigate?.('loadout')}");
    const loadout = readSource('src/components/action/ActionLoadout.tsx');
    expect(loadout).toContain('readOnly');
    // The picker renders only outside read-only mode.
    expect(loadout).toContain('!readOnly && pickerSlot');
  });

  it('client equip calls live only in the gear-home paths', () => {
    const allowed = new Set([
      'src/components/action/ActionLoadout.tsx', // Slot Picker host (gear home)
      'src/components/gear/GaragePanel.tsx', // Phase 2b garage (rendered by the gear home)
      'src/store/slices/loadoutPresetsSlice.ts', // preset apply (rendered by the home)
      'src/lib/api/verifiedOps.ts', // the transport itself
      'src/screens/ActionScreenContextual.tsx', // flow-fix F11: loot-feed inspect Equip — a fresh drop equips from its inspect sheet, per the flow audit's explicit fix
      'src/screens/ChestScreen.tsx', // UX audit UX-01 (2026-11-01): the cache reveal Equip button equips in place + undo — it previously only navigated while claiming to equip
      'src/components/gear/GearHub.tsx', // UX audit UX-02 (2026-11-01): inspect-sheet Unequip only (verifiedOps.unequipSlot) — equips still route through the home's picker
    ]);
    const offenders: string[] = [];
    for (const file of listSourceFiles(resolve(REPO, 'src'))) {
      const rel = file.slice(REPO.length + 1);
      if (rel.includes('/test/') || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
      if (rel.startsWith('src/server/')) continue;
      const src = readFileSync(file, 'utf8');
      if ((src.includes('verifiedOps.equipItem') || src.includes('verifiedOps.unequipSlot')) && !allowed.has(rel)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Phase 1 structure — one boss picker, one area picker', () => {
  it('both boss entry points render the shared BossPickerList', () => {
    expect(readSource('src/components/fight/BossSelectModal.tsx')).toContain('<BossPickerList onSelect={selectBoss} />');
    const action = readSource('src/screens/ActionScreenContextual.tsx');
    expect(action).toContain('<BossPickerList onSelect={(boss) => startPrep(boss)} />');
    // The Action screen no longer carries a private boss list.
    expect(action).not.toContain('Weak: {boss.weaknesses.join');
  });

  it('both area entry points render the shared AreaPickerList', () => {
    const dashboard = readSource('src/screens/DashboardScreen.tsx');
    expect(dashboard).toContain('<AreaPickerList');
    const action = readSource('src/screens/ActionScreenContextual.tsx');
    expect(action).toContain('<AreaPickerList');
    // The Action screen no longer defines a private area card.
    expect(action).not.toContain('const RouteCard');
  });

  it('the persistent current-area chip is on both main play surfaces', () => {
    expect(readSource('src/screens/DashboardScreen.tsx')).toContain('<CurrentAreaChip');
    expect(readSource('src/screens/ActionScreenContextual.tsx')).toContain('<CurrentAreaChip');
  });
});

describe('Phase 1 structure — one crafting home', () => {
  it('the Action screen sends recipe choice to the Workshop instead of a private picker', () => {
    const action = readSource('src/screens/ActionScreenContextual.tsx');
    expect(action).not.toContain('showRecipePicker');
    expect(action).not.toContain('Choose Recipe');
    expect(action).toContain("onNavigate?.('workshop')");
    expect(action).toContain('Open Workshop');
  });

  it('the crafting home is labeled Workshop everywhere', () => {
    const inventory = readSource('src/screens/InventoryScreen.tsx');
    expect(inventory).toContain("'Workshop'");
    expect(inventory).not.toContain("'Bench'");
    const app = readSource('src/App.tsx');
    expect(app).not.toContain("'Workbench'");
  });
});

describe('Phase 1 structure — transact locks on the actions + vocabulary', () => {
  it('market tabs are view-open for every session; the economy lock guards the transact actions', () => {
    const market = readSource('src/screens/MarketScreen.tsx');
    // Guest-visibility law (2026-11-01) supersedes the Phase-1
    // "locks before the tap" tab badges: tabs carry no lock state —
    // the same canUseFeature decision now places the lock on the
    // Buy / List / Cancel actions via the shared transact-lock hook.
    expect(market).not.toContain('tabLocked');
    expect(market).not.toContain('<FeatureGate');
    expect(market).toContain('useEconomyTransactLock');
    const hook = readSource('src/auth/useEconomyTransactLock.tsx');
    expect(hook).toContain("canUseFeature(account, 'market')");
    // The vendor stays ungated (PR #201 shape).
    expect(market).toContain("market.activeTab === 'vendor' && <VendorScreen />");
  });

  it('areas are called Areas in UI copy (no Turf/Route split)', () => {
    const dashboard = readSource('src/screens/DashboardScreen.tsx');
    expect(dashboard).not.toContain('Choose Turf');
    expect(dashboard).not.toContain('switch turf');
    expect(dashboard).toContain('Choose Area');
    const action = readSource('src/screens/ActionScreenContextual.tsx');
    expect(action).not.toContain('Choose Roaming Route');
    expect(action).not.toContain('Change Route');
    expect(action).not.toContain('Active Route');
    expect(action).toContain('Choose Area');
  });

  it('the salvage verb is Salvage on the gear surfaces (resource stays Scrap)', () => {
    const gearHub = readSource('src/components/gear/GearHub.tsx');
    expect(gearHub).toContain('Salvage candidates');
    expect(gearHub).not.toContain('Scrap candidates');
  });

  it('constants/zones.ts stays dead: no app code imports it', () => {
    const importers: string[] = [];
    for (const file of listSourceFiles(resolve(REPO, 'src'))) {
      const rel = file.slice(REPO.length + 1);
      if (rel.startsWith('src/test/phase1Ux')) continue; // this pin file
      const src = readFileSync(file, 'utf8');
      if (/from\s+['"][^'"]*constants\/zones['"]/.test(src)) importers.push(rel);
    }
    // Only the legacy game test still imports it; removal is not
    // this slice, but nothing shipped may build on it.
    expect(importers).toEqual(['src/test/game.test.ts']);
  });
});

describe('Phase 1 structure — presets + offline summary + used-in', () => {
  it('preset management is visible, not long-press only', () => {
    const switcher = readSource('src/components/action/PresetSwitcher.tsx');
    expect(switcher).toContain('data-testid="preset-manage-button"');
    expect(switcher).toContain('Loadout Presets');
    // The long-press shortcut remains, but it is no longer the only path.
    expect(switcher).toContain('onContextMenu');
  });

  it('the offline recap persists and can be re-opened from the Dashboard', () => {
    const slice = readSource('src/store/slices/offlineRecapSlice.ts');
    expect(slice).toContain('reopen');
    expect(slice).toContain('cybercache.offlineRecap.v1');
    // Dashboard-top redesign (2026-11-01) supersedes the reopen
    // strip: the recap's re-entry is now the Dashboard top bar's
    // level button — its pop-up renders the recap card whenever a
    // settlement exists, dismissed or not. The pin follows the
    // surface to its new home.
    const topBar = readSource('src/components/dashboard/DashboardTopBar.tsx');
    expect(topBar).toContain('OfflineRecapCard');
    expect(topBar).toContain('top-level-button');
    const dashboard = readSource('src/screens/DashboardScreen.tsx');
    expect(dashboard).toContain('DashboardTopBar');
    expect(dashboard).not.toContain('offline-recap-reopen');
  });

  it('material "Used in" reads the single recipe source in workshop + market', () => {
    // The single source is now the unified craft catalog
    // (src/content/crafting.ts, migration 0024) — the legacy recipe
    // module remains its consumable subset.
    const recipes = readSource('src/content/crafting.ts');
    expect(recipes).toContain('getAllCraftRecipesUsingMaterial');
    const sheet = readSource('src/components/common/MaterialUsageSheet.tsx');
    expect(sheet).toContain('getAllCraftRecipesUsingMaterial');
    expect(readSource('src/screens/WorkshopScreen.tsx')).toContain('MaterialUsageSheet');
    expect(readSource('src/screens/MarketScreen.tsx')).toContain('MaterialUsageSheet');
    expect(readSource('src/screens/MarketScreen.tsx')).toContain('Used in');
  });
});
