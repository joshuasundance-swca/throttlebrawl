// Dataset assets (run W-Q; interview 2026-10-02: "Real models now"). The big files pinned in
// `assets.lock.json` from the Hugging Face dataset repo are baked into the build by
// `scripts/dataset-assets.mjs`, which serves their manifest rows as `virtual:dataset-assets`. The
// game merges them into the one asset manifest, so a rider or bike model loads by asset id like any
// pack model, and a region's models load only when a race there starts.
import rows from 'virtual:dataset-assets';
import type { AssetIndexEntry } from '../core';

/** The dataset rows this build carries, every region or one (`region` given). */
export function datasetIndex(region?: string): readonly AssetIndexEntry[] {
  return region === undefined ? rows : rows.filter((r) => r.region === undefined || r.region === region);
}

/** The regions that have dataset files of their own, sorted. */
export function datasetRegions(): readonly string[] {
  return [...new Set(rows.flatMap((r) => (r.region === undefined ? [] : [r.region])))].sort();
}
