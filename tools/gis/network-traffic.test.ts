import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  type BakedConnector,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { footContains, type StructureFoot } from '../../src/road/structures';
import { planPdxDowntown } from '../../src/road/structures/downtown';

const REGION = 'packs/region-pnw/regions/pacific-northwest';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const baked = read<BakedNetwork>(`${REGION}/networks/osm-pnw-portland.json`);
const roads = baked.roads.map((id) => read<BakedRoad>(`${REGION}/roads/${id}.json`));
const network = createRoadNetwork({ network: baked, roads });
const config = read<{
  id: string;
  branches: { label: string; traffic: string; trafficIngress: { widthM: number; minRadiusM: number } }[];
}>('tools/gis/networks/osm-pnw-portland.json');
const branch = config.branches[0]!;
const id = `${config.id}-${branch.label}-traffic-in`;
const edge = network.edges[network.edgeIndex(id)]!;
const streetcar = read<{ lengthM: number; widthM: number }>('packs/region-pnw/traffic/pdx-streetcar.json');

it('traffic-only junction movements do not add a second street of downtown lots', () => {
  const lots = planPdxDowntown(network, 1).lots;
  expect(lots.filter((lot) => lot.edge === edge.index)).toEqual([]);
  expect(lots.some((lot) => lot.edge === network.edgeIndex('osm-pnw-pdx-alder'))).toBe(true);
});

/** Separating-axis test: detects edge crossings even when neither rectangle contains a corner. */
function overlaps(a: StructureFoot, b: StructureFoot): boolean {
  return [
    [a.ux, a.uz],
    [-a.uz, a.ux],
    [b.ux, b.uz],
    [-b.uz, b.ux],
  ].every(([x, z]) => {
    const px = x!;
    const pz = z!;
    const radius = (f: StructureFoot) =>
      f.hu * Math.abs(f.ux * px + f.uz * pz) + f.hv * Math.abs(-f.uz * px + f.ux * pz);
    return Math.abs((a.x - b.x) * px + (a.z - b.z) * pz) <= radius(a) + radius(b);
  });
}

/** Closest point on every committed asphalt ribbon, including the mesh's 0.6 m verge. */
function asphaltAt(x: number, y: number, z: number): boolean {
  for (const e of network.edges) {
    if (e.surface !== 'asphalt') continue;
    for (let i = 0; i < e.count - 1; i++) {
      const ax = e.x[i]!;
      const az = e.z[i]!;
      const dx = e.x[i + 1]! - ax;
      const dz = e.z[i + 1]! - az;
      const length2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length2));
      const qx = ax + t * dx;
      const qz = az + t * dz;
      const qy = e.y[i]! + t * (e.y[i + 1]! - e.y[i]!);
      if (Math.abs(y - qy) > 1) continue;
      const d = (-(x - qx) * dz + (z - qz) * dx) / Math.sqrt(length2);
      // The clamped endpoint must still be close along the ribbon, not just across it.
      if (Math.hypot(x - qx, z - qz) > Math.abs(d) + 0.05) continue;
      const lanes = network.lanesAt(e.index, (i + t) * e.spacing);
      const left = Math.min(...lanes.map((l) => l.dCenterM - l.widthM / 2)) - 0.6;
      const right = Math.max(...lanes.map((l) => l.dCenterM + l.widthM / 2)) + 0.6;
      if (d >= left && d <= right) return true;
    }
  }
  return false;
}

describe('the dedicated Morrison forward traffic ingress', () => {
  it('is explicitly traffic-only, legal, allowed and in the opted-in flat branch', () => {
    const rows = baked.junctions.flatMap((j) => j.connectors) as (BakedConnector & {
      trafficOnly?: boolean;
    })[];
    const row = rows.find((c) => c.road === id)!;
    expect(row).toMatchObject({
      trafficOnly: true,
      from: { road: 'osm-pnw-pdx-broadway', end: 'to', lane: 'R1' },
      to: { road: 'osm-pnw-pdx-alder', end: 'from', lane: 'R1' },
    });
    expect(row.splitZone).toBeUndefined();
    expect(network.lanesAt(edge.index, 0)).toEqual([
      { id: 'R1', dCenterM: 0, widthM: branch.trafficIngress.widthM, direction: 1, kind: 'drive' },
    ]);
    const route = read<BakedRoute>(`${REGION}/routes/osm-bridge-city-run.json`);
    expect(route.allowedRoads).toContain(id);
    expect(route.branches?.[0]).toMatchObject({ traffic: branch.traffic });
    expect(route.branches?.[0]?.roads).toContain(id);
    for (const [rid, s, end] of [
      [row.from.road, network.edges[network.edgeIndex(row.from.road)]!.length, 0],
      [row.to.road, 0, edge.length],
    ] as const) {
      const f = network.frameAt(network.edgeIndex(rid), s);
      const p = network.toWorld(network.edgeIndex(rid), s, 2, 0);
      const q = network.frameAt(edge.index, end);
      expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThan(0.03);
      expect(q.y).toBeCloseTo(p.y, 4);
      expect(f.tx * q.tx + f.tz * q.tz).toBeGreaterThan(0.9999);
    }
    expect(Math.max(...edge.kappa.map(Math.abs)) * branch.trafficIngress.minRadiusM).toBeLessThan(1.01);
  });

  it('supports the whole lane and the committed streetcar body on asphalt without downtown intrusion', () => {
    const plans = [3, 7, 19].map((seed) => planPdxDowntown(network, seed));
    // Positive controls: the footprint query finds buildings, and the surface query rejects open space.
    for (const p of plans) {
      expect(p.lots.length).toBeGreaterThan(0);
      const f = p.lots[0]!.solid.foot;
      expect(footContains(f, f.x, f.z)).toBe(true);
    }
    expect(asphaltAt(1e6, 0, 1e6)).toBe(false);
    const box = { x: 0, z: 0, ux: 1, uz: 0, hu: 10, hv: 1 };
    expect(overlaps(box, { ...box, ux: 0, uz: 1 })).toBe(true);
    expect(overlaps(box, { ...box, x: 30 })).toBe(false);
    let examined = 0;
    for (let s = 0; s <= edge.length; s += 1) {
      const f = network.frameAt(edge.index, s);
      const body: StructureFoot = {
        x: f.x,
        z: f.z,
        ux: f.tx,
        uz: f.tz,
        hu: streetcar.lengthM / 2,
        hv: streetcar.widthM / 2,
      };
      for (const plan of plans)
        expect(
          plan.lots.some((l) => overlaps(body, l.solid.foot)),
          `streetcar/building at s=${s}`,
        ).toBe(false);
      const points: { x: number; y: number; z: number }[] = [];
      for (const d of [-branch.trafficIngress.widthM / 2, 0, branch.trafficIngress.widthM / 2])
        points.push(network.toWorld(edge.index, s, d, 0));
      // A rigid body tangent to the path, all four corners and both side midpoints.
      for (const along of [-streetcar.lengthM / 2, 0, streetcar.lengthM / 2])
        for (const across of [-streetcar.widthM / 2, streetcar.widthM / 2])
          points.push({
            x: f.x + along * f.tx - across * f.tz,
            y: f.y + along * f.grade,
            z: f.z + along * f.tz + across * f.tx,
          });
      for (const p of points) {
        expect(asphaltAt(p.x, p.y, p.z), `asphalt at ingress s=${s}`).toBe(true);
        for (const plan of plans)
          expect(
            plan.lots.some((l) => footContains(l.solid.foot, p.x, p.z)),
            `building at s=${s}`,
          ).toBe(false);
        examined++;
      }
    }
    console.log(`[examined] ${examined} lane/vehicle footprint points; ${plans.length} downtown seeds`);
  });
});
