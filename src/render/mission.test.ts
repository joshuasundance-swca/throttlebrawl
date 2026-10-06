// San Francisco's mural alleys as drawn (run W-U; the pitch deck after playtest 2, #8: "the Mission's
// mural alleys, where a mural of the streaming outfit's mascot is being painted over mid-race"), on
// the real baked network: buildings line every tagged side and never stand on a road, most alley
// walls are painted in a mix of motifs, the mascot's two walls wrap their corners with the face
// looking back up the street, and the crew's paint follows the leader's share of the race.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { createFlatLook } from './look';
import {
  CELL_M,
  crewProgress,
  FRESH,
  hasMission,
  mascotPainter,
  MissionLayer,
  paintDrawCount,
  planMission,
  PRIMER,
  raceShare,
} from './mission';
import { networkTags, type RoadDressing } from './road-mesh';

/** The examined lines, printed even when the tests pass. */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-sf/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-sf/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing; roads: BakedRoad[] } {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing, roads };
}

const { road, dressing } = track('sf-mission');
const plan = planMission({ road, dressing, seed: 1 });
const EDGE = 5.5;

describe('the mural district: what stands there', () => {
  it('belongs to the mural network only', () => {
    expect(hasMission(networkTags(road, dressing).tags)).toBe(true);
    for (const other of ['sf-downtown', 'sf-hills']) {
      const t = track(other);
      expect(hasMission(networkTags(t.road, t.dressing).tags), other).toBe(false);
    }
  });

  it('buildings line every tagged side end to end, most alley walls painted, in a mix of motifs', () => {
    let length = 0;
    let covered = 0;
    for (const line of plan.lines) {
      const total = line.us[line.us.length - 1] ?? 0;
      length += total;
      const mine = plan.buildings.filter((b) => b.kind === line.kind && b.side === line.side);
      covered += Math.min(
        total,
        mine
          .filter((b) => b.u1 <= total + 1e-6 && line.edges.includes(b.edge))
          .reduce((a, b) => a + (b.u1 - b.u0), 0),
      );
    }
    const alley = plan.buildings.filter((b) => b.kind === 'murals');
    const shops = plan.buildings.filter((b) => b.kind === 'shopfronts');
    const painted = alley.filter((b) => b.motif);
    const motifs = new Set(plan.buildings.filter((b) => b.motif && b.motif !== 'mascot').map((b) => b.motif));
    print(
      `[examined] ${plan.lines.length} wall runs, ${length.toFixed(0)} m of frontage, ${plan.buildings.length} buildings ` +
        `(${shops.length} shopfronts, ${alley.length} alley walls, ${painted.length} painted, ${shops.filter((b) => b.motif).length} shopfront murals); ` +
        `motifs ${[...motifs].sort().join(', ')}; ${plan.items.length} lamps and bins`,
    );
    expect(covered / length).toBeGreaterThan(0.99);
    expect(painted.length / alley.length).toBeGreaterThan(0.55);
    expect(painted.length / alley.length).toBeLessThan(0.9);
    expect(motifs.size).toBeGreaterThanOrEqual(6);
    expect(shops.some((b) => b.motif)).toBe(true);
    for (const b of plan.buildings) expect(b.u1 - b.u0, `${b.kind} at ${b.u0}`).toBeGreaterThan(3.5);
    expect(plan.items.filter((i) => i.rule === 'lamp').length).toBeGreaterThan(20);
  });

  it('nothing stands on a road: every footprint corner is past the road edge and its kerb, from every road', () => {
    // Each road's centre line every 2 m.
    const centre: { x: number; z: number }[] = [];
    for (const e of road.edges)
      for (let s = 0; s <= e.length; s += 2) {
        const p = road.toWorld(e.index, s, 0, 0);
        centre.push({ x: p.x, z: p.z });
      }
    let points = 0;
    let closest = Infinity;
    for (const b of plan.buildings)
      for (const p of [...b.front, ...b.back]) {
        let best = Infinity;
        for (const c of centre) best = Math.min(best, Math.hypot(p.x - c.x, p.z - c.z));
        closest = Math.min(closest, best);
        points++;
      }
    for (const it of plan.items) {
      let best = Infinity;
      for (const c of centre) best = Math.min(best, Math.hypot(it.p.x - c.x, it.p.z - c.z));
      expect(best, `${it.rule} at ${it.edge}@${it.s.toFixed(0)}`).toBeGreaterThan(EDGE + 0.2);
    }
    print(
      `[examined] ${points} footprint corners: nearest ${closest.toFixed(2)} m from any road's centre line`,
    );
    // The road's edge (5.5 m) plus the alley's 1.5 m of kerb, less the 2 m sampling's chord.
    expect(closest).toBeGreaterThan(EDGE + 1.5 - 0.1);
  });

  it('keeps off every landmark beside the alleys: no wall corner stands in a footprint (the mission chapel, M3)', () => {
    let boxes = 0;
    let points = 0;
    for (const e of road.edges)
      for (const f of road.featuresOf(e.index, 'landmark')) {
        boxes++;
        for (const b of plan.buildings)
          for (const p of [...b.front, ...b.back]) {
            const at = road.project(p.x, p.z, e.index);
            if (at.edge !== e.index) continue;
            points++;
            const inside =
              at.s > f.s0 && at.s < f.s1 && at.d > Math.min(f.d0, f.d1) && at.d < Math.max(f.d0, f.d1);
            expect(
              inside,
              `a wall corner at ${e.id} s ${at.s.toFixed(0)} d ${at.d.toFixed(1)} in ${f.id}`,
            ).toBe(false);
          }
      }
    print(`[examined] ${boxes} landmark footprint(s), ${points} wall corners tested against them`);
    expect(boxes).toBeGreaterThan(0);
    // The control: the same walls with no landmark in the way do stand there, so the test can see them.
    const without = planMission({
      road,
      dressing: Object.fromEntries(
        Object.entries(dressing).map(([id, d]) => [
          id,
          { ...d, features: d.features?.filter((x) => x.kind !== 'landmark') },
        ]),
      ),
      seed: 1,
    });
    const chapel = road.edges.map((e) => road.featuresOf(e.index, 'landmark')).flat()[0]!;
    const chapelEdge = road.edgeIndex('sf-mi-last-coat-alley');
    const standing = without.buildings.some((b) =>
      [...b.front, ...b.back].some((p) => {
        const at = road.project(p.x, p.z, chapelEdge);
        return (
          at.s > chapel.s0 &&
          at.s < chapel.s1 &&
          at.d > Math.min(chapel.d0, chapel.d1) &&
          at.d < Math.max(chapel.d0, chapel.d1)
        );
      }),
    );
    expect(standing, 'without the landmark a wall stands where the chapel does').toBe(true);
  });

  // Playtest 4, run C's live check: "the Mission chapel shows only in the last 40 m behind the mural walls and
  // stands past the finish". The chapel's front stands on the alley's left past the finish, and the left wall
  // before it hid it. A landmark's `sightM` opens the wall that far before the footprint (the downtown's rule:
  // a landmark keeps its approach clear), so the front is seen down the alley before the line.
  describe('the mission chapel reads before the line (run C)', () => {
    const edge = road.edgeIndex('sf-mi-last-coat-alley');
    const chapel = road.featuresOf(edge, 'landmark')[0]!;
    const FRONT_S = chapel.s0; // the front's plane: the model's origin is its front (`frontM`), turned to the rider
    /** The front's sample points: five heights (the model's front is 13 m to its gable) by three across its 12 m. */
    const facade = (p: typeof plan, withWalls = true) => {
      const walls = withWalls ? p.buildings : [];
      const pts: { x: number; y: number; z: number }[] = [];
      for (const up of [1.5, 4.5, 7.5, 10.5, 12.5])
        for (const across of [-4.5, 0, 4.5]) {
          const w = road.toWorld(edge, FRONT_S, (chapel.d0 + chapel.d1) / 2 + across, up);
          pts.push(w);
        }
      return { walls, pts };
    };
    /** Whether a wall of the plan stands between the camera and the point (every 0.25 m along the sight line). */
    const blocked = (
      walls: readonly (typeof plan.buildings)[number][],
      cam: { x: number; y: number; z: number },
      to: { x: number; y: number; z: number },
    ): boolean => {
      const len = Math.hypot(to.x - cam.x, to.y - cam.y, to.z - cam.z);
      for (let k = 1; k < len - 0.5; k += 0.25) {
        const u = k / len;
        const x = cam.x + (to.x - cam.x) * u;
        const y = cam.y + (to.y - cam.y) * u;
        const z = cam.z + (to.z - cam.z) * u;
        for (const b of walls) {
          const base = b.front[0]?.y ?? 0;
          if (y > base + b.height + 1.5) continue;
          for (let i = 0; i + 1 < b.front.length; i++) {
            const quad = [b.front[i]!, b.front[i + 1]!, b.back[i + 1]!, b.back[i]!];
            let inside = false;
            for (let a = 0, c = 3; a < 4; c = a++) {
              const pa = quad[a]!;
              const pc = quad[c]!;
              if (pa.z > z !== pc.z > z && x < ((pc.x - pa.x) * (z - pa.z)) / (pc.z - pa.z) + pa.x)
                inside = !inside;
            }
            if (inside) return true;
          }
        }
      }
      return false;
    };
    /** The share of the front a rider sees from `backM` before the line (the chase camera: 5 m back, 2.6 m up). */
    const seenFrom = (p: typeof plan, backM: number, withWalls = true): number => {
      const { walls, pts } = facade(p, withWalls);
      const s = chapel.s0 - backM - 5;
      const cam = road.toWorld(edge, s, 1.7, 2.6);
      return pts.filter((q) => !blocked(walls, cam, q)).length / pts.length;
    };

    it('stands in the picture and shows most of its front from 120 m before the line, and some from 245 m', () => {
      const rows = [60, 120, 245].map((m) => ({ m, share: seenFrom(plan, m) }));
      print(
        `[examined] the chapel's front seen from ${rows.map((r) => `${r.m} m: ${(r.share * 100).toFixed(0)} %`).join(', ')} before its front (the finish is at s 613, the front at s ${chapel.s0}), ${plan.buildings.length} walls`,
      );
      expect(rows[0]!.share).toBeGreaterThanOrEqual(0.8);
      expect(rows[1]!.share).toBeGreaterThanOrEqual(0.8);
      expect(rows[2]!.share).toBeGreaterThanOrEqual(0.3);
    });

    it('control: the same chapel behind the walls with no opening is hidden from 120 m (the run C finding)', () => {
      const shut = planMission({
        road,
        dressing: Object.fromEntries(
          Object.entries(dressing).map(([id, d]) => [
            id,
            {
              ...d,
              features: d.features?.map((f) =>
                f.kind === 'landmark' ? { ...f, params: { ...f.params, sightM: 0 } } : f,
              ),
            },
          ]),
        ),
        seed: 1,
      });
      const share = seenFrom(shut, 120);
      print(`[examined] control, no opening: ${(share * 100).toFixed(0)} % of the front seen from 120 m`);
      expect(share).toBeLessThan(0.5);
    });
  });

  it('is the same for the same seed and changes with the seed', () => {
    const key = (p: typeof plan) =>
      p.buildings.map((b) => `${b.u0.toFixed(2)}:${b.height.toFixed(2)}:${b.motif}`).join('|');
    expect(key(planMission({ road, dressing, seed: 1 }))).toBe(key(plan));
    expect(key(planMission({ road, dressing, seed: 2 }))).not.toBe(key(plan));
  });
});

describe("the streaming outfit's mascot, painted over mid-race", () => {
  it('two walls, each round the outside of a corner, the face on the corner looking back up the street', () => {
    expect(plan.mascots.length).toBe(2);
    for (const wall of plan.mascots) {
      const edges = [...new Set(wall.line.edges)];
      expect(edges.length).toBe(2);
      const total = wall.line.us[wall.line.us.length - 1] ?? 0;
      // The outside of the bend: the side away from the corner's centre.
      const first = road.edges[edges[0] ?? 0];
      if (!first) throw new Error('no edge');
      const k = road.kappaAt(first.index, first.length - 1);
      expect(Math.sign(k), 'outside of the bend').toBe(-wall.line.side);
      expect(wall.uCorner / total).toBeGreaterThan(0.3);
      expect(wall.uCorner / total).toBeLessThan(0.7);
      // The face is on the bend, near the corner.
      expect(Math.abs(wall.uFace - wall.uCorner)).toBeLessThan(15);
      // From 150 m up the approach, the face is dead ahead.
      const f = road.frameAt(first.index, first.length - 150);
      const face = wall.line.pts[wall.line.us.findIndex((u) => u >= wall.uFace)] ?? { x: 0, z: 0 };
      const vx = face.x - f.x;
      const vz = face.z - f.z;
      const ahead = vx * f.tx + vz * f.tz;
      const across = vx * -f.tz + vz * f.tx;
      print(
        `[examined] mascot wall on ${first.id} (${wall.line.side < 0 ? 'left' : 'right'}): ${total.toFixed(1)} m long, corner at ${wall.uCorner.toFixed(1)} m, face at ${wall.uFace.toFixed(1)} m; ` +
          `from 150 m up the approach the face is ${ahead.toFixed(1)} m ahead, ${across.toFixed(1)} m across; ${wall.columns} columns`,
      );
      expect(ahead).toBeGreaterThan(120);
      expect(Math.abs(across)).toBeLessThan(1.5);
    }
  });

  it("reads the right way round on both walls (a right-hand wall's mural is painted mirrored)", () => {
    for (const wall of plan.mascots) {
      const i = Math.max(
        1,
        wall.line.us.findIndex((u) => u >= wall.uCorner),
      );
      const a = wall.line.pts[i - 1];
      const b = wall.line.pts[i];
      const n = wall.line.ins[i];
      if (!a || !b || !n) throw new Error('short wall');
      // Facing the wall (looking against `ins`), the viewer's right is (iz, -ix).
      const alongRight = (b.x - a.x) * n.z + (b.z - a.z) * -n.x;
      // u runs to the viewer's right on a left-hand wall and to the left on a right-hand one.
      expect(Math.sign(alongRight)).toBe(wall.line.side < 0 ? 1 : -1);
    }
    // The painter's words read left to right: STAY's S starts left of its T.
    const paint = mascotPainter(80, 13.5, 40);
    const yellow = (x: number, y: number) => paint(x, y) === '#f9dc5c';
    let first = -1;
    for (let x = 0; x < 40 && first < 0; x += CELL_M)
      if (yellow(x + 0.25, 13.5 * 0.18 + 8 * CELL_M + 6.25 * CELL_M)) first = x;
    expect(first).toBeGreaterThan(0);
  });

  it('the crew follows the leader: primer from the far end, then the new mural, never going back', () => {
    const wall = plan.mascots[0];
    if (!wall) throw new Error('no wall');
    const n = wall.columns;
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const { primer, fresh } = crewProgress(i / 100);
      const c = paintDrawCount(wall, primer, fresh);
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
    }
    expect(paintDrawCount(wall, 0, 0)).toBe(0);
    expect(paintDrawCount(wall, 1, 0)).toBe(wall.primerVerts[n - 1]);
    expect(paintDrawCount(wall, 1, 1)).toBe(wall.freshVerts[n - 1]);
    expect(crewProgress(PRIMER[0])).toEqual({ primer: 0, fresh: 0 });
    expect(crewProgress(FRESH[1])).toEqual({ primer: 1, fresh: 1 });
    // The first column painted is the far end's (the paint's first vertex is beyond the corner).
    const p0 = { x: wall.paint.pos[0] ?? 0, z: wall.paint.pos[2] ?? 0 };
    const end = wall.line.pts[wall.line.pts.length - 1] ?? { x: 0, z: 0 };
    const start = wall.line.pts[0] ?? { x: 0, z: 0 };
    expect(Math.hypot(p0.x - end.x, p0.z - end.z)).toBeLessThan(Math.hypot(p0.x - start.x, p0.z - start.z));
  });

  it('as the field reaches each wall: the first half primed with the face still showing, the second primed and repainting', () => {
    const layer = new MissionLayer(undefined, createFlatLook(), { road, dressing, seed: 1 });
    const at = (wall: number) => plan.mascots[wall]?.line.pts[0] ?? { x: 0, z: 0 };
    const report: string[] = [];
    for (const [i, share] of [
      [0, 0.47],
      [1, 0.82],
    ] as const) {
      const p = at(i);
      for (let f = 0; f < 3; f++) layer.update(p.x, p.z, 1 / 60, share);
      const crew = layer.counts().crew[i];
      const wall = layer.plan.mascots[i];
      if (!crew || !wall) throw new Error('no crew');
      report.push(
        `wall ${i + 1} at share ${share}: primer ${(crew.primer * 100).toFixed(0)}%, new mural ${(crew.fresh * 100).toFixed(0)}%, ` +
          `work at ${crew.edge.toFixed(1)} of ${wall.ub.toFixed(1)} m (corner ${wall.uCorner.toFixed(1)}), painters at ${crew.at.map((u) => u.toFixed(1)).join(', ')}`,
      );
      for (const u of crew.at) expect(Math.abs(u - crew.edge)).toBeLessThan(1.5);
      const mesh = layer.crewMeshes()[i];
      expect(mesh?.paint.visible).toBe(true);
      expect(mesh?.crew.visible).toBe(true);
      expect(mesh?.paint.geometry.drawRange.count).toBe(paintDrawCount(wall, crew.primer, crew.fresh));
      if (i === 0) {
        // The far end primed up to the thumbs-up, the face by the corner still showing.
        expect(crew.primer).toBeGreaterThan(0.3);
        expect(crew.primer).toBeLessThan(0.6);
        expect(crew.edge).toBeGreaterThan(wall.uFace + 5.5);
      } else {
        expect(crew.primer).toBe(1);
        expect(crew.fresh).toBeGreaterThan(0);
      }
    }
    print(`[examined] ${report.join('; ')}`);
    // Far from both walls, neither the paint nor the crew is drawn.
    layer.update(1e5, 1e5, 1 / 60, 0.5);
    for (const m of layer.crewMeshes()) {
      expect(m.paint.visible).toBe(false);
      expect(m.crew.visible).toBe(false);
    }
    layer.dispose();
  });

  it("the crew's clock is the leading racer's share of the route, cops and traffic not counted", () => {
    const rider = (progress: number, more: Partial<EntitySnapshot> = {}) =>
      ({ kind: 'rider', faction: 'rider', progress, finished: false, ...more }) as EntitySnapshot;
    const snap = (entities: EntitySnapshot[], over = false) =>
      ({ race: { over, routeLength: 2000, finishOrder: [] }, entities }) as unknown as SimSnapshot;
    expect(raceShare(null)).toBe(0);
    expect(raceShare(snap([rider(500), rider(900)]))).toBeCloseTo(0.45, 6);
    expect(raceShare(snap([rider(500), rider(1900, { faction: 'law' })]))).toBeCloseTo(0.25, 6);
    expect(raceShare(snap([rider(500, { finished: true })]))).toBe(1);
    expect(raceShare(snap([rider(100)], true))).toBe(1);
  });
});

describe('the mural district: its cost on the phone', () => {
  it('along the whole route: a handful of meshes and a bounded triangle count in range', () => {
    const layer = new MissionLayer(undefined, createFlatLook(), { road, dressing, seed: 1 });
    let maxMeshes = 0;
    let maxTris = 0;
    let views = 0;
    for (const e of road.edges)
      for (let s = 10; s < e.length - 10; s += 25) {
        const p = road.toWorld(e.index, s, 0, 0);
        // Let the stretches stream in as a rider's camera would (one built per frame).
        for (let f = 0; f < 8; f++) layer.update(p.x, p.z, 1 / 60, 0.5);
        const c = layer.counts();
        maxMeshes = Math.max(maxMeshes, c.meshes);
        maxTris = Math.max(maxTris, c.triangles);
        views++;
      }
    const all = [...layer.plan.soups.values()].reduce((a, s) => a + s.pos.length / 9, 0);
    print(
      `[examined] ${views} views: at most ${maxMeshes} meshes and ${maxTris} triangles in range (before frustum culling); ` +
        `${layer.plan.stretches.length} stretches, ${Math.round(all)} static triangles in all`,
    );
    expect(views).toBeGreaterThan(100);
    expect(maxMeshes).toBeLessThanOrEqual(14);
    expect(maxTris).toBeLessThanOrEqual(50_000);
    layer.dispose();
  });
});
