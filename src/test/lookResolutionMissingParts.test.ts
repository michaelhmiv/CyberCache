/**
 * HTR-09 — a worn cosmetic part that fails to resolve used to fall
 * back to Standard Issue on every stage with no signal anywhere,
 * while the Wardrobe kept reporting it "Worn".
 *
 * The audit's CI assertion: "resolveOwnLook with a missing part id
 * must expose a non-empty missingParts signal." ResolvedLook now
 * carries missingParts (item ids the selection references but the
 * parts map lacks; part ids with no catalog def or a def for a
 * different slot), and resolution warns on the console when the
 * list is non-empty. Rendering behavior is unchanged — the misses
 * still render as Standard Issue, asserted below.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOwnLook } from '@/lib/pixel/lookResolution';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import { SKIN_PART_DEFS } from '@/lib/pixel/skinParts';
import type { CosmeticPartItemView } from '@/content/skins';

const wornItem: CosmeticPartItemView = {
  id: 'item-1', partId: 'bulwark-torso', slot: 'torso', setId: 'bulwark',
  tier: 'shaped', name: 'Bulwark Siege Torso', quality: 90,
  tintPaletteId: null, runtimeState: 'available',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('look resolution exposes its misses (audit HTR-09)', () => {
  it('an equipped item the parts map does not hold is reported, and still renders stock', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const look = resolveOwnLook({
      selection: { equipped: { torso: 'item-ghost' }, headVariant: 'visor' },
      partsById: new Map(),
      fallbackHeadVariant: 'visor',
    });
    expect(look.missingParts).toContain('item-ghost');
    expect(look.missingParts.length).toBeGreaterThan(0);
    // Rendering behavior unchanged: the slot fell back to stock.
    expect(look.set).toBe(STANDARD_ISSUE);
    expect(warn).toHaveBeenCalled();
  });

  it('a part whose def belongs to another slot is reported by part id', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const look = resolveOwnLook({
      // bulwark-torso is a torso def; wearing it as the head part
      // cannot resolve.
      selection: { equipped: { head: 'item-1' }, headVariant: 'visor' },
      partsById: new Map([['item-1', wornItem]]),
      fallbackHeadVariant: 'visor',
    });
    expect(look.missingParts).toContain('bulwark-torso');
    expect(look.set.parts.head?.spriteId).toBe(STANDARD_ISSUE.parts.head?.spriteId);
  });

  it('a healthy worn part resolves with an empty miss list and no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const look = resolveOwnLook({
      selection: { equipped: { torso: 'item-1' }, headVariant: 'visor' },
      partsById: new Map([['item-1', wornItem]]),
      fallbackHeadVariant: 'visor',
    });
    expect(look.missingParts).toEqual([]);
    expect(look.set.parts.torso?.spriteId).toBe(SKIN_PART_DEFS['bulwark-torso'].spriteId);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an empty selection reports no misses', () => {
    const look = resolveOwnLook({ selection: null, partsById: new Map(), fallbackHeadVariant: 'visor' });
    expect(look.missingParts).toEqual([]);
    expect(look.set).toBe(STANDARD_ISSUE);
  });
});
