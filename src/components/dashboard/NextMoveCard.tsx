import React, { useEffect, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { PickerSheet } from '@/components/common/PickerSheet';
import { OfflineRecapCard } from '@/components/activity/OfflineRecap';
import { ContractsPanel } from '@/components/dashboard/ContractsPanel';
import { WeeklyClaimablesList } from '@/components/dashboard/WeeklyClaimables';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { useWorkshopStore } from '@/store/slices/workshopSlice';
import { countClaimableContracts, useContractsStore } from '@/store/slices/contractsSlice';
import { useStandingStore, weeklyClaimables } from '@/store/slices/standingSlice';
import { fetchCacheLane } from '@/lib/api/cacheLaneService';
import { getResearchState } from '@/lib/chef/chefClient';
import { researchCourse, type ResearchStateView } from '@/content/research';
import type { SettlementRecap } from '@/lib/activity/activitySettlement';

type WaitKind = 'away' | 'craft' | 'contract' | 'cache' | 'weekly' | 'research';

const CRAFT_SEEN_KEY = 'cc-nextmove-craft-seen';
const RESEARCH_SEEN_KEY = 'cc-research-completion-seen';

function readCraftSeen(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CRAFT_SEEN_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function awayHeadline(recap: SettlementRecap): { title: string; sub: string } {
  if ('crafting' in recap) {
    return {
      title: 'While you were away — the benches kept working',
      sub: `${recap.crafting.jobsCompleted} job${recap.crafting.jobsCompleted === 1 ? '' : 's'} completed · +${recap.crafting.xpAwarded.toLocaleString()} XP. Open the recap for the full settlement.`,
    };
  }
  if ('extraction' in recap) {
    return {
      title: 'While you were away — extraction kept running',
      sub: `${recap.extraction.passesCompleted} pass${recap.extraction.passesCompleted === 1 ? '' : 'es'} completed · +${recap.extraction.xpAwarded.toLocaleString()} XP. Open the recap for the full settlement.`,
    };
  }
  const parts: string[] = [];
  if (recap.rewards.creditsAwarded > 0) parts.push(`+${recap.rewards.creditsAwarded.toLocaleString()} credits`);
  if (recap.rewards.scrapAwarded > 0) parts.push(`+${recap.rewards.scrapAwarded.toLocaleString()} scrap`);
  if (recap.items.length > 0) parts.push(`${recap.items.length} item${recap.items.length === 1 ? '' : 's'}`);
  if (recap.rewards.killsRecorded > 0) parts.push(`${recap.rewards.killsRecorded.toLocaleString()} kills`);
  return {
    title: `While you were away — ${recap.timeAway}`,
    sub: parts.length > 0 ? `${parts.join(' · ')}. Open the recap for the full settlement.` : 'Open the recap for the full settlement.',
  };
}

/**
 * The Next Move card (Home consolidation, owner correction
 * 2026-11-03). The concept survives ONLY in its earning form:
 * the card exists while something is genuinely waiting on the
 * player — an unreviewed away settlement, a finished craft, a
 * claimable contract, the free daily cache, weekly Rep Desk
 * earnings, an unacknowledged course completion — with the
 * resolving action ON the card, in the exploration's priority
 * order (money already earned first, expiring daily next,
 * informational last). When nothing waits it renders NOTHING:
 * no quiet form, no placeholder line — the layout closes up.
 *
 * Display + doors only: every wait derives from the same stores
 * and reads the TopBar chips and deck panels used; claiming
 * happens inside the shipped panels the card opens (recap card,
 * ContractsPanel, WeeklyClaimablesList), never in the card.
 */
export const NextMoveCard: React.FC<{
  onNavigate: (target: string) => void;
}> = ({ onNavigate }) => {
  const lastSettlement = useOfflineRecapStore((s) => s.lastSettlement);
  const recapDismissed = useOfflineRecapStore((s) => s.dismissed);
  const workshopServer = useWorkshopStore((s) => s.server);
  const contractsResult = useContractsStore((s) => s.result);
  const standingView = useStandingStore((s) => s.view);

  const [sheet, setSheet] = useState<'away' | 'contract' | 'weekly' | null>(null);
  const [craftSeen, setCraftSeen] = useState<string[]>(readCraftSeen);
  const [freeCacheReady, setFreeCacheReady] = useState(false);
  const [research, setResearch] = useState<ResearchStateView | null>(null);
  const [researchAcked, setResearchAcked] = useState(false);

  // The card's own reads (nothing else on Home loads these):
  // the cache lane for the free daily box, research state for
  // course completions. Workshop state rides the Action screen's
  // own mount refresh; standing/contracts ride the TopBar's.
  useEffect(() => {
    let cancelled = false;
    fetchCacheLane()
      .then((lane) => {
        if (!cancelled && lane) setFreeCacheReady(lane.freeAvailable);
      })
      .catch(() => { /* Chef unreachable: no cache wait. */ });
    getResearchState()
      .then((result) => {
        if (!cancelled) setResearch(result.research);
      })
      .catch(() => { /* Chef unreachable: no research wait. */ });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── The waits, in priority order ─────────────────────────────
  let wait: { kind: WaitKind; icon: PxIconName; title: string; sub: string; actionLabel: string; onAction: () => void } | null = null;

  const unseenCompletions = (workshopServer?.recentCompletions ?? []).filter((c) => !craftSeen.includes(c.jobId));
  const claimableContracts = countClaimableContracts(contractsResult);
  const contractsCanClaim = contractsResult?.contracts?.canClaim === true;
  const weekly = weeklyClaimables(standingView);
  const lastCompletion = research?.lastCompletion ?? null;
  const researchSeen = (() => {
    if (!lastCompletion) return true;
    try {
      return window.localStorage.getItem(RESEARCH_SEEN_KEY) === `${lastCompletion.courseId}:${lastCompletion.completedAt}`;
    } catch {
      return false;
    }
  })();

  if (lastSettlement && !recapDismissed) {
    const headline = awayHeadline(lastSettlement);
    wait = {
      kind: 'away',
      icon: 'clock',
      title: headline.title,
      sub: headline.sub,
      actionLabel: 'Collect',
      onAction: () => setSheet('away'),
    };
  } else if (unseenCompletions.length > 0) {
    const newest = unseenCompletions[unseenCompletions.length - 1];
    wait = {
      kind: 'craft',
      icon: 'anvil',
      title: `${newest.name} finished in the Workshop`,
      sub: unseenCompletions.length > 1
        ? `${unseenCompletions.length} jobs are done and waiting on their benches.`
        : 'It is sitting on the bench, ready to collect.',
      actionLabel: 'Open Workshop',
      onAction: () => {
        const ids = (workshopServer?.recentCompletions ?? []).map((c) => c.jobId);
        const next = [...new Set([...craftSeen, ...ids])].slice(-20);
        try {
          window.localStorage.setItem(CRAFT_SEEN_KEY, JSON.stringify(next));
        } catch { /* storage unavailable: session state still updates */ }
        setCraftSeen(next);
        onNavigate('workshop');
      },
    };
  } else if (claimableContracts > 0 && contractsCanClaim) {
    wait = {
      kind: 'contract',
      icon: 'orders',
      title: `${claimableContracts} contract${claimableContracts === 1 ? '' : 's'} ready to claim`,
      sub: 'Rep Desk rewards are banked and waiting.',
      actionLabel: 'Claim',
      onAction: () => setSheet('contract'),
    };
  } else if (freeCacheReady) {
    wait = {
      kind: 'cache',
      icon: 'crate',
      title: 'Your free daily cache is ready',
      sub: 'One free box a day — it does not carry over.',
      actionLabel: 'Open',
      onAction: () => onNavigate('chest'),
    };
  } else if (weekly.length > 0) {
    wait = {
      kind: 'weekly',
      icon: 'coin',
      title: `${weekly.length} weekly earning${weekly.length === 1 ? '' : 's'} ready`,
      sub: 'Manufacturer standing payouts at the Rep Desk.',
      actionLabel: 'Claim',
      onAction: () => setSheet('weekly'),
    };
  } else if (lastCompletion && !researchSeen && !researchAcked) {
    const course = researchCourse(lastCompletion.courseId);
    if (course) {
      wait = {
        kind: 'research',
        icon: 'pencil',
        title: `Course complete — ${course.name}`,
        sub: course.unlockText,
        actionLabel: 'Got it',
        onAction: () => {
          try {
            window.localStorage.setItem(RESEARCH_SEEN_KEY, `${lastCompletion.courseId}:${lastCompletion.completedAt}`);
          } catch { /* storage unavailable: session state still updates */ }
          setResearchAcked(true);
        },
      };
    }
  }

  if (!wait) return null;

  return (
    <>
      <div
        data-testid="next-move-card"
        data-wait-kind={wait.kind}
        className="flex items-center gap-3 border-2 border-amber/70 bg-surface/95 p-2.5 shadow-[0_8px_18px_rgba(0,0,0,0.45)]"
      >
        <PxIcon name={wait.icon} size={21} className="shrink-0 text-amber" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-text-muted">Next Move</div>
          <div className="truncate text-[13px] font-black leading-tight text-text-primary">{wait.title}</div>
          <div className="text-[11px] leading-snug text-text-muted">{wait.sub}</div>
        </div>
        <button
          type="button"
          onClick={wait.onAction}
          className="bl-primary min-h-[44px] shrink-0 px-3 py-2 text-[11px] font-black uppercase tracking-wide"
        >
          {wait.actionLabel}
        </button>
      </div>
      {sheet === 'away' && (
        <PickerSheet title="Return" onClose={() => setSheet(null)}>
          <OfflineRecapCard onDone={() => setSheet(null)} />
        </PickerSheet>
      )}
      {sheet === 'contract' && (
        <PickerSheet title="Contracts" onClose={() => setSheet(null)}>
          <ContractsPanel />
        </PickerSheet>
      )}
      {sheet === 'weekly' && (
        <PickerSheet title="Weekly Claimables" onClose={() => setSheet(null)}>
          <WeeklyClaimablesList />
        </PickerSheet>
      )}
    </>
  );
};
