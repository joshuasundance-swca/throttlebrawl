// Minified JSON assets (run W-P; docs/engineering.md, perf check). The pack road data the build
// ships beside the JavaScript (`?url` imports: region roads and the Keys' real roads) is copied
// as authored, pretty-printed with two-space indents. The game only parses it, so the build writes
// it on one line: about a fifth fewer bytes for every file, which the whole-build size limit counts
// and the phone downloads. The data is unchanged (JSON.parse of either is equal), and a file that
// does not parse is left as it is.

/** The JSON text on one line, or null when it does not parse (it is then left alone). */
export function minifyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return null;
  }
}

/** A Vite plugin: every emitted `.json` asset is written minified. */
export function minifyJsonAssetsPlugin() {
  return {
    name: 'throttlebrawl:minify-json-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.json')) continue;
        const text = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
        const min = minifyJson(text);
        if (min !== null && min.length < text.length) file.source = min;
      }
    },
  };
}
