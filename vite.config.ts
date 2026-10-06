import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, runnerImport, type Plugin } from 'vite';
import { SIM_CODE_HASH_PLACEHOLDER, simChunkGroup, simCodeHashPlugin } from './scripts/sim-chunk.mjs';
import { minifyJsonAssetsPlugin } from './scripts/json-assets.mjs';
import { bootPreloadPlugin } from './scripts/boot-preload.mjs';
import { datasetAssetsPlugin } from './scripts/dataset-assets.mjs';
import { stripPackNotesPlugin } from './scripts/pack-notes.mjs';
import { serviceWorkerPlugin } from './scripts/service-worker.mjs';
import { creditsPlugin } from './scripts/credits.mjs';

// Build stamp (docs/engineering.md, "Vite settings"). CI sets BUILD_ID, BUILD_CHANNEL and
// BUILD_BRANCH; a local build falls back to git and the `dev` channel.
function fromGit(args: string[], fallback: string): string {
  try {
    const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || fallback;
  } catch {
    return fallback;
  }
}

const CHANNELS = ['prod', 'staging', 'dev'];
const buildChannel = process.env.BUILD_CHANNEL ?? 'dev';
if (!CHANNELS.includes(buildChannel)) {
  throw new Error(`BUILD_CHANNEL must be one of ${CHANNELS.join(', ')}, got ${buildChannel}`);
}
const buildId = (process.env.BUILD_ID || fromGit(['rev-parse', 'HEAD'], 'unknown')).slice(0, 7);
const buildBranch = process.env.BUILD_BRANCH || fromGit(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown');

const root = fileURLToPath(new URL('.', import.meta.url));

// The cross-architecture self-test (docs/architecture.md, "Testing seams"; M1 dev-2): at build
// time Node runs the fixed self-test race through Vite's module runner and bakes its result into
// the build as `virtual:selftest-expected`; `?selftest=1` runs the same race in the browser and
// compares. Until src/dev/selftest/race.ts exists the module exports null ("not built").
const SELFTEST_ID = 'virtual:selftest-expected';
const SELFTEST_RACE = '/src/dev/selftest/race.ts';
/** The race's Node entry: it gives the base pack its hand-made road data from disk first (run W-S). */
const SELFTEST_NODE = '/scripts/selftest-race.ts';
function selfTestHash(): Plugin {
  const resolved = `\0${SELFTEST_ID}`;
  return {
    name: 'throttlebrawl:selftest-hash',
    resolveId: (source) => (source === SELFTEST_ID ? resolved : null),
    async load(id) {
      if (id !== resolved) return null;
      if (!existsSync(path.join(root, SELFTEST_RACE))) return 'export default null;';
      const { module } = await runnerImport<{ runSelfTestRace(): unknown }>(SELFTEST_NODE, {
        configFile: false,
        root,
        logLevel: 'error',
        // The race's imports reach src/assets, which reads the dataset rows (run W-Q).
        plugins: [datasetAssetsPlugin({ root })],
      });
      return `export default ${JSON.stringify(module.runSelfTestRace())};`;
    },
  };
}

export default defineConfig({
  // The sim chunk's code hash, the code part of the replay key (scripts/sim-chunk.mjs).
  // The road data shipped as JSON files is written on one line (scripts/json-assets.mjs, run W-P).
  // The big files pinned in assets.lock.json are baked in under assets/ds/ (run W-Q).
  // The packs' `meta.notes` stay out of the bundled pack JSON (scripts/pack-notes.mjs, run W-R).
  // index.html preloads the Keys' hand-made road data boot fetches (scripts/boot-preload.mjs, run W-S).
  // The offline worker, sw.js beside index.html, caches the whole build (scripts/service-worker.mjs).
  // credits.json, the credits page's data, is made from the ledger and the packs (scripts/credits.mjs).
  plugins: [
    stripPackNotesPlugin(),
    selfTestHash(),
    simCodeHashPlugin(),
    minifyJsonAssetsPlugin(),
    datasetAssetsPlugin({ root }),
    bootPreloadPlugin(),
    creditsPlugin({ root }),
    serviceWorkerPlugin({ root, buildId }),
  ],
  // Relative asset paths, so one build works at a Space root or under any sub-path.
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_CHANNEL__: JSON.stringify(buildChannel),
    __BUILD_BRANCH__: JSON.stringify(buildBranch),
    __SIM_CODE_HASH__: JSON.stringify(SIM_CODE_HASH_PLACEHOLDER),
  },
  // Explicit loopback hosts and fixed ports: `npm run phone` forwards exactly these.
  // Never bind all interfaces.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    // A pack's road data (`?url` JSON, src/content/packs.ts) always ships as its own file. Vite
    // would inline a file under 4 KB into the JavaScript as a base64 data URL, which put the small
    // region road files in the first-load bundle a third bigger than the file itself. A model (GLB)
    // ships as its own file too: a small one inlined would land in the first-load bundle, and a
    // region's models must load only when a race there starts (run W-P: the trestle bent and power
    // pole fell under 4 KB once they shipped without normals).
    assetsInlineLimit: (file) => (file.endsWith('.json') || file.endsWith('.glb') ? false : undefined),
    // src/sim, src/road and src/core in one chunk, so its content hash names the sim's code
    // (docs/architecture.md, "Replay and input recording").
    rolldownOptions: { output: { codeSplitting: { groups: [simChunkGroup()] } } },
  },
});
