/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { createPackLibrary, packSubset, registryFromGlob } from '../content';
import { careersOf } from './bundled';
import { careerDefs } from './defs';

// The career maps ride with the career's lazy chunk, not the first load (2026-10-26: main's first
// load at 499.0 of its 500 KB gzip). The game's registry leaves them out, and the career still finds
// every map through careersOf.
const WHOLE = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const summary = (reg: Parameters<typeof careerDefs>[0]) =>
  careerDefs(reg).map((d) => `${d.key} ch${d.chapter} ${d.nodes.length} nodes boss ${d.boss}`);

describe('the career maps outside the first load', () => {
  it("the game's registry carries no career file, and the career finds every map anyway", () => {
    const game = createPackLibrary().registry();
    expect(Object.keys(game.careers)).toEqual([]);
    // The control: the whole registry carries them, and they are the same maps, in the same order.
    expect(Object.keys(WHOLE.careers).length).toBeGreaterThanOrEqual(3);
    expect(summary(game)).toEqual(summary(WHOLE));
    expect(Object.keys(careersOf(game)).sort()).toEqual(Object.keys(WHOLE.careers).sort());
  });

  it('only the careers of the packs a registry carries', () => {
    const baseOnly = packSubset(createPackLibrary().registry(), ['base']);
    expect(Object.keys(careersOf(baseOnly))).toEqual(['base:keys-circuit']);
  });

  it("a registry's own career files win (a test's, or a tool's)", () => {
    expect(careersOf(WHOLE)).toBe(WHOLE.careers);
  });
});
