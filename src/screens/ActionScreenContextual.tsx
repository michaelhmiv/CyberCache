import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNow } from '@/hooks/useNow';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Clock,
  Crosshair,
  Hammer,
  Package,
  Radar,
  Recycle,
  ShoppingCart,
  Skull,
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
  useSurvivalStore,
  useWorkshopStore,
} from '@/store';
import { BossPrepModal } from '@/components/fight/BossPrepModal';
import { MobileCard } from '@/components/layout/MobileCard';
import {
  ActionFeed,
  ContextualPickerSheet,
  RewardIntelPanel,
  type ActionFeedEntry,
} from '@/components/action/ActionWorkspace';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { ActionLoadout } from '@/components/action/ActionLoadout';
import { ActivityModifierPanel } from '@/components/action/ActivityModifierPanel';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { computeFightPower } from '@/lib/stats/fightPower';
import { CRAFTING_RECIPES } from '@/constants/craftingRecipes';
import {
  ROAMING_AREAS,
  getRoamingArea,
  isRoamingAreaUnlocked,
  type RoamingAreaDef,
} from '@/constants/roamingAreas';
import { calculateSalvageYield } from '@/constants/salvageRules';
import {
  buildBossFightActivity,
  buildBossPrepActivity,
  buildCraftingActivity,
  buildRoamingLootActivity,
  buildSalvagingActivity,
} from '@/lib/activity/activityBuilders';
import { canStartCraft, getCraftTimeWithReduction } from '@/lib/craftingEngine';
import { makeRunEvent, type RunVisualEvent } from '@/lib/run/runEvents';
import { useTickFeedStore } from '@/store/slices/tickSlice';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import { serverItemRowToDisplayGear, type ServerItemRow } from '@/lib/supabase/serverItemAdapter';
import type { ActivityKind, StartActivityInput } from '@/types/activity';
import type { GearItem, Weapon } from '@/types/items';
import type { BossDef } from '@/types/boss';
import { Rarity } from '@/types/game';
import { ResourceBar } from '@/components/layout/ResourceBar';

const TICK_SECONDS = 3;
const LOG_LIMIT = 10;
const DROP_CHANCE_PER_TICK = 0.22;
const CACHE_FRAGMENT_CHANCE_PER_TICK = 0.03;
const MATERIAL_FIND_CHANCE_PER_TICK = 0.08;
const MAX_SWITCH_ROWS = 8;

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const smallClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const copy: Record<ActivityKind, { title: string; detail: string }> = {
  none: { title: 'No Action', detail: 'Choose what the hunter should do next.' },
  idle_standby: { title: 'Standby', detail: 'Hunter is visible but not producing rewards.' },
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
  detail: 'Choose a hunter action. The workspace below changes to the current action.',
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

const Section: React.FC<{ title: string; eyebrow?: string; children: React.ReactNode; icon?: React.ElementType; action?: React.ReactNode }> = ({ title, eyebrow, children, icon: Icon, action }) => (
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
      {action}
    </div>
    <div className="relative">{children}</div>
  </MobileCard>
);

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
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Rates</span><div className="font-black text-text-primary">{area.idleCreditsPerMinute}cr/min</div></div>
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Loot</span><div className="truncate font-black text-amber">{area.lootBias[0]}</div></div>
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Rarity</span><div className="font-black text-text-primary">{bestRarity?.[0]}</div></div>
      </div>
      <div className="relative mt-2 text-[9px] text-text-muted">{unlocked ? area.selectionHint : `Locked until level ${area.unlockLevel}.`}</div>
    </div>
  );
};

const GearInspectModal: React.FC<{ item: GearItem | null; onClose: () => void }> = ({ item, onClose }) => {
  if (!item) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <motion.div initial={{ y: 20, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: 0.96 }} className="w-full max-w-sm border-2 border-border bg-bg p-4" style={panelClip} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">Gear Inspect</div>
            <div className="text-lg font-black text-text-primary">{item.name}</div>
            <div className="text-xs text-text-muted">{describeGear(item)} · Lv.{item.level}</div>
          </div>
          <button type="button" onClick={onClose} className="bl-secondary p-2 text-text-muted"><X size={14} /></button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
          <div className="border border-border bg-surface p-2"><span className="text-text-muted">Rarity</span><div className="font-black text-amber">{item.rarity}</div></div>
          <div className="border border-border bg-surface p-2"><span className="text-text-muted">Source</span><div className="font-black text-text-primary">{'sourceTag' in item ? item.sourceTag : 'Action reward'}</div></div>
        </div>
        {'weaponType' in item && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
            <div className="border border-border bg-surface p-2"><span className="text-text-muted">Power</span><div className="font-black text-text-primary">{item.combatPower}</div></div>
            <div className="border border-border bg-surface p-2"><span className="text-text-muted">Element</span><div className="font-black text-amber">{item.element}</div></div>
            <div className="border border-border bg-surface p-2"><span className="text-text-muted">Maker</span><div className="truncate font-black text-text-primary">{item.manufacturer}</div></div>
          </div>
        )}
        <button type="button" onClick={onClose} className="mt-4 bl-primary w-full py-2 text-xs font-black">Close Inspect</button>
      </motion.div>
    </motion.div>
  );
};

type CommonPanelProps = {
  playerLevel: number;
  selectedArea: RoamingAreaDef;
  setSelectedArea: (id: string) => void;
  startRoam: (area?: RoamingAreaDef) => void;
  startPrep: (boss?: BossDef) => void;
  startBossFight: (boss?: BossDef) => void;
  openBoss: () => void;
  startCrafting: () => void;
  startSalvage: (item?: GearItem) => void;
  startWorkshop: () => void;
  startMarket: () => void;
  onNavigate?: (screen: string) => void;
};

const BossPrepPanel: React.FC<CommonPanelProps & { bosses: BossDef[]; currentBoss?: BossDef; fightPower: number; onBossPicker: () => void }> = ({ currentBoss, fightPower, startBossFight, onBossPicker }) => {
  const boss = currentBoss;
  if (!boss) return null;
  const readiness = Math.min(140, Math.round((fightPower / Math.max(1, boss.recommendedPower)) * 100));
  return (
    <div className="space-y-3">
      <RewardIntelPanel
        title={`${boss.name} readiness`}
        eyebrow="boss prep intel"
        stats={[
          { label: 'Boss Lv', value: boss.level },
          { label: 'Need', value: boss.recommendedPower },
          { label: 'You', value: fightPower, tone: readiness >= 100 ? 'green' : 'red' },
          { label: 'Ready', value: `${readiness}%`, tone: readiness >= 100 ? 'green' : 'red' },
          { label: 'Cost', value: boss.entryCost, tone: 'cyan' },
          { label: 'Drops', value: boss.dedicatedDrops.length, tone: 'amber' },
        ]}
      >
        Weak: {boss.weaknesses.join(' / ') || 'None'}. Resist: {boss.resistances.join(' / ') || 'None'}. Dedicated drops: {boss.dedicatedDrops.join(' / ') || 'Unknown'}.
      </RewardIntelPanel>
      <Section title="Phase Checklist" eyebrow="prep targets" icon={Target} action={<button type="button" onClick={onBossPicker} className="bl-secondary px-2 py-1 text-[9px] font-black text-amber">Change Boss</button>}>
        <div className="space-y-2">
          {boss.phases.map((phase, index) => (
            <div key={phase.id} className="border-2 border-border bg-bg/70 p-2" style={smallClip}>
              <div className="flex items-center justify-between gap-2"><div className="text-xs font-black text-text-primary">{index + 1}. {phase.name}</div><span className="text-[9px] font-black uppercase text-amber">{phase.type}</span></div>
              <div className="mt-1 text-[10px] leading-snug text-text-muted">{phase.description}</div>
              <div className="mt-2 flex flex-wrap gap-1">{phase.recommendedCounters.slice(0, 4).map((counter) => <span key={counter} className="border border-border bg-surface px-1.5 py-0.5 text-[9px] text-text-secondary">{counter}</span>)}</div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => startBossFight(boss)} className="mt-3 bl-primary w-full py-2 text-xs font-black">Start Boss Encounter</button>
      </Section>
    </div>
  );
};

const BossFightPanel: React.FC<{ boss?: BossDef; fightPower: number; openBoss: () => void }> = ({ boss, fightPower, openBoss }) => {
  if (!boss) return <Section title="No Boss Selected" icon={Skull}><button type="button" onClick={openBoss} className="bl-primary w-full py-2 text-xs font-black">Choose Boss</button></Section>;
  const readiness = Math.round((fightPower / Math.max(1, boss.recommendedPower)) * 100);
  return (
    <div className="space-y-3">
      <RewardIntelPanel
        title={`${boss.name} loot stakes`}
        eyebrow="encounter intel"
        stats={[
          { label: 'Power', value: fightPower, tone: readiness >= 100 ? 'green' : 'red' },
          { label: 'Need', value: boss.recommendedPower },
          { label: 'Phase', value: boss.phases.length },
          { label: 'Dedicated', value: boss.dedicatedDrops.length, tone: 'amber' },
          { label: 'Table', value: boss.dropTable.length },
          { label: 'Risk', value: readiness >= 100 ? 'Stable' : 'High', tone: readiness >= 100 ? 'green' : 'red' },
        ]}
      >
        Dedicated drops: {boss.dedicatedDrops.join(' / ')}. Current fight view is event-driven and ready for richer HP/phase resolution.
      </RewardIntelPanel>
      <Section title="Phase Breakdown" eyebrow="encounter replay" icon={Crosshair}>
        <div className="space-y-2">
          {boss.phases.map((phase, index) => {
            const pass = fightPower >= boss.recommendedPower * phase.targetValue;
            return <div key={phase.id} className="border border-border bg-bg/70 p-2"><div className="flex justify-between gap-2"><span className="text-xs font-black text-text-primary">{index + 1}. {phase.name}</span><span className={pass ? 'text-green text-[9px] font-black' : 'text-red text-[9px] font-black'}>{pass ? 'LIKELY PASS' : 'RISK'}</span></div><div className="mt-1 text-[10px] text-text-muted">{pass ? phase.successReason : phase.failureReason}</div></div>;
          })}
        </div>
      </Section>
    </div>
  );
};

const CraftingPanel: React.FC<CommonPanelProps & { playerMaterials: Record<string, number>; playerEssences: Record<string, number>; benchesFree: number; queues: { recipeId: string; benchId: number; startedAt: number; durationMs: number; claimedCount: number; count: number }[]; skillReductionPoints: number; onRecipePicker: () => void }> = ({ playerLevel, playerMaterials, playerEssences, benchesFree, queues, skillReductionPoints, startCrafting, onRecipePicker }) => {
  const now = useNow();
  const craftable = CRAFTING_RECIPES.map((recipe) => ({ recipe, check: canStartCraft(recipe.id, playerMaterials, playerEssences, playerLevel), duration: getCraftTimeWithReduction(recipe.craftTimeMs, skillReductionPoints) }));
  const canNow = craftable.filter(({ check }) => check.can);
  return (
    <div className="space-y-3">
      <RewardIntelPanel title="Bench output forecast" eyebrow="crafting intel" stats={[{ label: 'Free', value: benchesFree, tone: benchesFree ? 'green' : 'red' }, { label: 'Queued', value: queues.length }, { label: 'Craftable', value: canNow.length, tone: 'amber' }, { label: 'Recipes', value: CRAFTING_RECIPES.length }, { label: 'Reduction', value: `${skillReductionPoints}%`, tone: 'cyan' }, { label: 'Blocked', value: Math.max(0, CRAFTING_RECIPES.length - canNow.length), tone: 'red' }]}>Choose a recipe from the sheet; the action page stays focused on active output and queue status.</RewardIntelPanel>
      {queues.length > 0 && <Section title="Active Bench Queues" eyebrow="machine deck" icon={Clock}><div className="space-y-2">{queues.map((q) => { const recipe = CRAFTING_RECIPES.find((r) => r.id === q.recipeId); const elapsed = now - q.startedAt; return <div key={`${q.benchId}-${q.recipeId}`} className="border border-border bg-bg/70 p-2"><div className="flex justify-between gap-2 text-xs"><span className="font-black text-text-primary">Bench {q.benchId}: {recipe?.name ?? q.recipeId}</span><span className="text-amber">{formatDuration(Math.max(0, q.durationMs - (elapsed % q.durationMs)))}</span></div></div>; })}</div></Section>}
      <Section title="Recipe Control" eyebrow="selector moved" icon={Hammer}><button type="button" onClick={onRecipePicker} className="bl-primary w-full py-2 text-xs font-black">Choose Recipe</button><button type="button" onClick={startCrafting} className="mt-2 bl-secondary w-full py-2 text-xs font-black text-amber">Set Crafting As Current Action</button></Section>
    </div>
  );
};

const SalvagePanel: React.FC<CommonPanelProps & { items: GearItem[]; onSalvagePicker: () => void }> = ({ items, startSalvage, onNavigate, onSalvagePicker }) => {
  const candidates = items.filter((item) => !item.isLocked).slice(0, 8);
  const top = candidates[0];
  const y = top ? calculateSalvageYield(top) : null;
  return (
    <div className="space-y-3">
      <RewardIntelPanel title="Breakdown forecast" eyebrow="salvage intel" stats={[{ label: 'Candidates', value: candidates.length }, { label: 'Alloy', value: y?.scrapAlloy ?? 0, tone: 'green' }, { label: 'Parts', value: y?.ballisticParts ?? 0, tone: 'amber' }, { label: 'Reactive', value: y?.reactiveComponents ?? 0, tone: 'cyan' }, { label: 'Tech', value: y?.techFragments ?? 0 }, { label: 'Void', value: y?.voidDust ?? 0, tone: 'red' }]}>Top candidate: {top?.name ?? 'None'}. Higher rarity = dramatically more materials.</RewardIntelPanel>
      <Section title="Salvage Control" eyebrow="item selector" icon={Recycle}><button type="button" onClick={onSalvagePicker} className="bl-primary w-full py-2 text-xs font-black">Choose Item To Salvage</button><button type="button" onClick={() => startSalvage(top)} disabled={!top} className="mt-2 bl-secondary w-full py-2 text-xs font-black text-amber disabled:opacity-50">Set Top Candidate As Action</button><button type="button" onClick={() => onNavigate?.('loot')} className="mt-2 bl-secondary w-full py-2 text-xs font-black text-amber">Open Gear Yard</button></Section>
    </div>
  );
};

const WorkshopPanel: React.FC<CommonPanelProps & { queues: { id?: string; recipeId: string; benchId: number; startedAt: number; durationMs: number; claimedCount: number; count: number }[]; benchesFree: number }> = ({ queues, benchesFree, onNavigate }) => {
  const now = useNow();
  const ready = queues.filter((q) => Math.floor((now - q.startedAt) / q.durationMs) > q.claimedCount).length;
  return <div className="space-y-3"><RewardIntelPanel title="Machine queue" eyebrow="workshop intel" stats={[{ label: 'Free', value: benchesFree, tone: benchesFree ? 'green' : 'red' }, { label: 'Running', value: queues.length }, { label: 'Ready', value: ready, tone: ready ? 'amber' : 'muted' }, { label: 'Benches', value: benchesFree + queues.length }, { label: 'Next', value: queues[0] ? formatDuration(Math.max(0, queues[0].durationMs - ((now - queues[0].startedAt) % queues[0].durationMs))) : 'None' }, { label: 'State', value: ready ? 'Claim' : 'Service' }]} /> <Section title="Machine Queue" eyebrow="what needs attention" icon={Clock}><div className="space-y-2">{queues.length === 0 ? <div className="text-xs text-text-muted">No queues are running. Start a recipe from the Workshop.</div> : queues.map((q) => { const recipe = CRAFTING_RECIPES.find((r) => r.id === q.recipeId); const elapsed = now - q.startedAt; const completed = Math.min(q.count, Math.floor(elapsed / q.durationMs)); return <div key={q.id ?? `${q.benchId}-${q.recipeId}`} className="border border-border bg-bg/70 p-2"><div className="flex justify-between"><span className="text-xs font-black text-text-primary">Bench {q.benchId}</span><span className={completed > q.claimedCount ? 'text-green text-[10px] font-black' : 'text-amber text-[10px]'}>{completed > q.claimedCount ? 'READY' : formatDuration(Math.max(0, q.durationMs - (elapsed % q.durationMs)))}</span></div><div className="mt-1 text-[10px] text-text-muted">{recipe?.name ?? q.recipeId} · {completed}/{q.count} complete</div></div>; })}</div><button type="button" onClick={() => onNavigate?.('workshop')} className="mt-3 bl-primary w-full py-2 text-xs font-black">Open Workshop</button></Section></div>;
};

const MarketPanel: React.FC<CommonPanelProps & { listings: number; history: number; sellableItems: GearItem[]; credits: number; onMarketPicker: () => void }> = ({ listings, history, sellableItems, credits, startMarket, onMarketPicker, onNavigate }) => (
  <div className="space-y-3"><RewardIntelPanel title="Trade kiosk" eyebrow="market intel" stats={[{ label: 'Credits', value: credits.toLocaleString(), tone: 'cyan' }, { label: 'Sellable', value: sellableItems.length }, { label: 'Listed', value: listings, tone: 'amber' }, { label: 'History', value: history }, { label: 'Fees', value: '10%' }, { label: 'Mode', value: 'Listing' }]} /> <Section title="Listing Control" eyebrow="item selector" icon={ShoppingCart}><button type="button" onClick={onMarketPicker} className="bl-primary w-full py-2 text-xs font-black">Choose Listing Candidate</button><button type="button" onClick={startMarket} className="mt-2 bl-secondary w-full py-2 text-xs font-black text-amber">Set Market As Current Action</button><button type="button" onClick={() => onNavigate?.('market')} className="mt-2 bl-secondary w-full py-2 text-xs font-black text-amber">Open Market</button></Section></div>
);

const IdlePanel: React.FC<Partial<CommonPanelProps>> = ({ startRoam, startPrep, startCrafting, startSalvage, startWorkshop, startMarket, onNavigate, selectedArea }) => (
  <div className="space-y-3">
    <Section title="Recommended Dispatch" eyebrow="no action active" icon={Activity}>
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
  const survival = useSurvivalStore();
  const skillBonuses = skillStore.getBonuses();
  const [showSwitch, setShowSwitch] = useState(false);
  const [showAreaSelect, setShowAreaSelect] = useState(false);
  const [showBossPicker, setShowBossPicker] = useState(false);
  const [showRecipePicker, setShowRecipePicker] = useState(false);
  const [showSalvagePicker, setShowSalvagePicker] = useState(false);
  const [showMarketPicker, setShowMarketPicker] = useState(false);
  const [prepBoss, setPrepBoss] = useState<BossDef | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [inspectGear, setInspectGear] = useState<GearItem | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);
  // Tick feed events from the canonical ticker — the single source of truth
  // for roaming rewards. The Action screen is a consumer, not an engine.
  const tickEvents = useTickFeedStore((s) => s.events);
  const [feed, setFeed] = useState<RunVisualEvent[]>([idleEvent]);
  const [gearLookup, setGearLookup] = useState<Record<string, GearItem>>({});

  const selectedArea = getRoamingArea(idle.selectedRoamingAreaId);
  const currentKind = activity.current.kind;
  const equippedCount = Object.values(loadoutStore.slots).filter(Boolean).length;
  const currentBoss = bossStore.currentBossId ? REGION_1_BOSSES.find((b) => b.id === bossStore.currentBossId) : null;
  const prepBossTarget = currentBoss ?? REGION_1_BOSSES.find((b) => bossStore.unlockedBossIds.includes(b.id) && !bossStore.defeatedBossIds.includes(b.id)) ?? REGION_1_BOSSES[0];
  const bestBossWeapon = useMemo(() => inventory.getWeapons().sort((a, b) => b.bossPower - a.bossPower)[0], [inventory]);
  const activityWeapon: Weapon | undefined = loadoutStore.getWeapon('primary') ?? loadoutStore.getWeapon('secondary') ?? loadoutStore.getWeapon('heavy') ?? bestBossWeapon;
  const fightPower = useMemo(
    () =>
      computeFightPower(
        [loadoutStore.getWeapon('primary'), loadoutStore.getWeapon('secondary'), loadoutStore.getWeapon('heavy')],
        bestBossWeapon,
        currentBoss,
      ),
    [loadoutStore, currentBoss, bestBossWeapon],
  );
  const isRoaming = currentKind === 'roaming_loot';
  const activeRoamingAreaId = activity.current.targetType === 'roaming_area' ? activity.current.targetId : null;
  const canTick = isRoaming && activeRoamingAreaId === selectedArea.id && !activity.pending;

  // Display-only timer: increments elapsed once per second for the UI clock.
  // The actual reward tick is handled by the singleton ticker in idleTickerSlice.
  // MUST be below `canTick` — referencing it before declaration is a TDZ error.
  useEffect(() => {
    if (!canTick) return undefined;
    const iv = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(iv);
  }, [canTick]);
  const activeMinutes = Math.floor((elapsed * TICK_SECONDS) / 60);
  const activeSeconds = (elapsed * TICK_SECONDS) % 60;
  const creditsPerTick = Math.round((selectedArea.idleCreditsPerMinute / 20) * (1 + (skillBonuses.offlineEarnings || 0)));
  const scrapPerTick = Math.round((selectedArea.idleScrapPerMinute / 20) * (1 + (skillBonuses.scrapYield || 0)));
  const targetLabel = activity.current.targetLabel ?? (currentKind === 'idle_standby' || currentKind === 'none' ? 'No target selected' : selectedArea.name);
  const detail = copy[currentKind] ?? copy.idle_standby;
  // Merge tick-feed events (from the canonical ticker) with lifecycle events
  // (action start/stop, cache open). The ticker is the single source of truth
  // for roaming rewards; the Action screen is a consumer, not an engine.
  const tickDisplayEvents: Array<{ id: string; label: string; detail: string; tone: string; eventType?: string; value?: number; areaId?: string }> = tickEvents
    .filter((e) => !e.areaId || e.areaId === selectedArea.id)
    .slice(0, LOG_LIMIT);
  const visualFeed = (currentKind === 'idle_standby' || currentKind === 'none')
    ? feed
    : [...tickDisplayEvents, ...feed.filter((event) => event.id !== 'idle-loop-ready')].slice(0, LOG_LIMIT);
  const bosses = REGION_1_BOSSES.filter((boss) => bossStore.unlockedBossIds.includes(boss.id) || boss.level <= player.level + 5).slice(0, 8);
  const benchesFree = Math.max(0, workshop.unlockedBenchCount - new Set(workshop.activeQueues.map((q) => q.benchId)).size);
  const sellableItems = inventory.items.filter((item) => !item.isLocked);
  const playerListings = market.listings.filter((listing) => listing.sellerId === 'player_1').length;
  const skillReductionPoints = (skillBonuses.consumableEfficiency || 0) * 10;
  const salvageCandidates = inventory.items.filter((item) => !item.isLocked).slice(0, 12);
  const craftable = CRAFTING_RECIPES.map((recipe) => ({ recipe, check: canStartCraft(recipe.id, player.materials, player.essences, player.level), duration: getCraftTimeWithReduction(recipe.craftTimeMs, skillReductionPoints) }));
  const openCacheDetail = player.cacheKeys > 0 ? `${player.cacheKeys} keys ready` : `Need ${5 - player.cacheKeyFragments} fragments`;

  const pushEvents = useCallback((events: RunVisualEvent[]) => {
    setFeed((current) => [...events, ...current.filter((event) => event.id !== 'idle-loop-ready')].slice(0, LOG_LIMIT));
  }, []);

  const startAction = useCallback(async (input: StartActivityInput, event: RunVisualEvent) => {
    try {
      await activity.start(input);
      idle.setFarming(input.kind === 'roaming_loot');
      setElapsed(0);
      setShowSwitch(false);
      setShowAreaSelect(false);
      setShowBossPicker(false);
      setShowRecipePicker(false);
      setShowSalvagePicker(false);
      setShowMarketPicker(false);
      pushEvents([event]);
    } catch (error) {
      pushEvents([makeRunEvent('ACTION FAILED', error instanceof Error ? error.message : 'The action service rejected the transition.', 'patrol', 'run_stopped')]);
    }
  }, [activity, idle, pushEvents]);

  const startRoam = useCallback((area?: RoamingAreaDef) => {
    const target = area ?? selectedArea;
    idle.setSelectedRoamingArea(target.id);
    startAction(buildRoamingLootActivity(target, activityWeapon), makeRunEvent('ROAMING ROUTE', `Hunter is roaming ${target.name}.`, 'patrol', 'run_started'));
  }, [activityWeapon, idle, selectedArea, startAction]);

  const startPrep = useCallback((boss?: BossDef) => {
    const target = boss ?? prepBossTarget;
    if (!target) return;
    bossStore.setCurrentBoss(target.id);
    startAction(buildBossPrepActivity(target, activityWeapon), makeRunEvent('BOSS PREP', `Prep started for ${target.name}.`, 'patrol', 'boss_prep'));
  }, [activityWeapon, bossStore, prepBossTarget, startAction]);

  const startBossFight = useCallback((boss?: BossDef) => {
    const target = boss ?? prepBossTarget;
    if (!target) return;
    bossStore.setCurrentBoss(target.id);
    startAction(buildBossFightActivity(target, activityWeapon), makeRunEvent('BOSS FIGHT', `Encounter started against ${target.name}.`, 'xp', 'boss_fight'));
  }, [activityWeapon, bossStore, prepBossTarget, startAction]);

  const startCrafting = useCallback((recipe = craftable.find(({ check }) => check.can)?.recipe ?? CRAFTING_RECIPES[0]) => {
    if (!recipe) return;
    startAction(buildCraftingActivity(recipe, null), makeRunEvent('CRAFTING', `Bench focus set to ${recipe.name}.`, 'patrol', 'crafting'));
  }, [craftable, startAction]);

  const startSalvage = useCallback((item?: GearItem) => {
    const target = item ?? salvageCandidates[0];
    if (!target) {
      onNavigate?.('loot');
      return;
    }
    startAction(buildSalvagingActivity(target), makeRunEvent('SALVAGE TARGET', `${target.name} staged for breakdown.`, 'patrol', 'salvaging'));
  }, [onNavigate, salvageCandidates, startAction]);

  const startWorkshop = useCallback(() => {
    startAction({ kind: 'workshop_service', targetType: 'workshop_job', targetId: 'workshop-service', targetLabel: 'Machine Queue', sceneKey: 'workshop:service', notes: 'Servicing workshop queues', publicPayload: { activity_label: 'Servicing Workshop', target_label: 'Machine Queue', scene_key: 'workshop:service' }, publicVisible: true }, makeRunEvent('WORKSHOP SERVICE', 'Hunter is servicing bench queues.', 'patrol', 'workshop_service'));
  }, [startAction]);

  const startMarket = useCallback(() => {
    startAction({ kind: 'market_listing', targetType: 'market_listing', targetId: 'market-console', targetLabel: 'Trade Kiosk', sceneKey: 'market:kiosk', notes: 'Managing market listings', publicPayload: { activity_label: 'Managing Market Listings', target_label: 'Trade Kiosk', scene_key: 'market:kiosk' }, publicVisible: true }, makeRunEvent('MARKET LISTING', 'Hunter is working the trade kiosk.', 'patrol', 'market_listing'));
  }, [startAction]);

  // Diorama callbacks — route primary/secondary buttons to context-aware actions
  const onDioramaPrimary = useCallback(() => {
    if (currentKind === 'roaming_loot') {
      setShowAreaSelect(true);
    } else if (currentKind === 'idle_standby' || currentKind === 'none') {
      startRoam();
    } else if ((currentKind === 'boss_prep' || currentKind === 'boss_fight') && prepBossTarget) {
      startBossFight(prepBossTarget);
    } else {
      setShowSwitch(true);
    }
  }, [currentKind, startRoam, startBossFight, prepBossTarget]);

  const onDioramaSecondary = useCallback(() => {
    if (currentKind === 'boss_prep' || currentKind === 'boss_fight') {
      onOpenBossSelect();
    } else if (currentKind === 'roaming_loot') {
      setShowAreaSelect(true);
    } else {
      setShowSwitch(true);
    }
  }, [currentKind, onOpenBossSelect]);

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

  const openCache = useCallback(async () => {
    setCacheError(null);
    if (player.cacheKeys <= 0) {
      const msg = player.cacheKeyFragments > 0 ? `No cache key ready. Need ${5 - player.cacheKeyFragments} more fragments.` : 'No cache keys ready. Roam for cache fragments first.';
      setCacheError(msg);
      pushEvents([makeRunEvent('CACHE LOCKED', msg, 'cache', 'cache_locked')]);
      return;
    }
    try {
      pushEvents([makeRunEvent('CACHE OPENING', 'Decrypting server-verified cache roll.', 'cache', 'cache_opening')]);
      const result = await verifiedOps.makeItem();
      const item = serverItemRowToDisplayGear(result.item as ServerItemRow);
      const event = makeRunEvent('CACHE GEAR', `${item.name} (${describeGear(item)}) decrypted from a cache.`, 'loot', 'cache_opened');
      setGearLookup((current) => ({ ...current, [event.id]: item }));
      setInspectGear(item);
      pushEvents([event]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to open cache.';
      setCacheError(msg);
      pushEvents([makeRunEvent('CACHE FAILED', msg, 'cache', 'cache_failed')]);
    }
  }, [player.cacheKeyFragments, player.cacheKeys, pushEvents]);

  useEffect(() => {
    // market.seeded / market.seedMarket are not on the current MarketState type;
    // guard until the market store is wired. Pre-existing issue — not introduced here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (market.seeded === false && typeof (market as any).seedMarket === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (market as any).seedMarket();
    }
  }, [market]);

  useEffect(() => {
    if (!canTick) return undefined;
    const iv = window.setInterval(() => { activity.heartbeat().catch((error) => console.warn('Action heartbeat skipped:', error)); }, 60000);
    return () => window.clearInterval(iv);
  }, [activity, canTick]);

  const feedEntries: ActionFeedEntry[] = visualFeed.map((event) => ({
    ...event,
    gear: gearLookup[event.id],
    onInspect: gearLookup[event.id] ? () => setInspectGear(gearLookup[event.id]) : undefined,
  }));

  const commonProps: CommonPanelProps = { playerLevel: player.level, selectedArea, setSelectedArea: idle.setSelectedRoamingArea, startRoam, startPrep, startBossFight, openBoss: onOpenBossSelect, startCrafting, startSalvage, startWorkshop, startMarket, onNavigate };

  const workspace = (() => {
    // Roaming: intel + route control are baked into the diorama area.
    // Idle/standby: no panel — the compact action selector above handles starting actions.
    if (currentKind === 'roaming_loot') return null;
    if (currentKind === 'idle_standby' || currentKind === 'none') return null; // <-- replaced IdlePanel
    if (currentKind === 'boss_prep') return <BossPrepPanel {...commonProps} bosses={bosses} currentBoss={prepBossTarget} fightPower={fightPower} onBossPicker={() => setShowBossPicker(true)} />;
    if (currentKind === 'boss_fight') return <BossFightPanel boss={prepBossTarget} fightPower={fightPower} openBoss={onOpenBossSelect} />;
    if (currentKind === 'crafting') return <CraftingPanel {...commonProps} playerMaterials={player.materials} playerEssences={player.essences} benchesFree={benchesFree} queues={workshop.activeQueues} skillReductionPoints={skillReductionPoints} onRecipePicker={() => setShowRecipePicker(true)} />;
    if (currentKind === 'salvaging') return <SalvagePanel {...commonProps} items={inventory.items} onSalvagePicker={() => setShowSalvagePicker(true)} />;
    if (currentKind === 'workshop_service') return <WorkshopPanel {...commonProps} queues={workshop.activeQueues} benchesFree={benchesFree} />;
    if (currentKind === 'market_listing') return <MarketPanel {...commonProps} listings={playerListings} history={market.history.length} sellableItems={sellableItems} credits={player.credits} onMarketPicker={() => setShowMarketPicker(true)} />;
    return null; // fallback: no workspace panel needed
  })();

  const switchActions = [
    { label: 'Roam', detail: selectedArea.name, icon: Radar, run: () => startRoam() },
    { label: 'Boss Prep', detail: prepBossTarget?.name ?? 'Choose target', icon: Skull, run: () => startPrep() },
    { label: 'Boss Fight', detail: prepBossTarget?.name ?? 'Choose target', icon: Crosshair, run: () => startBossFight() },
    { label: 'Craft', detail: `${CRAFTING_RECIPES.length} recipes`, icon: Hammer, run: () => startCrafting() },
    { label: 'Salvage', detail: `${inventory.items.length} items`, icon: Recycle, run: () => startSalvage() },
    { label: 'Workshop', detail: `${workshop.activeQueues.length} queues`, icon: Wrench, run: startWorkshop },
    { label: 'Market', detail: `${sellableItems.length} sellable`, icon: ShoppingCart, run: startMarket },
    { label: 'Caches', detail: openCacheDetail, icon: Package, run: openCache },
  ].slice(0, MAX_SWITCH_ROWS);

  return (
    <div className="bl-page relative overflow-hidden space-y-3 p-3 pb-20">
      {/* Ambient glow blobs — matching Dashboard */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute left-5 top-20 h-48 w-48 rounded-full bg-amber/10 blur-3xl" />
        <div className="absolute right-2 top-72 h-48 w-48 rounded-full bg-red/10 blur-3xl" />
      </div>

      {/* Resource bar */}
      <ResourceBar className="px-4 pt-1" />

      {/* Title bar */}
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Action</div>
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-text-muted">contextual command workspace</div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowSwitch(true)} className="bl-secondary px-3 py-2 text-[10px] font-black text-amber">Switch</button>
          <button type="button" onClick={stopAction} disabled={activity.pending || currentKind === 'idle_standby' || currentKind === 'none'} className="bl-secondary px-3 py-2 text-[10px] font-black text-red disabled:opacity-50">Stop</button>
        </div>
      </div>

      {/* 1. Diorama — dashboard animation at top */}
      <LiveTurfDiorama
        area={selectedArea}
        weapon={activityWeapon}
        bossName={prepBossTarget?.name}
        bossWeaknessCount={currentBoss?.weaknesses.length ?? 0}
        boss={currentKind === 'boss_prep' || currentKind === 'boss_fight' ? (currentBoss ?? prepBossTarget) : undefined}
        playerLevel={player.level}
        equippedCount={equippedCount}
        cacheKeys={player.cacheKeys}
        activityKind={currentKind}
        activityLabel={detail.title}
        activityTarget={targetLabel}
        onFight={onDioramaPrimary}
        onSecondary={onDioramaSecondary}
        onTitleClick={() => setShowAreaSelect(true)}
        primaryActionLabel={
          currentKind === 'idle_standby' || currentKind === 'none' ? 'Start Roam'
          : currentKind === 'roaming_loot' ? 'Change Route'
          : currentKind === 'boss_prep' ? 'Start Fight'
          : 'Manage'
        }
        secondaryActionLabel={
          currentKind === 'boss_prep' || currentKind === 'boss_fight' ? 'Choose Boss'
          : currentKind === 'roaming_loot' ? 'Switch Area'
          : 'Switch Action'
        }
      />

      {/* 1b. Compact Action Selector — always at top, replaces IdlePanel */}
      <div className="relative overflow-hidden border-2 border-border bg-surface/95 p-3 shadow-[0_4px_14px_rgba(0,0,0,0.5)]" style={panelClip}>
        <div className="flex items-center gap-2 mb-2">
          <Activity size={15} className="text-amber shrink-0" />
          <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">
            {currentKind === 'idle_standby' || currentKind === 'none' ? 'Choose Action' : `${detail.title} · Controls`}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {switchActions.slice(0, 8).map(({ label, detail: rowDetail, icon: Icon, run }) => (
            <button
              key={label}
              type="button"
              onClick={run}
              className={`flex flex-col items-center justify-center gap-0.5 border-2 p-2 text-center transition-all active:scale-[0.96] ${
                (label === 'Roam' && currentKind === 'roaming_loot') ||
                (label === 'Boss Prep' && currentKind === 'boss_prep') ||
                (label === 'Boss Fight' && currentKind === 'boss_fight') ||
                (label === 'Craft' && currentKind === 'crafting') ||
                (label === 'Salvage' && currentKind === 'salvaging') ||
                (label === 'Workshop' && currentKind === 'workshop_service') ||
                (label === 'Market' && currentKind === 'market_listing')
                  ? 'border-amber/60 bg-amber/10'
                  : 'border-border/60 bg-bg/50 hover:border-amber/30'
              }`}
              style={smallClip}
            >
              <Icon size={16} className="text-amber" />
              <span className="text-[9px] font-black uppercase tracking-wide text-text-primary">{label}</span>
            </button>
          ))}
        </div>
        {currentKind !== 'idle_standby' && currentKind !== 'none' && (
          <div className="mt-2 pt-2 border-t border-border/40 text-[10px] text-text-muted text-center">
            {detail.detail} · Tap <span className="text-amber font-black">Switch</span> to change action
          </div>
        )}
      </div>

      {/* 2. Loadout — star-pattern gear constellation */}
      <ActionLoadout />

      {/* 2b. Activity modifiers — procedural gear bonuses for current action */}
      <ActivityModifierPanel activityKind={currentKind} />

      {/* 3. Compact status strip — HP / Keys / Tick */}
      <div className="flex gap-2 text-[10px]">
        <div className="flex-1 border-2 border-border bg-bg/70 px-2 py-1.5" style={smallClip}>
          <span className="text-text-muted">HP </span>
          <span className={`font-black ${survival.currentHp < survival.maxHp * 0.3 ? 'text-red' : survival.currentHp < survival.maxHp * 0.6 ? 'text-amber' : 'text-green'}`}>
            {Math.round(survival.currentHp)}/{Math.round(survival.maxHp)}
          </span>
        </div>
        <div className="flex-1 border-2 border-border bg-bg/70 px-2 py-1.5" style={smallClip}>
          <span className="text-text-muted">Keys </span>
          <span className="font-black text-cyan">{player.cacheKeys} +{player.cacheKeyFragments}/5</span>
        </div>
        <div className="flex-1 border-2 border-border bg-bg/70 px-2 py-1.5" style={smallClip}>
          <span className="text-text-muted">Tick </span>
          <span className={`font-black ${canTick ? 'text-green' : 'text-text-muted'}`}>
            {canTick ? `${activeMinutes}m ${activeSeconds}s` : 'paused'}
          </span>
        </div>
      </div>

      {/* 4. Action-specific panel — above the feed where it's visible */}
      {workspace}

      {/* 5. Cache error banner */}
      {cacheError && <div className="border-2 border-red/40 bg-red/10 p-2 text-xs font-bold text-red" style={smallClip}>{cacheError}</div>}

      {/* 6. Feed — loot log below the decision panels */}
      <ActionFeed entries={feedEntries} />

      {/* Drawers — unchanged */}
      <AnimatePresence>
        <ContextualPickerSheet open={showSwitch} title="Switch Action" detail="Broad action changes live in this drawer instead of crowding the Action tab." onClose={() => setShowSwitch(false)}>
          {switchActions.map(({ label, detail: rowDetail, icon: Icon, run }) => <button key={label} type="button" onClick={run} className="w-full border-2 border-border bg-surface p-3 text-left" style={smallClip}><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center border-2 border-border bg-bg text-amber"><Icon size={18} /></div><div className="min-w-0 flex-1"><div className="text-sm font-black text-text-primary">{label}</div><div className="truncate text-[10px] text-text-muted">{rowDetail}</div></div></div></button>)}
        </ContextualPickerSheet>
        <ContextualPickerSheet open={showAreaSelect} title="Choose Roaming Route" detail={isRoaming ? `${selectedArea.name} · ${selectedArea.enemyType} · Loot bias: ${selectedArea.lootBias.slice(0,2).join(', ')}` : 'Tap the scene title to switch routes.'} onClose={() => setShowAreaSelect(false)}>
          {/* Compact area stats strip — replaces the removed Roaming Intel card */}
          {isRoaming && (
            <div className="mb-3 grid grid-cols-3 gap-1.5 text-[9px]">
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Credits</span><div className="font-black text-cyan">+{creditsPerTick}/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Scrap</span><div className="font-black text-green">+{scrapPerTick}/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Gear</span><div className="font-black text-amber">{Math.round(DROP_CHANCE_PER_TICK * 100)}%/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Cache Frag</span><div className="font-black text-cyan">{Math.round(CACHE_FRAGMENT_CHANCE_PER_TICK * 100)}%/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Materials</span><div className="font-black text-green">{Math.round(MATERIAL_FIND_CHANCE_PER_TICK * 100)}%/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Enemy</span><div className="font-black text-text-primary">{selectedArea.enemyType.split(' ')[0]}</div></div>
            </div>
          )}
          {ROAMING_AREAS.map((area) => { const unlocked = isRoamingAreaUnlocked(area, player.level); const selected = area.id === selectedArea.id; return <RouteCard key={area.id} area={area} selected={selected} unlocked={unlocked} onSelect={() => idle.setSelectedRoamingArea(area.id)} onStart={() => startRoam(area)} />; })}
        </ContextualPickerSheet>
        <ContextualPickerSheet open={showBossPicker} title="Choose Boss Target" detail="Boss selection no longer consumes the default action screen." onClose={() => setShowBossPicker(false)}>
          {bosses.map((boss) => <button key={boss.id} type="button" onClick={() => startPrep(boss)} className="w-full border-2 border-border bg-surface p-3 text-left" style={smallClip}><div className="flex justify-between gap-2"><span className="text-sm font-black text-text-primary">{boss.name}</span><span className="text-[9px] text-text-muted">Lv.{boss.level} · Pwr {boss.recommendedPower}</span></div><div className="mt-1 text-[10px] text-text-muted">Weak: {boss.weaknesses.join('/')} · Drops: {boss.dedicatedDrops.slice(0, 2).join(', ')}</div></button>)}
        </ContextualPickerSheet>
        <ContextualPickerSheet open={showRecipePicker} title="Choose Recipe" detail="Recipe selection is contextual, not permanent page chrome." onClose={() => setShowRecipePicker(false)}>
          {craftable.map(({ recipe, check, duration }) => <button key={recipe.id} type="button" onClick={() => check.can && startCrafting(recipe)} disabled={!check.can} className="w-full border-2 border-border bg-surface p-3 text-left disabled:opacity-50" style={smallClip}><div className="flex justify-between gap-2"><span className="text-sm font-black text-text-primary">{recipe.name}</span><span className="text-[9px] text-amber">{formatDuration(duration)}</span></div><div className="mt-1 text-[10px] text-text-muted">{check.can ? Object.entries(recipe.materials).map(([k, v]) => `${k} ${v}`).join(' · ') : check.missing.join(' · ')}</div></button>)}
        </ContextualPickerSheet>
        <ContextualPickerSheet open={showSalvagePicker} title="Choose Salvage Item" detail="Select any unlocked item to break down. Higher rarity = dramatically more materials." onClose={() => setShowSalvagePicker(false)}>
          {salvageCandidates.map((item) => { const y = calculateSalvageYield(item); return <button key={item.id} type="button" onClick={() => startSalvage(item)} className="w-full border-2 border-border bg-surface p-3 text-left" style={smallClip}><div className="flex justify-between gap-2"><span className="truncate text-sm font-black text-text-primary">{item.name}</span><span className="text-[9px] text-amber">{item.rarity}</span></div><div className="mt-1 text-[10px] text-text-muted">+{y.scrapAlloy} alloy · +{y.ballisticParts} parts · +{y.reactiveComponents} reactive · +{y.techFragments} tech</div></button>; })}
        </ContextualPickerSheet>
        <ContextualPickerSheet open={showMarketPicker} title="Choose Listing Candidate" detail="Market candidates are contextual controls." onClose={() => setShowMarketPicker(false)}>
          {sellableItems.slice(0, 10).map((item) => <button key={item.id} type="button" onClick={() => onNavigate?.('market')} className="w-full border-2 border-border bg-surface p-3 text-left" style={smallClip}><div className="flex justify-between gap-2"><span className="truncate text-sm font-black text-text-primary">{item.name}</span><span className="text-[9px] text-amber">{item.rarity}</span></div><div className="mt-1 text-[10px] text-text-muted">{describeGear(item)} · tap to open Market listing flow</div></button>)}
        </ContextualPickerSheet>
        {inspectGear && <GearInspectModal item={inspectGear} onClose={() => setInspectGear(null)} />}
      </AnimatePresence>

      <AnimatePresence>{prepBoss && <BossPrepModal boss={prepBoss} onClose={() => setPrepBoss(null)} />}</AnimatePresence>
    </div>
  );
};
