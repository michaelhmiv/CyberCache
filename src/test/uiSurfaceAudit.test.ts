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
    const dashboard = readSource('src/screens/DashboardScreen.tsx');
    expect(dashboard).toContain('data-testid="dashboard-turf-switch-button"');
    // Phase 1 vocabulary freeze: areas are "Areas", not "Turf".
    expect(dashboard).toContain('aria-label="Switch area"');
  });
});
