import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Box, ChevronDown, Crosshair, Sparkles } from 'lucide-react';
import { WeaponIllustration } from '@/components/weapon/WeaponIllustration';
import { CharacterStatBar } from '@/components/stats/CharacterStatBar';
import { ELEMENT_PROJECTILE, getLiveTurfScene } from '@/constants/liveTurfVisuals';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { useLoadoutStore, usePlayerStore, useSkillStore, useTickFeedStore } from '@/store';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { BossDef } from '@/types/boss';
import type { RoamingAreaDef } from '@/constants/roamingAreas';
import type { Weapon } from '@/types/items';
import type { ActivityKind } from '@/types/activity';
import type { CharacterStatSummary } from '@/lib/stats/characterStats';
import type { TickEvent } from '@/store/slices/tickSlice';

export type LiveTurfFeedEvent = TickEvent;

type DioramaMode = 'idle' | 'roaming' | 'bossPrep' | 'bossFight' | 'crafting' | 'salvaging' | 'workshopService' | 'marketListing';

interface LiveTurfDioramaProps {
  area: RoamingAreaDef;
  weapon?: Weapon;
  bossName?: string;
  bossWeaknessCount?: number;
  /**
   * Full boss object, when a boss is being prepped. When set, the stat
   * summary's DPS metric switches to boss-relative (computeLoadoutDps with
   * the boss's weaknesses applied) and the detail label switches to
   * "vs {boss.name} ({weakness})".
   */
  boss?: BossDef;
  playerLevel: number;
  equippedCount: number;
  cacheKeys: number;
  activityKind?: ActivityKind;
  activityLabel?: string;
  activityTarget?: string | null;
  statSummary?: CharacterStatSummary;
  onFight: () => void;
  onSecondary: () => void;
  onTitleClick?: () => void;
  primaryActionLabel?: string;
  primaryActionDetail?: string;
  secondaryActionLabel?: string;
  secondaryActionDetail?: string;
}

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };
const safeSvgId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '');
const fallbackMaker = (area: RoamingAreaDef) => area.manufacturerInfluence === 'Mixed' ? Manufacturer.Redline : area.manufacturerInfluence;
const fallbackType = (area: RoamingAreaDef) => area.weaponBias[0] ?? WeaponType.Pistol;
const fallbackElement = (area: RoamingAreaDef) => area.elementBias?.[0] ?? Element.Kinetic;
const enemyLabel = (area: RoamingAreaDef, bossName?: string) => bossName ?? area.enemyType.split(',')[0] ?? 'Target contact';
const isImpact = (event?: LiveTurfFeedEvent): event is LiveTurfFeedEvent => !!event && event.id !== 'idle-loop-ready';
const isLootLike = (event: LiveTurfFeedEvent | undefined): boolean => {
  if (!isImpact(event)) return false;
  return event.tone === 'loot' || event.tone === 'cache' || event.tone === 'cash' || event.tone === 'level';
};

const modeFromActivity = (kind?: ActivityKind): DioramaMode => {
  if (kind === 'roaming_loot') return 'roaming';
  if (kind === 'boss_prep') return 'bossPrep';
  if (kind === 'boss_fight') return 'bossFight';
  if (kind === 'crafting') return 'crafting';
  if (kind === 'salvaging') return 'salvaging';
  if (kind === 'workshop_service') return 'workshopService';
  if (kind === 'market_listing') return 'marketListing';
  return 'idle';
};

const modeInfo: Record<DioramaMode, { label: string; caption: string; status: string }> = {
  idle: { label: 'Standby', caption: 'runner parked at camp', status: 'READY' },
  roaming: { label: 'Roaming', caption: 'scanning turf for real drops', status: 'ROUTE' },
  bossPrep: { label: 'Boss prep', caption: 'checking counters and gear tape', status: 'PREP' },
  bossFight: { label: 'Boss fight', caption: 'resolving boss encounter', status: 'FIGHT' },
  crafting: { label: 'Crafting', caption: 'bench dispatch in progress', status: 'BENCH' },
  salvaging: { label: 'Salvaging', caption: 'gear broken into scrap', status: 'SCRAP' },
  workshopService: { label: 'Workshop', caption: 'servicing queued machines', status: 'SHOP' },
  marketListing: { label: 'Market', caption: 'working the trade kiosk', status: 'TRADE' },
};

const SceneProps: React.FC<{ prop: string; accent: string; dark: string }> = ({ prop, accent, dark }) => {
  const foreground = prop === 'reactor'
    ? <><circle cx="348" cy="88" r="30" fill={accent} opacity="0.22" /><circle cx="348" cy="88" r="15" fill={accent} opacity="0.42" /></>
    : prop === 'forge'
      ? <><path d="M316 50 L356 50 L365 128 L302 128 Z" fill={dark} opacity="0.84" /><path d="M341 43 L352 24 L361 43" fill={accent} opacity="0.55" /></>
      : prop === 'dumpnet'
        ? <path d="M302 82 L386 64 M310 104 L392 86 M333 73 L337 122 M366 66 L372 115" stroke={accent} opacity="0.5" />
        : <path d="M50 84 L86 74 L98 86 L63 98 Z" fill={accent} opacity="0.34" />;
  return <g stroke="#000" strokeWidth="4" strokeLinejoin="round"><path d="M24 98 L88 70 L124 96 L94 129 L26 128 Z" fill={dark} opacity="0.78" /><path d="M304 84 L378 66 L393 103 L361 128 L306 126 Z" fill={dark} opacity="0.8" />{foreground}</g>;
};

const ActivityProp: React.FC<{ mode: DioramaMode; accent: string; dark: string; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ mode, accent, dark, event, reduced }) => {
  const pulse = isImpact(event) && !reduced;
  if (mode === 'crafting' || mode === 'workshopService') return <g stroke="#000" strokeLinejoin="round"><path d="M184 132 L264 124 L279 143 L197 154 Z" fill={dark} strokeWidth="5" /><path d="M199 110 L249 104 L259 126 L190 134 Z" fill="#1B1B20" strokeWidth="4" /><motion.g animate={pulse ? { opacity: [0, 1, 0], scale: [0.6, 1.2, 0.8] } : { opacity: 0.38 }}><path d="M224 101 L224 86 M214 105 L203 94 M236 103 L249 91" stroke={accent} strokeWidth="3" strokeLinecap="round" /><circle cx="224" cy="102" r="5" fill={accent} /></motion.g></g>;
  if (mode === 'salvaging') return <g stroke="#000" strokeLinejoin="round"><path d="M187 143 L218 126 L259 134 L276 153 L229 164 Z" fill={dark} strokeWidth="5" /><path d="M202 136 L230 123 L255 134 L225 148 Z" fill="#A5A7B5" strokeWidth="4" /><motion.g animate={pulse ? { opacity: [0, 1, 0], x: [-4, 4, 8] } : { opacity: 0.42 }}><path d="M224 132 L244 113 M226 137 L250 128 M216 126 L200 114" stroke="#FFEA3A" strokeWidth="3" strokeLinecap="round" /></motion.g></g>;
  if (mode === 'bossPrep') return <g stroke="#000" strokeLinejoin="round"><path d="M197 75 L284 66 L291 132 L202 141 Z" fill="#161116" strokeWidth="5" /><path d="M208 84 L275 78 L280 123 L212 130 Z" fill={dark} strokeWidth="3" /><path d="M221 96 L264 91 M221 108 L270 103 M221 120 L251 116" stroke={accent} strokeWidth="3" strokeLinecap="round" /><circle cx="211" cy="96" r="4" fill="#FF4B5C" /><circle cx="211" cy="108" r="4" fill="#7CFC00" /><circle cx="211" cy="120" r="4" fill="#FF9000" /></g>;
  if (mode === 'marketListing') return <g stroke="#000" strokeLinejoin="round"><path d="M189 104 L258 94 L282 122 L270 154 L195 160 L176 130 Z" fill={dark} strokeWidth="5" /><path d="M201 111 L253 104 L268 122 L257 143 L204 148 L191 128 Z" fill="#111318" strokeWidth="3" /><path d="M211 119 L245 115 M211 131 L257 126" stroke={accent} strokeWidth="3" strokeLinecap="round" /></g>;
  return null;
};

const RunnerSvg: React.FC<{ accent: string; mode: DioramaMode; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ accent, mode, event, reduced }) => {
  const active = isImpact(event) && !reduced;
  const bench = mode === 'crafting' || mode === 'salvaging' || mode === 'workshopService' || mode === 'marketListing';
  const prep = mode === 'bossPrep';
  const leftArm = bench ? 'M83 102 L111 124' : prep ? 'M84 101 L189 92' : mode === 'idle' ? 'M83 101 L72 132' : 'M83 101 L64 119';
  const rightArm = bench ? 'M119 101 L179 123' : prep ? 'M119 101 L184 116' : mode === 'idle' ? 'M119 101 L142 125' : 'M119 101 L151 105';
  const idleMotion = mode === 'roaming' || mode === 'bossFight' ? { x: [0, 5, 0], y: [0, -2, 0] } : { y: [0, -1, 0] };
  return <motion.g animate={reduced ? undefined : active ? { x: [-3, 5, 0], y: [0, -3, 0], rotate: [0, -1, 0] } : idleMotion} transition={reduced ? undefined : active ? { duration: 0.45 } : { duration: 2.8, repeat: Infinity }}><ellipse cx="104" cy="150" rx="31" ry="7" fill="#000" opacity="0.45" /><path d="M91 86 L118 78 L134 100 L121 130 L91 130 L77 104 Z" fill="#2B2522" stroke="#000" strokeWidth="5" strokeLinejoin="round" /><path d="M93 91 L116 85 L128 101 L119 121 L94 123 L84 105 Z" fill={accent} opacity="0.38" stroke="#000" strokeWidth="3" /><path d="M92 56 L117 52 L129 66 L124 84 L97 89 L82 75 Z" fill="#B8B0A8" stroke="#000" strokeWidth="5" strokeLinejoin="round" /><path d="M98 63 L122 60 L119 72 L96 76 Z" fill="#050608" stroke="#000" strokeWidth="3" /><path d={leftArm} stroke="#000" strokeWidth="8" strokeLinecap="round" /><path d={rightArm} stroke="#000" strokeWidth="8" strokeLinecap="round" /><path d="M97 129 L86 153" stroke="#000" strokeWidth="8" strokeLinecap="round" /><path d="M116 128 L131 151" stroke="#000" strokeWidth="8" strokeLinecap="round" /><path d="M72 151 L91 151" stroke={accent} strokeWidth="7" strokeLinecap="round" /><path d="M124 151 L145 151" stroke={accent} strokeWidth="7" strokeLinecap="round" /></motion.g>;
};

const EnemySvg: React.FC<{ color: string; glow: string; boss: boolean; mode: DioramaMode; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ color, glow, boss, mode, event, reduced }) => {
  if (mode !== 'roaming' && mode !== 'bossFight') return null;
  const active = isImpact(event) && !reduced;
  return <motion.g animate={reduced ? undefined : active ? { x: [0, 9, -4, 0], scale: [1, 0.98, 1.02, 1] } : { x: [0, -5, 0], y: [0, 2, 0] }} transition={reduced ? undefined : active ? { duration: 0.48 } : { duration: 2.2, repeat: Infinity }}><ellipse cx="315" cy="151" rx={boss ? 42 : 32} ry="8" fill="#000" opacity="0.48" /><path d={boss ? 'M284 76 L326 63 L360 91 L351 133 L301 139 L273 108 Z' : 'M303 83 L330 78 L350 101 L340 135 L306 138 L287 111 Z'} fill="#161116" stroke="#000" strokeWidth="6" strokeLinejoin="round" /><path d={boss ? 'M295 86 L326 76 L348 94 L341 124 L305 129 L286 107 Z' : 'M306 92 L329 87 L342 103 L335 125 L309 129 L296 112 Z'} fill={color} opacity="0.6" stroke="#000" strokeWidth="3" strokeLinejoin="round" /><circle cx="326" cy="103" r={boss ? 12 : 8} fill={glow} stroke="#000" strokeWidth="3" /></motion.g>;
};

const ScrapSvg: React.FC<{ accent: string; mode: DioramaMode; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ accent, mode, event, reduced }) => {
  if (mode !== 'salvaging' && !isLootLike(event)) return null;
  return <motion.g initial={!reduced && isLootLike(event) ? { y: 8, opacity: 0, scale: 0.86 } : undefined} animate={!reduced && isLootLike(event) ? { y: [8, -10, -4], opacity: [0, 1, 0.92], scale: [0.86, 1.08, 1] } : undefined}><path d="M199 134 L214 130 L226 140 L215 151 L198 148 Z" fill="#A5A7B5" stroke="#000" strokeWidth="4" /><path d="M223 122 L236 125 L235 141 L220 139 Z" fill={accent} opacity="0.78" stroke="#000" strokeWidth="3" /></motion.g>;
};

const ProjectileTape: React.FC<{ projectile: { color: string; glow: string }; mode: DioramaMode; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ projectile, mode, event, reduced }) => {
  if ((mode !== 'roaming' && mode !== 'bossFight') || !isImpact(event)) return null;
  return <motion.g initial={reduced ? undefined : { opacity: 0, x: -8 }} animate={reduced ? undefined : { opacity: [0, 1, 0], x: [-8, 18, 34] }} transition={reduced ? undefined : { duration: 0.48, ease: 'linear' }}><path d="M162 106 L260 105" stroke="#000" strokeWidth="9" strokeLinecap="round" opacity="0.55" /><path d="M162 106 L260 105" stroke={projectile.color} strokeWidth="4" strokeLinecap="round" /><circle cx="265" cy="105" r="7" fill={projectile.glow} stroke="#000" strokeWidth="3" /></motion.g>;
};

export const LiveTurfDiorama: React.FC<LiveTurfDioramaProps> = ({ area, weapon, bossName, bossWeaknessCount = 0, boss, playerLevel, equippedCount, cacheKeys, activityKind = 'idle_standby', activityLabel, activityTarget, statSummary, onFight, onSecondary, onTitleClick, primaryActionLabel, primaryActionDetail, secondaryActionLabel, secondaryActionDetail }) => {
  const reduced = !!useReducedMotion();
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const skills = useSkillStore();
  // Single source of truth: the diorama reads the latest tick event from the
  // shared tick feed store, not from a prop. The animation is a pure read.
  const latestEvent = useTickFeedStore((state) => state.events[0]);
  // The diorama's stat math must use the same weapons as the animation. The
  // animation uses the `weapon` prop (which already falls back to the
  // strongest inventory weapon in the Dashboard), so the stat math needs the
  // same set. We de-dupe by id and lead with the displayed weapon so its
  // contributions show first in the source breakdown.
  const primaryWeapon = loadout.getWeapon('primary');
  const secondaryWeapon = loadout.getWeapon('secondary');
  const heavyWeapon = loadout.getWeapon('heavy');
  const equippedWeapons = [primaryWeapon, secondaryWeapon, heavyWeapon].filter((w): w is Weapon => !!w);
  const weaponIds = new Set(equippedWeapons.map((w) => w.id));
  const statWeapons = weapon && !weaponIds.has(weapon.id)
    ? [weapon, ...equippedWeapons]
    : equippedWeapons.length > 0
      ? equippedWeapons
      : weapon
        ? [weapon]
        : [];
  const computedStats = statSummary ?? buildCharacterStatSummary({ player, weapons: statWeapons, shield: loadout.getShield(), classMod: loadout.getClassMod(), relic: loadout.getRelic(), ordnance: loadout.getOrdnance(), spentSkills: skills.spent, boss });
  const scene = getLiveTurfScene(area);
  const mode = modeFromActivity(activityKind);
  const copy = modeInfo[mode];
  const safeId = safeSvgId(`${scene.id}-${weapon?.id ?? 'fallback'}-${mode}`);
  const element = weapon?.element ?? fallbackElement(area);
  const projectile = ELEMENT_PROJECTILE[element];
  const eventActive = isImpact(latestEvent);
  const title = activityTarget || bossName || area.name;
  const weaponLabel = weapon ? `${weapon.rarity} ${weapon.element} ${weapon.weaponType}` : `${area.manufacturerInfluence} patrol kit`;
  const motionCaption = latestEvent ? `${latestEvent.label} ${latestEvent.detail}` : copy.caption;
  const targetMode = latestEvent ? 'event' : copy.status;
  const primaryLabel = primaryActionLabel ?? (activityKind === 'roaming_loot' ? 'View run' : activityKind === 'idle_standby' || activityKind === 'none' ? 'Start action' : 'Manage action');
  const primaryDetail = primaryActionDetail ?? (activityKind === 'roaming_loot' ? area.enemyType : copy.caption);
  const secondaryLabel = secondaryActionLabel ?? (bossName ? 'Prep boss' : 'Switch');
  const secondaryDetail = secondaryActionDetail ?? (bossName ? `${bossWeaknessCount} weakness tags` : `${cacheKeys} keys ready`);
  const titleBlock = <div className="min-w-0 border-2 border-border bg-surface/90 px-2 py-1.5 text-left shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}><div className="truncate bl-title text-2xl leading-none text-text-primary">{title}</div><div className="truncate text-[8px] font-black uppercase tracking-[0.18em] text-text-muted">{activityLabel || copy.caption}</div></div>;

  return (
    <section className="relative h-[286px] overflow-hidden border-2 border-border bg-bg shadow-[0_10px_22px_rgba(0,0,0,0.6)]" style={panelClip}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 420 286" role="img" aria-label={`${copy.label} activity visualization`}>
        <defs><linearGradient id={`sky-${safeId}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={scene.skyTop} /><stop offset="54%" stopColor={scene.skyBottom} /><stop offset="100%" stopColor="#050608" /></linearGradient><linearGradient id={`ground-${safeId}`} x1="0" x2="1"><stop offset="0%" stopColor={scene.groundDark} /><stop offset="48%" stopColor={scene.ground} /><stop offset="100%" stopColor={scene.groundDark} /></linearGradient><filter id={`soft-glow-${safeId}`} x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={scene.accent} floodOpacity="0.55" /></filter></defs>
        <rect width="420" height="286" fill={`url(#sky-${safeId})`} />
        <path d="M0 83 C54 65 86 73 140 57 C201 39 248 61 312 45 C359 34 392 41 420 31 L420 149 L0 149 Z" fill={scene.horizon} opacity="0.18" />
        <path d="M0 143 L58 136 L96 145 L155 135 L210 145 L277 137 L339 145 L420 134 L420 286 L0 286 Z" fill={`url(#ground-${safeId})`} stroke="#000" strokeWidth="5" />
        <path d="M20 165 L106 154 L179 162 L258 153 L397 161" fill="none" stroke="#000" strokeWidth="5" opacity="0.42" />
        <SceneProps prop={scene.prop} accent={scene.accent} dark={scene.groundDark} />
        <ActivityProp mode={mode} accent={scene.accent} dark={scene.groundDark} event={latestEvent} reduced={reduced} />
        <ProjectileTape projectile={projectile} mode={mode} event={latestEvent} reduced={reduced} />
        <ScrapSvg accent={scene.accent} mode={mode} event={latestEvent} reduced={reduced} />
        <RunnerSvg accent={scene.accent} mode={mode} event={latestEvent} reduced={reduced} />
        <EnemySvg color={scene.enemyColor} glow={scene.enemyGlow} boss={!!bossName || mode === 'bossFight'} mode={mode} event={latestEvent} reduced={reduced} />
        <g filter={`url(#soft-glow-${safeId})`}><path d="M12 18 L135 18 L148 31 L141 46 L12 46 Z" fill="#050608" opacity="0.84" stroke="#000" strokeWidth="4" /><text x="22" y="36" fill={scene.accent} fontSize="15" fontWeight="900">{copy.label.toUpperCase()}</text></g>
      </svg>
      <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2">
        {onTitleClick ? <button type="button" onClick={onTitleClick} className="pointer-events-auto min-w-0 flex-1 active:scale-[0.99]">{titleBlock}</button> : <div className="pointer-events-none min-w-0 flex-1">{titleBlock}</div>}
        <div className="pointer-events-none shrink-0 border-2 border-border bg-bg/85 px-2 py-1 text-right shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}><div className="text-[8px] font-black uppercase tracking-widest text-text-muted">LV {playerLevel}</div><div className="text-xs font-black text-amber">{equippedCount}/7 gear</div></div>
      </div>
      <motion.div className="pointer-events-none absolute left-[82px] top-[108px] z-10 -rotate-6" key={`weapon-${eventActive ? latestEvent?.id : mode}`} animate={eventActive && !reduced ? { x: [-2, 3, 0], y: [0, -2, 0] } : undefined} transition={eventActive && !reduced ? { duration: 0.44 } : undefined}><WeaponIllustration weapon={weapon} type={fallbackType(area)} manufacturer={fallbackMaker(area)} element={element} rarity={weapon?.rarity ?? Rarity.Common} visualSeed={weapon?.pixelSeed ?? area.unlockLevel + 17} size={106} showBadges={false} animate={false} /></motion.div>
      <div className="pointer-events-none absolute bottom-[82px] left-2 right-2 grid grid-cols-[1fr_auto] gap-2"><div className="min-w-0 border-2 border-border bg-bg/88 px-2 py-1.5 shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}><div className="truncate text-[9px] font-black uppercase tracking-wide text-text-primary">{weaponLabel}</div><div className="truncate text-[8px] text-text-muted">{motionCaption}</div></div><div className="flex items-center gap-1.5 border-2 border-border bg-surface/90 px-2 py-1.5 shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}>{latestEvent ? <Sparkles size={13} className="text-amber" /> : <Crosshair size={13} className="text-red" />}<div><div className="text-[8px] font-black uppercase tracking-wide text-text-muted">{targetMode}</div><div className="max-w-[92px] truncate text-[9px] font-black text-red">{latestEvent ? latestEvent.tone : enemyLabel(area, bossName)}</div></div></div></div>
      <CharacterStatBar summary={computedStats} />
      <div className="absolute bottom-0 left-0 right-0 grid grid-cols-2 border-t-2 border-border bg-surface/95 text-[9px]"><button type="button" onClick={onFight} className="flex items-center justify-between gap-2 border-r border-border px-3 py-2 text-left active:bg-red/10"><span><span className="block font-black uppercase tracking-wide text-red">{primaryLabel}</span><span className="block truncate text-text-muted">{primaryDetail}</span></span><Crosshair size={14} className="shrink-0 text-red" /></button><button type="button" onClick={onSecondary} className="flex items-center justify-between gap-2 px-3 py-2 text-left active:bg-amber/10"><span><span className="block font-black uppercase tracking-wide text-amber">{secondaryLabel}</span><span className="block truncate text-text-muted">{secondaryDetail}</span></span>{secondaryActionLabel ? <ChevronDown size={14} className="shrink-0 text-amber" /> : <Box size={14} className="shrink-0 text-amber" />}</button></div>
    </section>
  );
};
