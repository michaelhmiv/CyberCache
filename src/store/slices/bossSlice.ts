import { create } from 'zustand';
import { BossAttemptResult, type PhaseAnalysis } from '../../types/boss';
import { RiskSetting, type SkillTreeType } from '../../types/game';
import type { LoadoutConsumables } from './loadoutSlice';
import type { FightTimeline } from '../../lib/animation/fightTimeline';
import type { Weapon } from '../../types/items';

/**
 * The live boss fight's presentation (One-Stage Law, owner ruling
 * 2026-11-06): while a Chef-decided attempt plays back, the panel
 * that owns the playback publishes each timeline snapshot here and
 * the MAIN STAGE (LiveTurfDiorama) renders the animated fight from
 * it — exactly one animated fight exists, on the stage, while the
 * encounter panel keeps prep, launch, and the result. Presentation
 * only: the timeline is the Chef's already-decided outcome walked
 * for display; nothing here produces gameplay state.
 */
export interface BossFightPresentation {
  timeline: FightTimeline;
  phases: PhaseAnalysis[];
  bossId: string;
  weapon?: Weapon;
  signatureFire?: SkillTreeType | null;
}

/**
 * The live ENDLESS fight's presentation (Motion Reboot M3, the
 * #431 pattern carried to the Chaos Chamber): while the Endless
 * panel walks a Chef-decided encounter, it publishes each timeline
 * snapshot here and the MAIN STAGE renders the fight from it —
 * exactly one animated fight exists, the panel keeps depth,
 * banking, and result. Identity is the RUN: the diorama renders
 * this only while the endless_run activity record's targetId (the
 * server-pinned run id, migration 0028) equals `runId`, so a stale
 * presentation from a finished or abandoned run can never wear
 * the stage. Presentation only — the timeline is the Chef's
 * already-decided outcome walked for display.
 */
export interface EndlessFightPresentation {
  timeline: FightTimeline;
  phases: PhaseAnalysis[];
  /** The server-owned run row id (cc_start_endless_run). */
  runId: string;
  /** The depth being fought (run.depth_reached + 1 at publish). */
  depth: number;
  /** The encounter's sim id (boss kit id, or `endless_pack_<areaId>`). */
  encounterId: string;
  /** Pack depths fight on their rotation area's ground, not a boss
   *  arena — the backdrop override BossFightStage already honors. */
  backgroundId?: string;
  /** Escalation band for this depth (endlessDepthBand) — the fight
   *  stage's tint + depth badge read it. */
  band: number;
  weapon?: Weapon;
  signatureFire?: SkillTreeType | null;
}

/**
 * The endless run's stage PRESENCE between fights (M3): the next
 * encounter standing on the main stage in its own arena, the way
 * the challenged boss stands during prep. The panel publishes it
 * while a run is live; the diorama honors it only when `runId`
 * matches the activity record's targetId (same guard as the fight
 * presentation). The panel is the only publisher — it clears the
 * presence when the run ends or the panel unmounts.
 */
export interface EndlessPresence {
  runId: string;
  encounterId: string;
  encounterKind: 'pack' | 'boss';
  areaId: string;
  depth: number;
  band: number;
}

export type BossFightStatus = 'idle' | 'active' | 'victory' | 'defeat';

export interface BossFightState {
  /** Boss currently being fought live (in the ticker). null when idle. */
  activeBossId: string | null;
  /** Boss's current HP during the live fight. */
  activeBossHp: number;
  /** Boss's starting HP at fight start (for the HP bar denominator). */
  activeBossMaxHp: number;
  /** 'idle' = no fight, 'active' = ticker driving, 'victory'/'defeat' = ended. */
  activeStatus: BossFightStatus;
  /** Total medkits auto-consumed during the current fight. */
  activeMedkitsConsumed: number;
  /** Total damage dealt to the boss so far. */
  activeDamageDealt: number;
  /** Tick count of the current fight. */
  activeTickCount: number;
  /** Wall-clock ms when the fight started. */
  activeStartedAt: number;
}

export interface BossState extends BossFightState {
  currentBossId: string | null;
  unlockedBossIds: string[];
  defeatedBossIds: string[];
  /**
   * Victories per boss on the current UTC day, server-reported (profile
   * read + verify-boss responses). Drives the prep panel's escalated
   * rematch-fee display only — the Chef re-derives and charges the fee
   * from the ledger on every attempt.
   */
  bossVictoriesToday: Record<string, number>;
  pityCounters: Record<string, number>;
  attemptHistory: BossAttemptResult[];
  preparedConsumables: Record<string, number>;
  selectedRisk: RiskSetting;
  setCurrentBoss: (id: string | null) => void;
  unlockBoss: (id: string) => void;
  defeatBoss: (id: string) => void;
  incrementPity: (id: string) => void;
  resetPity: (id: string) => void;
  addAttempt: (result: BossAttemptResult) => void;
  setConsumablePrep: (type: string, count: number) => void;
  seedPrepFromBelt: (belt: LoadoutConsumables, owned: Record<string, number>) => void;
  setRisk: (risk: RiskSetting) => void;
  clearPrep: () => void;
  // PR 6 — live fight mutations
  startLiveFight: (bossId: string, maxHp: number) => void;
  applyLiveTick: (patch: { bossHp: number; medkitsConsumed: number; damageDealt: number }) => void;
  endLiveFight: (status: 'victory' | 'defeat') => void;
  clearLiveFight: () => void;
  // One-Stage Law (2026-11-06) — the main stage's fight presentation
  fightPresentation: BossFightPresentation | null;
  setFightPresentation: (presentation: BossFightPresentation) => void;
  clearFightPresentation: () => void;
  // Motion Reboot M3 — the endless fight + presence on the main stage
  endlessPresentation: EndlessFightPresentation | null;
  setEndlessPresentation: (presentation: EndlessFightPresentation) => void;
  clearEndlessPresentation: () => void;
  endlessPresence: EndlessPresence | null;
  setEndlessPresence: (presence: EndlessPresence) => void;
  clearEndlessPresence: () => void;
}

const initialFight: BossFightState = {
  activeBossId: null,
  activeBossHp: 0,
  activeBossMaxHp: 0,
  activeStatus: 'idle',
  activeMedkitsConsumed: 0,
  activeDamageDealt: 0,
  activeTickCount: 0,
  activeStartedAt: 0,
};

export const useBossStore = create<BossState>()((set) => ({
  ...initialFight,
  currentBossId: null,
  unlockedBossIds: ['dune_tyrant'],
  defeatedBossIds: [],
  bossVictoriesToday: {},
  pityCounters: {},
  attemptHistory: [],
  preparedConsumables: {},
  selectedRisk: RiskSetting.Balanced,

  setCurrentBoss: (id) => set({ currentBossId: id }),
  unlockBoss: (id) =>
    set((s) => ({
      unlockedBossIds: s.unlockedBossIds.includes(id) ? s.unlockedBossIds : [...s.unlockedBossIds, id],
    })),
  defeatBoss: (id) =>
    set((s) => ({
      defeatedBossIds: s.defeatedBossIds.includes(id) ? s.defeatedBossIds : [...s.defeatedBossIds, id],
    })),
  incrementPity: (id) =>
    set((s) => ({
      pityCounters: { ...s.pityCounters, [id]: (s.pityCounters[id] || 0) + 1 },
    })),
  resetPity: (id) =>
    set((s) => ({
      pityCounters: { ...s.pityCounters, [id]: 0 },
    })),
  addAttempt: (result) =>
    set((s) => ({
      attemptHistory: [result, ...s.attemptHistory].slice(0, 100),
    })),
  setConsumablePrep: (type, count) =>
    set((s) => ({
      preparedConsumables: { ...s.preparedConsumables, [type]: count },
    })),
  // Belt seeding (flow-fix F14): the gear home's consumable slots are
  // the player's standing belt. When boss prep is entered with no prep
  // set, the belt pre-loads it — one of each belted type the player
  // actually owns — so the slots are real preparation, not display
  // state beside the real system. Counts stay adjustable in prep;
  // what the panel shows before the attempt is what burns.
  seedPrepFromBelt: (belt, owned) =>
    set((s) => {
      if (Object.keys(s.preparedConsumables).length > 0) return s;
      const seeded: Record<string, number> = {};
      for (const type of Object.values(belt)) {
        if (type && (owned[type] ?? 0) > 0) seeded[type] = 1;
      }
      return Object.keys(seeded).length > 0 ? { preparedConsumables: seeded } : s;
    }),
  setRisk: (risk) => set({ selectedRisk: risk }),
  clearPrep: () => set({ preparedConsumables: {}, selectedRisk: RiskSetting.Balanced }),

  // PR 6 — live fight mutations
  startLiveFight: (bossId, maxHp) =>
    set({
      activeBossId: bossId,
      activeBossHp: maxHp,
      activeBossMaxHp: maxHp,
      activeStatus: 'active',
      activeMedkitsConsumed: 0,
      activeDamageDealt: 0,
      activeTickCount: 0,
      activeStartedAt: Date.now(),
    }),
  applyLiveTick: (patch) =>
    set((s) => ({
      activeBossHp: patch.bossHp,
      activeMedkitsConsumed: s.activeMedkitsConsumed + patch.medkitsConsumed,
      activeDamageDealt: s.activeDamageDealt + patch.damageDealt,
      activeTickCount: s.activeTickCount + 1,
    })),
  endLiveFight: (status) => set({ activeStatus: status }),
  clearLiveFight: () => set({ ...initialFight }),

  fightPresentation: null,
  setFightPresentation: (presentation) => set({ fightPresentation: presentation }),
  clearFightPresentation: () => set({ fightPresentation: null }),
  endlessPresentation: null,
  setEndlessPresentation: (presentation) => set({ endlessPresentation: presentation }),
  clearEndlessPresentation: () => set({ endlessPresentation: null }),
  endlessPresence: null,
  setEndlessPresence: (presence) => set({ endlessPresence: presence }),
  clearEndlessPresence: () => set({ endlessPresence: null }),
}));
