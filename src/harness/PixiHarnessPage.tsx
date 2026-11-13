import React, { useEffect, useRef, useState } from 'react';
import { BossFightStage, BossFightStageDom } from '@/components/pixelArt/BossFightStage';
import { GhostHpBar } from '@/components/pixelArt/PixelFx';
import type { FightTimeline } from '@/lib/animation/fightTimeline';
import {
  FIXTURE_BOSS_ID,
  FIXTURE_PHASES,
  FIXTURE_WEAPON,
  fixtureSnapshots,
  freezeSnapshot,
  playFixture,
  type FixtureLogEntry,
} from './fightFixture';

/**
 * Pixi pilot harness (dev-only page, served by the Vite dev server
 * at /pixi-harness.html — never part of the production bundle).
 * Drives the recorded fixture through either stage renderer so the
 * timing probe, stills, and videos all read the same decided fight:
 *
 *   ?renderer=dom|pixi   stage implementation (default pixi = the
 *                        production wrapper: Pixi + DOM fallback)
 *   ?autostart=1         start the fixture on load
 *   ?freeze=<index>      hold one snapshot (stills): 0..4 phases,
 *                        5 = finished/victory
 *   ?width=<px>          stage width (default 420)
 *   ?boss=<id>           boss to stage (stage-iteration program B1;
 *                        default the fixture boss) — drives art,
 *                        identity and cadence/telegraph resolution
 *   ?outcome=defeat      play the defeat variant of the fixture
 *                        (hunter falls in the last phase)
 *
 * Probe surface on window: __fightLog (snapshot applications),
 * __fpsDeltas (rAF frame deltas), __harnessDone (completion flag),
 * plus the Pixi stage's own __cybercachePixiStage sample.
 */
// Stage-iteration diagnostics: record page errors so rig plans can
// dump them (the CDP rig does not forward console output). Dev-only.
{
  const w = window as unknown as { __diagErrors?: string[] };
  if (!w.__diagErrors) {
    w.__diagErrors = [];
    window.addEventListener('error', (e) => {
      w.__diagErrors?.push(`error: ${e.message} @ ${(e.filename ?? '').split('/').pop()}:${e.lineno}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason as { message?: string; stack?: string } | undefined;
      w.__diagErrors?.push(`rejection: ${r?.message ?? String(e.reason)} | ${(r?.stack ?? '').split('\n')[1]?.trim() ?? ''}`);
    });
  }
}

export const PixiHarnessPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const renderer = params.get('renderer') === 'dom' ? 'dom' : 'pixi';
  const freezeIndex = params.get('freeze');
  const width = Number(params.get('width') ?? 420) || 420;
  const bossId = params.get('boss') ?? FIXTURE_BOSS_ID;
  const defeat = params.get('outcome') === 'defeat';
  const [timeline, setTimeline] = useState<FightTimeline>(() =>
    freezeIndex !== null ? freezeSnapshot(Number(freezeIndex), defeat) : fixtureSnapshots(defeat)[0],
  );
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);
  const logRef = useRef<FixtureLogEntry[]>([]);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__fightLog = logRef.current;
    w.__harnessDone = false;
    const deltas: number[] = [];
    w.__fpsDeltas = deltas;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      deltas.push(now - last);
      if (deltas.length > 3600) deltas.shift();
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const start = () => {
    if (stopRef.current) stopRef.current();
    logRef.current.length = 0;
    setDone(false);
    setStarted(true);
    stopRef.current = playFixture(
      (snapshot) => setTimeline(snapshot),
      () => {
        setDone(true);
        (window as unknown as Record<string, unknown>).__harnessDone = true;
      },
      logRef.current,
      defeat,
    );
  };

  useEffect(() => {
    if (params.get('autostart') === '1' && freezeIndex === null) {
      const t = setTimeout(start, 350);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Stage = renderer === 'dom' ? BossFightStageDom : BossFightStage;
  const bossPct = (timeline.bossHp / timeline.bossHpMax) * 100;
  const playerPct = (timeline.playerHp / timeline.playerHpMax) * 100;

  return (
    <div className="min-h-screen bg-black p-3 text-white" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div className="mb-2 flex items-center gap-3 text-[12px]" data-testid="harness-status">
        <span>renderer={renderer}</span>
        <span>phase={Math.min(timeline.currentPhaseIndex, FIXTURE_PHASES.length - 1) + 1}/{FIXTURE_PHASES.length}</span>
        <span>finished={String(timeline.finishedAt != null)}</span>
        <span data-testid="harness-done">done={String(done)}</span>
        {!started && freezeIndex === null && (
          <button type="button" className="border border-white px-2 py-0.5" onClick={start} data-testid="harness-start">
            Start fixture
          </button>
        )}
      </div>
      <div style={{ width }} data-testid="harness-stage-wrap">
        <Stage timeline={timeline} phases={FIXTURE_PHASES} bossId={bossId} weapon={FIXTURE_WEAPON} />
        <div className="mt-2 space-y-1">
          <GhostHpBar pct={bossPct} color="#F87171" testId="harness-boss-bar" />
          <GhostHpBar pct={playerPct} color="#4ADE80" testId="harness-player-bar" />
        </div>
      </div>
    </div>
  );
};
