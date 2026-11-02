/**
 * HunterPortrait (skins slice, 0053) — a ResolvedLook rendered as
 * a still portrait: the parts actor standing in a relative box.
 * Used by the Hunter showcase, Standings rows, and market listing
 * cards so a hunter's worn parts read identically everywhere.
 * Pure render: the look comes from lookResolution over server
 * records; this component owns no state.
 */
import React from 'react';
import { PixelPartsActor } from './PixelPartsActor';
import type { ResolvedLook } from '@/lib/pixel/lookResolution';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';

export const HunterPortrait: React.FC<{
  look: ResolvedLook;
  /** The hunter's actual equipped weapon, when the surface has it. */
  weaponInput?: PixelWeaponInput;
  className?: string;
  testId?: string;
}> = ({ look, weaponInput, className = 'h-28', testId }) => (
  <div
    className={`relative overflow-hidden ${className}`}
    data-testid={testId}
    data-look-set={look.set.id}
  >
    <PixelPartsActor
      set={look.set}
      partPalettes={look.partPalettes}
      xPct={50}
      heightPct={94}
      groundY={0.97}
      reduced
      pose={weaponInput ? 'idle' : 'relaxed'}
      weaponInput={weaponInput}
      testId={testId ? `${testId}-actor` : undefined}
    />
  </div>
);
