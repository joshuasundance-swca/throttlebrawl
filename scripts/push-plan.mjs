// What the pre-push hook tests, from the files a push changes (docs/engineering.md, "Pre-commit
// hooks and leak scan"). Pure, so scripts/push-plan.test.ts can pin it; scripts/pre-push.mjs runs it.
//
// The hook is a backstop, not the gate: CI runs every test on the PR. So it runs
//   - no tests for a push of docs, notes and Markdown only;
//   - no local unit tests for a lockfile-only push or a package.json change confined to
//     standard dependency maps; typecheck still runs;
//   - the whole unit tier when global test or type config changed, since it can break any test
//     and is named by no test file;
//   - otherwise only the unit test files the push names: the test files it changed, plus the test
//     named after each source file it changed (`foo.ts` -> `foo.test.ts`; a folder's `index.ts` ->
//     `<folder>.test.ts`). Vitest's import-graph selection (`--changed`, `related`) picked 142 of the
//     261 unit test files for one content PR (#414) and took 4.6 min at two workers, so it is left
//     to CI. [default]
//   - the three authored truck-cut controls for their shared physics or track inputs. These are
//     a bounded backstop for contact/terrain composition, not import-graph selection.
//   - four existing road-content contracts for any pack's road/network/route or region JSON;
//     backdrop and scenes asset JSON select their matching contract only. Missing tests are omitted.
//   - the short career and patrol-placement configuration contracts for any pack JSON.
//   - warning-sign and road-event bark contracts for their modifier, event and bark-set inputs.

import { isDeepStrictEqual } from 'node:util';

/** Changing any of these runs the whole unit tier. */
const FULL = [
  /^vite(st)?\.config\.ts$/,
  /^tsconfig[^/]*\.json$/,
  /^tests\/setup\//,
  /^tests\/sequencer\.ts$/,
];
/** A push of only these runs no tests. */
const DOCS = [/^docs\//, /^changes\//, /\.md$/i];
/** The unit project's test files (vitest.config.ts). */
const UNIT_TEST = /^(src|scripts|tools)\/.+\.test\.ts$/;
const SOURCE = /^(src|scripts|tools)\/.+\.(ts|mts|js|mjs)$/;
const PACK_JSON = /^packs\/[^/]+\/.+\.json$/;
const CAREER_CONTENT_TEST = 'src/app/career-content.test.ts';
const PATROL_CONTENT_TEST = 'tools/road/patrol-placement.test.ts';
const MODIFIER_CONTENT = /^packs\/[^/]+\/modifiers\/[^/]+\.json$/;
const ROAD_EVENT_BARK_CONTENT =
  /^packs\/[^/]+\/(?:(?:modifiers|events)\/[^/]+|barks\/road-events-[^/]+)\.json$/;
const EVENT_SIGNS_TEST = 'src/render/event-signs.test.ts';
const ROAD_EVENT_BARKS_TEST = 'src/audio/road-event-barks.test.ts';
const CONTACT_INPUT = [
  /^src\/(road|sim\/riders)\/.+\.ts$/,
  /^src\/sim\/modifiers\/moving\.ts$/,
  /^tools\/road\/tracks\/(pnw-c1|sf-downtown)\.ts$/,
  /^packs\/region-(pnw|sf)\/regions\/[^/]+\/(roads|networks|routes)\/.+\.json$/,
];
const CONTACT_TESTS = [
  'tools/road/pnw-c1.test.ts',
  'tools/road/sf-downtown.test.ts',
  'tools/road/truck-shortcuts.test.ts',
];
const ROAD_CONTENT = /^packs\/[^/]+\/regions\/[^/]+\/(?:(?:roads|networks|routes)\/.+\.json|region\.json)$/;
const BACKDROP_TEST = 'src/render/backdrop/backdrop.test.ts';
const SCENES_TEST = 'src/render/scenes/scenes.test.ts';
const ROAD_CONTENT_TESTS = [
  'tools/road/board-slots-on-land.test.ts',
  'tools/road/lane-drops-live.test.ts',
  BACKDROP_TEST,
  SCENES_TEST,
];
const ROAD_ASSET_TESTS = [
  { input: /^packs\/[^/]+\/assets\/backdrop\/.+\.json$/, test: BACKDROP_TEST },
  { input: /^packs\/[^/]+\/assets\/scenes\/.+\.json$/, test: SCENES_TEST },
];
const DEPENDENCY_MAPS = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);

function manifestWithoutDependencyMaps(blob) {
  const manifest = JSON.parse(blob);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  for (const key of DEPENDENCY_MAPS) {
    if (!(key in manifest)) continue;
    const value = manifest[key];
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.values(value).some((version) => typeof version !== 'string')
    )
      return null;
  }
  return Object.fromEntries(Object.entries(manifest).filter(([key]) => !DEPENDENCY_MAPS.has(key)));
}

function dependencyMapsOnly(manifests) {
  if (!manifests) return false;
  try {
    const before = manifestWithoutDependencyMaps(manifests.before);
    const after = manifestWithoutDependencyMaps(manifests.after);
    return before !== null && after !== null && isDeepStrictEqual(before, after);
  } catch {
    return false;
  }
}

/** Read the compared revisions' actual manifest blobs; any absent or unreadable blob keeps full coverage. */
export function planPushFromRevisions(changed, exists, base, head, readBlob) {
  let manifests;
  if (changed.some((file) => file.replaceAll('\\', '/') === 'package.json')) {
    try {
      manifests = { before: readBlob(base, 'package.json'), after: readBlob(head, 'package.json') };
    } catch {
      // planPush defaults package.json to the full tier without two valid blobs.
    }
  }
  return planPush(changed, exists, manifests);
}

/**
 * @param {string[]} changed repo-relative paths the push changes (deleted files included or not)
 * @param {(file: string) => boolean} exists whether a repo-relative file exists in the tree
 * @param {{before: string, after: string}} [manifests] compared revision blobs for package.json
 * @returns {{ mode: 'skip' | 'full' | 'files', tests: string[], reason: string }}
 */
export function planPush(changed, exists, manifests) {
  const files = changed.map((f) => f.replaceAll('\\', '/'));
  const config = files.filter((f) => FULL.some((re) => re.test(f)));
  if (config.length) {
    return { mode: 'full', tests: [], reason: `global test or type config change: ${config.join(', ')}` };
  }
  if (files.includes('package.json') && !dependencyMapsOnly(manifests)) {
    return {
      mode: 'full',
      tests: [],
      reason: 'package.json changed outside standard dependency maps or could not be compared',
    };
  }
  if (!files.length) return { mode: 'skip', tests: [], reason: 'no changed files' };
  if (files.every((f) => DOCS.some((re) => re.test(f)))) {
    return { mode: 'skip', tests: [], reason: `${files.length} file(s), docs, notes and Markdown only` };
  }
  const tests = new Set();
  for (const f of files) {
    if (UNIT_TEST.test(f)) {
      if (exists(f)) tests.add(f);
      continue;
    }
    if (PACK_JSON.test(f) && exists(CAREER_CONTENT_TEST)) tests.add(CAREER_CONTENT_TEST);
    if (PACK_JSON.test(f) && exists(PATROL_CONTENT_TEST)) tests.add(PATROL_CONTENT_TEST);
    if (MODIFIER_CONTENT.test(f) && exists(EVENT_SIGNS_TEST)) tests.add(EVENT_SIGNS_TEST);
    if (ROAD_EVENT_BARK_CONTENT.test(f) && exists(ROAD_EVENT_BARKS_TEST)) tests.add(ROAD_EVENT_BARKS_TEST);
    if (ROAD_CONTENT.test(f)) {
      for (const t of ROAD_CONTENT_TESTS) if (exists(t)) tests.add(t);
    }
    for (const { input, test } of ROAD_ASSET_TESTS) {
      if (input.test(f) && exists(test)) tests.add(test);
    }
    if (!f.endsWith('.d.ts') && CONTACT_INPUT.some((re) => re.test(f))) {
      for (const t of CONTACT_TESTS) if (exists(t)) tests.add(t);
    }
    if (!SOURCE.test(f) || f.endsWith('.d.ts')) continue;
    const dir = f.slice(0, f.lastIndexOf('/'));
    const stem = f.slice(dir.length + 1).replace(/\.(ts|mts|js|mjs)$/, '');
    const names = [`${dir}/${stem}.test.ts`];
    if (stem === 'index') names.push(`${dir}/${dir.slice(dir.lastIndexOf('/') + 1)}.test.ts`);
    if (dir === 'tools/road/tracks') names.push(`tools/road/${stem}.test.ts`);
    for (const t of names) if (exists(t)) tests.add(t);
  }
  return {
    mode: 'files',
    tests: [...tests].sort(),
    reason: `${files.length} file(s); named unit tests and bounded contact, road-content and pack configuration contracts`,
  };
}
