/// <reference types="vite/client" />
// Geometry invariants, the backdrop (quality-confidence rec 3), on every network a route races on.
// Every vertex of the horizon is checked by its kind, with no exemption:
// - a standing piece (a ridge, a skyline, a bridge, a ship at both ends of its run) keeps out of
//   the roads: 150 m from every road point (src/render/backdrop/backdrop.test.ts's check, which
//   skipped the floors, "floors lie under the sea, so they may pass beneath", on eight networks);
// - a floor (far land and water, and the far ground ring) lies under the sea as drawn: from a
//   chase camera along every road, the vertex shader's own placement (builder.ts VERTEX: a floor
//   keeps its true position, anything else is pulled in along its line of sight) puts it below
//   y = 0, so the near sea and ground always cover it. Run W-P's skyline verifier, mustFix 1:
//   floors squeezed like the other pieces became a sheet over the near bay on San Francisco's road,
//   and the unit test's exemption let it through.
import { describe, expect, it } from 'vitest';
import { squeezedDepth, buildSoup, roadPointsOf } from '../../src/render/backdrop/builder';
import type { BackdropNetworkFile, BackdropRegionFile } from '../../src/render/backdrop/data';
import type { Soup } from '../../src/render/backdrop/soup';
import { against, print, routeNetworks, track, type KnownViolation, type Track } from './geometry-routes';

const backdropNetworks = import.meta.glob<BackdropNetworkFile>('/packs/*/assets/backdrop/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const backdropRegions = import.meta.glob<BackdropRegionFile>('/packs/*/assets/backdrop/*/region.json', {
  eager: true,
  import: 'default',
});

function filesFor(id: string): { region: BackdropRegionFile; network: BackdropNetworkFile } {
  const key = Object.keys(backdropNetworks).find((k) => k.endsWith(`/networks/${id}.json`));
  if (!key) throw new Error(`no backdrop for ${id}`);
  const region = backdropRegions[key.replace(/networks\/[^/]+\.json$/, 'region.json')];
  if (!region) throw new Error(`no backdrop region for ${id}`);
  return { network: backdropNetworks[key]!, region };
}

/** The keep-out a standing piece's vertices hold from a road (the mast's 250 m, less its width). */
const KEEP_OUT_M = 150;
/** The fog's end the squeeze starts at: the looks' range (backdrop.test.ts's). */
const FOG_FAR_M = [300, 480, 700] as const;
/** Chase cameras along every road, this far apart (camera/: 8 m back, 3.2 m up). */
const CAMERA_EVERY_M = 40;

/**
 * Where the vertex shader draws vertex v of a soup, seen from `cam` (builder.ts VERTEX, at time 0):
 * a floor at its true position (moved with the camera if it follows it); anything else pulled in
 * along its line of sight to its squeezed depth.
 */
export function drawnY(
  soup: Soup,
  v: number,
  cam: { x: number; y: number; z: number },
  fogFar: number,
): number {
  const follow = soup.info[v * 4 + 3]!;
  const x = soup.pos[v * 3]! + cam.x * follow;
  const y = soup.pos[v * 3 + 1]!;
  const z = soup.pos[v * 3 + 2]! + cam.z * follow;
  if (soup.info[v * 4 + 1]! > 0.5) return y;
  const d = Math.max(Math.hypot(x - cam.x, y - cam.y, z - cam.z), 0.5);
  return cam.y + (y - cam.y) * (squeezedDepth(d, fogFar) / d);
}

/** The floor vertices as drawn from every chase camera on the roads that come up out of the sea. */
export function floorsOverSea(t: Track, soup: Soup): { cameras: number; vertices: number; over: string[] } {
  const over: string[] = [];
  let cameras = 0;
  const n = soup.pos.length / 3;
  for (const e of t.road.edges)
    for (let s = 8; s < e.length; s += CAMERA_EVERY_M) {
      const cam = t.road.toWorld(e.index, s - 8, 2, 3.2);
      cameras++;
      for (const fogFar of FOG_FAR_M)
        for (let v = 0; v < n; v++) {
          const y = drawnY(soup, v, cam, fogFar);
          if (y >= 0) {
            over.push(
              `${t.id} floor from ${e.id} s ${s.toFixed(0)}: drawn at y ${y.toFixed(2)} (fog ${fogFar} m)`,
            );
            break;
          }
        }
    }
  return { cameras, vertices: n, over };
}

/** A soup of the region's and the network's floors only, and the far ground ring. */
function floorSoup(id: string, seed: number) {
  const { region, network } = filesFor(id);
  const floors = (pieces: BackdropRegionFile['pieces'] | undefined) =>
    (pieces ?? []).filter((p) => p.kind === 'floor');
  return buildSoup(
    { ...region, pieces: floors(region.pieces) },
    { ...network, pieces: floors(network.pieces) },
    [],
    seed,
  );
}

/** Known violations on main (2026-10-03). The list may only shrink. Empty: main has none. */
const KNOWN: readonly KnownViolation[] = [];

const NETWORKS = routeNetworks();

describe("geometry invariants: the backdrop on every route's network, every vertex checked", () => {
  it.each(NETWORKS.map((n) => [n.id, n] as const))(
    '%s: standing pieces keep out of the roads, and floors lie under the sea as drawn',
    (_id, net) => {
      const t = track(net);
      const { region, network } = filesFor(t.id);
      const pts = roadPointsOf(t.road.edges, 1);
      const { soup } = buildSoup(region, network, pts, 7);
      // Standing pieces: every vertex not a floor and not the ring, at both ends of any run.
      const cell = new Map<string, [number, number][]>();
      for (const [x, z] of pts) {
        const k = `${Math.floor(x / 200)},${Math.floor(z / 200)}`;
        (cell.get(k) ?? cell.set(k, []).get(k)!).push([x, z]);
      }
      let standing = 0;
      let floors = 0;
      let closest = Infinity;
      for (let v = 0; v < soup.pos.length / 3; v++) {
        if (soup.info[v * 4 + 1]! > 0 || soup.info[v * 4 + 3]! > 0) {
          floors++;
          continue;
        }
        const dx = soup.motion[v * 4]!;
        const dz = soup.motion[v * 4 + 1]!;
        for (const m of dx || dz ? [-1, 0, 1] : [0]) {
          const x = soup.pos[v * 3]! + dx * m;
          const z = soup.pos[v * 3 + 2]! + dz * m;
          standing++;
          const cx = Math.floor(x / 200);
          const cz = Math.floor(z / 200);
          for (let i = cx - 1; i <= cx + 1; i++)
            for (let j = cz - 1; j <= cz + 1; j++)
              for (const [px, pz] of cell.get(`${i},${j}`) ?? [])
                closest = Math.min(closest, Math.hypot(px - x, pz - z));
        }
      }
      // Floors: every one of them as drawn, the ring included, from the cameras on the roads.
      const f = floorsOverSea(t, floorSoup(t.id, 7).soup);
      const found = [
        ...(closest > KEEP_OUT_M ? [] : [`${t.id} standing: a vertex ${closest.toFixed(0)} m from a road`]),
        ...f.over,
      ];
      const keys = found.map((l) => l.slice(0, l.indexOf(':')));
      const { fresh, seen, stale } = against(keys, KNOWN);
      print(
        `[examined] ${t.id}: ${standing} standing vertex positions (closest to a road ${Number.isFinite(closest) ? `${closest.toFixed(0)} m` : 'over 200 m'}), ` +
          `${floors} floor and ring vertices; ${f.vertices} floor vertices drawn from ${f.cameras} cameras x ${FOG_FAR_M.length} fog ends, ` +
          `${f.over.length} views with one over the sea; ${seen.length} known${fresh.length ? `; new: ${found.slice(0, 4).join(' | ')}` : ''}`,
      );
      expect(standing).toBeGreaterThan(1000);
      expect(f.vertices).toBeGreaterThan(100);
      expect(found.filter((l) => fresh.includes(l.slice(0, l.indexOf(':')))).slice(0, 8)).toEqual([]);
      expect(stale.filter((k) => k.startsWith(`${t.id} `))).toEqual([]);
    },
    120_000,
  );

  it('negative control: a floor drawn without its floor flag, or laid above the sea, is found', () => {
    const t = track(NETWORKS.find((n) => n.id === 'sf-hills')!);
    const clean = floorsOverSea(t, floorSoup('sf-hills', 7).soup);
    expect(clean.over).toEqual([]);
    // 1. The skyline verifier's defect: floors squeezed like any other piece (the flag cleared).
    const squeezed = floorSoup('sf-hills', 7).soup;
    for (let v = 0; v < squeezed.info.length / 4; v++) squeezed.info[v * 4 + 1] = 0;
    const a = floorsOverSea(t, squeezed);
    // 2. A floor laid 2 m over the sea: y 3, less the 1 m a land floor sits under it (a data slip).
    const { region, network } = filesFor('sf-hills');
    const raised = buildSoup(
      {
        ...region,
        pieces: region.pieces.filter((p) => p.kind === 'floor').map((p) => ({ ...p, y: 3 })),
      },
      { ...network, pieces: [] },
      [],
      7,
    ).soup;
    const b = floorsOverSea(t, raised);
    print(
      `[negative control] floors squeezed: ${a.over.length} of ${a.cameras * FOG_FAR_M.length} views see one over the sea; ` +
        `floors raised 3 m: ${b.over.length} of ${b.cameras * FOG_FAR_M.length}`,
    );
    expect(a.over.length).toBeGreaterThan(0);
    expect(b.over.length).toBeGreaterThan(0);
  });
});
