// The first-load JavaScript (docs/engineering.md, perf check): the budget counts the scripts the
// page loads before its first screen, the entry and everything it imports statically. Lazy chunks
// (`import()`) load later, on demand, and are reported apart. The second case is a real production
// build, in memory: it proves the lazy chunks stay out of the first load, so a stray static import
// that pulls one back in fails here, not only as a bigger number in the perf check.
import { describe, expect, it } from 'vitest';
import { build, type Rolldown } from 'vite';
import { distFileName, readLock, sha256 } from './dataset-assets.mjs';
import { firstLoadScripts, staticImports } from './first-load.mjs';
import { repoRoot } from './lib.mjs';

describe('staticImports', () => {
  it('finds minified static imports and re-exports, never a dynamic import()', () => {
    const code =
      'import{a as b,c}from"./sim-AAA.js";import"./side-BBB.js";import*as t from"../x/three-CCC.js";' +
      'export{d}from"./re-DDD.js";const m=()=>import("./lazy-EEE.js");const s="not an import";';
    expect(staticImports(code)).toEqual([
      './sim-AAA.js',
      './side-BBB.js',
      '../x/three-CCC.js',
      './re-DDD.js',
    ]);
  });
});

describe('firstLoadScripts', () => {
  it('follows the entry, its modulepreloads and their static imports, and skips lazy chunks', () => {
    const html =
      '<script type="module" crossorigin src="./assets/index-1.js"></script>\n' +
      '<link rel="modulepreload" crossorigin href="./assets/sim-2.js">';
    const files: Record<string, string> = {
      'assets/index-1.js':
        'import{x}from"./sim-2.js";import"./shared-3.js";const l=()=>import("./lazy-4.js");',
      'assets/sim-2.js': 'export const x=1;',
      'assets/shared-3.js': 'import"./deep-5.js";',
      'assets/deep-5.js': '',
      'assets/lazy-4.js': 'import{x}from"./sim-2.js";',
    };
    const read = (p: string) => {
      const code = files[p];
      if (code === undefined) throw new Error(`missing ${p}`);
      return code;
    };
    expect([...firstLoadScripts(html, read)].sort()).toEqual([
      'assets/deep-5.js',
      'assets/index-1.js',
      'assets/shared-3.js',
      'assets/sim-2.js',
    ]);
  });
});

/** Source modules that must load lazily, never with the first screen. */
const LAZY_MODULES = [
  /[\\/]src[\\/]render[\\/]looks[\\/]post\.ts$/,
  /[\\/]src[\\/]render[\\/]models\.ts$/,
  /[\\/]src[\\/]render[\\/]glb\.ts$/,
  // Landmarks (playtest 3): loaded with a race whose road has a `landmark` feature.
  /[\\/]src[\\/]render[\\/]landmarks\.ts$/,
  /[\\/]src[\\/]ui[\\/]tuning[\\/]index\.ts$/,
  /[\\/]src[\\/]dev[\\/]selftest[\\/]index\.ts$/,
  // dev/ beyond dev/boot.ts (the test flag and the error capture): src/main.ts loads it lazily.
  /[\\/]src[\\/]dev[\\/]index\.ts$/,
  /[\\/]src[\\/]dev[\\/]handle[\\/]index\.ts$/,
  /[\\/]src[\\/]dev[\\/]bot[\\/]index\.ts$/,
  /[\\/]src[\\/]dev[\\/]report[\\/]index\.ts$/,
  /[\\/]src[\\/]dev[\\/]report[\\/]summary\.ts$/,
  /[\\/]src[\\/]dev[\\/]perf[\\/]index\.ts$/,
  // Startup-code headroom (playtest 3, wave C): code no screen needs before the first race, each
  // fetched as the menu comes up. The sound engine (audio/index.ts stands in until it loads) with
  // its cue patches, cues, engines, radio player, music, soundscape and spoken barks:
  /[\\/]src[\\/]audio[\\/]system\.ts$/,
  /[\\/]src[\\/]audio[\\/]cue-patches\.ts$/,
  /[\\/]src[\\/]audio[\\/]cues\.ts$/,
  /[\\/]src[\\/]audio[\\/]engine-patch\.ts$/,
  /[\\/]src[\\/]audio[\\/]radio\.ts$/,
  /[\\/]src[\\/]audio[\\/]music\.ts$/,
  /[\\/]src[\\/]audio[\\/]soundscape-voices\.ts$/,
  /[\\/]src[\\/]audio[\\/]bark-voices\.ts$/,
  // the race's moving parts in render (render/race-parts.ts):
  /[\\/]src[\\/]render[\\/]effects\.ts$/,
  /[\\/]src[\\/]render[\\/]event-props\.ts$/,
  /[\\/]src[\\/]render[\\/]smashables\.ts$/,
  /[\\/]src[\\/]render[\\/]speed-lines\.ts$/,
  /[\\/]src[\\/]render[\\/]rain\.ts$/,
  // the career's backup codes, the pause menu's radio panel and the wheelie gauge's DOM:
  /[\\/]src[\\/]save[\\/]export-code\.ts$/,
  /[\\/]src[\\/]ui[\\/]radio-panel-view\.ts$/,
  /[\\/]src[\\/]ui[\\/]moves-gauge\.ts$/,
];

describe('the production build', { timeout: 120_000 }, () => {
  it('keeps the lazy modules out of the first load, and inlines no JSON into it', async () => {
    const out = await build({ configFile: 'vite.config.ts', logLevel: 'silent', build: { write: false } });
    const outputs = (Array.isArray(out) ? out : [out]) as Rolldown.RolldownOutput[];
    const items = outputs.flatMap((o) => o.output);
    const chunks = items.filter((c): c is Rolldown.OutputChunk => c.type === 'chunk');
    const html = items.find((a) => a.fileName === 'index.html');
    if (!html || html.type !== 'asset') throw new Error('no index.html in the build');
    const byName = new Map(chunks.map((c) => [c.fileName, c]));
    const first = firstLoadScripts(String(html.source), (p) => byName.get(p)?.code ?? '');
    const firstChunks = chunks.filter((c) => first.has(c.fileName));
    const lazyChunks = chunks.filter((c) => !first.has(c.fileName));
    console.log(
      `[examined] ${chunks.length} chunks: ${firstChunks.length} first-load ` +
        `(${firstChunks.map((c) => c.fileName).join(', ')}), ${lazyChunks.length} lazy`,
    );

    // The entry is in the first load, and the walk agrees with the bundler's own static imports.
    const entry = chunks.find((c) => c.isEntry);
    expect(entry && first.has(entry.fileName)).toBe(true);
    for (const c of firstChunks)
      for (const i of c.imports) expect(first.has(i), `${c.fileName} imports ${i}`).toBe(true);

    for (const re of LAZY_MODULES) {
      expect(
        firstChunks.some((c) => c.moduleIds.some((id) => re.test(id))),
        `${re} is in the first load`,
      ).toBe(false);
      // Not tree-shaken away either: it ships, in a lazy chunk.
      expect(
        lazyChunks.some((c) => c.moduleIds.some((id) => re.test(id))),
        `${re} is in no lazy chunk`,
      ).toBe(true);
    }
    // A pack's road data ships as files, never as data URLs inside the JavaScript.
    for (const c of firstChunks) expect(c.code.includes('data:application/json')).toBe(false);
    // No pack's road data (networks, roads, routes) is bundled into the first load, the Keys'
    // hand-made roads included: they are fetched at boot as JSON (run W-S, the first-load budget).
    // A `?url` import of one (its URL string only) is fine.
    const roadData =
      /[\\/]packs[\\/][^\\/]+[\\/]regions[\\/][^\\/]+[\\/](?:networks|roads|routes)[\\/][^\\/]+\.json$/;
    const bundledRoads = firstChunks.flatMap((c) => c.moduleIds.filter((id) => roadData.test(id)));
    console.log(
      `[examined] ${firstChunks.length} first-load chunks for bundled road data: ${bundledRoads.length}`,
    );
    expect(bundledRoads).toEqual([]);

    // Run W-Q: every file assets.lock.json pins is baked in under assets/ds/ with its pinned bytes
    // (offline keeps working), and the first load's manifest rows name it.
    const { lock } = readLock(repoRoot);
    expect(lock?.files.length).toBeGreaterThan(0);
    const firstCode = firstChunks.map((c) => c.code).join('\n');
    for (const f of lock?.files ?? []) {
      const emitted = items.find((a) => a.fileName === distFileName(f));
      expect(emitted?.type, `${f.path} is not in the build`).toBe('asset');
      if (emitted?.type === 'asset') expect(sha256(Buffer.from(emitted.source))).toBe(f.sha256);
      expect(firstCode.includes(distFileName(f)), `${f.path}'s row is not in the first load`).toBe(true);
    }
    console.log(`[examined] ${lock?.files.length ?? 0} dataset files baked into the build`);
  });
});
