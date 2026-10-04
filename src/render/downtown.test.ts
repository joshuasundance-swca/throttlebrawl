// San Francisco's downtown (run W-R; interview, 2026-10-02: "SF first = downtown towers": a four-lane
// avenue between invented AI-startup towers, intersections with cross traffic, cable cars ONLY on the
// steep cable-line cross streets). The checks plan the real baked network with the real kit GLBs and
// look at what stands where: the towers' fronts on the sim's hard edge, a near-continuous frontage
// broken only by the cross streets, the screens and the headquarters, a signal reaching over the lanes
// at every crossing, nothing on the road or in a sign's or a lot's way, and cable cars on the two
// cable-car streets and nowhere else. The cross traffic is presentation only, so the key check is the
// gate: ridden by a rider at full speed down the whole avenue, no cross vehicle is ever on the avenue
// near anyone, and the traffic still crosses and queues.
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  createRouteProgress,
  resolveVerge,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
  type RoadNetwork,
} from '../road';
import {
  crossingClear,
  crossingNeed,
  DT,
  DowntownLayer,
  planDowntown,
  seedCrossTraffic,
  SIDEWALK_M,
  stepCrossTraffic,
  type Crossing,
} from './downtown';
import { readGlb } from './glb';
import { createFlatLook } from './look';
import { bakeModel, MODEL_ASSETS, modelKindsFor, type ModelKind, type SceneryModel } from './models';
import { networkTags, type RoadDressing } from './road-mesh';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<BakedRoute>('../../packs/region-sf/regions/san-francisco/routes/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing; roads: BakedRoad[] } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing, roads };
}

async function readRepoFile(rel: string): Promise<ArrayBuffer> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const buf = fs.readFileSync(rel);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
async function model(kind: ModelKind): Promise<SceneryModel> {
  return bakeModel(kind, readGlb(await readRepoFile(`packs/base/assets/${MODEL_ASSETS[kind]}.glb`)));
}

const KIT = await model('sfDowntown');
const PROPS = await model('sfRoadside');
const CABLE = await model('cableCar');
const dt = track('sf-downtown');
const plan = planDowntown({ road: dt.road, dressing: dt.dressing, seed: 7 });
const byRule = (rule: string) => plan.items.filter((i) => i.rule === rule);
const roadOf = (edge: number) => dt.roads.find((r) => r.id === dt.road.edges[edge]?.id) as BakedRoad;

describe('San Francisco downtown: what stands along the avenue', () => {
  it('loads its own kit (twelve variants), the city kit and the cable car, and only on the downtown', () => {
    expect(KIT.variants.length).toBe(12);
    const needs = (id: string) => {
      const { road, dressing } = track(id);
      const { tropical, tags } = networkTags(road, dressing);
      return modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
    };
    expect(needs('sf-downtown')).toEqual(expect.arrayContaining(['sfDowntown', 'sfRoadside', 'cableCar']));
    for (const other of ['sf-hills', 'osm-sf-twin-peaks', 'pnw-c1', 'keys-m1'])
      expect(needs(other), other).not.toContain('sfDowntown');
  });

  it("stands the front row of towers on the sim's hard edge, a near-continuous frontage between the cross streets", () => {
    const towers = byRule('tower');
    expect(towers.length).toBeGreaterThan(200);
    let covered = 0;
    let frontage = 0;
    for (const t of towers) {
      const r = roadOf(t.edge);
      const side = t.d < 0 ? 'left' : 'right';
      const v = resolveVerge(r, r.laneSections[0]!, side, t.s);
      // The tower's front is the sidewalk's outer edge, where the sim's verge ends in a wall.
      expect(v.edge, `${r.id} s ${t.s}`).toBe('hard');
      expect(Math.abs(Math.abs(t.d) - Math.abs(v.dOuter)), `${r.id} s ${t.s}`).toBeLessThan(0.05);
    }
    // Frontage: every 2 m of a downtown side, within a tower's lot.
    const lots = towers.map((t) => ({ edge: t.edge, side: Math.sign(t.d), s0: t.s - 12, s1: t.s + 12 }));
    for (const e of dt.road.edges) {
      for (const side of [-1, 1]) {
        for (let s = 0; s < e.length; s += 2) {
          const tags = e.tags.filter(
            (t) => s >= t.s0 && s <= t.s1 && (t.side === 'both' || t.side === (side < 0 ? 'left' : 'right')),
          );
          if (!tags.some((t) => t.tag === 'towers') || tags.some((t) => t.tag !== 'towers')) continue;
          frontage++;
          if (lots.some((l) => l.edge === e.index && l.side === side && s >= l.s0 && s <= l.s1)) covered++;
        }
      }
    }
    print(
      `[examined] ${towers.length} front-row towers over ${frontage * 2} m of tower sides: ${((100 * covered) / frontage).toFixed(1)} % covered`,
    );
    expect(covered / frontage).toBeGreaterThan(0.85);
    // A taller second row behind, and towers behind the plazas.
    expect(byRule('back-tower').length).toBeGreaterThan(50);
    expect(byRule('plaza-tower').length).toBeGreaterThan(5);
  });

  it('keeps every cross street open: no tower in it, its own buildings lining it', () => {
    for (const t of byRule('tower')) {
      for (const c of plan.crossings.filter((x) => x.edge === t.edge)) {
        const width =
          t.variant === DT.towerStone
            ? 24
            : t.variant === DT.towerCrown
              ? 18
              : t.variant === DT.midrise
                ? 20
                : 22;
        const overlap = Math.min(t.s + width / 2, c.s + c.half) - Math.max(t.s - width / 2, c.s - c.half);
        expect(overlap, `tower at ${t.s} vs cross street at ${c.s}`).toBeLessThanOrEqual(0);
      }
    }
    expect(plan.crossings.length).toBe(15);
    const lining = byRule('cross-building');
    expect(lining.length).toBeGreaterThan(plan.crossings.length * 12);
  });

  it('has its giant screens, one deadpan headquarters at the finish, and a plaza with its orb', () => {
    const variants = new Set(byRule('tower').map((t) => t.variant));
    expect(variants).toContain(DT.screenAgi);
    expect(variants).toContain(DT.screenSeries);
    const hq = byRule('hq');
    expect(hq.length).toBe(1);
    // On the avenue's last road, the route's finish road (the road list ends with the Plaza Cut's own
    // roads since playtest 3, T5.2, so it is not the last edge).
    const route = Object.values(routeFiles).find((r) => r.id === 'sf-downtown-run')!;
    const last = dt.road.edges[createRouteProgress(dt.road, route).finish.edge]!;
    expect(hq[0]!.edge).toBe(last.index);
    // Within the last 100 m before the finish (40 m short of the end).
    expect(last.length - hq[0]!.s).toBeLessThan(140);
    expect(byRule('orb').length).toBeGreaterThanOrEqual(2);
    expect(byRule('bench').length).toBeGreaterThan(10);
  });

  it('puts a signal on the far corner each way at every crossing, its arm over the lanes', () => {
    const signals = byRule('signal');
    expect(signals.length).toBe(2 * plan.crossings.length);
    for (const s of signals) {
      const c = dt.road.toWorld(s.edge, Math.max(0, Math.min(dt.road.edges[s.edge]!.length, s.s)), 0, 0);
      // The model's arm runs 9 m along its -X: (-cos t, sin t) in x, z.
      const tip = { x: s.p.x - 9 * Math.cos(s.turn), z: s.p.z + 9 * Math.sin(s.turn) };
      expect(Math.hypot(tip.x - c.x, tip.z - c.z)).toBeLessThan(Math.hypot(s.p.x - c.x, s.p.z - c.z) - 8);
    }
  });

  it('stands nothing on the road, and nothing small in a sign, a lot or a walkers zone', () => {
    let checked = 0;
    for (const it of plan.items) {
      const e = dt.road.edges[it.edge]!;
      if (it.rule === 'cross-building') continue;
      expect(Math.abs(it.d), `${it.rule} at ${it.s}`).toBeGreaterThanOrEqual(Math.max(-e.dMin, e.dMax) + 0.5);
      checked++;
    }
    const small = new Set([
      'lamp',
      'planter',
      'hydrant',
      'scooter',
      'board',
      'bench',
      'plaza-planter',
      'orb',
    ]);
    for (const it of plan.items.filter((i) => small.has(i.rule))) {
      const r = roadOf(it.edge);
      for (const f of (r.features ?? []).filter((x) =>
        ['billboard', 'roadsideZone', 'copSpawn'].includes(x.kind),
      )) {
        const inS = it.s >= Math.min(f.s0, f.s1) - 1 && it.s <= Math.max(f.s0, f.s1) + 1;
        const inD = it.d >= Math.min(f.d0, f.d1) - 1 && it.d <= Math.max(f.d0, f.d1) + 1;
        expect(inS && inD, `${it.rule} at ${r.id} s ${it.s} d ${it.d} in ${f.id}`).toBe(false);
      }
    }
    print(`[examined] ${checked} downtown items off the road; ${plan.items.length} items in all`);
  });

  it('is the same for the same seed and differs for another', () => {
    const again = planDowntown({ road: dt.road, dressing: dt.dressing, seed: 7 });
    expect(again.items.map((i) => [i.variant, i.p.x, i.sy])).toEqual(
      plan.items.map((i) => [i.variant, i.p.x, i.sy]),
    );
    const other = planDowntown({ road: dt.road, dressing: dt.dressing, seed: 8 });
    expect(other.items.map((i) => i.variant)).not.toEqual(plan.items.map((i) => i.variant));
  });
});

describe('San Francisco downtown: cross traffic and cable cars', () => {
  it('runs cable cars only on the two cable-car streets, one each', () => {
    const vehicles = seedCrossTraffic(plan.crossings, 7);
    const cable = vehicles.filter((v) => v.kind === 'cable');
    const cableStreets = plan.crossings.flatMap((c, i) => (c.cable ? [i] : []));
    expect(cableStreets.length).toBe(2);
    expect(cable.map((v) => v.crossing).sort()).toEqual(cableStreets);
    for (const c of plan.crossings.filter((x) => x.cable))
      expect(dt.road.edges[c.edge]?.id).toBe('sf-dt-cable-crossing');
  });

  it('never has a cross vehicle on the avenue near anyone, and still crosses and queues (a rider flat out, the whole avenue)', () => {
    const vehicles = seedCrossTraffic(plan.crossings, 7);
    const crossings: readonly Crossing[] = plan.crossings;
    const step = 1 / 60;
    const speed = 50;
    const total = dt.road.edges.reduce((n, e) => n + e.length, 0);
    let closest = Infinity;
    let crossed = 0;
    let maxWaiting = 0;
    const waitingToCross = new Set<number>();
    for (let t = 0; t * speed < total; t += step) {
      // The rider's world point: down the avenue's edges in order, in the right lane.
      let s = t * speed;
      let edge = 0;
      while (edge < dt.road.edges.length - 1 && s > (dt.road.edges[edge]?.length ?? 0)) {
        s -= dt.road.edges[edge]?.length ?? 0;
        edge++;
      }
      const rider = dt.road.toWorld(edge, s, 2, 0);
      const clear = crossings.map((c) => crossingClear(c, [rider]));
      maxWaiting = Math.max(maxWaiting, stepCrossTraffic(vehicles, crossings, clear, step));
      vehicles.forEach((v, i) => {
        const c = crossings[v.crossing]!;
        // On the avenue: its nose (half a car, 2.2 m) inside the verge's outer edge.
        const inBox = Math.abs(v.u) < c.outer + 2.2;
        const along = v.u * v.dir;
        if (along < -c.outer) waitingToCross.add(i);
        else if (along > c.outer && waitingToCross.delete(i)) crossed++;
        if (!inBox) return;
        const x = c.centre.x + c.across.x * v.u + c.along.x * v.v;
        const z = c.centre.z + c.across.z * v.u + c.along.z * v.v;
        closest = Math.min(closest, Math.hypot(x - rider.x, z - rider.z));
      });
    }
    print(
      `[examined] ${vehicles.length} cross vehicles over a ${(total / 1000).toFixed(2)} km ride at ${speed} m/s: ` +
        `${crossed} crossings of the avenue, up to ${maxWaiting} waiting, closest on the avenue to the rider ${closest.toFixed(0)} m`,
    );
    expect(closest).toBeGreaterThan(50);
    expect(crossed).toBeGreaterThan(20);
    expect(maxWaiting).toBeGreaterThan(0);
  });

  it('the gate measures the nearest mover either way, and a slow cable car needs more room than a car', () => {
    const c = plan.crossings[0]!;
    expect(crossingClear(c, [])).toBe(Infinity);
    expect(
      crossingClear(c, [
        { x: c.centre.x + 150, z: c.centre.z },
        { x: c.centre.x, z: c.centre.z - 90 },
      ]),
    ).toBeCloseTo(90, 5);
    const car = crossingNeed(c, 9);
    const cable = crossingNeed(c, 4.5);
    print(`[examined] clearance: a car needs ${car.toFixed(0)} m, a cable car ${cable.toFixed(0)} m`);
    expect(car).toBeGreaterThan(200);
    expect(cable).toBeGreaterThan(car * 1.6);
  });
});

describe('San Francisco downtown: the layer as drawn', () => {
  it('draws stretches near the camera in a few meshes, inside the phone budget, the cross traffic instanced', () => {
    const layer = new DowntownLayer(KIT, PROPS, CABLE, look, {
      road: dt.road,
      dressing: dt.dressing,
      seed: 7,
    });
    let maxTris = 0;
    let maxMeshes = 0;
    for (let s = 0; s < 3600; s += 100) {
      let edge = 0;
      let u = s;
      while (edge < dt.road.edges.length - 1 && u > (dt.road.edges[edge]?.length ?? 0)) {
        u -= dt.road.edges[edge]?.length ?? 0;
        edge++;
      }
      const cam = dt.road.toWorld(edge, u, 0, 0);
      for (let k = 0; k < 12; k++) layer.update(cam.x, cam.z, 1 / 60, [cam]);
      const c = layer.counts();
      maxTris = Math.max(maxTris, c.triangles);
      maxMeshes = Math.max(maxMeshes, c.meshes);
    }
    const c = layer.counts();
    print(
      `[examined] downtown layer along the route: ${c.stretches} stretches, up to ${maxMeshes} meshes and ${maxTris} triangles in range; ${c.vehicles} cross vehicles, ${c.cableStreets} cable streets`,
    );
    // The whole frame's budget is 120 draws and 150k triangles (tests/perf/budget.json); the downtown
    // takes a share of it (frustum culling halves what is drawn again).
    expect(maxMeshes).toBeLessThanOrEqual(20);
    expect(maxTris).toBeLessThan(60_000);
    expect(c.vehicles).toBeGreaterThan(40);
    const names: string[] = [];
    layer.group.traverse((o) => names.push(o.name));
    expect(names).toContain('road-downtown-cable-cars');
    expect(names).toContain('road-downtown-cross-traffic');
    layer.dispose();
    expect(layer.group.parent).toBeNull();
  });
});

// Kept for the tower width table above (towers' lots are the kit's footprints).
void SIDEWALK_M;
