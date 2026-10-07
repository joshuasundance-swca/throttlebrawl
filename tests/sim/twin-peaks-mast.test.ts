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
// Polish H's live check then found the top off the frame at s 1680 on the verge, behind the position badge: the
// chase camera rolls with the rider's lean (0.3 of it, about 11 degrees at -0.55), which lifts a mast at the frame's
// side by up to half the frame's height, and these rides held lean 0. So they now hold the leans the climb asks of
// each speed, both ways, and the mast stands lower (its base at 174 m, where it was at the hill top's 254 m) so the roll
// leaves its top under the frame's top and its foot above the bottom, and clear of the HUD's top corners at the
// leans of an ordinary bend. The controls are the same ride with the old 254 m base, which the roll cuts off (and
// level it is whole), and with the earlier 0.7 times piece and the region's 1.3 times piece. `radio-mast-near` is in the route's backdrop file; render/summit-lot.test.ts holds that
// every network draws one mast and never two.
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createFollowCamera, type CameraTarget } from '../../src/camera';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../../src/road';
import type { BackdropNetworkFile, BackdropRegionFile, MastPiece } from '../../src/render/backdrop/data';
import { geoFrame } from '../../src/render/backdrop/geo';
import { HUD_SIZE, pauseBox, placedBox, type Box } from '../../src/ui/hud-layout';
import type { LayoutElement } from '../../src/core/layout';

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
// The rider's lean, radians (positive right). The sim clamps it at 0.8 (`MAX_LEAN` in sim/riders) and sets it to
// atan(speed x turn rate / g), so on this twisty climb the most a rider leans at a speed is what the road's sharpest
// bend asks of that speed, up to the clamp (a hairpin at 12 m/s, the clamp itself from 25 m/s). The chase camera rolls
// with a share of it (`camera.rollFraction`, 0.3: about 9 degrees at 0.55, 14 at 0.8), which lifts the mast's top on
// the side it leans toward (polish H's verge check found the top off the frame at s 1680 with a held -0.55).
const MAX_LEAN = 0.8;
const G = 9.81;
const EDGE = 0.9; // the frame's side, as a share of its half width: past it the mast is leaving
const TOP_ROOM = 0.9; // the mast's top must stay under this share of the frame's half height
const FOOT_ROOM = -0.9; // and its foot above this one: a mast that is whole has both ends in the frame
const W = 915; // the phone held sideways, CSS px
const H = 412;

// The top corners the HUD paints over the road: the position badge (the Classic layout's place for it, at its
// widest) and the pause button, on the right-handed layout and its left-handed mirror, each with the layout's 6 px
// of air (`GAP`). A mast behind one of them is half hidden where it first shows (polish H: "behind the position
// badge" at s 1680). In the frame's own coordinates: x from -1 (left) to 1, y from -1 (bottom) to 1.
const classic = Object.values(
  import.meta.glob<{ elements: LayoutElement[] }>('../../packs/base/hud/classic.json', {
    eager: true,
    import: 'default',
  }),
)[0]!;
const positionEl = classic.elements.find((e) => e.element === 'position')!;
const AIR = 6;
const toFrame = (b: Box) => ({
  x0: ((b.left - AIR) / W) * 2 - 1,
  x1: ((b.right + AIR) / W) * 2 - 1,
  y0: 1 - ((b.bottom + AIR) / H) * 2,
  y1: 1 - ((b.top - AIR) / H) * 2,
});
const HUD_BOXES = [false, true].flatMap((mirror) => [
  toFrame(placedBox(positionEl, W, H, mirror, HUD_SIZE.position)),
  toFrame(pauseBox(W, { top: 0, right: 0, bottom: 0, left: 0 }, mirror)),
]);

const geo = geoFrame(backdropNet.originLatDeg, backdropNet.originLonDeg);
const edge = road.edgeIndex('osm-sf-twin-peaks-climb');

/** The most lean the climb asks of a rider at `speed`, from its sharpest bend, capped at the sim's clamp. */
function leanReach(speed: number): number {
  let reach = 0;
  for (let s = 1000; s < FINISH_S; s += 2) {
    const a = road.frameAt(edge, s);
    const b = road.frameAt(edge, s + 2);
    let turn = Math.atan2(-b.tx, -b.tz) - Math.atan2(-a.tx, -a.tz);
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    reach = Math.max(reach, Math.abs(Math.atan((speed * speed * (turn / 2)) / G)));
  }
  return Math.min(MAX_LEAN, reach);
}
/** The leans held for a ride at `speed`: both ways, from none to the most the climb asks. */
const leansFor = (speed: number): number[] => {
  const reach = leanReach(speed);
  const held = reach >= 0.55 ? [-0.55, 0.55] : []; // the lean polish H's verge ride held at 28.5 m/s
  return [-reach, -reach / 2, 0, reach / 2, reach, ...held].map((l) => Math.round(l * 100) / 100);
};

interface Shot {
  s: number;
  cam: PerspectiveCamera;
}

/** The chase camera as it rides the climb from s0 to the finish at `speed`, `d` m off the centre line, a frame in 6. */
function ride(d: number, speed: number, lean: number, s0 = 1000): Shot[] {
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
      lean,
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
  return { top: at(height), middle: at(height / 2), foot: at(0), at, height };
}

/** Whether the mast's centre line, foot to top, crosses a HUD box (the legs spread wider, so this is the least). */
function behindHud(p: ReturnType<typeof project>): boolean {
  for (let k = 0; k <= 24; k++) {
    const q = p.at((p.height * k) / 24);
    if (!q.ahead) continue;
    if (HUD_BOXES.some((b) => q.x >= b.x0 && q.x <= b.x1 && q.y >= b.y0 && q.y <= b.y1)) return true;
  }
  return false;
}

const rides = OFFSETS.flatMap((d) =>
  SPEEDS.flatMap((v) => leansFor(v).map((lean) => ({ d, v, lean, shots: ride(d, v, lean) }))),
);

/** Every shot of every ride where the piece is in the frame sideways, with its top and its screen height. */
function inView(piece: MastPiece) {
  const rows: {
    s: number;
    d: number;
    v: number;
    lean: number;
    topY: number;
    topX: number;
    footY: number;
    height: number;
  }[] = [];
  for (const { d, v, lean, shots } of rides) {
    for (const { s, cam } of shots) {
      const p = project(piece, cam);
      if (!p.middle.ahead || !p.top.ahead || Math.abs(p.middle.x) > EDGE) continue;
      rows.push({ s, d, v, lean, topY: p.top.y, topX: p.top.x, footY: p.foot.y, height: p.top.y - p.foot.y });
    }
  }
  return rows;
}

/**
 * Every shot of every ride (at a lean of `maxLean` or less) where the mast's centre line crosses a HUD corner box.
 * The whole-mast window is 1.8 of the frame's 2 and the roll alone moves a mast at the frame's side by 0.5 each way
 * at the sim's full lean, so the corners are held for the leans of an ordinary bend (the 0.55 polish H rode), not the
 * clamp: past it the mast may pass behind a corner for the moment a hard bend lasts.
 */
function behindTheHud(piece: MastPiece, maxLean = 0.55) {
  return rides.flatMap(({ d, v, lean, shots }) =>
    (Math.abs(lean) > maxLean ? [] : shots)
      .filter(({ cam }) => behindHud(project(piece, cam)))
      .map(({ s }) => ({ s, d, v, lean })),
  );
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
      `[examined] radio mast, ${near.length} frames over ${rides.length} rides (d ${OFFSETS.join('/')} m, ${SPEEDS.join('/')} m/s, lean up to ${SPEEDS.map((v) => `${leanReach(v).toFixed(2)} at ${v}`).join(', ')} m/s, s 1000 to the finish at ${FINISH_S}, aspect ${ASPECT.toFixed(2)}): worst top at y ${worst.topY.toFixed(2)} (s ${worst.s.toFixed(0)}, d ${worst.d}, ${worst.v} m/s, lean ${worst.lean}); the frame's top is 1
`,
    );
    expect(worst.topY, 'its top is under the frame with room').toBeLessThan(TOP_ROOM);
    const lowest = near.reduce((a, r) => (r.footY < a.footY ? r : a), near[0]!);
    stdout.write(
      `[examined] radio mast foot: the lowest at y ${lowest.footY.toFixed(2)} (s ${lowest.s.toFixed(0)}, d ${lowest.d}, ${lowest.v} m/s, lean ${lowest.lean}); the frame's bottom is -1
`,
    );
    expect(lowest.footY, "its foot is above the frame's bottom with room").toBeGreaterThan(FOOT_ROOM);
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

  it('keeps clear of the position badge and the pause button, so it is never half hidden where it first shows', () => {
    const behind = behindTheHud(nearMast);
    stdout.write(
      `[examined] radio mast behind the HUD's top corners (${HUD_BOXES.length} boxes: position badge and pause button, right- and left-handed, ${AIR} px of air): ${behind.length} of ${rides.filter((r) => Math.abs(r.lean) <= 0.55).reduce((n, r) => n + r.shots.length, 0)} frames
`,
    );
    const hard = behindTheHud(nearMast, MAX_LEAN).length;
    stdout.write(`[examined] radio mast behind a HUD corner at the full lean (0.8): ${hard} frames, left to the hard bend
`);
    expect(behind.slice(0, 3)).toEqual([]);
  });

  it("holds polish H's verge ride whole: d 7, 28.5 m/s, a held lean of -0.55, from s 1300, over s 1600 to 1700", () => {
    // Polish H read the top at 1.00 to 1.09 at "s 1680 to 1682" and 0.75 to 0.77 at s 1689. This ride reads 0.74 at
    // s 1689 and its old-base top passes 1.0 where the mast is as far to the side as theirs was (x -0.74 to -0.85),
    // about 25 m earlier on the road: their s is the rider's, the camera trails it, so only the window matters.
    const frames = (piece: MastPiece) =>
      ride(7, 28.5, -0.55, 1300)
        .filter(({ s }) => s >= 1600 && s <= 1700)
        .map(({ s, cam }) => ({ s, p: project(piece, cam) }))
        .filter(({ p }) => p.middle.ahead && p.top.ahead && Math.abs(p.middle.x) <= EDGE);
    const tops = frames(nearMast).map(({ p }) => p.top.y);
    const before = frames({ ...nearMast, baseM: 254 }).map(({ p }) => p.top.y);
    stdout.write(
      `[examined] radio mast on polish H's verge ride, s 1600 to 1700 (${tops.length} frames): the top at most y ${Math.max(...tops).toFixed(2)} (254 m base: ${Math.max(...before).toFixed(2)}; the frame's top is 1)
`,
    );
    expect(tops.length).toBeGreaterThan(10);
    expect(Math.max(...tops)).toBeLessThan(TOP_ROOM);
    expect(
      Math.max(...before),
      'control: the old base is off the top, as polish H saw',
    ).toBeGreaterThanOrEqual(1);
  });

  it('control: the mast on the hill top (254 m, before polish N1) is cut off by the roll, and only by the roll', () => {
    const old = { ...nearMast, baseM: 254 };
    const rows = inView(old);
    const cut = rows.filter((r) => r.topY >= 1);
    const level = rows.filter((r) => r.lean === 0);
    const verge = rows.filter((r) => r.lean === -0.55 && r.v === 25 && r.d === 7);
    stdout.write(
      `[examined] radio mast at 254 m: top out of the frame in ${cut.length} frames (${cut.filter((r) => r.lean === 0).length} of them level), worst level ${Math.max(...level.map((r) => r.topY)).toFixed(2)}, worst held -0.55 on the verge at 25 m/s ${Math.max(...verge.map((r) => r.topY)).toFixed(2)}
`,
    );
    expect(cut.length).toBeGreaterThan(100);
    expect(Math.max(...level.map((r) => r.topY)), 'level, the old piece was whole (run C fix)').toBeLessThan(
      TOP_ROOM,
    );
    expect(Math.max(...verge.map((r) => r.topY)), 'rolled, it is not').toBeGreaterThan(1);
    expect(behindTheHud(old).length, 'and it sat behind the badge').toBeGreaterThan(100);
    expect(rows.filter((r) => r.footY < FOOT_ROOM).length, 'it was never off the bottom').toBe(0);
  });

  it('control: the earlier 0.7 times mast and the region 1.3 times mast are cut off on the same rides', () => {
    for (const times of [0.7, 1.3]) {
      const piece = { ...nearMast, baseM: 254, exaggerate: times } as MastPiece;
      const cut = inView(piece).filter((r) => r.topY >= 1);
      stdout.write(`[examined] radio mast at ${times} times: top out of the frame in ${cut.length} frames of the same rides
`);
      expect(cut.length, `${times} times`).toBeGreaterThan(50);
    }
    expect(regionMast.exaggerate ?? 1).toBeGreaterThan(1);
  });
});
