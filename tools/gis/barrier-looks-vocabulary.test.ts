import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { roadSchema } from '../../src/content/schema';
import { BARRIER_LOOKS } from '../../src/core/surfaces';
import { BARRIER_LOOK_STYLES } from '../../src/render/barrier-looks';

// A barrier look is a word in three places (playtest 4, run C5): the road format's vocabulary
// (src/core/surfaces.ts, which the pack schema and the road types read), the GIS bake config's
// (`BarrierLook` in tools/gis/src/tbgis/config.py, so the bake can write it and its lint accept it) and
// the renderer's table of panels (src/render/barrier-looks.ts). A look in one and not the others is a
// barrier the bake cannot write, the schema refuses or the screen does not draw.

const python = readFileSync('tools/gis/src/tbgis/config.py', 'utf8');
const pythonLooks = [
  ...(/^BarrierLook = Literal\[(.*)\]$/m.exec(python)?.[1] ?? '').matchAll(/"([a-z-]+)"/g),
].map((m) => m[1] ?? '');

describe('the barrier look vocabulary', () => {
  it('is the same word list in the road format, the bake config and the renderer', () => {
    console.log(`[examined] ${BARRIER_LOOKS.length} looks: ${BARRIER_LOOKS.join(', ')}`);
    expect([...BARRIER_LOOKS].sort()).toEqual(Object.keys(BARRIER_LOOK_STYLES).sort());
    expect([...BARRIER_LOOKS].sort()).toEqual([...pythonLooks].sort());
  });

  it("is what a road file's barrier may say, and a look outside it is refused", () => {
    const barrier = { s0: 0, s1: 10, side: 'both', kind: 'wall', heightM: 0.9 };
    const fails = (look: string) => {
      const parsed = roadSchema.safeParse({ barriers: [{ ...barrier, look }] });
      return parsed.error?.issues.some((i) => i.path.join('.').startsWith('barriers.0.look')) ?? false;
    };
    for (const look of BARRIER_LOOKS) expect(fails(look), look).toBe(false);
    expect(fails('stone-arch'), 'a look nobody has built is refused, so a typo cannot ship').toBe(true);
  });
});
