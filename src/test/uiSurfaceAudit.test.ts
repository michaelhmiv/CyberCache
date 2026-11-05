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

  it('adds an explicit Home area switch affordance', () => {
    // Wave C: the deck's Choose Area panel is gone — the stage's
    // mode rail carried the area stop (DESIGN.md §2/§4), and the
    // stage's slim area plate was the second door (drift-fix F2;
    // the CurrentAreaChip before it). Owner ruling 2026-11-04:
    // the rail's separate Area stop is GONE — Roam IS the area
    // door (entering roam auto-opens the one area picker;
    // tapping Roam while roaming opens it alone), and the
    // workspace panels' Change Area buttons are the second door.
    const rail = readSource('src/components/action/HomeModeRail.tsx');
    const actionScreen = readSource('src/screens/ActionScreenContextual.tsx');
    expect(actionScreen).toContain('<HomeModeRail');
    expect(rail).toContain('mode-rail-');
    // No Area stop remains on the rail…
    expect(rail).not.toContain("stop: 'area'");
    expect(rail).not.toContain("'Change area'");
    // …and the Roam stop's accessible name carries the area choice.
    expect(rail).toContain('choose the area');
    // The rail handler wires Roam to the picker (owner model).
    expect(actionScreen).toContain('setShowAreaSelect(true)');
  });

  it('audit NAV-01: one start verb for roaming, one area-switch label', () => {
    const dashboard = readSource('src/components/dashboard/DashboardDeck.tsx');
    const diorama = readSource('src/components/dashboard/LiveTurfDiorama.tsx');
    const areaPicker = readSource('src/components/common/AreaPicker.tsx');
    const actionScreen = readSource('src/screens/ActionScreenContextual.tsx');
    // The rival start verbs are gone. Drift-fix F2: the stage
    // carries NO start door at all (its in-stage action bar is
    // retired) — the one start verb lives in the Action
    // workspace's standby panel, as "Start Roam".
    expect(dashboard).not.toContain('Start Wastes Run');
    expect(dashboard).not.toContain('Enter Active Run');
    expect(diorama).not.toContain('Start action');
    expect(diorama).not.toContain('Start Roam');
    expect(actionScreen).toContain('home-standby-panel');
    expect(actionScreen).toContain('Start Roam');
    // The area picker starts roaming under the same verb (was Run/Switch).
    expect(areaPicker).toContain('Start Roam');
    expect(areaPicker).not.toContain("'Run' : 'Switch'");
    // One area-switch label everywhere it is offered.
    expect(actionScreen).toContain('Change Area');
    expect(actionScreen).not.toContain("'Switch Area'");
    // Wave C: the deck's "Tap to change area" panel is gone; the
    // frozen label rode the mode rail's Area stop until the
    // owner ruling of 2026-11-04 removed that stop — the label
    // now lives on the workspace panels' Change Area buttons
    // (asserted just above), and the rail carries no area label
    // of its own: Roam is the area door.
    const rail = readSource('src/components/action/HomeModeRail.tsx');
    expect(rail).not.toContain("'Change area'");
    expect(rail).not.toContain('Switch area');
    expect(dashboard).not.toContain('Tap to switch area');
  });
});
