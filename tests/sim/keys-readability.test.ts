// What the chase camera shows of the Keys' road furniture (playtest 4, P4-19, run B's live check, punch items 1
// and 2). The real follow camera is built exactly as the app builds it, settled behind a rider at the bot's
// 38 m/s on the phone's 915 by 412 screen, and the thing's world corners are projected onto that screen.
// It lives in tests/ because the camera and the render module may not import each other.
// - The Seven Mile's mile boards: "a zoomed frame 28 m before mile 41 shows only a dark stub at the rail". The
//   board was 0.4 by 0.7 m, 5.5 px tall from there. Asked: in the frame, its front side to the camera, at
//   least 10 px tall, from 28 m before it, for every post.
// - Big Pine's Key deer: "none showed in 3 frames at 40 to 87 mph". A doe at its true size is 7 px tall from
//   20 m ahead. Asked: every deer in the frame and at least 9 px tall from 20 m ahead of it; the first herd
//   of the race whole in the frame from 25 m before it. Each with its control.
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../../src/road';
import { readGlb } from '../../src/render/glb';
import { LandmarkLayer, landmarkPlacements } from '../../src/render/landmarks';
import { createFlatLook } from '../../src/render/look';
import { bakeLandmarkKit } from '../../src/render/models';
import { bakeRepoModel, readAsset } from '../../src/render/model-files.test-util';
import { buildRoadScene, type RoadDressing } from '../../src/render/road-mesh';
import { KEYS_KIT, scatterRoadside, type RoadsideItem } from '../../src/render/roadside';
import { chaseSight } from './chase-sight.test-util';

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

const kit = bakeLandmarkKit('keys-identity', readGlb(await readAsset('models/scenery/keys-identity', 'glb')));
const keysRoadside = await bakeRepoModel('keysRoadside');
const keysIdentity = await bakeRepoModel('keysIdentity');

function track(id: string) {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

describe('the Seven Mile`s mile boards, from the chase camera', () => {
  const READ_FROM_M = 28;
  const MIN_BOARD_PX = 10;
  const { road } = track('osm-keys-seven-mile');
  const layer = new LandmarkLayer(new Map([['keys-identity', kit]]), look, { road });
  const posts = landmarkPlacements(road).filter((p) => p.node === 'keys_mile_marker');
  const boardOf = (p: { x: number; z: number }) =>
    layer
      .surfaces()
      .reduce((a, b) =>
        Math.hypot(b.centre.x - p.x, b.centre.z - p.z) < Math.hypot(a.centre.x - p.x, a.centre.z - p.z)
          ? b
          : a,
      );
  const cornersOf = (s: { positions: Float32Array }) => {
    const out: Vector3[] = [];
    for (let i = 0; i < s.positions.length; i += 3)
      out.push(new Vector3(s.positions[i], s.positions[i + 1], s.positions[i + 2]));
    return out;
  };

  it(`each board is in the frame ${READ_FROM_M} m before it, front side on, and at least ${MIN_BOARD_PX} px tall`, () => {
    expect(posts.length).toBe(7);
    const sizes: string[] = [];
    for (const p of posts) {
      const board = boardOf(p);
      const at = (p.feature.s0 + p.feature.s1) / 2;
      // The rider rides the right-hand drive lane, the way the race goes (+s).
      const sight = chaseSight(road, p.edge, Math.max(0, at - READ_FROM_M), 2, SPEED_MPS, cornersOf(board));
      sizes.push(`mile ${p.params.number} ${sight.heightPx.toFixed(1)} px`);
      expect(sight.inView, `mile ${p.params.number} is in the frame`).toBe(true);
      expect(
        board.normal.dot(sight.camera.clone().sub(board.centre)),
        `mile ${p.params.number}: the camera sees its front`,
      ).toBeGreaterThan(0);
      expect(sight.heightPx, `mile ${p.params.number}`).toBeGreaterThanOrEqual(MIN_BOARD_PX);
    }
    print(
      `the boards, tall on a 412 px screen from ${READ_FROM_M} m at ${SPEED_MPS} m/s: ${sizes.join(', ')}`,
    );
  });

  it('the measure can tell: at the model`s own size (scale 1) the boards fall under the line, and a rider coming the other way sees their back (controls)', () => {
    let under = 0;
    for (const p of posts) {
      const board = boardOf(p);
      const at = (p.feature.s0 + p.feature.s1) / 2;
      // Half the drawn size, about the board's own centre: scale 2 back to the model's 1.
      const c = board.centre;
      const small = cornersOf(board).map((v) => c.clone().add(v.sub(c).multiplyScalar(0.5)));
      const sight = chaseSight(road, p.edge, Math.max(0, at - READ_FROM_M), 2, SPEED_MPS, small);
      if (sight.heightPx < MIN_BOARD_PX) under++;
      // A rider coming the other way stands ahead of the post, on the far lane: the board's back is to them.
      const w = road.toWorld(p.edge, at + READ_FROM_M, -2, 0);
      expect(board.normal.dot(new Vector3(w.x, w.y + 3, w.z).sub(board.centre))).toBeLessThan(0);
    }
    expect(under).toBe(posts.length);
  });
});

describe.each([1, 7, 42, 99])('Big Pine`s Key deer, from the chase camera, seed %i', (seed) => {
  const READ_FROM_M = 20;
  const MIN_PX = 9;
  const { road, dressing } = track('osm-keys-bahia-honda');
  const edge = road.edges[road.edgeIndex('osm-big-pine-bend')]!;
  const built = buildRoadScene(road, look, dressing, { seed });
  const items = scatterRoadside({
    road,
    dressing,
    seed,
    density: 1,
    kit: KEYS_KIT,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
    models: { keysRoadside, keysIdentity },
  });
  const deer = items.filter((it) => it.rule.startsWith('key-deer'));

  /** The 8 corners of a deer's box in the world, as the layer draws it: scaled, turned and set down. */
  function corners(d: RoadsideItem, size = d.size): Vector3[] {
    const g = keysIdentity.variants[d.variant]!;
    g.computeBoundingBox();
    const box = g.boundingBox!;
    const out: Vector3[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z])
          out.push(
            new Vector3(
              d.p.x + size * (x * Math.cos(d.turn) + z * Math.sin(d.turn)),
              d.p.y + size * y,
              d.p.z + size * (z * Math.cos(d.turn) - x * Math.sin(d.turn)),
            ),
          );
    return out;
  }
  const sightOf = (d: RoadsideItem, size = d.size) =>
    chaseSight(road, edge.index, Math.max(0, d.s - READ_FROM_M), 1.7, SPEED_MPS, corners(d, size));

  it(`each deer is in the frame ${READ_FROM_M} m before it and at least ${MIN_PX} px tall on the phone`, () => {
    expect(deer.length).toBeGreaterThan(0);
    const heights = deer.map((d) => sightOf(d).heightPx);
    print(
      `seed ${seed}: ${deer.length} deer, ${Math.min(...heights).toFixed(1)} to ${Math.max(...heights).toFixed(1)} px tall from ${READ_FROM_M} m at ${SPEED_MPS} m/s on a 412 px screen`,
    );
    for (const d of deer) {
      const sight = sightOf(d);
      expect(sight.inView, `deer at s ${d.s.toFixed(0)} is in the frame`).toBe(true);
      expect(sight.heightPx, `deer at s ${d.s.toFixed(0)}, variant ${d.variant}`).toBeGreaterThanOrEqual(
        MIN_PX,
      );
    }
  });

  it('the measure can tell: the does at their true size fall under the line (control)', () => {
    const does = deer.filter((d) => d.variant === 1);
    expect(does.length, 'a doe stands somewhere').toBeGreaterThan(0);
    for (const d of does)
      expect(sightOf(d, 1).heightPx, `doe at s ${d.s.toFixed(0)} at size 1`).toBeLessThan(MIN_PX);
  });

  it('the first herd is whole in the frame from 25 m before it', () => {
    const herd = deer.filter((d) => d.rule === 'key-deer-herd');
    expect(herd.length).toBeGreaterThanOrEqual(3);
    for (const side of [-1, 1]) {
      const row = herd.filter((d) => Math.sign(d.d) === side).sort((a, b) => a.s - b.s);
      const first = row[0];
      if (!first) continue;
      // Deer of this herd are within 5 m of the last: the run from the first.
      const run = [first];
      for (const d of row.slice(1))
        if (d.s - run[run.length - 1]!.s <= 5) run.push(d);
        else break;
      for (const d of run) {
        const sight = chaseSight(road, edge.index, Math.max(0, first.s - 25), 1.7, SPEED_MPS, corners(d));
        expect(sight.inView, `deer at s ${d.s.toFixed(0)} of the herd at s ${first.s.toFixed(0)}`).toBe(true);
      }
    }
  });
});
