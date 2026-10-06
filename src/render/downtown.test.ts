// San Francisco's downtown (run W-R; interview, 2026-10-02: "SF first = downtown towers": a four-lane
// avenue between invented AI-startup towers, intersections with cross traffic, cable cars ONLY on the
// steep cable-line cross streets). The checks plan the real baked network with the real kit GLBs and
// look at what stands where: the towers' fronts on the sim's hard edge, a near-continuous frontage
// broken only by the cross streets, the screens and the headquarters, a signal reaching over the lanes
// at every crossing, nothing on the road or in a sign's or a lot's way, and cable cars on the two
// cable-car streets and nowhere else. The cross traffic is presentation only, so the key check is the
// gate: ridden by a rider at full speed down the whole avenue, no cross vehicle is ever on the avenue
// near anyone, and the traffic still crosses and queues.
import { InstancedMesh, Mesh, type BufferGeometry } from 'three';
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
  DOWNTOWN_DRAW_M,
  DT,
  DowntownLayer,
  MODULE_M,
  planDowntown,
  seedCrossTraffic,
  SIDEWALK_M,
  stepCrossTraffic,
  towerFootprint,
  type Crossing,
} from './downtown';
import { withAtlas } from './atlas';
import { readGlb } from './glb';
import { createFlatLook } from './look';
import { bakeRepoModel, readAsset, readAtlas } from './model-files.test-util';
import { bakeModel, MODEL_ASSETS, modelKindsFor } from './models';
import { ATLAS_WHITE_UV } from './scenery-merge';
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

const KIT = await bakeRepoModel('sfDowntown');
const PROPS = await bakeRepoModel('sfRoadside');
const CABLE = await bakeRepoModel('cableCar');
// CX3's stackable towers, with the San Francisco atlas (playtest 3, T12.4).
const MODULES = await bakeRepoModel('sfTowerModules');
const dt = track('sf-downtown');
// The shipping plan stacks the modules; `plain` is the fallback (no modules loaded): the old kit, stretched.
const plan = planDowntown({ road: dt.road, dressing: dt.dressing, seed: 7, stacked: true });
const plain = planDowntown({ road: dt.road, dressing: dt.dressing, seed: 7 });
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
    expect(needs('sf-downtown')).toEqual(
      expect.arrayContaining(['sfDowntown', 'sfTowerModules', 'sfRoadside', 'cableCar']),
    );
    for (const other of ['sf-hills', 'osm-sf-twin-peaks', 'pnw-c1', 'keys-m1']) {
      expect(needs(other), other).not.toContain('sfDowntown');
      expect(needs(other), other).not.toContain('sfTowerModules');
    }
  });

  it("stands the front row of towers on the sim's hard edge, a near-continuous frontage between the cross streets", () => {
    const towers = byRule('tower');
    expect(towers.length).toBeGreaterThan(100);
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
    const lots = towers.map((t) => {
      const half = towerFootprint(t.variant, true)[0] / 2;
      return { edge: t.edge, side: Math.sign(t.d), s0: t.s - half, s1: t.s + half };
    });
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
    // (The stretched kit covered 85.2 % of it. The modules' lots are 24 to 34 m wide, so a run's last
    // gap can be up to a lot wide: 84.7 %. A frontage broken by more than a fifth would not be one.)
    expect(covered / frontage).toBeGreaterThan(0.8);
    // A taller second row behind, and towers behind the plazas.
    expect(byRule('back-tower').length).toBeGreaterThan(50);
    expect(byRule('plaza-tower').length).toBeGreaterThan(5);
  });

  it('keeps every cross street open: no tower in it, its own buildings lining it', () => {
    for (const t of byRule('tower')) {
      for (const c of plan.crossings.filter((x) => x.edge === t.edge)) {
        const width = towerFootprint(t.variant, true)[0];
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
    const again = planDowntown({ road: dt.road, dressing: dt.dressing, seed: 7, stacked: true });
    expect(again.items.map((i) => [i.variant, i.p.x, i.sy])).toEqual(
      plan.items.map((i) => [i.variant, i.p.x, i.sy]),
    );
    const other = planDowntown({ road: dt.road, dressing: dt.dressing, seed: 8, stacked: true });
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
    const layer = new DowntownLayer(
      KIT,
      PROPS,
      CABLE,
      look,
      { road: dt.road, dressing: dt.dressing, seed: 7 },
      MODULES,
    );
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

  // Roadmap M5 (playtest 4 run C, punch item 9): a lower quality tier draws the stretches past its
  // share of the draw distance as their models' far stand-ins (quality.ts `cityDetail`); the top tier
  // draws every stretch in full, as before tiers.
  it("a lower tier's far stretches draw their stand-ins: fewer triangles, the same meshes", () => {
    const layer = new DowntownLayer(
      KIT,
      PROPS,
      CABLE,
      look,
      { road: dt.road, dressing: dt.dressing, seed: 7 },
      MODULES,
    );
    const cam = dt.road.toWorld(0, 40, 0, 0);
    const at = (nearM?: number) => {
      for (let k = 0; k < 12; k++) layer.update(cam.x, cam.z, 0, [], nearM);
      return layer.counts();
    };
    const before = at();
    const top = at(DOWNTOWN_DRAW_M);
    const low = at(DOWNTOWN_DRAW_M * 0.3);
    print(
      `[examined] downtown from s 40: ${before.meshes} meshes, ${before.triangles} triangles in full; ` +
        `${top.triangles} at the top tier; ${low.triangles} with stand-ins past ${DOWNTOWN_DRAW_M * 0.3} m`,
    );
    expect(top.triangles).toBe(before.triangles);
    expect(top.meshes).toBe(before.meshes);
    expect(low.meshes).toBe(before.meshes);
    expect(low.triangles).toBeLessThan(before.triangles * 0.95);
    layer.dispose();
  });
});

// Playtest 3 (T12.4): the towers are CX3's stackable modules (a 7 m base, 14 m four-storey mids, an
// 8 m crown), stacked to the height wanted instead of stretched, drawn with the San Francisco atlas as
// their stretch's one material. A facade tile always spans exactly one mid, so a window is never
// stretched.
describe('San Francisco downtown: stacked towers', () => {
  const STACKED_RULES = new Set(['tower', 'plaza-tower', 'back-tower', 'cross-building']);
  const stackedItems = plan.items.filter((i) => i.model === 'tower');
  const STYLES = [DT.towerGlass, DT.towerStone, DT.screenAgi, DT.towerCrown, DT.midrise];

  /** Rides the layer along the route, as the renderer would: the most triangles and meshes in range at once. */
  function ride(layer: DowntownLayer) {
    let tris = 0;
    let meshes = 0;
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
      tris = Math.max(tris, c.triangles);
      meshes = Math.max(meshes, c.meshes);
    }
    return { tris, meshes };
  }
  const stretchMeshes = (layer: DowntownLayer) => {
    const out: Mesh<BufferGeometry>[] = [];
    layer.group.traverse((o) => {
      if (o instanceof Mesh && !(o instanceof InstancedMesh) && o.name === 'road-downtown')
        out.push(o as Mesh<BufferGeometry>);
    });
    return out;
  };
  const input = { road: dt.road, dressing: dt.dressing, seed: 7 };

  it('draws every tower the old way stretched as modules, and keeps the headquarters and the furniture as they were', () => {
    expect(stackedItems.length).toBeGreaterThan(100);
    for (const it of plan.items) {
      if (STACKED_RULES.has(it.rule)) expect(it.model, `${it.rule} at s ${it.s}`).toBe('tower');
      else expect(it.model, it.rule).not.toBe('tower');
    }
    expect(
      plain.items.some((i) => i.model === 'tower'),
      'no modules, no stacked towers',
    ).toBe(false);
    expect(new Set(plain.items.map((i) => i.rule))).toEqual(new Set(plan.items.map((i) => i.rule)));
  });

  it('stacks each tower to its target height within half a mid, in whole modules, never scaled', () => {
    let worst = 0;
    for (const it of stackedItems) {
      expect(it.sy, `${it.rule} at s ${it.s}`).toBe(1);
      expect(Number.isInteger(it.mids)).toBe(true);
      expect(it.mids).toBeGreaterThanOrEqual(1);
      const height = MODULE_M.base + it.mids! * MODULE_M.mid + MODULE_M.crown;
      worst = Math.max(worst, Math.abs(height - it.targetM!));
      expect(Math.abs(height - it.targetM!), `${it.rule} at s ${it.s}`).toBeLessThanOrEqual(
        MODULE_M.mid / 2 + 1e-9,
      );
    }
    const heights = new Set(stackedItems.map((i) => i.mids ?? 0));
    print(
      `[examined] ${stackedItems.length} stacked towers, ${heights.size} distinct heights (${Math.min(...heights)} to ${Math.max(...heights)} mids), worst gap to target ${worst.toFixed(1)} m`,
    );
    // Heights vary: a skyline, not a wall.
    expect(heights.size).toBeGreaterThanOrEqual(5);
  });

  it("lots are the modules' own footprints, and no two towers in a row overlap along the street", () => {
    STYLES.forEach((v, style) => {
      const [w, d] = towerFootprint(v, true);
      for (const [part, h] of [
        [0, MODULE_M.base],
        [1, MODULE_M.mid],
        [2, MODULE_M.crown],
      ] as const) {
        const box = MODULES.variants[style * 3 + part]!.boundingBox!;
        expect(box.max.y - box.min.y, `style ${style} module ${part} height`).toBeCloseTo(h, 1);
        expect(box.max.x - box.min.x, `style ${style} module ${part} width`).toBeLessThanOrEqual(w + 0.01);
      }
      const base = MODULES.variants[style * 3]!.boundingBox!;
      expect(base.max.x - base.min.x, `style ${style} width`).toBeCloseTo(w, 1);
      expect(base.max.z - base.min.z, `style ${style} depth`).toBeCloseTo(d, 1);
    });
    expect(towerFootprint(DT.screenAgi, true)).toEqual(towerFootprint(DT.screenSeries, true));
    const rows = new Map<string, typeof stackedItems>();
    for (const it of stackedItems.filter((i) => i.rule === 'tower' || i.rule === 'plaza-tower')) {
      const key = `${it.edge}:${Math.sign(it.d)}:${it.rule}`;
      rows.set(key, [...(rows.get(key) ?? []), it]);
    }
    for (const [key, row] of rows) {
      row.sort((a, b) => a.s - b.s);
      for (let i = 1; i < row.length; i++) {
        const a = row[i - 1]!;
        const b = row[i]!;
        const gap = b.s - a.s - (towerFootprint(a.variant, true)[0] + towerFootprint(b.variant, true)[0]) / 2;
        expect(gap, `${key} at s ${a.s.toFixed(1)} and ${b.s.toFixed(1)}`).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it("draws a facade tile at exactly one mid's height, never stretched, in the stretch's one atlas material", () => {
    expect(MODULES.map, 'the atlas loaded with the modules').toBeDefined();
    const layer = new DowntownLayer(KIT, PROPS, CABLE, look, input, MODULES);
    ride(layer);
    const meshes = stretchMeshes(layer);
    expect(meshes.length).toBeGreaterThan(0);
    let facades = 0;
    let plainTris = 0;
    for (const mesh of meshes) {
      const material = mesh.material as { map?: unknown };
      expect(material.map, 'every stretch draws with the atlas').toBe(MODULES.map);
      const pos = mesh.geometry.getAttribute('position');
      const uv = mesh.geometry.getAttribute('uv');
      expect(uv, 'a stretch with the atlas carries UVs for all of it').toBeDefined();
      const onWhite = (i: number) =>
        Math.abs(uv.getX(i) - ATLAS_WHITE_UV[0]) < 1e-6 && Math.abs(uv.getY(i) - ATLAS_WHITE_UV[1]) < 1e-6;
      for (let t = 0; t + 2 < pos.count; t += 3) {
        if ([t, t + 1, t + 2].every(onWhite)) {
          plainTris++;
          continue;
        }
        facades++;
        const ys = [pos.getY(t), pos.getY(t + 1), pos.getY(t + 2)];
        const span = Math.max(...ys) - Math.min(...ys);
        // A facade quad is a mid's face: each of its triangles is one mid tall, or flat.
        expect(Math.min(span, Math.abs(span - MODULE_M.mid)), 'facade triangle height').toBeLessThan(1e-3);
      }
    }
    print(
      `[examined] ${meshes.length} stretches in range: ${facades} facade triangles, every one a mid tall (none stretched), ${plainTris} plain`,
    );
    expect(facades).toBeGreaterThan(100);
    layer.dispose();
  });

  it('costs no more than the stretched kit: about the same triangles, no more draws, along the whole route', () => {
    const stacked = new DowntownLayer(KIT, PROPS, CABLE, look, input, MODULES);
    const old = new DowntownLayer(KIT, PROPS, CABLE, look, input);
    const a = ride(stacked);
    const b = ride(old);
    print(
      `[examined] downtown along the route: stacked up to ${a.meshes} meshes and ${a.tris} triangles in range, the stretched kit ${b.meshes} and ${b.tris}`,
    );
    expect(a.meshes).toBeLessThanOrEqual(b.meshes);
    expect(a.tris).toBeLessThanOrEqual(b.tris * 1.3);
    stacked.dispose();
    old.dispose();
  });

  it('falls back to the stretched kit with no modules, and to plain colour with no sheet, and throws on neither', async () => {
    const old = new DowntownLayer(KIT, PROPS, CABLE, look, input);
    expect(old.plan.items.some((i) => i.model === 'tower')).toBe(false);
    ride(old);
    for (const mesh of stretchMeshes(old))
      expect((mesh.material as { map?: unknown }).map ?? null).toBeNull();
    old.dispose();
    // The modules baked, the sheet failed to load: they draw in their tiles' mean colours, no map.
    const bare = withAtlas(
      bakeModel('sfTowerModules', readGlb(await readAsset(MODEL_ASSETS.sfTowerModules, 'glb'))),
      {
        sheet: 'san-francisco',
        layout: (await readAtlas('san-francisco')).layout,
        texture: null,
      },
    );
    const layer = new DowntownLayer(KIT, PROPS, CABLE, look, input, bare);
    expect(layer.plan.items.some((i) => i.model === 'tower')).toBe(true);
    ride(layer);
    const meshes = stretchMeshes(layer);
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect((mesh.material as { map?: unknown }).map ?? null).toBeNull();
    layer.dispose();
  });
});

// Kept for the tower width table above (towers' lots are the kit's footprints).
void SIDEWALK_M;
