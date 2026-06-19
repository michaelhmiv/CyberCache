import { describe, expect, it } from 'vitest';
import { ACTIVITY_MODULE_DEFS } from '@/content/activityModuleDefs';
import {
  getActivityModuleStatKeys,
  getActivityModuleStatLabel,
  getPrimaryActivityModuleStatKeys,
} from '@/lib/activity/activityStatMetadata';

describe('activity stat metadata', () => {
  it('derives stat keys from ACTIVITY_MODULE_DEFS', () => {
    for (const def of Object.values(ACTIVITY_MODULE_DEFS)) {
      expect(getActivityModuleStatKeys(def.activityKind)).toEqual(def.subStats.map((sub) => sub.key));
    }
  });

  it('uses sub-stat labels from ACTIVITY_MODULE_DEFS', () => {
    expect(getActivityModuleStatLabel('crafting', 'craftingSpeed')).toBe('Crafting Speed');
    expect(getActivityModuleStatLabel('workshop_service', 'parallelQueueSlots')).toBe('Parallel Slots');
  });

  it('returns four primary headline candidates', () => {
    expect(getPrimaryActivityModuleStatKeys('crafting')).toHaveLength(4);
  });
});
