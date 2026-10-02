import { describe, expect, it } from 'vitest';
import { roadSchema } from './entries';

// The W-Q cross-section in the pack schema: verge bands per side, a median, the lanes' surface.

const lane = (id: string, d: number, direction: 1 | -1) => ({
  id,
  dCenterM: d,
  widthM: 4,
  direction,
  kind: 'drive',
});

describe('road cross-section schema', () => {
  const section = {
    s0: 0,
    lanes: [lane('L1', -3, -1), lane('R1', 3, 1)],
    median: { widthM: 2, kind: 'kerb' },
    verges: { left: { widthM: 6, surface: 'grass', edge: 'fence' } },
  };
  const file = {
    type: 'road',
    id: 'a',
    network: 'n',
    from: 'j0',
    to: 'j1',
    lengthM: 2,
    sampleSpacingM: 2,
    surface: 'dirt',
    laneSections: [section],
    samples: { encoding: 'json-columns', columns: ['x'], data: { x: [0, 2] } },
  };
  const withSection = (patch: object) => ({ ...file, laneSections: [{ ...section, ...patch }] });

  it('takes verges, a median and a surface, each optional', () => {
    expect(roadSchema.safeParse(file).success).toBe(true);
    const { surface: _surface, ...noSurface } = file;
    expect(roadSchema.safeParse(noSurface).success).toBe(true);
    expect(roadSchema.safeParse(withSection({ median: undefined, verges: undefined })).success).toBe(true);
  });

  it('refuses words outside the closed lists and negative widths', () => {
    expect(roadSchema.safeParse({ ...file, surface: 'lava' }).success).toBe(false);
    const verge = (v: object) => withSection({ verges: { right: v } });
    expect(roadSchema.safeParse(verge({ widthM: 1, surface: 'sand', edge: 'moat' })).success).toBe(false);
    expect(roadSchema.safeParse(verge({ widthM: 1, surface: 'lava', edge: 'soft' })).success).toBe(false);
    expect(roadSchema.safeParse(verge({ widthM: -1, surface: 'sand', edge: 'soft' })).success).toBe(false);
    expect(roadSchema.safeParse(withSection({ median: { widthM: 2, kind: 'moat' } })).success).toBe(false);
  });
});
