import { REGION_1_BOSSES } from '../constants/bosses';
import type { BossDef } from '../types/boss';

export interface EncounterContentRef {
  id: string;
  name: string;
  tier: number;
  level: number;
  recommendedPower: number;
  lootTableId: string;
  dedicatedDropIds: string[];
  legacyDropIds: string[];
  phaseIds: string[];
  migrationStatus: 'legacy_bridge' | 'content_native';
}

export interface EncounterAuditIssue {
  encounterId: string;
  code: string;
  message: string;
}

export function getLegacyRegionOneEncounters(): BossDef[] {
  return REGION_1_BOSSES;
}

export function toEncounterContentRef(encounter: BossDef): EncounterContentRef {
  return {
    id: encounter.id,
    name: encounter.name,
    tier: encounter.tier,
    level: encounter.level,
    recommendedPower: encounter.recommendedPower,
    lootTableId: `encounter_${encounter.id}_rewards`,
    dedicatedDropIds: [...encounter.dedicatedDrops],
    legacyDropIds: [...encounter.dropTable],
    phaseIds: encounter.phases?.map((phase) => phase.id) ?? [],
    migrationStatus: 'legacy_bridge',
  };
}

export function getEncounterContentRefs(): EncounterContentRef[] {
  return REGION_1_BOSSES.map(toEncounterContentRef);
}

export function getEncounterById(encounterId: string): BossDef | undefined {
  return REGION_1_BOSSES.find((encounter) => encounter.id === encounterId);
}

export function requireEncounterById(encounterId: string): BossDef {
  const encounter = getEncounterById(encounterId);
  if (!encounter) throw new Error(`Missing encounter '${encounterId}'.`);
  return encounter;
}

export function getEncounterContentRef(encounterId: string): EncounterContentRef | undefined {
  const encounter = getEncounterById(encounterId);
  return encounter ? toEncounterContentRef(encounter) : undefined;
}

export function auditEncounterContentRefs(refs = getEncounterContentRefs()): EncounterAuditIssue[] {
  const issues: EncounterAuditIssue[] = [];
  const ids = new Set<string>();

  for (const ref of refs) {
    if (ids.has(ref.id)) {
      issues.push({ encounterId: ref.id, code: 'duplicate_encounter_id', message: `Duplicate encounter id '${ref.id}'.` });
    }
    ids.add(ref.id);

    if (!ref.lootTableId) {
      issues.push({ encounterId: ref.id, code: 'missing_loot_table_id', message: `Encounter '${ref.id}' has no content loot table id.` });
    }
    if (ref.legacyDropIds.length === 0) {
      issues.push({ encounterId: ref.id, code: 'missing_legacy_drop_ids', message: `Encounter '${ref.id}' has no legacy drop ids to migrate.` });
    }
    if (ref.dedicatedDropIds.some((dropId) => !ref.legacyDropIds.includes(dropId))) {
      issues.push({ encounterId: ref.id, code: 'dedicated_drop_missing_from_pool', message: `Encounter '${ref.id}' has a dedicated drop outside its legacy drop pool.` });
    }
    if (ref.phaseIds.length === 0) {
      issues.push({ encounterId: ref.id, code: 'missing_phase_ids', message: `Encounter '${ref.id}' has no phase ids.` });
    }
    if (ref.level < 1) {
      issues.push({ encounterId: ref.id, code: 'invalid_level', message: `Encounter '${ref.id}' has invalid level ${ref.level}.` });
    }
    if (ref.recommendedPower <= 0) {
      issues.push({ encounterId: ref.id, code: 'invalid_recommended_power', message: `Encounter '${ref.id}' has non-positive recommended power.` });
    }
  }

  return issues;
}
