/**
 * The effective offline (AFK) cap in hours, for display: the one
 * formula (src/content/offlineCap.ts) composed from the Research
 * carrier (Chef-owned completions, read like the ResearchChip
 * reads them), the skill bonus, and the player's Settings limiter
 * (a stored value counts only inside 1–24; anything else is no
 * limiter). Settlement itself is always server-derived — this is
 * the same display composition the retired stage band shipped.
 */
import { useEffect, useState } from 'react';
import { usePlayerStore, useSkillStore } from '@/store';
import { effectiveOfflineCapHours } from '@/content/offlineCap';
import { getResearchState } from '@/lib/chef/chefClient';

export function useOfflineCapHours(): number {
  const offlineCapHours = usePlayerStore((s) => s.offlineCapHours);
  const skills = useSkillStore();
  const [researchCapHours, setResearchCapHours] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getResearchState()
      .then((result) => {
        if (!cancelled) setResearchCapHours(result.research.bonuses.offlineCapBonus);
      })
      .catch(() => {
        // Chef unreachable: base-only display.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const skillBonuses = skills.getBonuses();
  const storedLimiter = offlineCapHours >= 1 && offlineCapHours <= 24 ? Math.floor(offlineCapHours) : null;
  return effectiveOfflineCapHours({
    researchCapHours,
    bonusHours: Math.max(0, Math.floor(skillBonuses.offlineCapBonus ?? 0)),
    userCapHours: storedLimiter,
  });
}
