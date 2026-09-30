import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  createRouteProgress,
  curvedRoadRates,
  fixtureBranchNetwork,
  lintRoadNetwork,
  readConnector,
  type BakedFeature,
  type CurvedRates,
  type RoadNetwork,
  type RoadPos,
} from './index';

// M1 road-2: one junction pair and the ramp shortcut. The fixture is a small track compiled by the
// real compiler: main a > c-split > b (an S-bend) > c-merge > d, and the straight shortcut
// c-in > cut > c-out that splits off the end of a (right edge, d 2.4–4.9) and rejoins d.

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

const fixture = () => {
  const f = fixtureBranchNetwork();
  const net = createRoadNetwork(f);
  const route = createRouteProgress(net, f.route);
  return { f, net, route, e: (id: string) => net.edgeIndex(id) };
};

/**
 * Rides a mover forward at `speed` holding lateral offset `d` until `until` says stop, stepping
 * with the curved-road kinematics (yaw 0). Returns every position (copies) and the world step
 * lengths, so tests can check the path, the progress and the distance covered.
 */
function ride(
  net: RoadNetwork,
  start: RoadPos,
  speed: number,
  dt: number,
  steps: number,
  steerD?: (p: RoadPos) => number,
) {
  const pos = { ...start };
  const out: RoadPos[] = [{ ...pos }];
  const ground: number[] = [];
  const r: CurvedRates = { ds: 0, dd: 0, yawDrift: 0 };
  let prev = net.toWorld(pos.edge, pos.s, pos.d, 0);
  for (let i = 0; i < steps; i++) {
    if (steerD) pos.d = steerD(pos);
    curvedRoadRates(net.kappaAt(pos.edge, pos.s), pos.d, pos.dir, speed, 0, r);
    pos.s += r.ds * dt;
    if (net.advance(pos) === 'deadEnd') break;
    const w = net.toWorld(pos.edge, pos.s, pos.d, 0);
    ground.push(Math.hypot(w.x - prev.x, w.z - prev.z));
    prev = w;
    out.push({ ...pos });
  }
  return { path: out, ground };
}

const edgesOf = (path: readonly RoadPos[]) => {
  const seq: number[] = [];
  for (const p of path) if (seq[seq.length - 1] !== p.edge) seq.push(p.edge);
  return seq;
};

describe('road-2: the split, the shortcut and the merge', () => {
  it('builds both junctions with connector roads, the split zone and default ways on', () => {
    const { net, e } = fixture();
    expect(net.edges.map((x) => x.id)).toEqual(['a', 'c-split', 'b', 'c-merge', 'd', 'c-in', 'cut', 'c-out']);
    // Out of a's `to` end: the main connector by default, and the shortcut connector by zone.
    const out = net.nextEdges(e('a'), 'to');
    expect(out.map((l) => l.edge)).toEqual([e('c-split'), e('c-in')]);
    expect(net.edges[e('a')]?.next?.edge).toBe(e('c-split'));
    expect(out[1]?.splitZone).toEqual({ s0: 160, s1: 200, d0: 2.4, d1: 4.9 });
    // Into d's `from` end: the main connector is the default way back, the shortcut's is not.
    expect(net.nextEdges(e('d'), 'from').map((l) => l.edge)).toEqual([e('c-merge'), e('c-out')]);
    expect(net.edges[e('d')]?.prev?.edge).toBe(e('c-merge'));
    for (const id of ['c-split', 'c-merge', 'c-in', 'c-out'])
      expect(net.edges[e(id)]?.isConnector, id).toBe(true);
    for (const id of ['a', 'b', 'cut', 'd']) expect(net.edges[e(id)]?.isConnector, id).toBe(false);
    expect(net.splitZones()).toEqual([
      {
        s0: 160,
        s1: 200,
        d0: 2.4,
        d1: 4.9,
        edge: e('a'),
        end: 'to',
        toEdge: e('c-in'),
        connector: 'cx-c-in',
      },
    ]);
  });

  it('writes the lane table for both directions: oncoming (L1) rows as well as driving ones', () => {
    const { f } = fixture();
    const rows = f.network.junctions.flatMap((j) => j.connectors.map((c) => readConnector(c)));
    expect(rows.every((r) => r !== null)).toBe(true);
    const ids = rows.map(
      (r) => `${r?.id}: ${r?.from.road}.${r?.from.lane} > ${r?.road} > ${r?.to.road}.${r?.to.lane}`,
    );
    expect(ids).toEqual([
      'cx-c-split-l1: a.L1 > c-split > b.L1',
      'cx-c-split-r1: a.R1 > c-split > b.R1',
      'cx-c-in: a.R1 > c-in > cut.S1',
      'cx-c-merge-l1: b.L1 > c-merge > d.L1',
      'cx-c-merge-r1: b.R1 > c-merge > d.R1',
      'cx-c-out: cut.S1 > c-out > d.R1',
    ]);
  });

  it('passes the road lint, with the jump lint finding the ramp on straight road', () => {
    const { f } = fixture();
    expect(lintRoadNetwork({ network: f.network, roads: f.roads, routes: [f.route] })).toEqual([]);
    const cut = f.roads.find((r) => r.id === 'cut');
    expect(cut?.features?.map((x) => x.kind)).toEqual(['ramp']);
  });

  it('a mover inside the split zone takes the connector; one outside it stays on the main road', () => {
    const { net, e } = fixture();
    for (const [d, want] of [
      [3.6, 'c-in'],
      [2.45, 'c-in'],
      [4.85, 'c-in'],
      [1.7, 'c-split'], // the travel lane
      [2.3, 'c-split'], // just inside the zone's edge
      [-1.7, 'c-split'], // the oncoming lane, ridden the wrong way
    ] as const) {
      const pos: RoadPos = { edge: e('a'), s: 199, d, dir: 1 };
      pos.s += 3;
      expect(net.advance(pos)).toBe('ok');
      expect(net.edges[pos.edge]?.id, `d ${d}`).toBe(want);
      expect(pos.s).toBeCloseTo(2, 9);
      // The world position holds across the join (the connector starts 3.4 m right of centre).
      const before = net.toWorld(e('a'), 200, d, 0);
      const after = net.toWorld(pos.edge, 0, pos.d, 0);
      expect(Math.hypot(after.x - before.x, after.z - before.z), `d ${d}`).toBeLessThan(0.01);
    }
  });

  it('loses and doubles no distance at a transfer, on either path, at any lateral offset', () => {
    const { net, e } = fixture();
    const dt = 1 / 60;
    for (const [d, via] of [
      [1.7, 'c-split'],
      [3.6, 'c-in'],
      [2.6, 'c-in'],
      [-1.7, 'c-split'],
    ] as const) {
      const { path, ground } = ride(net, { edge: e('a'), s: 120, d, dir: 1 }, 30, dt, 60 * 40);
      const seq = edgesOf(path).map((i) => net.edges[i]?.id);
      expect(seq, `d ${d}`).toContain(via);
      expect(seq[seq.length - 1]).toBe('d');
      // Every tick covers 0.5 m of ground (30 m/s), across both junctions, within 1 cm.
      const worst = Math.max(...ground.map((g) => Math.abs(g - 30 * dt)));
      expect(worst, `d ${d}: ${seq.join('>')}`).toBeLessThan(0.01);
    }
  });

  it('the shortcut is shorter by distance to finish, and says how much it saves', () => {
    const { net, route, e } = fixture();
    const viaMain = route.distanceToFinish(e('c-split'), 0);
    const viaCut = route.distanceToFinish(e('c-in'), 0);
    expect(viaCut).toBeLessThan(viaMain);
    expect(route.distanceToFinish(e('a'), net.edges[e('a')]?.length ?? 0)).toBeCloseTo(viaMain, 9);
    // Both paths agree where they rejoin.
    expect(route.distanceToFinish(e('c-merge'), 30)).toBeCloseTo(route.distanceToFinish(e('d'), 0), 9);
    expect(route.distanceToFinish(e('c-out'), 30)).toBeCloseTo(route.distanceToFinish(e('d'), 0), 9);
    expect(route.shortcuts).toHaveLength(1);
    expect(route.shortcuts[0]?.gainM).toBeCloseTo(viaMain - viaCut, 9);
    expect(route.shortcuts[0]?.gainM).toBeGreaterThan(5);
    expect(route.mainEdges).toEqual([e('a'), e('c-split'), e('b'), e('c-merge'), e('d')]);
    for (const id of ['c-in', 'cut', 'c-out']) expect(route.allows(e(id))).toBe(true);
    console.log(
      `fixture: main ${viaMain.toFixed(1)} m, shortcut ${viaCut.toFixed(1)} m from the split; saves ${route.shortcuts[0]?.gainM.toFixed(1)} m`,
    );
  });

  it('race progress never decreases along either path', () => {
    const { net, route, e } = fixture();
    for (const d of [1.7, 3.6]) {
      const { path } = ride(net, { edge: e('a'), s: 20, d, dir: 1 }, 30, 1 / 60, 60 * 40);
      let prev = -Infinity;
      let steps = 0;
      for (const p of path) {
        const g = route.progressAt(p.edge, p.s);
        expect(g, `d ${d} on ${net.edges[p.edge]?.id} at ${p.s}`).toBeGreaterThanOrEqual(prev);
        expect(Number.isFinite(g)).toBe(true);
        prev = g;
        steps++;
      }
      expect(steps).toBeGreaterThan(1000);
      expect(prev).toBeGreaterThan(route.length); // rode past the finish
    }
  });

  it('maps neighbours across the split, d included', () => {
    const { net, e } = fixture();
    const near = net.neighbours(e('a'), 195, 10);
    const conn = near.find((n) => n.edge === e('c-in'));
    expect(conn).toBeDefined();
    // A point 1 m into the connector at its centre is 201 m along a, 3.4 m right of a's centre.
    expect((conn?.sOffset ?? 0) + (conn?.sSign ?? 1) * 1).toBeCloseTo(201, 9);
    expect((conn?.sSign ?? 1) * 0 + (conn?.dOffset ?? 0)).toBeCloseTo(3.4, 1);
    const main = near.find((n) => n.edge === e('c-split'));
    expect(main?.dOffset).toBe(0);
    // project() finds the shortcut connector from the main road's hint.
    const w = net.toWorld(e('c-in'), 25, 0, 0);
    const p = net.project(w.x, w.z, e('a'));
    expect(net.edges[p.edge]?.id).toMatch(/^c-in$|^c-split$/);
  });
});

// Playtest 1b ([decided] 2026-09-30, "you get forced away like it's a barrier"): past the split the
// main connector and the shortcut's connector are drawn overlapping, but each edge walls its own
// riders in. handover() is the rider-only way across: a rider past its own edge's drivable band,
// whose world point lies inside a sibling branch's band, moves onto that sibling with its world
// position and heading kept. advance() never does it, so traffic stays off shortcut edges.
describe('playtest 1b: the rider-only handover between overlapping branches', () => {
  /** A rider's drivable half-width margin (the riders lane's BIKE_HALF_WIDTH_M). */
  const MARGIN = 0.5;

  it('moves a rider past c-split’s right edge onto c-in, world position unchanged within 1e-6', () => {
    const { net, e } = fixture();
    for (const [s, d] of [
      [2, 4.5],
      [8, 4.6],
      [15, 4.45],
    ] as const) {
      const pos: RoadPos = { edge: e('c-split'), s, d, dir: 1 };
      const before = net.toWorld(pos.edge, pos.s, pos.d, 0);
      const delta = net.handover(pos, MARGIN);
      expect(net.edges[pos.edge]?.id, `s ${s} d ${d}`).toBe('c-in');
      expect(delta).not.toBeNull();
      expect(Math.abs(delta ?? 1)).toBeLessThan(0.3); // a few degrees: the branches diverge gently
      expect(pos.dir).toBe(1);
      const after = net.toWorld(pos.edge, pos.s, pos.d, 0);
      expect(Math.hypot(after.x - before.x, after.z - before.z), `s ${s} d ${d}`).toBeLessThan(1e-6);
      // Inside the sibling's band, less the margin: no barrier waits on the far side.
      expect(pos.d).toBeGreaterThan(-2.5 + MARGIN);
      expect(pos.d).toBeLessThan(2.5 - MARGIN);
    }
  });

  it('keeps the heading: the world direction of travel is the same after the handover', () => {
    const { net, e } = fixture();
    const pos: RoadPos = { edge: e('c-split'), s: 12, d: 4.55, dir: 1 };
    const yaw = 0.2;
    const heading = (p: RoadPos, y: number) => {
      const f = net.frameAt(p.edge, p.s);
      // velocity ∝ dir · (cos(yaw)·T + sin(yaw)·R), R = (−tz, tx)
      return {
        x: p.dir * (Math.cos(y) * f.tx - Math.sin(y) * f.tz),
        z: p.dir * (Math.cos(y) * f.tz + Math.sin(y) * f.tx),
      };
    };
    const h0 = heading(pos, yaw);
    const delta = net.handover(pos, MARGIN) ?? NaN;
    const h1 = heading(pos, yaw + delta);
    expect(net.edges[pos.edge]?.id).toBe('c-in');
    expect(Math.hypot(h1.x - h0.x, h1.z - h0.z)).toBeLessThan(1e-3);
  });

  it('works back the other way: off c-in’s left edge onto c-split', () => {
    const { net, e } = fixture();
    const pos: RoadPos = { edge: e('c-in'), s: 6, d: -2.1, dir: 1 };
    const before = net.toWorld(pos.edge, pos.s, pos.d, 0);
    expect(net.handover(pos, MARGIN)).not.toBeNull();
    expect(net.edges[pos.edge]?.id).toBe('c-split');
    const after = net.toWorld(pos.edge, pos.s, pos.d, 0);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(1e-6);
  });

  it('leaves a rider inside its own band, or far from any sibling, where it is (the wall stays)', () => {
    const { net, e } = fixture();
    const inside: RoadPos = { edge: e('c-split'), s: 5, d: 3.9, dir: 1 };
    expect(net.handover(inside, MARGIN)).toBeNull();
    expect(inside).toEqual({ edge: e('c-split'), s: 5, d: 3.9, dir: 1 });
    // Far down the S-bend the shortcut is well away: past the edge is past the edge.
    const far: RoadPos = { edge: e('b'), s: 120, d: 4.6, dir: 1 };
    expect(net.handover(far, MARGIN)).toBeNull();
    expect(far.edge).toBe(e('b'));
    // The oncoming side of the main road has no sibling at all.
    const left: RoadPos = { edge: e('c-split'), s: 5, d: -4.6, dir: 1 };
    expect(net.handover(left, MARGIN)).toBeNull();
    // [default] Splits only: at the merge both roads lead into d a few metres on.
    const merge: RoadPos = { edge: e('c-out'), s: 25, d: -2.1, dir: 1 };
    expect(net.handover(merge, MARGIN)).toBeNull();
    expect(merge.edge).toBe(e('c-out'));
  });

  it('only onto an allowed edge, when the caller says which are allowed', () => {
    const { net, e } = fixture();
    const pos: RoadPos = { edge: e('c-split'), s: 5, d: 4.6, dir: 1 };
    expect(net.handover(pos, MARGIN, (edge) => edge !== e('c-in'))).toBeNull();
    expect(pos.edge).toBe(e('c-split'));
  });

  it('advance() never hands over: traffic past the edge stays on its own road', () => {
    const { net, e } = fixture();
    const pos: RoadPos = { edge: e('c-split'), s: 5, d: 4.6, dir: 1 };
    expect(net.advance(pos)).toBe('ok');
    expect(pos.edge).toBe(e('c-split'));
  });

  it('says which side a sibling branch lies on, in the split zone and along the overlap', () => {
    const { net, e } = fixture();
    expect(net.branchSideAt(e('a'), 180)).toBe(1); // the split zone, right edge
    expect(net.branchSideAt(e('a'), 100)).toBe(0); // before it
    expect(net.branchSideAt(e('c-split'), 5)).toBe(1);
    expect(net.branchSideAt(e('c-in'), 5)).toBe(-1);
    expect(net.branchSideAt(e('b'), 150)).toBe(0);
  });
});

describe('road-2: the lint rules for junctions, connectors and jumps', () => {
  const bundle = () => fixtureBranchNetwork() as Mutable<ReturnType<typeof fixtureBranchNetwork>>;
  const rules = (b: ReturnType<typeof bundle>) =>
    lintRoadNetwork({ network: b.network, roads: b.roads, routes: [b.route] }).map(
      (i) => `${i.rule} ${i.pointer}`,
    );

  it('jump: fails a ramp placed on a bend, and passes the same ramp on the straight shortcut', () => {
    const bend = fixtureBranchNetwork({ rampOn: 'bend' });
    const issues = lintRoadNetwork({ network: bend.network, roads: bend.roads });
    const jump = issues.filter((i) => i.rule === 'jump');
    expect(jump).toHaveLength(1);
    expect(jump[0]?.file).toBe('road:b');
    expect(jump[0]?.message).toContain('kicker sits on a bend');
    expect(issues.filter((i) => i.rule !== 'jump')).toEqual([]);
    const straight = fixtureBranchNetwork();
    expect(
      lintRoadNetwork({ network: straight.network, roads: straight.roads }).filter((i) => i.rule === 'jump'),
    ).toEqual([]);
  });

  it('jump: a ramp truck on a bend fails; on the straight shortcut it passes (playtest 1b)', () => {
    const truck: BakedFeature = { kind: 'rampTruck', id: 'carrier', s0: 20, s1: 42, d0: 0.5, d1: 2.5 };
    const b = bundle();
    (b.roads.find((r) => r.id === 'b')?.features as BakedFeature[]).push({ ...truck });
    expect(rules(b)).toContain('jump /features/0');
    const ok = bundle();
    (ok.roads.find((r) => r.id === 'cut')?.features as BakedFeature[]).push({ ...truck });
    expect(rules(ok).filter((r) => r.startsWith('jump'))).toEqual([]);
  });

  it('jump: a gap on a bend fails too', () => {
    const b = bundle();
    const road = b.roads.find((r) => r.id === 'b');
    (road?.features as BakedFeature[]).push({
      kind: 'gap',
      id: 'washout',
      s0: 60,
      s1: 70,
      d0: -4.9,
      d1: 4.9,
    });
    expect(rules(b)).toContain('jump /features/0');
  });

  it('connectors: fails a connector moved off the road end it joins', () => {
    const b = bundle();
    const c = b.roads.find((r) => r.id === 'c-in');
    const xs = c?.samples.data['x'] as number[];
    for (let i = 0; i < xs.length; i++) xs[i] = (xs[i] as number) + 3; // 3 m east: along-road miss
    expect(rules(b).some((r) => r.startsWith('junction-ends /junctions/1/connectors/2/from'))).toBe(true);
  });

  it('connectors: fails a split zone that stops short of the road end, and a malformed row', () => {
    const b = bundle();
    const row = b.network.junctions[1]?.connectors[2] as { splitZone: { s1: number } };
    row.splitZone.s1 = 150;
    expect(rules(b)).toContain('connectors /junctions/1/connectors/2/splitZone');
    const b2 = bundle();
    (b2.network.junctions[1]?.connectors as unknown[])[2] = { id: 'broken', road: 'c-in' };
    expect(rules(b2)).toContain('connectors /junctions/1/connectors/2');
  });

  it('connectors: fails a drive lane on a connector into a shortcut, so traffic can never take it', () => {
    const b = bundle();
    const c = b.roads.find((r) => r.id === 'c-in');
    const lanes = c?.laneSections[0]?.lanes as { kind: string }[];
    (lanes[0] as { kind: string }).kind = 'drive';
    expect(rules(b)).toContain('connectors /junctions/1/connectors/2/road');
  });

  it('connectors: fails a connector road listed in junction ends, or spanning two junctions', () => {
    const b = bundle();
    b.network.junctions[1]?.ends.push({ road: 'c-in', end: 'from' });
    expect(rules(b).some((r) => r.startsWith('connectors /junctions'))).toBe(true);
    const b2 = bundle();
    const c = b2.roads.find((r) => r.id === 'c-in');
    if (c) c.to = b2.network.junctions[2]?.id ?? '';
    expect(rules(b2)).toContain('connectors /from');
  });

  it('route: fails a main path whose connector is not an allowed road', () => {
    const b = bundle();
    b.route.allowedRoads = b.route.allowedRoads.filter((r) => r !== 'c-split');
    expect(rules(b)).toContain('route /mainPath/1');
  });

  it('junction-ends: an end listed at a connector junction must lie within its radius', () => {
    const b = bundle();
    const j = b.network.junctions[1];
    if (j) j.x += 100;
    expect(rules(b).filter((r) => r.startsWith('junction-ends')).length).toBeGreaterThan(0);
  });
});
