import type { ActivityKind } from '@/types/activity';

export type ActionAnimationBeat =
  | 'idle-breathe'
  | 'patrol-step'
  | 'target-motion'
  | 'impact-flash'
  | 'reward-flyout'
  | 'cache-pulse'
  | 'weakness-scan'
  | 'boss-reaction'
  | 'phase-pulse'
  | 'bench-pulse'
  | 'parts-slide'
  | 'item-reveal'
  | 'salvage-spark'
  | 'material-burst'
  | 'machine-ready'
  | 'kiosk-scan'
  | 'credit-transfer';

export type ActionAnimationPlan = {
  kind: ActivityKind;
  idle: ActionAnimationBeat[];
  onTick: ActionAnimationBeat[];
  onLoot: ActionAnimationBeat[];
  onCache: ActionAnimationBeat[];
  onError: ActionAnimationBeat[];
};

export const ACTION_ANIMATION_PLANS: Record<ActivityKind, ActionAnimationPlan> = {
  none: { kind: 'none', idle: ['idle-breathe'], onTick: ['idle-breathe'], onLoot: [], onCache: [], onError: ['idle-breathe'] },
  idle_standby: { kind: 'idle_standby', idle: ['idle-breathe'], onTick: ['idle-breathe'], onLoot: [], onCache: [], onError: ['idle-breathe'] },
  roaming_loot: { kind: 'roaming_loot', idle: ['patrol-step', 'target-motion'], onTick: ['patrol-step', 'target-motion', 'impact-flash'], onLoot: ['impact-flash', 'reward-flyout'], onCache: ['impact-flash', 'cache-pulse'], onError: ['target-motion'] },
  boss_prep: { kind: 'boss_prep', idle: ['weakness-scan'], onTick: ['weakness-scan', 'phase-pulse'], onLoot: ['weakness-scan'], onCache: ['weakness-scan'], onError: ['phase-pulse'] },
  boss_fight: { kind: 'boss_fight', idle: ['target-motion', 'patrol-step'], onTick: ['target-motion', 'impact-flash', 'boss-reaction'], onLoot: ['boss-reaction', 'reward-flyout'], onCache: ['boss-reaction', 'cache-pulse'], onError: ['target-motion', 'phase-pulse'] },
  crafting: { kind: 'crafting', idle: ['bench-pulse'], onTick: ['bench-pulse', 'parts-slide'], onLoot: ['parts-slide', 'item-reveal'], onCache: ['bench-pulse'], onError: ['bench-pulse'] },
  salvaging: { kind: 'salvaging', idle: ['salvage-spark'], onTick: ['salvage-spark'], onLoot: ['salvage-spark', 'material-burst'], onCache: ['salvage-spark'], onError: ['salvage-spark'] },
  workshop_service: { kind: 'workshop_service', idle: ['bench-pulse'], onTick: ['bench-pulse'], onLoot: ['machine-ready', 'item-reveal'], onCache: ['machine-ready'], onError: ['phase-pulse'] },
  market_listing: { kind: 'market_listing', idle: ['kiosk-scan'], onTick: ['kiosk-scan'], onLoot: ['kiosk-scan', 'credit-transfer'], onCache: ['kiosk-scan'], onError: ['phase-pulse'] },
};

export function getActionAnimationPlan(kind: ActivityKind): ActionAnimationPlan {
  return ACTION_ANIMATION_PLANS[kind] ?? ACTION_ANIMATION_PLANS.idle_standby;
}

export function getAnimationBeatsForEvent(kind: ActivityKind, tone?: string, eventType?: string): ActionAnimationBeat[] {
  const plan = getActionAnimationPlan(kind);
  if (!tone && !eventType) return plan.idle;
  if (tone === 'loot' || eventType?.includes('gear') || eventType?.includes('drop')) return plan.onLoot;
  if (tone === 'cache' || eventType?.includes('cache')) return plan.onCache;
  if (eventType?.includes('failed') || eventType?.includes('error') || eventType?.includes('locked')) return plan.onError;
  return plan.onTick;
}

export function hasDirectedMotion(kind: ActivityKind): boolean {
  return getActionAnimationPlan(kind).idle.length > 0;
}
