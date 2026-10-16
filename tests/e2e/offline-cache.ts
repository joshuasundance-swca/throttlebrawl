import type { Page } from '@playwright/test';

/** The tab's worker caches: ours, and every same-origin file the page loaded that none holds. */
export async function cacheOfLoadedFiles(page: Page) {
  return page.evaluate(async () => {
    const own = (await caches.keys()).filter((n) => n.startsWith('offline-'));
    const loaded = [
      ...new Set(
        performance
          .getEntriesByType('resource')
          .map((e) => e.name.split('#')[0] ?? '')
          .filter((u) => u.startsWith(location.origin)),
      ),
    ];
    const missing: string[] = [];
    for (const url of loaded) {
      // changelog.json is written after the build, so it is kept the first time the page reads it
      // through the worker, not cached up front; the worker file is never cached.
      if (url.endsWith('/changelog.json') || url.endsWith('/sw.js')) continue;
      if (!(await caches.match(url, { ignoreVary: true }))) missing.push(url);
    }
    // A negative control: the same lookup finds nothing for a file the build never had.
    const control = await caches.match(`${location.origin}/no-such-file.js`);
    return { own, checked: loaded.length, missing, control: control !== undefined };
  });
}
