import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useSkillStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useLoginStreakStore } from '@/store/slices/loginStreakSlice';
import { useTickFeedStore, type TickEvent } from '@/store/slices/tickSlice';
import { fireHunterVoiceLine } from '@/lib/hunters/hunterVoice';
import { Rarity } from '@/types/game';
import type { FightTimeline } from '@/lib/animation/fightTimeline';

/**
 * Hunter voice on the stage (Cache Hunters slice (c), brief §2.6).
 *
 * The TEXT these chips render is the owner-approved v2 copy
 * (2026-11-15 — see hunterVoice.ts). The
 * mechanism is final: watchers read DECIDED state only (the tick
 * event the Chef produced, the survival record the Chef synced,
 * the streak grant the Chef paid, the fight timeline the Chef
 * decided), fire through hunterVoice.ts's session rules (fixed
 * pools, no-repeat rotation, one line per moment, silence at
 * defeat/death), and render the returned line in the stage's
 * existing event-chip grammar — the backed plate the phase and
 * depth chips already use.
 *
 * Both renderers of a surface mount a watcher (the DOM scene and
 * the Pixi stage's DOM overlay; during the Pixi cover window both
 * are mounted at once). Moment keys derive from the shared
 * decided state, so every watcher computes the same key for the
 * same moment and hunterVoice.ts lets exactly one fire.
 */

/** How long a voice chip stays on the stage. */
export const HUNTER_VOICE_CHIP_MS = 3400;

function useVoiceLineDisplay() {
  const [line, setLine] = useState<{ text: string; momentKey: string } | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((text: string | null, momentKey: string) => {
    if (!text) return;
    setLine({ text, momentKey });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLine(null), HUNTER_VOICE_CHIP_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return { line, show };
}

const VoiceChipPlate: React.FC<{ text: string; xPct: number; topPct: number }> = ({ text, xPct, topPct }) => (
  <motion.div
    data-testid="hunter-voice-chip"
    className="pointer-events-none absolute z-30 max-w-[72%] border-2 border-black bg-[#050608]/85 px-2 py-0.5 text-[11px] font-black leading-tight text-amber shadow-[4px_4px_0_rgba(0,0,0,0.62)]"
    style={{ left: `calc(${xPct}% - 10px)`, top: `${topPct}%` }}
    initial={{ opacity: 0, y: 4 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.18, ease: 'easeOut' }}
  >
    {text}
  </motion.div>
);

export interface RoamHunterVoiceProps {
  /** The standing tick event (the roam stage's own event feed). */
  event?: TickEvent;
  /** Hunter placement mark (chip anchors over the figure). */
  xPct: number;
  /** Stage-% height of the figure's head line (chip sits above). */
  topPct: number;
}

/**
 * Roam-stage voice watcher: legendary drop (the standing event's
 * gear), near-death save (the survival record's adrenaline flag
 * flipping on while the hunter lives), streak complete (a login
 * streak claim landing). Fires only on facts that land AFTER
 * mount — a moment already standing when the stage mounts is
 * history, not a moment. All three stay silent while the hunter
 * is dead (death beats carry no voice, dosage floor 11).
 */
export const RoamHunterVoice: React.FC<RoamHunterVoiceProps> = ({ event, xPct, topPct }) => {
  const { line, show } = useVoiceLineDisplay();
  const adrenalineActive = useSurvivalStore((s) => s.adrenalineActive);

  // Legendary drop — the standing event becomes a legendary loot
  // event after mount.
  const seenEventId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = event?.id ?? null;
    if (seenEventId.current === undefined) {
      seenEventId.current = id;
      return;
    }
    if (!id || id === seenEventId.current) return;
    seenEventId.current = id;
    if (useSurvivalStore.getState().isDead) return;
    if (event?.gear?.rarity === Rarity.Legendary) {
      const momentKey = `tick:${id}`;
      show(
        fireHunterVoiceLine(useSkillStore.getState().activeHunterId, 'legendaryDrop', momentKey, Date.now()),
        momentKey,
      );
    }
  }, [event, show]);

  // Near-death save — the server record's adrenaline flag flips
  // on (the hunter went under the near-death threshold) and the
  // hunter is alive: a save. The same claim killing the hunter
  // (isDead) silences it — the death does not speak.
  const prevAdrenaline = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevAdrenaline.current;
    prevAdrenaline.current = adrenalineActive;
    if (prev === null) return;
    if (prev || !adrenalineActive) return;
    const survival = useSurvivalStore.getState();
    if (survival.isDead) return;
    const headId = useTickFeedStore.getState().events[0]?.id ?? 'feed-empty';
    const momentKey = `save:${headId}:${Math.round(survival.currentHp)}`;
    show(
      fireHunterVoiceLine(useSkillStore.getState().activeHunterId, 'nearDeathSave', momentKey, Date.now()),
      momentKey,
    );
  }, [adrenalineActive, show]);

  // Streak complete — a login-streak claim lands after mount
  // (lastClaimedGrantKey is set by the claim's success only; a
  // replayed already-claimed grant never sets it).
  const lastClaimedGrantKey = useLoginStreakStore((s) => s.lastClaimedGrantKey);
  const seenGrantKey = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (seenGrantKey.current === undefined) {
      seenGrantKey.current = lastClaimedGrantKey;
      return;
    }
    if (!lastClaimedGrantKey || lastClaimedGrantKey === seenGrantKey.current) return;
    seenGrantKey.current = lastClaimedGrantKey;
    if (useSurvivalStore.getState().isDead) return;
    const momentKey = `streak:${lastClaimedGrantKey}`;
    show(
      fireHunterVoiceLine(useSkillStore.getState().activeHunterId, 'streakComplete', momentKey, Date.now()),
      momentKey,
    );
  }, [lastClaimedGrantKey, show]);

  if (!line) return null;
  return <VoiceChipPlate text={line.text} xPct={xPct} topPct={topPct} />;
};

export interface BossHunterVoiceProps {
  timeline: FightTimeline;
  bossId?: string;
  xPct: number;
  topPct: number;
}

/**
 * Boss-stage voice watcher: boss kill — the decided timeline
 * finishes in victory after mount. A defeat finish stays silent
 * (defeat beats carry no voice). Endless fights ride this stage
 * too; their victories are boss kills by the same decided fact.
 */
export const BossHunterVoice: React.FC<BossHunterVoiceProps> = ({ timeline, bossId, xPct, topPct }) => {
  const { line, show } = useVoiceLineDisplay();
  const seenFinishedAt = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const finishedAt = timeline.finishedAt ?? null;
    if (seenFinishedAt.current === undefined) {
      seenFinishedAt.current = finishedAt;
      return;
    }
    if (finishedAt === null || finishedAt === seenFinishedAt.current) return;
    seenFinishedAt.current = finishedAt;
    if (timeline.outcome?.result.victory !== true) return;
    const momentKey = `boss:${bossId ?? 'unknown'}:${finishedAt}`;
    show(
      fireHunterVoiceLine(useSkillStore.getState().activeHunterId, 'bossKill', momentKey, Date.now()),
      momentKey,
    );
  }, [timeline.finishedAt, timeline.outcome, bossId, show]);

  if (!line) return null;
  return <VoiceChipPlate text={line.text} xPct={xPct} topPct={topPct} />;
};
