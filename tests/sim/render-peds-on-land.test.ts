// Playtest 1b (2026-09-30, [decided]): "pedestrians stand in the water". The track is a causeway:
// the road meshes stopped at the verge and the sea (world y = 0) filled everything else, while the
// sim stands pedestrians at road height anywhere in their roadside zones (up to about 12 m out),
// crosses them to the far side and dives them 3.5 m further. Render now lays land under them.
//
// Over seeded bot races on the real base pack, every place a pedestrian (or animal) stood, walked
// or landed is checked the way the camera sees it: a ray straight down through the built road
// meshes must first meet land or road at the pedestrian's feet, not the sea or an embankment below.
import { InstancedMesh, Mesh, Raycaster, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { loadBasePack, lookup } from '../../src/content';
import { createFlatLook, type RoadDressing } from '../../src/render';
import { buildRoadScene } from '../../src/render/road-mesh';
import { createBatchRace, runSeededRace } from './batch';

describe('pedestrians stand on land (playtest 1b)', () => {
  it('never stands a pedestrian over open water', () => {
    const { config } = createBatchRace(1);
    const road = config.road;
    const reg = loadBasePack({ includeDrafts: true });
    const dressing: RoadDressing = Object.fromEntries(road.edges.map((e) => [e.id, lookup(reg.roads, e.id)]));
    const { group } = buildRoadScene(road, createFlatLook(), dressing);
    group.updateMatrixWorld(true);
    const meshes: Object3D[] = [];
    group.traverse((o) => {
      if (o instanceof Mesh && !(o instanceof InstancedMesh)) meshes.push(o);
    });

    // Every distinct spot (to 0.25 m) a pedestrian's feet were, over two seeded races.
    const spots = new Map<string, { x: number; z: number; ground: number; where: string }>();
    let pedTicks = 0;
    let dives = 0;
    for (const seed of [1, 2]) {
      runSeededRace(seed, {
        noReplay: true,
        onTick: (snap, events) => {
          dives += events.filter((ev) => ev.type === 'pedDive').length;
          for (const e of snap.entities) {
            if (e.kind !== 'ped') continue;
            pedTicks++;
            const key = `${Math.round(e.x * 4)}:${Math.round(e.z * 4)}`;
            if (spots.has(key)) continue;
            const edge = road.edges[e.road.edge]?.id ?? '?';
            spots.set(key, {
              x: e.x,
              z: e.z,
              ground: e.y - e.road.h,
              where: `${edge} s ${e.road.s.toFixed(0)} d ${e.road.d.toFixed(2)}`,
            });
          }
        },
      });
    }
    const ray = new Raycaster();
    const down = new Vector3(0, -1, 0);
    const wet: string[] = [];
    for (const p of spots.values()) {
      ray.set(new Vector3(p.x, p.ground + 20, p.z), down);
      const hit = ray.intersectObjects(meshes, false)[0];
      const name = hit?.object.name ?? 'nothing';
      const y = hit?.point.y ?? -Infinity;
      if (name === 'road-water' || y < p.ground - 0.25) wet.push(`${p.where}: ${name} at ${y.toFixed(2)}`);
    }
    console.log(
      `[examined] ${spots.size} distinct pedestrian spots (${pedTicks} pedestrian-ticks, ${dives} dives, seeds 1 and 2); ${wet.length} over water`,
    );
    expect(spots.size).toBeGreaterThan(20);
    expect(dives).toBeGreaterThan(0); // the dives, which carry pedestrians furthest, are in the sample
    expect(wet.slice(0, 10)).toEqual([]);
  });
});
