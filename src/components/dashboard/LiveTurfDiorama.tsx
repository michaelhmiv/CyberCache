import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Box, ChevronRight, Crosshair, Sparkles } from 'lucide-react';
import { WeaponIllustration } from '@/components/weapon/WeaponIllustration';
import { ELEMENT_PROJECTILE, getLiveTurfScene } from '@/constants/liveTurfVisuals';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { RoamingAreaDef } from '@/constants/roamingAreas';
import type { Weapon } from '@/types/items';

export type LiveTurfFeedEvent = {
  id: string;
  label: string;
  detail: string;
  tone: string;
};

interface LiveTurfDioramaProps {
  area: RoamingAreaDef;
  weapon?: Weapon;
  bossName?: string;
  bossWeaknessCount?: number;
  playerLevel: number;
  equippedCount: number;
  cacheKeys: number;
  feedEvents: LiveTurfFeedEvent[];
  onFight: () => void;
  onSecondary: () => void;
}

const panelClip = {
  clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)',
};

const signClip = {
  clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)',
};

const safeSvgId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '');

const getFallbackManufacturer = (area: RoamingAreaDef) => (
  area.manufacturerInfluence === 'Mixed' ? Manufacturer.Redline : area.manufacturerInfluence
);

const getFallbackWeaponType = (area: RoamingAreaDef) => area.weaponBias[0] ?? WeaponType.Pistol;
const getFallbackElement = (area: RoamingAreaDef) => area.elementBias?.[0] ?? Element.Kinetic;

const getEnemyLabel = (area: RoamingAreaDef, bossName?: string) => {
  if (bossName) return bossName;
  return area.enemyType.split(',')[0] || 'Hostile contact';
};

const isImpactEvent = (event?: LiveTurfFeedEvent) => !!event && event.id !== 'idle-loop-ready';
const isLootLikeEvent = (event?: LiveTurfFeedEvent) => isImpactEvent(event) && ['loot', 'cache', 'cash', 'level'].includes(event.tone);
const isProjectileEvent = (event?: LiveTurfFeedEvent) => isImpactEvent(event) && ['xp', 'loot', 'cache', 'level'].includes(event.tone);

const SceneProps: React.FC<{ prop: string; accent: string; dark: string }> = ({ prop, accent, dark }) => {
  switch (prop) {
    case 'speedway':
      return (
        <g stroke="#000" strokeWidth="4" strokeLinejoin="round">
          <path d="M22 112 L122 92 L133 104 L32 126 Z" fill={dark} opacity="0.72" />
          <path d="M274 105 L388 84 L396 100 L282 122 Z" fill={dark} opacity="0.76" />
          <path d="M304 69 L346 64 L355 90 L313 96 Z" fill={accent} opacity="0.34" />
        </g>
      );
    case 'bastion':
      return (
        <g stroke="#000" strokeWidth="4" strokeLinejoin="round">
          <path d="M26 78 L66 55 L101 75 L96 123 L26 128 Z" fill={dark} opacity="0.78" />
          <path d="M310 72 L378 49 L394 80 L383 126 L312 124 Z" fill={dark} opacity="0.8" />
          <path d="M55 54 L77 43 L98 56" fill="none" stroke={accent} opacity="0.5" />
        </g>
      );
    case 'forge':
      return (
        <g stroke="#000" strokeWidth="4" strokeLinejoin="round">
          <path d="M28 86 L76 70 L101 89 L89 128 L29 129 Z" fill={dark} opacity="0.78" />
          <path d="M314 50 L353 50 L363 128 L302 128 Z" fill={dark} opacity="0.82" />
          <path d="M327 57 L349 57 L352 116 L323 116 Z" fill={accent} opacity="0.32" />
          <path d="M341 43 L352 24 L361 43" fill={accent} opacity="0.5" />
        </g>
      );
    case 'reactor':
      return (
        <g stroke="#000" strokeWidth="4" strokeLinejoin="round">
          <path d="M35 80 L89 63 L119 95 L89 128 L31 126 Z" fill={dark} opacity="0.76" />
          <circle cx="347" cy="86" r="30" fill={accent} opacity="0.22" />
          <circle cx="347" cy="86" r="16" fill={accent} opacity="0.42" />
          <path d="M317 86 L378 86 M347 56 L347 116" stroke={accent} opacity="0.62" />
        </g>
      );
    case 'dumpnet':
      return (
        <g stroke="#000" strokeWidth="4" strokeLinejoin="round">
          <path d="M20 100 L94 70 L124 96 L97 129 L24 129 Z" fill={dark} opacity="0.8" />
          <path d="M295 78 L381 62 L395 119 L307 127 Z" fill={dark} opacity="0.82" />
          <path d="M303 84 L384 68 M311 104 L390 88 M333 73 L337 120 M366 66 L372 113" stroke={accent} opacity="0.5" />
        </g>
      );
    case 'labyrinth':
      return (
        <g stroke="#000" strokeWidth="4" strokeLinejoin="round">
          <path d="M28 72 L78 57 L118 75 L111 129 L32 126 Z" fill={dark} opacity="0.78" />
          <path d="M300 58 L359 43 L390 75 L382 126 L305 128 Z" fill={dark} opacity="0.82" />
          <path d="M309 69 L348 59 L374 81 L369 112 L316 115 Z" fill="none" stroke={accent} opacity="0.58" />
        </g>
      );
    case 'scrap':
    default:
      return (
        <g stroke="#000" strokeWidth="4" strokeLinejoin="round">
          <path d="M24 97 L88 70 L124 96 L94 129 L26 128 Z" fill={dark} opacity="0.76" />
          <path d="M304 85 L378 66 L393 102 L361 128 L306 126 Z" fill={dark} opacity="0.8" />
          <path d="M50 84 L86 74 L98 86 L63 98 Z" fill={accent} opacity="0.34" />
        </g>
      );
  }
};

const RunnerSvg: React.FC<{ accent: string; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ accent, event, reduced }) => {
  const active = isImpactEvent(event) && !reduced;
  return (
    <motion.g
      key={`runner-${active ? event?.id : 'static'}`}
      initial={active ? { x: -3, y: 0, rotate: 0 } : undefined}
      animate={active ? { x: [-3, 4, 0], y: [0, -3, 0], rotate: [0, -1, 0] } : undefined}
      transition={active ? { duration: 0.45, ease: 'easeOut' } : undefined}
      style={{ transformOrigin: '104px 116px' }}
    >
      <ellipse cx="104" cy="150" rx="31" ry="7" fill="#000" opacity="0.45" />
      <path d="M91 86 L118 78 L134 100 L121 130 L91 130 L77 104 Z" fill="#2B2522" stroke="#000" strokeWidth="5" strokeLinejoin="round" />
      <path d="M93 91 L116 85 L128 101 L119 121 L94 123 L84 105 Z" fill={accent} opacity="0.36" stroke="#000" strokeWidth="3" />
      <path d="M92 56 L117 52 L129 66 L124 84 L97 89 L82 75 Z" fill="#B8B0A8" stroke="#000" strokeWidth="5" strokeLinejoin="round" />
      <path d="M98 63 L122 60 L119 72 L96 76 Z" fill="#050608" stroke="#000" strokeWidth="3" />
      <path d="M83 101 L64 119" stroke="#000" strokeWidth="8" strokeLinecap="round" />
      <path d="M119 101 L151 105" stroke="#000" strokeWidth="8" strokeLinecap="round" />
      <path d="M97 129 L86 153" stroke="#000" strokeWidth="8" strokeLinecap="round" />
      <path d="M116 128 L131 151" stroke="#000" strokeWidth="8" strokeLinecap="round" />
      <path d="M72 151 L91 151" stroke={accent} strokeWidth="7" strokeLinecap="round" />
      <path d="M124 151 L145 151" stroke={accent} strokeWidth="7" strokeLinecap="round" />
    </motion.g>
  );
};

const EnemySvg: React.FC<{ color: string; glow: string; boss: boolean; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ color, glow, boss, event, reduced }) => {
  const active = isImpactEvent(event) && !reduced;
  return (
    <motion.g
      key={`enemy-${active ? event?.id : 'static'}`}
      initial={active ? { x: 0, scale: 1 } : undefined}
      animate={active ? { x: [0, 7, 0], scale: [1, 0.98, 1] } : undefined}
      transition={active ? { duration: 0.42, ease: 'easeOut' } : undefined}
      style={{ transformOrigin: '326px 110px' }}
    >
      <ellipse cx="315" cy="151" rx={boss ? 42 : 32} ry="8" fill="#000" opacity="0.48" />
      <path d={boss ? 'M284 76 L326 63 L360 91 L351 133 L301 139 L273 108 Z' : 'M294 90 L326 79 L350 101 L340 133 L303 136 L283 111 Z'} fill="#161116" stroke="#000" strokeWidth="6" strokeLinejoin="round" />
      <path d={boss ? 'M295 86 L326 76 L348 94 L341 124 L305 129 L286 107 Z' : 'M302 97 L325 90 L339 103 L333 124 L308 127 L295 111 Z'} fill={color} opacity="0.6" stroke="#000" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="326" cy="103" r={boss ? 12 : 8} fill={glow} stroke="#000" strokeWidth="3" />
      <path d="M280 113 L256 120 M346 112 L371 120" stroke="#000" strokeWidth="7" strokeLinecap="round" />
      <path d="M302 134 L291 153 M338 133 L351 153" stroke="#000" strokeWidth="7" strokeLinecap="round" />
    </motion.g>
  );
};

const ScrapSvg: React.FC<{ accent: string; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ accent, event, reduced }) => {
  if (!isLootLikeEvent(event)) return null;
  return (
    <motion.g
      key={`scrap-${event?.id}`}
      initial={reduced ? undefined : { y: 8, opacity: 0, scale: 0.86 }}
      animate={reduced ? undefined : { y: [8, -10, -4], opacity: [0, 1, 0.92], scale: [0.86, 1.08, 1] }}
      transition={reduced ? undefined : { duration: 0.62, ease: 'easeOut' }}
    >
      <path d="M199 134 L214 130 L226 140 L215 151 L198 148 Z" fill="#A5A7B5" stroke="#000" strokeWidth="4" />
      <path d="M223 122 L236 125 L235 141 L220 139 Z" fill={accent} opacity="0.78" stroke="#000" strokeWidth="3" />
      <path d="M204 119 L212 111 L219 121 L212 129 Z" fill="#F5F5F5" opacity="0.62" stroke="#000" strokeWidth="2" />
    </motion.g>
  );
};

const ProjectileTape: React.FC<{ projectile: { color: string; glow: string }; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ projectile, event, reduced }) => {
  if (!isProjectileEvent(event)) return null;
  return (
    <motion.g
      key={`projectile-${event?.id}`}
      initial={reduced ? undefined : { opacity: 0, x: -8 }}
      animate={reduced ? undefined : { opacity: [0, 1, 0], x: [-8, 18, 34] }}
      transition={reduced ? undefined : { duration: 0.48, ease: 'linear' }}
    >
      <path d="M162 106 L260 105" stroke="#000" strokeWidth="9" strokeLinecap="round" opacity="0.55" />
      <path d="M162 106 L260 105" stroke={projectile.color} strokeWidth="4" strokeLinecap="round" />
      <circle cx="265" cy="105" r="7" fill={projectile.glow} stroke="#000" strokeWidth="3" />
    </motion.g>
  );
};

export const LiveTurfDiorama: React.FC<LiveTurfDioramaProps> = ({
  area,
  weapon,
  bossName,
  bossWeaknessCount = 0,
  playerLevel,
  equippedCount,
  cacheKeys,
  feedEvents,
  onFight,
  onSecondary,
}) => {
  const reduced = !!useReducedMotion();
  const scene = getLiveTurfScene(area);
  const safeId = safeSvgId(`${scene.id}-${weapon?.id ?? 'fallback'}`);
  const element = weapon?.element ?? getFallbackElement(area);
  const projectile = ELEMENT_PROJECTILE[element];
  const fallbackManufacturer = getFallbackManufacturer(area);
  const fallbackWeaponType = getFallbackWeaponType(area);
  const latestEvent = feedEvents[0];
  const eventActive = isImpactEvent(latestEvent);
  const enemyLabel = getEnemyLabel(area, bossName);
  const title = bossName ?? area.name;
  const secondaryLabel = bossName ? 'Prep boss' : 'Open cache';
  const secondaryDetail = bossName ? `${bossWeaknessCount} weakness tags` : `${cacheKeys} keys ready`;
  const weaponLabel = weapon
    ? `${weapon.rarity} ${weapon.element} ${weapon.weaponType}`
    : `${area.manufacturerInfluence} patrol kit`;
  const motionCaption = latestEvent ? `${latestEvent.label} ${latestEvent.detail}` : `standing by against ${enemyLabel}`;
  const targetMode = latestEvent ? 'event' : 'target';

  return (
    <section className="relative h-[248px] overflow-hidden border-2 border-border bg-bg shadow-[0_10px_22px_rgba(0,0,0,0.6)]" style={panelClip}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 420 248" role="img" aria-label={`${title} event-driven activity visualization`}>
        <defs>
          <linearGradient id={`sky-${safeId}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={scene.skyTop} />
            <stop offset="54%" stopColor={scene.skyBottom} />
            <stop offset="100%" stopColor="#050608" />
          </linearGradient>
          <linearGradient id={`ground-${safeId}`} x1="0" x2="1">
            <stop offset="0%" stopColor={scene.groundDark} />
            <stop offset="48%" stopColor={scene.ground} />
            <stop offset="100%" stopColor={scene.groundDark} />
          </linearGradient>
          <filter id={`soft-glow-${safeId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={scene.accent} floodOpacity="0.55" />
          </filter>
        </defs>
        <rect width="420" height="248" fill={`url(#sky-${safeId})`} />
        <path d="M0 83 C54 65 86 73 140 57 C201 39 248 61 312 45 C359 34 392 41 420 31 L420 149 L0 149 Z" fill={scene.horizon} opacity="0.18" />
        <path d="M0 103 C61 83 96 96 150 78 C215 57 260 84 319 65 C364 51 392 57 420 47 L420 151 L0 151 Z" fill="#000" opacity="0.2" />
        <SceneProps prop={scene.prop} accent={scene.accent} dark={scene.groundDark} />
        <path d="M0 143 L58 136 L96 145 L155 135 L210 145 L277 137 L339 145 L420 134 L420 248 L0 248 Z" fill={`url(#ground-${safeId})`} stroke="#000" strokeWidth="5" />
        <path d="M20 165 L106 154 L179 162 L258 153 L397 161" fill="none" stroke="#000" strokeWidth="5" opacity="0.42" />
        <ProjectileTape projectile={projectile} event={latestEvent} reduced={reduced} />
        <ScrapSvg accent={scene.accent} event={latestEvent} reduced={reduced} />
        <RunnerSvg accent={scene.accent} event={latestEvent} reduced={reduced} />
        <EnemySvg color={scene.enemyColor} glow={scene.enemyGlow} boss={!!bossName} event={latestEvent} reduced={reduced} />
        <g filter={`url(#soft-glow-${safeId})`}>
          <path d="M12 18 L115 18 L128 31 L121 46 L12 46 Z" fill="#050608" opacity="0.84" stroke="#000" strokeWidth="4" />
          <text x="22" y="36" fill={scene.accent} fontSize="15" fontWeight="900">LIVE TURF</text>
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
        <div className="min-w-0 border-2 border-border bg-surface/90 px-2 py-1.5 shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}>
          <div className="truncate bl-title text-2xl leading-none text-text-primary">{title}</div>
          <div className="truncate text-[8px] font-black uppercase tracking-[0.18em] text-text-muted">{bossName ? 'marked boss tape' : scene.mood}</div>
        </div>
        <div className="shrink-0 border-2 border-border bg-bg/85 px-2 py-1 text-right shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}>
          <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">LV {playerLevel}</div>
          <div className="text-xs font-black text-amber">{equippedCount}/7 gear</div>
        </div>
      </div>

      <motion.div
        className="pointer-events-none absolute left-[82px] top-[108px] z-10 -rotate-6"
        key={`weapon-${eventActive ? latestEvent?.id : 'static'}`}
        initial={eventActive && !reduced ? { x: -2, y: 0 } : undefined}
        animate={eventActive && !reduced ? { x: [-2, 3, 0], y: [0, -2, 0] } : undefined}
        transition={eventActive && !reduced ? { duration: 0.44, ease: 'easeOut' } : undefined}
      >
        <WeaponIllustration
          weapon={weapon}
          type={fallbackWeaponType}
          manufacturer={fallbackManufacturer}
          element={element}
          rarity={weapon?.rarity ?? Rarity.Common}
          visualSeed={weapon?.pixelSeed ?? area.unlockLevel + 17}
          size={106}
          showBadges={false}
          animate={false}
        />
      </motion.div>

      <div className="pointer-events-none absolute bottom-[44px] left-2 right-2 grid grid-cols-[1fr_auto] gap-2">
        <div className="min-w-0 border-2 border-border bg-bg/88 px-2 py-1.5 shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}>
          <div className="truncate text-[9px] font-black uppercase tracking-wide text-text-primary">{weaponLabel}</div>
          <div className="truncate text-[8px] text-text-muted">{motionCaption}</div>
        </div>
        <div className="flex items-center gap-1.5 border-2 border-border bg-surface/90 px-2 py-1.5 shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}>
          {latestEvent ? <Sparkles size={13} className="text-amber" /> : <Crosshair size={13} className="text-red" />}
          <div>
            <div className="text-[8px] font-black uppercase tracking-wide text-text-muted">{targetMode}</div>
            <div className="max-w-[92px] truncate text-[9px] font-black text-red">{latestEvent ? latestEvent.tone : enemyLabel}</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 grid grid-cols-2 border-t-2 border-border bg-surface/95 text-[9px]">
        <button type="button" onClick={onFight} className="flex items-center justify-between gap-2 border-r border-border px-3 py-2 text-left active:bg-red/10">
          <span>
            <span className="block font-black uppercase tracking-wide text-red">Start run</span>
            <span className="block truncate text-text-muted">{area.enemyType}</span>
          </span>
          <Crosshair size={14} className="shrink-0 text-red" />
        </button>
        <button type="button" onClick={onSecondary} className="flex items-center justify-between gap-2 px-3 py-2 text-left active:bg-amber/10">
          <span>
            <span className="block font-black uppercase tracking-wide text-amber">{secondaryLabel}</span>
            <span className="block truncate text-text-muted">{secondaryDetail}</span>
          </span>
          {bossName ? <ChevronRight size={14} className="shrink-0 text-amber" /> : <Box size={14} className="shrink-0 text-amber" />}
        </button>
      </div>
    </section>
  );
};
