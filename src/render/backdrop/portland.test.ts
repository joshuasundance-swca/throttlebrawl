// Bridge City's horizon (playtest 4, P4-20; the maintainer: "Bridge City should look like downtown
// Portland even in the distance etc and be as content-rich as the others"). The checks build the real
// pack data on the real road network and look at what a rider sees from the road: the towers over
// the horizon from the bridges, the other bridges' silhouettes across the river, the West Hills
// behind, and the river between. A piece is only counted when it stands in the right direction and at
// a believable size; each check has a control (the same view without the Portland pieces).
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../../road';
import { buildSoup, roadPointsOf } from './builder';
import type { BackdropNetworkFile, BackdropRegionFile, BridgePiece, FloorPiece, Piece } from './data';
import { backdropProblems } from './data';
import { geoFrame } from './geo';
import { insidePolygon } from './shapes';
import type { Soup } from './soup';

const networkFiles = import.meta.glob<BakedNetwork>('../../../packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../../packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const backdropNetworks = import.meta.glob<BackdropNetworkFile>(
  '../../../packs/region-pnw/assets/backdrop/*/networks/*.json',
  { eager: true, import: 'default' },
);
const backdropRegions = import.meta.glob<BackdropRegionFile>(
  '../../../packs/region-pnw/assets/backdrop/*/region.json',
  { eager: true, import: 'default' },
);
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const ID = 'osm-pnw-portland';
const network = Object.values(networkFiles).find((n) => n.id === ID);
if (!network) throw new Error(`no network ${ID}`);
const road: RoadNetwork = createRoadNetwork({
  network,
  roads: Object.values(roadFiles).filter((r) => network.roads.includes(r.id)),
});
const region = Object.values(backdropRegions)[0] as BackdropRegionFile;
const net = Object.values(backdropNetworks).find((n) => n.network === ID) as BackdropNetworkFile;
const roadPoints = roadPointsOf(road.edges, 1);
const build = (pieces: readonly Piece[] = region.pieces, seed = 7) =>
  buildSoup({ ...region, pieces }, net, roadPoints, seed);
const PORTLAND = region.pieces.filter((p) => p.networks?.includes(ID));
const WITHOUT = region.pieces.filter((p) => !p.networks?.includes(ID));

/**
 * The horizon a rider at `cam` sees looking along `heading` (radians, 0 = -z, turning toward +x), in
 * 0.25 degree bins over +-`half`: the highest elevation (degrees) of any standing piece in each bin.
 * Every triangle of the soup covers the bins its corners' bearings span (a floor, which lies under
 * the sea, is never a silhouette).
 */
function horizon(
  soup: Soup,
  cam: { x: number; y: number; z: number },
  heading: number,
  half: number,
): number[] {
  const bins = Math.round((2 * half * 180) / Math.PI / 0.25);
  const out = new Array<number>(bins).fill(0);
  for (let t = 0; t + 8 < (soup.pos.length / 3) * 3; t += 9) {
    const az: number[] = [];
    let top = -90;
    let floor = false;
    for (let k = 0; k < 3; k++) {
      const i = t + k * 3;
      if (soup.info[(i / 3) * 4 + 1]! > 0.5) floor = true;
      const dx = soup.pos[i]! - cam.x;
      const dz = soup.pos[i + 2]! - cam.z;
      const d = Math.hypot(dx, dz);
      // Bearing from the heading, + toward +x.
      let a = Math.atan2(dx, -dz) - heading;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      az.push(a);
      top = Math.max(top, (Math.atan2(soup.pos[i + 1]! - cam.y, d) * 180) / Math.PI);
    }
    if (floor) continue;
    const lo = Math.min(...az);
    const hi = Math.max(...az);
    if (hi - lo > 1) continue; // wrapped round the back
    for (let b = 0; b < bins; b++) {
      const a = -half + ((b + 0.5) * 0.25 * Math.PI) / 180;
      if (a >= lo && a <= hi) out[b] = Math.max(out[b]!, top);
    }
  }
  return out;
}

/** Where a rider is and which way she faces at s along an edge. */
function view(edgeId: string, s: number) {
  const e = road.edgeIndex(edgeId);
  const p = road.toWorld(e, s, 0, 3.2);
  const f = road.frameAt(e, s);
  return { cam: { x: p.x, y: p.y, z: p.z }, heading: Math.atan2(f.tx, -f.tz) };
}

describe("Bridge City's horizon data", () => {
  it('is well formed, and every piece the Portland network adds stands for it alone', () => {
    expect(backdropProblems(region, 'region')).toEqual([]);
    expect(PORTLAND.length).toBeGreaterThan(20);
    const kinds = new Set(PORTLAND.map((p) => p.kind));
    for (const k of ['skyline', 'bridge', 'ridge', 'peak', 'floor', 'blocks', 'mast', 'vessels'] as const)
      expect(kinds.has(k), k).toBe(true);
    const stats = build().stats;
    expect(stats.kinds.skyline ?? 0).toBeGreaterThanOrEqual(5);
    expect(stats.kinds.bridge ?? 0).toBeGreaterThanOrEqual(6);
    expect(stats.kinds.blocks ?? 0).toBeGreaterThanOrEqual(2);
    print(
      `Bridge City: ${stats.triangles} triangles, kinds ${JSON.stringify(stats.kinds)}, skipped ${stats.skipped}`,
    );
  });
});

describe("what a rider sees on Bridge City's bridges", () => {
  const cityOnly = (pieces: readonly Piece[]) =>
    pieces.filter((p) => p.kind === 'skyline' || p.kind === 'blocks' || p.kind === 'bridge');
  const vantages: [string, string, number][] = [
    ['the Burnside Bridge, riding west', 'osm-pnw-pdx-burnside-bridge', 300],
    ['Broadway, riding south', 'osm-pnw-pdx-broadway-south', 150],
    ['the Hawthorne Bridge, riding east', 'osm-pnw-pdx-hawthorne-bridge', 600],
  ];
  it.each(vantages)('%s: the city stands over the horizon', (_name, edge, s) => {
    const { cam, heading } = view(edge, s);
    const half = (35 * Math.PI) / 180;
    const prof = horizon(build(cityOnly(region.pieces)).soup, cam, heading, half);
    const control = horizon(build(cityOnly(WITHOUT)).soup, cam, heading, half);
    const share = (p: number[], deg: number) => p.filter((e) => e >= deg).length / p.length;
    print(
      `${_name}: city over ${(share(prof, 1.5) * 100).toFixed(0)} % of the forward 70 degrees at 1.5 degrees or more, tallest ${Math.max(...prof).toFixed(1)} degrees (control without the Portland pieces ${(share(control, 1.5) * 100).toFixed(0)} %)`,
    );
    expect(share(control, 1.5)).toBe(0);
    expect(share(prof, 1.5)).toBeGreaterThan(0.15);
  });
});

describe("the other bridges, the hills and the river of Bridge City's horizon", () => {
  const only = (...ids: string[]) => region.pieces.filter((p) => ids.includes(p.id));
  const sector = (prof: number[], fromDeg: number, toDeg: number, half: number) => {
    const i0 = Math.round((fromDeg + (half * 180) / Math.PI) / 0.25);
    const i1 = Math.round((toDeg + (half * 180) / Math.PI) / 0.25);
    return prof.slice(Math.max(0, i0), Math.min(prof.length, i1));
  };

  it('stands the Steel Bridge across the river, north of the Burnside Bridge, its two lift towers over its deck', () => {
    const { cam, heading } = view('osm-pnw-pdx-burnside-bridge', 520);
    expect(Math.abs(Math.sin(heading))).toBeGreaterThan(0.9); // riding west
    // Face the Steel Bridge's middle from the bridge: it is about 640 m off, to the north.
    const steel = region.pieces.find((p) => p.id === 'steel-bridge') as BridgePiece;
    const g0 = geoFrame(net.originLatDeg, net.originLonDeg);
    const [ax, az] = g0.toWorld(steel.from[0], steel.from[1]);
    const [bx, bz] = g0.toWorld(steel.to[0], steel.to[1]);
    const face = Math.atan2((ax + bx) / 2 - cam.x, -((az + bz) / 2 - cam.z));
    const half = (30 * Math.PI) / 180;
    const prof = horizon(build(only('steel-bridge')).soup, cam, face, half);
    const ahead = sector(prof, -25, 25, half);
    print(
      `the Steel Bridge from the Burnside Bridge: tallest ${Math.max(...ahead).toFixed(1)} degrees over ${ahead.filter((e) => e > 0.1).length / 4} degrees of the view`,
    );
    // Its towers (66 m, drawn 1.3 times) stand well over the deck.
    expect(Math.max(...ahead)).toBeGreaterThan(4);
    // The towers (joined at the top by the lift span's beam) stand over the middle of the deck, not all along it.
    const deck = ahead.filter((e) => e > 0.1).length;
    const raised = ahead.filter((e) => e > 3.5).length;
    expect(deck / 4).toBeGreaterThan(25);
    expect(raised).toBeGreaterThan(0);
    expect(raised).toBeLessThan(deck * 0.6);
    // The control: facing the same way with the piece left out, nothing stands there.
    expect(
      Math.max(...sector(horizon(build(only('west-hills')).soup, cam, face, half), -25, 25, half)),
    ).toBeLessThan(1);
  });

  it('puts the West Hills behind downtown, over the western horizon from Broadway', () => {
    const { cam } = view('osm-pnw-pdx-broadway-south', 200);
    const half = (40 * Math.PI) / 180;
    const west = -Math.PI / 2;
    const prof = horizon(build(only('west-hills')).soup, cam, west, half);
    const share = prof.filter((e) => e > 2).length / prof.length;
    print(
      `the West Hills from Broadway: over 2 degrees across ${(share * 100).toFixed(0)} % of the western 80 degrees, up to ${Math.max(...prof).toFixed(1)} degrees`,
    );
    expect(share).toBeGreaterThan(0.4);
    expect(Math.max(...prof)).toBeGreaterThan(4);
    expect(
      Math.max(...horizon(build(WITHOUT.filter((p) => p.kind === 'ridge')).soup, cam, west, half)),
    ).toBeLessThan(1.5);
  });

  it('lays the Willamette between the banks: under the Burnside Bridge, and nowhere along Broadway or East Burnside', () => {
    const river = region.pieces.find((p) => p.id === 'willamette') as FloorPiece;
    const g = geoFrame(net.originLatDeg, net.originLonDeg);
    const poly = river.area.map(([lat, lon]) => g.toWorld(lat, lon));
    const at = (edge: string, s: number) => {
      const p = road.toWorld(road.edgeIndex(edge), s, 0, 0);
      return insidePolygon(p.x, p.z, poly);
    };
    for (const s of [420, 520, 600])
      expect(at('osm-pnw-pdx-burnside-bridge', s), `Burnside Bridge ${s}`).toBe(true);
    for (const s of [0, 100, 200, 300]) expect(at('osm-pnw-pdx-broadway', s), `Broadway ${s}`).toBe(false);
    for (const s of [100, 300, 600])
      expect(at('osm-pnw-pdx-east-burnside', s), `East Burnside ${s}`).toBe(false);
    expect(river.surface).toBe('water');
  });

  it("draws the bridges' headlights crawling across the river bridges, and a tug on the river", () => {
    const { stats } = build();
    for (const id of [
      'steel-bridge',
      'broadway-bridge',
      'marquam-bridge',
      'fremont-bridge',
      'st-johns-bridge',
    ])
      expect(stats.moving, id).toContain(id);
    expect(stats.moving).toContain('willamette-tug');
  });
});

describe('the Portland pieces stay on the Portland network', () => {
  // The Columbia River Highway's walls stand between it and the city (its own ridges hide anything
  // that far off), so no other Pacific Northwest road draws these pieces.
  it('draws none of them on the gorge, the Sound or the other Pacific Northwest roads', () => {
    const ids = new Set(PORTLAND.map((p) => p.id));
    expect(PORTLAND.every((p) => p.networks?.length === 1 && p.networks[0] === ID)).toBe(true);
    for (const other of Object.values(backdropNetworks)) {
      if (other.network === ID) continue;
      const roads = Object.values(networkFiles).find((n) => n.id === other.network);
      if (!roads) continue;
      const net2 = createRoadNetwork({
        network: roads,
        roads: Object.values(roadFiles).filter((r) => roads.roads.includes(r.id)),
      });
      const { stats } = buildSoup(region, other, roadPointsOf(net2.edges, 1), 7);
      for (const id of ids) expect(stats.moving, `${other.network} ${id}`).not.toContain(id);
      expect(stats.kinds.skyline ?? 0, other.network).toBe(0);
      expect(stats.kinds.bridge ?? 0, other.network).toBe(0);
    }
  });
});
