import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const readSource = (relPath: string) => readFileSync(resolve(root, relPath), 'utf8');

describe('ui surface audit', () => {
  it('keeps Action focused on live runtime control instead of workshop / market / cache launchers', () => {
    const actionScreen = readSource('src/screens/ActionScreenContextual.tsx');
    expect(actionScreen).not.toContain("label: 'Workshop'");
    expect(actionScreen).not.toContain("label: 'Market'");
    expect(actionScreen).not.toContain("label: 'Caches'");
    expect(actionScreen).not.toContain('startWorkshop');
    expect(actionScreen).not.toContain('startMarket');
    expect(actionScreen).not.toContain('openCache(');
  });

  it('adds an explicit Dashboard area switch affordance', () => {
    // Wave B: the Board's area panel lives in Home's deck now.
    const dashboard = readSource('src/components/dashboard/DashboardDeck.tsx');
    expect(dashboard).toContain('data-testid="dashboard-turf-switch-button"');
    // Phase 1 vocabulary freeze: areas are "Areas", not "Turf".
    // Audit NAV-01: the one area-switch label is "Change area".
    expect(dashboard).toContain('aria-label="Change area"');
  });

  it('audit NAV-01: one start verb for roaming, one area-switch label', () => {
    const dashboard = readSource('src/components/dashboard/DashboardDeck.tsx');
    const diorama = readSource('src/components/dashboard/LiveTurfDiorama.tsx');
    const areaPicker = readSource('src/components/common/AreaPicker.tsx');
    const actionScreen = readSource('src/screens/ActionScreenContextual.tsx');
    // The rival start verbs are gone; the diorama (Dashboard) and the
    // Action workspace both start roaming as "Start Roam".
    expect(dashboard).not.toContain('Start Wastes Run');
    expect(dashboard).not.toContain('Enter Active Run');
    expect(diorama).not.toContain('Start action');
    expect(diorama).toContain("'Start Roam'");
    expect(actionScreen).toContain("'Start Roam'");
    // The area picker starts roaming under the same verb (was Run/Switch).
    expect(areaPicker).toContain('Start Roam');
    expect(areaPicker).not.toContain("'Run' : 'Switch'");
    // One area-switch label everywhere it is offered.
    expect(actionScreen).toContain("'Change Area'");
    expect(actionScreen).not.toContain("'Switch Area'");
    expect(dashboard).toContain('Tap to change area');
    expect(dashboard).not.toContain('Tap to switch area');
  });
});
