// Playtest 1 item 10 [decided]: M1 "felt pretty slow"; the maintainer chose "faster + stronger
// cues". Render's cues: speed lines that rush past the edges of the view, and palms along the road
// for parallax. Both are sliders. The lines are checked where the camera sees them (projected), the
// palms where they stand (on the built road scene of the real track).
import { InstancedMesh, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import { createFlatLook } from './look';
import { buildRoadScene, ELEVATED_M } from './road-mesh';
import { MAX_STREAKS, SpeedLines } from './speed-lines';
import { defaultRenderParams, type RenderParams } from './tuning';

const look = createFlatLook();
const DT = 1 / 60;

function camera(aspect = 1248 / 576): PerspectiveCamera {
  const c = new PerspectiveCamera(66, aspect, 0.3, 1500);
  c.updateMatrixWorld(true);
  return c;
}

function run(speed: number, frames: number, params: Partial<RenderParams> = {}) {
  const p = { ...defaultRenderParams(), ...params };
  const lines = new SpeedLines(look, p);
  const cam = camera();
  for (let i = 0; i < frames; i++) lines.update(speed, DT, cam);
  return { lines, cam, p };
}

/** Where line i's near end lands on screen (normalized device coordinates). */
function onScreen(lines: SpeedLines, i: number, cam: PerspectiveCamera): Vector3 {
  const m = new Matrix4();
  lines.root.getMatrixAt(i, m);
  const p = new Vector3().setFromMatrixPosition(m);
  return p.project(cam);
}

describe('speed lines (playtest 1, item 10)', () => {
  it('stay hidden at everyday speeds and fade in toward top speed', () => {
    expect(run(0, 60).lines.counts()).toEqual({ level: 0, lines: 0 });
    expect(run(15, 60).lines.counts().level).toBe(0);
    const levels = [25, 32, 40, 45].map((v) => run(v, 120).lines.counts().level);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]!);
    const top = run(45, 240);
    expect(top.lines.counts().level).toBeCloseTo(top.p.streakOpacity, 2);
    expect(top.lines.counts().lines).toBe(top.p.streakCount);
    console.log(
      `[examined] speed-line opacity at 25, 32, 40 and 45 m/s: ${levels.map((l) => l.toFixed(2)).join(', ')}`,
    );
  });

  it('rush toward the camera faster, and streak longer, the faster you go', () => {
    const travel = (speed: number) => {
      const { lines, cam } = run(speed, 30);
      const before = lines.lineAt(0)!.z;
      lines.update(speed, DT, cam);
      const m = new Matrix4();
      lines.root.getMatrixAt(0, m);
      const length = new Vector3().setFromMatrixScale(m).z;
      return { dz: lines.lineAt(0)!.z - before, length };
    };
    const slow = travel(28);
    const fast = travel(44);
    expect(slow.dz).toBeGreaterThan(0);
    expect(fast.dz).toBeGreaterThan(slow.dz * 1.4);
    expect(fast.length).toBeGreaterThan(slow.length * 1.4);
  });

  it('keep out of the middle of the view, where the road ahead and oncoming traffic are', () => {
    const { lines, cam, p } = run(45, 600);
    let middle = 0;
    for (let i = 0; i < p.streakCount; i++) {
      const n = onScreen(lines, i, cam);
      if (Math.abs(n.x) < 0.25 && Math.abs(n.y) < 0.25) middle++;
    }
    expect(middle).toBe(0);
  });

  it('follow their sliders (non-default values change the result)', () => {
    expect(run(45, 240, { streakOpacity: 0 }).lines.counts().level).toBe(0);
    expect(run(45, 240, { streakOpacity: 0.9 }).lines.counts().level).toBeCloseTo(0.9, 2);
    expect(run(45, 240, { streakCount: 12 }).lines.counts().lines).toBe(12);
    expect(run(45, 240, { streakCount: 999 }).lines.counts().lines).toBe(MAX_STREAKS);
    expect(run(30, 240, { streakFromMps: 35 }).lines.counts().level).toBe(0);
    expect(run(30, 240, { streakFullMps: 30 }).lines.counts().level).toBeCloseTo(0.45, 2);
  });

  it('fade out again when you slow down', () => {
    const { lines, cam } = run(45, 120);
    for (let i = 0; i < 120; i++) lines.update(5, DT, cam);
    expect(lines.counts()).toEqual({ level: 0, lines: 0 });
    expect(lines.root.visible).toBe(false);
  });
});

// ---- Roadside palms ------------------------------------------------------------------------

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function realNetwork(): RoadNetwork {
  const roads = Object.values(roadFiles);
  const network = Object.values(networkFiles).find((n) =>
    n.roads.every((id) => roads.some((r) => r.id === id)),
  );
  if (!network) throw new Error('no baked network');
  return createRoadNetwork({ network, roads: roads.filter((r) => network.roads.includes(r.id)) });
}

function palms(road: RoadNetwork, density?: number): Vector3[] {
  const { group } = buildRoadScene(
    road,
    look,
    undefined,
    density === undefined ? {} : { roadsideDensity: density },
  );
  // Every chunk's palms (the road is merged per chunk).
  const m = new Matrix4();
  const out: Vector3[] = [];
  group.traverse((mesh) => {
    if (!(mesh instanceof InstancedMesh) || mesh.name !== 'road-palms') return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      out.push(new Vector3().setFromMatrixPosition(m));
    }
  });
  return out;
}

describe('roadside palms (playtest 1, item 10: parallax)', () => {
  const road = realNetwork();
  const base = palms(road);

  it('line the real track, more with the density slider and none at zero', () => {
    const dense = palms(road, 2);
    console.log(`[examined] ${base.length} palms at density 1, ${dense.length} at density 2`);
    expect(base.length).toBeGreaterThan(100);
    expect(dense.length).toBeGreaterThan(base.length * 1.6);
    expect(palms(road, 0)).toEqual([]);
  });

  it("stand clear of every road's drawn surface, near enough to pass close by", () => {
    let near = 0;
    for (const p of base) {
      let closest = Infinity;
      for (const e of road.edges) {
        for (let k = 0; k < e.count; k++) {
          const dx = p.x - (e.x[k] ?? 0);
          const dz = p.z - (e.z[k] ?? 0);
          closest = Math.min(closest, Math.hypot(dx, dz) - (e.dMax + 0.6));
        }
      }
      expect(closest, `palm at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeGreaterThan(0.9);
      if (closest < 8) near++;
    }
    // Parallax needs things close to the road: most palms stand within 8 m of its edge.
    expect(near).toBeGreaterThan(base.length * 0.8);
  });

  it('keeps off bridges', () => {
    // A road climbing onto a deck: palms only where it is still low.
    const climb = createRoadNetwork(fixtureNetwork([{ id: 'up', lengthM: 400, kappa: 0, grade: 0.1 }]));
    const onClimb = palms(climb);
    expect(onClimb.length).toBeGreaterThan(0);
    for (const p of onClimb) expect(p.y).toBeLessThan(ELEVATED_M);
    const flat = createRoadNetwork(fixtureNetwork([{ id: 'flat', lengthM: 400, kappa: 0 }]));
    const railed = buildRoadScene(flat, look, {
      flat: {
        barriers: [{ s0: 0, s1: 400, side: 'both', kind: 'rail' }],
        tags: [{ s0: 0, s1: 400, side: 'both', tag: 'bridge' }],
      },
    }).group.getObjectByName('road-palms');
    expect(railed).toBeUndefined();
  });
});
