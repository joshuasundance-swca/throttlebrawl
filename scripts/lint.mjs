#!/usr/bin/env node
// lint / lint:fix: ESLint over src/, tests/, scripts/, tools/ and the config files, printing how
// many files it linted. Warnings fail too: the gate is zero problems.
import { ESLint } from 'eslint';
import { examined, repoRoot } from './lib.mjs';

const fix = process.argv.includes('--fix');
const eslint = new ESLint({ cwd: repoRoot, fix, errorOnUnmatchedPattern: false });
const results = await eslint.lintFiles(['src', 'tests', 'scripts', 'tools', '*.config.{js,ts,mjs}']);
if (fix) await ESLint.outputFixes(results);

const errors = results.reduce((n, r) => n + r.errorCount, 0);
const warnings = results.reduce((n, r) => n + r.warningCount, 0);
const formatter = await eslint.loadFormatter('stylish');
const text = await formatter.format(results);
if (text) console.log(text);
examined(`${results.length} files linted, ${errors} errors, ${warnings} warnings`);
if (results.length === 0) {
  console.error('lint examined zero files');
  process.exit(1);
}
if (errors || warnings) process.exit(1);
console.log('lint: clean');
