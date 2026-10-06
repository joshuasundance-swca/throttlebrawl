/// <reference types="vite/client" />
// The radio mast over the Twin Peaks summit road (playtest 4, run C's live check; the identity sheets' "Recognisable
// by": "the three-legged TV mast looms overhead"). The region draws it at 1.3 times, which for the far networks is
// what keeps a mast 5 km away more than a pixel tall; on this road it stands 440 to 550 m to the west, 36 degrees
// up, and the camera cut off its top and half of it. The route draws its own near mast at 0.7 times
// (`radio-mast-near` in its network's backdrop file; render/summit-lot.test.ts holds that every network draws one
// mast and never two). This is the check that the real chase camera, on a phone held sideways, now has the whole
// mast in the picture where it stands ahead of the rider: about s 1700 and the last 20 m of the road; at s 1650
// and 1750 the camera, tipped down the grade, still cuts its top, and at the finish the mast is behind the rider.
// The control is the region's own 1.3 times piece on the same cameras, which loses its top every time.
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createFollowCamera, type CameraTarget } from '../../src/camera';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../../src/road';
import type { BackdropNetworkFile, BackdropRegionFile, MastPiece } from '../../src/render/backdrop/data';
import { geoFrame } from '../../src/render/backdrop/geo';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-sf/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-sf/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const backdropRegion = Object.values(
  import.meta.glob<BackdropRegionFile>('../../packs/region-sf/assets/backdrop/san-francisco/region.json', {
    eager: true,
    import: 'default',
  }),
)[0]!;
const backdropNet = Object.entries(
  import.meta.glob<BackdropNetworkFile>(
    '../../packs/region-sf/assets/backdrop/san-francisco/networks/*.json',
    {
      eager: true,
      import: 'default',
    },
  ),
).find(([k]) => k.endsWith('/osm-sf-twin-peaks.json'))![1];

const network = Object.values(networkFiles).find((n) => n.id === 'osm-sf-twin-peaks')!;
const road = createRoadNetwork({
  network,
  roads: Object.values(roadFiles).filter((r) => network.roads.includes(r.id)),
});
const regionMast = backdropRegion.pieces.find((p) => p.id === 'radio-mast') as MastPiece;
const nearMast = (backdropNet.pieces ?? []).find((p) => p.id === 'radio-mast-near') as MastPiece;

/** Where the mast's top and its middle land in the frame at s, with the real chase camera at 35 m/s on a phone. */
function framed(piece: MastPiece, s: number) {
  const geo = geoFrame(backdropNet.originLatDeg, backdropNet.originLonDeg);
  const [mx, mz] = geo.toWorld(piece.at[0], piece.at[1]);
  const height = piece.heightM * (piece.exaggerate ?? 1);
  const e = road.edgeIndex('osm-sf-twin-peaks-climb');
  const w = road.toWorld(e, s, 1.7, 0);
  const f = road.frameAt(e, s);
  const target: CameraTarget = {
    id: 4,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: Math.atan2(-f.tx, -f.tz),
    speed: 35,
    lean: 0,
    road: { edge: e },
  };
  const cam = createFollowCamera({ road });
  cam.setShakeAmount(0);
  cam.snap(target, { aspect: 915 / 412 });
  let pose = cam.update(target, 1 / 60, { aspect: 915 / 412 });
  for (let n = 0; n < 90; n++) pose = cam.update(target, 1 / 60, { aspect: 915 / 412 });
  const c = new PerspectiveCamera(pose.fov, 915 / 412, 0.3, 1500);
  c.position.set(pose.x, pose.y, pose.z);
  c.up.set(pose.upX, pose.upY, pose.upZ);
  c.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  c.updateMatrixWorld(true);
  const at = (y: number) => {
    const v = new Vector3(mx, (piece.baseM ?? 0) + y, mz);
    return { ahead: v.clone().applyMatrix4(c.matrixWorldInverse).z < 0, ...v.project(c) };
  };
  return { top: at(height), middle: at(height / 2) };
}

describe('the radio mast over the Twin Peaks summit road', () => {
  it('stands whole in the picture where it is ahead of the rider (control: 1.3 times loses its top)', () => {
    const rows: string[] = [];
    for (const s of [1700, 1990, 2000, 2005]) {
      const near = framed(nearMast, s);
      const far = framed(regionMast, s);
      rows.push(
        `s ${s}: top y ${near.top.y.toFixed(2)} (1.3 times: ${far.top.y.toFixed(2)}), x ${near.middle.x.toFixed(2)}`,
      );
      expect(near.top.ahead && near.middle.ahead, `s ${s}: ahead of the camera`).toBe(true);
      expect(Math.abs(near.top.x), `s ${s}: across the frame`).toBeLessThan(0.97);
      expect(near.top.y, `s ${s}: its top under the frame's top`).toBeLessThan(0.97);
      expect(far.top.y, `s ${s}: the control's top is out of the frame`).toBeGreaterThan(1);
    }
    stdout.write(`[examined] the radio mast on a phone at 35 m/s: ${rows.join('; ')}\n`);
  });
});
