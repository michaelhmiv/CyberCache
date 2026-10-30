import React, { useEffect, useState } from 'react';
import { MobileCard } from '@/components/layout/MobileCard';
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

  return (
    <MobileCard className="space-y-2" rarityColor="#7CFC00">
      <div className="flex items-center gap-2">
        <span className="font-black text-green" style={{ fontSize: '16px' }}>★</span>
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Mastery</div>
        <div className="ml-auto text-[10px] text-text-muted">{rows ? `${rows.length} tracked` : ''}</div>
      </div>
      {rows === null ? (
        <div className="text-[10px] text-text-muted">Loading mastery…</div>
      ) : rows.length === 0 ? (
        <div className="text-[10px] text-text-muted">
          No mastery earned yet. Roam, fight bosses, craft, and trade — verified play feeds these tracks.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const xp = Math.max(0, Math.floor(Number(row.mastery_xp) || 0));
            const progress = masteryLevelProgress(xp);
            return (
              <li key={row.mastery_id} data-testid="mastery-row" data-mastery-id={row.mastery_id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-bold text-text-primary">{row.label}</span>
                  <span className="shrink-0 text-text-secondary">
                    Lv <span className="font-black text-green">{row.mastery_level}</span>
                    <span className="text-text-muted"> · {xp.toLocaleString()} XP</span>
                    {row.rank > 0 ? <span className="text-text-muted"> · #{row.rank}</span> : null}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden border border-border bg-bg"
                  style={{ clipPath: 'polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%)' }}
                >
                  <div className="h-full bg-green transition-all" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
                </div>
                <div className="text-[9px] text-text-muted">
                  {row.category} · {progress.intoLevel} / {progress.levelSpan} XP to level {row.mastery_level + 1}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </MobileCard>
  );
};
