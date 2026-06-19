import type { StatTone } from '@/lib/stats/characterStats';
import type { StatSourceBucket } from '@/lib/stats/sourceBuckets';

export type StatSource = {
  source: string;
  detail: string;
  value: number;
  display: string;
  tone?: StatTone;
  bucket?: StatSourceBucket;
  /** Optional label override for composition bars. Defaults to `source`. */
  segmentLabel?: string;
  /** Hide this source from composition bars while retaining it in detail rows. */
  hideFromComposition?: boolean;
};

export type StatCompositionSegment = {
  value: number;
  display: string;
  tone: StatTone;
  label: string;
};

export function sourceToSegment(source: StatSource, fallbackTone: StatTone): StatCompositionSegment {
  return {
    value: source.value,
    display: source.display,
    tone: source.tone ?? fallbackTone,
    label: source.segmentLabel ?? source.source,
  };
}

export function sourcesToSegments(sources: StatSource[], fallbackTone: StatTone): StatCompositionSegment[] {
  return sources
    .filter((source) => !source.hideFromComposition)
    .filter((source) => source.value !== 0)
    .map((source) => sourceToSegment(source, fallbackTone));
}
