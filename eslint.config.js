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

/**
 * The longest fixed sleep a browser spec may write (setTimeout or setInterval with a literal delay):
 * a poll or a frame's worth, never a stand-in for "the game has got there by now". [default]
 */
const E2E_SLEEP_LIMIT_MS = 100;

/**
 * Browser specs wait on the game, never on the clock (the determinism run, 2026-10-03; RULES.md,
 * "New tests must not wait on wall-clock time or frame counts"). On 2026-10-02 about half of the
 * day's 391 CI failure rows were specs that waited wall-clock seconds while CI drew 7 to 19 frames a
 * second. Wait for a sim tick, a DOM state, the test handle's lockstep or fast-forward
 * (tests/e2e/lockstep.ts) or n drawn frames instead. A wait that really is about wall time (a
 * long-press threshold, a CSS transition, an audio clock) stays, with
 * `// eslint-disable-next-line no-restricted-syntax -- <why this one is wall time>`.
 */
const E2E_WAIT_MESSAGE =
  'A fixed wall-clock wait in a browser spec: wait on the game instead (a sim tick, a DOM state, __game.fastForward, or frames() in tests/e2e/lockstep.ts). If the wait really is about wall time, disable this line with the reason.';
const e2eWaitRules = {
  'no-restricted-syntax': [
    'error',
    { selector: "CallExpression[callee.property.name='waitForTimeout']", message: E2E_WAIT_MESSAGE },
    ...['setTimeout', 'setInterval'].flatMap((name) =>
      [`callee.name='${name}'`, `callee.property.name='${name}'`].flatMap((callee) => [
        {
          selector: `CallExpression[${callee}][arguments.1.type='Literal'][arguments.1.value>${E2E_SLEEP_LIMIT_MS}]`,
          message: `${E2E_WAIT_MESSAGE} (a ${name} over ${E2E_SLEEP_LIMIT_MS} ms)`,
        },
        {
          selector: `CallExpression[${callee}][arguments.length>1][arguments.1.type!='Literal']`,
          message: `${E2E_WAIT_MESSAGE} (a ${name} whose delay is not a literal up to ${E2E_SLEEP_LIMIT_MS} ms)`,
        },
      ]),
    ),
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
  // Browser specs wait on the game, never on the clock.
  { files: ['tests/e2e/**/*.ts'], rules: e2eWaitRules },
);
