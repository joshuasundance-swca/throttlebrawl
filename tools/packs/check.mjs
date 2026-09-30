#!/usr/bin/env node
// `npm run packs:check` delegates here (scripts/packs-check.mjs). The validator is TypeScript that
// shares src/content with the game, and src/ uses extensionless imports, so it runs through Vite's
// module runner rather than plain Node type stripping. Takes about a second.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { module } = await runnerImport('/tools/packs/run.ts', { root, configFile: false, logLevel: 'error' });
process.exit(await module.main(root, process.argv.slice(2)));
