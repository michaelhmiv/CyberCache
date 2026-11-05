import React, { useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { BONE, BONE_FAINT, Bolts, PlateFootStrip, STEEL, plateShell } from '@/components/profile/HunterPlates';
import { getMyMasterySummary, masteryLevelProgress, type MasterySummaryRow } from '@/lib/api/masteryService';

/**
 * Mastery section (Profile) — the first UI caller of masteryService.
 *
 * Mastery XP is granted server-side by the ledger trigger
 * (cc_apply_mastery_for_verified_action; shipped Chef flows aligned
 * in migration 0014) and read back through GET /api/mastery/summary.
 * This section only renders what the service returns: one row per
 * earned mastery with its level and progress toward the next.
 */
export const MasterySection: React.FC = () => {
  const [rows, setRows] = useState<MasterySummaryRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyMasterySummary().then((data) => {
      if (!cancelled) setRows(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Arena Plates (2026-11-05): Mastery is a segment of the Skill
  // Trees stop, so its shell wears the same plate register — the
  // mastery green survives as data (icon, level numerals, progress
  // fill), never as a colored side bar.
  return (
    <div className="relative overflow-hidden p-4" style={plateShell}>
      <Bolts />
      <div className="relative space-y-2">
        <div className="flex items-center gap-2">
          <PxIcon name="star5" size={17} className="text-green" />
          <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: BONE }}>Mastery</div>
          <div className="ml-auto text-[11px]" style={{ color: BONE_FAINT }}>{rows ? `${rows.length} tracked` : ''}</div>
        </div>
        {rows === null ? (
          <div className="text-[11px]" style={{ color: BONE_FAINT }}>Loading mastery…</div>
        ) : rows.length === 0 ? (
          <div className="text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
            No mastery earned yet. Roaming, boss fights, crafting, and trading each feed their own track as you play — mastery unlocks recipes and raises crafting quality.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const xp = Math.max(0, Math.floor(Number(row.mastery_xp) || 0));
              const progress = masteryLevelProgress(xp);
              return (
                <li key={row.mastery_id} data-testid="mastery-row" data-mastery-id={row.mastery_id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate font-bold" style={{ color: BONE }}>{row.label}</span>
                    <span className="shrink-0" style={{ color: BONE_FAINT }}>
                      Lv <span className="font-black text-green">{row.mastery_level}</span>
                      <span> · {xp.toLocaleString()} XP</span>
                      {row.rank > 0 ? <span> · #{row.rank}</span> : null}
                    </span>
                  </div>
                  <div
                    className="h-1.5 overflow-hidden border border-black/60 bg-black/40"
                    style={{ clipPath: 'polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%)' }}
                  >
                    <div className="h-full bg-green transition-all" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
                  </div>
                  <div className="text-[11px]" style={{ color: BONE_FAINT }}>
                    {row.category} · {progress.intoLevel} / {progress.levelSpan} XP to level {row.mastery_level + 1}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <PlateFootStrip color={STEEL} height={3} />
    </div>
  );
};
