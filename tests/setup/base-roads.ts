// Vitest setup for every project (vitest.config.ts): the bundled base pack's hand-made Keys road
// data is fetched at boot in the browser (src/content/base-pack.ts, run W-S), so a test that reads
// `loadBasePack()` gets it from disk first, the same files the game fetches.
import { provideBaseRoadsFromDisk } from '../../src/content/base-pack-whole';

provideBaseRoadsFromDisk();
