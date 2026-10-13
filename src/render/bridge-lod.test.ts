// A bridge's distant drawing must keep the road open. The generic scenery stand-in
// fills the space between the Seven Mile's two walls with a solid box.
import { Box3, Mesh, Triangle, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { BAY_KINDS, BAY_M } from './bridge-bays';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { buildRoadScene } from './road-mesh';
import { formsOf } from './scenery-merge';

const kit = await bakeRepoModel('sevenMileKit');

function cuts(geometry: BufferGeometry, box: Box3): number {
  const p = geometry.getAttribute('position');
  const start = geometry.drawRange.start;
  const end = Math.min(p.count, start + geometry.drawRange.count);
  const triangle = new Triangle();
  let hits = 0;
  for (let i = start; i + 2 < end; i += 3) {
    triangle.a.fromBufferAttribute(p, i);
    triangle.b.fromBufferAttribute(p, i + 1);
    triangle.c.fromBufferAttribute(p, i + 2);
    if (triangle.intersectsBox(box)) hits++;
  }
  return hits;
}

describe('the Seven Mile bridge drawing at scenery LOD distances', () => {
  for (const grade of [0, 0.06]) {
    for (const lodM of [0, 200]) {
      it(`keeps the ride space open on a ${grade} grade at scenery LOD ${lodM}`, () => {
        const road = createRoadNetwork(fixtureNetwork([{ id: 'bridge', lengthM: 1000, kappa: 0, grade }]));
        const scene = buildRoadScene(
          road,
          createFlatLook(),
          {
            bridge: {
              tags: [
                { s0: 0, s1: 1000, side: 'both', tag: 'bridge' },
                { s0: 0, s1: 18, side: 'both', tag: 'old-bridge' },
                { s0: 0, s1: 1000, side: 'both', tag: 'water-open' },
              ],
            },
          },
          { models: { sevenMileKit: kit }, roadsideDensity: 0, seed: 1 },
        );
        try {
          // Force the scenery's far path and inspect only triangles actually drawn,
          // rather than the unused near vertices in the same merged buffer.
          scene.update(0, 0, 0, 760, lodM, Infinity);
          const drawn: Mesh<BufferGeometry>[] = [];
          scene.group.traverse((o) => {
            if (o instanceof Mesh && o.name === 'road-scenery' && o.visible)
              drawn.push(o as Mesh<BufferGeometry>);
          });
          expect(drawn.length).toBeGreaterThan(0);
          const ahead = scene.bays.filter((s) => s.s > 320 && s.s < 550);
          expect(ahead.length).toBeGreaterThan(0);
          for (const spot of ahead) {
            const kind = BAY_KINDS[spot.variant]!;
            const p = road.toWorld(0, spot.s + BAY_M[kind] / 2, 0, 0);
            const box = new Box3(
              new Vector3(p.x - 0.3, p.y + 0.5, p.z - 0.3),
              new Vector3(p.x + 0.3, p.y + 2, p.z + 0.3),
            );
            expect(
              drawn.reduce((n, mesh) => n + cuts(mesh.geometry, box), 0),
              `${kind} at ${spot.s}`,
            ).toBe(0);
            // Clearing the road by hiding the distant bay is not a repair: its
            // underside must still be present in the same active draw ranges.
            const below = new Box3(
              new Vector3(p.x - 0.3, p.y - 2, p.z - 0.3),
              new Vector3(p.x + 0.3, p.y - 0.2, p.z + 0.3),
            );
            expect(
              drawn.reduce((n, mesh) => n + cuts(mesh.geometry, below), 0),
              `${kind} underside at ${spot.s}`,
            ).toBeGreaterThan(0);
          }
          // The same measure finds the offending centre wall in the generic far
          // model; the real near model leaves this space clear.
          const { near, far } = formsOf(kit.variants[ahead[0]!.variant]!);
          const centre = new Box3(new Vector3(-0.3, 0.5, 20), new Vector3(0.3, 2, 21));
          const intersects = (form: typeof near) => {
            const t = new Triangle();
            let n = 0;
            for (let i = 0; i < form.n; i += 3) {
              t.a.fromArray(form.pos, i * 3);
              t.b.fromArray(form.pos, (i + 1) * 3);
              t.c.fromArray(form.pos, (i + 2) * 3);
              if (t.intersectsBox(centre)) n++;
            }
            return n;
          };
          expect(intersects(near)).toBe(0);
          expect(intersects(far)).toBeGreaterThan(0);
        } finally {
          scene.dispose();
        }
      });
    }
  }
});
