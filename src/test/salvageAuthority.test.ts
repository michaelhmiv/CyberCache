import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gearHubSource = readFileSync(resolve(process.cwd(), 'src/components/gear/GearHub.tsx'), 'utf8');

describe('salvage authority', () => {
  it('keeps GearHub salvage on the verified RPC path', () => {
    expect(gearHubSource).toContain('verifiedOps.recycleItem');
    expect(gearHubSource).not.toContain('inventory.scrapItem');
    expect(gearHubSource).not.toContain('player.addScrap');
    expect(gearHubSource).not.toContain('player.addMaterial');
    expect(gearHubSource).not.toContain('player.addEssence');
  });
});
