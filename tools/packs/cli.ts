// The packs:check command line, run inside Vite's module runner by tools/packs/check.mjs. It runs
// the check while it is being imported, so the runner is still open when run.ts loads the hook
// modules: a runner closes once its import returns, and a hook loaded after that failed with
// "Vite module runner has been closed". The exit code is the default export.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './run';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const code: number = await main(root, process.argv.slice(2));
export default code;
