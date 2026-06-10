/**
 * Action workspace specs — the data layer for the Action tab. Each
 * ActivityKind gets a `MechanicWorkspaceSpec` describing what the
 * player sees, what decisions they make, and what visuals animate.
 *
 * When you add a new activity kind:
 *   1. Add the entry to `ActivityKind` in `src/types/activity.ts`.
 *   2. Add a `MechanicWorkspaceSpec` here with a unique `kind`.
 *   3. Add a beat plan to `ACTION_ANIMATION_PLANS` in
 *      `src/lib/activity/actionAnimationDirector.ts`.
 *   4. Add a beat queue to `idleTickPlans` if the kind ticks.
 *
 * NOTE: The action stage (ActionStage.tsx, actionStageRenderer.ts,
 * useActionStageOrchestrator.ts, actionAnimationDirector.ts) was
 * deprecated 2026-06-10 in favor of LiveTurfDiorama. These modules
 * remain on disk for test compatibility but are no longer imported
 * by any production screen.
 */
import type { ActivityKind } from '@/types/activity';

export type ActionWorkspacePriority = 'state' | 'reward-intel' | 'feed' | 'decision' | 'selector';

export interface MechanicWorkspaceSpec {
  kind: ActivityKind;
  title: string;
  liveVerb: string;
  coreDecision: string;
  rewardIntel: string[];
  feedEvents: string[];
  selector: string;
  visualLoop: string[];
  priorities: ActionWorkspacePriority[];
}

export const ACTION_WORKSPACE_SPECS: Record<ActivityKind, MechanicWorkspaceSpec> = {
  none: {
    kind: 'none',
    title: 'No Action',
    liveVerb: 'waiting',
    coreDecision: 'Pick the next productive loop.',
    rewardIntel: ['No rewards while inactive.'],
    feedEvents: ['Action start', 'Action error'],
    selector: 'Switch Action sheet',
    visualLoop: ['idle camp motion'],
    priorities: ['decision', 'selector'],
  },
  idle_standby: {
    kind: 'idle_standby',
    title: 'Standby',
    liveVerb: 'standing by',
    coreDecision: 'Choose roam, boss prep, crafting, salvage, workshop, market, or cache opening.',
    rewardIntel: ['No tick rewards while on standby.'],
    feedEvents: ['Action start', 'Cache error'],
    selector: 'Switch Action sheet',
    visualLoop: ['idle camp motion'],
    priorities: ['decision', 'selector'],
  },
  roaming_loot: {
    kind: 'roaming_loot',
    title: 'Roaming Loot',
    liveVerb: 'sweeping turf',
    coreDecision: 'Which route should the hunter roam right now?',
    rewardIntel: ['tick interval', 'credits per tick', 'scrap per tick', 'gear chance', 'cache fragment chance', 'material chance', 'rarity weights', 'gear type weights', 'route modifiers'],
    feedEvents: ['enemy sweep', 'gear drop', 'cache fragment', 'material find', 'essence find', 'level up', 'damage taken', 'auto-eat', 'hunter down'],
    selector: 'Route picker opened from the hero title or compact route control.',
    visualLoop: ['hunter patrol', 'enemy approach', 'enemy movement', 'projectile or sweep beat', 'hunter impact-flash', 'loot flyout', 'cache fragment pulse'],
    priorities: ['state', 'reward-intel', 'feed', 'decision', 'selector'],
  },
  boss_prep: {
    kind: 'boss_prep',
    title: 'Boss Prep',
    liveVerb: 'checking counters',
    coreDecision: 'Which boss should be prepared against and is the loadout ready?',
    rewardIntel: ['recommended power', 'hunter power', 'readiness percentage', 'weaknesses', 'resistances', 'entry cost', 'dedicated drops', 'phase risks'],
    feedEvents: ['prep started', 'boss target changed', 'readiness warning', 'counter check'],
    selector: 'Boss picker sheet opened from boss title or Change Boss.',
    visualLoop: ['scan board', 'weakness tag pulse', 'loadout check marker'],
    priorities: ['state', 'reward-intel', 'decision', 'selector', 'feed'],
  },
  boss_fight: {
    kind: 'boss_fight',
    title: 'Boss Encounter',
    liveVerb: 'fighting boss',
    coreDecision: 'Is the current encounter worth continuing and what loot is at stake?',
    rewardIntel: ['boss power requirement', 'hunter power', 'phase count', 'current risk', 'dedicated drops', 'drop table size'],
    feedEvents: ['fight started', 'phase check', 'hit event', 'boss defeated', 'boss failed', 'loot drop'],
    selector: 'Boss picker sheet before fight; action switch drawer during fight.',
    visualLoop: ['enemy approach', 'hunter attack', 'boss hit reaction', 'phase pulse', 'loot burst'],
    priorities: ['state', 'feed', 'reward-intel', 'decision'],
  },
  crafting: {
    kind: 'crafting',
    title: 'Crafting',
    liveVerb: 'working bench',
    coreDecision: 'Which recipe should occupy bench attention?',
    rewardIntel: ['free benches', 'queued jobs', 'craftable recipes', 'blocked recipes', 'duration', 'material costs', 'output count', 'skill reduction'],
    feedEvents: ['craft focus set', 'bench cycle', 'craft ready', 'craft claimed', 'crafted item'],
    selector: 'Recipe picker sheet; craftable and blocked recipes live there.',
    visualLoop: ['bench pulse', 'parts slide-in', 'sparks', 'progress flare', 'item reveal'],
    priorities: ['state', 'reward-intel', 'decision', 'feed', 'selector'],
  },
  salvaging: {
    kind: 'salvaging',
    title: 'Salvaging',
    liveVerb: 'breaking gear down',
    coreDecision: 'Which item should be broken down without destroying protected gear?',
    rewardIntel: ['selected item', 'rarity', 'expected alloy', 'expected parts', 'expected reactive components', 'expected tech fragments', 'void dust', 'lock safety'],
    feedEvents: ['salvage target staged', 'salvage started', 'material output', 'essence output', 'safety warning'],
    selector: 'Salvage item sheet with safe candidates only.',
    visualLoop: ['item intake', 'shred sparks', 'material chunks', 'output flyout'],
    priorities: ['state', 'reward-intel', 'decision', 'feed', 'selector'],
  },
  workshop_service: {
    kind: 'workshop_service',
    title: 'Workshop Service',
    liveVerb: 'servicing machines',
    coreDecision: 'Which queue needs attention or claiming?',
    rewardIntel: ['bench utilization', 'running queues', 'ready outputs', 'next completion', 'blocked capacity'],
    feedEvents: ['queue ready', 'queue claimed', 'bench freed', 'service error'],
    selector: 'Workshop screen for full queue management.',
    visualLoop: ['machine cycle', 'ready light', 'output pulse'],
    priorities: ['state', 'reward-intel', 'feed', 'decision'],
  },
  market_listing: {
    kind: 'market_listing',
    title: 'Market Listing',
    liveVerb: 'working trade kiosk',
    coreDecision: 'Which unlocked item should be listed and at what expected value?',
    rewardIntel: ['credits', 'sellable items', 'active listings', 'history count', 'fee estimate', 'expected net'],
    feedEvents: ['listing focus set', 'listing created', 'listing sold', 'listing cancelled', 'market error'],
    selector: 'Listing candidate sheet; full listing flow lives in Market.',
    visualLoop: ['kiosk scan', 'item transfer', 'credit pulse', 'listing stamp'],
    priorities: ['state', 'reward-intel', 'decision', 'feed', 'selector'],
  },
};

export const getActionWorkspaceSpec = (kind: ActivityKind): MechanicWorkspaceSpec => ACTION_WORKSPACE_SPECS[kind] ?? ACTION_WORKSPACE_SPECS.idle_standby;
