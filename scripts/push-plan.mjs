// What the pre-push hook tests, from the files a push changes (docs/engineering.md, "Pre-commit
// hooks and leak scan"). Pure, so scripts/push-plan.test.ts can pin it; scripts/pre-push.mjs runs it.
//
// The hook is a backstop, not the gate: CI runs every test on the PR. So it runs
//   - no tests for a push of docs, notes and Markdown only;
//   - the whole unit tier when a dependency or config file changed, since a config change can break
//     any test and is named by no test file;
//   - otherwise only the unit test files the push names: the test files it changed, plus the test
//     named after each source file it changed (`foo.ts` -> `foo.test.ts`; a folder's `index.ts` ->
//     `<folder>.test.ts`). Vitest's import-graph selection (`--changed`, `related`) picked 142 of the
//     261 unit test files for one content PR (#414) and took 4.6 min at two workers, so it is left
//     to CI. [default]

/** Changing any of these runs the whole unit tier. */
const FULL = [
  /^package(-lock)?\.json$/,
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

/**
 * @param {string[]} changed repo-relative paths the push changes (deleted files included or not)
 * @param {(file: string) => boolean} exists whether a repo-relative file exists in the tree
 * @returns {{ mode: 'skip' | 'full' | 'files', tests: string[], reason: string }}
 */
export function planPush(changed, exists) {
  const files = changed.map((f) => f.replaceAll('\\', '/'));
  const config = files.filter((f) => FULL.some((re) => re.test(f)));
  if (config.length) {
    return { mode: 'full', tests: [], reason: `config or dependency change: ${config.join(', ')}` };
  }
  if (files.every((f) => DOCS.some((re) => re.test(f)))) {
    return { mode: 'skip', tests: [], reason: `${files.length} file(s), docs, notes and Markdown only` };
  }
  const tests = new Set();
  for (const f of files) {
    if (UNIT_TEST.test(f)) {
      if (exists(f)) tests.add(f);
      continue;
    }
    if (!SOURCE.test(f) || f.endsWith('.d.ts')) continue;
    const dir = f.slice(0, f.lastIndexOf('/'));
    const stem = f.slice(dir.length + 1).replace(/\.(ts|mts|js|mjs)$/, '');
    const names = [`${dir}/${stem}.test.ts`];
    if (stem === 'index') names.push(`${dir}/${dir.slice(dir.lastIndexOf('/') + 1)}.test.ts`);
    for (const t of names) if (exists(t)) tests.add(t);
  }
  return {
    mode: 'files',
    tests: [...tests].sort(),
    reason: `${files.length} file(s); unit tests named by the push`,
  };
}
