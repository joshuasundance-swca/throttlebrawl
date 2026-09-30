#!/usr/bin/env node
// `npm run packs:check` delegates here (scripts/packs-check.mjs). The validator is TypeScript that
// shares src/content with the game, and src/ uses extensionless imports, so it runs through Vite's
// module runner rather than plain Node type stripping. Takes about a second. The check runs while
// tools/packs/cli.ts is being imported, so the runner is still open when the hooked rule modules
// (tools/road/pack-rules.ts, and any later ones) load through it; a runner closes once its import
// returns.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { module } = await runnerImport('/tools/packs/cli.ts', { root, configFile: false, logLevel: 'error' });
process.exit(module.default);
