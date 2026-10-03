// Preload hints for the data boot waits on (run W-S; docs/engineering.md, perf check). The Keys'
// hand-made road data ships as JSON files beside the build, off the first-load JavaScript (#380),
// and src/main.ts fetches it before the app starts. Without a hint the browser asks for it only
// once the entry script has downloaded and run: one more round trip before the start screen. A
// `<link rel="preload" as="fetch" crossorigin>` per file starts each download with the page, and
// the app's own fetch() then takes it from the preload (same URL, CORS mode and credentials). The
// real-road (`osm-*`) files are fetched later, on demand, so they get no hint.

/** A hand-made base road file (network, road or route): the ones boot fetches (src/content/base-pack.ts). */
export const BOOT_ROAD_FILE =
  /(?:^|\/)packs\/base\/regions\/[^/]+\/(?:networks|roads|routes)\/(?!osm-)[^/]+\.json$/;

/**
 * The preload tags for a build's boot road files, in file-name order.
 * @param {readonly { type: string, fileName: string, originalFileNames?: readonly string[] }[]} files
 *   the bundle's output files
 * @returns {{ tag: 'link', attrs: Record<string, string | boolean>, injectTo: 'head' }[]}
 */
export function bootPreloadTags(files) {
  return files
    .filter(
      (f) =>
        f.type === 'asset' &&
        (f.originalFileNames ?? []).some((name) => BOOT_ROAD_FILE.test(name.split('\\').join('/'))),
    )
    .map((f) => f.fileName)
    .sort()
    .map((fileName) => ({
      tag: /** @type {const} */ ('link'),
      attrs: { rel: 'preload', as: 'fetch', crossorigin: true, href: `./${fileName}` },
      injectTo: /** @type {const} */ ('head'),
    }));
}

/** A Vite plugin: the built index.html preloads the boot road files. */
export function bootPreloadPlugin() {
  return {
    name: 'throttlebrawl:boot-preload',
    apply: /** @type {const} */ ('build'),
    transformIndexHtml: {
      order: /** @type {const} */ ('post'),
      /**
       * @param {string} _html
       * @param {{ bundle?: Record<string, { type: string, fileName: string, originalFileNames?: readonly string[] }> }} ctx
       */
      handler(_html, ctx) {
        return ctx.bundle ? bootPreloadTags(Object.values(ctx.bundle)) : [];
      },
    },
  };
}
