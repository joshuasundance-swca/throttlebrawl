import { describe, expect, it, vi } from 'vitest';

// Polish batch O's check, punch item 3: the boot's 37 Keys road files went out before startOffline
// wrapped the page's fetch, so they got none of the loader's rules (no pacing once the host asks, no
// wait for its 429, no retry, no read of the offline caches). loadBootContent now hands the page's
// fetch to the loader first (platform/'s paceBuildFetches), then fetches the road data. The loader
// itself is tested in src/platform/loader.test.ts.

const order: string[] = [];
vi.mock('../platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform')>()),
  paceBuildFetches: () => {
    order.push('loader');
  },
}));
vi.mock('../content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../content')>()),
  loadBaseRoads: () => {
    order.push('road data');
    return Promise.resolve();
  },
}));

const { loadBootContent } = await import('./index');

describe("the boot's road data", () => {
  it('is fetched through the loader: the page fetch is handed to it first', async () => {
    await loadBootContent();
    // The negative control is main, which fetched the road data with nothing before it.
    expect(order).toEqual(['loader', 'road data']);
  });
});
