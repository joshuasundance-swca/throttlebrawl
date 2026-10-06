// What the chase camera makes of the Keys' places (playtest 4, P4-19, run C's live check, lane J3). The real
// follow camera is built as the app builds it, settled behind a rider at the bot's 38 m/s on the phone's
// 915 by 412 screen (chase-sight.test-util.ts). It lives in tests/ because the camera and the render module
// may not import each other.
// - The cruise ship: "a small white block over Duval's end, and the fronts hide it when abreast". Asked: down
//   Duval's last 500 m, the part of the ship the street fronts leave in the frame is a share of the screen
//   (its pixels, ray by ray, against the fronts' boxes).
// - The osprey nests: "no osprey post showed in 8 frames along shore and mangrove stretches". Asked: on the
//   shore and mangrove stretches of the Keys' roads, a nest in the frame, its platform wide enough to find
//   (from 40 m ahead), within sight of a good share of the stretch; with the old rule as the control.
import {
  Box3,
  Color,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
  type BufferAttribute,
  type Mesh,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  type BakedFeature,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../../src/road';
import { readGlb } from '../../src/render/glb';
import { LandmarkLayer } from '../../src/render/landmarks';
import { CLASSIC_PALETTE, createFlatLook } from '../../src/render/look';
import { bakeLandmarkKit, landmarkKitAsset } from '../../src/render/models';
import { bakeRepoModel, readAsset } from '../../src/render/model-files.test-util';
import { buildRoadScene, type RoadDressing } from '../../src/render/road-mesh';
import { KEYS_KIT, scatterRoadside, type RoadsideItem, type RoadsideKit } from '../../src/render/roadside';
import { themeAt, type SideTag } from '../../src/render/scenery';
import { SEA_BANDS, seaDepthAt, seaPlanFor } from '../../src/render/sea-bands';
import { chaseSight, PHONE, settledPose } from './chase-sight.test-util';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);
const SPEED_MPS = 38;

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
  eager: true,
  import: 'default',
});

const keysRoadside = await bakeRepoModel('keysRoadside');
const duvalKit = await bakeRepoModel('duvalKit');
const keysIdentity = await bakeRepoModel('keysIdentity');
const keysLandmarks = bakeLandmarkKit(
  'keys-landmarks',
  readGlb(await readAsset(landmarkKitAsset('keys-landmarks'), 'glb')),
);

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

describe('the osprey nests, from the chase camera', () => {
  const RULE = 'osprey-post';
  /** The nest is read from here, m ahead of it (the deer's test reads from 20; a pole is seen from farther). */
  const READ_FROM_M = 40;
  /** The nest's platform, at least this wide on the phone's screen from there, px. */
  const MIN_NEST_PX = 13;
  /** A nest is sighted from this far ahead of it down to this near, m: the stretch of road it can be found on. */
  const SIGHT_M: readonly [number, number] = [15, 100];
  /** Of the shore and mangrove road on a network, the share from which a nest is sighted, at least. */
  const MIN_SIGHTED = 0.12;
  const SEEDS = [1, 2, 3, 4, 5, 6];
  /** The Keys' networks with land beside open water (models.ts asks them for the identity kit). */
  const NETWORKS = ['osm-keys-bahia-honda', 'keys-m1', 'osm-keys-key-west'];

  /** The kit as run C's live check found it: a candidate every 420 m at half the chances, the pole at its true size. */
  const OLD: RoadsideKit = {
    ...KEYS_KIT,
    rules: KEYS_KIT.rules.map((rule) => {
      if (rule.id !== RULE) return rule;
      const { size: _size, ...rest } = rule;
      return { ...rest, every: 420, rate: 0.5, across: [3, 6], r: 2 };
    }),
  };

  const runs = new Map<string, ReturnType<typeof scene>>();
  function scene(id: string, seed: number, kit: RoadsideKit) {
    const t = track(id);
    const built = buildRoadScene(t.road, look, t.dressing, { seed, roadsideDensity: 1 });
    const items = scatterRoadside({
      road: t.road,
      dressing: t.dressing,
      seed,
      density: 1,
      kit,
      landReach: (e, side, s) => built.landReach(e, side, s),
      spots: built.spots,
      models: { keysRoadside, duvalKit, keysIdentity },
    });
    return { ...t, posts: items.filter((i) => i.rule === RULE) };
  }
  const sceneOf = (id: string, seed: number, kit: RoadsideKit, tag: string) => {
    const key = `${tag}/${id}/${seed}`;
    let r = runs.get(key);
    if (!r) runs.set(key, (r = scene(id, seed, kit)));
    return r;
  };

  /** The nest platform's corners in the world: a square 1.5 m across (0.75 each way) at the pole's top, as drawn. */
  function nest(p: RoadsideItem, size = p.size): Vector3[] {
    const out: Vector3[] = [];
    for (const x of [-0.75, 0.75])
      for (const y of [8.9, 9.9])
        for (const z of [-0.75, 0.75])
          out.push(
            new Vector3(
              p.p.x + size * (x * Math.cos(p.turn) + z * Math.sin(p.turn)),
              p.p.y + size * y,
              p.p.z + size * (z * Math.cos(p.turn) - x * Math.sin(p.turn)),
            ),
          );
    return out;
  }
  const sightOf = (r: { road: RoadNetwork }, p: RoadsideItem, size = p.size) =>
    chaseSight(r.road, p.edge, Math.max(0, p.s - READ_FROM_M), 1.7, SPEED_MPS, nest(p, size));

  /** The shore and mangrove metres of a network (either side), and how many of them a sighted nest is ahead of. */
  function coverage(r: ReturnType<typeof scene>, sighted: readonly RoadsideItem[]) {
    const on = KEYS_KIT.rules.find((k) => k.id === RULE)?.on ?? [];
    let themed = 0;
    let seen = 0;
    for (const e of r.road.edges) {
      const tags = r.dressing[e.id]?.tags as readonly SideTag[] | undefined;
      const here = sighted.filter((p) => p.edge === e.index);
      for (let s = 0; s < e.length; s += 10) {
        if (
          !(on as readonly string[]).includes(themeAt(tags, 'left', s)) &&
          !(on as readonly string[]).includes(themeAt(tags, 'right', s))
        )
          continue;
        themed += 10;
        if (here.some((p) => p.s - s >= SIGHT_M[0] && p.s - s <= SIGHT_M[1])) seen += 10;
      }
    }
    return { themed, seen, share: themed > 0 ? seen / themed : 1 };
  }

  describe.each(NETWORKS)('%s', (id) => {
    it(`every nest is in the frame ${READ_FROM_M} m before it, with a platform at least ${MIN_NEST_PX} px wide`, () => {
      const widths: number[] = [];
      for (const seed of SEEDS) {
        const r = sceneOf(id, seed, KEYS_KIT, 'new');
        for (const p of r.posts) {
          const sight = sightOf(r, p);
          widths.push(sight.widthPx);
          expect(sight.inView, `seed ${seed}: the nest at s ${p.s.toFixed(0)} is in the frame`).toBe(true);
          expect(sight.widthPx, `seed ${seed}: the nest at s ${p.s.toFixed(0)}`).toBeGreaterThanOrEqual(
            MIN_NEST_PX,
          );
        }
      }
      expect(widths.length, 'some nest stands over six seeds').toBeGreaterThan(0);
      print(
        `${id}: ${widths.length} nests over ${SEEDS.length} seeds, ${Math.min(...widths).toFixed(1)} to ${Math.max(...widths).toFixed(1)} px wide from ${READ_FROM_M} m at ${SPEED_MPS} m/s on a 412 px screen`,
      );
    });

    it(`a nest is sighted ahead of at least ${MIN_SIGHTED * 100} % of the shore and mangrove road, on every seed`, () => {
      const shares: string[] = [];
      let lowest = 1;
      for (const seed of SEEDS) {
        const r = sceneOf(id, seed, KEYS_KIT, 'new');
        const sighted = r.posts.filter((p) => {
          const s = sightOf(r, p);
          return s.inView && s.widthPx >= MIN_NEST_PX;
        });
        const c = coverage(r, sighted);
        shares.push(`${seed}: ${(c.share * 100).toFixed(0)} % of ${c.themed} m (${sighted.length} nests)`);
        lowest = Math.min(lowest, c.share);
        expect(c.themed, `${id} has shore or mangrove road`).toBeGreaterThan(1000);
      }
      print(`${id}, road with a nest sighted ahead: ${shares.join('; ')}`);
      expect(lowest).toBeGreaterThanOrEqual(MIN_SIGHTED);
    });

    it('the measure can tell: the rule as run C found it (every 420 m, half the chances) falls under the coverage line, and a nest at its true size under the width line (controls)', () => {
      let under = 0;
      let narrow = 0;
      let all = 0;
      const oldShares: string[] = [];
      for (const seed of SEEDS) {
        const old = sceneOf(id, seed, OLD, 'old');
        const sighted = old.posts.filter((p) => {
          const s = sightOf(old, p);
          return s.inView && s.widthPx >= MIN_NEST_PX;
        });
        const oldShare = coverage(old, sighted).share;
        oldShares.push(`${(oldShare * 100).toFixed(0)} %`);
        if (oldShare < MIN_SIGHTED) under++;
        // The same nests at the model's own size.
        for (const p of sceneOf(id, seed, KEYS_KIT, 'new').posts) {
          all++;
          if (sightOf(old, p, 1).widthPx < MIN_NEST_PX) narrow++;
        }
      }
      print(
        `${id}, old rule under the coverage line on ${under} of ${SEEDS.length} seeds (${oldShares.join(', ')}); ${narrow} of ${all} nests at size 1 under the width line`,
      );
      expect(under, 'seeds whose coverage falls under the line').toBeGreaterThanOrEqual(SEEDS.length - 1);
      // The width line is what the larger nest buys: at size 1 a good share of the same nests fall under it.
      expect(narrow, 'nests at size 1 under the width line').toBeGreaterThan(0.3 * all);
    });
  });
});

describe('the Keys` flats, from the chase camera', () => {
  /** The luminance of a colour (linear-light weighting). */
  const luma = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const BASE = new Color(CLASSIC_PALETTE.water);
  const BASE_LUMA = luma(BASE);
  const STEP_PX = 6;
  const NEAREST_M = 25;
  const FARTHEST_M = 600;

  /**
   * What the sea shows on the phone's screen to a rider at (edge, s): the colour of the drawn mesh (its
   * vertex colours, laid by bilinear weights over the lattice) at every STEP_PX-th pixel whose ray meets the
   * sea between NEAREST_M and FARTHEST_M away and clear of the deck, as the water's luminance over the
   * untinted water's, and how deep the plan says it is there.
   */
  function seaFrames(
    id: string,
    seed: number,
  ): { edge: number; s: number; ratios: number[]; deepShare: number }[] {
    const { road, dressing } = track(id);
    const scene = buildRoadScene(road, look, dressing, { seed, roadsideDensity: 0 });
    const plan = seaPlanFor(road, (e) => dressing[e.id]?.tags);
    if (!plan) throw new Error(`no sea plan for ${id}`);
    const out: { edge: number; s: number; ratios: number[]; deepShare: number }[] = [];
    for (const e of road.edges) {
      for (let s = 150; s < e.length - 100; s += 500) {
        const { pose, aspect } = settledPose(road, e.index, s, 2, SPEED_MPS);
        scene.update(pose.x, pose.z, 0, 760);
        let mesh: Mesh | undefined;
        scene.group.traverse((o) => {
          if ((o as Mesh).isMesh && o.name === 'road-water') mesh = o as Mesh;
        });
        if (!mesh) throw new Error('no sea mesh');
        const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
        const col = mesh.geometry.getAttribute('color') as BufferAttribute;
        const n = Math.round(Math.sqrt(pos.count));
        const xs = Array.from({ length: n }, (_, i) => pos.getX(i * n));
        const zs = Array.from({ length: n }, (_, j) => pos.getZ(j));
        const at = (i: number, j: number, k: number) =>
          k === 0 ? col.getX(i * n + j) : k === 1 ? col.getY(i * n + j) : col.getZ(i * n + j);
        const lower = (a: readonly number[], v: number) => {
          let k = 0;
          while (k < a.length - 2 && (a[k + 1] ?? 0) <= v) k++;
          return k;
        };
        const cam = new PerspectiveCamera(pose.fov, aspect, 0.3, 3000);
        cam.position.set(pose.x, pose.y, pose.z);
        cam.lookAt(pose.lookX, pose.lookY, pose.lookZ);
        if (pose.roll) cam.rotateZ(pose.roll);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();
        const eye = new Vector3(pose.x, pose.y, pose.z);
        const w0 = road.toWorld(e.index, s, 0, 0);
        const f = road.frameAt(e.index, s);
        const ratios: number[] = [];
        let deep = 0;
        for (let py = STEP_PX / 2; py < PHONE.height; py += STEP_PX)
          for (let px = STEP_PX / 2; px < PHONE.width; px += STEP_PX) {
            const dir = new Vector3((px / PHONE.width) * 2 - 1, 1 - (py / PHONE.height) * 2, 0.5)
              .unproject(cam)
              .sub(eye)
              .normalize();
            if (dir.y > -0.002) continue;
            const t = -eye.y / dir.y;
            if (t < NEAREST_M || t > FARTHEST_M) continue;
            const x = eye.x + dir.x * t;
            const z = eye.z + dir.z * t;
            // Clear of the deck and its rails: past 7 m from the road's line here.
            if (Math.abs((x - w0.x) * -f.tz + (z - w0.z) * f.tx) < 7) continue;
            const i = lower(xs, x);
            const j = lower(zs, z);
            const u = Math.min(1, Math.max(0, (x - (xs[i] ?? 0)) / ((xs[i + 1] ?? 1) - (xs[i] ?? 0))));
            const v = Math.min(1, Math.max(0, (z - (zs[j] ?? 0)) / ((zs[j + 1] ?? 1) - (zs[j] ?? 0))));
            const c = [0, 1, 2].map(
              (k) =>
                at(i, j, k) * (1 - u) * (1 - v) +
                at(i + 1, j, k) * u * (1 - v) +
                at(i, j + 1, k) * (1 - u) * v +
                at(i + 1, j + 1, k) * u * v,
            );
            ratios.push(
              luma(new Color(BASE.r * (c[0] ?? 1), BASE.g * (c[1] ?? 1), BASE.b * (c[2] ?? 1))) / BASE_LUMA,
            );
            if (seaDepthAt(plan, x, z) > 0.25) deep++;
          }
        out.push({ edge: e.index, s, ratios, deepShare: ratios.length ? deep / ratios.length : 1 });
      }
    }
    scene.dispose();
    return out;
  }

  const pct = (a: readonly number[], q: number) =>
    [...a].sort((x, y) => x - y)[Math.floor(q * (a.length - 1))] ?? 1;

  /** A frame of the flats shows seagrass when its darkest twentieth is this much darker than the water's own... */
  const GRASS_BELOW = 0.88;
  /** ...and sand when its palest twentieth is this much lighter. */
  const SAND_ABOVE = 1.08;
  /** Of the frames over the flats, the share that show both, at least. */
  const MIN_BOTH = 0.6;
  const SEEDS_SEA = [1, 2, 3];
  const NETWORKS_SEA = ['osm-keys-seven-mile', 'osm-keys-bahia-honda'];

  /** The share of the frames over the flats of a network (over three seeds) that show both a seagrass and a sand band. */
  function bothBands(id: string): { frames: number; both: number; share: number } {
    let frames = 0;
    let both = 0;
    for (const seed of SEEDS_SEA)
      for (const fr of seaFrames(id, seed)) {
        // The flats: no channel in the frame (a deep share of a tenth or more is the channel, which reads as blue).
        if (fr.deepShare > 0.1 || fr.ratios.length < 500) continue;
        frames++;
        if (pct(fr.ratios, 0.05) <= GRASS_BELOW && pct(fr.ratios, 0.95) >= SAND_ABOVE) both++;
      }
    return { frames, both, share: frames > 0 ? both / frames : 0 };
  }

  /** The patches as run C found them (sea-bands.ts before lane J3): 160 m patches, faint tints, on a 56 m grid. */
  const OLD_SEA = {
    patchM: 160,
    octaveShare: 0.42,
    patchFrom: 0.12,
    patchTo: 0.55,
    cells: 20,
    cellM: 56,
    sand: [1.18, 1.12, 0.95],
    seagrass: [0.62, 0.82, 0.72],
  };

  describe.each(NETWORKS_SEA)('%s', (id) => {
    it(`at least ${MIN_BOTH * 100} % of the frames over the flats show a seagrass band (darker than ${GRASS_BELOW}) and a sand band (paler than ${SAND_ABOVE})`, () => {
      const r = bothBands(id);
      print(
        `${id}: ${r.both} of ${r.frames} frames over the flats (${SEEDS_SEA.length} seeds, 500 m apart, ${PHONE.width} by ${PHONE.height}) show both bands, ${(r.share * 100).toFixed(0)} %`,
      );
      expect(r.frames, 'the network has flats to ride over').toBeGreaterThan(20);
      expect(r.share).toBeGreaterThanOrEqual(MIN_BOTH);
    });

    it('the measure can tell: with the patches as run C found them, few frames do (control)', () => {
      const bands = SEA_BANDS as unknown as Record<string, unknown>;
      const kept = Object.fromEntries(Object.keys(OLD_SEA).map((k) => [k, bands[k]]));
      Object.assign(bands, OLD_SEA);
      try {
        const r = bothBands(id);
        print(
          `${id}, patches as run C found them: ${r.both} of ${r.frames} frames show both, ${(r.share * 100).toFixed(0)} %`,
        );
        expect(r.share).toBeLessThan(MIN_BOTH / 2);
      } finally {
        Object.assign(bands, kept);
      }
    });
  });
});

describe('the cruise ship behind Mallory pier, from the chase camera down Duval', () => {
  const STEP_PX = 8;
  /** Rays are cast against the fronts within this far of the rider (the street's own length of view), m. */
  const FRONTS_M = 450;
  /** Before the road's end (the finish is at its bow) a rider sees at least this share of the screen as ship... */
  const FROM_END: readonly { back: number; minShare: number }[] = [
    { back: 500, minShare: 0.006 },
    { back: 400, minShare: 0.025 },
  ];
  const SEEDS_SHIP = [1, 2, 3];

  const { road: baseRoad, dressing: baseDressing } = track('osm-keys-duval');

  /** The street's fronts (Old Town's balconied buildings) for a seed, each as its model box and the inverse of its placement. */
  function fronts(seed: number) {
    const built = buildRoadScene(baseRoad, look, baseDressing, { seed, roadsideDensity: 1 });
    const items = scatterRoadside({
      road: baseRoad,
      dressing: baseDressing,
      seed,
      density: 1,
      kit: KEYS_KIT,
      landReach: (e, side, s) => built.landReach(e, side, s),
      spots: built.spots,
      models: { keysRoadside, duvalKit, keysIdentity },
    });
    return items
      .filter((i) => i.rule === 'oldtown-front')
      .map((i) => {
        const g = duvalKit.variants[i.variant];
        if (!g) throw new Error('no front model');
        g.computeBoundingBox();
        const m = new Matrix4().compose(
          new Vector3(i.p.x, i.p.y, i.p.z),
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), i.turn),
          new Vector3(i.size, i.size, i.size),
        );
        return { box: g.boundingBox?.clone() ?? new Box3(), inv: m.invert(), s: i.s };
      });
  }

  /**
   * The share of the phone's screen the ship fills a rider `back` m before the road's end (in the right-hand
   * lane), counting a pixel only when its ray meets the ship before it meets a front: the street fronts stand
   * in the way as the boxes of their models.
   */
  function shipShare(
    road: RoadNetwork,
    near: ReturnType<typeof fronts>,
    back: number,
    ship?: (f: BakedFeature) => BakedFeature,
  ): { share: number; lod: number } {
    const layer = new LandmarkLayer(new Map([['keys-landmarks', keysLandmarks]]), look, {
      road: createRoadNetwork({
        network: Object.values(networkFiles).find((n) => n.id === 'osm-keys-duval') as BakedNetwork,
        roads: duvalRoads(road, ship),
      }),
    });
    const edge = road.edgeIndex('osm-duval-street');
    const len = road.edges[edge]?.length ?? 0;
    const s = len - back;
    const { pose, aspect } = settledPose(road, edge, s, 2, SPEED_MPS);
    const w = road.toWorld(edge, s, 2, 0);
    layer.update(w.x, w.z);
    const mesh = layer.group.children[0] as Mesh;
    mesh.updateMatrixWorld(true);
    const cam = new PerspectiveCamera(pose.fov, aspect, 0.3, 3000);
    cam.position.set(pose.x, pose.y, pose.z);
    cam.lookAt(pose.lookX, pose.lookY, pose.lookZ);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const eye = new Vector3(pose.x, pose.y, pose.z);
    const rc = new Raycaster();
    const here = near.filter((f) => Math.abs(f.s - s) < FRONTS_M);
    let seen = 0;
    let total = 0;
    for (let py = STEP_PX / 2; py < PHONE.height; py += STEP_PX)
      for (let px = STEP_PX / 2; px < PHONE.width; px += STEP_PX) {
        total++;
        rc.setFromCamera(new Vector2((px / PHONE.width) * 2 - 1, 1 - (py / PHONE.height) * 2), cam);
        const hit = rc.intersectObject(mesh, false)[0];
        if (!hit) continue;
        const dir = rc.ray.direction;
        let blocked = false;
        for (const f of here) {
          const lo = eye.clone().applyMatrix4(f.inv);
          const hi = eye.clone().addScaledVector(dir, hit.distance).applyMatrix4(f.inv);
          const run = hi.clone().sub(lo);
          const at = new Raycaster(lo, run.clone().normalize()).ray.intersectBox(f.box, new Vector3());
          if (at && at.distanceTo(lo) <= run.length()) {
            blocked = true;
            break;
          }
        }
        if (!blocked) seen++;
      }
    const lod = mesh.geometry.drawRange.count;
    layer.dispose();
    return { share: seen / total, lod };
  }

  const duvalRoads = (road: RoadNetwork, ship?: (f: BakedFeature) => BakedFeature): BakedRoad[] =>
    Object.values(roadFiles)
      .filter((r) => road.edges.some((e) => e.id === r.id))
      .map((r) => ({
        ...r,
        // The ship alone: the pier, the buoy and the Mile 0 marker are other landmarks of the same mesh.
        features: (r.features ?? [])
          .filter((x) => x.kind !== 'landmark' || x.id === 'cruise-ship')
          .map((x) => (ship && x.id === 'cruise-ship' ? ship(x) : x)),
      }));

  /** The ship as run C found it: 290 m long and 60 m high (scale 1), s 1489 to 1779, d -76 to -40, light hull past 300 m. */
  const OLD_SHIP = (f: BakedFeature): BakedFeature => ({
    ...f,
    s0: 1489,
    s1: 1779,
    d0: -76,
    d1: -40,
    params: { model: 'models/landmarks/keys-landmarks#cruise_ship', yawDeg: 0, baseY: 0, farM: 300 },
  });

  it.each(FROM_END)(
    'fills at least $minShare of the screen $back m before the road`s end, on every seed',
    ({ back, minShare }) => {
      const shares: string[] = [];
      for (const seed of SEEDS_SHIP) {
        const r = shipShare(baseRoad, fronts(seed), back);
        shares.push(`seed ${seed}: ${(r.share * 100).toFixed(1)} %`);
        expect(r.share, `seed ${seed}`).toBeGreaterThanOrEqual(minShare);
      }
      print(
        `the ship ${back} m before the street's end, as a share of the screen past the fronts: ${shares.join('; ')}`,
      );
    },
  );

  it.each(FROM_END)(
    'the measure can tell: the ship as run C found it fills under that $back m before the end, on every seed (control)',
    ({ back, minShare }) => {
      const shares: string[] = [];
      for (const seed of SEEDS_SHIP) {
        const r = shipShare(baseRoad, fronts(seed), back, OLD_SHIP);
        shares.push(`seed ${seed}: ${(r.share * 100).toFixed(2)} %`);
        expect(r.share, `seed ${seed}`).toBeLessThan(minShare);
      }
      print(`the old ship ${back} m before the street's end: ${shares.join('; ')}`);
    },
  );
});
