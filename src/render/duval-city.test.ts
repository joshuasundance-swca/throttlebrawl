// Duval is a street with a city behind it and a crowd on its sidewalk (playtest 4, run B's live check, punch
// item 4: "Duval looks thin of people. Mid-street the sea shows behind both fronts. The sidewalks look empty in
// the frames, although the zones sampled many party kinds"; the maintainer: "Duval St should be a party
// street"). Rules, read from what a rider sees:
// - the ground: Old Town's land reaches well past the front row (a city floor), so a gap between two shopfronts
//   shows ground and a second row of houses, never the sea;
// - the second row: the houses behind the front stand where the front has a gap, so the street's sides are
//   closed along nearly all their length (the front alone leaves a quarter of the worst side in gaps of 4 m or more);
// - the sidewalk: party blocks have people standing on the pavement, in the picture all the way down a block at
//   riding speed (the sim's pedestrians are nine to a block side, a second or two of road at 40 m/s), with the
//   street's own cost kept inside its share (scene-cost.test.ts runs the whole route).
import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { GroundTris } from './land-probe.test-util';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import type { SceneryModel } from './models';
import { PartyLights, partyRuns } from './party-lights';
import { buildRoadScene, LANDMARK_LEAD_M, type RoadDressing } from './road-mesh';
import { KEYS_KIT, RoadsideLayer, scatterRoadside, type RoadsideInput } from './roadside';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

const keysRoadside: SceneryModel = await bakeRepoModel('keysRoadside');
const duvalKit: SceneryModel = await bakeRepoModel('duvalKit');
const keysIdentity: SceneryModel = await bakeRepoModel('keysIdentity');
const models = { keysRoadside, duvalKit, keysIdentity };

const DUVAL = 'osm-keys-duval';
const SEEDS = [1, 7, 42];
/** A street front's rules: the first row (the Duval kit's shops and houses) and the row behind it. */
const FRONT_RULES = ['oldtown-front', 'oldtown-bar'];
const BACK_RULE = 'oldtown-back';
/** How far past the sidewalk the ground must reach for a gap in the front to show ground, not sea, m. */
const FLOOR_M = 60;
/** A gap in a row of buildings is at least this long, m. */
const GAP_M = 4;

function scene(seed: number) {
  const t = track(DUVAL);
  const built = buildRoadScene(t.road, look, t.dressing, { seed, roadsideDensity: 1 });
  const input: RoadsideInput = {
    road: t.road,
    dressing: t.dressing,
    seed,
    density: 1,
    kit: KEYS_KIT,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
    models,
  };
  return { ...t, built, input };
}

describe.each(SEEDS)('Duval has a city behind its front, seed %i', (seed) => {
  const { road, dressing, built, input } = scene(seed);
  const items = scatterRoadside(input);

  it('stands ground well past the front row (a city floor), so no gap in the front opens on the sea', () => {
    let stations = 0;
    let short = 0;
    let least = Infinity;
    const where: string[] = [];
    for (const e of road.edges)
      for (const side of [-1, 1] as const)
        for (let s = 10; s < e.length - 10; s += 20) {
          stations++;
          const reach = built.landReach(e.index, side, s);
          least = Math.min(least, reach);
          if (reach < FLOOR_M) {
            short++;
            where.push(`${e.id} ${side < 0 ? 'L' : 'R'} s${s} ${reach.toFixed(0)}m`);
          }
        }
    print(
      `seed ${seed}: ${stations} stations on Duval and Whitehead, the ground reaches at least ${least.toFixed(0)} m, ${short} under ${FLOOR_M} m: ${where.join(', ')}`,
    );
    // The ground is short only where the street meets the Gulf, on the left side (the pier's): the last 330 m of each
    // of the two roads, where the shore keeps the strip back, or beside a landmark on that side (the cruise ship's
    // berth, whose length the ship sets), where road-mesh.ts `landmarkBeyond` keeps it back from LANDMARK_LEAD_M before.
    expect(where.filter((w) => !/ L s/.test(w)).length, 'short stations off the left side').toBe(0);
    expect(stations - short, 'stations with the city floor').toBeGreaterThan(stations * 0.9);
    for (const w of where) {
      const m = /^(\S+) L s(\d+) /.exec(w);
      const e = road.edges[road.edgeIndex(m?.[1] ?? '')];
      const s = Number(m?.[2]);
      const berth = (dressing[m?.[1] ?? '']?.features ?? []).some(
        (f) =>
          f.kind === 'landmark' &&
          f.params?.['overRoad'] !== true &&
          f.d0 + f.d1 < 0 &&
          s >= Math.min(f.s0, f.s1) - LANDMARK_LEAD_M &&
          s <= Math.max(f.s0, f.s1) + LANDMARK_LEAD_M,
      );
      if (!berth) expect(s, w).toBeGreaterThanOrEqual((e?.length ?? 0) - 330);
    }
  });

  /**
   * The share of a side's length in a gap: along the road in 2 m steps, a step is closed when a building of one of
   * the rules stands over it (its half width either side of its middle), and a gap is a run of open steps at
   * least GAP_M long (a slit between two shopfronts, 0.6 to 3 m, shows nothing but the next building's side).
   */
  const open = (rules: readonly string[], edge: number, side: -1 | 1): number => {
    const e = road.edges[edge];
    if (!e) return 1;
    const mine = items.filter(
      (it) => it.edge === edge && Math.sign(it.d) === side && it.foot && rules.includes(it.rule),
    );
    let gap = 0;
    let n = 0;
    let run = 0;
    // Not the Gulf end's pier side (the last 330 m, left): the shore and the cruise ship's berth keep it open.
    const end = e.length - 20 - (side < 0 ? 330 : 0);
    for (let s = 20; s < end; s += 2) {
      n++;
      if (mine.some((it) => Math.abs(it.s - s) <= (it.foot?.half ?? 0))) {
        if (run * 2 >= GAP_M) gap += run;
        run = 0;
      } else run++;
    }
    if (run * 2 >= GAP_M) gap += run;
    return gap / Math.max(1, n);
  };
  const sides = road.edges.flatMap((e) => [-1, 1].map((side) => ({ edge: e.index, side: side as -1 | 1 })));

  it('closes the street with a row of houses behind the front: each side is open on a twelfth of its length at most', () => {
    const worst = (rules: readonly string[]) => Math.max(...sides.map((x) => open(rules, x.edge, x.side)));
    const frontOnly = worst(FRONT_RULES);
    const both = worst([...FRONT_RULES, BACK_RULE]);
    print(
      `seed ${seed}: the front row alone leaves up to ${(frontOnly * 100).toFixed(0)} % of a side open; with the row behind it, ${(both * 100).toFixed(0)} %`,
    );
    // The control: the front alone is open on a good part of the street (the check can see a gap).
    expect(frontOnly).toBeGreaterThan(0.15);
    // What the second row cannot close is a landmark's forecourt, a board or a tree's yard: a twelfth at most.
    expect(both).toBeLessThan(0.08);
    expect(both).toBeLessThan(frontOnly / 3);
  });

  it('stands the second row behind the first: past the front row, on the ground, on an Old Town side only', () => {
    const back = items.filter((it) => it.rule === BACK_RULE);
    expect(back.length, 'houses in the second row').toBeGreaterThan(40);
    const bad: string[] = [];
    for (const it of back) {
      const v = road.vergeAt(it.edge, it.s, it.d < 0 ? 'left' : 'right');
      const past = Math.abs(it.d) - Math.abs(v.dOuter);
      const rear = past + (it.foot?.back ?? 0);
      // Behind the front row's deepest body (about 12 m past the sidewalk), and its body on the drawn ground.
      if (past < 14)
        bad.push(`${it.rule} at s ${it.s.toFixed(0)} stands ${past.toFixed(1)} m past the sidewalk`);
      if (rear > built.landReach(it.edge, it.d < 0 ? -1 : 1, it.s))
        bad.push(`${it.rule} at s ${it.s.toFixed(0)} reaches past the ground`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
    // No house of the second row stands inside a house of the first.
    const front = items.filter((it) => FRONT_RULES.includes(it.rule) && it.foot);
    const inside = back.filter((b) =>
      front.some(
        (f) =>
          f.edge === b.edge &&
          Math.sign(f.d) === Math.sign(b.d) &&
          Math.abs(f.s - b.s) < (f.foot?.half ?? 0) + (b.foot?.half ?? 0) - 0.5 &&
          Math.abs(b.d) - (b.foot?.back ?? 0) < Math.abs(f.d) + (f.foot?.back ?? 0) - 0.5,
      ),
    );
    expect(inside.length, 'second-row houses inside a first-row house').toBe(0);
  });

  it('stands every second-row house on the drawn land at its height, corners and back included', () => {
    const back = items.filter((it) => it.rule === BACK_RULE && it.foot);
    const probe = (ground: GroundTris): { points: number; bad: string[] } => {
      const bad: string[] = [];
      let points = 0;
      for (const it of back) {
        const f = it.foot!;
        const sgn = Math.sign(it.d);
        for (const u of [-f.half * 0.95, 0, f.half * 0.95])
          for (const dd of [-f.front * 0.95, f.back * 0.95]) {
            const p = road.toWorld(it.edge, it.s + u, it.d + sgn * dd, 0);
            points++;
            const hit = ground.heightAt(p.x, p.z, p.y + 40);
            if (!(hit?.name.startsWith('road-land') && Math.abs(hit.y - it.p.y) < 0.5))
              bad.push(
                `${it.rule} on edge ${it.edge} s ${it.s.toFixed(0)}: ${hit?.name ?? 'sea'} at ${hit?.y.toFixed(2)} vs floor ${it.p.y.toFixed(2)}`,
              );
          }
      }
      return { points, bad };
    };
    const real = probe(new GroundTris(built.group));
    // The control: the same houses over the ground of the street without its Old Town tag (the usual 24 m strip
    // of any town street, which is where the front row ended) stand over the sea.
    const stripped = Object.fromEntries(
      Object.entries(dressing).map(([id, r]) => [
        id,
        { ...r, tags: (r.tags ?? []).filter((x) => x.tag !== 'key-oldtown') },
      ]),
    ) as unknown as RoadDressing;
    const narrow = buildRoadScene(road, look, stripped, { seed, roadsideDensity: 0 });
    const control = probe(new GroundTris(narrow.group));
    print(
      `seed ${seed}: ${real.points} corner points of the second row ray-checked onto drawn land, ${real.bad.length} off it; over the ordinary town strip, ${control.bad.length} of ${control.points} off it`,
    );
    expect(real.points).toBeGreaterThan(300);
    expect(control.bad.length).toBeGreaterThan(control.points * 0.4);
    expect(real.bad.slice(0, 6)).toEqual([]);
    narrow.dispose();
  });
});

// The crowd on the sidewalk: the sim's people are nine to a block side, a second or two of road at riding speed,
// and the run B check saw empty pavements. Standing figures on the party blocks' sidewalks, scenery and never a
// hitbox (they stand at the back of the pavement, under the balconies), in the picture all the way down a block.
describe.each([7, 42])("a party block's sidewalks are full, seed %i", (seed) => {
  const { road, dressing, built } = scene(seed);
  const landReach = (e: number, side: -1 | 1, s: number) => built.landReach(e, side, s);
  const layer = new RoadsideLayer(keysRoadside, look, {
    road,
    dressing,
    seed,
    density: 1,
    kit: KEYS_KIT,
    landReach,
    spots: built.spots,
    models,
  });
  while (!layer.ready) layer.update(1e9, 1e9, 360);
  const runs = partyRuns(road, dressing);
  const standing = (lit: boolean) => {
    const lights = new PartyLights(look, { road, dressing, seed, lit, landReach });
    lights.setFronts(layer.surfaces());
    return lights;
  };
  const crowd = standing(true);

  /** The chase camera of the cost test: 7 m back, 2.6 m up, aimed 18 m ahead. */
  function cameraAt(edge: number, s: number): PerspectiveCamera {
    const eye = road.toWorld(edge, Math.max(0, s - 7), 0, 2.6);
    const aim = road.toWorld(edge, s + 18, 0, 0.9);
    const rider = road.toWorld(edge, s, 0, 0);
    eye.y = Math.max(eye.y, rider.y + 2.6);
    const cam = new PerspectiveCamera(70, 915 / 412, 0.3, 760);
    cam.position.set(eye.x, eye.y, eye.z);
    cam.lookAt(aim.x, aim.y, aim.z);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
  }
  const inView = (
    list: readonly { x: number; y: number; z: number }[],
    cam: PerspectiveCamera,
    reachM: number,
  ) => {
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    );
    return list
      .filter((r) => cam.position.distanceTo(new Vector3(r.x, r.y + 1, r.z)) <= reachM)
      .filter((r) => frustum.containsPoint(new Vector3(r.x, r.y + 1, r.z))).length;
  };

  it('stands people on the pavement of the party blocks, at the back of it under the balconies, on the ground', () => {
    const figures = crowd.walkers();
    expect(figures.length).toBeGreaterThan(150);
    const bad: string[] = [];
    for (const f of figures) {
      const p = road.project(f.x, f.z);
      const e = road.edges[p.edge];
      const side = Math.sign(p.d);
      const v = road.vergeAt(p.edge, p.s, side < 0 ? 'left' : 'right');
      const into = Math.abs(v.dOuter) - Math.abs(p.d);
      const covering = runs.some(
        (u) => u.edge === p.edge && p.s >= u.s0 - 4 && p.s <= u.s1 + 4 && side === u.side,
      );
      if (!e || !covering)
        bad.push(`a walker at s ${p.s.toFixed(0)} d ${p.d.toFixed(1)} is off every party block`);
      else if (Math.abs(p.d) < Math.abs(v.dInner) + 1 || into < 0.3 || into > 1.6)
        bad.push(`a walker at s ${p.s.toFixed(0)} stands ${into.toFixed(1)} m in from the pavement's back`);
      const ground = road.toWorld(p.edge, p.s, p.d, 0).y;
      if (Math.abs(f.y - ground) > 0.4)
        bad.push(`a walker at s ${p.s.toFixed(0)} is ${(f.y - ground).toFixed(1)} m off the ground`);
    }
    print(`seed ${seed}: ${figures.length} people standing on the party blocks' pavements`);
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('shows people on the pavement from the chase camera all the way down every party block', () => {
    const poses = runs.flatMap((r) => {
      const out: { edge: number; s: number }[] = [];
      for (let s = r.s0; s <= r.s1; s += 12) out.push({ edge: r.edge, s });
      return out;
    });
    const seen = poses.map((p) => inView(crowd.walkers(), cameraAt(p.edge, p.s), 90));
    const sorted = [...seen].sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    // The control: with no walkers stood (a road with none), the same measure finds nobody.
    const none = poses.map((p) => inView([], cameraAt(p.edge, p.s), 90));
    print(
      `seed ${seed}: ${poses.length} poses down the party blocks; people on the pavement in view within 90 m: median ${median}, the lowest tenth ${low}, most ${sorted[sorted.length - 1]}; with none stood: most ${Math.max(...none)}`,
    );
    expect(Math.max(...none)).toBe(0);
    expect(low).toBeGreaterThanOrEqual(8);
    expect(median).toBeGreaterThanOrEqual(24);
  });

  it('is the same every time for a seed, and nothing on a road with no party block', () => {
    expect(standing(true).walkers()).toEqual(crowd.walkers());
    const m1 = track('keys-m1');
    const other = new PartyLights(look, { road: m1.road, dressing: m1.dressing, seed, lit: true });
    other.setFronts(layer.surfaces());
    expect(other.walkers()).toEqual([]);
  });
});
