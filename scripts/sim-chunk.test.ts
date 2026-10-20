// The sim chunk and its code hash (docs/architecture.md, "Replay and input recording";
// docs/milestones/M2.md, app-3 item 4): src/sim, src/road and src/core build into one chunk, and
// its content hash is the code part of the replay key, injected into the app as
// __SIM_CODE_HASH__. A deploy that changes only UI code keeps the hash, so a saved race still
// resumes; a change to the sim changes it. Each case is a real production build, in memory.
import { describe, expect, it } from 'vitest';
import { build, type Plugin, type Rolldown } from 'vite';
import { firstLoadScripts } from './first-load.mjs';
import {
  ROAD_LAZY_CHUNK_NAME,
  ROAD_LAZY_TEST,
  RUNTIME_CHUNK_NAME,
  SIM_CHUNK_NAME,
  SIM_CODE_HASH_PLACEHOLDER,
  SIM_STEPS_CHUNK_NAME,
  SIM_STEPS_TEST,
  simCodeHashOfChunks,
} from './sim-chunk.mjs';

/** Appends a side effect to one source file, so the change survives tree-shaking. */
function tweak(file: RegExp, marker: string): Plugin {
  return {
    name: 'test:tweak',
    enforce: 'post',
    transform(code, id) {
      return file.test(id.replace(/\\/g, '/')) ? `${code}\n;(globalThis).${marker} = 1;\n` : null;
    },
  };
}

interface Built {
  hash: string;
  chunks: Rolldown.OutputChunk[];
  first: Set<string>;
}

async function buildOnce(extra: Plugin[] = []): Promise<Built> {
  const out = await build({
    configFile: 'vite.config.ts',
    logLevel: 'silent',
    plugins: extra,
    build: { write: false },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as Rolldown.RolldownOutput[];
  const chunks = outputs.flatMap((o) =>
    o.output.filter((c): c is Rolldown.OutputChunk => c.type === 'chunk'),
  );
  const sim = chunks.find((c) => c.name === SIM_CHUNK_NAME);
  if (!sim) throw new Error(`no ${SIM_CHUNK_NAME} chunk in ${chunks.map((c) => c.fileName).join(', ')}`);
  const html = outputs
    .flatMap((o) => o.output)
    .find((a) => a.type === 'asset' && a.fileName === 'index.html');
  if (!html || html.type !== 'asset') throw new Error('no emitted index.html');
  const first = firstLoadScripts(
    typeof html.source === 'string' ? html.source : Buffer.from(html.source).toString(),
    (file) => {
      const chunk = chunks.find((c) => c.fileName === file);
      if (!chunk) throw new Error(`missing first-load chunk ${file}`);
      return chunk.code;
    },
  );
  return { hash: simCodeHashOfChunks(sim, chunks), chunks, first };
}

describe('the sim chunk and simCodeHash', { timeout: 120_000 }, () => {
  it('keeps physical-tree rules lazy and covered by the replay code hash', async () => {
    const built = await buildOnce();
    const sim = built.chunks.find((c) => c.name === SIM_CHUNK_NAME)!;
    const steps = built.chunks.find((c) => c.name === SIM_STEPS_CHUNK_NAME)!;
    const planners = built.chunks.find((c) => c.name === ROAD_LAZY_CHUNK_NAME)!;
    // Use the budget's exact HTML/modulepreload/static closure, including render's entry path.
    expect(built.first.has(sim.fileName)).toBe(true);
    expect(built.first.has(steps.fileName)).toBe(false);
    expect(built.first.has(planners.fileName)).toBe(false);
    for (const file of ['terrain-trees.ts', 'terrain-mesh.ts']) {
      const chunk = built.chunks.find((c) =>
        c.moduleIds.some((id) => id.replace(/\\/g, '/').endsWith(`/src/render/${file}`)),
      );
      expect(chunk, `${file} must be present in the real build`).toBeDefined();
      expect(built.first.has(chunk!.fileName), `${file} must remain outside static first load`).toBe(false);
    }
    for (const file of ['riders/terrain-trees.ts', 'tumble/tree-contacts.ts']) {
      const contains = (c: Rolldown.OutputChunk) =>
        c.moduleIds.some((id) => id.replace(/\\/g, '/').endsWith(`/src/sim/${file}`));
      expect(contains(steps), `${file} belongs to the awaited simulation steps`).toBe(true);
      expect(contains(sim), `${file} must not load with the menu`).toBe(false);
    }
    expect(
      planners.moduleIds.some((id) => id.replace(/\\/g, '/').endsWith('/road/structures/terrain-trees.ts')),
    ).toBe(true);
    expect(sim.imports).not.toContain(steps.fileName);
    expect(sim.imports).not.toContain(planners.fileName);
    for (const rules of [steps, planners]) {
      expect(
        simCodeHashOfChunks(
          sim,
          built.chunks.map((c) =>
            c === rules ? { ...c, code: `${c.code}\n;globalThis.__treeRuleControl=1;` } : c,
          ),
        ),
      ).not.toBe(built.hash);
    }
  });
  it('keeps the hash when only src/ui changes, changes it when src/sim does, and injects it', async () => {
    const base = await buildOnce();
    const uiOnly = await buildOnce([tweak(/\/src\/ui\/index\.ts$/, '__uiTweak')]);
    const simToo = await buildOnce([tweak(/\/src\/sim\/create\.ts$/, '__simTweak')]);
    console.log(
      `[examined] simCodeHash base ${base.hash}, ui-only ${uiOnly.hash}, sim change ${simToo.hash}`,
    );

    // The UI tweak really landed in the UI build, and the sim chunk kept its hash.
    expect(uiOnly.chunks.some((c) => c.code.includes('__uiTweak'))).toBe(true);
    expect(base.chunks.some((c) => c.code.includes('__uiTweak'))).toBe(false);
    expect(uiOnly.hash).toBe(base.hash);
    // The negative control: a sim change moves the hash.
    expect(simToo.hash).not.toBe(base.hash);

    // The only static dependency is the bundler's exact generated namespace helper, hashed too.
    const sim = base.chunks.find((c) => c.name === SIM_CHUNK_NAME);
    const runtime = base.chunks.find((c) => c.name === RUNTIME_CHUNK_NAME);
    expect(runtime?.moduleIds).toEqual(['\0rolldown/runtime.js']);
    expect(runtime?.imports).toEqual([]);
    expect(sim?.imports).toEqual([runtime?.fileName]);
    expect(
      simCodeHashOfChunks(
        sim!,
        base.chunks.map((c) =>
          c === runtime ? { ...c, code: `${c.code}\n;globalThis.__runtimeTweak = 1;` } : c,
        ),
      ),
    ).not.toBe(base.hash);
    expect(sim?.moduleIds.some((id) => /[\\/]src[\\/]sim[\\/]/.test(id))).toBe(true);
    expect(sim?.moduleIds.some((id) => /[\\/]src[\\/]road[\\/]/.test(id))).toBe(true);
    expect(sim?.moduleIds.some((id) => /[\\/]src[\\/]core[\\/]/.test(id))).toBe(true);
    // Generated helpers and the exact lake outline used by physics are hashed with the sim too.
    expect(
      sim?.moduleIds.every(
        (id) =>
          /[\\/]src[\\/](sim|road|core)[\\/]/.test(id) ||
          id === '\0vite/preload-helper.js' ||
          id
            .replace(/\\/g, '/')
            .endsWith('/packs/region-pnw/assets/backdrop/pacific-northwest/networks/osm-pnw-samish.json'),
      ),
    ).toBe(true);

    // The road's structure planners (the physical world, 2026-10-06) are not in it: they build into their
    // own chunk, which the sim chunk loads on demand, never with the first screen.
    expect(sim?.moduleIds.some((id) => ROAD_LAZY_TEST.test(id))).toBe(false);
    const lazy = base.chunks.find((c) => c.name === ROAD_LAZY_CHUNK_NAME);
    expect(lazy?.moduleIds.some((id) => /[\\/]src[\\/]road[\\/]structures[\\/]downtown\.ts$/.test(id))).toBe(
      true,
    );

    // The app carries the hash, and no placeholder is left anywhere.
    const all = base.chunks.map((c) => c.code).join('\n');
    expect(all.includes(SIM_CODE_HASH_PLACEHOLDER)).toBe(false);
    expect(base.chunks.some((c) => c.name !== SIM_CHUNK_NAME && c.code.includes(base.hash))).toBe(true);
  });

  it('changes the hash when a lazy structure planner changes: its chunk is part of the hash', async () => {
    const base = await buildOnce();
    const planner = await buildOnce([tweak(/\/src\/road\/structures\/downtown\.ts$/, '__plannerTweak')]);
    console.log(`[examined] simCodeHash base ${base.hash}, planner change ${planner.hash}`);
    const lazy = planner.chunks.find((c) => c.name === ROAD_LAZY_CHUNK_NAME);
    expect(lazy?.code.includes('__plannerTweak')).toBe(true);
    expect(planner.chunks.find((c) => c.name === SIM_CHUNK_NAME)?.code.includes('__plannerTweak')).toBe(
      false,
    );
    expect(planner.hash).not.toBe(base.hash);
  });

  it.each([
    [/\/src\/sim\/ai\/step\.ts$/, '__stepTweak'],
    [/\/src\/sim\/traffic\/network\.ts$/, '__networkTweak'],
  ] as const)('changes the hash when lazy rule %s changes', async (file, marker) => {
    const base = await buildOnce();
    const step = await buildOnce([tweak(file, marker)]);
    console.log(`[examined] simCodeHash base ${base.hash}, step change ${step.hash}`);
    const lazy = step.chunks.find((c) => c.name === SIM_STEPS_CHUNK_NAME);
    expect(lazy?.code.includes(marker)).toBe(true);
    for (const name of ['network', 'network-population', 'path-view', 'merge', 'junctions'])
      expect(
        lazy?.moduleIds.some((id) => id.replace(/\\/g, '/').endsWith(`/traffic/${name}.ts`)),
        name,
      ).toBe(true);
    // Not in the sim chunk, and the sim chunk loads it only on demand (no static import of it).
    const sim = step.chunks.find((c) => c.name === SIM_CHUNK_NAME);
    expect(sim?.code.includes(marker)).toBe(false);
    expect(sim?.imports.includes(lazy?.fileName ?? '')).toBe(false);
    expect(sim?.dynamicImports.includes(lazy?.fileName ?? '')).toBe(true);
    expect(sim?.moduleIds.some((id) => SIM_STEPS_TEST.test(id))).toBe(false);
    expect(step.hash).not.toBe(base.hash);
  });
});
