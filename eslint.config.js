// ESLint flat config (docs/engineering.md, "Toolchain"; docs/architecture.md, "Dependency rules"
// and "Determinism rules"). tests/unit/lint-rules.test.ts proves the project rules fire.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { modulesPlugin } from './scripts/module-map.mjs';

// Not pinned bit-exactly by ECMAScript across engines and CPUs; core/math has table-based versions.
const INEXACT_MATH = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'pow',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'cbrt',
  'hypot',
];

export const determinismRules = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Use the seeded streams in core/rng.' },
    ...INEXACT_MATH.map((property) => ({
      object: 'Math',
      property,
      message: 'Not bit-exact across engines. Use core/math.',
    })),
    { object: 'Date', property: 'now', message: 'Time in the sim is the integer tick.' },
    { object: 'performance', property: 'now', message: 'Time in the sim is the integer tick.' },
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "BinaryExpression[operator='**']", message: '** is Math.pow: not bit-exact. Use core/math.' },
    {
      selector: "AssignmentExpression[operator='**=']",
      message: '** is Math.pow: not bit-exact. Use core/math.',
    },
  ],
  'no-restricted-globals': [
    'error',
    ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location', 'fetch'].map(
      (name) => ({ name, message: 'The sim and road are DOM-free (docs/architecture.md).' }),
    ),
    ...['performance', 'Date', 'requestAnimationFrame', 'setTimeout', 'setInterval'].map((name) => ({
      name,
      message: 'Time in the sim is the integer tick (docs/architecture.md, determinism rules).',
    })),
  ],
  'no-restricted-imports': [
    'error',
    {
      paths: [{ name: 'three', message: 'The sim and road never import three (docs/architecture.md).' }],
      patterns: [
        { group: ['three/*'], message: 'The sim and road never import three (docs/architecture.md).' },
        { group: ['node:*'], message: 'The sim and road run in the browser too: no Node built-ins.' },
      ],
    },
  ],
};

export default defineConfig(
  globalIgnores(['dist/', '.cache/', 'scratch/', 'local/', 'test-results/', 'playwright-report/']),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.sim.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  { files: ['src/**/*.ts'], languageOptions: { globals: globals.browser } },
  { files: ['tests/**/*.ts', 'tools/**/*.ts', '*.config.ts'], languageOptions: { globals: globals.node } },
  // The module map is the enforced import allow-list.
  {
    files: ['src/**/*.ts'],
    plugins: { modules: modulesPlugin },
    rules: { 'modules/boundaries': 'error' },
  },
  // The sim and road are DOM-free, three-free and deterministic.
  {
    files: ['src/sim/**/*.ts', 'src/road/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: determinismRules,
  },
);
