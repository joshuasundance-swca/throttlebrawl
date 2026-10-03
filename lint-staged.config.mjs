// lint-staged, run by the pre-commit hook (docs/engineering.md, "Pre-commit hooks and leak scan").
// The leak scan and size check on staged files run right after it, from the hook itself.
export default {
  '*.{ts,mts,js,mjs}': ['eslint --fix --max-warnings 0', 'prettier --write'],
  '*.{json,yml,yaml,html,css}': ['prettier --write'],
  // Pack validation runs once, only when pack files are staged.
  'packs/**': () => 'npm run packs:check',
  // The branch's changes/ notes are checked once, only when a note is staged. A bad note otherwise
  // shows up only in CI, where it also breaks the build in every browser slice (3 of the 20 red PR
  // runs of 2026-10-03 carried one).
  'changes/**': () => 'npm run notes:check',
};
