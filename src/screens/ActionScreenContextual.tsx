import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNow } from '@/hooks/useNow';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Boxes,
  ChevronDown,
  Clock,
  Crosshair,
  Hammer,
  MapPin,
  Package,
  Radar,
  Recycle,
  ShoppingCart,
  Skull,
  Sparkles,
  Target,
  Wrench,
  X,
} from 'lucide-react';
import {
  useActivityStore,
  useBossStore,
  useIdleStore,
  useInventoryStore,
  useLoadoutStore,
  useMarketStore,
  usePlayerStore,
  useSkillStore,
  useWorkshopStore,
} from '@/store';
import { BossPrepModal } from '@/components/fight/BossPrepModal';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { MobileCard } from '@/components/layout/MobileCard';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { CRAFTING_RECIPES } from '@/constants/craftingRecipes';
import {
  ROAMING_AREAS,
  buildAreaWeaponDropOptions,
  getRoamingArea,
  isRoamingAreaUnlocked,
  rollAreaDropKind,
  rollAreaMaterialFind,
  type RoamingAreaDef,
} from '@/constants/roamingAreas';
import { calculateSalvageYield } from '@/constants/salvageRules';
import {
  buildBossPrepActivity,
  buildCraftingActivity,
  buildRoamingLootActivity,
  buildSalvagingActivity,
} from '@/lib/activity/activityBuilders';
import { canStartCraft, getCraftTimeWithReduction } from '@/lib/craftingEngine';
import { makeRunEvent, sortRunEventsByVisualPriority, type RunVisualEvent } from '@/lib/run/runEvents';
import type { ActivityKind, StartActivityInput } from '@/types/activity';
import type { GearItem, Weapon } from '@/types/items';
import type { BossDef } from '@/types/boss';
import { Rarity } from '@/types/game';

const TICK_SECONDS = 3;
const LOG_LIMIT = 8;
const DROP_CHANCE_PER_TICK = 0.22;
const CACHE_FRAGMENT_CHANCE_PER_TICK = 0.03;
const MATERIAL_FIND_CHANCE_PER_TICK = 0.08;
const MAX_SWITCH_ROWS = 8;

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const smallClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const copy: Record<ActivityKind, { title: string; detail: string }> = {
  none: { title: 'No Action', detail: 'Choose what the runner should do next.' },
  idle_standby: { title: 'Standby', detail: 'Runner is visible but not producing rewards.' },
  roaming_loot: { title: 'Roaming Loot', detail: 'Sweeping turf for XP, credits, scrap, gear, materials, and cache fragments.' },
  boss_prep: { title: 'Boss Prep', detail: 'Checking weaknesses, counters, and loadout readiness before a discrete encounter.' },
  boss_fight: { title: 'Boss Encounter', detail: 'Resolving a focused boss encounter instead of the roaming loop.' },
  crafting: { title: 'Crafting', detail: 'Working at the bench to build or modify gear.' },
  salvaging: { title: 'Salvaging', detail: 'Breaking items into scrap, materials, or essences.' },
  workshop_service: { title: 'Workshop Service', detail: 'Maintaining machines, queues, and production outputs.' },
  market_listing: { title: 'Market Listing', detail: 'Posting or managing gear at the trade kiosk.' },
};

const idleEvent: RunVisualEvent = {
  id: 'idle-loop-ready',
  label: 'ACTION READY',
  detail: 'Choose a runner action. The workspace below changes to the current action.',
  tone: 'patrol',
  eventType: 'idle',
};

const describeGear = (item: GearItem) => {
  if ('weaponType' in item) return `${item.rarity} ${item.weaponType}`;
  if ('hp' in item) return `${item.rarity} Shield`;
  if ('treeBonus' in item) return `${item.rarity} Class Mod`;
  if ('damage' in item) return `${item.rarity} Ordnance`;
  return `${item.rarity} Relic`;
};

const formatDuration = (ms: number) => {
  const mins = Math.floor(ms / 60000);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  if (mins >= 1) return `${mins}m`;
  return `${Math.max(1, Math.ceil(ms / 1000))}s`;
};

const StatChip: React.FC<{ label: string; value: string | number; accent?: string }> = ({ label, value, accent = 'text-amber' }) => (
  <div className="border-2 border-border bg-bg/70 px-2 py-1.5" style={smallClip}>
    <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">{label}</div>
    <div className={`truncate text-xs font-black ${accent}`}>{value}</div>
  </div>
);

const Meter: React.FC<{ label: string; value: number; max?: number; detail?: string }> = ({ label, value, max = 100, detail }) => {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-[9px] font-black uppercase tracking-wide text-text-muted">
        <span>{label}</span>
        <span>{detail ?? `${Math.round(pct)}%`}</span>
      </div>
      <div className="h-2 overflow-hidden border border-border bg-bg">
        <motion.div className="h-full bg-amber" animate={{ width: `${pct}%` }} transition={{ duration: 0.35 }} />
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; eyebrow?: string; children: React.ReactNode; icon?: React.ElementType }> = ({ title, eyebrow, children, icon: Icon }) => (
  <MobileCard className="relative overflow-hidden space-y-3 border-border/90 bg-surface/95">
    <div className="absolute -right-8 -top-8 h-24 w-24 rotate-12 border-[14px] border-amber/5" />
    <div className="relative flex items-start justify-between gap-3">
      <div>
        {eyebrow && <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">{eyebrow}</div>}
        <div className="flex items-center gap-2 text-sm font-black text-text-primary">
          {Icon && <Icon size={15} className="text-amber" />}
          {title}
        </div>
      </div>
    </div>
    <div className="relative">{children}</div>
  </MobileCard>
);

const FeedCard: React.FC<{ event: RunVisualEvent }> = ({ event }) => {
  const dot = event.tone === 'loot' ? 'bg-amber' : event.tone === 'cache' ? 'bg-blue-400' : event.tone === 'cash' ? 'bg-cyan' : event.tone === 'level' ? 'bg-red' : event.tone === 'xp' ? 'bg-green' : 'bg-text-muted';
  return (
    <div className="flex items-start gap-2 border border-border bg-surface-raised p-2" style={smallClip}>
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 ${dot}`} />
      <div className="min-w-0">
        <div className="truncate text-[11px] font-black uppercase tracking-wide text-text-primary">{event.label}</div>
        <div className="text-[10px] leading-snug text-text-muted">{event.detail}</div>
      </div>
    </div>
  );
};

type CommonPanelProps = {
  now: number;
  playerLevel: number;
  currentKind: ActivityKind;
  selectedArea: RoamingAreaDef;
  setSelectedArea: (id: string) => void;
  startRoam: (area?: RoamingAreaDef) => void;
  startPrep: (boss?: BossDef) => void;
  openBoss: () => void;
  startCrafting: () => void;
  startSalvage: (item?: GearItem) => void;
  startWorkshop: () => void;
  startMarket: () => void;
  onNavigate?: (screen: string) => void;
};

const RouteCard: React.FC<{ area: RoamingAreaDef; selected: boolean; unlocked: boolean; onSelect: () => void; onStart: () => void }> = ({ area, selected, unlocked, onSelect, onStart }) => {
  const bestRarity = Object.entries(area.dropPoolRarityWeights).sort(([, a], [, b]) => b - a)[0];
  const dangerClass = area.dangerRating === 'Low' ? 'text-green' : area.dangerRating === 'Medium' ? 'text-amber' : 'text-red';
  return (
    <div className={`relative overflow-hidden border-2 p-3 ${selected ? 'border-amber bg-amber/10' : 'border-border bg-bg/70'} ${!unlocked ? 'opacity-55' : ''}`} style={panelClip}>
      <div className="absolute right-0 top-0 h-full w-1/3 bg-[linear-gradient(135deg,rgba(245,181,68,0.12),transparent)]" />
      <div className="relative flex items-start justify-between gap-3">
        <button type="button" onClick={onSelect} disabled={!unlocked} className="min-w-0 flex-1 text-left">
          <div className="text-sm font-black text-text-primary">{area.name}</div>
          <div className="mt-0.5 text-[10px] text-text-muted">Lv.{area.unlockLevel} · {area.manufacturerInfluence} · <span className={dangerClass}>{area.dangerRating}</span></div>
          <div className="mt-2 text-[10px] leading-snug text-text-secondary">{area.gameplayIdentity}</div>
        </button>
        <button type="button" onClick={onStart} disabled={!unlocked} className="bl-secondary shrink-0 px-2 py-1 text-[9px] font-black text-amber disabled:opacity-40">
          {selected ? 'Run' : 'Switch'}
        </button>
      </div>
      <div className="relative mt-3 grid grid-cols-3 gap-1.5 text-[9px]">
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Rates</span><div className="font-black text-text-primary">{area.idleCreditsPerMinute}cr/{area.idleScrapPerMinute}s</div></div>
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Loot</span><div className="truncate font-black text-amber">{area.lootBias[0]}</div></div>
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Rarity</span><div className="font-black text-text-primary">{bestRarity?.[0]}</div></div>
      </div>
      <div className="relative mt-2 text-[9px] text-text-muted">{unlocked ? area.selectionHint : `Locked until level ${area.unlockLevel}.`}</div>
    </div>
  );
};

const RoamingPanel: React.FC<CommonPanelProps & { feed: RunVisualEvent[]; creditsPerTick: number; scrapPerTick: number }> = ({ playerLevel, selectedArea, setSelectedArea, startRoam, feed, creditsPerTick, scrapPerTick }) => {
  const rarityEntries = Object.entries(selectedArea.dropPoolRarityWeights).sort(([, a], [, b]) => b - a);
  const gearEntries = Object.entries(selectedArea.gearDropWeights).sort(([, a], [, b]) => b - a);
  return (
    <div className="space-y-3">
      <Section title="Route Control" eyebrow="Roaming workspace" icon={Radar}>
        <div className="grid grid-cols-3 gap-2">
          <StatChip label="Tick" value={`${TICK_SECONDS}s`} />
          <StatChip label="Per Tick" value={`${creditsPerTick}cr`} accent="text-cyan" />
          <StatChip label="Scrap" value={`+${scrapPerTick}`} accent="text-green" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
          <div className="border border-border bg-bg/60 p-2"><span className="text-text-muted">Enemies</span><div className="mt-1 font-bold text-text-primary">{selectedArea.enemyType}</div></div>
          <div className="border border-border bg-bg/60 p-2"><span className="text-text-muted">Materials</span><div className="mt-1 font-bold text-amber">{[...selectedArea.materialBias, ...selectedArea.essenceBias].slice(0, 3).join(' / ') || 'Balanced'}</div></div>
        </div>
      </Section>

      <Section title="Choose Roaming Route" eyebrow="Switch inside Roam" icon={MapPin}>
        <div className="space-y-2">
          {ROAMING_AREAS.map((area) => {
            const unlocked = isRoamingAreaUnlocked(area, playerLevel);
            const selected = area.id === selectedArea.id;
            return <RouteCard key={area.id} area={area} selected={selected} unlocked={unlocked} onSelect={() => setSelectedArea(area.id)} onStart={() => startRoam(area)} />;
          })}
        </div>
      </Section>

      <Section title="Reward Intelligence" eyebrow="What this route feeds" icon={Sparkles}>
        <div className="grid gap-3">
          <div className="space-y-2">
            {rarityEntries.map(([rarity, weight]) => <Meter key={rarity} label={rarity} value={weight} max={60} detail={`${weight}% weight`} />)}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            {gearEntries.map(([kind, weight]) => <div key={kind} className="border border-border bg-bg/60 p-2"><span className="uppercase text-text-muted">{kind}</span><div className="font-black text-text-primary">{weight} weight</div></div>)}
          </div>
          <div className="text-[10px] leading-snug text-text-muted">Bias: {selectedArea.lootBias.join(' · ')}. Weapons: {selectedArea.weaponBias.join(' / ') || 'mixed'}. Elements: {selectedArea.elementBias?.join(' / ') || 'mixed'}.</div>
        </div>
      </Section>

      <Section title="Latest Route Beats" eyebrow="Roam feed" icon={Activity}>
        <div className="space-y-2">{feed.slice(0, 5).map((event) => <FeedCard key={event.id} event={event} />)}</div>
      </Section>
    </div>
  );
};

const BossPrepPanel: React.FC<CommonPanelProps & { bosses: BossDef[]; currentBoss?: BossDef; fightPower: number }> = ({ bosses, currentBoss, fightPower, startPrep, openBoss }) => {
  const boss = currentBoss ?? bosses[0];
  if (!boss) return <IdlePanel {...({} as CommonPanelProps)} />;
  const readiness = Math.min(140, Math.round((fightPower / Math.max(1, boss.recommendedPower)) * 100));
  return (
    <div className="space-y-3">
      <Section title="Boss Readiness" eyebrow={boss.name} icon={Skull}>
        <div className="grid grid-cols-4 gap-2">
          <StatChip label="Lv" value={boss.level} />
          <StatChip label="Power" value={boss.recommendedPower} />
          <StatChip label="Cost" value={boss.entryCost} accent="text-cyan" />
          <StatChip label="Your" value={fightPower} accent={readiness >= 100 ? 'text-green' : 'text-red'} />
        </div>
        <div className="mt-3"><Meter label="Readiness" value={readiness} max={100} detail={`${readiness}%`} /></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
          <div className="border border-border bg-bg/60 p-2"><span className="text-text-muted">Weak</span><div className="font-black text-green">{boss.weaknesses.join(' / ') || 'None'}</div></div>
          <div className="border border-border bg-bg/60 p-2"><span className="text-text-muted">Resist</span><div className="font-black text-red">{boss.resistances.join(' / ') || 'None'}</div></div>
        </div>
        <div className="mt-3 border border-amber/30 bg-amber/5 p-2 text-[10px] leading-snug text-text-secondary"><span className="font-black text-amber">{boss.mechanic.name}: </span>{boss.mechanic.description}</div>
      </Section>

      <Section title="Phase Checklist" eyebrow="Prep targets" icon={Target}>
        <div className="space-y-2">
          {boss.phases.map((phase, index) => (
            <div key={phase.id} className="border-2 border-border bg-bg/70 p-2" style={smallClip}>
              <div className="flex items-center justify-between gap-2"><div className="font-black text-text-primary text-xs">{index + 1}. {phase.name}</div><span className="text-[9px] font-black uppercase text-amber">{phase.type}</span></div>
              <div className="mt-1 text-[10px] leading-snug text-text-muted">{phase.description}</div>
              <div className="mt-2 flex flex-wrap gap-1">{phase.recommendedCounters.slice(0, 4).map((counter) => <span key={counter} className="border border-border bg-surface px-1.5 py-0.5 text-[9px] text-text-secondary">{counter}</span>)}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Select Boss Target" eyebrow="Switch inside Boss Prep" icon={Crosshair}>
        <div className="space-y-2">
          {bosses.map((candidate) => (
            <button key={candidate.id} type="button" onClick={() => startPrep(candidate)} className={`w-full border-2 p-2 text-left ${candidate.id === boss.id ? 'border-amber bg-amber/10' : 'border-border bg-bg/70'}`} style={smallClip}>
              <div className="flex justify-between gap-2"><span className="font-black text-text-primary text-xs">{candidate.name}</span><span className="text-[9px] text-text-muted">Lv.{candidate.level} · Pwr {candidate.recommendedPower}</span></div>
              <div className="mt-1 text-[10px] text-text-muted">{candidate.weaknesses.join('/')} weak · Drops: {candidate.dedicatedDrops.slice(0, 2).join(', ')}</div>
            </button>
          ))}
        </div>
        <button type="button" onClick={openBoss} className="mt-3 bl-primary w-full py-2 text-xs font-black">Open Boss Modal</button>
      </Section>
    </div>
  );
};

const BossFightPanel: React.FC<{ boss?: BossDef; fightPower: number; openBoss: () => void }> = ({ boss, fightPower, openBoss }) => {
  if (!boss) return <Section title="No Boss Selected" icon={Skull}><button type="button" onClick={openBoss} className="bl-primary w-full py-2 text-xs font-black">Choose Boss</button></Section>;
  return (
    <div className="space-y-3">
      <Section title="Encounter Replay" eyebrow={boss.name} icon={Crosshair}>
        <div className="relative space-y-2 before:absolute before:left-[13px] before:top-4 before:h-[calc(100%-24px)] before:w-0.5 before:bg-border">
          {boss.phases.map((phase, index) => {
            const pass = fightPower >= boss.recommendedPower * phase.targetValue;
            return (
              <div key={phase.id} className="relative flex gap-3">
                <div className={`z-10 mt-1 h-7 w-7 shrink-0 border-2 border-border ${pass ? 'bg-green' : 'bg-red'} text-center text-[10px] font-black leading-6 text-bg`}>{index + 1}</div>
                <div className="flex-1 border border-border bg-bg/70 p-2">
                  <div className="flex justify-between gap-2"><span className="text-xs font-black text-text-primary">{phase.name}</span><span className={pass ? 'text-green text-[9px] font-black' : 'text-red text-[9px] font-black'}>{pass ? 'LIKELY PASS' : 'RISK'}</span></div>
                  <div className="mt-1 text-[10px] text-text-muted">{pass ? phase.successReason : phase.failureReason}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      <Section title="Reward Stakes" eyebrow="Drops" icon={Package}>
        <div className="grid grid-cols-2 gap-2 text-[10px]"><div className="border border-border bg-bg/70 p-2"><span className="text-text-muted">Dedicated</span><div className="font-black text-amber">{boss.dedicatedDrops.join(' / ')}</div></div><div className="border border-border bg-bg/70 p-2"><span className="text-text-muted">Table Size</span><div className="font-black text-text-primary">{boss.dropTable.length} items</div></div></div>
      </Section>
    </div>
  );
};

const CraftingPanel: React.FC<CommonPanelProps & { playerMaterials: Record<string, number>; playerEssences: Record<string, number>; benchesFree: number; queues: { recipeId: string; benchId: number; startedAt: number; durationMs: number; claimedCount: number; count: number }[]; skillReductionPoints: number }> = ({ now, playerLevel, playerMaterials, playerEssences, benchesFree, queues, skillReductionPoints, startCrafting, onNavigate }) => {
  const craftable = CRAFTING_RECIPES.map((recipe) => ({ recipe, check: canStartCraft(recipe.id, playerMaterials, playerEssences, playerLevel), duration: getCraftTimeWithReduction(recipe.craftTimeMs, skillReductionPoints) }));
  const canNow = craftable.filter(({ check }) => check.can).slice(0, 6);
  const blocked = craftable.filter(({ check }) => !check.can).slice(0, 4);
  return (
    <div className="space-y-3">
      <Section title="Bench Command" eyebrow="Crafting workspace" icon={Hammer}>
        <div className="grid grid-cols-3 gap-2"><StatChip label="Free" value={benchesFree} accent={benchesFree ? 'text-green' : 'text-red'} /><StatChip label="Queued" value={queues.length} /><StatChip label="Craftable" value={canNow.length} accent="text-amber" /></div>
        <button type="button" onClick={startCrafting} className="mt-3 bl-primary w-full py-2 text-xs font-black">Set Crafting As Current Action</button>
      </Section>
      {queues.length > 0 && <Section title="Active Bench Queues" eyebrow="Machine deck" icon={Clock}><div className="space-y-2">{queues.map((q) => { const recipe = CRAFTING_RECIPES.find((r) => r.id === q.recipeId); const elapsed = now - q.startedAt; return <div key={`${q.benchId}-${q.recipeId}`} className="border border-border bg-bg/70 p-2"><div className="flex justify-between gap-2 text-xs"><span className="font-black text-text-primary">Bench {q.benchId}: {recipe?.name ?? q.recipeId}</span><span className="text-amber">{formatDuration(Math.max(0, q.durationMs - (elapsed % q.durationMs)))}</span></div><Meter label="Cycle" value={elapsed % q.durationMs} max={q.durationMs} detail={`${q.claimedCount}/${q.count} claimed`} /></div>; })}</div></Section>}
      <Section title="Craftable Now" eyebrow="Available recipes" icon={Sparkles}>
        <div className="grid gap-2">{canNow.map(({ recipe, duration }) => <button key={recipe.id} type="button" onClick={() => onNavigate?.('workshop')} className="border-2 border-border bg-bg/70 p-2 text-left" style={smallClip}><div className="flex justify-between gap-2"><span className="text-xs font-black text-text-primary">{recipe.name}</span><span className="text-[9px] text-amber">{formatDuration(duration)}</span></div><div className="mt-1 text-[10px] text-text-muted">{recipe.category} · {Object.entries(recipe.materials).map(([k, v]) => `${k} ${v}`).join(' · ')}</div></button>)}</div>
      </Section>
      <Section title="Blocked Recipes" eyebrow="What to farm next" icon={AlertTriangle}>
        <div className="space-y-2">{blocked.map(({ recipe, check }) => <div key={recipe.id} className="border border-border bg-bg/70 p-2"><div className="text-xs font-black text-text-primary">{recipe.name}</div><div className="mt-1 text-[10px] text-red">{check.missing.join(' · ')}</div></div>)}</div>
      </Section>
    </div>
  );
};

const SalvagePanel: React.FC<CommonPanelProps & { items: GearItem[] }> = ({ items, startSalvage, onNavigate }) => {
  const candidates = items.filter((item) => !item.isLocked && (item.rarity === Rarity.Common || item.rarity === Rarity.Uncommon)).slice(0, 8);
  const totals = candidates.reduce((acc, item) => {
    const y = calculateSalvageYield(item);
    acc.scrapAlloy += y.scrapAlloy;
    acc.ballisticParts += y.ballisticParts;
    acc.reactiveComponents += y.reactiveComponents;
    acc.techFragments += y.techFragments;
    acc.voidDust += y.voidDust;
    Object.entries(y.essences).forEach(([k, v]) => { acc.essences[k] = (acc.essences[k] || 0) + v; });
    return acc;
  }, { scrapAlloy: 0, ballisticParts: 0, reactiveComponents: 0, techFragments: 0, voidDust: 0, essences: {} as Record<string, number> });
  return (
    <div className="space-y-3">
      <Section title="Scrap Forecast" eyebrow="Salvage workspace" icon={Recycle}>
        <div className="grid grid-cols-5 gap-1.5 text-[9px]"><StatChip label="Items" value={candidates.length} /><StatChip label="Alloy" value={totals.scrapAlloy} /><StatChip label="Parts" value={totals.ballisticParts} /><StatChip label="Tech" value={totals.techFragments} /><StatChip label="Void" value={totals.voidDust} /></div>
        <button type="button" onClick={() => startSalvage(candidates[0])} disabled={!candidates[0]} className="mt-3 bl-primary w-full py-2 text-xs font-black disabled:opacity-50">Set Top Candidate As Salvage Action</button>
      </Section>
      <Section title="Recommended Breakdown" eyebrow="Safe candidates" icon={Boxes}>
        <div className="space-y-2">{candidates.map((item) => { const y = calculateSalvageYield(item); return <button key={item.id} type="button" onClick={() => startSalvage(item)} className="w-full border-2 border-border bg-bg/70 p-2 text-left" style={smallClip}><div className="flex justify-between gap-2"><span className="truncate text-xs font-black text-text-primary">{item.name}</span><span className="text-[9px] text-amber">{item.rarity}</span></div><div className="mt-1 text-[10px] text-text-muted">+{y.scrapAlloy} alloy · +{y.ballisticParts} parts · +{y.reactiveComponents} reactive · +{y.techFragments} tech</div></button>; })}</div>
        {candidates.length === 0 && <div className="text-xs text-text-muted">No safe low-rarity candidates. Open Gear to pick a specific item.</div>}
        <button type="button" onClick={() => onNavigate?.('loot')} className="mt-3 bl-secondary w-full py-2 text-xs font-black text-amber">Open Gear Yard</button>
      </Section>
    </div>
  );
};

const WorkshopPanel: React.FC<CommonPanelProps & { queues: { id?: string; recipeId: string; benchId: number; startedAt: number; durationMs: number; claimedCount: number; count: number }[]; benchesFree: number }> = ({ now, queues, benchesFree, onNavigate }) => (
  <div className="space-y-3">
    <Section title="Service Bay" eyebrow="Workshop workspace" icon={Wrench}>
      <div className="grid grid-cols-3 gap-2"><StatChip label="Free" value={benchesFree} accent={benchesFree ? 'text-green' : 'text-red'} /><StatChip label="Running" value={queues.length} /><StatChip label="Ready" value={queues.filter((q) => Math.floor((now - q.startedAt) / q.durationMs) > q.claimedCount).length} accent="text-amber" /></div>
    </Section>
    <Section title="Machine Queue" eyebrow="What needs attention" icon={Clock}>
      <div className="space-y-2">{queues.length === 0 ? <div className="text-xs text-text-muted">No queues are running. Start a recipe from the Workshop.</div> : queues.map((q) => { const recipe = CRAFTING_RECIPES.find((r) => r.id === q.recipeId); const elapsed = now - q.startedAt; const completed = Math.min(q.count, Math.floor(elapsed / q.durationMs)); return <div key={q.id ?? `${q.benchId}-${q.recipeId}`} className="border border-border bg-bg/70 p-2"><div className="flex justify-between"><span className="text-xs font-black text-text-primary">Bench {q.benchId}</span><span className={completed > q.claimedCount ? 'text-green text-[10px] font-black' : 'text-amber text-[10px]'}>{completed > q.claimedCount ? 'READY' : formatDuration(Math.max(0, q.durationMs - (elapsed % q.durationMs)))}</span></div><div className="mt-1 text-[10px] text-text-muted">{recipe?.name ?? q.recipeId} · {completed}/{q.count} complete</div><Meter label="cycle" value={elapsed % q.durationMs} max={q.durationMs} /></div>; })}</div>
      <button type="button" onClick={() => onNavigate?.('workshop')} className="mt-3 bl-primary w-full py-2 text-xs font-black">Open Workshop</button>
    </Section>
  </div>
);

const MarketPanel: React.FC<CommonPanelProps & { listings: number; history: number; sellableItems: GearItem[]; credits: number }> = ({ listings, history, sellableItems, credits, startMarket, onNavigate }) => {
  const topSellable = sellableItems.slice(0, 5);
  return (
    <div className="space-y-3">
      <Section title="Trade Kiosk" eyebrow="Market workspace" icon={ShoppingCart}>
        <div className="grid grid-cols-4 gap-2"><StatChip label="Credits" value={credits.toLocaleString()} /><StatChip label="Sellable" value={sellableItems.length} /><StatChip label="Listed" value={listings} /><StatChip label="History" value={history} /></div>
        <button type="button" onClick={startMarket} className="mt-3 bl-primary w-full py-2 text-xs font-black">Set Market Listing As Current Action</button>
      </Section>
      <Section title="Listing Candidates" eyebrow="Unlocked gear" icon={Package}>
        <div className="space-y-2">{topSellable.length === 0 ? <div className="text-xs text-text-muted">No unlocked sellable gear. Unlock items from Gear first.</div> : topSellable.map((item) => { const isWeapon = 'weaponType' in item; const price = isWeapon ? Math.round((item as Weapon).combatPower * 10 + (item as Weapon).rollQuality * 50) : Math.round((item.level ?? 1) * 200); return <button key={item.id} type="button" onClick={() => onNavigate?.('market')} className="w-full border border-border bg-bg/70 p-2 text-left"><div className="flex justify-between gap-2"><span className="truncate text-xs font-black text-text-primary">{item.name}</span><span className="text-[10px] text-amber">~{price.toLocaleString()}cr</span></div><div className="mt-1 text-[10px] text-text-muted">Fee estimate {(price * 0.1).toFixed(0)}cr · {describeGear(item)}</div></button>; })}</div>
        <button type="button" onClick={() => onNavigate?.('market')} className="mt-3 bl-secondary w-full py-2 text-xs font-black text-amber">Open Market</button>
      </Section>
    </div>
  );
};

const IdlePanel: React.FC<Partial<CommonPanelProps>> = ({ startRoam, startPrep, startCrafting, startSalvage, startWorkshop, startMarket, onNavigate, selectedArea }) => (
  <div className="space-y-3">
    <Section title="Recommended Dispatch" eyebrow="No action active" icon={Activity}>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => startRoam?.()} className="border-2 border-amber/40 bg-amber/10 p-3 text-left" style={panelClip}><Radar size={17} className="text-amber" /><div className="mt-2 text-sm font-black text-text-primary">Start Roam</div><div className="text-[10px] text-text-muted">{selectedArea?.name ?? 'Default route'}</div></button>
        <button type="button" onClick={() => startPrep?.()} className="border-2 border-border bg-bg/70 p-3 text-left" style={panelClip}><Skull size={17} className="text-red" /><div className="mt-2 text-sm font-black text-text-primary">Prep Boss</div><div className="text-[10px] text-text-muted">Check counters first</div></button>
        <button type="button" onClick={() => startCrafting?.()} className="border-2 border-border bg-bg/70 p-3 text-left" style={panelClip}><Hammer size={17} className="text-amber" /><div className="mt-2 text-sm font-black text-text-primary">Craft</div><div className="text-[10px] text-text-muted">Recipes and benches</div></button>
        <button type="button" onClick={() => startSalvage?.()} className="border-2 border-border bg-bg/70 p-3 text-left" style={panelClip}><Recycle size={17} className="text-green" /><div className="mt-2 text-sm font-black text-text-primary">Salvage</div><div className="text-[10px] text-text-muted">Break down low gear</div></button>
        <button type="button" onClick={() => startWorkshop?.()} className="border-2 border-border bg-bg/70 p-3 text-left" style={panelClip}><Wrench size={17} className="text-cyan" /><div className="mt-2 text-sm font-black text-text-primary">Workshop</div><div className="text-[10px] text-text-muted">Service queues</div></button>
        <button type="button" onClick={() => startMarket?.()} className="border-2 border-border bg-bg/70 p-3 text-left" style={panelClip}><ShoppingCart size={17} className="text-amber" /><div className="mt-2 text-sm font-black text-text-primary">Market</div><div className="text-[10px] text-text-muted">List gear</div></button>
      </div>
      <button type="button" onClick={() => onNavigate?.('chest')} className="mt-3 bl-secondary w-full py-2 text-xs font-black text-amber">Open Caches</button>
    </Section>
  </div>
);

export const ActionScreenContextual: React.FC<{ onOpenBossSelect: () => void; onNavigate?: (screen: string) => void }> = ({ onOpenBossSelect, onNavigate }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const loadoutStore = useLoadoutStore();
  const idle = useIdleStore();
  const activity = useActivityStore();
  const workshop = useWorkshopStore();
  const market = useMarketStore();
  const skillStore = useSkillStore();
  const skillBonuses = skillStore.getBonuses();
  const [showSwitch, setShowSwitch] = useState(false);
  const [showAreaSelect, setShowAreaSelect] = useState(false);
  const [prepBoss, setPrepBoss] = useState<BossDef | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [feed, setFeed] = useState<RunVisualEvent[]>([idleEvent]);
  const prevLevelRef = useRef(player.level);

  const selectedArea = getRoamingArea(idle.selectedRoamingAreaId);
  const currentKind = activity.current.kind;
  const currentBoss = bossStore.currentBossId ? REGION_1_BOSSES.find((b) => b.id === bossStore.currentBossId) : null;
  const prepBossTarget = currentBoss ?? REGION_1_BOSSES.find((b) => bossStore.unlockedBossIds.includes(b.id) && !bossStore.defeatedBossIds.includes(b.id)) ?? REGION_1_BOSSES[0];
  const bestBossWeapon = useMemo(() => inventory.getWeapons().sort((a, b) => b.bossPower - a.bossPower)[0], [inventory]);
  const activityWeapon: Weapon | undefined = loadoutStore.getWeapon('primary') ?? loadoutStore.getWeapon('secondary') ?? loadoutStore.getWeapon('heavy') ?? bestBossWeapon;
  const equippedCount = Object.values(loadoutStore.slots).filter(Boolean).length;
  const fightPower = loadoutStore.getWeapon('primary')?.bossPower || bestBossWeapon?.bossPower || 0;
  const isRoaming = currentKind === 'roaming_loot';
  const activeRoamingAreaId = activity.current.targetType === 'roaming_area' ? activity.current.targetId : null;
  const canTick = isRoaming && activeRoamingAreaId === selectedArea.id && !activity.pending;
  const activeMinutes = Math.floor((elapsed * TICK_SECONDS) / 60);
  const activeSeconds = (elapsed * TICK_SECONDS) % 60;
  const creditsPerTick = Math.round((selectedArea.idleCreditsPerMinute / 20) * (1 + (skillBonuses.offlineEarnings || 0)));
  const scrapPerTick = Math.round((selectedArea.idleScrapPerMinute / 20) * (1 + (skillBonuses.scrapYield || 0)));
  const targetLabel = activity.current.targetLabel ?? (currentKind === 'idle_standby' || currentKind === 'none' ? 'No target selected' : selectedArea.name);
  const detail = copy[currentKind] ?? copy.idle_standby;
  const visualBoss = currentKind === 'boss_prep' || currentKind === 'boss_fight' ? prepBossTarget : undefined;
  const visualFeed = currentKind === 'idle_standby' || currentKind === 'none' ? feed : feed.filter((event) => event.id !== 'idle-loop-ready');
  const bosses = REGION_1_BOSSES.filter((boss) => bossStore.unlockedBossIds.includes(boss.id) || boss.level <= player.level + 5).slice(0, 8);
  const benchesFree = Math.max(0, workshop.unlockedBenchCount - new Set(workshop.activeQueues.map((q) => q.benchId)).size);
  const sellableItems = inventory.items.filter((item) => !item.isLocked);
  const playerListings = market.listings.filter((listing) => listing.sellerId === 'player_1').length;
  const skillReductionPoints = (skillBonuses.consumableEfficiency || 0) * 10;

  const pushEvents = useCallback((events: RunVisualEvent[]) => {
    setFeed((current) => [...sortRunEventsByVisualPriority(events), ...current.filter((event) => event.id !== 'idle-loop-ready')].slice(0, LOG_LIMIT));
  }, []);

  const startAction = useCallback(async (input: StartActivityInput, event: RunVisualEvent) => {
    try {
      await activity.start(input);
      idle.setFarming(input.kind === 'roaming_loot');
      setElapsed(0);
      setShowSwitch(false);
      pushEvents([event]);
    } catch (error) {
      pushEvents([makeRunEvent('ACTION FAILED', error instanceof Error ? error.message : 'The action service rejected the transition.', 'patrol', 'run_stopped')]);
    }
  }, [activity, idle, pushEvents]);

  const startRoam = useCallback((area: RoamingAreaDef = selectedArea) => {
    idle.setSelectedRoamingArea(area.id);
    startAction(buildRoamingLootActivity(area, activityWeapon), makeRunEvent('ROAM STARTED', `${area.name} is now the current route.`, 'patrol', 'run_started'));
  }, [activityWeapon, idle, selectedArea, startAction]);

  const startPrep = useCallback((boss: BossDef = prepBossTarget) => {
    if (!boss) { onOpenBossSelect(); return; }
    startAction(buildBossPrepActivity(boss, activityWeapon), makeRunEvent('BOSS PREP', `${boss.name} is now the current prep target.`, 'patrol', 'boss_prep'));
    setPrepBoss(boss);
  }, [activityWeapon, onOpenBossSelect, prepBossTarget, startAction]);

  const startCrafting = useCallback(() => {
    startAction(buildCraftingActivity({ id: 'workshop-crafting', name: 'Workbench Crafting', category: 'gear' }, null), makeRunEvent('CRAFTING', 'Workbench crafting is now the visible character action.', 'patrol', 'crafting'));
  }, [startAction]);

  const startSalvage = useCallback((item?: GearItem) => {
    const target = item ?? inventory.items.find((candidate) => !candidate.isLocked && (candidate.rarity === Rarity.Common || candidate.rarity === Rarity.Uncommon));
    if (!target) { onNavigate?.('loot'); pushEvents([makeRunEvent('NO GEAR', 'No safe salvage candidate is available yet.', 'patrol', 'idle')]); return; }
    startAction(buildSalvagingActivity(target), makeRunEvent('SALVAGING', `${target.name} is now the visible salvage action.`, 'patrol', 'salvaging'));
  }, [inventory.items, onNavigate, pushEvents, startAction]);

  const startWorkshop = useCallback(() => {
    startAction({ kind: 'workshop_service', targetType: 'workshop_job', targetId: 'workshop-service', targetLabel: 'Workshop Service', sceneKey: 'workshop:service', notes: 'Servicing workshop queues', publicPayload: { activity_label: 'Servicing Workshop', target_label: 'Workshop Service', scene_key: 'workshop:service' }, publicVisible: true }, makeRunEvent('WORKSHOP SERVICE', 'Runner is servicing workshop machines and queues.', 'patrol', 'crafting'));
  }, [startAction]);

  const startMarket = useCallback(() => {
    startAction({ kind: 'market_listing', targetType: 'market_listing', targetId: 'market-console', targetLabel: 'Trade Kiosk', sceneKey: 'market:kiosk', notes: 'Managing market listings', publicPayload: { activity_label: 'Managing Market Listings', target_label: 'Trade Kiosk', scene_key: 'market:kiosk' }, publicVisible: true }, makeRunEvent('MARKET LISTING', 'Runner is working the trade kiosk.', 'patrol', 'market_listing'));
  }, [startAction]);

  const stopAction = useCallback(async () => {
    try {
      await activity.clear();
      idle.setFarming(false);
      setElapsed(0);
      setFeed([idleEvent]);
    } catch (error) {
      pushEvents([makeRunEvent('STOP FAILED', error instanceof Error ? error.message : 'The action service rejected the stop request.', 'patrol', 'run_stopped')]);
    }
  }, [activity, idle, pushEvents]);

  const createDrop = useCallback(() => {
    const kind = rollAreaDropKind(selectedArea);
    let item: GearItem;
    if (kind === 'weapon') item = inventory.generateAndAdd(buildAreaWeaponDropOptions(selectedArea, player.level));
    else if (kind === 'shield') item = inventory.generateAndAddShield(player.level);
    else if (kind === 'classMod') item = inventory.generateAndAddClassMod(player.level);
    else if (kind === 'relic') item = inventory.generateAndAddRelic(player.level);
    else item = inventory.generateAndAddOrdnance(player.level);
    return item;
  }, [inventory, player.level, selectedArea]);

  useEffect(() => {
    if (!market.seeded) market.seedMarket();
  }, [market]);

  useEffect(() => {
    if (player.level > prevLevelRef.current) pushEvents([makeRunEvent(`LEVEL ${player.level}`, 'XP crossed the next level threshold.', 'level', 'level_up')]);
    prevLevelRef.current = player.level;
  }, [player.level, pushEvents]);

  useEffect(() => {
    if (!canTick) return undefined;
    const iv = window.setInterval(() => {
      setElapsed((e) => e + 1);
      const events: RunVisualEvent[] = [];
      const drop = Math.random() < DROP_CHANCE_PER_TICK ? createDrop() : null;
      const cacheFound = Math.random() < CACHE_FRAGMENT_CHANCE_PER_TICK;
      const materialFound = Math.random() < MATERIAL_FIND_CHANCE_PER_TICK;
      if (cacheFound) { player.addCacheKeyFragments(1); events.push(makeRunEvent('CACHE FRAGMENT', `${selectedArea.enemyType} patrol yielded a cache key fragment.`, 'cache', 'cache_fragment')); }
      if (drop) events.push(makeRunEvent('GEAR DROP', `${drop.name} (${describeGear(drop)}) dropped in ${selectedArea.name}.`, 'loot', 'gear_drop'));
      if (!drop && !cacheFound && materialFound) {
        const find = rollAreaMaterialFind(selectedArea);
        if (find?.kind === 'material') { player.addMaterial(find.type, 1); events.push(makeRunEvent('MATERIAL FIND', `${find.type} recovered while sweeping ${selectedArea.name}.`, 'loot', 'material_find')); }
        if (find?.kind === 'essence') { player.addEssence(find.type, 1); events.push(makeRunEvent('ESSENCE FIND', `${find.type} essence recovered while sweeping ${selectedArea.name}.`, 'loot', 'material_find')); }
      }
      player.addCredits(creditsPerTick);
      player.addScrap(scrapPerTick);
      player.addXP(1);
      if (!events.length) events.push(makeRunEvent('ENEMY SWEEP', `${selectedArea.enemyType} routed. +1 XP / +${creditsPerTick}cr / +${scrapPerTick} scrap.`, 'xp', 'enemy_sweep'));
      pushEvents(events);
    }, TICK_SECONDS * 1000);
    return () => window.clearInterval(iv);
  }, [canTick, createDrop, creditsPerTick, player, pushEvents, scrapPerTick, selectedArea]);

  useEffect(() => {
    if (!canTick) return undefined;
    const iv = window.setInterval(() => { activity.heartbeat().catch((error) => console.warn('Action heartbeat skipped:', error)); }, 60000);
    return () => window.clearInterval(iv);
  }, [activity, canTick]);

  const now = useNow();

  const commonProps: CommonPanelProps = { now, playerLevel: player.level, currentKind, selectedArea, setSelectedArea: idle.setSelectedRoamingArea, startRoam, startPrep, openBoss: onOpenBossSelect, startCrafting, startSalvage, startWorkshop, startMarket, onNavigate };

  const workspace = (() => {
    if (currentKind === 'roaming_loot') return <RoamingPanel {...commonProps} feed={feed} creditsPerTick={creditsPerTick} scrapPerTick={scrapPerTick} />;
    if (currentKind === 'boss_prep') return <BossPrepPanel {...commonProps} bosses={bosses} currentBoss={prepBossTarget} fightPower={fightPower} />;
    if (currentKind === 'boss_fight') return <BossFightPanel boss={prepBossTarget} fightPower={fightPower} openBoss={onOpenBossSelect} />;
    if (currentKind === 'crafting') return <CraftingPanel {...commonProps} playerMaterials={player.materials} playerEssences={player.essences} benchesFree={benchesFree} queues={workshop.activeQueues} skillReductionPoints={skillReductionPoints} />;
    if (currentKind === 'salvaging') return <SalvagePanel {...commonProps} items={inventory.items} />;
    if (currentKind === 'workshop_service') return <WorkshopPanel {...commonProps} queues={workshop.activeQueues} benchesFree={benchesFree} />;
    if (currentKind === 'market_listing') return <MarketPanel {...commonProps} listings={playerListings} history={market.history.length} sellableItems={sellableItems} credits={player.credits} />;
    return <IdlePanel {...commonProps} />;
  })();

  const switchActions = [
    { label: 'Roam', detail: selectedArea.name, icon: Radar, run: () => startRoam() },
    { label: 'Boss Prep', detail: prepBossTarget?.name ?? 'Choose target', icon: Skull, run: () => startPrep() },
    { label: 'Craft', detail: `${CRAFTING_RECIPES.length} recipes`, icon: Hammer, run: startCrafting },
    { label: 'Salvage', detail: `${inventory.items.length} items`, icon: Recycle, run: () => startSalvage() },
    { label: 'Workshop', detail: `${workshop.activeQueues.length} queues`, icon: Wrench, run: startWorkshop },
    { label: 'Market', detail: `${sellableItems.length} sellable`, icon: ShoppingCart, run: startMarket },
    { label: 'Caches', detail: `${player.cacheKeys} keys`, icon: Package, run: () => { setShowSwitch(false); onNavigate?.('chest'); } },
  ].slice(0, MAX_SWITCH_ROWS);

  return (
    <div className="bl-page space-y-3 p-3 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div><div className="bl-title text-3xl leading-none text-text-primary">Action</div><div className="text-[9px] font-bold uppercase tracking-[0.2em] text-text-muted">contextual command workspace</div></div>
        <div className="flex gap-2"><button type="button" onClick={() => setShowSwitch(true)} className="bl-secondary px-3 py-2 text-[10px] font-black text-amber">Switch</button><button type="button" onClick={stopAction} disabled={activity.pending || currentKind === 'idle_standby' || currentKind === 'none'} className="bl-secondary px-3 py-2 text-[10px] font-black text-red disabled:opacity-50">Stop</button></div>
      </div>

      <LiveTurfDiorama area={selectedArea} weapon={activityWeapon} bossName={visualBoss?.name} bossWeaknessCount={visualBoss?.weaknesses.length ?? 0} playerLevel={player.level} equippedCount={equippedCount} cacheKeys={player.cacheKeys} feedEvents={visualFeed} activityKind={currentKind} activityLabel={detail.title} activityTarget={targetLabel} onFight={() => currentKind === 'roaming_loot' ? startRoam(selectedArea) : setShowSwitch(true)} onSecondary={() => setShowSwitch(true)} primaryActionLabel={currentKind === 'roaming_loot' ? 'Refresh route' : 'Switch action'} primaryActionDetail={currentKind === 'roaming_loot' ? selectedArea.enemyType : 'Open action drawer'} secondaryActionLabel="Switch" secondaryActionDetail="Change runner action" />

      <MobileCard className="space-y-3">
        <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-widest text-amber">Current Action</div><div className="text-lg font-black text-text-primary">{detail.title}</div><div className="text-xs leading-relaxed text-text-muted">{detail.detail}</div></div><div className="text-right text-[10px] text-text-muted"><Clock size={16} className="ml-auto" />{activeMinutes}m {activeSeconds}s</div></div>
        <div className="grid grid-cols-3 gap-2 text-center text-[10px]"><div className="border border-border bg-surface-raised p-2"><div className="text-text-muted">Target</div><div className="truncate font-bold text-text-primary">{targetLabel}</div></div><div className="border border-border bg-surface-raised p-2"><div className="text-text-muted">Keys</div><div className="font-bold text-amber">{player.cacheKeys} +{player.cacheKeyFragments}/5</div></div><div className="border border-border bg-surface-raised p-2"><div className="text-text-muted">Tick</div><div className="font-bold text-text-primary">{canTick ? `${TICK_SECONDS}s live` : 'paused'}</div></div></div>
      </MobileCard>

      {workspace}

      <AnimatePresence>
        {showSwitch && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={() => setShowSwitch(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="w-full max-h-[82vh] overflow-y-auto rounded-t-2xl border-t-2 border-border bg-bg p-4" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between"><div><div className="bl-title text-2xl text-text-primary">Switch Action</div><div className="text-[10px] text-text-muted">This drawer replaces the old full-screen action grid.</div></div><button type="button" onClick={() => setShowSwitch(false)} className="bl-secondary p-2 text-text-muted"><ChevronDown size={16} /></button></div>
              <div className="space-y-2">{switchActions.map(({ label, detail: rowDetail, icon: Icon, run }) => <button key={label} type="button" onClick={run} className="w-full border-2 border-border bg-surface p-3 text-left" style={smallClip}><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center border-2 border-border bg-bg text-amber"><Icon size={18} /></div><div className="min-w-0 flex-1"><div className="text-sm font-black text-text-primary">{label}</div><div className="truncate text-[10px] text-text-muted">{rowDetail}</div></div></div></button>)}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{showAreaSelect && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 overflow-y-auto bg-bg/90 p-4 backdrop-blur-sm"><div className="mx-auto max-w-lg space-y-3 pb-10"><div className="sticky top-0 flex items-center justify-between bg-bg/95 py-2"><div><div className="text-xs font-bold uppercase tracking-wider text-amber">Select Roaming Area</div><div className="text-[10px] text-text-muted">Changing turf does not produce rewards until Roam is started or switched.</div></div><button onClick={() => setShowAreaSelect(false)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-raised text-text-primary" aria-label="Close area selector"><X size={16} /></button></div>{ROAMING_AREAS.map((area) => { const unlocked = isRoamingAreaUnlocked(area, player.level); const selected = area.id === selectedArea.id; return <button key={area.id} disabled={!unlocked} onClick={() => { if (!unlocked) return; idle.setSelectedRoamingArea(area.id); setShowAreaSelect(false); }} className={`w-full border p-3 text-left ${selected ? 'border-amber/40 bg-amber/10' : 'border-border bg-surface'} ${!unlocked ? 'opacity-60' : ''}`} style={panelClip}><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-black text-text-primary">{area.name}</div><div className="text-[10px] text-text-muted">{area.manufacturerInfluence} / Lv.{area.unlockLevel} / {area.dangerRating}</div></div>{selected && <span className="text-[9px] font-black uppercase tracking-widest text-amber">Current</span>}</div><div className="mt-2 text-xs leading-relaxed text-text-secondary">{area.gameplayIdentity}</div><div className="mt-1 text-[10px] text-text-muted">Enemies: {area.enemyType}</div><div className="mt-1 text-[10px] text-amber">{unlocked ? area.selectionHint : `Locked until level ${area.unlockLevel}.`}</div></button>; })}</div></motion.div>)}</AnimatePresence>
      <AnimatePresence>{prepBoss && <BossPrepModal boss={prepBoss} onClose={() => setPrepBoss(null)} />}</AnimatePresence>
    </div>
  );
};
