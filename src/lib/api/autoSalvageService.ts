/**
 * Auto-Salvage Rule service (migration 0080) — the Settings card's
 * read/write path for the profile-owned rule. The rule lives on the
 * profile (profiles.auto_salvage_*); the Chef applies it when
 * roaming claims and offline settlements store drops. The client
 * store (idleSlice) is display state only: this service is how the
 * card re-reads the authoritative rule and writes changes through.
 * Like setOfflineCapLimiter, validation reports as data
 * ({ ok: false, error }).
 */
import { apiRequest } from './http';

export interface AutoSalvageRule {
  enabled: boolean;
  maxRarity: string;
  maxQuality: number;
  toMaterials: boolean;
}

export const AUTO_SALVAGE_DEFAULT_RULE: AutoSalvageRule = {
  enabled: true,
  maxRarity: 'Common',
  maxQuality: 20,
  toMaterials: false,
};

interface RuleResponse {
  ok: boolean;
  error?: string;
  autoSalvage?: {
    enabled?: boolean;
    maxRarity?: string;
    maxQuality?: number;
    toMaterials?: boolean;
  };
}

function toRule(data: RuleResponse | null): AutoSalvageRule | null {
  if (!data?.ok || !data.autoSalvage) return null;
  const r = data.autoSalvage;
  return {
    enabled: r.enabled !== false,
    maxRarity: typeof r.maxRarity === 'string' ? r.maxRarity : AUTO_SALVAGE_DEFAULT_RULE.maxRarity,
    maxQuality: typeof r.maxQuality === 'number' ? r.maxQuality : AUTO_SALVAGE_DEFAULT_RULE.maxQuality,
    toMaterials: r.toMaterials === true,
  };
}

/** Read the caller's authoritative rule (null when unreachable / no profile). */
export async function getAutoSalvageRule(): Promise<AutoSalvageRule | null> {
  try {
    const data = await apiRequest<RuleResponse>('/profile/auto-salvage', { method: 'GET' });
    return toRule(data);
  } catch (error) {
    console.error('getAutoSalvageRule failed:', error instanceof Error ? error.message : 'Unknown error.');
    return null;
  }
}

export interface SetAutoSalvageRuleResult {
  ok: boolean;
  error?: string;
  rule?: AutoSalvageRule;
}

/** Write the whole rule; the server validates and reports as data. */
export async function setAutoSalvageRule(rule: AutoSalvageRule): Promise<SetAutoSalvageRuleResult> {
  try {
    const data = await apiRequest<RuleResponse>('/profile/auto-salvage', {
      method: 'POST',
      body: {
        enabled: rule.enabled,
        max_rarity: rule.maxRarity,
        max_quality: rule.maxQuality,
        to_materials: rule.toMaterials,
      },
    });
    if (!data?.ok) return { ok: false, error: data?.error ?? 'Could not save the Auto-Salvage Rules.' };
    return { ok: true, rule: toRule(data) ?? rule };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    console.error('setAutoSalvageRule failed:', message);
    return { ok: false, error: message };
  }
}
