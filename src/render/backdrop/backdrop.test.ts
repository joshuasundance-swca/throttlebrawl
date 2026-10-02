// The backdrop (W-P "fill the world", the maintainer, 2026-10-01b: "distance and skyline: hills,
// mountains, city skylines, water, bridges on the horizon"; "unique regional flavor everywhere").
// The checks read the real pack data and the real road networks, build each network's backdrop and
// look at what was built: every network has one, each region's signature pieces are there, nothing
// stands on a road, the race's seed varies only what should vary, and the squeezed depth stays
// inside the camera's far plane.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../../road';
import { CAMERA_FAR_M } from '../index';
import { BACKDROP_FAR_M, buildSoup, roadPointsOf, squeezedDepth } from './builder';
import { backdropProblems, type BackdropNetworkFile, type BackdropRegionFile, type PieceKind } from './data';
import { geoFrame } from './geo';
import { backdropFilesFor } from './index';

const networkFiles = import.meta.glob<
  BakedNetwork & { region: string; crs: { originLatDeg: number; originLonDeg: number } }
>('../../../packs/*/regions/*/networks/*.json', { eager: true, import: 'default' });
const roadFiles = import.meta.glob<BakedRoad>('../../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const backdropNetworks = import.meta.glob<BackdropNetworkFile>(
  '../../../packs/*/assets/backdrop/*/networks/*.json',
  {
    eager: true,
    import: 'default',
  },
);
const backdropRegions = import.meta.glob<BackdropRegionFile>(
  '../../../packs/*/assets/backdrop/*/region.json',
  {
    eager: true,
    import: 'default',
  },
);

const NETWORKS = Object.values(networkFiles);

function filesFor(id: string): { region: BackdropRegionFile; network: BackdropNetworkFile; folder: string } {
  const key = Object.keys(backdropNetworks).find((k) => k.endsWith(`/networks/${id}.json`));
  if (!key) throw new Error(`no backdrop for ${id}`);
  const regionKey = key.replace(/networks\/[^/]+\.json$/, 'region.json');
  const folder = regionKey.split('/').at(-2)!;
  return { network: backdropNetworks[key]!, region: backdropRegions[regionKey]!, folder };
}

function roadPoints(id: string) {
  const network = NETWORKS.find((n) => n.id === id)!;
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  return roadPointsOf(createRoadNetwork({ network, roads }).edges, 1);
}

function build(id: string, seed = 7) {
  const { region, network } = filesFor(id);
  return buildSoup(region, network, roadPoints(id), seed);
}

describe('the backdrop data', () => {
  it('covers every road network, with the network origin and region its road data has', () => {
    expect(NETWORKS.length).toBeGreaterThanOrEqual(8);
    for (const n of NETWORKS) {
      const { network, folder } = filesFor(n.id);
      expect(network.network).toBe(n.id);
      expect(folder, n.id).toBe(n.region);
      expect([network.originLatDeg, network.originLonDeg], n.id).toEqual([
        n.crs.originLatDeg,
        n.crs.originLonDeg,
      ]);
      // The renderer finds the same files by the network id alone (lazy chunks).
      expect(backdropFilesFor(n.id), n.id).not.toBeNull();
    }
    expect(backdropFilesFor('no-such-network')).toBeNull();
  });

  it('is well formed, file by file', () => {
    const files = [
      ...Object.entries(backdropRegions).map(([k, v]) => [k, backdropProblems(v, 'region')] as const),
      ...Object.entries(backdropNetworks).map(([k, v]) => [k, backdropProblems(v, 'network')] as const),
    ];
    expect(files.length).toBe(3 + NETWORKS.length);
    for (const [k, problems] of files) expect(problems, k).toEqual([]);
    expect(
      backdropProblems(
        { formatVersion: 1, region: 'x', hazeM: 1, floorColour: 'red', pieces: [{ id: 'a', kind: 'moon' }] },
        'region',
      ),
    ).toEqual(expect.arrayContaining(['floorColour must be #rrggbb', 'pieces[0]: unknown kind moon']));
  });
});

describe('the map frame', () => {
  it('matches the bake: the origin is 0, north is -z, east is +x, at about the right scale', () => {
    const f = geoFrame(45.55, -122.2);
    expect(f.toWorld(45.55, -122.2)[0]).toBeCloseTo(0, 6);
    expect(f.toWorld(45.55, -122.2)[1]).toBeCloseTo(0, 6);
    const [, zN] = f.toWorld(45.56, -122.2);
    expect(zN).toBeLessThan(-1100);
    expect(zN).toBeGreaterThan(-1115);
    const [xE] = f.toWorld(45.55, -122.19);
    expect(xE).toBeGreaterThan(775);
    expect(xE).toBeLessThan(785);
  });

  it("puts a real landmark where it is from a real road: Crown Point stands at the gorge route's start", () => {
    // The Columbia River Highway route begins at Crown Point (45.5397 N, 122.2445 W).
    const f = geoFrame(45.55, -122.2);
    const [x, z] = f.toWorld(45.5397, -122.2445);
    const pts = roadPoints('osm-pnw-gorge');
    const nearest = Math.min(...pts.map(([px, pz]) => Math.hypot(px - x, pz - z)));
    expect(nearest).toBeLessThan(400);
  });
});

/** What each network must show on its horizon (its region's flavour), by kind. */
const SIGNATURES: Record<string, PieceKind[]> = {
  'keys-m1': ['bridge', 'lighthouse', 'islands', 'vessels', 'clouds'],
  'osm-keys-bahia-honda': ['bridge', 'lighthouse', 'islands', 'vessels', 'clouds'],
  'pnw-c1': ['ridge', 'peak', 'vessels', 'floor'],
  'osm-pnw-chuckanut': ['ridge', 'peak', 'vessels', 'floor'],
  'osm-pnw-gorge': ['ridge', 'peak', 'vessels', 'floor'],
  'sf-hills': ['bridge', 'skyline', 'peak', 'mast', 'vessels', 'clouds', 'floor', 'blocks'],
  'osm-sf-russian-hill': ['bridge', 'skyline', 'peak', 'mast', 'vessels', 'clouds', 'floor', 'blocks'],
  'osm-sf-twin-peaks': ['bridge', 'skyline', 'vessels', 'clouds', 'floor', 'blocks'],
};

describe.each(Object.keys(SIGNATURES))('the backdrop of %s', (id) => {
  const { soup, stats } = build(id);
  const pts = roadPoints(id);

  it("shows its region's signature pieces, cheaply", () => {
    for (const k of SIGNATURES[id]!) expect(stats.kinds[k] ?? 0, k).toBeGreaterThan(0);
    // A few thousand triangles in one draw call (the frame budget is 150k triangles, 120 calls).
    expect(stats.triangles).toBeGreaterThan(1000);
    expect(stats.triangles).toBeLessThan(20000);
    console.log(
      `[print] ${id}: ${stats.triangles} triangles, kinds ${JSON.stringify(stats.kinds)}, skipped ${stats.skipped}`,
    );
  });

  it('stands nothing on or beside a road (floors lie under the sea, so they may pass beneath)', () => {
    let checked = 0;
    let closest = Infinity;
    const cell = new Map<string, [number, number][]>();
    for (const [x, z] of pts) {
      const k = `${Math.floor(x / 200)},${Math.floor(z / 200)}`;
      (cell.get(k) ?? cell.set(k, []).get(k)!).push([x, z]);
    }
    for (let v = 0; v < soup.pos.length / 3; v++) {
      if (soup.info[v * 4 + 1]! > 0 || soup.info[v * 4 + 3]! > 0) continue; // floors and the far ring
      const x = soup.pos[v * 3]!;
      const z = soup.pos[v * 3 + 2]!;
      checked++;
      const cx = Math.floor(x / 200);
      const cz = Math.floor(z / 200);
      for (let i = cx - 1; i <= cx + 1; i++)
        for (let j = cz - 1; j <= cz + 1; j++)
          for (const [px, pz] of cell.get(`${i},${j}`) ?? [])
            closest = Math.min(closest, Math.hypot(px - x, pz - z));
    }
    expect(checked).toBeGreaterThan(1000);
    // The nearest keep-out is the mast's 250 m; a piece's own width may reach a little inside it.
    expect(closest).toBeGreaterThan(150);
  });

  it('repeats exactly for a seed, and a new seed moves only what varies between races', () => {
    const again = build(id, 7);
    expect(again.soup.pos).toEqual(soup.pos);
    const other = build(id, 8);
    expect(other.soup.pos).not.toEqual(soup.pos);
  });
});

describe('the squeezed depth', () => {
  it('keeps every piece inside the far plane, keeps far behind near, and leaves the near world exact', () => {
    expect(BACKDROP_FAR_M).toBeLessThan(CAMERA_FAR_M);
    for (const fogFar of [480, 700]) {
      let last = 0;
      for (const d of [1, 50, 200, fogFar - 1, fogFar, fogFar + 1, 800, 2000, 10_000, 100_000, 1e6]) {
        const r = squeezedDepth(d, fogFar);
        expect(r).toBeLessThan(BACKDROP_FAR_M + 1e-9);
        expect(r).toBeGreaterThan(last);
        if (d <= fogFar) expect(r).toBe(d);
        last = r;
      }
    }
  });
});
