// A skyline's authored towers (playtest 4, P4-20): where a city has silhouettes people know, the data
// places each one with the crown it wears, so a horizon reads as that city and not as any city. The
// checks build one skyline piece alone on open ground and read the triangles it made: where each tower
// stands, how tall it is over its ground, and what its crown does at the top.
import { describe, expect, it } from 'vitest';
import { backdropProblems, TOWER_CROWNS, type SkylinePiece, type SkylineTower } from './data';
import { buildSkyline, type ShapeCtx } from './shapes';
import { Soup } from './soup';

type Tri = readonly [readonly number[], readonly number[], readonly number[]];

function piece(extra: Partial<SkylinePiece> = {}): SkylinePiece {
  return {
    id: 's',
    kind: 'skyline',
    frame: 'local',
    centre: [0, 0],
    radiusM: 100,
    count: 0,
    heightM: [40, 80],
    widthM: [30, 40],
    colours: ['#9fa4a3'],
    gridDeg: 0,
    ...extra,
  };
}

function trisOf(p: SkylinePiece, nearRoad: (x: number, z: number) => boolean = () => false): Tri[] {
  const soup = new Soup();
  const ctx: ShapeCtx = { soup, toWorld: (q) => [q[0], q[1]], nearRoad, centre: [0, 0], seed: 1 };
  buildSkyline(p, ctx);
  const out: Tri[] = [];
  for (let i = 0; i < soup.pos.length; i += 9)
    out.push([soup.pos.slice(i, i + 3), soup.pos.slice(i + 3, i + 6), soup.pos.slice(i + 6, i + 9)]);
  return out;
}

const tower = (extra: Partial<SkylineTower> = {}): SkylineTower => ({
  at: [0, 0],
  heightM: 100,
  widthM: 40,
  colour: '#c9a29b',
  ...extra,
});
const ys = (t: Tri) => t.map((v) => v[1]!);
const top = (tris: Tri[]) => Math.max(...tris.flatMap(ys));
/** The widest the tower is, along x, at heights within `eps` of y. */
const widthAt = (tris: Tri[], y: number, eps = 0.5) => {
  const xs = tris.flatMap((t) => t.filter((v) => Math.abs(v[1]! - y) < eps).map((v) => v[0]!));
  return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
};

describe("a skyline's authored towers", () => {
  it('stand where the data puts them, as tall as they say over their ground, and no scatter with count 0', () => {
    const tris = trisOf(
      piece({ baseM: 20, towers: [tower({ at: [300, -200] }), tower({ at: [-300, 200], heightM: 60 })] }),
    );
    expect(tris.length).toBeGreaterThan(0);
    const around = (cx: number, cz: number) =>
      tris.filter((t) => t.every((v) => Math.hypot(v[0]! - cx, v[2]! - cz) < 40));
    // (A flat roof's plant box stands a few metres over the height.)
    expect(top(around(300, -200))).toBeGreaterThanOrEqual(120);
    expect(top(around(300, -200))).toBeLessThan(125);
    expect(top(around(-300, 200))).toBeGreaterThanOrEqual(80);
    expect(top(around(-300, 200))).toBeLessThan(84);
    // Nothing anywhere else (the scatter's count is 0).
    expect(tris.length).toBe(around(300, -200).length + around(-300, 200).length);
  });

  it('wear the crown they name: a pyramid tapers to a point, a stepped top narrows twice, a flat one does not', () => {
    const H = 100;
    const pyramid = trisOf(piece({ towers: [tower({ heightM: H, crown: 'pyramid' })] }));
    const stepped = trisOf(piece({ towers: [tower({ heightM: H, crown: 'stepped' })] }));
    const flat = trisOf(piece({ towers: [tower({ heightM: H, crown: 'flat' })] }));
    // A pyramid's very top is a few metres wide at most, though the body is 40 m.
    expect(top(pyramid)).toBeCloseTo(H, 0);
    expect(widthAt(pyramid, H, 0.2)).toBeLessThan(6);
    expect(widthAt(pyramid, H * 0.9, 0.2)).toBeGreaterThan(30);
    // The stepped top is narrower at 0.94 of the height than at the body's top (0.86), and narrower again at the top.
    expect(widthAt(stepped, H * 0.86, 0.2)).toBeCloseTo(40, 0);
    const mid = widthAt(stepped, H * 0.94 + 0.01, 0.2);
    expect(mid).toBeLessThan(35);
    expect(widthAt(stepped, H, 0.2)).toBeLessThan(mid - 3);
    // A flat roof carries a small plant box, so it is a little taller than the body and not narrower than it at the roof.
    expect(top(flat)).toBeGreaterThan(H);
    expect(widthAt(flat, H, 0.2)).toBeGreaterThan(30);
    // Every crown stands over its tower: nothing is wider than the body.
    for (const crown of TOWER_CROWNS) {
      const tris = trisOf(piece({ towers: [tower({ heightM: H, crown })] }));
      expect(Math.max(...tris.flatMap((t) => t.map((v) => Math.abs(v[0]!)))), crown).toBeLessThanOrEqual(
        20 + 1e-6,
      );
      expect(top(tris), crown).toBeGreaterThanOrEqual(H - 1e-6);
    }
  });

  it("keep out of the roads like the scatter's, and the grid heading turns them", () => {
    const near = trisOf(piece({ towers: [tower({ at: [0, 0] })] }), (x) => Math.abs(x) < 100);
    expect(near).toEqual([]);
    const flat = trisOf(piece({ towers: [tower({ widthM: 40, depthM: 10 })] }));
    const turned = trisOf(piece({ gridDeg: 90, towers: [tower({ widthM: 40, depthM: 10 })] }));
    const extent = (tris: Tri[], k: 0 | 2) => {
      const v = tris.flatMap((t) => t.map((p) => p[k]!));
      return Math.max(...v) - Math.min(...v);
    };
    // Heading 0: the long axis along x; 90 degrees: along z.
    expect(extent(flat, 0)).toBeGreaterThan(extent(flat, 2));
    expect(extent(turned, 2)).toBeGreaterThan(extent(turned, 0));
  });

  it('leave the scatter as it was: the same skyline without towers, grid or ground builds the same', () => {
    // (No grid heading: the piece's id seeds one, as it always did.)
    const base: SkylinePiece = { ...piece({ count: 12 }) };
    delete base.gridDeg;
    const a = trisOf(base);
    const b = trisOf({ ...base, towers: [], baseM: 0 });
    expect(a.length).toBeGreaterThan(50);
    expect(b).toEqual(a);
  });

  it('are checked by the data check: a bad crown, size, colour or point fails it', () => {
    const file = (p: unknown) => ({
      formatVersion: 1,
      region: 'x',
      hazeM: 1,
      floorColour: '#000000',
      pieces: [p],
    });
    const ok = piece({ towers: [tower()] });
    expect(backdropProblems(file(ok), 'region')).toEqual([]);
    for (const bad of [
      { ...tower(), crown: 'dome' },
      { ...tower(), heightM: 0 },
      { ...tower(), widthM: -3 },
      { ...tower(), colour: 'pink' },
      { ...tower(), at: [1] },
    ])
      expect(backdropProblems(file({ ...ok, towers: [bad] }), 'region'), JSON.stringify(bad)).not.toEqual([]);
    expect(backdropProblems(file({ ...ok, baseM: 'high' }), 'region')).not.toEqual([]);
  });
});
