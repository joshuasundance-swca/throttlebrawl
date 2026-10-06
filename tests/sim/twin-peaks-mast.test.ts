/// <reference types="vite/client" />
// The radio mast over the Twin Peaks summit road (playtest 4, run C's live check; the identity sheets' "Recognisable
// by": "the three-legged TV mast looms overhead"). The region draws it at 1.3 times, which for the far networks is
// what keeps a mast 5 km away more than a pixel tall; on this road it stands 440 to 550 m to the west, 36 degrees
// up, and the camera cut off its top and half of it. Run C's first fix drew a near mast at 0.7 times and held it
// whole at one place (s 1700, the rider near the centre line at 35 m/s) and past the finish; the fix check found
// its top still off the frame at s 1689 with the rider on the verge (d 7.0, 40 m/s).
//
// This holds it whole where a rider actually is: the real chase camera, ridden along the climb at the speeds a race
// reaches (8 to 40 m/s) and across the road from its centre line to the verge (d 0.5 to 7), at every point of the
// way to the finish where the mast is in the frame sideways (more than 10 percent in from the edge, where it is
// about to leave). Its top must be under the frame's top with room, and the whole mast must be tall enough to read.
// The controls are the same ride with the earlier 0.7 times piece and the region's 1.3 times piece, which the
// same check finds cut off. `radio-mast-near` is in the route's backdrop file; render/summit-lot.test.ts holds that
// every network draws one mast and never two.
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

const ASPECT = 915 / 412;
const FINISH_S = 1931;
const SPEEDS = [8, 12, 25, 40]; // m/s: a slow hairpin to the bikes' top speed
const OFFSETS = [0.5, 2, 5.5, 7]; // m from the centre line: the lane, the shoulder, the verge
const EDGE = 0.9; // the frame's side, as a share of its half width: past it the mast is leaving
const TOP_ROOM = 0.9; // the mast's top must stay under this share of the frame's half height

const geo = geoFrame(backdropNet.originLatDeg, backdropNet.originLonDeg);
const edge = road.edgeIndex('osm-sf-twin-peaks-climb');

interface Shot {
  s: number;
  cam: PerspectiveCamera;
}

/** The chase camera as it rides the climb from s0 to the finish at `speed`, `d` m off the centre line, a frame in 6. */
function ride(d: number, speed: number, s0 = 1000): Shot[] {
  const target = (s: number): CameraTarget => {
    const w = road.toWorld(edge, s, d, 0);
    const f = road.frameAt(edge, s);
    return {
      id: 4,
      x: w.x,
      y: w.y,
      z: w.z,
      heading: Math.atan2(-f.tx, -f.tz),
      speed,
      lean: 0,
      road: { edge },
    };
  };
  const cam = createFollowCamera({ road });
  cam.setShakeAmount(0);
  cam.snap(target(s0), { aspect: ASPECT });
  const shots: Shot[] = [];
  let s = s0;
  for (let n = 1; s < FINISH_S; n++) {
    s += speed / 60;
    const pose = cam.update(target(s), 1 / 60, { aspect: ASPECT });
    if (n % 6 !== 0) continue;
    const c = new PerspectiveCamera(pose.fov, ASPECT, 0.3, 1500);
    c.position.set(pose.x, pose.y, pose.z);
    c.up.set(pose.upX, pose.upY, pose.upZ);
    c.lookAt(pose.lookX, pose.lookY, pose.lookZ);
    c.updateMatrixWorld(true);
    shots.push({ s, cam: c });
  }
  return shots;
}

/** Where a piece's top, middle and foot land in a camera's frame. */
function project(piece: MastPiece, c: PerspectiveCamera) {
  const [mx, mz] = geo.toWorld(piece.at[0], piece.at[1]);
  const height = piece.heightM * (piece.exaggerate ?? 1);
  const at = (y: number) => {
    const v = new Vector3(mx, (piece.baseM ?? 0) + y, mz);
    return { ahead: v.clone().applyMatrix4(c.matrixWorldInverse).z < 0, ...v.project(c) };
  };
  return { top: at(height), middle: at(height / 2), foot: at(0) };
}

const rides = OFFSETS.flatMap((d) => SPEEDS.map((v) => ({ d, v, shots: ride(d, v) })));

/** Every shot of every ride where the piece is in the frame sideways, with its top and its screen height. */
function inView(piece: MastPiece) {
  const rows: { s: number; d: number; v: number; topY: number; topX: number; height: number }[] = [];
  for (const { d, v, shots } of rides) {
    for (const { s, cam } of shots) {
      const p = project(piece, cam);
      if (!p.middle.ahead || !p.top.ahead || Math.abs(p.middle.x) > EDGE) continue;
      rows.push({ s, d, v, topY: p.top.y, topX: p.top.x, height: p.top.y - p.foot.y });
    }
  }
  return rows;
}

describe('the radio mast over the Twin Peaks summit road', () => {
  const near = inView(nearMast);
  const worst = near.reduce((a, r) => (r.topY > a.topY ? r : a), near[0]!);

  it('is in the frame on the way up, so the check has something to find (control: it is seen at all speeds and offsets)', () => {
    expect(near.length).toBeGreaterThan(500);
    for (const { d, v } of rides)
      expect(
        near.some((r) => r.d === d && r.v === v),
        `d ${d}, ${v} m/s`,
      ).toBe(true);
    // And never past the finish line, where a racer does not ride.
    expect(Math.max(...near.map((r) => r.s))).toBeLessThanOrEqual(FINISH_S + 3);
  });

  it('stands whole wherever it is in the frame, from the verge to the centre, at every speed a race reaches', () => {
    stdout.write(
      `[examined] radio mast, ${near.length} frames over ${rides.length} rides (d ${OFFSETS.join('/')} m, ${SPEEDS.join('/')} m/s, s 1000 to the finish at ${FINISH_S}, aspect ${ASPECT.toFixed(2)}): worst top at y ${worst.topY.toFixed(2)} (s ${worst.s.toFixed(0)}, d ${worst.d}, ${worst.v} m/s); the frame's top is 1
`,
    );
    expect(worst.topY, 'its top is under the frame with room').toBeLessThan(TOP_ROOM);
    for (const r of near) {
      expect(Math.abs(r.topX), `s ${r.s.toFixed(0)}: its top is across the frame`).toBeLessThan(0.97);
    }
  });

  it('is still tall enough to read as the mast, not a speck', () => {
    const shortest = near.reduce((a, r) => (r.height < a.height ? r : a), near[0]!);
    stdout.write(
      `[examined] radio mast screen height: the shortest ${shortest.height.toFixed(2)} of the frame's 2 (s ${shortest.s.toFixed(0)}, d ${shortest.d}, ${shortest.v} m/s), about ${(shortest.height * 206).toFixed(0)} px on a 412 px screen
`,
    );
    // A tenth of the frame's height at its smallest (the far end of the climb, at the edge).
    expect(shortest.height).toBeGreaterThan(0.2);
  });

  it('control: the earlier 0.7 times mast and the region 1.3 times mast are cut off on the same rides', () => {
    for (const times of [0.7, 1.3]) {
      const piece = { ...nearMast, exaggerate: times } as MastPiece;
      const cut = inView(piece).filter((r) => r.topY >= 1);
      stdout.write(`[examined] radio mast at ${times} times: top out of the frame in ${cut.length} frames of the same rides
`);
      expect(cut.length, `${times} times`).toBeGreaterThan(50);
    }
    expect(regionMast.exaggerate ?? 1).toBeGreaterThan(1);
  });
});
