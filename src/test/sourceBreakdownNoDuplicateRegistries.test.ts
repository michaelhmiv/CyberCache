import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const sourceFiles = () => filesUnder('src')
  .filter((path) => /\.tsx?$/.test(path))
  .filter((path) => !path.includes('/test/'));

describe('source breakdown duplicate registry guard', () => {
  it('does not redeclare source bucket order outside sourceBuckets.ts', () => {
    const offenders = sourceFiles().filter((path) => {
      if (path.endsWith('src/lib/stats/sourceBuckets.ts')) return false;
      const text = readFileSync(path, 'utf8');
      return /const\s+BUCKET_ORDER\b/.test(text) ||
        /const\s+BUCKET_BADGE\b/.test(text) ||
        /type\s+Bucket\b/.test(text) ||
        text.includes("['base', 'gear', 'weapon', 'skill', 'activity', 'consumable', 'server', 'runtime']");
    });

    expect(offenders).toEqual([]);
  });

  it('does not redeclare combat core metric keys outside headlineMetrics.ts', () => {
    const offenders = sourceFiles().filter((path) => {
      if (path.endsWith('src/lib/hud/headlineMetrics.ts')) return false;
      const text = readFileSync(path, 'utf8');
      return text.includes("['health', 'effectiveHp', 'dps', 'shieldBreak']") ||
        text.includes("'health', 'effectiveHp', 'dps', 'shieldBreak'");
    });

    expect(offenders).toEqual([]);
  });
});
