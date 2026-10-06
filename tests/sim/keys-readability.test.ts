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
import { KEYS_KIT, scatterRoadside, type RoadsideItem, type RoadsideRule } from '../../src/render/roadside';
import {
  DIGIT_CAP_EM,
  layoutRows,
  paintSurface,
  styleOfSurface,
  type SurfaceContext,
  type SurfaceStyle,
} from '../../src/render/text-surfaces';
import { chaseSight } from './chase-sight.test-util';
import { blockers, seen, type Occluder } from './occlusion.test-util';

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
const palms = await bakeRepoModel('palms');
const mangroves = await bakeRepoModel('mangroves');

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
      // A third of the drawn size, about the board's own centre: scale 3 back to the model's 1.
      const c = board.centre;
      const small = cornersOf(board).map((v) => c.clone().add(v.sub(c).multiplyScalar(1 / 3)));
      const sight = chaseSight(road, p.edge, Math.max(0, at - READ_FROM_M), 2, SPEED_MPS, small);
      if (sight.heightPx < MIN_BOARD_PX) under++;
      // A rider coming the other way stands ahead of the post, on the far lane: the board's back is to them.
      const w = road.toWorld(p.edge, at + READ_FROM_M, -2, 0);
      expect(board.normal.dot(new Vector3(w.x, w.y + 3, w.z).sub(board.centre))).toBeLessThan(0);
    }
    expect(under).toBe(posts.length);
  });
});

// Playtest 4, run B's fix check (punch item 4): "the mile posts' number does not read: 'MILE 4x' is a small
// single line, a white smudge at 16 m on a DPR-2 phone frame". The board's size on the screen is not the
// number's: what is asked is the DIGIT, as the painter draws it on the board, at 16 m on a DPR-2 phone.
describe('the Seven Mile`s mile numbers, as drawn, from the chase camera', () => {
  const READ_FROM_M = 16;
  const DPR = 2;
  /** A digit under this many device px tall is a smudge; the run B frame's number was about 2 (the control). */
  const MIN_DIGIT_DEVICE_PX = 14;
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
  /** The words a context was asked to paint, with the font size each was set in. */
  function recorder() {
    const calls: { text: string; size: number }[] = [];
    const ctx: SurfaceContext = {
      font: '',
      fillStyle: '',
      shadowColor: '',
      shadowBlur: 0,
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillRect() {},
      fillText(text) {
        calls.push({ text, size: Number(/(\d+)px/.exec(ctx.font)?.[1]) });
      },
      // Digits are about 0.6 of their size wide; the recorder measures them a little wide (0.72).
      measureText: (t) => ({ width: t.length * Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 0) * 0.72 }),
    };
    return { ctx, calls };
  }
  /** How tall the number's digits are on the device, px: the board's size on screen times the digit's share of it. */
  function digitDevicePx(p: (typeof posts)[number], style: SurfaceStyle): number {
    const board = boardOf(p);
    const text = `MILE ${p.params.number}`;
    const { rows } = layoutRows([{ id: 'n', text, style, aspect: board.widthM / board.heightM }]);
    const cell = rows[0]!.cell;
    const rec = recorder();
    paintSurface(rec.ctx, cell, style, text);
    const digits = rec.calls.filter((c) => /\d/.test(c.text));
    expect(digits.length, `mile ${p.params.number}: the number is painted`).toBeGreaterThan(0);
    const cap = Math.max(...digits.map((c) => c.size)) * DIGIT_CAP_EM;
    const at = (p.feature.s0 + p.feature.s1) / 2;
    const sight = chaseSight(road, p.edge, Math.max(0, at - READ_FROM_M), 2, SPEED_MPS, cornersOf(board));
    expect(sight.inView, `mile ${p.params.number} is in the frame ${READ_FROM_M} m before it`).toBe(true);
    return sight.heightPx * (cap / cell.h) * DPR;
  }

  it(`each number's digits are at least ${MIN_DIGIT_DEVICE_PX} device px tall ${READ_FROM_M} m before the post`, () => {
    expect(posts.length).toBe(7);
    const style = styleOfSurface('keys_mile_marker_face');
    const sizes = posts.map((p) => digitDevicePx(p, style));
    print(
      `mile numbers, digit height on a DPR ${DPR} phone from ${READ_FROM_M} m: ${posts.map((p, i) => `${p.params.number} ${sizes[i]!.toFixed(1)} px`).join(', ')}`,
    );
    for (const [i, px] of sizes.entries())
      expect(px, `mile ${posts[i]!.params.number}`).toBeGreaterThanOrEqual(MIN_DIGIT_DEVICE_PX);
  });

  it('the measure can tell: the number as run B saw it (one small line) is under the line (control)', () => {
    const oneLine: SurfaceStyle = { ...styleOfSurface('keys_mile_marker_face'), stack: false };
    for (const p of posts)
      expect(digitDevicePx(p, oneLine), `mile ${p.params.number} on one line`).toBeLessThan(
        MIN_DIGIT_DEVICE_PX / 2,
      );
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

  // Run B's fix check (punch item 6): "small brown shapes half hidden behind roadside bushes". What stands between
  // the camera and the deer: every other roadside prop, the scenery's palms and mangroves, and the other deer.
  const occluders = (placed: readonly RoadsideItem[]): Occluder[] => {
    const out: Occluder[] = [];
    for (const it of placed) {
      const rule = KEYS_KIT.rules.find((r) => r.id === it.rule);
      const model = rule?.model === 'keysIdentity' ? keysIdentity : keysRoadside;
      const geometry = model.variants[it.variant];
      if (geometry)
        out.push({
          geometry,
          x: it.p.x,
          y: it.p.y,
          z: it.p.z,
          turn: it.turn,
          size: it.size,
          label: `${it.rule} at s ${it.s.toFixed(0)}`,
        });
    }
    for (const sp of built.spots) {
      const geometry =
        sp.kind === 'palm'
          ? palms.variants[sp.variant]
          : sp.kind === 'mangrove'
            ? mangroves.variants[sp.variant]
            : undefined;
      if (geometry)
        out.push({
          geometry,
          x: sp.p.x,
          y: sp.p.y,
          z: sp.p.z,
          turn: sp.turn,
          size: sp.size,
          label: `${sp.kind} at s ${sp.s.toFixed(0)}`,
        });
    }
    return out;
  };
  /** Five points of a deer's body, in the world: two along the back at two heights, and the head's height. */
  const bodyPoints = (d: RoadsideItem): Vector3[] => {
    const g = keysIdentity.variants[d.variant]!;
    g.computeBoundingBox();
    const box = g.boundingBox!;
    const h = box.max.y - box.min.y;
    const along = (box.max.z - box.min.z) * 0.3;
    const local = [
      [0, 0.4 * h, -along],
      [0, 0.4 * h, along],
      [0, 0.75 * h, -along],
      [0, 0.75 * h, along],
      [0, 0.97 * h, 0],
    ] as const;
    return local.map(
      ([x, y, z]) =>
        new Vector3(
          d.p.x + d.size * (x * Math.cos(d.turn) + z * Math.sin(d.turn)),
          d.p.y + d.size * y,
          d.p.z + d.size * (z * Math.cos(d.turn) - x * Math.sin(d.turn)),
        ),
    );
  };
  /** Behind bush or tree: at least 4 of 5 points show. Behind a herd-mate (a herd is in a diagonal, still a row): 3. */
  const MIN_SEEN = 4;
  const MIN_SEEN_IN_HERD = 3;
  const VIEWS_M = [24, 16, 10];

  /** The views (deer, distance) where a deer shows fewer points than the lines above ask, for a scattering. */
  function hiddenViews(placed: readonly RoadsideItem[]) {
    const all = occluders(placed);
    const hidden: string[] = [];
    let worstBush = 5;
    let worstHerd = 5;
    const crowd = deerOfItems(placed);
    for (const d of crowd) {
      const others = all.filter((o) => !(o.x === d.p.x && o.z === d.p.z));
      const bushes = others.filter((o) => !o.label?.startsWith('key-deer'));
      for (const from of VIEWS_M) {
        const sight = chaseSight(road, edge.index, Math.max(0, d.s - from), 1.7, SPEED_MPS, bodyPoints(d));
        const behindBush = seen(sight.camera, bodyPoints(d), bushes);
        const behindAll = seen(sight.camera, bodyPoints(d), others);
        worstBush = Math.min(worstBush, behindBush);
        worstHerd = Math.min(worstHerd, behindAll);
        if (behindBush < MIN_SEEN || behindAll < MIN_SEEN_IN_HERD)
          hidden.push(
            `s ${d.s.toFixed(0)} from ${from} m: ${behindBush} past bushes, ${behindAll} in all (behind ${blockers(sight.camera, bodyPoints(d), others).join(', ')})`,
          );
      }
    }
    return { hidden, worstBush, worstHerd, count: crowd.length };
  }
  const deerOfItems = (placed: readonly RoadsideItem[]) =>
    placed.filter((it) => it.rule.startsWith('key-deer'));

  it(`each deer shows ${MIN_SEEN} of its 5 body points past any bush or tree, ${MIN_SEEN_IN_HERD} past the herd, from ${VIEWS_M.join(', ')} m before it`, () => {
    const { hidden, worstBush, worstHerd, count } = hiddenViews(items);
    expect(count).toBeGreaterThan(0);
    print(
      `seed ${seed}: ${count} deer, fewest body points seen of 5: ${worstBush} past bushes and trees, ${worstHerd} past the herd too; hidden views: ${hidden.length ? hidden.slice(0, 6).join('; ') : 'none'}`,
    );
    expect(hidden, 'views where a deer is half hidden').toEqual([]);
  });

  it('the measure can tell: deer placed as they were (last, among the sea grape, in a line) are half hidden in many views (control)', () => {
    const old = {
      ...KEYS_KIT,
      rules: KEYS_KIT.rules.map((r) => {
        if (!r.id.startsWith('key-deer')) return r;
        const before: RoadsideRule = { ...r, first: false, across: [3, 0.8] };
        delete before.sight;
        delete before.lean;
        return before;
      }),
    };
    const was = scatterRoadside({
      road,
      dressing,
      seed,
      density: 1,
      kit: old,
      landReach: (e, side, s) => built.landReach(e, side, s),
      spots: built.spots,
      models: { keysRoadside, keysIdentity },
    });
    const { hidden, count } = hiddenViews(was);
    print(`seed ${seed}: the old placement, ${count} deer, ${hidden.length} half-hidden views`);
    expect(hidden.length).toBeGreaterThan(count * 0.3);
  });

  it('the measure can tell: a bush stood a metre in front of a deer hides it (control)', () => {
    const d = deer[0]!;
    const bush = keysRoadside.variants[0]!;
    const sight = chaseSight(road, edge.index, Math.max(0, d.s - 16), 1.7, SPEED_MPS, bodyPoints(d));
    // A sea grape of the verge (variant 0) one metre toward the camera on the line to the deer's middle.
    const mid = bodyPoints(d)[1]!;
    const toCam = sight.camera.clone().sub(mid);
    toCam.y = 0;
    toCam.normalize();
    const stand = mid.clone().addScaledVector(toCam, 1);
    const hider: Occluder = { geometry: bush, x: stand.x, y: d.p.y, z: stand.z, turn: 0, size: 1.3 };
    expect(seen(sight.camera, bodyPoints(d), [hider])).toBeLessThan(MIN_SEEN);
    expect(seen(sight.camera, bodyPoints(d), [])).toBe(5);
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
