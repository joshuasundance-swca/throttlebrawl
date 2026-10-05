// Playtest 1b (2026-09-30, [decided]): the shortcut's surface flickered against the main road where
// the two overlap after the split, and nothing marked the split zone that decides who takes it
// (docs/architecture.md, "Splits and merges"; scratch diagnosis of the "invisible barrier"). These
// tests look at the built meshes the way the camera does, by casting rays straight down at the real
// baked track, so they check what is drawn on top rather than how the builder got there.
import { InstancedMesh, Matrix4, Mesh, Raycaster, Vector3, type Group, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { buildRoadScene, guidedZone, laneEdges, laneSpans, ZONE_LEAD_PAINT_M } from './road-mesh';

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

/** The real baked network that carries the boat-ramp shortcut. */
function shortcutNetwork(): RoadNetwork {
  const roads = Object.values(roadFiles);
  for (const network of Object.values(networkFiles)) {
    if (!network.roads.every((id) => roads.some((r) => r.id === id))) continue;
    const road = createRoadNetwork({ network, roads: roads.filter((r) => network.roads.includes(r.id)) });
    if (road.splitZones().length > 0) return road;
  }
  throw new Error('no baked network with a split zone');
}

/** Road surfaces (the things that can flicker against each other when drawn at one height). */
const SURFACES = new Set(['road-road', 'road-shortcut', 'road-shoulder', 'road-splitZone', 'road-land']);

interface Hit {
  name: string;
  y: number;
}

/** Everything the road group draws under a world point (only meshes `only` names, if given), top first. */
function hitsAt(group: Group, x: number, z: number, only?: ReadonlySet<string>, fromY = 100): Hit[] {
  const ray = new Raycaster(new Vector3(x, fromY, z), new Vector3(0, -1, 0), 0, fromY + 100);
  const meshes: Object3D[] = [];
  group.traverse((o) => {
    if (o instanceof Mesh && !(o instanceof InstancedMesh) && (!only || only.has(o.name))) meshes.push(o);
  });
  return ray
    .intersectObjects(meshes, false)
    .map((h) => ({ name: h.object.name, y: h.point.y }))
    .sort((a, b) => b.y - a.y);
}

const top = (group: Group, p: { x: number; z: number }): string => hitsAt(group, p.x, p.z)[0]?.name ?? 'none';

describe('the shortcut split (playtest 1b)', () => {
  const road = shortcutNetwork();
  const look = createFlatLook();
  const { group } = buildRoadScene(road, look, undefined, { postRoads: () => true });
  group.updateMatrixWorld(true);
  const zone = road.splitZones()[0];
  if (!zone) throw new Error('no split zone');
  const main = road.edges[zone.edge];
  const through = main?.[zone.end === 'to' ? 'next' : 'prev'];
  if (!main || !through) throw new Error('no main road through the split');
  // The zone's inner edge: the side nearer the main road's centre line.
  const inner = Math.abs(zone.d0) < Math.abs(zone.d1) ? zone.d0 : zone.d1;
  const outward = Math.sign(zone.d1 - zone.d0) * (inner === zone.d0 ? 1 : -1);

  it('never draws two road surfaces at the same height where the shortcut overlaps the main road', () => {
    const shortcutEdges = road.edges.filter((e) =>
      road.lanesAt(e.index, 0).some((l) => l.kind === 'shortcut'),
    );
    let examined = 0;
    let stacked = 0;
    for (const e of shortcutEdges) {
      // From just past the seam: exactly at s 0 a ray can graze the ribbon's first edge and see the
      // zone paint beneath (run W-R's left-side sandbar split showed it; 0.25 m on, the ribbon is on top).
      for (let s = 0.25; s <= Math.min(e.length, 80); s += 3) {
        for (let d = e.dMin - 0.5; d <= e.dMax + 0.5; d += 0.5) {
          const p = road.toWorld(e.index, s, d, 0);
          // Two edges meeting end to end share their seam in one material: that cannot flicker.
          const hits = hitsAt(group, p.x, p.z, SURFACES).filter(
            (h, i, all) => i === 0 || h.name !== all[i - 1]?.name || all[i - 1]!.y - h.y > 0.001,
          );
          examined++;
          if (hits.length < 2) continue;
          stacked++;
          const [a, b] = hits;
          expect(a!.y - b!.y, `${e.id} s ${s} d ${d}: ${a!.name} over ${b!.name}`).toBeGreaterThanOrEqual(
            0.03,
          );
        }
      }
    }
    console.log(
      `[examined] ${examined} points over the shortcut's first 80 m; ${stacked} had stacked surfaces`,
    );
    expect(stacked).toBeGreaterThan(20); // the overlap is really there, so the check is not empty
  }, 30_000); // hundreds of rays over the whole merged road: slow on a loaded machine

  it('paints the split zone on the main road, and nothing before it', () => {
    const edge = zone.edge;
    for (let s = zone.s0 + 1; s < zone.s1; s += 4) {
      for (const d of [zone.d0 + 0.2 * Math.sign(zone.d1 - zone.d0), (zone.d0 + zone.d1) / 2]) {
        expect(top(group, road.toWorld(edge, s, d, 0)), `s ${s} d ${d}`).toMatch(/splitZone|splitMark/);
      }
      expect(top(group, road.toWorld(edge, s, inner - outward * 0.6, 0)), `left of the zone at s ${s}`).toBe(
        'road-road',
      );
    }
    // Before the zone: its lead-in carries chevrons only when the zone is guided (playtest 4, P4-10),
    // never the fill, and before the lead-in there is no paint at all.
    const lead = guidedZone(road, edge, zone) ? ZONE_LEAD_PAINT_M : 0;
    for (let s = Math.max(0, zone.s0 - lead) + 0.5; s < zone.s0 - 0.5; s += 1) {
      expect(top(group, road.toWorld(edge, s, (zone.d0 + zone.d1) / 2, 0)), `lead-in s ${s}`).not.toBe(
        'road-splitZone',
      );
    }
    if (zone.s0 - lead - 20 > 0) {
      const before = road.toWorld(edge, zone.s0 - lead - 20, (zone.d0 + zone.d1) / 2, 0);
      expect(top(group, before)).not.toMatch(/splitZone|splitMark/);
    }
  });

  it("keeps the zone's inner edge as the line between the main road and the shortcut past the split", () => {
    // On the main road's own connector just past the split, what is drawn on top matches where
    // the sim sends a rider: inside of the zone's inner edge is the main road, outside is the cut.
    let examined = 0;
    for (
      let s = 2;
      s < Math.min(25, through.edge >= 0 ? (road.edges[through.edge]?.length ?? 0) : 0);
      s += 3
    ) {
      const dIn = inner - outward * 0.5;
      const dOut = inner + outward * 0.5;
      expect(top(group, road.toWorld(through.edge, s, dIn, 0)), `inside, s ${s}`).toMatch(
        /road-road|marking/,
      );
      expect(top(group, road.toWorld(through.edge, s, dOut, 0)), `outside, s ${s}`).toMatch(
        /road-shortcut|splitMark/,
      );
      examined++;
    }
    expect(examined).toBeGreaterThan(4);
  });

  it("stands no delineator post on another road's drivable surface", () => {
    // Every chunk's posts (the road is merged per chunk).
    const m = new Matrix4();
    const spots: Vector3[] = [];
    group.traverse((o) => {
      if (!(o instanceof InstancedMesh) || o.name !== 'road-posts') return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        spots.push(new Vector3().setFromMatrixPosition(m));
      }
    });
    expect(spots.length).toBeGreaterThan(100);
    let bad = 0;
    for (const p of spots) {
      for (const e of road.edges) {
        // Brute force: the nearest centre-line sample, then the offset across it.
        let best = -1;
        let bestD2 = Infinity;
        for (let k = 0; k < e.count; k++) {
          const dx = p.x - (e.x[k] ?? 0);
          const dz = p.z - (e.z[k] ?? 0);
          if (dx * dx + dz * dz < bestD2) {
            bestD2 = dx * dx + dz * dz;
            best = k;
          }
        }
        if (bestD2 > 100) continue;
        const s = best * e.spacing;
        const f = road.frameAt(e.index, s);
        const along = (p.x - f.x) * f.tx + (p.z - f.z) * f.tz;
        if (Math.abs(along) > e.spacing || s + along < 0.5 || s + along > e.length - 0.5) continue;
        const d = -(p.x - f.x) * f.tz + (p.z - f.z) * f.tx;
        const spans = laneSpans(road.lanesAt(e.index, s));
        const span = spans.drive ?? spans.shortcut;
        if (span && d > span[0] + 0.1 && d < span[1] - 0.1) bad++;
      }
    }
    console.log(`[examined] ${spots.length} delineator posts against ${road.edges.length} edges`);
    expect(bad).toBe(0);
  });
});

// Playtest 4 (P4-10; the feel audit's F10b): the Seven Mile's turn-off zone ran out past the rail, so
// most of its paint and every chevron lay over the water, and the lead-in where the split guide
// already carries a rider along was bare. The rule, on every baked network: a zone's fill and
// chevrons lie on the road (inside the lanes' outer edges, shoulders included), and a guided zone's
// lead-in carries chevrons. A zone that stands wholly past the edge (a cut over a wall) is painted as
// it is, so it is not part of this check.
const allNetworks = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const allRoads = Object.values(
  import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', { eager: true, import: 'default' }),
);

describe('the split-zone paint stays on the road (playtest 4)', () => {
  it('paints no zone fill or chevron past the lanes’ edge, and chevrons over a guided zone’s lead-in', () => {
    const rows: string[] = [];
    let outside = 0;
    const bareLeads: string[] = [];
    let checked = 0;
    for (const network of Object.values(allNetworks)) {
      const roads = allRoads.filter((r) => network.roads.includes(r.id));
      if (roads.length !== network.roads.length) continue;
      const road = createRoadNetwork({ network, roads });
      // The zones that reach past the lanes' edge on their side, with road under them as well; a fork
      // onto a 'secret' road is never painted (run W-U), so it is not one of them.
      const secret = (i: number) =>
        roads.some((r) => r.id === road.edges[i]?.id && (r.tags ?? []).some((t) => t.tag === 'secret'));
      const zones = road.splitZones().filter((z) => {
        if (secret(z.toEdge)) return false;
        const [lo, hi] = laneEdges(road.lanesAt(z.edge, z.s1));
        const zLo = Math.min(z.d0, z.d1);
        const zHi = Math.max(z.d0, z.d1);
        return (zHi > hi + 0.3 && zLo < hi - 0.3) || (zLo < lo - 0.3 && zHi > lo + 0.3);
      });
      if (zones.length === 0) continue;
      const { group } = buildRoadScene(road, createFlatLook(), undefined, { postRoads: () => true });
      group.updateMatrixWorld(true);
      const paint = new Set(['road-splitZone', 'road-splitMark']);
      // From above the road wherever it climbs (the high country stands over 100 m).
      const paintAt = (p: { x: number; y: number; z: number }) => hitsAt(group, p.x, p.z, paint, p.y + 50);
      for (const z of zones) {
        const side = z.d0 + z.d1 >= 0 ? 1 : -1;
        const lead = guidedZone(road, z.edge, z) ? ZONE_LEAD_PAINT_M : 0;
        const a = z.end === 'to' ? Math.max(0, z.s0 - lead) : z.s0;
        const b = z.end === 'to' ? z.s1 : Math.min(road.edges[z.edge]!.length, z.s1 + lead);
        let leadMarks = 0;
        let out = 0;
        for (let s = a + 0.25; s < b - 0.25; s += 0.5) {
          const [lo, hi] = laneEdges(road.lanesAt(z.edge, s));
          const edge = side > 0 ? hi : lo;
          // Just past the edge: no paint of this zone on top (the water, a verge, a rail or another road).
          const past = paintAt(road.toWorld(z.edge, s, edge + side * 0.2, 0));
          if (past.length > 0) out++;
          checked++;
          const inLead = z.end === 'to' ? s < z.s0 : s > z.s1;
          if (inLead) {
            const [dA, dB] = side > 0 ? [Math.min(z.d0, z.d1), edge] : [edge, Math.max(z.d0, z.d1)];
            for (let d = dA + 0.1; d <= dB - 0.1; d += 0.25) {
              const hit = paintAt(road.toWorld(z.edge, s, d, 0))[0]?.name;
              expect(hit, `${road.edges[z.edge]?.id} lead-in s ${s.toFixed(1)}`).not.toBe('road-splitZone');
              if (hit === 'road-splitMark') leadMarks++;
            }
          }
        }
        outside += out;
        rows.push(
          `${network.id} ${road.edges[z.edge]?.id} s ${z.s0.toFixed(0)}..${z.s1.toFixed(0)} d ${z.d0}..${z.d1}: ${out} points past the edge painted; lead-in ${lead} m, ${leadMarks} chevron hits`,
        );
        if (lead > 0 && leadMarks === 0) bareLeads.push(rows[rows.length - 1]!);
      }
    }
    console.log(`[examined] ${checked} points just past the edge:\n  ${rows.join('\n  ')}`);
    // The Seven Mile's turn-off is one of them, so the check is not empty.
    expect(rows.some((r) => r.startsWith('osm-keys-seven-mile'))).toBe(true);
    expect(outside).toBe(0);
    expect(bareLeads).toEqual([]);
  }, 120_000);
});
