// The backdrop's bridge styles for the real roads (playtest 3, T11.1; the maintainer, 2026-10-03:
// "the 7 mile bridge has an old road parallel to it", "real landmarks"): `truss` (camelback spans,
// the deck on top or the truss over it, honouring `gaps`: the old Bahia Honda and Seven Mile
// bridges, with their removed spans), `lift` (two towers with counterweights: the Hawthorne and
// Steel bridges) and `arch` (a tied arch: Fremont). The checks build each piece alone and read the
// triangles it made: where the deck is and is not, and what stands over it. All of it is the one
// triangle soup (one draw call, however many bridges there are).
import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { buildBackdrop } from './builder';
import {
  backdropProblems,
  type BackdropNetworkFile,
  type BackdropRegionFile,
  type BridgePiece,
} from './data';
import { buildBridge, type ShapeCtx } from './shapes';
import { Soup } from './soup';

type Tri = readonly [readonly number[], readonly number[], readonly number[]];

const LENGTH = 1500;

function piece(extra: Partial<BridgePiece> & Pick<BridgePiece, 'style'>): BridgePiece {
  return {
    id: 'b',
    kind: 'bridge',
    frame: 'local',
    from: [0, 0],
    to: [LENGTH, 0],
    deckM: 8,
    colour: '#7f8a93',
    ...extra,
  };
}

/** Builds one piece alone, on open ground (no road near), and returns its triangles. */
function trisOf(p: BridgePiece): Tri[] {
  const soup = new Soup();
  const ctx: ShapeCtx = {
    soup,
    toWorld: (q) => [q[0], q[1]],
    nearRoad: () => false,
    centre: [0, 0],
    seed: 1,
  };
  buildBridge(p, ctx);
  const out: Tri[] = [];
  for (let i = 0; i < soup.pos.length; i += 9) {
    out.push([soup.pos.slice(i, i + 3), soup.pos.slice(i + 3, i + 6), soup.pos.slice(i + 6, i + 9)]);
  }
  return out;
}

const xs = (t: Tri) => t.map((v) => v[0]!);
const ys = (t: Tri) => t.map((v) => v[1]!);

/** Horizontal triangles at exactly this height: the deck's top. */
function deckTops(tris: Tri[], y: number): Tri[] {
  return tris.filter((t) => ys(t).every((v) => Math.abs(v - y) < 1e-6));
}

/** The stretches of 0..LENGTH (0.25 m steps) with no deck top over them, as [from, to]. */
function holes(tris: Tri[], y: number): [number, number][] {
  const tops = deckTops(tris, y).map((t) => [Math.min(...xs(t)), Math.max(...xs(t))] as const);
  const out: [number, number][] = [];
  let start = -1;
  for (let x = 0; x <= LENGTH; x += 0.25) {
    const covered = tops.some(([a, b]) => x >= a - 1e-9 && x <= b + 1e-9);
    if (!covered && start < 0) start = x;
    if (covered && start >= 0) {
      out.push([start, x]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, LENGTH]);
  return out;
}

describe('a bridge piece with missing spans', () => {
  it.each([
    ['truss', 'the old Bahia Honda: 37.5 m hole', [[0.866, 0.889]] as const],
    [
      'truss',
      'two holes',
      [
        [0.2, 0.2257],
        [0.7, 0.75],
      ] as const,
    ],
    ['girder', 'an old girder bridge, its hole no longer a whole number of slabs', [[0.41, 0.46]] as const],
    ['lift', 'a lift bridge with a span out', [[0.5, 0.52]] as const],
    ['arch', 'an arch with a span out', [[0.1, 0.13]] as const],
  ] as const)('%s (%s) leaves a hole of the right length, to a metre', (style, _why, gaps) => {
    const p = piece({ style, gaps, towersAt: [0.4, 0.6], towerM: 30, archAt: [0.3, 0.7], archM: 25 });
    const found = holes(trisOf(p), p.deckM);
    expect(found).toHaveLength(gaps.length);
    gaps.forEach(([a, b], i) => {
      const [from, to] = found[i]!;
      expect(to - from, `${style} hole ${i}`).toBeGreaterThan((b - a) * LENGTH - 1);
      expect(to - from, `${style} hole ${i}`).toBeLessThan((b - a) * LENGTH + 1);
      expect(from).toBeGreaterThan(a * LENGTH - 1);
      expect(from).toBeLessThan(a * LENGTH + 1);
    });
    // The control: with no gaps the same check finds no hole, so it can see one.
    expect(
      holes(
        trisOf(piece({ style, towersAt: [0.4, 0.6], towerM: 30, archAt: [0.3, 0.7], archM: 25 })),
        p.deckM,
      ),
    ).toEqual([]);
  });

  it('draws a truss span only where there is deck: nothing of the bridge stands in the hole', () => {
    const gaps = [[0.5, 0.56]] as const;
    const [from, to] = [0.5 * LENGTH, 0.56 * LENGTH];
    const inHole = (tris: Tri[]) =>
      tris.filter((t) => Math.min(...xs(t)) > from + 1e-6 && Math.max(...xs(t)) < to - 1e-6);
    expect(inHole(trisOf(piece({ style: 'truss' }))).length).toBeGreaterThan(20);
    expect(inHole(trisOf(piece({ style: 'truss', gaps })))).toEqual([]);
  });
});

describe('the truss style', () => {
  it('raises camelback spans over the deck, humped in the middle of each span', () => {
    const tris = trisOf(piece({ style: 'truss', deckM: 8, spanM: 60, trussM: 10 }));
    const top = Math.max(...tris.flatMap(ys));
    expect(top).toBeGreaterThan(8 + 9.5);
    expect(top).toBeLessThan(8 + 10.5);
    // Within one span (0..60 m) the highest members are in the middle and the first panel stands lower.
    const within = (lo: number, hi: number) =>
      tris.filter((t) => Math.min(...xs(t)) >= lo && Math.max(...xs(t)) <= hi);
    const topOf = (list: Tri[]) => Math.max(...list.flatMap(ys));
    const firstPanel = within(0, 10.01);
    const middle = within(20, 40);
    expect(firstPanel.length).toBeGreaterThan(0);
    expect(middle.length).toBeGreaterThan(0);
    expect(topOf(middle) - topOf(firstPanel)).toBeGreaterThan(2);
  });

  it('puts the truss under a deck that is on top of it, with nothing standing above the deck', () => {
    const p = piece({ style: 'truss', deckM: 8, spanM: 60, trussM: 10, deckOnTop: true });
    const tris = trisOf(p);
    expect(Math.max(...tris.flatMap(ys))).toBeLessThanOrEqual(8 + 1e-6);
    // Hanging 10 m under the deck's own underside (it is 4 m thick at this height), at most.
    const low = Math.min(...tris.filter((t) => Math.min(...ys(t)) > -20).flatMap(ys));
    expect(low).toBeLessThan(8 - 4 - 9);
  });

  it('keeps spans apart from a road, like any piece: no span stands where a road is close', () => {
    const soup = new Soup();
    const ctx: ShapeCtx = {
      soup,
      toWorld: (q) => [q[0], q[1]],
      nearRoad: (x) => x > 700 && x < 800,
      centre: [0, 0],
      seed: 1,
    };
    buildBridge(piece({ style: 'truss', keepOutM: 50 }), ctx);
    const xsAll: number[] = [];
    for (let i = 0; i < soup.pos.length; i += 3) xsAll.push(soup.pos[i]!);
    expect(xsAll.some((x) => x > 725 && x < 775)).toBe(false);
    expect(xsAll.some((x) => x < 700)).toBe(true);
  });
});

describe('the lift style', () => {
  const p = piece({ style: 'lift', deckM: 8, towersAt: [0.45, 0.55], towerM: 40 });
  const tris = trisOf(p);

  it('stands two towers, one at each end of the lift span, as tall as asked', () => {
    const tall = tris.filter((t) => Math.max(...ys(t)) > 38);
    expect(Math.max(...tris.flatMap(ys))).toBeGreaterThan(39.5);
    expect(Math.max(...tris.flatMap(ys))).toBeLessThan(43);
    const centres = tall.map((t) => xs(t).reduce((a, b) => a + b, 0) / 3).sort((a, b) => a - b);
    const first = centres[0]!;
    const last = centres.at(-1)!;
    expect(Math.abs(first - 0.45 * LENGTH)).toBeLessThan(15);
    expect(Math.abs(last - 0.55 * LENGTH)).toBeLessThan(15);
  });

  it('hangs a counterweight on the shore side of each tower', () => {
    // A solid block (a box is 12 triangles) in the air, outside the pair, partway up the tower.
    const blocks = (lo: number, hi: number) =>
      tris.filter(
        (t) =>
          Math.min(...xs(t)) >= lo &&
          Math.max(...xs(t)) <= hi &&
          Math.min(...ys(t)) > 8 + 6 &&
          Math.max(...ys(t)) < 40 - 4,
      );
    const west = blocks(0.45 * LENGTH - 60, 0.45 * LENGTH - 6);
    const east = blocks(0.55 * LENGTH + 6, 0.55 * LENGTH + 60);
    expect(west.length).toBeGreaterThanOrEqual(12);
    expect(east.length).toBeGreaterThanOrEqual(12);
    // The control: a girder bridge has nothing hanging there.
    const plain = trisOf(piece({ style: 'girder', deckM: 8 }));
    expect(
      plain.filter(
        (t) =>
          Math.min(...xs(t)) >= 0.45 * LENGTH - 60 &&
          Math.max(...xs(t)) <= 0.45 * LENGTH - 6 &&
          Math.min(...ys(t)) > 14,
      ),
    ).toEqual([]);
  });
});

describe('the arch style', () => {
  const p = piece({ style: 'arch', deckM: 8, archAt: [0.3, 0.7], archM: 30 });
  const tris = trisOf(p);

  it('rises a tied arch over the deck between its springings, and only there', () => {
    const above = tris.filter((t) => Math.max(...ys(t)) > 8 + 1);
    expect(Math.max(...tris.flatMap(ys))).toBeGreaterThan(8 + 28);
    expect(Math.max(...tris.flatMap(ys))).toBeLessThan(8 + 33);
    expect(Math.min(...above.flatMap(xs))).toBeGreaterThan(0.3 * LENGTH - 10);
    expect(Math.max(...above.flatMap(xs))).toBeLessThan(0.7 * LENGTH + 10);
    // The crown is in the middle.
    const crown = above.filter((t) => Math.max(...ys(t)) > 8 + 28);
    const mid = crown.flatMap(xs).reduce((a, b) => a + b, 0) / (crown.length * 3);
    expect(Math.abs(mid - 0.5 * LENGTH)).toBeLessThan(40);
  });

  it('hangs the deck from the arch on vertical hangers', () => {
    // Plates standing in the arch's plane, from the deck up to the rib: tall, thin, many.
    const hangers = tris.filter(
      (t) =>
        Math.max(...xs(t)) - Math.min(...xs(t)) < 2 &&
        Math.max(...ys(t)) - Math.min(...ys(t)) > 5 &&
        Math.min(...ys(t)) >= 8 - 1e-6 &&
        Math.min(...xs(t)) > 0.3 * LENGTH + 20 &&
        Math.max(...xs(t)) < 0.7 * LENGTH - 20,
    );
    expect(hangers.length).toBeGreaterThanOrEqual(16);
  });
});

describe('the stayed style (playtest 4, P4-20: the Tilikum Crossing)', () => {
  const p = piece({ style: 'stayed', deckM: 10, towersAt: [0.4, 0.6], towerM: 50 });
  const tris = trisOf(p);
  /** Slanted stays: thin plates between a point on the deck (1 m over it) and a point up a tower. */
  const stays = tris.filter(
    (t) => Math.abs(Math.min(...ys(t)) - (10 + 1 - 0.9)) < 0.5 && Math.max(...ys(t)) > 10 + 8,
  );

  it('fans stays from each tower down to the deck on both sides, the farthest from the highest anchors', () => {
    expect(stays.length).toBeGreaterThan(40);
    for (const u of [0.4, 0.6]) {
      const m0 = u * LENGTH;
      // The stays that hang from this tower: one end of each plate is at the tower.
      const here = stays.filter((t) => xs(t).some((x) => Math.abs(x - m0) < 1e-6));
      const mean = (t: Tri) => xs(t).reduce((a, b) => a + b, 0) / 3;
      const before = here.filter((t) => mean(t) < m0 - 2);
      const after = here.filter((t) => mean(t) > m0 + 2);
      expect(before.length, `before ${u}`).toBeGreaterThan(8);
      expect(after.length, `after ${u}`).toBeGreaterThan(8);
      // The stay that lands farthest from the tower starts higher up it than the one that lands nearest.
      const reach = (t: Tri) => Math.max(...xs(t).map((x) => Math.abs(x - m0)));
      const anchor = (t: Tri) => Math.max(...ys(t));
      const far = after.reduce((a, b) => (reach(b) > reach(a) ? b : a));
      const near = after.reduce((a, b) => (reach(b) < reach(a) ? b : a));
      expect(anchor(far)).toBeGreaterThan(anchor(near));
    }
  });

  it('stands two towers as tall as asked, and a control without towers has no stays', () => {
    expect(Math.max(...tris.flatMap(ys))).toBeGreaterThan(49);
    expect(Math.max(...tris.flatMap(ys))).toBeLessThan(53);
    const none = trisOf(piece({ style: 'stayed', deckM: 10 }));
    expect(none.filter((t) => Math.max(...ys(t)) > 10 + 8)).toEqual([]);
  });

  it('lands no stay on a missing span, and does where the span is there', () => {
    const gaps = [[0.3, 0.38]] as const;
    const landings = (list: Tri[]) =>
      list
        .flatMap((t) => t.filter((v) => v[1]! > 10.05 && v[1]! < 11.05).map((v) => v[0]!))
        .filter((x) => x > 0.3 * LENGTH && x < 0.38 * LENGTH);
    const holed = trisOf(piece({ style: 'stayed', deckM: 10, towersAt: [0.4, 0.6], towerM: 50, gaps }));
    expect(landings(holed)).toEqual([]);
    expect(landings(tris).length).toBeGreaterThan(0);
  });
});

describe('what each style costs', () => {
  it('stays small: a 1.5 km bridge of any style is a few thousand flat triangles', () => {
    const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process
      .stdout;
    const counts = (['girder', 'truss', 'lift', 'arch', 'stayed'] as const).map((style) => {
      const n = trisOf(
        piece({ style, towersAt: [0.45, 0.55], towerM: 40, archAt: [0.3, 0.7], archM: 30 }),
      ).length;
      stdout.write(`[print] ${style} bridge, ${LENGTH} m: ${n} triangles\n`);
      return n;
    });
    for (const n of counts) expect(n).toBeLessThan(4000);
    // The truss is the dearest, and still a fraction of the horizon's 17k.
    expect(counts[1]).toBeGreaterThan(counts[0]!);
  });
});

describe('the backdrop, with the new styles in it', () => {
  const region: BackdropRegionFile = {
    formatVersion: 1,
    region: 'test',
    hazeM: 8000,
    floorColour: '#2f6f8f',
    pieces: [
      piece({ id: 'old-truss', style: 'truss', gaps: [[0.4, 0.43]], deckOnTop: true }),
      piece({ id: 'lift', style: 'lift', from: [0, 900], to: [LENGTH, 900], towersAt: [0.45, 0.55] }),
      piece({
        id: 'arch',
        style: 'arch',
        from: [0, 1800],
        to: [LENGTH, 1800],
        archAt: [0.3, 0.7],
        archM: 25,
      }),
    ],
  };
  const network: BackdropNetworkFile = {
    formatVersion: 1,
    network: 'test-net',
    originLatDeg: 24,
    originLonDeg: -81,
  };

  it('is still one mesh, one draw call, and every bridge in it', () => {
    const built = buildBackdrop(region, network, [[0, 5000]], 1);
    expect(built.mesh).toBeInstanceOf(Mesh);
    expect(built.stats.kinds['bridge']).toBe(3);
    expect(built.stats.skipped).toBe(0);
    const vertices = built.mesh.geometry.getAttribute('position').count;
    expect(vertices).toBe(built.stats.triangles * 3);
    // A bridge's hanging members are flat colour, no more triangles than the horizon can afford.
    expect(built.stats.triangles).toBeLessThan(20_000);
    built.dispose();
  });

  it('checks the new fields', () => {
    const file = (bridge: Record<string, unknown>) => ({
      formatVersion: 1,
      network: 'n',
      originLatDeg: 0,
      originLonDeg: 0,
      pieces: [
        {
          id: 'b',
          kind: 'bridge',
          from: [0, 0],
          to: [1, 1],
          style: 'truss',
          deckM: 8,
          colour: '#ffffff',
          ...bridge,
        },
      ],
    });
    expect(backdropProblems(file({}), 'network')).toEqual([]);
    expect(backdropProblems(file({ style: 'lift' }), 'network')).toEqual([]);
    expect(backdropProblems(file({ style: 'arch', archAt: [0.3, 0.7], archM: 20 }), 'network')).toEqual([]);
    const bad = (extra: Record<string, unknown>) => backdropProblems(file(extra), 'network').join(' | ');
    expect(bad({ style: 'cantilever' })).toContain('style');
    expect(bad({ gaps: [[0.6, 0.5]] })).toContain('gaps');
    expect(bad({ gaps: [[0.2, 1.2]] })).toContain('gaps');
    expect(bad({ spanM: 0 })).toContain('spanM');
    expect(bad({ archAt: [0.7, 0.3] })).toContain('archAt');
  });
});

// Playtest 4, G1: the far Golden Gate lies on the near kit's own deck, which climbs from about 59 m at
// the toll plaza to 71 m at the Marin end, so a bridge's deck may slope end to end (`deckEndM`).
describe('a sloping deck (deckEndM)', () => {
  /** The deck's top at a slab edge x: the highest vertex there (a girder bridge has no tower or cable). */
  const topAt = (tris: Tri[], x: number) =>
    Math.max(...tris.flatMap((t) => t.filter((v) => Math.abs(v[0]! - x) < 1e-6).map((v) => v[1]!)));

  it('runs from deckM at `from` to deckEndM at `to`; level without it', () => {
    const sloped = trisOf(piece({ style: 'girder', deckM: 10, deckEndM: 22 }));
    const level = trisOf(piece({ style: 'girder', deckM: 10 }));
    // A 1,500 m deck is 13 slabs (one per 120 m or so): their edges are where its height is exact.
    const edge = (LENGTH * 6) / 13;
    expect(topAt(sloped, 0)).toBeCloseTo(10, 6);
    expect(topAt(sloped, LENGTH)).toBeCloseTo(22, 6);
    expect(topAt(sloped, edge)).toBeCloseTo(10 + (12 * 6) / 13, 6);
    // Control: the same bridge with no deckEndM is level.
    expect(topAt(level, 0)).toBeCloseTo(10, 6);
    expect(topAt(level, LENGTH)).toBeCloseTo(10, 6);
    expect(topAt(level, edge)).toBeCloseTo(10, 6);
  });

  it('is refused on a style that stands on a level deck, and a bad value is refused', () => {
    const file = (p: Partial<BridgePiece>) => ({
      formatVersion: 1,
      region: 'x',
      hazeM: 1,
      floorColour: '#ffffff',
      pieces: [piece({ style: 'suspension', ...p })],
    });
    expect(backdropProblems(file({ deckEndM: 20 }), 'region')).toEqual([]);
    expect(backdropProblems(file({ style: 'truss', deckEndM: 20 }), 'region')).toEqual([
      'pieces[0]: deckEndM is for a suspension or girder bridge',
    ]);
    expect(backdropProblems(file({ deckEndM: -1 }), 'region')).toEqual(['pieces[0]: deckEndM must be > 0']);
    expect(backdropProblems(file({ nearFadeM: 0 }), 'region')).toEqual(['pieces[0]: nearFadeM must be > 0']);
  });
});
