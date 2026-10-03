/// <reference types="vite/client" />
// Geometry invariants, the land (quality-confidence rec 3), on every network a route races on. The
// land is the same for every seed (only the scatter on it is seeded), so each network is built once:
// - no land gaps at junctions: the land never ends in mid-air, at a road's side or across a
//   junction (land-probe.test-util.ts openLandEnds: a ray looks under every drop of over 2 m, and
//   the walk steps from each road's end onto the joined road's), and the land strip meets its slope
//   with no sliver between them (land-seam.test.ts's walk across the strip's edge);
// - nothing over water: every place a pedestrian can stand, walk or dive to in a route's roadside
//   zones has land or road under it at its height (playtest 1b, "pedestrians stand in the water"),
//   read from the sim's own rules: anywhere across the zone, off the road, crossing to the far
//   side unless a rail stops it, and a 3.5 m dive either way.
// Before this, the land walks ran on hand-written lists of networks (regions.test.ts three,
// region-routes.test.ts six, land-seam.test.ts six) and the pedestrians on one Keys race.
import { BufferGeometry, Mesh, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { GroundTris, openLandEnds, type OpenLandEnd } from '../../src/render/land-probe.test-util';
import { buildRoadScene, networkTags, type RoadScene } from '../../src/render/road-mesh';
import { VergeLayer } from '../../src/render/verge';
import {
  against,
  DownIndex,
  look,
  print,
  routeNetworks,
  SURFACES,
  track,
  type KnownViolation,
  type RouteNetwork,
  type Track,
} from './geometry-routes';

const NETWORKS = routeNetworks();
const scenes = new Map<string, RoadScene>();
const sceneOf = (t: Track): RoadScene => {
  let s = scenes.get(t.id);
  if (!s) {
    s = buildRoadScene(t.road, look, t.dressing, { seed: 1 });
    scenes.set(t.id, s);
  }
  return s;
};
/** The verge layer's ground band, built as the race builds it with the road (render/index.ts). */
const verges = new Map<string, Object3D>();
const vergeOf = (t: Track): Object3D => {
  let g = verges.get(t.id);
  if (!g) {
    g = new VergeLayer(t.road, look, { tags: networkTags(t.road, t.dressing).tags }).group;
    verges.set(t.id, g);
  }
  return g;
};

// ---- The land strip and its slope meet with no sliver (land-seam.test.ts, every network) ----------

/**
 * A gap in the drawn ground: in one step the ground read falls more than this, and later in the
 * walk it comes back up by more than this in one step, to within GAP_BACK_M of where it fell from.
 * land-seam.test.ts compares a step with its two neighbours only, so a gap two steps (4 cm) or
 * wider, read as nothing twice in a row, passed it; this finds a gap of any width in the walk.
 */
const HOLE_M = 2;
const GAP_BACK_M = 1;
/**
 * What the seam walk reads: every drawn surface, the sea and the verge layer's ground band
 * (verge.ts) included. Another road's surface or the sea beside the strip is no gap; the sky, or
 * ground far below, seen through one is.
 */
const VISIBLE =
  /^(road-(land|water|road|shoulder|shortcut|deck|marking|splitZone|rampMark|boost|cableSlot)|verge-band)/;
const SEAM_STEP_M = 0.02;
const ROW_M = 2;

/** Walks across the land strip's outer edge on every road side, reading the drawn land straight down. */
export function seamHoles(t: Track, scene: RoadScene, land: DownIndex): { walks: number; holes: string[] } {
  let walks = 0;
  const holes: string[] = [];
  const hs: number[] = [];
  for (const e of t.road.edges) {
    const n = Math.max(1, Math.round(e.length / ROW_M));
    for (const side of [-1, 1] as const) {
      const outer = side < 0 ? -e.dMin + 0.6 : e.dMax + 0.6;
      for (let i = 0; i < n; i++) {
        for (const f of [0.3, 0.5, 0.7]) {
          const s = (e.length * (i + f)) / n;
          const r = scene.landReach(e.index, side, s);
          if (r <= 0) continue;
          walks++;
          hs.length = 0;
          // Off the rows' own lines by a few mm, so no ray lands exactly on a shared edge.
          for (let d = outer + Math.max(0, r - 1) + 0.0073; d <= outer + r + 1; d += SEAM_STEP_M) {
            const p = t.road.toWorld(e.index, s, side * d, 0);
            hs.push(land.at(p.x, p.z, p.y + 60)?.y ?? -Infinity);
          }
          // A gap: the ground falls away in one step, and later in the walk comes back up in one
          // step to about where it fell from. A steep face (a shelf, a cliff, a valley between two
          // roads' slopes) falls a step at a time and is no gap.
          let from: number | null = null;
          for (let k = 1; k < hs.length; k++) {
            const prev = hs[k - 1]!;
            const h = hs[k]!;
            if (from === null && h < prev - HOLE_M) from = prev;
            else if (from !== null && h > prev + HOLE_M && h >= from - GAP_BACK_M) {
              holes.push(`${t.id} seam ${e.id} s ${s.toFixed(0)} side ${side}`);
              break;
            }
          }
        }
      }
    }
  }
  return { walks, holes };
}

// ---- Pedestrians' ground (render-peds-on-land.test.ts, every route's zones) -----------------------

/** The sim's numbers (src/sim/peds/index.ts PEDS): off-road margin, crossing slack, the dive. */
const PED_MARGIN_M = 0.6;
const PED_FAR_SLACK_M = 1.5;
const PED_DIVE_M = 3.5;
/** Half the widest pedestrian or animal in the packs (the elk, 0.9 m). */
const PED_HALF_M = 0.45;
/** Ground this far under the pedestrian's road-height feet is an embankment below, not its ground. */
const PED_SINK_M = 0.25;

/** The places in every route's roadside zones a pedestrian can reach that have no ground under them. */
export function wetPeds(
  t: Track,
  net: RouteNetwork,
  ground: DownIndex,
): { zones: number; points: number; wet: string[] } {
  let zones = 0;
  let points = 0;
  const wet: string[] = [];
  for (const e of t.road.edges) {
    if (!net.allowed.has(e.id)) continue;
    for (const f of t.road.featuresOf(e.index, 'roadsideZone')) {
      zones++;
      const zoneSide = f.d0 + f.d1 < 0 ? -1 : 1;
      const far = Math.max(Math.abs(f.d0), Math.abs(f.d1));
      const s0 = Math.max(0, Math.min(f.s0, f.s1));
      const s1 = Math.min(e.length, Math.max(f.s0, f.s1));
      let bad = false;
      for (let s = s0; s <= s1 && !bad; s += 2) {
        let lo = 0;
        let hi = 0;
        for (const l of t.road.lanesAt(e.index, s)) {
          lo = Math.min(lo, l.dCenterM - l.widthM / 2);
          hi = Math.max(hi, l.dCenterM + l.widthM / 2);
        }
        const clear = (side: -1 | 1) => (side > 0 ? hi : -lo) + PED_MARGIN_M + PED_HALF_M;
        const railed =
          t.road.barrierAt(e.index, s, 'left') !== null || t.road.barrierAt(e.index, s, 'right') !== null;
        // The zone's side, out to its far edge and a dive past it; the far side, if anyone crosses.
        const reach: [-1 | 1, number][] = [[zoneSide, Math.max(far, clear(zoneSide)) + PED_DIVE_M]];
        if (!railed)
          reach.push([-zoneSide as -1 | 1, clear(-zoneSide as -1 | 1) + PED_FAR_SLACK_M + PED_DIVE_M]);
        for (const [side, out] of reach) {
          const from = side > 0 ? hi : -lo;
          for (let d = from; d <= out + 1e-9; d = d + 1 > out && d < out ? out : d + 1) {
            points++;
            const p = t.road.toWorld(e.index, s, side * d, 0);
            const hit = ground.at(p.x, p.z, p.y + 20);
            if (!hit || hit.name === 'road-water' || hit.y < p.y - PED_SINK_M) {
              wet.push(
                `${t.id} peds ${e.id} s ${f.s0.toFixed(0)}: at s ${s.toFixed(0)} d ${(side * d).toFixed(1)} ${hit?.name ?? 'nothing'} at ${hit ? (hit.y - p.y).toFixed(2) : '-'} m`,
              );
              bad = true;
              break;
            }
          }
          if (bad) break;
        }
      }
    }
  }
  return { zones, points, wet };
}

/**
 * Known violations on main (2026-10-03), by key (`<network> <check> <road> s <s>`). The list may
 * only shrink: a fix deletes its entry, and an entry no longer seen fails until it is deleted.
 */
const KNOWN: readonly KnownViolation[] = [
  {
    key: 'osm-sf-russian-hill seam osm-sf-russian-hill-jones-out s 29 side 1',
    why:
      'The Jones Street choice (#408): about 4 m past the verge on the right, a 0.2 to 0.9 m slot ' +
      'between the connector strip and the higher land beside it shows the sea 40 m below. ' +
      'The fix is in the junction land in road-mesh.ts, not a data or placement fix.',
  },
  {
    key: 'osm-sf-russian-hill seam osm-sf-russian-hill-jones-in s 31 side 1',
    why:
      'The Jones Street choice (#408): about 5.4 to 6.1 m past the verge on the right, a 0.7 m slot ' +
      'in the higher land beside the connector shows the connector strip 6 m below.',
  },
  {
    key: 'sf-hills seam c-sf-park-in s 25 side 1',
    why:
      'The Park Cut turn-off: a 6 cm sliver between the verge band and the land past it shows the ' +
      'water 3 m below, 2.4 m past the verge on the right.',
  },
];

const keyOf = (line: string) => (line.includes(':') ? line.slice(0, line.indexOf(':')) : line);
const fmtEnd = (id: string, o: OpenLandEnd) =>
  `${id} open ${o.edge} s ${o.s.toFixed(0)} ${o.side < 0 ? 'left' : 'right'} ${o.across} m out: drop ${o.drop.toFixed(1)} m`;

describe("geometry invariants: the land on every route's network", () => {
  it.each(NETWORKS.map((n) => [n.id, n] as const))(
    '%s: no land ends in mid-air or opens at a junction, no sliver at the strip, no pedestrian over water',
    (_id, net) => {
      const t = track(net);
      const scene = sceneOf(t);
      const ground = new GroundTris(scene.group);
      const ends = openLandEnds(t.road, ground);
      const visible = new DownIndex([scene.group, vergeOf(t)], VISIBLE);
      const seam = seamHoles(t, scene, visible);
      const peds = wetPeds(t, net, visible);
      const found = [...ends.open.map((o) => fmtEnd(t.id, o)), ...seam.holes, ...peds.wet];
      const { fresh, seen, stale } = against(found.map(keyOf), KNOWN);
      print(
        `[examined] ${t.id}: ${ground.count} ground triangles; ${ends.probes} points walked beside the roads, ` +
          `${ends.joins} steps across junctions, ${ends.drops} drops looked under, ${ends.open.length} open; ` +
          `${seam.walks} walks across the strip's edge, ${seam.holes.length} slivers; ` +
          `${peds.zones} roadside zones, ${peds.points} pedestrian points, ${peds.wet.length} wet; ${seen.length} known` +
          `${
            fresh.length
              ? `; new: ${found
                  .filter((l) => fresh.includes(keyOf(l)))
                  .slice(0, 6)
                  .join(' | ')}`
              : ''
          }`,
      );
      expect(ends.probes).toBeGreaterThan(500);
      expect(found.filter((l) => fresh.includes(keyOf(l))).slice(0, 12)).toEqual([]);
      expect(stale.filter((k) => k.startsWith(`${t.id} `))).toEqual([]);
    },
    240_000,
  );
});

// ---- The probes agree, and fire on broken land ------------------------------------------------------

/** Takes out of the scene's land every triangle that touches a disc of radius r round (x, z). */
function carve(group: Object3D, x: number, z: number, r: number): number {
  let removed = 0;
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!(o instanceof Mesh) || !/^road-land/.test(o.name)) return;
    const geo = o.geometry as BufferGeometry;
    const pos = geo.getAttribute('position');
    const index = geo.getIndex();
    const n = index ? index.count / 3 : pos.count / 3;
    const keep: number[] = [];
    const v = new Vector3();
    for (let t = 0; t < n; t++) {
      const ids = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
      const pts = ids.map((i) => {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        return [v.x, v.z] as const;
      });
      // A corner inside the disc, or the disc's centre inside the triangle (three crosses agree).
      const near = pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < r);
      const c = pts.map(([ax, az], k) => {
        const [bx, bz] = pts[(k + 1) % 3]!;
        return (bx - ax) * (z - az) - (bz - az) * (x - ax);
      });
      const inside = c.every((q) => q >= 0) || c.every((q) => q <= 0);
      if (near || inside) removed++;
      else keep.push(...ids);
    }
    const next = geo.clone();
    next.setIndex(keep);
    o.geometry = next;
  });
  return removed;
}

describe('the land probes', () => {
  it('read the same ground: the sweep index agrees with land-probe.test-util.ts', () => {
    const t = track(NETWORKS.find((n) => n.id === 'sf-hills')!);
    const scene = sceneOf(t);
    for (const keep of [SURFACES, /^road-land/]) {
      const slow = new GroundTris(scene.group, keep);
      const fast = new DownIndex(scene.group, keep);
      let x = 12345;
      const rand = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 2 ** 32;
      let hits = 0;
      const differ: string[] = [];
      for (let i = 0; i < 20000; i++) {
        const e = t.road.edges[Math.floor(rand() * t.road.edges.length)]!;
        const p = t.road.toWorld(e.index, rand() * e.length, (rand() - 0.5) * 140, 0);
        const a = slow.heightAt(p.x, p.z, p.y + 60);
        const b = fast.at(p.x, p.z, p.y + 60);
        if (a) hits++;
        const dy = Math.abs((a?.y ?? 0) - (b?.y ?? 0));
        const dup = Math.abs((a?.up ?? 0) - (b?.up ?? 0));
        if (a?.name !== b?.name || dy > 1e-6 || dup > 1e-6) differ.push(`${a?.name}/${b?.name}`);
      }
      print(
        `[examined] ${keep.source}: 20000 points on sf-hills, ${hits} over a surface; ${differ.length} read differently`,
      );
      expect(hits).toBeGreaterThan(5000);
      expect(differ).toEqual([]);
    }
  });

  it('negative control: land cut at a junction, a sliver at the strip edge and a zone moved to sea are found', () => {
    const net = NETWORKS.find((n) => n.id === 'pnw-c1')!;
    const t = track(net);
    // 1. A junction up in the hills: the land at a road's end where it joins the next, 2 m out.
    const junction = buildRoadScene(t.road, look, t.dressing, { seed: 1 });
    const picks: { e: (typeof t.road.edges)[number]; side: -1 | 1; y: number }[] = [];
    for (const e of t.road.edges) {
      if (!e.nextLinks.some((l) => l.edge !== e.index)) continue;
      const y = t.road.toWorld(e.index, e.length, 0, 0).y;
      for (const side of [-1, 1] as const)
        if (junction.landReach(e.index, side, e.length - 3) > 6) picks.push({ e, side, y });
    }
    // The highest such end: its land stands well over what lies below it.
    const { e, side } = picks.sort((a, b) => b.y - a.y)[0]!;
    const at = t.road.toWorld(e.index, e.length, side * ((side < 0 ? -e.dMin : e.dMax) + 0.6 + 2), 0);
    const cut = carve(junction.group, at.x, at.z, 3);
    const open = openLandEnds(t.road, new GroundTris(junction.group)).open;
    const joined = new Set([e.id, ...e.nextLinks.map((l) => t.road.edges[l.edge]?.id)]);
    const here = open.filter((o) => joined.has(o.edge));
    junction.dispose();
    // 2. A 4 cm sliver along the strip's edge for 2 m, mid-road, where the ground read falls through.
    const scene = sceneOf(t);
    const f = t.road.edges.find((x) => scene.landReach(x.index, 1, x.length / 2) > 6)!;
    const land = new DownIndex(scene.group, VISIBLE);
    const line: { x: number; z: number }[] = [];
    for (let s = f.length / 2 - 1; s <= f.length / 2 + 1; s += 0.01) {
      const p = t.road.toWorld(f.index, s, f.dMax + 0.6 + scene.landReach(f.index, 1, s), 0);
      line.push({ x: p.x, z: p.z });
    }
    const sliver = {
      at(x: number, z: number, top?: number) {
        const { x: x0, z: z0 } = line[100]!;
        if (
          Math.abs(x - x0) < 2 &&
          Math.abs(z - z0) < 2 &&
          line.some((p) => Math.hypot(p.x - x, p.z - z) < 0.02)
        )
          return null;
        return land.at(x, z, top);
      },
    } as DownIndex;
    const holes = seamHoles(t, scene, sliver).holes.filter((h) => h.includes(` ${f.id} `));
    // 3. A roadside zone moved 60 m further out, over the sea, on a Keys road.
    const keysNet = NETWORKS.find((n) => n.id === 'keys-m1')!;
    const keys = track(keysNet);
    const zoned = keys.road.edges.find(
      (x) => keysNet.allowed.has(x.id) && keys.road.featuresOf(x.index, 'roadsideZone').length > 0,
    )!;
    const out = (z: { d0: number; d1: number }) => 60 * Math.sign(z.d0 + z.d1);
    const moved: Track = {
      ...keys,
      road: Object.create(keys.road, {
        featuresOf: {
          value: (i: number, kind?: string) =>
            keys.road
              .featuresOf(i, kind)
              .map((z) => (i === zoned.index ? { ...z, d0: z.d0 + out(z), d1: z.d1 + out(z) } : z)),
        },
      }) as Track['road'],
    };
    const wet = wetPeds(moved, keysNet, new DownIndex(sceneOf(keys).group, SURFACES)).wet.filter((l) =>
      l.includes(` ${zoned.id} `),
    );
    print(
      `[negative control] junction land cut (${cut} triangles) at the end of ${e.id}: ${here.length} open there; ` +
        `a sliver at the strip edge of ${f.id}: ${holes.length} found; a zone on ${zoned.id} moved to sea: ${wet.length} wet`,
    );
    expect(cut).toBeGreaterThan(0);
    expect(here.length).toBeGreaterThan(0);
    expect(holes.length).toBeGreaterThan(0);
    expect(wet.length).toBeGreaterThan(0);
  });
});
