// The junction sweep (playtest 4, P4-4: "shortcut entries and exits, and junctions in general, are
// rough in terms of access, visible artifacts"). The rule it protects, on every baked network of
// every pack: where a connector road leaves or joins a road, what the camera sees is one clean
// surface. Read the way the camera does (the built scene's ground faces, straight down):
// - no hole: every point of a connector's lanes, and of the road within 30 m of a connector, has
//   ground under it (the first run found the last 2 m of a real road's connector pinched to nothing,
//   a wedge of open water or sky at the Key West, Portland, Lake Samish and Russian Hill turn-offs);
// - no step or float: the top surface of a connector stands at the height the sim rides at, so a
//   rider is never drawn inside the road or above it (a steep branch dropped 2 m under its main
//   road's verge before it came out);
// - no flicker: two flat road surfaces never lie within 3 cm of each other at one point (the
//   playtest 1b z-fighting rule, now for every junction instead of one).
// The paint staying on the asphalt is road-split.test.ts's, the open land edges are
// tools/gis/region-routes.test.ts's, and the connector's bend and its height against the road it
// leaves are the road lint's shortcut rule (src/road/shortcut-lint.test.ts).
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../road';
import { GroundTris } from './land-probe.test-util';
import { createFlatLook } from './look';
import { buildRoadScene } from './road-mesh';

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const allRoads = Object.values(
  import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', { eager: true, import: 'default' }),
);

/** What a rider can be drawn on (the land strip beside the road and the sea are not it). */
const DRIVABLE = /^road-(road|brick|shoulder|shortcut|deck)$/;
/** The flat surfaces that are meant to lie in one plane, so must not lie within a hair of each other. */
const FLAT = /^road-(road|brick|shoulder|shortcut)$/;
/** Ground that closes a hole: the land strip beside the road is drawn a little below its edge. */
const GROUND = /^road-(road|brick|shoulder|shortcut|deck|land)$/;
/** Ground this far below the ride height or lower is not ground a rider is on, metres. */
const HOLE_BELOW_M = 0.5;
/** Road within this of a connector's end is part of the junction, metres. */
const NEAR_M = 30;
const FLICKER_M = 0.03;
/** The most a connector's top surface may stand off the height the sim rides at, metres. */
const HEIGHT_TOL_M = 0.12;

/** What is wrong with the ground under (x, z), for a rider whose ride height there is `ride`. */
function faultsAt(tris: GroundTris, x: number, z: number, ride: number, connector: boolean): string[] {
  const out: string[] = [];
  const faces = tris.allAt(x, z, ride + 4);
  if (!faces.some((f) => GROUND.test(f.name) && f.y > ride - HOLE_BELOW_M))
    return ['nothing drawn under it: open ground shows through'];
  const top = faces.find((f) => DRIVABLE.test(f.name));
  if (connector && top && Math.abs(top.y - ride) > HEIGHT_TOL_M)
    out.push(`top surface ${top.name} stands ${(top.y - ride).toFixed(2)} m from the ride height`);
  const flat = faces.filter((f) => FLAT.test(f.name));
  for (let i = 1; i < flat.length; i++) {
    const hi = flat[i - 1]!;
    const lo = flat[i]!;
    if (hi.name !== lo.name && hi.y - lo.y < FLICKER_M)
      out.push(`${hi.name} and ${lo.name} lie ${((hi.y - lo.y) * 100).toFixed(1)} cm apart`);
  }
  return out;
}

describe('the junction sweep: the checks can find what they look for', () => {
  /** A flat slab named like a road mesh, its top at `top`, 10 m square around the origin. */
  const slab = (group: Group, name: string, top: number) => {
    const m = new Mesh(new BoxGeometry(10, 0.2, 10), new MeshBasicMaterial());
    m.name = name;
    m.position.y = top - 0.1;
    group.add(m);
  };
  const over = (group: Group, x: number, ride: number, connector: boolean) =>
    faultsAt(new GroundTris(group, /^road-/), x, 0, ride, connector);

  it('passes clean ground, and finds a hole, a float and a flickering pair', () => {
    const clean = new Group();
    slab(clean, 'road-road', 0);
    expect(over(clean, 0, 0, true)).toEqual([]);
    // Beside the slab there is nothing: the ground is open.
    expect(over(clean, 20, 0, true)[0]).toMatch(/open ground/);
    // Land a hair below the edge closes the gap, as the land strip does.
    const landed = new Group();
    slab(landed, 'road-land', -0.1);
    expect(over(landed, 0, 0, true)).toEqual([]);
    // A road 30 cm above the height the sim rides at.
    const high = new Group();
    slab(high, 'road-road', 0.3);
    expect(over(high, 0, 0, true)[0]).toMatch(/0\.30 m from the ride height/);
    expect(over(high, 0, 0, false)).toEqual([]);
    // Two flat surfaces 1 cm apart flicker; 5 cm apart (the shortcut's lift) they do not.
    const close = new Group();
    slab(close, 'road-road', 0);
    slab(close, 'road-shortcut', 0.01);
    expect(over(close, 0, 0, false)[0]).toMatch(/1\.0 cm apart/);
    const lifted = new Group();
    slab(lifted, 'road-road', 0);
    slab(lifted, 'road-shortcut', 0.05);
    expect(over(lifted, 0, 0.05, false)).toEqual([]);
  });
});

describe('the junction sweep: one clean surface where a connector meets a road', () => {
  it('has no hole, no step or float, and no flickering pair at any junction of any network', () => {
    const rows: string[] = [];
    let points = 0;
    let stretches = 0;
    let networks = 0;
    for (const network of Object.values(networkFiles)) {
      const roads = allRoads.filter((r) => network.roads.includes(r.id));
      if (roads.length !== network.roads.length) continue;
      networks++;
      const road = createRoadNetwork({ network, roads });
      if (!road.edges.some((e) => e.isConnector)) continue;
      const { group } = buildRoadScene(road, createFlatLook(), undefined, { postRoads: () => true });
      const tris = new GroundTris(group, /^road-/);
      for (const e of road.edges) {
        // The stretches of this edge that belong to a junction: all of a connector, and the ends of
        // any road that a connector leaves or joins.
        const spans: [number, number][] = [];
        if (e.isConnector) spans.push([0, e.length]);
        else {
          if (e.nextLinks.some((l) => road.edges[l.edge]?.isConnector))
            spans.push([Math.max(0, e.length - NEAR_M), e.length]);
          if (e.prevLinks.some((l) => road.edges[l.edge]?.isConnector))
            spans.push([0, Math.min(e.length, NEAR_M)]);
        }
        if (spans.length === 0) continue;
        stretches++;
        for (const [a, b] of spans)
          for (let s = a + 0.25; s <= b - 0.25; s += 2)
            for (let d = e.dMin + 0.4; d <= e.dMax - 0.4; d += 1) {
              const p = road.toWorld(e.index, s, d, 0);
              points++;
              for (const what of faultsAt(tris, p.x, p.z, road.surfaceHeight(e.index, s, d), e.isConnector))
                rows.push(`${network.id} ${e.id} s ${s.toFixed(1)} d ${d.toFixed(1)}: ${what}`);
            }
      }
    }
    console.log(`[examined] ${points} points on ${stretches} junction stretches of ${networks} networks`);
    expect(stretches).toBeGreaterThan(20); // the sweep is not empty
    expect(rows.slice(0, 20)).toEqual([]);
  }, 240_000);
});
