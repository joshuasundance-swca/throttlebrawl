// The old Bahia Honda rail bridge, beside the new one (playtest 4, P4-19: the identity sheets' fix 5, B1;
// run B task B5). The 1912 rail bridge, a steel camelback truss with the 1938 road deck laid on top of it
// and two spans out, stands a few tens of metres from the new 1972 bridge the route rides: it is the place's
// signature. B1 (#540) put it on the horizon at OpenStreetMap's line, 216 m from the new bridge; but the
// bake compresses the land stretches and smooths the headings, so the baked bridge is not where the real
// map has it (the two lines differ by about 7 degrees), and a real-map line misses the road it stands beside.
// So its line is written in the baked road's own metres (`frame: local`), parallel to the new bridge and
// on its south side, where the map has it. The checks build the real pack data on the real baked network
// and assert each rule from what a rider would see, with a control for each:
// - it stands beside the new bridge, within about 100 m of the road and never within 12 m of a lane;
// - it is on the road's south (left) side, and there is exactly one old bridge on this network;
// - its two spans are out, as long as one span each, and a control without gaps has none;
// - it shows from the road: the vertices in view of a phone held upright, from every chase camera along it;
// - it costs a few thousand triangles in the backdrop's one mesh;
// - the far one stays on the Seven Mile's horizon, where the old bridge is a sliver 6 km off.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../../road';
import { buildSoup, roadPointsOf } from './builder';
import type { BackdropNetworkFile, BackdropRegionFile, BridgePiece, Piece } from './data';
import type { Soup } from './soup';

const networkFiles = import.meta.glob<
  BakedNetwork & { region: string; crs: { originLatDeg: number; originLonDeg: number } }
>('../../../packs/*/regions/*/networks/*.json', { eager: true, import: 'default' });
const roadFiles = import.meta.glob<BakedRoad>('../../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const backdropNetworks = import.meta.glob<BackdropNetworkFile>(
  '../../../packs/*/assets/backdrop/*/networks/*.json',
  { eager: true, import: 'default' },
);
const backdropRegions = import.meta.glob<BackdropRegionFile>(
  '../../../packs/*/assets/backdrop/*/region.json',
  { eager: true, import: 'default' },
);
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const ID = 'osm-keys-bahia-honda';
const SEVEN_MILE = 'osm-keys-seven-mile';
const OLD = 'old-bahia-honda-bridge';
const NEW_BRIDGE = 'osm-bahia-honda-bridge';

function files(id: string): { region: BackdropRegionFile; network: BackdropNetworkFile } {
  const key = Object.keys(backdropNetworks).find((k) => k.endsWith(`/networks/${id}.json`));
  if (!key) throw new Error(`no backdrop for ${id}`);
  return {
    network: backdropNetworks[key]!,
    region: backdropRegions[key.replace(/networks\/[^/]+\.json$/, 'region.json')]!,
  };
}

const roads = new Map<string, RoadNetwork>();
function track(id: string): RoadNetwork {
  const cached = roads.get(id);
  if (cached) return cached;
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const road = createRoadNetwork({
    network,
    roads: Object.values(roadFiles).filter((r) => network.roads.includes(r.id)),
  });
  roads.set(id, road);
  return road;
}

/** The pieces a network draws: the region's that list it (or no network), and its own. */
const piecesOf = (id: string): Piece[] => {
  const f = files(id);
  return [
    ...f.region.pieces.filter((p) => !p.networks || p.networks.includes(id)),
    ...(f.network.pieces ?? []),
  ];
};

/** A network's soup with only the pieces `keep` passes (from both files), on its real roads. */
function build(id: string, keep: (p: Piece) => boolean, seed = 7): Soup {
  const { region, network } = files(id);
  return buildSoup(
    { ...region, pieces: region.pieces.filter(keep) },
    { ...network, pieces: (network.pieces ?? []).filter(keep) },
    roadPointsOf(track(id).edges, 1),
    seed,
  ).soup;
}

/** What the pieces themselves built: the vertices past the far ground ring. */
const pieceVertices = (soup: Soup, ring: Soup): { x: number; y: number; z: number }[] =>
  Array.from({ length: soup.pos.length / 3 - ring.pos.length / 3 }, (_, i) => {
    const v = ring.pos.length / 3 + i;
    return { x: soup.pos[v * 3]!, y: soup.pos[v * 3 + 1]!, z: soup.pos[v * 3 + 2]! };
  });

const only = (p: Piece) => p.id === OLD;
const ring = () => build(ID, () => false);

/** This one piece alone (as the network's own), on this network's real roads. */
function standalone(p: Piece): Soup {
  const { region, network } = files(ID);
  return buildSoup(
    { ...region, pieces: [] },
    { ...network, pieces: [p] },
    roadPointsOf(track(ID).edges, 1),
    7,
  ).soup;
}

/** The new bridge's centre line every metre, with the road's heading there: where the old one is measured from. */
function newBridge() {
  const road = track(ID);
  const e = road.edgeIndex(NEW_BRIDGE);
  const len = road.edges[e]!.length;
  return Array.from({ length: Math.floor(len) + 1 }, (_, s) => {
    const a = road.toWorld(e, s, 0, 0);
    const b = road.toWorld(e, Math.min(len, s + 2), 0, 0);
    const n = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: a.x, z: a.z, hx: (b.x - a.x) / n, hz: (b.z - a.z) / n };
  });
}

describe('the old Bahia Honda bridge, beside the new one (B1, B5)', () => {
  it("is one truss with the road deck on top and two spans out, in the baked road's own metres, and the only old bridge here", () => {
    const found = piecesOf(ID).filter((p) => /bahia-honda/.test(p.id));
    expect(found.map((p) => p.id)).toEqual([OLD]);
    const piece = found[0] as BridgePiece;
    expect(piece.kind).toBe('bridge');
    expect(piece.style).toBe('truss');
    expect(piece.frame).toBe('local');
    expect(piece.deckOnTop).toBe(true);
    expect(piece.gaps ?? []).toHaveLength(2);
    // Near the road, so its own small keep-out, well under the far pieces' 150 m (the geometry sweep holds it
    // to its own rule: tests/sim/geometry-backdrop.test.ts).
    expect(piece.keepOutM).toBeGreaterThan(0);
    expect(piece.keepOutM).toBeLessThan(150);
    // The far one that B1 put at the real line is not drawn on this network any more: it is a second bridge.
    const far = files(ID).region.pieces.find((p) => p.id === OLD);
    expect(far?.networks ?? []).not.toContain(ID);
  });

  it('stands within about 100 m of the road, on its south side, and never within 12 m of a lane', () => {
    const piece = piecesOf(ID).find((p) => p.id === OLD) as BridgePiece | undefined;
    expect(piece, 'the piece').toBeDefined();
    if (!piece) return;
    const soup = build(ID, only);
    const verts = pieceVertices(soup, ring());
    const road = newBridge();
    const every = roadPointsOf(track(ID).edges, 1);
    let nearest = Infinity;
    let farthest = 0;
    const lateral: number[] = [];
    for (const p of verts) {
      let best = Infinity;
      for (const [x, z] of every) best = Math.min(best, Math.hypot(x - p.x, z - p.z));
      nearest = Math.min(nearest, best);
      farthest = Math.max(farthest, best);
    }
    // The deck's top: signed distance from the new bridge's line (positive to the right of travel).
    for (const p of verts.filter((q) => Math.abs(q.y - piece.deckM) < 1e-6)) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < road.length; i++) {
        const d = Math.hypot(road[i]!.x - p.x, road[i]!.z - p.z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      const r = road[best]!;
      lateral.push((p.x - r.x) * -r.hz + (p.z - r.z) * r.hx);
    }
    const mean = lateral.reduce((a, b) => a + b, 0) / lateral.length;
    const mid = road[Math.floor(road.length / 2)]!;
    print(
      `old Bahia Honda: ${verts.length / 3} triangles, ${nearest.toFixed(1)} m from the nearest road point, ` +
        `${farthest.toFixed(1)} m at the farthest vertex, its deck ${mean.toFixed(1)} m from the new bridge's line ` +
        `(range ${Math.min(...lateral).toFixed(1)} to ${Math.max(...lateral).toFixed(1)}), the road heading west by ${mid.hx.toFixed(2)}`,
    );
    expect(verts.length / 3).toBeGreaterThan(1500);
    expect(nearest).toBeGreaterThan(12);
    expect(farthest).toBeLessThan(100);
    // The road runs west here (x falls), so its left is the south: the map has the old bridge south of the new.
    expect(mid.hx).toBeLessThan(-0.5);
    expect(lateral.length).toBeGreaterThan(20);
    expect(Math.max(...lateral)).toBeLessThan(-12);
    expect(Math.min(...lateral)).toBeGreaterThan(-60);
  });

  it('has two spans out, each as long as one span, and a control with no gaps has none', () => {
    const piece = piecesOf(ID).find((p) => p.id === OLD) as BridgePiece | undefined;
    expect(piece, 'the piece').toBeDefined();
    if (!piece) return;
    const [ax, az] = piece.from;
    const [bx, bz] = piece.to;
    const len = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    /** The stretches of the line with no deck top over them, m from `from`. */
    const holes = (p: BridgePiece) => {
      const s = buildSoup(
        { formatVersion: 1, region: 'x', hazeM: 1, floorColour: '#ffffff', pieces: [p] },
        { formatVersion: 1, network: 'x', originLatDeg: 24.7, originLonDeg: -81.1 },
        [],
        7,
      ).soup;
      const spans: [number, number][] = [];
      for (let i = 0; i < s.pos.length; i += 9) {
        const ys = [s.pos[i + 1]!, s.pos[i + 4]!, s.pos[i + 7]!];
        if (!ys.every((y) => Math.abs(y - p.deckM) < 1e-6)) continue;
        const ms = [0, 3, 6].map((k) => (s.pos[i + k]! - ax) * tx + (s.pos[i + k + 2]! - az) * tz);
        spans.push([Math.min(...ms), Math.max(...ms)]);
      }
      const out: [number, number][] = [];
      let start = -1;
      for (let m = 0; m <= len; m += 0.25) {
        const covered = spans.some(([a, b]) => m >= a - 1e-6 && m <= b + 1e-6);
        if (!covered && start < 0) start = m;
        if (covered && start >= 0) {
          out.push([start, m]);
          start = -1;
        }
      }
      if (start >= 0) out.push([start, len]);
      return out;
    };
    const found = holes({ ...piece, keepOutM: 1 });
    const spanM = len / Math.max(1, Math.round(len / (piece.spanM ?? 60)));
    print(
      `old Bahia Honda: ${len.toFixed(0)} m long, holes ${found.map(([a, b]) => `${a.toFixed(0)}..${b.toFixed(0)}`).join(', ')} (a span is ${spanM.toFixed(1)} m)`,
    );
    expect(found).toHaveLength(2);
    for (const [a, b] of found) {
      expect(b - a).toBeGreaterThan(spanM - 1);
      expect(b - a).toBeLessThan(spanM + 1);
    }
    expect(holes({ ...piece, keepOutM: 1, gaps: [] })).toEqual([]);
  });

  it('shows from the road: in view of a phone held upright from every chase camera along it, and from none if it is left out', () => {
    const piece = piecesOf(ID).find((p) => p.id === OLD) as BridgePiece | undefined;
    expect(piece, 'the piece').toBeDefined();
    if (!piece) return;
    const verts = pieceVertices(build(ID, only), ring()).filter((v) => v.y > 0.5);
    const none = pieceVertices(
      build(ID, () => false),
      ring(),
    );
    const road = track(ID);
    const e = road.edgeIndex(NEW_BRIDGE);
    // A 60 degree vertical view on a 9:19.5 screen is about 15 degrees each side of the road's line.
    const HALF = Math.atan(Math.tan((30 * Math.PI) / 180) * (9 / 19.5));
    const inView = (list: { x: number; y: number; z: number }[], s: number) => {
      const c = road.toWorld(e, s - 8, 2, 3.2);
      const a = road.toWorld(e, s + 10, 2, 3.2);
      const n = Math.hypot(a.x - c.x, a.z - c.z);
      const hx = (a.x - c.x) / n;
      const hz = (a.z - c.z) / n;
      return list.filter((v) => {
        const dx = v.x - c.x;
        const dz = v.z - c.z;
        const fwd = dx * hx + dz * hz;
        return fwd >= 60 && fwd <= 480 && Math.abs(Math.atan2(-dx * hz + dz * hx, fwd)) <= HALF;
      }).length;
    };
    const counts: number[] = [];
    // Its straight run: the same stretch as the piece (the road's s 260 to 1700), less the last 480 m ahead.
    for (let s = 280; s <= 1300; s += 40) counts.push(inView(verts, s));
    print(
      `old Bahia Honda in view from ${counts.length} cameras: ${Math.min(...counts)} to ${Math.max(...counts)} vertices (none: ${Math.max(...counts.map((_, i) => inView(none, 280 + i * 40)))})`,
    );
    expect(counts.length).toBeGreaterThan(20);
    for (const n of counts) expect(n).toBeGreaterThan(100);
    // Control: with the piece left out, nothing of it is in view from any of them.
    for (let s = 280; s <= 1300; s += 40) expect(inView(none, s)).toBe(0);
    // Control: the same bridge 400 m off to the north is built, and stands in the view of none of them.
    const shifted = {
      ...piece,
      from: [piece.from[0], piece.from[1] - 400],
      to: [piece.to[0], piece.to[1] - 400],
    } as BridgePiece;
    const away = pieceVertices(standalone(shifted), ring()).filter((v) => v.y > 0.5);
    expect(away.length).toBe(verts.length);
    for (let s = 280; s <= 1300; s += 40) expect(inView(away, s)).toBe(0);
  });

  it('is a few thousand triangles of the one mesh, and the default keep-out would have dropped it', () => {
    const piece = piecesOf(ID).find((p) => p.id === OLD) as BridgePiece | undefined;
    expect(piece, 'the piece').toBeDefined();
    if (!piece) return;
    const all = build(ID, () => true);
    const without = build(ID, (p) => p.id !== OLD);
    const added = (all.pos.length - without.pos.length) / 9;
    print(`old Bahia Honda: ${added} triangles of ${all.pos.length / 9} on the network's backdrop`);
    expect(added).toBeGreaterThan(1500);
    expect(added).toBeLessThan(3500);
    expect(all.pos.length / 9).toBeLessThan(20_000);
    // Control: with no keep-out of its own the 800 m default drops it, so the field is what lets it stand.
    const { keepOutM: _own, ...plain } = piece;
    expect(standalone(plain as Piece).pos.length).toBe(ring().pos.length);
    expect(standalone(piece).pos.length).toBeGreaterThan(ring().pos.length);
  });

  it("is still on the Seven Mile's horizon, where the real line is a sliver 6 km off", () => {
    const far = piecesOf(SEVEN_MILE).find((p) => p.id === OLD) as BridgePiece | undefined;
    expect(far, 'the far piece on the Seven Mile').toBeDefined();
    expect(far?.frame).toBeUndefined();
    expect(far?.keepOutM).toBeGreaterThanOrEqual(150);
  });
});
