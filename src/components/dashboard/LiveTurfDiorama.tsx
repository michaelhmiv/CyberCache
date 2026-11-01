import React, { useEffect, useState } from 'react';
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { WeaponIllustration } from '@/components/weapon/WeaponIllustration';
import { PixelStage, PixelActor } from '@/components/pixelArt/PixelStage';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import {
  CritFlash,
  DamageNumber,
  DustPuff,
  DustRing,
  GhostHpBar,
  ImpactSparks,
  MuzzleFlash,
  PixelSway,
  ShellCasing,
  TelegraphGlow,
  Tracer,
} from '@/components/pixelArt/PixelFx';
import { getPixelSprite, pixelBackgroundForArea, pixelBossSpriteForBoss, pixelEnemySpriteForArchetype, requirePixelSprite } from '@/lib/pixel/manifest';
import { MOVEMENT, actorAnchorPoint, classifyTickBeat, type ActorPlacement } from '@/lib/pixel/movement';
import { PixelRigActor } from '@/components/pixelArt/PixelRigActor';
import { ENEMY_POSES, HUNTER_POSES, enemyRig, hunterRigWithHead, type HunterHeadVariantId } from '@/lib/pixel/rig';
import { areaVisuals } from '@/content/areaPalettes';
import { isHotArea } from '@/content/hotArea';
import { elementDialect, shotCadence } from '@/lib/pixel/elementFx';
import { weaponGripFraction } from '@/lib/pixel/weaponCompositor';
import { useLoadoutStore } from '@/store';
import { useVehicleStore } from '@/store/slices/vehicleSlice';
import { CONSUMABLES } from '@/constants/consumables';

/** Belt sprite per consumable (overhaul §4.7): specific ids first, then
 *  the family read. The loadout's three consumable slots ride the
 *  hunter's belt on stage. */
const BELT_SPRITES_BY_ID: Record<string, string> = {
  med_kit: 'belt-vial',
  shield_cell: 'belt-cell',
  swarm_grenade: 'belt-swarm',
  combat_stims: 'belt-syringe',
  ammo_box: 'belt-rounds',
  loot_beacon: 'belt-beacon',
  salvage_contract: 'belt-contract',
  data_skimmer: 'belt-scanner',
  magnetized_payload: 'belt-magazine',
};
const BELT_SPRITES_BY_FAMILY: Record<string, string> = {
  survival: 'belt-vial',
  ammo: 'belt-magazine',
  ordnance: 'belt-grenade',
  tactical: 'belt-scanner',
  economy: 'belt-ticket',
  corrupted: 'belt-syringe',
};

function beltSpriteFor(consumableId: string | null): string | undefined {
  if (!consumableId) return undefined;
  return BELT_SPRITES_BY_ID[consumableId] ?? BELT_SPRITES_BY_FAMILY[CONSUMABLES[consumableId as keyof typeof CONSUMABLES]?.family ?? ''];
}

function headVariantPreference(): HunterHeadVariantId {
  try {
    const value = window.localStorage.getItem('cc-head-variant');
    return value === 'optic' || value === 'hood' || value === 'fin' ? value : 'visor';
  } catch {
    return 'visor';
  }
}
import { LootMoment } from '@/components/pixelArt/LootMoment';
import { gearDropFromEvent } from '@/lib/pixel/lootMoment';
import { ELEMENT_PROJECTILE, getLiveTurfScene } from '@/constants/liveTurfVisuals';
import { useKillCycleStore, useTickFeedStore, useBossStore, useInventoryStore } from '@/store';
import { MONSTERS, getMonster } from '@/constants/monsters';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { ARCHETYPE_SILHOUETTES, type EnemyArchetype } from '@/components/diorama/EnemySilhouettes';
import { Element, Rarity, WeaponType } from '@/types/game';
import { MATERIAL_VISUALS, ESSENCE_VISUALS, RESOURCE_VISUALS } from '@/constants/visualAssets';
import { pickResourceSilhouette, type ResourceSilhouetteId } from '@/constants/resourceSilhouettes';
import type { BossDef } from '@/types/boss';
import type { RoamingAreaDef } from '@/constants/roamingAreas';
import type { Weapon } from '@/types/items';
import type { ActivityKind, BossPhase } from '@/types/activity';
import type { CharacterStatSummary } from '@/lib/stats/characterStats';
import type { TickEvent } from '@/store/slices/tickSlice';

export type LiveTurfFeedEvent = TickEvent;

type DioramaMode = 'idle' | 'roaming' | 'bossPrep' | 'bossFight' | 'crafting' | 'salvaging' | 'workshopService' | 'marketListing';

interface LiveTurfDioramaProps {
  area: RoamingAreaDef;
  weapon?: Weapon;
  bossName?: string;
  bossWeaknessCount?: number;
  boss?: BossDef;
  playerLevel: number;
  equippedCount: number;
  cacheKeys: number;
  activityKind?: ActivityKind;
  bossPhase?: BossPhase;
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
const enemyLabel = (area: RoamingAreaDef, bossName?: string) => bossName ?? area.enemyType.split(',')[0] ?? 'Target contact';
const isImpact = (event?: LiveTurfFeedEvent): event is LiveTurfFeedEvent => !!event && event.id !== 'idle-loop-ready';
const isLootLike = (event: LiveTurfFeedEvent | undefined): boolean => {
  if (!isImpact(event)) return false;
  return event.tone === 'loot' || event.tone === 'cache' || event.tone === 'level' || event.tone === 'kill';
};

const modeFromActivity = (kind?: ActivityKind, bossPhase?: BossPhase): DioramaMode => {
  if (kind === 'roaming_loot') return 'roaming';
  if (kind === 'boss_fight') return bossPhase === 'fight' ? 'bossFight' : 'bossPrep';
  if (kind === 'crafting') return 'crafting';
  if (kind === 'salvaging') return 'salvaging';
  if (kind === 'workshop_service') return 'workshopService';
  if (kind === 'market_listing') return 'marketListing';
  return 'idle';
};

const modeInfo: Record<DioramaMode, { label: string; caption: string; status: string }> = {
  idle: { label: 'Standby', caption: 'at camp, ready to move', status: 'READY' },
  roaming: { label: 'Roaming', caption: 'scanning turf for real drops', status: 'ROUTE' },
  bossPrep: { label: 'Boss prep', caption: 'checking counters and gear tape', status: 'PREP' },
  bossFight: { label: 'Boss fight', caption: 'resolving boss encounter', status: 'FIGHT' },
  crafting: { label: 'Crafting', caption: 'bench dispatch in progress', status: 'BENCH' },
  salvaging: { label: 'Salvaging', caption: 'gear broken into scrap', status: 'SCRAP' },
  workshopService: { label: 'Workshop', caption: 'servicing queued machines', status: 'SHOP' },
  marketListing: { label: 'Market', caption: 'working the trade kiosk', status: 'TRADE' },
};

// ── Drop visual helpers ──────────────────────────────────────────────────────────

/** Parse material type from event label (e.g. "+1 TechFragments" → "TechFragments") */
const parseDropType = (label: string): string => {
  const match = label.match(/^\+?\d+\s+(.+)$/);
  return match ? match[1] : label;
};

/** Resolve visual asset color for a material or essence drop */
const dropAssetColor = (typeName: string): string => {
  const mat = (MATERIAL_VISUALS as Record<string, { color: string }>)[typeName];
  if (mat) return mat.color;
  const ess = (ESSENCE_VISUALS as Record<string, { color: string }>)[typeName];
  if (ess) return ess.color;
  // Resource colors
  const res = (RESOURCE_VISUALS as Record<string, { color: string }>)[typeName];
  if (res) return res.color;
  return '#A5A7B5'; // fallback gray
};

// ── Scene Props (unchanged) ──────────────────────────────────────────────────────

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

// ── Runner (Player Hunter) ───────────────────────────────────────────────────────

const RunnerSvg: React.FC<{ accent: string; mode: DioramaMode; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ accent, mode, event, reduced }) => {
  const active = isImpact(event) && !reduced;
  const bench = mode === 'crafting' || mode === 'salvaging' || mode === 'workshopService' || mode === 'marketListing';
  const prep = mode === 'bossPrep';
  const isDamage = active && event?.tone === 'damage';
  const isHeal = active && event?.tone === 'heal';
  const leftArm = bench ? 'M83 102 L111 124' : prep ? 'M84 101 L189 92' : mode === 'idle' ? 'M83 101 L72 132' : 'M83 101 L64 119';
  const rightArm = bench ? 'M119 101 L179 123' : prep ? 'M119 101 L184 116' : mode === 'idle' ? 'M119 101 L142 125' : 'M119 101 L151 105';
  const idleMotion = mode === 'roaming' || mode === 'bossFight' ? { x: [0, 5, 0], y: [0, -2, 0] } : { y: [0, -1, 0] };
  // Damage reaction: flash red, stagger back
  const damageAnim = isDamage ? { x: [-8, 2, 0], opacity: [1, 0.4, 1], filter: ['drop-shadow(0 0 0 #FF0000)', 'drop-shadow(0 0 8px #FF0000)', 'drop-shadow(0 0 0 #FF0000)'] } : {};
  const healAnim = isHeal ? { opacity: [1, 0.7, 1], filter: ['drop-shadow(0 0 0 #7CFC00)', 'drop-shadow(0 0 10px #7CFC00)', 'drop-shadow(0 0 0 #7CFC00)'] } : {};
  return (
    <motion.g
      animate={reduced ? undefined : isDamage ? damageAnim : isHeal ? healAnim : active ? { x: [-3, 5, 0], y: [0, -3, 0], rotate: [0, -1, 0] } : idleMotion}
      transition={reduced ? undefined : isDamage ? { duration: 0.35 } : isHeal ? { duration: 0.6 } : active ? { duration: 0.45 } : { duration: 2.8, repeat: Infinity }}
    >
      <ellipse cx="104" cy="150" rx="31" ry="7" fill="#000" opacity="0.45" />
      {/* Body */}
      <path d="M91 86 L118 78 L134 100 L121 130 L91 130 L77 104 Z" fill="#2B2522" stroke="#000" strokeWidth="5" strokeLinejoin="round" />
      <path d="M93 91 L116 85 L128 101 L119 121 L94 123 L84 105 Z" fill={accent} opacity="0.38" stroke="#000" strokeWidth="3" />
      {/* Head */}
      <path d="M92 56 L117 52 L129 66 L124 84 L97 89 L82 75 Z" fill="#B8B0A8" stroke="#000" strokeWidth="5" strokeLinejoin="round" />
      <path d="M98 63 L122 60 L119 72 L96 76 Z" fill="#050608" stroke="#000" strokeWidth="3" />
      {/* Arms */}
      <path d={leftArm} stroke="#000" strokeWidth="8" strokeLinecap="round" />
      <path d={rightArm} stroke="#000" strokeWidth="8" strokeLinecap="round" />
      {/* Legs */}
      <path d="M97 129 L86 153" stroke="#000" strokeWidth="8" strokeLinecap="round" />
      <path d="M116 128 L131 151" stroke="#000" strokeWidth="8" strokeLinecap="round" />
      {/* Hands at sides (no weapon when unarmed) */}
      <path d="M86 153 L82 160" stroke={accent} strokeWidth="6" strokeLinecap="round" />
      <path d="M131 151 L135 158" stroke={accent} strokeWidth="6" strokeLinecap="round" />
      {/* Damage red overlay */}
      {isDamage && !reduced && (
        <motion.rect x="75" y="45" width="62" height="112" rx="4" fill="#FF0000" opacity="0"
          animate={{ opacity: [0, 0.35, 0] }}
          transition={{ duration: 0.35 }}
        />
      )}
    </motion.g>
  );
};

// ── Integrated Enemy HP Bar (SVG, above enemy) ───────────────────────────────────

const EnemyHpBarSvg: React.FC<{ active: boolean; accentColor: string; enemyX: number; enemyY: number }> = ({ active, accentColor, enemyX, enemyY }) => {
  const currentHp = useKillCycleStore((state) => state.currentTargetHp);
  const maxHp = useKillCycleStore((state) => state.currentTargetHpMax);
  const targetId = useKillCycleStore((state) => state.currentTargetId);

  if (!active || !targetId || maxHp <= 0) return null;

  const ratio = Math.max(0, Math.min(1, currentHp / maxHp));
  const barWidth = 80;
  const barHeight = 8;
  const x = enemyX - barWidth / 2;
  const y = enemyY - 28;

  return (
    <motion.g initial={false} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      {/* Background bar */}
      <rect x={x} y={y} width={barWidth} height={barHeight} rx="2" fill="#050608" stroke="#2A2F3A" strokeWidth="1.5" />
      {/* HP fill */}
      <motion.rect
        x={x + 1} y={y + 1}
        width={Math.max(0, (barWidth - 2) * ratio)}
        height={barHeight - 2}
        rx="1"
        fill={accentColor}
        initial={false}
        animate={{ width: Math.max(0, (barWidth - 2) * ratio) }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
      {/* HP percentage text */}
      <text x={enemyX} y={y - 4} textAnchor="middle" fill="#B8B0A8" fontSize="7" fontWeight="900" stroke="#000" strokeWidth="2">
        {Math.round(ratio * 100)}%
      </text>
    </motion.g>
  );
};

// ── Enemy Hit Effects (flash + floating damage number) ───────────────────────────

const EnemyHitEffects: React.FC<{ event?: LiveTurfFeedEvent; enemyX: number; enemyY: number; reduced: boolean }> = ({ event, enemyX, enemyY, reduced }) => {
  if (!event || reduced) return null;
  // Hit events from kill cycle use tone 'loot' with damage label
  const isHit = event.tone === 'loot' && event.label?.startsWith('-') && (event.value ?? 0) > 0;
  if (!isHit) return null;
  const dmg = event.value ?? 0;

  return (
    <motion.g
      initial={{ opacity: 0, y: 0 }}
      animate={{ opacity: [0, 1, 0], y: [0, -20, -35] }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      {/* Hit flash circle on enemy */}
      <circle cx={enemyX} cy={enemyY} r="18" fill="#FFFFFF" opacity="0.3" />
      <circle cx={enemyX} cy={enemyY} r="12" fill="none" stroke="#FFFFFF" strokeWidth="2" opacity="0.6" />
      {/* Floating damage number */}
      <text x={enemyX} y={enemyY - 12} textAnchor="middle" fill="#FFEA3A" fontSize="16" fontWeight="900" stroke="#000" strokeWidth="3">
        -{dmg}
      </text>
    </motion.g>
  );
};

// ── Enemy SVG (monster) ──────────────────────────────────────────────────────────

const EnemySvg: React.FC<{ color: string; glow: string; archetype: EnemyArchetype; boss: boolean; mode: DioramaMode; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ color, glow, archetype, boss, mode, event, reduced }) => {
  if (mode !== 'roaming' && mode !== 'bossFight') return null;
  const silhouette = ARCHETYPE_SILHOUETTES[boss ? 'elite' : archetype];
  const active = isImpact(event) && !reduced;
  const isKill = active && event?.tone === 'kill';
  const isHit = active && event?.tone === 'loot' && event?.label?.startsWith('-') && (event?.value ?? 0) > 0;
  const scale = silhouette.baseScale * (boss ? 1.3 : 1.0);
  return (
    <motion.g
      animate={reduced ? undefined : isKill ? { opacity: [1, 0.9, 0], scale: [1, 1.2, 0.3], x: [0, 10, 0], y: [0, -5, 10] } : isHit ? { x: [0, 4, -2, 0], scale: [1, 0.94, 1.02, 1] } : active ? { x: [0, 9, -4, 0], scale: [1, 0.98, 1.02, 1] } : { x: [0, -5, 0], y: [0, 2, 0] }}
      transition={reduced ? undefined : isKill ? { duration: 0.4 } : isHit ? { duration: 0.2 } : active ? { duration: 0.48 } : { duration: 2.2, repeat: Infinity }}
    >
      <ellipse cx="320" cy="151" rx={32 * scale} ry="8" fill="#000" opacity="0.48" />
      <path d={silhouette.bodyOuter} fill="#161116" stroke="#000" strokeWidth="6" strokeLinejoin="round" />
      <path d={silhouette.bodyInner} fill={isHit && !reduced ? '#FFFFFF' : color} opacity={isHit && !reduced ? 0.9 : 0.6} stroke="#000" strokeWidth="3" strokeLinejoin="round" />
      {silhouette.armorPlates?.map((plate, i) => <path key={`p-${i}`} d={plate} fill={glow} opacity="0.18" stroke="#000" strokeWidth="2" />)}
      {silhouette.limbLeft && <path d={silhouette.limbLeft} stroke="#000" strokeWidth="6" strokeLinecap="round" />}
      {silhouette.limbRight && <path d={silhouette.limbRight} stroke="#000" strokeWidth="6" strokeLinecap="round" />}
      {silhouette.eyes.map((eye, i) => <circle key={`e-${i}`} cx={eye.cx} cy={eye.cy} r={eye.r} fill={isKill ? '#FFFFFF' : glow} stroke="#000" strokeWidth="3" />)}
    </motion.g>
  );
};

// ── Drop Visual Icons (type-specific SVG shapes for non-weapon drops) ────────────

/** Renders a distinct SVG icon for each drop type: material, essence, fragment, scrap, credits */
const DropVisualIcon: React.FC<{ tone: string; label: string; x: number; y: number; size?: number }> = ({ tone, label, x, y, size = 28 }) => {
  const half = size / 2;
  const color = dropAssetColor(parseDropType(label));

  // Helper to pick a deterministic silhouette variant
  const pickSil = (resourceId: string) => {
    const seed = label.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    return pickResourceSilhouette(resourceId as ResourceSilhouetteId, seed);
  };

  if (tone === 'material') {
    // Crystal / gem shape for materials
    return (
      <g transform={`translate(${x}, ${y})`}>
        <rect x={-half + 2} y={-half + 2} width={size - 4} height={size - 4} rx="3" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="2" />
        <path d={`M${-half + 6} 0L0 ${-half + 6}L${half - 6} 0L0 ${half - 6}Z`} fill={color} stroke="#000" strokeWidth="1.5" />
        <text x="0" y={half + 10} textAnchor="middle" fill={color} fontSize="8" fontWeight="900" stroke="#000" strokeWidth="2">
          {parseDropType(label).slice(0, 4).toUpperCase()}
        </text>
      </g>
    );
  }

  if (tone === 'essence') {
    // Glowing orb / droplet for essences
    return (
      <g transform={`translate(${x}, ${y})`}>
        <circle cx="0" cy="0" r={half - 2} fill={color} fillOpacity="0.35" stroke={color} strokeWidth="2" />
        <circle cx="0" cy="0" r={half - 6} fill={color} fillOpacity="0.7" />
        <circle cx={-half * 0.3} cy={-half * 0.3} r="2.5" fill="#FFFFFF" opacity="0.7" />
        <text x="0" y={half + 10} textAnchor="middle" fill={color} fontSize="8" fontWeight="900" stroke="#000" strokeWidth="2">
          {parseDropType(label).slice(0, 4).toUpperCase()}
        </text>
      </g>
    );
  }

  if (tone === 'fragment') {
    // Key shard for cache fragments
    const sil = pickSil('cacheFragment');
    return (
      <g transform={`translate(${x}, ${y}) scale(${size / 24})`}>
        <path d={sil.body} fill="#2196F3" fillOpacity="0.8" stroke="#000" strokeWidth="1.5" />
        {sil.core && <path d={sil.core} fill="#90CAF9" opacity="0.6" />}
        <text x="0" y={half + 10} textAnchor="middle" fill="#2196F3" fontSize="8" fontWeight="900" stroke="#000" strokeWidth="2">
          FRAG
        </text>
      </g>
    );
  }

  if (tone === 'cash') {
    // If label contains "scrap", show scrap icon; otherwise credits
    const isScrap = label.toLowerCase().includes('scrap');
    if (isScrap) {
      const sil = pickSil('scrap');
      return (
        <g transform={`translate(${x}, ${y}) scale(${size / 24})`}>
          <path d={sil.body} fill="#FF5722" fillOpacity="0.8" stroke="#000" strokeWidth="1.5" />
          {sil.core && <path d={sil.core} fill="#FF8A65" opacity="0.5" />}
        </g>
      );
    }
    // Credits coin
    const sil = pickSil('credits');
    return (
      <g transform={`translate(${x}, ${y}) scale(${size / 24})`}>
        <path d={sil.body} fill="#FFD700" fillOpacity="0.85" stroke="#000" strokeWidth="1.5" />
        {sil.core && <path d={sil.core} fill="#FFA000" opacity="0.5" />}
      </g>
    );
  }

  // Default: loot crate
  const sil = pickSil('loot');
  return (
    <g transform={`translate(${x}, ${y}) scale(${size / 24})`}>
      <path d={sil.body} fill={color} fillOpacity="0.7" stroke="#000" strokeWidth="1.5" />
    </g>
  );
};

// ── Loot Drop Gear — shows the actual dropped item rising from the kill site ─────

/** SVG-native drops (materials, essences, fragments, cash) rendered inside <svg> */
const LootDropSvg: React.FC<{ event?: LiveTurfFeedEvent; reduced: boolean }> = ({ event, reduced }) => {
  if (!event || reduced) return null;
  if (event.tone !== 'material' && event.tone !== 'essence' && event.tone !== 'fragment' && event.tone !== 'cash') return null;

  return (
    <motion.g
      initial={{ y: 0, opacity: 0, scale: 0.5 }}
      animate={{ y: -35, opacity: [0, 1, 1, 0], scale: [0.5, 1.1, 1, 0.7] }}
      transition={{ duration: 1.8, ease: 'easeOut', times: [0, 0.2, 0.65, 1] }}
    >
      <DropVisualIcon tone={event.tone} label={event.label} x={320} y={105} size={34} />
    </motion.g>
  );
};

// ── Loot Particles — type-specific burst particles ───────────────────────────────

const LootParticles: React.FC<{ event?: LiveTurfFeedEvent; reduced: boolean }> = ({ event, reduced }) => {
  if (!isLootLike(event) || reduced) return null;
  const tone = event?.tone ?? 'kill';

  // Color schemes per event type
  const colorSchemes: Record<string, string[]> = {
    kill: ['#FF5722', '#FF8A65', '#FFEA3A', '#76FF03'],
    loot: ['#FF9000', '#FFEA3A', '#FFD700', '#FFA000', '#FFC107'],
    cache: ['#00BCD4', '#80DEEA', '#4DD0E1', '#00ACC1'],
    cash: ['#FFD700', '#FFA000', '#FF8F00', '#FFC107'],
    level: ['#E040FB', '#EA80FC', '#CE93D8', '#BA68C8'],
  };
  const count = tone === 'kill' ? 7 : tone === 'loot' ? 6 : 5;
  const colors = colorSchemes[tone] ?? colorSchemes.kill;

  return (
    <motion.g>
      {Array.from({ length: count }).map((_, i) => {
        // Deterministic pseudo-random values from event id + particle index
        const seed = (event?.id ?? '').split('').reduce((s, c) => s + c.charCodeAt(0), i * 7);
        const phi = (seed * 2654435761) % 1000000 / 1000000; // golden-ratio hash
        const angle = (i / count) * Math.PI * 2 + (phi - 0.5) * 0.6;
        const dist = 20 + (phi * 1000 % 1) * 45;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist - 15;
        const color = colors[i % colors.length];
        const shape = i % 4;
        const dur = 0.45 + (phi * 100 % 1) * 0.35;
        return (
          <motion.g key={`lp-${i}`}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: dx, y: dy, opacity: 0, scale: 0.12 }}
            transition={{ duration: dur, ease: 'easeOut' }}
          >
            {shape === 0 && <rect x="-5" y="-5" width="10" height="10" fill={color} stroke="#000" strokeWidth="1.5" transform="rotate(45)" />}
            {shape === 1 && <circle cx="0" cy="0" r="5" fill={color} stroke="#000" strokeWidth="1.5" />}
            {shape === 2 && <path d="M0 -6L6 4L-6 4Z" fill={color} stroke="#000" strokeWidth="1.5" />}
            {shape === 3 && <path d="M-6 0L0 -6L6 0L0 6Z" fill={color} stroke="#000" strokeWidth="1.5" />}
          </motion.g>
        );
      })}
    </motion.g>
  );
};

// ── Player Damage Flash ──────────────────────────────────────────────────────────

const PlayerDamageFlash: React.FC<{ event?: LiveTurfFeedEvent; reduced: boolean; eventActive: boolean }> = ({ event, reduced, eventActive }) => {
  if (reduced) return null;
  if (!event || event.tone !== 'damage') return null;
  if (!eventActive) return null;

  const damageValue = event.value ?? 0;
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: [0, 1, 0], scale: [0.8, 1.2, 1], y: [0, -30, -50] }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
    >
      {/* Red vignette overlay */}
      <rect x="0" y="0" width="420" height="286" fill="#FF0000" opacity="0.12" />
      {/* Damage number near runner */}
      <text x="104" y="90" textAnchor="middle" fill="#FF4444" fontSize="20" fontWeight="900" stroke="#000" strokeWidth="3">
        -{damageValue}
      </text>
      {/* Hit spark at runner position */}
      <circle cx="104" cy="100" r="10" fill="#FF4444" opacity="0.5" />
      <circle cx="104" cy="100" r="15" fill="none" stroke="#FF4444" strokeWidth="2" opacity="0.7" />
      <path d="M96 92 L112 108 M112 92 L96 108" stroke="#FF4444" strokeWidth="1.5" opacity="0.6" />
    </motion.g>
  );
};

// ── Scrap SVG ────────────────────────────────────────────────────────────────────

const ScrapSvg: React.FC<{ accent: string; mode: DioramaMode; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ accent, mode, event, reduced }) => {
  if (mode !== 'salvaging' && !isLootLike(event)) return null;
  return <motion.g initial={!reduced && isLootLike(event) ? { y: 8, opacity: 0, scale: 0.86 } : undefined} animate={!reduced && isLootLike(event) ? { y: [8, -10, -4], opacity: [0, 1, 0.92], scale: [0.86, 1.08, 1] } : undefined}><path d="M199 134 L214 130 L226 140 L215 151 L198 148 Z" fill="#A5A7B5" stroke="#000" strokeWidth="4" /><path d="M223 122 L236 125 L235 141 L220 139 Z" fill={accent} opacity="0.78" stroke="#000" strokeWidth="3" /></motion.g>;
};

// ── Weapon-Specific Projectile ───────────────────────────────────────────────────

const ProjectileTape: React.FC<{ projectile: { color: string; glow: string }; weaponType?: WeaponType; mode: DioramaMode; event?: LiveTurfFeedEvent; reduced: boolean }> = ({ projectile, weaponType, mode, event, reduced }) => {
  if ((mode !== 'roaming' && mode !== 'bossFight') || !isImpact(event)) return null;

  // Weapon-type-specific projectile shapes
  const renderProjectile = () => {
    switch (weaponType) {
      case WeaponType.Shotgun:
        // Spread of 5 pellets
        return (
          <motion.g initial={reduced ? undefined : { opacity: 0 }} animate={reduced ? undefined : { opacity: [0, 1, 0] }} transition={reduced ? undefined : { duration: 0.48, times: [0, 0.3, 1] }}>
            {[-8, -4, 0, 4, 8].map((spread, i) => (
              <circle key={i} cx={265 + spread * 2} cy={105 + spread} r="3" fill={projectile.glow} stroke="#000" strokeWidth="2" />
            ))}
            <path d="M162 106 L255 105" stroke="#000" strokeWidth="7" strokeLinecap="round" opacity="0.5" />
            <path d="M162 106 L255 105" stroke={projectile.color} strokeWidth="3" strokeLinecap="round" opacity="0.8" />
          </motion.g>
        );

      case WeaponType.Sniper:
        // Long thin precision beam
        return (
          <motion.g initial={reduced ? undefined : { opacity: 0, x: -4 }} animate={reduced ? undefined : { opacity: [0, 1, 0.8, 0], x: [-4, 8, 20, 34] }} transition={reduced ? undefined : { duration: 0.35, times: [0, 0.2, 0.6, 1] }}>
            <path d="M162 106 L268 105" stroke="#000" strokeWidth="6" strokeLinecap="round" opacity="0.55" />
            <path d="M162 106 L268 105" stroke={projectile.color} strokeWidth="2" strokeLinecap="round" />
            <circle cx="268" cy="105" r="5" fill={projectile.glow} stroke="#000" strokeWidth="2.5" />
          </motion.g>
        );

      case WeaponType.Launcher:
        // Large rocket shape
        return (
          <motion.g initial={reduced ? undefined : { opacity: 0, x: -8 }} animate={reduced ? undefined : { opacity: [0, 1, 0], x: [-8, 16, 36], rotate: [0, 5, -5] }} transition={reduced ? undefined : { duration: 0.65, times: [0, 0.35, 1] }}>
            <path d="M162 106 L258 105" stroke="#000" strokeWidth="8" strokeLinecap="round" opacity="0.5" />
            <path d="M162 106 L258 105" stroke={projectile.color} strokeWidth="5" strokeLinecap="round" />
            <circle cx="262" cy="105" r="9" fill={projectile.glow} stroke="#000" strokeWidth="3" />
            <path d="M268 105 L276 101 M268 105 L276 109 M272 105 L280 105" stroke="#FFEA3A" strokeWidth="2" strokeLinecap="round" />
          </motion.g>
        );

      case WeaponType.Beam:
        // Continuous laser beam
        return (
          <motion.g initial={reduced ? undefined : { opacity: 0 }} animate={reduced ? undefined : { opacity: [0, 1, 0.5, 0] }} transition={reduced ? undefined : { duration: 0.5, times: [0, 0.1, 0.6, 1] }}>
            <path d="M162 106 L272 105" stroke="#000" strokeWidth="10" strokeLinecap="round" opacity="0.4" />
            <path d="M162 106 L272 105" stroke={projectile.glow} strokeWidth="4" strokeLinecap="round" opacity="0.9" />
            <path d="M162 106 L272 105" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
            <circle cx="272" cy="105" r="6" fill="#FFFFFF" stroke={projectile.glow} strokeWidth="3" />
          </motion.g>
        );

      case WeaponType.SMG:
        // Burst of 3 dots
        return (
          <motion.g>
            {[0, 1, 2].map((burst, i) => (
              <motion.g key={i}
                initial={reduced ? undefined : { opacity: 0, x: -4 }}
                animate={reduced ? undefined : { opacity: [0, 1, 0], x: [-4, 14 + i * 8, 28 + i * 8] }}
                transition={reduced ? undefined : { duration: 0.4, delay: i * 0.08, times: [0, 0.5, 1] }}
              >
                <circle cx="265" cy={105} r="3.5" fill={projectile.glow} stroke="#000" strokeWidth="2" />
              </motion.g>
            ))}
            <path d="M162 106 L258 105" stroke="#000" strokeWidth="6" strokeLinecap="round" opacity="0.45" />
            <path d="M162 106 L258 105" stroke={projectile.color} strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
          </motion.g>
        );

      default:
        // Pistol / default: single bullet
        return (
          <motion.g initial={reduced ? undefined : { opacity: 0, x: -8 }} animate={reduced ? undefined : { opacity: [0, 1, 0], x: [-8, 18, 34] }} transition={reduced ? undefined : { duration: 0.48, ease: 'linear' }}>
            <path d="M162 106 L260 105" stroke="#000" strokeWidth="9" strokeLinecap="round" opacity="0.55" />
            <path d="M162 106 L260 105" stroke={projectile.color} strokeWidth="4" strokeLinecap="round" />
            <circle cx="265" cy="105" r="7" fill={projectile.glow} stroke="#000" strokeWidth="3" />
          </motion.g>
        );
    }
  };

  return renderProjectile();
};

// ── Target HP Overlay (HTML, kept for accessibility but SVG version is primary) ──

const TargetHpOverlay: React.FC<{ active: boolean; accentColor: string }> = ({ active, accentColor }) => {
  const currentHp = useKillCycleStore((state) => state.currentTargetHp);
  const maxHp = useKillCycleStore((state) => state.currentTargetHpMax);
  const targetId = useKillCycleStore((state) => state.currentTargetId);

  if (!active || !targetId || maxHp <= 0) return null;

  const ratio = Math.max(0, Math.min(1, currentHp / maxHp));
  const targetName = MONSTERS.find((monster) => monster.id === targetId)?.name ?? 'Target';

  return (
    <div className="pointer-events-none absolute right-[36px] top-[68px] z-20 w-[126px] border-2 border-border bg-bg/90 px-2 py-1 shadow-[4px_4px_0_rgba(0,0,0,0.72)]" style={signClip} data-testid="primary-diorama-target-hp">
      <div className="mb-1 flex items-center justify-between gap-2 text-[8px] font-black uppercase tracking-wide text-text-muted">
        <span className="truncate">{targetName}</span>
        <span className="shrink-0 text-red">{Math.round(ratio * 100)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden border border-border bg-surface">
        <motion.div
          className="h-full"
          style={{ background: accentColor }}
          initial={false}
          animate={{ width: `${ratio * 100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
};

/** Boss HP overlay for live boss fights. The fill carries a ghost trail
 *  (P2 movement system): lost HP drains behind the real bar over ~480 ms. */
const BossHpOverlay: React.FC<{ active: boolean; accentColor: string; reduced?: boolean }> = ({ active, accentColor, reduced = false }) => {
  const bossHp = useBossStore((state) => state.activeBossHp);
  const bossMaxHp = useBossStore((state) => state.activeBossMaxHp);
  const bossId = useBossStore((state) => state.activeBossId);
  const status = useBossStore((state) => state.activeStatus);

  if (!active || !bossId || bossMaxHp <= 0 || status === 'idle') return null;

  const ratio = Math.max(0, Math.min(1, bossHp / bossMaxHp));
  const bossDef = REGION_1_BOSSES.find((b) => b.id === bossId);
  const bossName = bossDef?.name ?? 'Boss';

  return (
    <div className="pointer-events-none absolute right-[36px] top-[68px] z-20 w-[126px] border-2 border-border bg-bg/90 px-2 py-1 shadow-[4px_4px_0_rgba(0,0,0,0.72)]" style={signClip} data-testid="primary-diorama-boss-hp">
      <div className="mb-1 flex items-center justify-between gap-2 text-[8px] font-black uppercase tracking-wide text-text-muted">
        <span className="truncate">{bossName}</span>
        <span className="shrink-0 text-red">{Math.round(ratio * 100)}%</span>
      </div>
      <GhostHpBar pct={ratio * 100} color={accentColor} reduced={reduced} barClassName="h-2" testId="diorama-boss-hp-bar" />
      {status === 'victory' && (
        <div className="mt-1 text-center text-[8px] font-black text-green animate-pulse">VICTORY</div>
      )}
      {status === 'defeat' && (
        <div className="mt-1 text-center text-[8px] font-black text-red animate-pulse">DEFEATED</div>
      )}
    </div>
  );
};

// ── Pixel Scene Layer (P1: converted zones render pixel sprites) ────────────────

/**
 * Pixel replacement for the vector SVG scene, used by areas listed in
 * PIXEL_AREA_BACKGROUNDS (P1: Dustwaste Frontier; P4 wave 1: every other
 * roaming zone — this layer is zone-agnostic, driven entirely by the
 * background id and the shared actor sprites). The enemy actor resolves
 * from game data, never per-zone wiring: in boss fights the challenged
 * boss's bespoke sprite (passed in as bossSpriteId), otherwise the kill
 * cycle's current target monster's archetype sprite, with the brute as
 * the standing fallback. Sprites come from the pixel manifest and
 * are placed by their anchors on a PixelStage; the equipped weapon
 * renders through the parts-kit compositor at the hunter's hands.
 *
 * P2 movement system: the latest tick event is classified into a combat
 * beat (src/lib/pixel/movement.ts) and staged with the FX kit — walk-in /
 * drop-in entrances, muzzle flash + tracer + shell casing + impact
 * sparks, screen shake, crit flash, telegraphed enemy lunge answered by
 * a hunter dodge, and the kill collapse with a dust ring. All timings
 * come from MOVEMENT; all positions from manifest anchors. All chrome
 * (title, HP overlays, action bar) stays shared with the vector scene.
 * Presentation only — reads the same stores/events, produces no gameplay
 * outcomes. Reduced motion: static actors, no FX/shake/entrances.
 */
const PixelSceneLayer: React.FC<{
  backgroundId: string;
  /** Bespoke boss sprite id for boss fights (resolved by the parent from
   *  the challenged boss's def); roaming targets resolve by archetype. */
  bossSpriteId?: string;
  weapon?: Weapon;
  mode: DioramaMode;
  modeLabel: string;
  accent: string;
  event?: LiveTurfFeedEvent;
  reduced: boolean;
  /** Overhaul: the roaming area this stage shows (parallax, palette,
   *  weather, hot-area treatment read from it). */
  areaId: string;
  hot?: boolean;
}> = ({ backgroundId, bossSpriteId, weapon, mode, modeLabel, accent, event, reduced, areaId, hot = false }) => {
  const background = getPixelSprite(backgroundId);
  const groundY = background?.anchors.groundLine?.y ?? 0.86;
  const showEnemy = mode === 'roaming' || mode === 'bossFight';
  const bossMode = mode === 'bossFight';
  const targetMaxHp = useKillCycleStore((state) => state.currentTargetHpMax);
  const currentTargetId = useKillCycleStore((state) => state.currentTargetId);
  const beat = reduced ? null : classifyTickBeat(event, targetMaxHp);
  const lootLike = isLootLike(event) && !reduced;
  // A real gear drop on the latest event gets the P3 loot moment (beam +
  // card at the enemy's loot point); other loot-like events keep the
  // crate rise below. Hit ticks share tone 'loot' but carry no gear.
  const dropItem = gearDropFromEvent(event);
  const crate = getPixelSprite('crate');
  const [enemyLanded, setEnemyLanded] = useState(false);

  const hunterSprite = requirePixelSprite('hunter');
  // ── Overhaul stage state ──────────────────────────────────────────
  const visuals = areaVisuals(areaId);
  const dialect = elementDialect(weapon?.element);
  const cadence = shotCadence(weapon?.weaponType, weapon?.attackSpeed);
  const loadoutConsumables = useLoadoutStore((state) => state.consumables);
  const equippedShield = useLoadoutStore((state) => state.slots.shield);
  const equippedRelic = useLoadoutStore((state) => state.slots.relic);
  const equippedClassModId = useLoadoutStore((state) => state.slots.classMod);
  const classModItem = useInventoryStore((state) =>
    equippedClassModId ? state.items.find((i) => i.id === equippedClassModId) : undefined,
  );
  const vehicle = useLoadoutStore((state) => state.getVehicle());
  const vehicleStatus = useVehicleStore((state) => state.lastClaimStatus);
  const beltSprites = [loadoutConsumables.PreFight, loadoutConsumables.MidFight, loadoutConsumables.Emergency]
    .map(beltSpriteFor)
    .filter((s): s is string => !!s);
  const pauldronTree = (() => {
    const tree = (classModItem && 'treeBonus' in classModItem ? String(classModItem.treeBonus) : '').toLowerCase();
    return tree.includes('demolition') ? 'demolition' : tree.includes('scavenger') ? 'scavenger' : 'gunslinger';
  })();
  const isEliteEvent = !!event && (event.tone === 'event' || event.tone === 'event_major') && event.family === 'elite';
  const eventProp = event && (event.tone === 'event' || event.tone === 'event_major') && event.propId
    ? getPixelSprite(event.propId)
    : undefined;
  const hunterPose = !showEnemy
    ? HUNTER_POSES.idle
    : beat?.kind === 'shot' || beat?.kind === 'crit'
      ? HUNTER_POSES.recoil
      : beat?.kind === 'playerHit'
        ? HUNTER_POSES.hit
        : beat?.kind === 'kill'
          ? HUNTER_POSES.celebrate
          : HUNTER_POSES.aim;
  const enemyPose = isEliteEvent
    ? ENEMY_POSES.idle
    : beat?.kind === 'playerHit'
      ? ENEMY_POSES.lunge
      : beat?.kind === 'shot' || beat?.kind === 'crit'
        ? ENEMY_POSES.hit
        : beat?.kind === 'kill'
          ? ENEMY_POSES.death
          : ENEMY_POSES.idle;
  // Held-weapon placement from anchors (§4.2): the weapon render's own
  // grip fraction lands on the hunter's manifest grip anchor.
  const weaponGrip = weapon ? weaponGripFraction(weapon.weaponType) : { x: 0.4, y: 0.65 };
  const weaponBoxWidthPct = 78;
  const weaponBoxHeightPct = weaponBoxWidthPct * (260 / 320) * (44 / 120);
  const weaponLeftPct = (hunterSprite.anchors.grip?.x ?? 0.55) * 100 - weaponGrip.x * weaponBoxWidthPct;
  const weaponTopPct = (hunterSprite.anchors.grip?.y ?? 0.37) * 100 - weaponGrip.y * weaponBoxHeightPct;

  // Enemy sprite from data: the boss's bespoke sprite in boss fights,
  // else the current target monster's archetype sprite, else the brute.
  const targetArchetype = currentTargetId ? getMonster(currentTargetId)?.archetype : undefined;
  const enemySpriteId =
    (bossMode ? bossSpriteId : undefined) ?? pixelEnemySpriteForArchetype(targetArchetype) ?? 'brute';
  const enemySprite = getPixelSprite(enemySpriteId) ?? requirePixelSprite('brute');
  const hunterPlacement: ActorPlacement = { xPct: 22, heightPct: 57, groundY };
  const enemyPlacement: ActorPlacement = { xPct: 74, heightPct: bossMode && bossSpriteId ? 80 : 66, groundY };
  const muzzle = actorAnchorPoint(hunterSprite, 'muzzle', hunterPlacement);
  const grip = actorAnchorPoint(hunterSprite, 'grip', hunterPlacement);
  const hunterMass = actorAnchorPoint(hunterSprite, 'centerMass', hunterPlacement);
  const enemyMass = actorAnchorPoint(enemySprite, 'centerMass', enemyPlacement);
  const enemyFeet = actorAnchorPoint(enemySprite, 'feet', enemyPlacement);
  const enemyLoot = actorAnchorPoint(enemySprite, 'lootPoint', enemyPlacement);

  const combatBeat = beat && showEnemy ? beat : null;
  const shakeKey =
    combatBeat && (combatBeat.kind === 'shot' || combatBeat.kind === 'crit' || combatBeat.kind === 'kill')
      ? event?.id
      : enemyLanded && bossMode && !reduced
        ? 'enemy-land'
        : undefined;
  const shakeIntensity = combatBeat?.kind === 'crit' ? 7 : combatBeat?.kind === 'kill' ? 5 : combatBeat?.kind === 'shot' ? 3 : 5;
  const shakeDurationMs = combatBeat?.kind === 'crit' ? MOVEMENT.CRIT_SHAKE_MS : MOVEMENT.SHAKE_MS + 140;

  // Actor reactions, driven per tick event through animation controls.
  const hunterControls = useAnimationControls();
  const enemyLungeControls = useAnimationControls();
  const enemyHitControls = useAnimationControls();
  const beatKind = combatBeat?.kind;
  const beatEventId = event?.id;
  useEffect(() => {
    if (reduced) return;
    switch (beatKind) {
      case 'playerHit':
        void hunterControls.start({
          x: [0, 0, -26, -20, 0],
          scaleY: [1, 1, 0.9, 0.97, 1],
          transition: { duration: (MOVEMENT.TELEGRAPH_MS + MOVEMENT.LUNGE_MS + 120) / 1000, times: [0, 0.45, 0.6, 0.78, 1] },
        });
        void enemyLungeControls.start({
          x: [0, 0, -92, -72, 0],
          transition: { duration: (MOVEMENT.TELEGRAPH_MS + MOVEMENT.LUNGE_MS + 140) / 1000, times: [0, 0.45, 0.62, 0.8, 1] },
        });
        break;
      case 'shot':
      case 'crit':
        void hunterControls.start({ x: [0, -4, 0], transition: { duration: 0.22 } });
        void enemyHitControls.start({
          scale: [1, 0.93, 1.03, 1],
          x: [0, 9, -3, 0],
          transition: { duration: MOVEMENT.HIT_REACTION_MS / 1000 },
        });
        break;
      case 'kill':
        void hunterControls.start({ y: [0, -9, 0], transition: { duration: 0.42 } });
        void enemyHitControls.start({
          opacity: [1, 1, 0],
          scale: [1, 1.05, 0.5],
          y: [0, 0, 24],
          transition: { duration: 0.5, ease: 'easeIn' },
        });
        break;
      case 'loot':
        // A legendary drop is the celebration beat (P3): the hunter hops
        // as the LootMoment's gold pillar lands. Lesser drops settle.
        if (event?.gear?.rarity === Rarity.Legendary) {
          void hunterControls.start({ y: [0, -11, 0], transition: { duration: MOVEMENT.LOOT_HOP_MS / 1000, ease: 'easeOut' } });
        } else {
          void hunterControls.start({ x: 0, y: 0, scaleY: 1, transition: { duration: 0.2 } });
        }
        void enemyLungeControls.start({ x: 0, transition: { duration: 0.2 } });
        void enemyHitControls.start({ opacity: 1, scale: 1, x: 0, y: 0, transition: { duration: 0.2 } });
        break;
      default:
        // Quiet/loot event (or a fresh target): settle back to rest poses.
        void hunterControls.start({ x: 0, y: 0, scaleY: 1, transition: { duration: 0.2 } });
        void enemyLungeControls.start({ x: 0, transition: { duration: 0.2 } });
        void enemyHitControls.start({ opacity: 1, scale: 1, x: 0, y: 0, transition: { duration: 0.2 } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatEventId, beatKind, reduced]);

  return (
    <PixelStage
      backgroundId={backgroundId}
      groundY={groundY}
      reduced={reduced}
      embers
      shakeKey={shakeKey}
      shakeIntensity={shakeIntensity}
      shakeDurationMs={shakeDurationMs}
      testId="pixel-diorama-stage"
      areaId={areaId}
      hot={hot}
    >
      {/* Mode chip (mirrors the vector scene's in-scene label) */}
      <div
        className="pointer-events-none absolute left-2 top-[58px] z-20 border-2 border-black bg-[#050608]/85 px-2 py-0.5 text-[13px] font-black uppercase tracking-wide"
        style={{ color: accent, boxShadow: `0 0 12px ${accent}55` }}
      >
        {modeLabel}
      </div>

      {/* Set dressing in non-combat modes (grammar G-5): the system's
          set pieces behind the actor; the camp crate is the fallback. */}
      {!showEnemy && mode === 'crafting' && (
        <PixelActor spriteId="set-bench-forge" xPct={60} heightPct={34} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-bench-set" />
      )}
      {!showEnemy && mode === 'workshopService' && (
        <PixelActor spriteId="set-bay-lift" xPct={60} heightPct={36} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-bay-set" />
      )}
      {!showEnemy && mode === 'salvaging' && (
        <PixelActor spriteId="set-refinery-crusher" xPct={60} heightPct={34} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-refinery-set" />
      )}
      {!showEnemy && mode === 'marketListing' && (
        <PixelActor spriteId="set-vendor-stall" xPct={60} heightPct={34} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-vendor-set" />
      )}
      {!showEnemy && mode !== 'crafting' && mode !== 'workshopService' && mode !== 'salvaging' && mode !== 'marketListing' && (
        <PixelActor spriteId="crate" xPct={63} heightPct={21} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-crate-prop" />
      )}

      {/* Event prop on the loot stage (§3.4): the fired event's named
          prop stands mid-stage for its feed beat. */}
      {eventProp && event && (
        <PixelActor
          key={`event-prop-${event.id}`}
          spriteId={eventProp.id}
          xPct={52}
          heightPct={23}
          groundY={groundY}
          reduced={reduced}
          breathe={false}
          testId="pixel-event-prop"
        />
      )}
      {isEliteEvent && (
        <PixelActor spriteId="prop-elite-banner" xPct={88} heightPct={26} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-elite-banner" />
      )}

      {/* The equipped vehicle, parked at the scene edge during fights
          (Q4 travel legs + encounter clusters): the actual instance —
          class profile, rolled affix overlays, condition wear — with
          its fuel/condition read from the last claim's status. */}
      {mode === 'roaming' && vehicle && (
        <div className="absolute" style={{ left: '1%', bottom: `${(1 - groundY) * 100 + 1}%`, width: '21%', zIndex: 5 }} data-testid="pixel-vehicle">
          <div className="relative">
            <img
              src={getPixelSprite(`vehicle-${vehicle.vehicleClassId.replace(/_/g, '-')}`)?.url}
              alt=""
              draggable={false}
              className="w-full"
              style={{ imageRendering: 'pixelated' }}
            />
            {vehicle.affixes.some((a) => a.stat === 'vehicleCargoPct') && (
              <img src={getPixelSprite('vehicle-affix-cargo-rack')?.url} alt="" draggable={false} className="absolute inset-0 w-full" style={{ imageRendering: 'pixelated' }} />
            )}
            {vehicle.affixes.some((a) => a.stat === 'vehicleScannerPct') && (
              <img src={getPixelSprite('vehicle-affix-scanner-array')?.url} alt="" draggable={false} className="absolute inset-0 w-full" style={{ imageRendering: 'pixelated' }} />
            )}
            {vehicle.affixes.some((a) => a.stat === 'vehicleFramePct') && (
              <img src={getPixelSprite('vehicle-affix-reinforced-frame')?.url} alt="" draggable={false} className="absolute inset-0 w-full" style={{ imageRendering: 'pixelated' }} />
            )}
            {vehicle.conditionCurrent / Math.max(1, vehicle.conditionMax) < 0.35 && (
              <img src={getPixelSprite('vehicle-condition-scuff')?.url} alt="" draggable={false} className="absolute inset-0 w-full" style={{ imageRendering: 'pixelated' }} />
            )}
          </div>
          {vehicleStatus && (
            <div className="mt-0.5 flex gap-1" data-testid="pixel-vehicle-status">
              <div className="h-1 flex-1 bg-black/60">
                <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, (vehicleStatus.fuelUnitsRemaining / Math.max(1, vehicleStatus.fuelUnitsStart || vehicleStatus.fuelUnitsRemaining)) * 100)}%` }} />
              </div>
              <div className="h-1 flex-1 bg-black/60">
                <div className="h-full bg-emerald-400" style={{ width: `${(vehicleStatus.conditionCurrent / Math.max(1, vehicleStatus.conditionMax)) * 100}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hunter — walks in for combat; dodges the telegraphed lunge on
          damage beats, recoils on his own shots, hops on a kill.
          Persistent wrapper: reactions run through animation controls
          (a per-event remount would replay the walk-in on every tick). */}
      <motion.div
        className="absolute inset-0"
        style={{ transformOrigin: `${hunterPlacement.xPct}% ${groundY * 100}%` }}
        initial={false}
        animate={reduced ? undefined : hunterControls}
      >
        {showEnemy ? (
          <PixelRigActor
            rig={hunterRigWithHead(headVariantPreference(), !weapon)}
            {...hunterPlacement}
            feetX={hunterSprite.anchors.feet?.x ?? 0.27}
            reduced={reduced}
            pose={hunterPose}
            testId="pixel-hunter"
          >
            {weapon && (
              <div
                className="pointer-events-none absolute"
                style={{ left: `${weaponLeftPct}%`, top: `${weaponTopPct}%`, width: `${weaponBoxWidthPct}%`, transform: 'rotate(-3deg)', zIndex: 7 }}
              >
                <PixelSway reduced={reduced}>
                  <PixelWeapon weapon={weapon} fluid testId="pixel-held-weapon" />
                </PixelSway>
              </div>
            )}
            {/* Equipped gear reads (§4.7): shield emitter, relic sigil,
                class-mod pauldron, and the loadout's belt consumables —
                all from the actual equipped instances. */}
            {equippedShield && getPixelSprite('gear-shield-emitter') && (
              <img
                src={getPixelSprite('gear-shield-emitter')!.url}
                alt=""
                draggable={false}
                data-testid="pixel-gear-shield"
                className="pointer-events-none absolute"
                style={{ left: '6%', top: '30%', width: '34%', imageRendering: 'pixelated', zIndex: 8 }}
              />
            )}
            {equippedRelic && getPixelSprite('gear-relic-sigil') && (
              <img
                src={getPixelSprite('gear-relic-sigil')!.url}
                alt=""
                draggable={false}
                data-testid="pixel-gear-relic"
                className="pointer-events-none absolute"
                style={{ left: '24%', top: '34%', width: '20%', imageRendering: 'pixelated', zIndex: 8 }}
              />
            )}
            {equippedClassModId && getPixelSprite(`gear-pauldron-${pauldronTree}`) && (
              <img
                src={getPixelSprite(`gear-pauldron-${pauldronTree}`)!.url}
                alt=""
                draggable={false}
                data-testid="pixel-gear-pauldron"
                className="pointer-events-none absolute"
                style={{ left: '12%', top: '24%', width: '26%', imageRendering: 'pixelated', zIndex: 8 }}
              />
            )}
            {beltSprites.map((spriteId, i) => {
              const sprite = getPixelSprite(spriteId);
              if (!sprite) return null;
              return (
                <img
                  key={`${spriteId}-${i}`}
                  src={sprite.url}
                  alt=""
                  draggable={false}
                  data-testid="pixel-belt-prop"
                  className="pointer-events-none absolute"
                  style={{ left: `${30 + i * 9}%`, top: '56%', width: '11%', imageRendering: 'pixelated', zIndex: 8 }}
                />
              );
            })}
          </PixelRigActor>
        ) : weapon ? (
          <PixelActor
            spriteId="hunter"
            {...hunterPlacement}
            reduced={reduced}
            entrance="none"
            testId="pixel-hunter"
          >
            {weapon && (
              <div
                className="pointer-events-none absolute"
                style={{ left: `${weaponLeftPct}%`, top: `${weaponTopPct}%`, width: `${weaponBoxWidthPct}%`, transform: 'rotate(-3deg)' }}
              >
                <PixelSway reduced={reduced}>
                  <PixelWeapon weapon={weapon} fluid testId="pixel-held-weapon" />
                </PixelSway>
              </div>
            )}
          </PixelActor>
        ) : (
          /* Unarmed (real-item invariant): the whole 'hunter' sprite
             has a rifle baked in, so the idle hunter swaps to the
             gun-free rig — hands at sides, no phantom weapon. */
          <PixelRigActor
            rig={hunterRigWithHead(headVariantPreference(), true)}
            {...hunterPlacement}
            feetX={hunterSprite.anchors.feet?.x ?? 0.27}
            reduced={reduced}
            pose={HUNTER_POSES.idle}
            testId="pixel-hunter"
          />
        )}
      </motion.div>

      {/* Enemy — drops in for boss fights (dust + shake on landing),
          walks in roaming; lunges on damage beats; hit/kill reactions */}
      {showEnemy && (
        <motion.div
          className="absolute inset-0"
          style={{ transformOrigin: `${enemyPlacement.xPct}% ${groundY * 100}%` }}
          initial={false}
          animate={reduced ? undefined : enemyLungeControls}
        >
          <motion.div
            className="absolute inset-0"
            initial={false}
            animate={reduced ? undefined : enemyHitControls}
            style={{ transformOrigin: `${enemyPlacement.xPct}% ${groundY * 100}%` }}
          >
            {bossMode || (isEliteEvent && visuals.eliteSpriteId) ? (
              <PixelActor
                spriteId={isEliteEvent && visuals.eliteSpriteId ? visuals.eliteSpriteId : enemySprite.id}
                {...enemyPlacement}
                heightPct={isEliteEvent ? 74 : enemyPlacement.heightPct}
                reduced={reduced}
                breatheDuration={3.1}
                entrance={bossMode ? 'drop' : 'walk'}
                enterFrom="right"
                onLanded={() => setEnemyLanded(true)}
                testId="pixel-enemy"
              />
            ) : (
              <motion.div
                key={`rig-target-${currentTargetId ?? 'none'}-${isEliteEvent ? 'elite' : 'std'}`}
                className="absolute inset-0"
                initial={reduced ? false : { x: '6%', opacity: 0 }}
                animate={{ x: '0%', opacity: 1 }}
                transition={{ duration: MOVEMENT.WALK_IN_MS / 1000, ease: 'easeOut' }}
              >
                <PixelRigActor
                  rig={enemyRig(isEliteEvent ? 'elite' : (targetArchetype ?? 'brute'))}
                  {...enemyPlacement}
                  heightPct={isEliteEvent ? 72 : enemyPlacement.heightPct}
                  feetX={enemySprite.anchors.feet?.x ?? 0.5}
                  reduced={reduced}
                  pose={enemyPose}
                  palette={{ paletteId: areaId, spec: visuals.enemyPalette }}
                  testId="pixel-enemy"
                >
                  {/* The area's signature part rides the enemy (§4.4). */}
                  {getPixelSprite(visuals.signaturePartId) && (
                    <img
                      src={getPixelSprite(visuals.signaturePartId)!.url}
                      alt=""
                      draggable={false}
                      data-testid="pixel-enemy-signature"
                      className="pointer-events-none absolute"
                      style={{ left: '38%', top: '26%', width: '18%', imageRendering: 'pixelated', zIndex: 5 }}
                    />
                  )}
                </PixelRigActor>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}

      {/* Landing dust when the boss drops in */}
      {enemyLanded && bossMode && !reduced && <DustPuff xPct={enemyFeet.xPct} yPct={enemyFeet.yPct} width={96} />}

      {/* Combat beat FX — positioned from manifest anchors */}
      {combatBeat && event && (
        <div key={`beat-${event.id}`} className="absolute inset-0" data-testid="diorama-beat-fx">
          {(combatBeat.kind === 'shot' || combatBeat.kind === 'crit') && (
            <>
              <MuzzleFlash xPct={muzzle.xPct} yPct={muzzle.yPct} color={dialect.muzzleColor} size={34 * dialect.muzzleScale} />
              {/* Element dialect (§4.6): tracer color/dash from the
                  element, count/spread from the instance's cadence. */}
              {Array.from({ length: cadence.tracerCount }, (_, i) => {
                const offset = (i - (cadence.tracerCount - 1) / 2) * cadence.spreadPct;
                return (
                  <Tracer
                    key={`tracer-${i}`}
                    from={muzzle}
                    to={{ xPct: enemyMass.xPct, yPct: enemyMass.yPct + offset }}
                    color={dialect.tracerColor}
                    heightPx={dialect.tracerWidth}
                  />
                );
              })}
              <ShellCasing xPct={grip.xPct} yPct={grip.yPct} />
              <ImpactSparks xPct={enemyMass.xPct} yPct={enemyMass.yPct} seed={event.id} color={dialect.impactColor} />
              {getPixelSprite(dialect.statusSpriteId) && (
                <img
                  src={getPixelSprite(dialect.statusSpriteId)!.url}
                  alt=""
                  draggable={false}
                  data-testid="fx-status-overlay"
                  className="pointer-events-none absolute z-20"
                  style={{
                    left: `${enemyMass.xPct}%`,
                    top: `${enemyMass.yPct}%`,
                    width: 44,
                    marginLeft: -22,
                    marginTop: -22,
                    imageRendering: 'pixelated',
                    opacity: 0.9,
                  }}
                />
              )}
              <motion.div
                data-testid="fx-hit-flash"
                className="pointer-events-none absolute z-20 rounded-full bg-white"
                style={{ left: `${enemyMass.xPct}%`, top: `${enemyMass.yPct}%`, width: 96, height: 96, marginLeft: -48, marginTop: -48 }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.45, 0] }}
                transition={{ duration: MOVEMENT.HIT_REACTION_MS / 1000 }}
              />
              <DamageNumber xPct={enemyMass.xPct} yPct={enemyMass.yPct - 6} value={combatBeat.value ?? 0} crit={combatBeat.kind === 'crit'} />
            </>
          )}
          {combatBeat.kind === 'crit' && <CritFlash />}
          {combatBeat.kind === 'playerHit' && (
            <>
              <TelegraphGlow xPct={enemyMass.xPct} yPct={enemyMass.yPct} />
              <DamageNumber xPct={hunterMass.xPct} yPct={hunterMass.yPct - 6} value={combatBeat.value ?? 0} tone="player" delayMs={MOVEMENT.TELEGRAPH_MS} />
              <motion.div
                className="pointer-events-none absolute inset-0 z-30 bg-[#FF0000]/12"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0, 1, 0] }}
                transition={{ duration: (MOVEMENT.TELEGRAPH_MS + 300) / 1000, times: [0, 0.55, 0.7, 1] }}
              />
            </>
          )}
          {combatBeat.kind === 'kill' && <DustRing xPct={enemyFeet.xPct} yPct={enemyFeet.yPct} delayMs={120} />}
        </div>
      )}

      {/* Loot crate rise on loot-like events that are not gear drops
          (fragments, materials, cache ticks) */}
      {lootLike && !dropItem && crate && (
        <motion.img
          key={`loot-${event?.id}`}
          src={crate.url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute z-20"
          style={{ left: '64%', bottom: '12%', width: 54, imageRendering: 'pixelated' }}
          initial={{ y: 6, opacity: 0, scale: 0.6 }}
          animate={{ y: -30, opacity: [0, 1, 1, 0], scale: [0.6, 1.05, 1, 0.8] }}
          transition={{ duration: 1.6, ease: 'easeOut', times: [0, 0.2, 0.7, 1] }}
        />
      )}

      {/* P3 loot moment for real gear drops: rarity beam + drop card at
          the enemy's manifest loot point (light for ordinary drops, the
          full legendary treatment when a legendary lands). The drop was
          already awarded by the Chef claim — this only celebrates it. */}
      {dropItem && event && (
        <LootMoment
          key={`loot-moment-${event.id}`}
          items={[dropItem]}
          surface="feed"
          reduced={reduced}
          anchorXPct={enemyLoot.xPct}
          groundYPct={enemyFeet.yPct}
          testId="diorama-loot-moment"
        />
      )}
    </PixelStage>
  );
};

// ── Main Diorama Component ───────────────────────────────────────────────────────

export const LiveTurfDiorama: React.FC<LiveTurfDioramaProps> = ({ area, weapon, bossName, bossWeaknessCount = 0, playerLevel: _playerLevel, equippedCount, cacheKeys, activityKind = 'idle_standby', bossPhase, activityLabel, activityTarget, onFight, onSecondary, onTitleClick, primaryActionLabel, primaryActionDetail, secondaryActionLabel, secondaryActionDetail }) => {
  const reduced = !!useReducedMotion();
  const latestEvent = useTickFeedStore((state) => state.events[0]);
  // A new tick event re-renders this diorama so the SVG fight can react.
  // Hunter Totals computation has been lifted to DashboardScreen.
  // statSummary prop is provided by the parent; diorama uses it directly.
  const scene = getLiveTurfScene(area);
  const pixelBackgroundId = pixelBackgroundForArea(area.id);
  // The diorama identifies the challenged boss by name; resolve its
  // bespoke pixel sprite through the boss def id (P4 wave 1).
  const stageBossDef = bossName ? REGION_1_BOSSES.find((b) => b.name === bossName) : undefined;
  const stageBossSpriteId = pixelBossSpriteForBoss(stageBossDef?.id);
  const mode = modeFromActivity(activityKind);
  const copy = modeInfo[mode];
  const safeId = safeSvgId(`${scene.id}-${weapon?.id ?? 'unarmed'}-${mode}`);
  const element = weapon?.element ?? Element.Kinetic;
  const projectile = ELEMENT_PROJECTILE[element];
  const eventActive = isImpact(latestEvent);
  const dropItem = gearDropFromEvent(latestEvent);
  const title = activityTarget || bossName || area.name;
  const weaponLabel = weapon ? `${weapon.rarity} ${weapon.element} ${weapon.weaponType}` : 'No weapon equipped';
  const motionCaption = latestEvent ? `${latestEvent.label} ${latestEvent.detail}` : copy.caption;
  const targetMode = latestEvent ? 'event' : copy.status;
  const primaryLabel = primaryActionLabel ?? (activityKind === 'roaming_loot' ? 'View run' : activityKind === 'idle_standby' || activityKind === 'none' ? 'Start Roam' : 'Manage action');
  const primaryDetail = primaryActionDetail ?? (activityKind === 'roaming_loot' ? area.enemyType : copy.caption);
  const secondaryLabel = secondaryActionLabel ?? (bossName ? 'Prep boss' : 'Switch');
  const secondaryDetail = secondaryActionDetail ?? (bossName ? `${bossWeaknessCount} weakness tags` : `${cacheKeys} keys ready`);
  const titleBlock = <div className="min-w-0 border-2 border-border bg-surface/90 px-2 py-1.5 text-left shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}><div className="flex items-center gap-1"><div className="min-w-0 flex-1"><div className="bl-title text-2xl leading-tight text-text-primary">{title}</div><div className="text-[8px] font-black uppercase leading-snug tracking-[0.18em] text-text-muted">{activityLabel || copy.caption}</div></div>{onTitleClick && <ChevronDown size={16} className="shrink-0 text-amber animate-bounce" />}</div></div>;

  // Enemy center position (where the archetype center is)
  const enemyX = 320;
  const enemyY = 100;

  return (
    <section className="relative h-[286px] overflow-hidden border-2 border-border bg-bg shadow-[0_10px_22px_rgba(0,0,0,0.6)]" style={panelClip}>
      {pixelBackgroundId ? (
        <PixelSceneLayer backgroundId={pixelBackgroundId} bossSpriteId={stageBossSpriteId} weapon={weapon} mode={mode} modeLabel={copy.label} accent={scene.accent} event={latestEvent} reduced={reduced} areaId={area.id} hot={isHotArea(area.id, new Date())} />
      ) : (
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 420 286" role="img" aria-label={`${copy.label} activity visualization`}>
        <defs><linearGradient id={`sky-${safeId}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={scene.skyTop} /><stop offset="54%" stopColor={scene.skyBottom} /><stop offset="100%" stopColor="#050608" /></linearGradient><linearGradient id={`ground-${safeId}`} x1="0" x2="1"><stop offset="0%" stopColor={scene.groundDark} /><stop offset="48%" stopColor={scene.ground} /><stop offset="100%" stopColor={scene.groundDark} /></linearGradient><filter id={`soft-glow-${safeId}`} x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={scene.accent} floodOpacity="0.55" /></filter></defs>
        <rect width="420" height="286" fill={`url(#sky-${safeId})`} />
        <path d="M0 83 C54 65 86 73 140 57 C201 39 248 61 312 45 C359 34 392 41 420 31 L420 149 L0 149 Z" fill={scene.horizon} opacity="0.18" />
        <path d="M0 143 L58 136 L96 145 L155 135 L210 145 L277 137 L339 145 L420 134 L420 286 L0 286 Z" fill={`url(#ground-${safeId})`} stroke="#000" strokeWidth="5" />
        <path d="M20 165 L106 154 L179 162 L258 153 L397 161" fill="none" stroke="#000" strokeWidth="5" opacity="0.42" />
        <SceneProps prop={scene.prop} accent={scene.accent} dark={scene.groundDark} />
        <ActivityProp mode={mode} accent={scene.accent} dark={scene.groundDark} event={latestEvent} reduced={reduced} />
        <ProjectileTape projectile={projectile} weaponType={weapon?.weaponType} mode={mode} event={latestEvent} reduced={reduced} />
        <ScrapSvg accent={scene.accent} mode={mode} event={latestEvent} reduced={reduced} />
        <RunnerSvg accent={scene.accent} mode={mode} event={latestEvent} reduced={reduced} />
        <EnemySvg color={scene.enemyColor} glow={scene.enemyGlow} archetype="runner" boss={!!bossName || mode === 'bossFight'} mode={mode} event={latestEvent} reduced={reduced} />
        {/* SVG HP bar integrated above enemy */}
        <EnemyHpBarSvg active={activityKind === 'roaming_loot'} accentColor={scene.accent} enemyX={enemyX} enemyY={enemyY} />
        {/* Hit flash + damage numbers on enemy */}
        <EnemyHitEffects event={latestEvent} enemyX={enemyX} enemyY={enemyY} reduced={reduced} />
        {/* Drop visuals — materials, essences, fragments, cash (SVG-native only) */}
        <LootDropSvg event={latestEvent} reduced={reduced} />
        {/* Particle burst */}
        <LootParticles event={latestEvent} reduced={reduced} />
        {/* Player damage flash (screen-wide red overlay) */}
        <PlayerDamageFlash event={latestEvent} reduced={reduced} eventActive={eventActive} />
        <g filter={`url(#soft-glow-${safeId})`}><path d="M12 18 L135 18 L148 31 L141 46 L12 46 Z" fill="#050608" opacity="0.84" stroke="#000" strokeWidth="4" /><text x="22" y="36" fill={scene.accent} fontSize="15" fontWeight="900">{copy.label.toUpperCase()}</text></g>
      </svg>
      )}
      {/* HTML overlays — any component that renders <div> must live OUTSIDE the <svg> */}
      {/* P3 loot moment for gear drops on not-yet-converted (vector) zones —
          pixel zones render theirs inside the scene layer at the enemy's
          manifest loot point. Beam base here is the vector enemy's ground
          position (320/420 across, ~151/286 down the viewBox). */}
      {!pixelBackgroundId && dropItem && latestEvent && (
        <LootMoment
          key={`loot-moment-${latestEvent.id}`}
          items={[dropItem]}
          surface="feed"
          reduced={reduced}
          anchorXPct={(320 / 420) * 100}
          groundYPct={(151 / 286) * 100}
          testId="diorama-loot-moment"
        />
      )}
      {/* Target HP overlay */}
      <TargetHpOverlay active={activityKind === 'roaming_loot'} accentColor={scene.accent} />
      <BossHpOverlay active={activityKind === 'boss_fight' && bossPhase === 'fight'} accentColor={scene.accent} reduced={reduced} />
      <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2">
        {onTitleClick ? <button type="button" onClick={onTitleClick} className="pointer-events-auto min-w-0 flex-1 active:scale-[0.99]">{titleBlock}</button> : <div className="pointer-events-none min-w-0 flex-1">{titleBlock}</div>}
        <div className="pointer-events-none shrink-0 border-2 border-border bg-bg/85 px-2 py-1 text-right shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}><div className="text-xs font-black text-amber">{equippedCount}/7 gear</div></div>
      </div>
      {!pixelBackgroundId && weapon ? (
        <motion.div
          className="pointer-events-none absolute left-[82px] top-[108px] z-10 -rotate-6"
          key={`weapon-${weapon.id}`}
          animate={eventActive && !reduced ? { x: [-2, 3, 0], y: [0, -2, 0] } : undefined}
          transition={eventActive && !reduced ? { duration: 0.44 } : undefined}
        >
          <WeaponIllustration weapon={weapon} size={106} showBadges={false} animate={false} />
        </motion.div>
      ) : !weapon ? (
        <div
          className="pointer-events-none absolute left-[82px] top-[108px] z-10 -rotate-6 border-2 border-border bg-bg/85 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-text-muted shadow-[4px_4px_0_rgba(0,0,0,0.62)]"
          data-testid="diorama-unarmed-state"
        >
          Unarmed
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-[82px] left-2 right-2 grid grid-cols-[1fr_auto] gap-2"><div className="min-w-0 border-2 border-border bg-bg/88 px-2 py-1.5 shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}><div className="text-[9px] font-black uppercase leading-snug tracking-wide text-text-primary">{weaponLabel}</div><div className="text-[8px] leading-snug text-text-muted">{motionCaption}</div></div><div className="flex items-center gap-1.5 border-2 border-border bg-surface/90 px-2 py-1.5 shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}>{latestEvent ? <span className="font-black text-amber" style={{ fontSize: '13px' }}>✦</span> : <span className="font-black text-red" style={{ fontSize: '13px' }}>◎</span>}<div><div className="text-[8px] font-black uppercase tracking-wide text-text-muted">{targetMode}</div><div className="max-w-[92px] truncate text-[9px] font-black text-red">{latestEvent ? latestEvent.tone : enemyLabel(area, bossName)}</div></div></div></div>
      <div className="absolute bottom-0 left-0 right-0 grid grid-cols-2 border-t-2 border-border bg-surface/95 text-[9px]"><button type="button" onClick={onFight} className="flex items-center justify-between gap-2 border-r border-border px-3 py-2 text-left active:bg-red/10"><span><span className="block font-black uppercase tracking-wide text-red">{primaryLabel}</span><span className="block leading-snug text-text-muted">{primaryDetail}</span></span><span className="shrink-0 font-black text-red" style={{ fontSize: '14px' }}>◎</span></button><button type="button" onClick={onSecondary} className="flex items-center justify-between gap-2 px-3 py-2 text-left active:bg-amber/10"><span><span className="block font-black uppercase tracking-wide text-amber">{secondaryLabel}</span><span className="block leading-snug text-text-muted">{secondaryDetail}</span></span>{secondaryActionLabel ? <ChevronDown size={14} className="shrink-0 text-amber" /> : <span className="shrink-0 font-black text-amber" style={{ fontSize: '14px' }}>▤</span>}</button></div>
    </section>
  );
};
