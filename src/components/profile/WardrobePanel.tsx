/**
 * WardrobePanel — the Hunter tab's wardrobe as a FITTING CONSOLE
 * (Instrument Panel register — owner pick B for this page,
 * 2026-11-05), refitted for whole skins by the Cache Hunters
 * reshape (slice (b); DESIGN.md §12 ruling item 3).
 *
 * What changed: the subject. The console no longer fits skin
 * PARTS on a segmented rig — a skin is one painted whole for the
 * fielded hunter, worn whole or not at all. The console head
 * reads the fielded hunter and the whole-skin counts; the bay
 * lists the hunter's skins with Wear / Remove; the viewport
 * below seats their painting under the same measurement glass
 * the rig used — the list leads since the 2026-11-17
 * first-screen pass put the stop's only action (Wear) ahead of
 * its preview. No part-wearing surface remains on this stop
 * (brief check B3) — parts are collection pieces now, and their
 * catalog lives on in Collections until slice (d) converts
 * complete sets.
 *
 * Wearing is a device-local selection at this slice (the worn
 * choice is presentation state, like the head-variant preference
 * before it): skins are pure cosmetic, so no server record and no
 * sign-in gate — guests browse AND wear with the same real data
 * (Guest Visibility Law; brief check B5). Crafted skins arrive
 * with slice (d) and bring their ownership record with them.
 */
import React from 'react';
import { usePlayerStore, useSkillStore } from '@/store';
import { hunterById } from '@/lib/hunters/hunters';
import {
  isSkinOwned,
  skinsForHunter,
  skinById,
  wardrobeCountsForHunter,
} from '@/lib/hunters/hunterSkins';
import { useHunterWardrobeStore, wornSkinSpriteId } from '@/store/slices/hunterWardrobeSlice';
import { getPixelSprite } from '@/lib/pixel/manifest';
import {
  BayButton,
  LcdWell,
  Led,
  LedMeter,
  Panel,
  PanelLabel,
  PushButton,
  Readout,
} from './wardrobeConsoleKit';
import {
  AMBER,
  FAINT,
  GREEN,
  INK,
  MUT,
  STEEL_DARK,
  headStyle,
  monoStyle,
} from './wardrobeConsoleTokens';

export const WardrobePanel: React.FC = () => {
  const player = usePlayerStore();
  const skillStore = useSkillStore();
  const wornByHunter = useHunterWardrobeStore((s) => s.wornByHunter);
  const wearSkin = useHunterWardrobeStore((s) => s.wearSkin);
  const removeSkin = useHunterWardrobeStore((s) => s.removeSkin);

  const hunter = hunterById(skillStore.activeHunterId);
  const skins = skinsForHunter(hunter.id);
  const counts = wardrobeCountsForHunter(hunter.id, wornByHunter[hunter.id]);
  const wornSkin = skinById(wornByHunter[hunter.id]);
  const showcaseSpriteId = wornSkinSpriteId(wornByHunter, hunter.id);
  const showcase = getPixelSprite(showcaseSpriteId);

  return (
    <div className="space-y-3" data-testid="wardrobe-console">
      {/* ── CONSOLE HEAD ─────────────────────────────────────────── */}
      <Panel testId="wardrobe-console-head">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] font-bold uppercase" style={{ ...monoStyle, color: MUT }}>
            {hunter.name} · {String(hunter.tree)} · LV {player.level}
          </div>
          <span className="flex items-center gap-1.5">
            <Led lit color={GREEN} />
            <span className="text-[11px] font-black uppercase" style={{ ...monoStyle, color: GREEN, letterSpacing: '0.1em' }}>
              Cosmetic only
            </span>
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <LcdWell value={String(counts.worn)} label="Worn" valueSize={20} />
          <LcdWell value={String(counts.owned)} label="Owned" valueSize={20} />
          <LcdWell value={String(skins.length)} label="Catalog" valueSize={20} />
        </div>
      </Panel>

      {/* ── WHOLE SKINS ──────────────────────────────────────────── */}
      <Panel testId="wardrobe-skins">
        <PanelLabel label="Whole skins" right={`${counts.owned} owned`} />
        <div data-testid="wardrobe-owned">
          {skins.map((skin, idx) => {
            const owned = isSkinOwned(skin);
            const worn = wornSkin?.id === skin.id;
            const sprite = getPixelSprite(skin.spriteId);
            return (
              <div
                key={skin.id}
                data-testid={`wardrobe-skin-${skin.id}`}
                className="flex items-center gap-3 py-2"
                style={idx > 0 ? { borderTop: '1px solid rgba(58,52,43,0.55)' } : undefined}
              >
                {sprite && (
                  <img
                    src={sprite.url}
                    alt=""
                    aria-hidden="true"
                    className="h-[56px] w-auto shrink-0 select-none"
                    style={{ imageRendering: 'pixelated' }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] uppercase" style={{ ...headStyle, color: INK }}>
                      {skin.name}
                    </span>
                    {worn && (
                      <span
                        className="px-1.5 py-0.5 text-[11px] font-black uppercase leading-none"
                        style={{ backgroundColor: AMBER, color: '#140B02', border: '1.5px solid #000' }}
                      >
                        Worn
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] font-bold uppercase" style={{ ...monoStyle, color: FAINT }}>
                    {hunter.name} · {owned ? 'Owned' : 'Not owned'}
                  </div>
                </div>
                {worn ? (
                  <BayButton testId={`wardrobe-remove-${skin.id}`} onClick={() => removeSkin(hunter.id)}>
                    Remove
                  </BayButton>
                ) : (
                  <div className="w-[104px] shrink-0">
                    <PushButton
                      armed={owned}
                      disabled={!owned}
                      testId={`wardrobe-wear-${skin.id}`}
                      onClick={() => wearSkin(hunter.id, skin.id)}
                    >
                      Wear
                    </PushButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-[11px] font-bold uppercase leading-relaxed" style={{ ...monoStyle, color: FAINT }}>
          Skin parts — collection pieces now, no longer worn
        </div>
      </Panel>

      {/* ── SHOWCASE — the fielded hunter's painting ─────────────── */}
      <Panel testId="wardrobe-rig">
        <PanelLabel
          label="Painting — live"
          right={wornSkin ? wornSkin.name.toUpperCase() : 'BASE'}
          rightColor={wornSkin ? AMBER : FAINT}
        />
        <div
          className="relative overflow-hidden"
          style={{
            border: `1px solid ${STEEL_DARK}`,
            background: 'linear-gradient(180deg, #050403 0%, #0A0806 100%)',
            boxShadow: 'inset 0 2px 9px rgba(0,0,0,0.9)',
          }}
          data-testid="wardrobe-showcase"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, rgba(245,239,230,0.03) 0px, rgba(245,239,230,0.03) 1px, transparent 1px, transparent 3px)',
            }}
          />
          {/* Measurement ticks seated on the viewport's top edge. */}
          <div aria-hidden="true" className="absolute inset-x-3 top-0 z-10 flex justify-between">
            {Array.from({ length: 11 }, (_, i) => (
              <span key={i} style={{ width: 1, height: i % 5 === 0 ? 9 : 5, backgroundColor: 'rgba(201,187,166,0.4)' }} />
            ))}
          </div>
          <div className="flex h-[264px] items-end justify-center">
            {showcase && (
              <img
                src={showcase.url}
                alt={hunter.name}
                data-testid="wardrobe-showcase-painting"
                className="h-[248px] w-auto select-none"
                style={{ imageRendering: 'pixelated' }}
              />
            )}
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Readout label="Worn skin" value={wornSkin ? wornSkin.name : 'None — base painting'} valueColor={wornSkin ? INK : FAINT} />
          <Readout label="Hunter" value={hunter.name} />
        </div>
        <div className="mt-2.5">
          <LedMeter filled={counts.worn} total={Math.max(1, counts.owned)} color={MUT} height={10} />
        </div>
      </Panel>
    </div>
  );
};
