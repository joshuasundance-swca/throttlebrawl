// The rest of the Keys (run W-U; the pitch deck's #7: "a mangrove boardwalk with airboats alongside,
// and a secret island"; interview, 2026-10-02, round 2). Built from the real baked Keys network:
// the boardwalk is drawn as planks and its split is painted, the secret island's fork off the
// sandbar is not, the airboats run in the boardwalk's channel clear of every road and pace a rider
// on the planks, and the island is a key of its own (a tiki bar, none of the conch town).
import { InstancedMesh, Mesh, Raycaster, Vector3, type Group, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import {
  AIRBOAT_MAX_MPS,
  AIRBOATS_PER_RUN,
  AirboatLayer,
  airboatParts,
  airboatRuns,
  paceTarget,
} from './airboats';
import { createFlatLook } from './look';
import { BOARD_M, buildRoadScene, type RoadDressing } from './road-mesh';
import { inDistrict, KEYS_KIT, scatterRoadside } from './roadside';
import { ISLET_CLEAR_M, type SideTag } from './scenery';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);

const network = Object.values(
  import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/keys-m1.json', {
    eager: true,
    import: 'default',
  }),
)[0] as BakedNetwork;
const roads = Object.values(
  import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
    eager: true,
    import: 'default',
  }),
).filter((r) => network.roads.includes(r.id));
const road: RoadNetwork = createRoadNetwork({ network, roads });
const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
const look = createFlatLook();
const id = (name: string) => road.edgeIndex(name);
const tagsOf = (edge: number): readonly SideTag[] => dressing[road.edges[edge]?.id ?? '']?.tags ?? [];

/** Every road surface mesh under a world point, top first. */
function hitsAt(group: Group, x: number, z: number): string[] {
  const ray = new Raycaster(new Vector3(x, 100, z), new Vector3(0, -1, 0), 0, 200);
  const meshes: Object3D[] = [];
  group.traverse((o) => {
    if (o instanceof Mesh && !(o instanceof InstancedMesh)) meshes.push(o);
  });
  return ray.intersectObjects(meshes, false).map((h) => h.object.name);
}

/** Metres from (x, z) to the nearest point of an edge's centreline (every 2 m). */
function distanceTo(edge: number, x: number, z: number): number {
  const e = road.edges[edge];
  let best = Infinity;
  for (let s = 0; e && s <= e.length; s += 2) {
    const p = road.toWorld(edge, s, 0, 0);
    best = Math.min(best, Math.hypot(p.x - x, p.z - z));
  }
  return best;
}

function snapAt(edge: number, s: number): SimSnapshot {
  const me = { id: 0, slot: 0, road: { edge, s, d: 0, dir: 1, yaw: 0 } } as unknown as EntitySnapshot;
  return { entities: [me] } as unknown as SimSnapshot;
}

describe('the Mangrove Boardwalk and Unlisted Key (keys-m1)', () => {
  const scene = buildRoadScene(road, look, dressing, { seed: 7 });
  scene.group.updateMatrixWorld(true);

  it("paints the boardwalk's split but never the secret island's fork off the sandbar", () => {
    const zones = road.splitZones();
    const painted = (toEdge: string) => {
      const z = zones.find((x) => road.edges[x.toEdge]?.id === toEdge);
      if (!z) throw new Error(`no zone onto ${toEdge}`);
      const p = road.toWorld(z.edge, (z.s0 + z.s1) / 2, (z.d0 + z.d1) / 2, 0);
      return hitsAt(scene.group, p.x, p.z).includes('road-splitZone');
    };
    expect(painted('c-boardwalk-in')).toBe(true);
    expect(painted('c-sandbar-flats-in')).toBe(true);
    expect(painted('c-unlisted-in')).toBe(false);
    print(`[examined] ${zones.length} split zones; the boardwalk's painted, the island's fork not`);
  });

  it('lays the boardwalk in planks, and nothing else', () => {
    const e = road.edges[id('m1-mangrove-boardwalk')];
    const expected = Math.floor((e?.length ?? 0) / BOARD_M);
    print(`[examined] ${scene.stats.boardSeams} plank seams on a ${e?.length.toFixed(0)} m boardwalk`);
    expect(scene.stats.boardSeams).toBeGreaterThanOrEqual(expected - 1);
    expect(scene.stats.boardSeams).toBeLessThanOrEqual(expected + 1);
    // Only the boardwalk is tagged for planks.
    const tagged = road.edges.filter((x) => tagsOf(x.index).some((t) => t.tag === 'boardwalk'));
    expect(tagged.map((x) => x.id)).toEqual(['m1-mangrove-boardwalk']);
  });

  it("finds one airboat run: the boardwalk's channel side", () => {
    const runs = airboatRuns(road, dressing);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ edge: id('m1-mangrove-boardwalk'), side: 1 });
    expect(airboatParts().length).toBeGreaterThan(10);
  });

  it('runs the airboats on the water, clear of every road, and paces a rider on the planks', () => {
    const runs = airboatRuns(road, dressing);
    const layer = new AirboatLayer(road, look, runs);
    const board = id('m1-mangrove-boardwalk');
    const others = road.edges.filter((e) => e.index !== board);
    const islands = [1, 7, 42].flatMap((seed) => {
      const built = buildRoadScene(road, look, dressing, { seed });
      const spots = built.spots.filter((sp) => ['islet', 'skiff', 'boat'].includes(sp.kind));
      built.dispose();
      return spots;
    });
    let t = 0;
    let checked = 0;
    let closest = Infinity;
    const clearOf = () => {
      for (const p of layer.positions()) {
        for (const e of others) {
          const half = Math.max(-e.dMin, e.dMax) + 0.6;
          const gap = distanceTo(e.index, p.x, p.z) - half;
          closest = Math.min(closest, gap);
          expect(gap, `${e.id} at boat s ${p.s.toFixed(0)}`).toBeGreaterThan(1.5);
        }
        // Out on the channel side of the boardwalk, past its edge.
        expect(distanceTo(board, p.x, p.z)).toBeGreaterThan(6);
        // Never through an island or a moored boat out in the channel, for any seed's scatter.
        for (const sp of islands) {
          const gap = Math.hypot(sp.p.x - p.x, sp.p.z - p.z) - (sp.kind === 'islet' ? ISLET_CLEAR_M : 6);
          expect(gap, `${sp.kind} at boat s ${p.s.toFixed(0)}`).toBeGreaterThan(1);
        }
        checked++;
      }
    };
    // Cruising with nobody near: up and down the channel.
    for (let f = 0; f < 1200; f++) {
      t += 1 / 30;
      layer.update(snapAt(id('m1-pelican-bridge'), 100), t, 1 / 30);
      if (f % 15 === 0) clearOf();
    }
    expect(layer.counts()).toEqual({ runs: 1, boats: AIRBOATS_PER_RUN, pacing: 0 });
    // A rider on the planks at 40 m/s: within a few seconds every boat runs alongside.
    let s = 60;
    for (let f = 0; f < 300; f++) {
      t += 1 / 30;
      s = Math.min(480, s + 40 / 30);
      layer.update(snapAt(board, s), t, 1 / 30);
      if (f % 10 === 0) clearOf();
    }
    expect(layer.counts().pacing).toBe(AIRBOATS_PER_RUN);
    const run = runs[0]!;
    layer.positions().forEach((p, k) => {
      const want = Math.min(run.s1, Math.max(run.s0, paceTarget(s, k, t)));
      expect(Math.abs(p.s - want), `boat ${k}`).toBeLessThan(AIRBOAT_MAX_MPS / 30 + 1);
    });
    print(
      `[examined] ${checked} airboat positions, closest to another road ${closest.toFixed(1)} m past its edge`,
    );
    layer.dispose();
  });

  it('makes the secret island a key of its own: a tiki bar, and none of the conch town', () => {
    const island = id('m1-unlisted-key');
    let tiki = 0;
    for (const seed of [1, 7, 42]) {
      const built = buildRoadScene(road, look, dressing, { seed });
      const items = scatterRoadside({
        road,
        dressing,
        seed,
        density: 1,
        kit: KEYS_KIT,
        landReach: (e, side, s) => built.landReach(e, side, s),
        spots: built.spots,
      });
      built.dispose();
      const here = items.filter((it) => it.edge === island);
      tiki += here.filter((it) => it.rule === 'tiki').length;
      for (const it of here) {
        expect(['cottage', 'picket', 'mailbox', 'pie'], it.rule).not.toContain(it.rule);
        expect(inDistrict(tagsOf(island), it.d < 0 ? 'left' : 'right', it.s, ['key-secret'])).toBe(true);
      }
    }
    print(`[examined] Unlisted Key over 3 seeds: ${tiki} tiki bars`);
    expect(tiki).toBeGreaterThan(0);
  });
});
