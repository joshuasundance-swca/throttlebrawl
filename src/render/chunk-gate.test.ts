import { describe, expect, it } from 'vitest';
import { createChunkGate, type ChunkLoader } from './chunk-gate';

// Polish batch O's check, mustFix 1: render/ asked again for a chunk that gave up only at a new road
// (`setRoad`). A rematch from the result screen's Race button on the same road never calls `setRoad`
// (app/'s `showRegion` returns early for the road, time and event already shown), so a part whose chunk
// gave up stayed missing for every rematch, and the stale-build watch never heard of the missing file
// again (tests/e2e/app-chunk-retry.spec.ts, "each race asks the host again").

/** A host whose chunks answer from `served` (a name missing from it fails), counting every load. */
function host(served: Set<string>) {
  const loads: string[] = [];
  const load: ChunkLoader = async (name, importer) => {
    loads.push(name);
    if (!served.has(name)) return null; // both of loadChunk's tries failed
    return importer();
  };
  return { load, loads };
}

const part = () => Promise.resolve({ part: true });

describe("render/'s gave-up chunks (polish batch O's check, mustFix 1)", () => {
  it('the negative control: a chunk that gave up is not asked for again in the same race, however often', async () => {
    const h = host(new Set());
    const gate = createChunkGate(h.load);
    expect(await gate.chunk('race parts', part)).toBeNull();
    // render/ asks for the race parts every frame while they are missing.
    for (let frame = 0; frame < 300; frame++) expect(await gate.chunk('race parts', part)).toBeNull();
    expect(h.loads).toEqual(['race parts']);
    expect(gate.gaveUp()).toEqual(['race parts']);
  });

  it('a new road asks again', async () => {
    const h = host(new Set());
    const gate = createChunkGate(h.load);
    await gate.chunk('race parts', part);
    gate.newRoad();
    await gate.chunk('race parts', part);
    expect(h.loads).toEqual(['race parts', 'race parts']);
  });

  it('a race start on the same road asks again (a rematch from the result screen)', async () => {
    const h = host(new Set());
    const gate = createChunkGate(h.load);
    await gate.chunk('race parts', part); // race 1: gone
    await gate.chunk('race parts', part); // the next frame: not asked
    gate.raceStart(); // the rematch: no new road
    await gate.chunk('race parts', part); // its first frame
    await gate.chunk('race parts', part); // its next frame: gave up again, not asked
    expect(h.loads).toEqual(['race parts', 'race parts']);
  });

  it('a race start runs the request a part handed over, once, and a part that is back loads', async () => {
    const served = new Set<string>();
    const h = host(served);
    const gate = createChunkGate(h.load);
    let verge: unknown = null;
    /** The last request's settling, so the test awaits it rather than a clock. */
    let pending: Promise<void> = Promise.resolve();
    const requestVerge = () => {
      if (verge) return;
      pending = gate.chunk('verge', part).then((m) => {
        if (!m) return gate.later(requestVerge);
        verge = m;
      });
    };
    requestVerge();
    await pending;
    requestVerge(); // asked again in the same race: gave up, handed over a second time
    await pending;
    expect(h.loads).toEqual(['verge']);
    served.add('verge'); // the host has it again (a dropped request, not a deploy)
    gate.raceStart();
    await pending;
    expect(h.loads).toEqual(['verge', 'verge']);
    expect(verge).toEqual({ part: true });
    expect(gate.gaveUp()).toEqual([]);
    gate.raceStart(); // nothing handed over: nothing asked
    expect(h.loads).toEqual(['verge', 'verge']);
  });

  it("a new road forgets the last road's handed-over requests (the new road asks for its own)", async () => {
    const h = host(new Set());
    const gate = createChunkGate(h.load);
    let ran = 0;
    await gate.chunk('landmarks', part);
    gate.later(() => ran++);
    gate.newRoad();
    gate.raceStart();
    expect(ran).toBe(0);
  });
});
