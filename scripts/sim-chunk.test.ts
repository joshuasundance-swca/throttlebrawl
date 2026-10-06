// The sim chunk and its code hash (docs/architecture.md, "Replay and input recording";
// docs/milestones/M2.md, app-3 item 4): src/sim, src/road and src/core build into one chunk, and
// its content hash is the code part of the replay key, injected into the app as
// __SIM_CODE_HASH__. A deploy that changes only UI code keeps the hash, so a saved race still
// resumes; a change to the sim changes it. Each case is a real production build, in memory.
import { describe, expect, it } from 'vitest';
import { build, type Plugin, type Rolldown } from 'vite';
import {
  SIM_CHUNK_NAME,
  SIM_CODE_HASH_PLACEHOLDER,
  simCodeHashOfChunks,
  STRUCTURES_CHUNK_NAME,
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
  return { hash: simCodeHashOfChunks(chunks), chunks };
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
    // (Vite's own preload helper rides along once the sim chunk loads a chunk by import(): the planners.)
    expect(
      sim?.moduleIds.every(
        (id) => /[\\/]src[\\/](sim|road|core)[\\/]/.test(id) || /vite[\\/]preload-helper/.test(id),
      ),
    ).toBe(true);

    // The app carries the hash, and no placeholder is left anywhere.
    const all = base.chunks.map((c) => c.code).join('\n');
    expect(all.includes(SIM_CODE_HASH_PLACEHOLDER)).toBe(false);
    expect(base.chunks.some((c) => c.name !== SIM_CHUNK_NAME && c.code.includes(base.hash))).toBe(true);
  });

  it("keeps the structures' planners in a lazy chunk of their own that the replay key still covers", async () => {
    // The planners (src/road/structures/, the districts' placement) are not the sim chunk, so they never ride in
    // the first load; the sim chunk loads them by import(), and the chunk's file name carries a hash of its code,
    // so a planner change moves simCodeHash while a render change (the drawing of the same districts) does not.
    const base = await buildOnce();
    const planner = await buildOnce([tweak(/\/src\/road\/structures\/mission\.ts$/, '__plannerTweak')]);
    const drawing = await buildOnce([tweak(/\/src\/render\/mission\.ts$/, '__drawingTweak')]);
    console.log(
      `[examined] simCodeHash base ${base.hash}, planner change ${planner.hash}, drawing change ${drawing.hash}`,
    );
    const sim = base.chunks.find((c) => c.name === SIM_CHUNK_NAME);
    const planners = base.chunks.filter((c) => c.name === STRUCTURES_CHUNK_NAME);
    expect(planners.length).toBe(1);
    const chunk = planners[0];
    expect(chunk?.moduleIds.some((id) => /[\\/]src[\\/]road[\\/]structures[\\/]mission\.ts$/.test(id))).toBe(
      true,
    );
    expect(chunk?.moduleIds.every((id) => /[\\/]src[\\/]road[\\/]structures[\\/]/.test(id))).toBe(true);
    // Not in the sim chunk, loaded by import() from it, and never one of its static imports.
    expect(sim?.moduleIds.some((id) => /[\\/]src[\\/]road[\\/]structures[\\/]/.test(id))).toBe(false);
    expect(sim?.moduleIds.some((id) => /[\\/]src[\\/]road[\\/]structures\.ts$/.test(id))).toBe(true);
    expect(sim?.dynamicImports).toContain(chunk?.fileName);
    expect(sim?.imports).toEqual([]);
    // The replay key follows the planners and not the drawing.
    expect(planner.chunks.some((c) => c.code.includes('__plannerTweak'))).toBe(true);
    expect(drawing.chunks.some((c) => c.code.includes('__drawingTweak'))).toBe(true);
    expect(planner.hash).not.toBe(base.hash);
    expect(drawing.hash).toBe(base.hash);
  });
});
