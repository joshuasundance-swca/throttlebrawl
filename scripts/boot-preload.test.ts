// The boot road preload hints (scripts/boot-preload.mjs): index.html preloads exactly the Keys'
// hand-made road files boot fetches before the app starts (#380 moved them off the first-load
// JavaScript), as fetch-mode preloads the app's own fetch() can take over, and nothing else.
import { describe, expect, it } from 'vitest';
import { BOOT_ROAD_FILE, bootPreloadTags } from './boot-preload.mjs';

const asset = (fileName: string, original: string) => ({
  type: 'asset',
  fileName,
  originalFileNames: [original],
});

describe('the boot road preloads', () => {
  it("match the hand-made base road data, not the real roads, other packs' roads or other assets", () => {
    for (const p of [
      'packs/base/regions/florida-keys/networks/keys-m1.json',
      'packs/base/regions/florida-keys/roads/m1-marina-run.json',
      '/abs/repo/packs/base/regions/florida-keys/routes/m1-skeleton-sprint.json',
    ])
      expect(BOOT_ROAD_FILE.test(p), p).toBe(true);
    for (const p of [
      'packs/base/regions/florida-keys/roads/osm-big-pine-bend.json',
      'packs/base/regions/florida-keys/networks/osm-keys-bahia-honda.json',
      'packs/region-pnw/regions/pacific-northwest/roads/chuckanut.json',
      'packs/base/assets/backdrop/keys.json',
      'packs/base/regions/florida-keys/region.json',
    ])
      expect(BOOT_ROAD_FILE.test(p), p).toBe(false);
  });

  it('are fetch preloads with CORS, in file-name order, relative to the page', () => {
    const tags = bootPreloadTags([
      asset('assets/m1-marina-run-abc.json', 'packs/base/regions/florida-keys/roads/m1-marina-run.json'),
      asset('assets/keys-m1-def.json', 'packs\\base\\regions\\florida-keys\\networks\\keys-m1.json'),
      asset(
        'assets/osm-big-pine-bend-x.json',
        'packs/base/regions/florida-keys/roads/osm-big-pine-bend.json',
      ),
      asset('assets/chuckanut-y.json', 'packs/region-pnw/regions/pacific-northwest/roads/chuckanut.json'),
      { type: 'chunk', fileName: 'assets/index-z.js' },
      { type: 'asset', fileName: 'assets/no-origin.json' },
    ]);
    expect(tags).toEqual([
      {
        tag: 'link',
        attrs: { rel: 'preload', as: 'fetch', crossorigin: true, href: './assets/keys-m1-def.json' },
        injectTo: 'head',
      },
      {
        tag: 'link',
        attrs: { rel: 'preload', as: 'fetch', crossorigin: true, href: './assets/m1-marina-run-abc.json' },
        injectTo: 'head',
      },
    ]);
  });
});
