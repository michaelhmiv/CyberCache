import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Lock, RefreshCw } from 'lucide-react';
import {
  getExtractionState,
  type ChefExtractionPass,
  type ChefExtractionState,
} from '../../lib/chef/chefClient';
import { startActiveActivity } from '../../lib/api/activityService';
import { buildExtractionActivity } from '../../lib/activity/activityBuilders';
import { ROAMING_AREAS, getRoamingArea, isRoamingAreaUnlocked } from '../../constants/roamingAreas';
import { signatureMaterialForArea } from '../../content/roamingEvents';
import { pixelBackgroundForArea } from '../../lib/pixel/manifest';
import { useIdleStore, useLoadoutStore, usePlayerStore } from '../../store';
import { useNow } from '../../hooks/useNow';
import { ExtractionScene } from '../pixelArt/ActionScenes';
import { AreaPickerList, CurrentAreaChip } from '../common/AreaPicker';
import { MobileCard } from '../layout/MobileCard';

/**
 * ExtractionPanel — the gathering occupation (0033), the Fight
 * workspace's extraction surface. Everything on it is a server fact:
 * the state read SETTLES first (accrual + finalization happen in the
 * Chef), and this panel presents what came back — pass progress,
 * the gear factor WITH its cause, the previewed draws/XP, and the
 * finds of the passes that just landed. The client runs NO pass
 * math: it never decides a pass completed, never rolls a find,
 * never prices XP. Starting or moving the site rides the ordinary
 * activity path (kind 'extraction'), where the server gates live.
 *
 * The countdown is a display interpolation of the server's accrued
 * figure, refreshed on every read — when it runs out the panel
 * re-reads instead of inventing an outcome.
 */

const slashClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatFinds(finds: Record<string, number>): string {
  const entries = Object.entries(finds).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return 'nothing this pass';
  return entries.map(([id, qty]) => `${id} ×${qty}`).join(' · ');
}

export const ExtractionPanel: React.FC<{ onLeave?: () => void }> = ({ onLeave }) => {
  const playerLevel = usePlayerStore((s) => s.level);
  const loadout = useLoadoutStore();
  const hunterWeapon = loadout.getWeapon('primary');
  const selectedAreaId = useIdleStore((s) => s.selectedRoamingAreaId);
  const setSelectedArea = useIdleStore((s) => s.setSelectedRoamingArea);
  const now = useNow();

  const [state, setState] = useState<ChefExtractionState | null>(null);
  const [readAt, setReadAt] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [showAreas, setShowAreas] = useState(false);
  const [methodChoice, setMethodChoice] = useState<'surface' | 'deep'>('surface');
  const [sessionFinds, setSessionFinds] = useState<Record<string, number>>({});
  const [sessionEssences, setSessionEssences] = useState<Record<string, number>>({});
  const [lastPasses, setLastPasses] = useState<ChefExtractionPass[]>([]);
  const [flashKey, setFlashKey] = useState(0);

  const refresh = useCallback((): Promise<void> => {
    return getExtractionState()
      .then((result) => {
        const extraction = result.extraction;
        setState(extraction);
        setReadAt(Date.now());
        setError(null);
        if (extraction.hasState) {
          setMethodChoice(extraction.method === 'deep' ? 'deep' : 'surface');
        }
        if (extraction.settled.passes.length > 0) {
          setFlashKey((k) => k + 1);
          setLastPasses(extraction.settled.passes);
          setSessionFinds((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(extraction.settled.materials)) next[k] = (next[k] ?? 0) + v;
            return next;
          });
          setSessionEssences((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(extraction.settled.essences)) next[k] = (next[k] ?? 0) + v;
            return next;
          });
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Extraction state failed');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedArea = getRoamingArea(selectedAreaId);
  const selectedUnlocked = isRoamingAreaUnlocked(selectedArea, playerLevel);
  const preview = state?.preview ?? null;
  const active = state?.active ?? false;
  const deepUnlocked = preview?.deepUnlocked ?? (state?.mastery.level ?? 1) >= 5;
  const signature = signatureMaterialForArea(selectedArea.id);

  // Display interpolation of the server's accrued figure (see the
  // header): the bar fills between reads; the panel re-reads when
  // the interpolated pass would end rather than deciding anything.
  const accruedDisplay = useMemo(() => {
    if (!state) return 0;
    if (!active) return state.accruedMs;
    return Math.min(state.passMs, state.accruedMs + Math.max(0, now - readAt));
  }, [state, active, now, readAt]);

  useEffect(() => {
    if (state && active && state.accruedMs + Math.max(0, now - readAt) >= state.passMs) {
      void refresh();
    }
  }, [state, active, now, readAt, refresh]);

  const startExtraction = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      await startActiveActivity(buildExtractionActivity(selectedArea, methodChoice));
      await refresh();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Could not start extraction');
    } finally {
      setStarting(false);
    }
  }, [selectedArea, methodChoice, refresh]);

  if (loading && !state) {
    return (
      <MobileCard>
        <p className="text-xs text-text-muted" data-testid="extraction-panel-loading">Reading the site…</p>
      </MobileCard>
    );
  }

  const passNumber = (state?.finalizedPasses ?? 0) + (state?.pendingPasses ?? 0) + 1;
  const progress = state ? Math.min(1, accruedDisplay / state.passMs) : 0;
  const sceneBackground = pixelBackgroundForArea(state?.passAreaId ?? selectedArea.id) ?? 'zone-dustwaste-bg';
  const degraded = active && state?.method === 'deep' && preview?.deepDegraded;

  return (
    <div className="space-y-3" data-testid="extraction-panel">
      {onLeave && !active && (
        <button type="button" onClick={onLeave} className="bl-secondary px-2 py-1 text-[10px] font-black" data-testid="extraction-close">
          ← Back to actions
        </button>
      )}
      <ExtractionScene
        key={`extract-scene-${flashKey}`}
        backgroundId={sceneBackground}
        deep={state?.passMethod === 'deep'}
        paused={state?.hasState && !active}
        unarmed={!hunterWeapon}
        progress={progress}
        causeLabel={
          state?.hasState
            ? active
              ? `Pass ${passNumber} · ${formatClock(state.passMs - accruedDisplay)} left`
              : `Pass ${passNumber} · paused at ${formatClock(state.passMs - state.accruedMs)} left`
            : 'No site claimed yet'
        }
        buysLabel={preview ? `→ ~${preview.drawsPerPass} draws · ${preview.xpPerPass} XP` : undefined}
        result={lastPasses.length > 0 ? 'success' : null}
      />

      {error && (
        <MobileCard>
          <div className="flex items-center gap-2 text-xs text-red" data-testid="extraction-error">
            <AlertTriangle size={14} /> {error}
            <button type="button" onClick={() => void refresh()} className="ml-auto bl-secondary px-2 py-1 text-[10px] font-black">
              Retry
            </button>
          </div>
        </MobileCard>
      )}

      <MobileCard>
        <div className="flex items-start justify-between gap-2" data-testid="extraction-readout">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-text-muted">Extraction</div>
            <div className="text-sm font-black text-text-primary">
              {state?.hasState
                ? `${getRoamingArea(state.passAreaId ?? selectedArea.id).name} — ${state.passMethod === 'deep' ? 'Deep Delve' : 'Surface Sweep'}`
                : 'No site claimed'}
            </div>
            <div className="mt-0.5 text-[10px] text-text-muted">
              {active
                ? 'Working the site. Passes land every 10 minutes while Extraction holds the action slot.'
                : state?.hasState
                  ? 'Paused — extraction only accrues while it is the active action.'
                  : 'Claim a site to start gathering materials for the crafter economy.'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="bl-secondary shrink-0 px-2 py-1 text-[10px] font-black"
            data-testid="extraction-refresh"
          >
            <RefreshCw size={11} className="mr-1 inline" /> Settle
          </button>
        </div>

        {preview && (
          <div className="mt-3 grid grid-cols-3 gap-1.5 text-[10px]" data-testid="extraction-preview">
            <div className="bg-surface/80 p-2">
              <span className="text-text-muted">Gear factor</span>
              <div className="text-xs font-black text-text-primary">×{preview.gearFactor.toFixed(2)}</div>
              <div className="mt-0.5 leading-snug text-text-muted">
                Pool {Math.round(preview.survivalPool)} vs ~{preview.expectedPassDamage} damage a pass draws at {preview.areaName}
              </div>
            </div>
            <div className="bg-surface/80 p-2">
              <span className="text-text-muted">Per pass</span>
              <div className="text-xs font-black text-text-primary">~{preview.drawsPerPass} draws</div>
              <div className="mt-0.5 leading-snug text-text-muted">
                {preview.xpPerPass} XP · mastery Lv.{state?.mastery.level ?? 1}
                {preview.isHot ? ' · hot area ×1.2' : ''}
              </div>
            </div>
            <div className="bg-surface/80 p-2">
              <span className="text-text-muted">Signature</span>
              <div className="truncate text-xs font-black text-amber">{signature ? signature.displayName : '—'}</div>
              <div className="mt-0.5 leading-snug text-text-muted">
                {signature ? `Only dug here, at ${signature.homeAreaId === selectedArea.id ? 'home' : 'another site'}` : 'No signature material here'}
              </div>
            </div>
          </div>
        )}

        {degraded && (
          <div className="mt-2 flex items-start gap-2 border-2 border-amber/60 bg-amber/10 p-2 text-[11px] font-bold text-text-primary" data-testid="extraction-degraded">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber" />
            Deep Delve is paying as Surface: the gear factor at this site is below ×0.80 with your current loadout. The delve resumes full rate when a settling pass prices at ×0.80 or better.
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex" role="group" aria-label="Extraction method">
            <button
              type="button"
              onClick={() => setMethodChoice('surface')}
              className={`px-2.5 py-1.5 text-[10px] font-black ${methodChoice === 'surface' ? 'bl-primary' : 'bl-secondary'}`}
              style={slashClip}
              data-testid="extraction-method-surface"
            >
              Surface Sweep
            </button>
            <button
              type="button"
              onClick={() => deepUnlocked && setMethodChoice('deep')}
              disabled={!deepUnlocked}
              className={`px-2.5 py-1.5 text-[10px] font-black disabled:opacity-50 ${methodChoice === 'deep' ? 'bl-primary' : 'bl-secondary'}`}
              style={slashClip}
              data-testid="extraction-method-deep"
              title={deepUnlocked ? 'Deep Delve: 1.5× draws while the gear factor holds ×0.80' : 'Deep Delve unlocks at Extraction mastery 5'}
            >
              {deepUnlocked ? 'Deep Delve ×1.5' : <><Lock size={10} className="mr-1 inline" /> Deep Delve</>}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void startExtraction()}
            disabled={starting || !selectedUnlocked}
            className="bl-primary px-3 py-1.5 text-[11px] font-black disabled:opacity-50"
            data-testid="extraction-start"
          >
            {starting
              ? 'Claiming…'
              : active && state?.areaId === selectedArea.id && state?.method === methodChoice
                ? 'Site claimed'
                : active
                  ? 'Move site (next pass)'
                  : state?.hasState
                    ? 'Resume extraction here'
                    : 'Start extraction'}
          </button>
          {!selectedUnlocked && (
            <span className="text-[10px] font-bold text-red">Locked until level {selectedArea.unlockLevel}</span>
          )}
        </div>
        {!deepUnlocked && (
          <p className="mt-1.5 text-[10px] text-text-muted">
            Deep Delve unlocks at Extraction mastery 5 (currently Lv.{state?.mastery.level ?? 1}) and pays 1.5× draws while your gear factor at the site holds ×0.80.
          </p>
        )}
        {startError && (
          <div className="mt-2 flex items-start gap-2 border-2 border-red/60 bg-red/10 p-2 text-[11px] font-bold text-text-primary" data-testid="extraction-start-error">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red" /> {startError}
          </div>
        )}
        <p className="mt-2 text-[10px] leading-snug text-text-muted">
          Finds are materials and essences only — no gear, no credits. Site and method changes take effect at the next pass boundary; the current pass finishes on the terms it started.
        </p>
      </MobileCard>

      <MobileCard>
        <div className="mb-2 flex items-center justify-between" data-testid="extraction-site-picker">
          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-text-muted">Site</div>
          <CurrentAreaChip onClick={() => setShowAreas((v) => !v)} />
        </div>
        {showAreas ? (
          <div className="space-y-2">
            <AreaPickerList
              onSelect={(area) => {
                setSelectedArea(area.id);
                setShowAreas(false);
              }}
            />
          </div>
        ) : (
          <p className="text-[11px] text-text-muted">
            Extraction works your current area — {selectedArea.name}. Its signature material
            {signature ? ` (${signature.displayName})` : ''} only comes out of the ground here.
          </p>
        )}
      </MobileCard>

      {lastPasses.length > 0 && (
        <MobileCard>
          <div data-testid="extraction-last-passes" className="mb-1 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-text-muted">
            <CheckCircle size={11} className="text-green" /> Just landed
          </div>
          <div className="space-y-1.5">
            {lastPasses.map((pass) => (
              <div key={pass.index} className="bg-surface/80 p-2 text-[11px]" data-testid={`extraction-pass-${pass.index}`}>
                <div className="flex justify-between gap-2">
                  <span className="font-black text-text-primary">
                    Pass {pass.index} · {ROAMING_AREAS.find((a) => a.id === pass.areaId)?.name ?? pass.areaId}
                    {pass.method === 'deep' ? ' · Deep Delve' : ''}
                    {pass.deepDegraded ? ' · paid as Surface' : ''}
                  </span>
                  <span className="font-black text-purple-300">+{pass.xpAwarded} XP</span>
                </div>
                <div className="mt-0.5 text-text-secondary">
                  {formatFinds({ ...pass.materials, ...pass.essences })}
                  {pass.signatureUnits > 0 && (
                    <span className="text-amber"> · signature ×{pass.signatureUnits}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </MobileCard>
      )}

      {(Object.keys(sessionFinds).length > 0 || Object.keys(sessionEssences).length > 0) && (
        <MobileCard>
          <div data-testid="extraction-session-finds" className="mb-1 text-[9px] font-black uppercase tracking-[0.18em] text-text-muted">This session</div>
          <p className="text-[11px] leading-snug text-text-secondary">
            {formatFinds({ ...sessionFinds, ...sessionEssences })}
          </p>
          <p className="mt-1 text-[10px] text-text-muted">
            {state?.finalizedPasses ?? 0} passes all-time · {state?.totalXpAwarded ?? 0} XP banked from extraction
          </p>
        </MobileCard>
      )}
    </div>
  );
};
