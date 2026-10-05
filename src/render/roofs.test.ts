// Rain stops under a roof (playtest 3, wave B's live check, item 10: "PNW rain falls inside the covered
// ferry terminal at the start, under its roof"). The rule: where the scene stands a roof over the road
// (the car ferry's passenger deck), a camera under it sees no drizzle, and the drizzle comes back
// the moment it is out from under. These checks build the real Pacific Northwest road and ask the
// roof module and the drizzle what they say; the roof is checked against the ferry as it is drawn.
import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { FERRY_DIM, placeItems } from './pnw-places';
import { MAX_DROPS, Rain } from './rain';
import { FERRY_ROOF, ferrySections, roofSpans, underRoof } from './roofs';
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

  it('covers exactly the stretches where the ferry is built with its passenger deck', () => {
    const items = placeItems(pnw, 7, () => 24).filter((i) => i.kind === 'ferry-hull');
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
  const run = (rain: Rain, seconds: number, sheltered: boolean) => {
    for (let i = 0; i < seconds * 60; i++) rain.update(30, 1 / 60, sheltered);
  };

  it('stops while the camera is under a roof, and comes back when it is out', () => {
    const rain = new Rain(createFlatLook(), defaultRenderParams());
    rain.set('#c4ceca');
    run(rain, 0.1, false);
    expect(rain.count()).toBe(MAX_DROPS / 2);
    run(rain, 1, true);
    expect(rain.count()).toBe(0);
    expect(rain.root.visible).toBe(false);
    run(rain, 1, false);
    expect(rain.count()).toBe(MAX_DROPS / 2);
  });

  it('thins out rather than blinking off', () => {
    const rain = new Rain(createFlatLook(), defaultRenderParams());
    rain.set('#c4ceca');
    run(rain, 0.1, false);
    run(rain, 0.1, true);
    expect(rain.count()).toBeGreaterThan(0);
    expect(rain.count()).toBeLessThan(MAX_DROPS / 2);
  });
});
