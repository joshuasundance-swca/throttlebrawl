// The thin posts leave a chunk sooner than the lines (polish J3, punch item 1). Polish G's live check: the busiest
// Bridge City frame, 112 of 120 draw calls, was the takedown framing aimed down a side street, where chunks 244 and
// 281 m away drew their delineator posts (four draw calls with a rail post) though a 0.15 m post 200 m off is a
// sliver 0.27 px wide. The lines keep ROAD_FINE_DRAW_M (a line is as long as the road, a post is a dot); a post stays
// to ROAD_POST_DRAW_M.
import { Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { createFlatLook } from './look';
import { buildRoadScene, chunkDistance, ROAD_FINE_DRAW_M, ROAD_POST_DRAW_M } from './road-mesh';

const look = createFlatLook();

describe('the road leaves its thin posts out of a chunk wholly past ROAD_POST_DRAW_M, its lines at ROAD_FINE_DRAW_M', () => {
  // A long straight-ish road, posts on every edge (a highway's), with chunks at every distance.
  const road = createRoadNetwork(
    fixtureNetwork(
      Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, lengthM: 400, kappa: i % 2 ? 0.0008 : -0.0006 })),
    ),
  );
  const rs = buildRoadScene(road, look, undefined, { postRoads: () => true });
  const meshes = (name: string) => {
    const found: { chunk: string; mesh: Object3D }[] = [];
    rs.group.traverse((o) => {
      if (o instanceof Mesh && o.name === name)
        found.push({ chunk: o.parent?.name.replace('road-chunk-', '') ?? '', mesh: o });
    });
    return found;
  };

  it('is a post a chunk holds, drawn only within ROAD_POST_DRAW_M, while the same chunk keeps its markings to ROAD_FINE_DRAW_M', () => {
    expect(ROAD_POST_DRAW_M).toBeLessThan(ROAD_FINE_DRAW_M);
    let band = 0;
    let checked = 0;
    // Ride the road's whole length, an eye every 10 m.
    for (let e = 0; e < road.edges.length; e++) {
      for (let s = 0; s < road.edges[e]!.length; s += 10) {
        const eye = road.toWorld(e, s, 0, 2.6);
        rs.update(eye.x, eye.z, 0, 360);
        for (const name of ['road-posts', 'road-rail-posts']) {
          for (const { chunk, mesh } of meshes(name)) {
            const d = chunkDistance(chunk, eye.x, eye.z);
            expect(mesh.visible, `${name} ${chunk} at ${d.toFixed(0)} m`).toBe(d < ROAD_POST_DRAW_M);
            checked++;
          }
        }
        for (const { chunk, mesh } of meshes('road-marking')) {
          const d = chunkDistance(chunk, eye.x, eye.z);
          expect(mesh.visible, `road-marking ${chunk} at ${d.toFixed(0)} m`).toBe(d < ROAD_FINE_DRAW_M);
          // The control: a chunk in the band between the two, whose posts are gone and whose lines are not.
          if (d >= ROAD_POST_DRAW_M && d < ROAD_FINE_DRAW_M) {
            const posts = meshes('road-posts').find((p) => p.chunk === chunk);
            if (posts) {
              expect(posts.mesh.visible, `posts in ${chunk}`).toBe(false);
              expect(mesh.visible, `lines in ${chunk}`).toBe(true);
              band++;
            }
          }
        }
      }
    }
    // If no chunk with posts ever stood in the band, the check above looked at nothing.
    expect(checked).toBeGreaterThan(0);
    expect(band, 'chunks with posts seen between the two distances').toBeGreaterThan(0);
  });

  it('shows the posts again as the camera nears the chunk', () => {
    const far = meshes('road-posts').at(-1);
    if (!far) throw new Error('no posts');
    const [i = 0, j = 0] = far.chunk.split(',').map(Number);
    rs.update((i + 0.5) * 512, (j + 0.5) * 512, 0, 360);
    expect(far.mesh.visible).toBe(true);
  });
});
