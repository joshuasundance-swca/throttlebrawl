// The sim chunk and its code hash (docs/architecture.md, "Replay and input recording";
// docs/milestones/M2.md, app-3 item 4): src/sim, src/road and src/core build into one chunk, and
// its content hash is the code part of the replay key, injected into the app as
// __SIM_CODE_HASH__. A deploy that changes only UI code keeps the hash, so a saved race still
// resumes; a change to the sim changes it. Each case is a real production build, in memory.
import { describe, expect, it } from 'vitest';
import { build, type Plugin, type Rolldown } from 'vite';
import { SIM_CHUNK_NAME, SIM_CODE_HASH_PLACEHOLDER, simCodeHashOf } from './sim-chunk.mjs';

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
  return { hash: simCodeHashOf(sim.code), chunks };
}

describe('the sim chunk and simCodeHash', { timeout: 120_000 }, () => {
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

    // Everything the sim needs is in the sim chunk: it imports no other chunk.
    const sim = base.chunks.find((c) => c.name === SIM_CHUNK_NAME);
    expect(sim?.imports).toEqual([]);
    expect(sim?.moduleIds.some((id) => /[\\/]src[\\/]sim[\\/]/.test(id))).toBe(true);
    expect(sim?.moduleIds.some((id) => /[\\/]src[\\/]road[\\/]/.test(id))).toBe(true);
    expect(sim?.moduleIds.some((id) => /[\\/]src[\\/]core[\\/]/.test(id))).toBe(true);
    // (and Vite's preload helper, which the road's lazy structure planners' `import()` is wrapped in)
    expect(
      sim?.moduleIds.every(
        (id) => /[\\/]src[\\/](sim|road|core)[\\/]/.test(id) || id === '\0vite/preload-helper.js',
      ),
    ).toBe(true);

    // The app carries the hash, and no placeholder is left anywhere.
    const all = base.chunks.map((c) => c.code).join('\n');
    expect(all.includes(SIM_CODE_HASH_PLACEHOLDER)).toBe(false);
    expect(base.chunks.some((c) => c.name !== SIM_CHUNK_NAME && c.code.includes(base.hash))).toBe(true);
  });

  it('keeps the structure planners out of the sim chunk, and a change to one still moves the code hash', async () => {
    // The planners (src/road/structures/, the physical world) are lazy chunks: they load with the region, never with
    // the first screen. The sim chunk names each in its dynamic import, so its code, and its hash, follow them.
    const base = await buildOnce();
    const planner = await buildOnce([tweak(/\/src\/road\/structures\/waterfront\.ts$/, '__plannerTweak')]);
    const sim = base.chunks.find((c) => c.name === SIM_CHUNK_NAME);
    expect(sim?.moduleIds.some((id) => /[\\/]src[\\/]road[\\/]structures[\\/]/.test(id))).toBe(false);
    expect(sim?.moduleIds.some((id) => /[\\/]src[\\/]road[\\/]structures\.ts$/.test(id))).toBe(true);
    const lazy = base.chunks.filter((c) =>
      c.moduleIds.some((id) => /[\\/]src[\\/]road[\\/]structures[\\/](waterfront|pnw-places)\.ts$/.test(id)),
    );
    console.log(
      `[examined] simCodeHash base ${base.hash}, a change to a planner ${planner.hash}; planner chunks ${lazy.map((c) => c.fileName).join(', ')}`,
    );
    expect(lazy).toHaveLength(2);
    for (const c of lazy) expect(c.name).not.toBe(SIM_CHUNK_NAME);
    expect(planner.chunks.some((c) => c.name !== SIM_CHUNK_NAME && c.code.includes('__plannerTweak'))).toBe(
      true,
    );
    expect(planner.hash).not.toBe(base.hash);
  });
});
