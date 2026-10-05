// Playtest 4 follow-up (2026-10-05, the maintainer: "in first person helmet view it seems easy to clip
// through cars for some reason?"). Part of finding out whether the clipping was drawn or real: every
// road vehicle of every pack is drawn no bigger than the box the sim collides it by (its type's
// widthM and lengthM, plus FOOTPRINT_MARGIN_M), whether it draws as a Blender model, a regional
// figure, an oddity or a code-made box. A drawn vehicle wider or longer than its sim box would show
// paint where the sim has empty road, so the bike (and the helmet camera) could ride into it.
// Measured before views.ts fitUnitFootprint: 17 of the 50 types reached past their boxes, worst the
// parked boat on its trailer (0.88 m past each end) and the PNW wagons (0.43 m); the Blender models
// already fit. The helmet clipping itself was the eye's lean (tests/sim/helmet-traffic.test.ts).
import { Box3, InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createFlatLook } from './look';
import {
  entitiesFor,
  isRoadVehicle,
  realSets,
  snapshotOf,
  typeDef,
  typeFiles,
} from './vehicle-pools.test-util';
import { EntityViews } from './views';

/** The examined lines, printed even when the tests pass. */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;

/** How far past its sim box a drawn vehicle may reach, m (a mirror, rounding in a model's numbers). */
const FOOTPRINT_MARGIN_M = 0.05;

describe('every road vehicle is drawn inside its sim box', () => {
  it('each type, drawn alone, reaches no further than its widthM and lengthM plus the margin', async () => {
    const ids = [...typeFiles().keys()].filter((id) => isRoadVehicle(typeDef(id))).sort();
    expect(ids.length).toBeGreaterThan(20);
    const sets = await realSets(ids);
    const lines: string[] = [];
    let worst = -Infinity;
    const over: string[] = [];
    for (const id of ids) {
      const def = typeDef(id);
      const views = new EntityViews(createFlatLook());
      views.setTrafficTypes([def]);
      views.setVehicleModels(sets);
      const e = entitiesFor([id], 1)[0];
      if (!e) throw new Error('no entity');
      views.sync(null, snapshotOf([e]), 1, 0);
      const meshes = views.root.children.filter(
        (o): o is InstancedMesh => o instanceof InstancedMesh && o.visible && o.count > 0,
      );
      expect(meshes, `${id} draws as one instanced mesh`).toHaveLength(1);
      const mesh = meshes[0] as InstancedMesh;
      const m4 = new Matrix4();
      mesh.getMatrixAt(0, m4);
      mesh.geometry.computeBoundingBox();
      const box = (mesh.geometry.boundingBox ?? new Box3()).clone().applyMatrix4(m4);
      const half = new Vector3(
        Math.max(Math.abs(box.min.x - e.x), Math.abs(box.max.x - e.x)),
        0,
        Math.max(Math.abs(box.min.z - e.z), Math.abs(box.max.z - e.z)),
      );
      const overW = half.x - def.widthM / 2;
      const overL = half.z - def.lengthM / 2;
      worst = Math.max(worst, overW, overL);
      lines.push(
        `${id} (${mesh.name}): drawn ${(2 * half.x).toFixed(2)} x ${(2 * half.z).toFixed(2)} m, sim ${def.widthM} x ${def.lengthM} m`,
      );
      if (overW > FOOTPRINT_MARGIN_M || overL > FOOTPRINT_MARGIN_M) over.push(lines[lines.length - 1] ?? id);
    }
    stdout.write(
      `[examined] ${ids.length} road vehicle types, drawn footprint vs sim box (worst reach past it ${worst.toFixed(3)} m):\n  ${lines.join('\n  ')}\n`,
    );
    expect(over, 'drawn past the sim box').toEqual([]);
  });
});
