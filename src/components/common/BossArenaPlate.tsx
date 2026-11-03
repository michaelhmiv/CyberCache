/**
 * BossArenaPlate — the prep-size boss identity (356×118 at the 412
 * reference width, full header width). The boss presents itself: its
 * full shipped sprite standing on a band of its own arena painting,
 * name / tier line / weakness chip / named mechanic on a hard scrim,
 * weakness-element strip at the foot, in the panels' clipped-corner
 * plate language. Nothing is drawn or recolored — sprite and arena
 * are the game's shipped art, composed.
 *
 * Production typesetting rule (owner): scrim text stays inside the
 * scrim. The name and tier line are fitted by the measured ladder in
 * bossIdentity.ts (shrink, split at the name's own seams) — never by
 * sliding under the art.
 */
import React, { useEffect, useState } from 'react';
import type { BossDef } from '@/types/boss';
import { ELEMENT_VISUALS } from '@/constants/visualAssets';
import { Element } from '@/types/game';
import {
  bossArt,
  fitPlateName,
  fitPlateTierLine,
  BOSS_PLATE_FRAME,
} from '@/lib/pixel/bossIdentity';

/** Scrim geometry at the reference width (exploration plate, CSS px). */
const SCRIM_WIDTH = 165;
const SCRIM_TEXT_MAX = 142; // 165 - 13 left pad - 10 right pad
const PLATE_FONT = '"Chakra Petch", sans-serif';

interface BossArenaPlateProps {
  boss: BossDef;
  /** Optional chrome overlaid on the plate's top-right (Change Boss). */
  action?: React.ReactNode;
}

export const BossArenaPlate: React.FC<BossArenaPlateProps> = ({ boss, action }) => {
  const art = bossArt(boss.id);
  const element = ELEMENT_VISUALS[boss.weaknesses[0]] ?? ELEMENT_VISUALS[Element.Kinetic];
  // The ladder measures with canvas; before the webfont lands it
  // measures a narrower fallback face and can pick a form that only
  // the CSS ellipsis then contains. The fits are cheap string math,
  // computed per render; a state flip once fonts are ready re-fits
  // them with true metrics so the ladder itself carries the
  // containment (the ellipsis stays as the never-seen backstop).
  const [, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => {
      if (live) setFontsReady(true);
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const nameFit = fitPlateName(boss.name, SCRIM_TEXT_MAX);
  const tierLine = fitPlateTierLine(boss.tier, boss.level, boss.phases.length, SCRIM_TEXT_MAX);

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: '356 / 118',
        border: `2px solid ${BOSS_PLATE_FRAME}`,
        clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)',
        backgroundColor: '#0A0705',
      }}
      data-testid="boss-arena-plate"
    >
      {/* Arena band — the boss's own ground, darkened a step. */}
      {art && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${art.arenaUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: '50% 30%',
            filter: 'brightness(0.8)',
          }}
        />
      )}

      {/* Stepped ground shadow — the sprite's own outline does the
          separation work, as on the fight stage. */}
      <div className="absolute" style={{ left: '73%', bottom: 3, transform: 'translateX(-50%)', width: 150 }}>
        <div style={{ margin: '0 auto', width: 150, height: 13, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.24)' }} />
        <div style={{ margin: '-11px auto 0', width: 110, height: 11, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.31)' }} />
        <div style={{ margin: '-9px auto 0', width: 74, height: 9, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.39)' }} />
      </div>

      {/* The boss itself — full sprite, feet on the plate floor. */}
      {art && (
        <img
          src={art.spriteUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute"
          style={{
            height: '89.8%',
            left: '73%',
            bottom: 6,
            transform: 'translateX(-50%)',
            imageRendering: 'pixelated',
          }}
        />
      )}

      {/* Hard scrim — name, tier line, weakness chip, mechanic. */}
      <div
        className="absolute inset-y-0 left-0"
        style={{
          width: SCRIM_WIDTH,
          backgroundColor: 'rgba(10,7,5,0.86)',
          borderRight: `2px solid ${element.color}`,
        }}
      >
        <div style={{ padding: '10px 10px 8px 13px' }}>
          <div
            style={{
              fontFamily: PLATE_FONT,
              fontSize: nameFit.fontSize,
              fontWeight: 900,
              lineHeight: 1.04,
              color: '#F5EFE6',
              textTransform: 'uppercase',
            }}
          >
            {nameFit.lines.map((line) => (
              <span
                key={line}
                className="block whitespace-nowrap"
                style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {line}
              </span>
            ))}
          </div>
          <div
            style={{
              fontFamily: PLATE_FONT,
              marginTop: 3,
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1.15,
              letterSpacing: '0.04em',
              color: '#C9BBA6',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {tierLine}
          </div>
          <div
            className="inline-flex"
            style={{
              marginTop: 7,
              border: `1.5px solid ${element.color}`,
              backgroundColor: `${element.color}40`,
              color: element.accentColor,
              fontSize: 11,
              fontWeight: 900,
              lineHeight: 1.15,
              letterSpacing: '0.03em',
              padding: '2px 6px',
              whiteSpace: 'nowrap',
            }}
          >
            WEAK: {element.label.toUpperCase()}
          </div>
          <div
            style={{
              marginTop: 7,
              fontSize: 11,
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: '0.04em',
              color: '#968A78',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {boss.mechanic.name}
          </div>
        </div>
      </div>

      {/* Weakness-element strip at the foot. */}
      <div className="absolute inset-x-0 bottom-0" style={{ height: 4, backgroundColor: element.color }} />

      {action && <div className="absolute right-2 top-2 z-10">{action}</div>}
    </div>
  );
};
