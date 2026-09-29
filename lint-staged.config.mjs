// lint-staged, run by the pre-commit hook (docs/engineering.md, "Pre-commit hooks and leak scan").
// The leak scan and size check on staged files run right after it, from the hook itself.
export default {
  '*.{ts,mts,js,mjs}': ['eslint --fix --max-warnings 0', 'prettier --write'],
  '*.{json,yml,yaml,html,css}': ['prettier --write'],
  // Pack validation runs once, only when pack files are staged.
  'packs/**': () => 'npm run packs:check',
};
