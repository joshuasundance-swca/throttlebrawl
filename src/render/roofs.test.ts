// Rain stops under a roof (playtest 3, wave B's live check, item 10: "PNW rain falls inside the covered
// ferry terminal at the start, under its roof"). The rule: where the scene stands a roof over the road
// (the car ferry's passenger deck), a camera under it sees no drizzle, and the drizzle comes back
// the moment it is out from under. These checks build the real Pacific Northwest road and ask the
// roof module and the drizzle what they say; the roof is checked against the ferry as it is drawn.
import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  loadPnwPlacesLayout,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import { createFlatLook } from './look';
import { FERRY_DIM, placeItems } from './pnw-places';
import { MAX_DROPS, Rain } from './rain';
import { FERRY_ROOF, ferrySections, roofCover, roofSpans, underRoof } from './roofs';
import { defaultRenderParams } from './tuning';

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function roadOf(id: string): RoadNetwork {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  return createRoadNetwork({ network, roads });
}

const pnw = roadOf('pnw-c1');
const spans = roofSpans(pnw);
const ferry = pnw.edges.flatMap((e) => e.tags.filter((t) => t.tag === 'ferry').map((t) => ({ e, t })))[0];

describe('the roofs the scene stands over the road', () => {
  it('has one roof over the ferry, and none on a road without a ferry', () => {
    expect(ferry).toBeDefined();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.edge).toBe(ferry!.e.index);
    expect(spans[0]!.s0).toBeGreaterThan(ferry!.t.s0);
    expect(spans[0]!.s1).toBeLessThan(ferry!.t.s1);
    expect(roofSpans(roadOf('keys-m1'))).toEqual([]);
  });

  it('covers exactly the stretches where the ferry is built with its passenger deck', async () => {
    const layout = (await loadPnwPlacesLayout()).pnwPlacesLayout(pnw, 7);
    const items = placeItems(pnw, 7, layout, () => 24).filter((i) => i.kind === 'ferry-hull');
    expect(items.length).toBeGreaterThan(4);
    const roofed: boolean[] = [];
    for (const it of items) {
      it.geometry.computeBoundingBox();
      const top = (it.geometry.boundingBox ?? new Box3()).max.y;
      // A hull section with the deck rises past the ceiling; one without stays at the bulwarks.
      const built = top > FERRY_DIM.ceilingY;
      roofed.push(built);
      const covered = spans.some((r) => r.edge === it.edge && it.s > r.s0 && it.s < r.s1);
      expect(covered, `hull section at s ${it.s.toFixed(1)}`).toBe(built);
    }
    // Both kinds are there (a test that never sees an open end proves nothing).
    expect(roofed).toContain(true);
    expect(roofed).toContain(false);
    const { n, cabin } = ferrySections(ferry!.t.s0, ferry!.t.s1);
    expect(Array.from({ length: n }, (_, i) => cabin(i)).filter(Boolean).length).toBeGreaterThan(2);
  });

  it('puts a camera under the roof, not at the open ends, above it or out to its side', () => {
    const r = spans[0]!;
    const mid = (r.s0 + r.s1) / 2;
    const at = (s: number, d: number, up: number) => {
      const p = pnw.toWorld(r.edge, s, d, 0);
      return underRoof(pnw, spans, p.x, pnw.surfaceHeight(r.edge, s, d) + up, p.z, r.edge);
    };
    expect(at(mid, 0, 3), 'a chase camera on the car deck').toBe(true);
    expect(at(r.s0 + 1, 0, 3), 'just inside the roof').toBe(true);
    expect(at(r.s0 - 3, 0, 3), 'on the ramp before the roof').toBe(false);
    expect(at(r.s1 + 3, 0, 3), 'past the roof').toBe(false);
    expect(at(mid, 0, FERRY_ROOF.heightM + 3), 'above the roof').toBe(false);
    expect(at(mid, FERRY_ROOF.halfWidthM + 4, 3), 'beside the ferry').toBe(false);
  });
});

describe('the drizzle under a roof', () => {
  const run = (rain: Rain, seconds: number, cover: number, dt = 1 / 60) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) rain.update(30, dt, cover);
  };

  it('stops where the camera is under a roof, and comes back when it is out', () => {
    const rain = new Rain(createFlatLook(), defaultRenderParams());
    rain.set('#c4ceca');
    run(rain, 0.1, 0);
    expect(rain.count()).toBe(MAX_DROPS / 2);
    run(rain, 1, 1);
    expect(rain.count()).toBe(0);
    expect(rain.root.visible).toBe(false);
    run(rain, 1, 0);
    expect(rain.count()).toBe(MAX_DROPS / 2);
  });

  it('follows where the camera is, not how long it has been there: one short frame under a roof is dry', () => {
    // The wave C check saw two or three streaks under the ferry's deck in a frame the camera had been
    // under it for seconds: a fade timed by frames lags whenever frames are few or slow (a stall, a
    // slow-motion crash, a harness that steps the sim in bursts). The cover is read from the camera's
    // place each frame, so a frame of any length, the first or the hundredth, draws none.
    for (const dt of [0.0005, 1 / 60, 0.1]) {
      const rain = new Rain(createFlatLook(), defaultRenderParams());
      rain.set('#c4ceca');
      run(rain, 0.2, 0);
      expect(rain.count()).toBe(MAX_DROPS / 2);
      rain.update(30, dt, 1);
      expect(rain.count(), `one frame of ${dt} s under the roof`).toBe(0);
      rain.update(30, dt, 0);
      expect(rain.count(), `one frame of ${dt} s out from under it`).toBe(MAX_DROPS / 2);
    }
  });

  it('thins out with the cover rather than blinking off', () => {
    const rain = new Rain(createFlatLook(), defaultRenderParams());
    rain.set('#c4ceca');
    const counts = [0, 0.25, 0.5, 0.75, 1].map((cover) => {
      rain.update(30, 1 / 60, cover);
      return rain.count();
    });
    expect(counts[0]).toBe(MAX_DROPS / 2);
    expect(counts[4]).toBe(0);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeLessThan(counts[i - 1]!);
  });
});

describe('how far under a roof the camera is', () => {
  const r = spans[0]!;
  const cover = (s: number, d: number, up: number) => {
    const p = pnw.toWorld(r.edge, s, d, 0);
    return roofCover(pnw, spans, p.x, pnw.surfaceHeight(r.edge, s, d) + up, p.z, r.edge);
  };

  it('is none out from under the roof, full well inside it, and grows with the way in from each end and side', () => {
    const mid = (r.s0 + r.s1) / 2;
    expect(cover(r.s0 - 3, 0, 3), 'before the roof').toBe(0);
    expect(cover(r.s1 + 3, 0, 3), 'past the roof').toBe(0);
    expect(cover(mid, 0, FERRY_ROOF.heightM + 3), 'above the roof').toBe(0);
    expect(cover(mid, FERRY_ROOF.halfWidthM + 4, 3), 'beside the ferry').toBe(0);
    expect(cover(mid, 0, 3), 'on the car deck, mid-ferry').toBe(1);
    const way = [0.5, 1.5, 3, 6].map((m) => cover(r.s0 + m, 0, 3));
    for (let i = 1; i < way.length; i++) expect(way[i]!, `${i}`).toBeGreaterThanOrEqual(way[i - 1]!);
    expect(way[0]!).toBeGreaterThan(0);
    expect(way[0]!).toBeLessThan(1);
    expect(way.at(-1)).toBe(1);
    // The same from the far end, and from the side.
    expect(cover(r.s1 - 1.5, 0, 3)).toBeCloseTo(cover(r.s0 + 1.5, 0, 3), 6);
    expect(cover(mid, FERRY_ROOF.halfWidthM - 1.5, 3)).toBeCloseTo(cover(r.s0 + 1.5, 0, 3), 6);
  });

  it('agrees with underRoof: any point under the roof has some cover, any other has none', () => {
    const mid = (r.s0 + r.s1) / 2;
    for (const [s, d, up] of [
      [mid, 0, 3],
      [r.s0 + 1, 0, 3],
      [r.s0 - 3, 0, 3],
      [mid, 0, FERRY_ROOF.heightM + 3],
      [mid, FERRY_ROOF.halfWidthM + 4, 3],
    ] as const) {
      const p = pnw.toWorld(r.edge, s, d, 0);
      const y = pnw.surfaceHeight(r.edge, s, d) + up;
      expect(roofCover(pnw, spans, p.x, y, p.z, r.edge) > 0, `${s} ${d} ${up}`).toBe(
        underRoof(pnw, spans, p.x, y, p.z, r.edge),
      );
    }
  });
});
