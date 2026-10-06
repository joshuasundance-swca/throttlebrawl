// Duval's two rows of buildings close the street's view (playtest 4, run B's fix check, punch item 8: "Duval s 288:
// a sliver of sea still shows at the right edge, behind the second row"). The ground behind the front row ends
// 72 m from the road, and the sea lies past it, so a gap that both rows leave open shows the sea to a rider. The
// real chase camera, settled behind a rider at the bot's 38 m/s on the phone's 915 by 412 screen, sends rays
// through the outer fifth of each side of the frame. A ray that reaches the ground plane past the drawn land,
// with no building or tree in the way, is a ray that sees the sea. Asked: none does, at the frames round the one the
// check took (s 288 on Duval Street, the right edge) and all along both streets (the Gulf end, where the shore
// keeps the street open, apart). Each with its control: the street with no buildings shows the sea.
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../../src/road';
import { createFlatLook } from '../../src/render/look';
import { bakeRepoModel } from '../../src/render/model-files.test-util';
import { buildRoadScene, type RoadDressing } from '../../src/render/road-mesh';
import { KEYS_KIT, scatterRoadside, type RoadsideItem, type RoadsideRule } from '../../src/render/roadside';
import { settledPose } from './chase-sight.test-util';
import { blocks, type Occluder } from './occlusion.test-util';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);
const SPEED_MPS = 38;
const DUVAL = 'osm-keys-duval';
const STREET = 'osm-duval-street';

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

const keysRoadside = await bakeRepoModel('keysRoadside');
const duvalKit = await bakeRepoModel('duvalKit');
const keysIdentity = await bakeRepoModel('keysIdentity');
const palms = await bakeRepoModel('palms');
const models = { keysRoadside, duvalKit, keysIdentity };

function track(): { road: RoadNetwork; dressing: RoadDressing } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === DUVAL) ?? [];
  if (!network || !path) throw new Error(`no network ${DUVAL}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

/** The second row as it was before run B's fix check: half a house open, a 0.3 to 1.2 m gap, now and then a lot. */
const OLD_KIT = {
  ...KEYS_KIT,
  rules: KEYS_KIT.rules.map((r) => {
    if (r.id !== 'oldtown-back') return r;
    const before: RoadsideRule = { ...r, frontage: { gap: [0.3, 1.2], lotRate: 0.03, lotM: 6 } };
    delete before.behindOpenM;
    return before;
  }),
};

function scene(seed: number, kit: typeof KEYS_KIT = KEYS_KIT) {
  const { road, dressing } = track();
  const built = buildRoadScene(road, look, dressing, { seed, roadsideDensity: 1 });
  const items = scatterRoadside({
    road,
    dressing,
    seed,
    density: 1,
    kit,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
    models,
  });
  return { road, built, items };
}

/** Every roadside prop and palm of the scene that can stand in a ray's way, in the world. */
function occluders(
  items: readonly RoadsideItem[],
  spots: ReturnType<typeof scene>['built']['spots'],
): Occluder[] {
  const out: Occluder[] = [];
  for (const it of items) {
    const rule = KEYS_KIT.rules.find((r) => r.id === it.rule);
    const model = rule?.model ? models[rule.model as keyof typeof models] : keysRoadside;
    const geometry = model?.variants[it.variant];
    if (geometry) out.push({ geometry, x: it.p.x, y: it.p.y, z: it.p.z, turn: it.turn, size: it.size });
  }
  for (const sp of spots) {
    const geometry = sp.kind === 'palm' ? palms.variants[sp.variant] : undefined;
    if (geometry) out.push({ geometry, x: sp.p.x, y: sp.p.y, z: sp.p.z, turn: sp.turn, size: sp.size });
  }
  return out;
}

/** The rays through the outer fifth of each side of the frame: columns from the edge in, rows from above the horizon down. */
const COLUMNS = [0.62, 0.68, 0.74, 0.8, 0.86, 0.92, 0.98];
const ROWS = [0.3, 0.25, 0.2, 0.15, 0.1, 0.05, 0, -0.05, -0.1, -0.2, -0.3, -0.4];

/**
 * How many of those rays, on a side, reach the sea: past the drawn land, over the ground plane, with no building
 * between. `sea` is the camera's world position and the point; returns the count and where the first one landed.
 */
function seaRays(
  w: ReturnType<typeof scene>,
  all: readonly Occluder[],
  edge: number,
  s: number,
  side: -1 | 1,
): { n: number; first: string } {
  const e = w.road.edges[edge]!;
  const { pose, aspect } = settledPose(w.road, edge, s, 1.7, SPEED_MPS);
  const cam = new PerspectiveCamera(pose.fov, aspect, 0.3, 1500);
  cam.position.set(pose.x, pose.y, pose.z);
  cam.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  if (pose.roll) cam.rotateZ(pose.roll);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const ground = w.road.toWorld(edge, s, 0, 0).y;
  // The road's centre line near the rider, for the lateral distance of a point on the ground.
  const near: { x: number; z: number; s: number }[] = [];
  for (let u = Math.max(0, s - 150); u <= Math.min(e.length, s + 350); u += 5) {
    const p = w.road.toWorld(edge, u, 0, 0);
    near.push({ x: p.x, z: p.z, s: u });
  }
  const outer = Math.max(-e.dMin, e.dMax) + 0.6;
  let n = 0;
  let first = '';
  for (const col of COLUMNS)
    for (const row of ROWS) {
      const dir = new Vector3(side * col, row, 0.5).unproject(cam).sub(cam.position).normalize();
      if (dir.y >= -1e-4) continue; // up at the sky
      const t = (ground - cam.position.y) / dir.y;
      const hit = cam.position.clone().addScaledVector(dir, t);
      // Land is the strip past the verge, as far as the ground reaches at the nearest point of the road.
      let best = near[0]!;
      for (const p of near)
        if (Math.hypot(p.x - hit.x, p.z - hit.z) < Math.hypot(best.x - hit.x, best.z - hit.z)) best = p;
      const lateral = Math.hypot(best.x - hit.x, best.z - hit.z);
      if (lateral <= outer + w.built.landReach(edge, side, best.s)) continue;
      if (all.some((o) => blocks(o, cam.position, hit))) continue;
      n++;
      if (!first)
        first = `column ${col}, row ${row}: the ground at ${t.toFixed(0)} m, ${lateral.toFixed(0)} m off the road`;
    }
  return { n, first };
}

describe.each([1, 7, 42])('Duval shows no sea past its rows, seed %i', (seed) => {
  const w = scene(seed);
  const edge = w.road.edgeIndex(STREET);
  const all = occluders(w.items, w.built.spots);
  const noBuildings = occluders(
    w.items.filter((it) => !it.foot),
    w.built.spots,
  );

  it('at the frame the check took (Duval Street, around s 288, the right edge) no ray reaches the sea', () => {
    // The check's frame was the rider's at s 288, to a metre or two and a lane's width: the window round it.
    const seen = [264, 270, 276, 282, 288, 294, 300, 306, 312].map((s) => ({
      s,
      ...seaRays(w, all, edge, s, 1),
    }));
    print(
      `seed ${seed}, Duval Street s 264 to 312, right edge: rays to the sea of ${COLUMNS.length * ROWS.length}: ${seen.map((x) => `s ${x.s} ${x.n}`).join(', ')}`,
    );
    for (const x of seen) expect(x.n, `s ${x.s}: ${x.first}`).toBe(0);
  });

  it('the measure can tell: with no buildings at all, many rays reach the sea at s 288 (control)', () => {
    const seen = seaRays(w, noBuildings, edge, 288, 1);
    print(
      `seed ${seed}, s 288, no buildings: ${seen.n} of ${COLUMNS.length * ROWS.length} rays reach the sea`,
    );
    expect(seen.n).toBeGreaterThan(COLUMNS.length);
  });

  it('all along both streets, either edge, no ray reaches the sea (the Gulf end, where the shore opens the left, apart)', () => {
    const bad: string[] = [];
    let views = 0;
    for (const e of w.road.edges)
      for (let s = 60; s < e.length - 340; s += 24)
        for (const side of [-1, 1] as const) {
          views++;
          const seen = seaRays(w, all, e.index, s, side);
          if (seen.n > 0)
            bad.push(`${e.id} s ${s} ${side < 0 ? 'left' : 'right'}: ${seen.n} (${seen.first})`);
        }
    print(`seed ${seed}: ${views} views along both streets, ${bad.length} show the sea: ${bad.join('; ')}`);
    expect(bad).toEqual([]);
  });

  it('the measure can tell: the second row as it was shows the sea along the streets (control)', () => {
    const old = scene(seed, OLD_KIT);
    const oldAll = occluders(old.items, old.built.spots);
    let views = 0;
    let sea = 0;
    for (const e of old.road.edges)
      for (let s = 60; s < e.length - 340; s += 24)
        for (const side of [-1, 1] as const) {
          views++;
          if (seaRays(old, oldAll, e.index, s, side).n > 0) sea++;
        }
    print(`seed ${seed}, the old second row: ${sea} of ${views} views show the sea`);
    expect(sea).toBeGreaterThanOrEqual(10);
  });
});
