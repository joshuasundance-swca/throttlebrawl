// The real roads' own horizons (playtest 4, P4-19, run B task B1; the maintainer: "The real roads do not
// have the characteristics of the roads in question in terms of scenery and feel etc"). The checks
// build the real pack data on the real baked networks and assert each rule from what a rider would
// see, with a control for each:
// - the near fade (G1): a piece with `nearFadeM` is the far form of a model the near world draws up
//   close, never drawn nearer than the near fog's end, so the two never show at once;
// - the Golden Gate from the headlands (G1): the far bridge stands on the near kit's own line and shows
//   from Hawk Hill and Conzelman Road, where the near kit is lost in the fog;
// - Coit Tower over Telegraph Hill on the San Francisco networks with no near Coit Tower (W2);
// - the old Bahia Honda rail bridge beside the new one (B1; B5 moved it into the baked road's own metres,
//   next to the new bridge: bahia-honda.test.ts).
import { Color, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../../road';
import { landmarkPlacements, SUSPENSION } from '../landmarks';
import { buildBackdrop, buildSoup, fadeFrom, nearFadeAt, roadPointsOf } from './builder';
import type { BackdropNetworkFile, BackdropRegionFile, BridgePiece, Piece, Pt, SkylinePiece } from './data';
import { geoFrame } from './geo';
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
  {
    eager: true,
    import: 'default',
  },
);
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

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

/** A network's backdrop with only the pieces `keep` passes (from both files), on its real roads. */
function build(id: string, keep: (p: Piece) => boolean = () => true, seed = 7) {
  const { region, network } = files(id);
  return buildSoup(
    { ...region, pieces: region.pieces.filter(keep) },
    { ...network, pieces: (network.pieces ?? []).filter(keep) },
    roadPointsOf(track(id).edges, 1),
    seed,
  );
}

/** The vertex indices a soup built past the far ground ring (what the pieces themselves built). */
function pieceVertices(soup: Soup, ringOnly: Soup): number[] {
  const from = ringOnly.pos.length / 3;
  return Array.from({ length: soup.pos.length / 3 - from }, (_, i) => from + i);
}

const vtx = (s: Soup, v: number) => ({ x: s.pos[v * 3]!, y: s.pos[v * 3 + 1]!, z: s.pos[v * 3 + 2]! });
const piecesOf = (id: string): Piece[] => [...files(id).region.pieces, ...(files(id).network.pieces ?? [])];

const GG = 'osm-sf-golden-gate';
const GG_FAR = 'golden-gate-far';

describe('the near fade (G1): the far form of a near model is never drawn inside the fog', () => {
  it('cuts a faded vertex nearer than the near fog end, brings it out of the haze past it, and leaves the rest alone', () => {
    for (const fogFar of [300, 480, 700, 900]) {
      const from = fadeFrom(fogFar);
      // The near model is wholly fogged at the fog's end, and clipped past the camera's far plane.
      expect(from).toBe(Math.min(fogFar, 750));
      expect(nearFadeAt(from - 1, 250, fogFar)).toBeNull();
      expect(nearFadeAt(0, 250, fogFar)).toBeNull();
      expect(nearFadeAt(from, 250, fogFar)).toBe(1);
      expect(nearFadeAt(from + 250, 250, fogFar)).toBe(0);
      expect(nearFadeAt(from + 10_000, 250, fogFar)).toBe(0);
      let last = 1;
      for (let d = from; d <= from + 250; d += 10) {
        const h = nearFadeAt(d, 250, fogFar)!;
        expect(h).toBeLessThanOrEqual(last);
        last = h;
      }
      // Control: a piece with no fade is drawn at any depth, with no extra haze.
      for (const d of [1, from - 1, from, from + 100]) expect(nearFadeAt(d, 0, fogFar)).toBe(0);
    }
  });

  it('is what the material does: each vertex carries its fade, the cut follows the fog, the shader discards', () => {
    const { region, network } = files(GG);
    const built = buildBackdrop(region, network, roadPointsOf(track(GG).edges, 1), 7);
    const geo = built.mesh.geometry;
    expect(geo.getAttribute('aFade').count).toBe(geo.getAttribute('position').count);
    const mat = built.mesh.material as ShaderMaterial;
    expect(mat.vertexShader).toContain('attribute float aFade');
    expect(mat.fragmentShader).toMatch(/if \(k < 0\.0\) discard;/);
    const uniforms = mat.uniforms as Record<string, { value: unknown }>;
    built.update({ x: 0, y: 0, z: 0 }, new Color('#ffffff'), 480, 0);
    expect(uniforms['uFadeFrom']?.value).toBe(480);
    built.update({ x: 0, y: 0, z: 0 }, new Color('#ffffff'), 900, 0);
    expect(uniforms['uFadeFrom']?.value).toBe(750);
    built.dispose();
  });

  it("records each piece's own fade on its vertices, and none on any other piece's", () => {
    const all = build(GG).soup;
    const ring = build(GG, () => false).soup;
    const far = build(GG, (p) => p.id === GG_FAR).soup;
    const farVerts = pieceVertices(far, ring);
    expect(farVerts.length).toBeGreaterThan(100);
    expect(farVerts.every((v) => far.fade[v] === 250)).toBe(true);
    const faded = all.fade.filter((f) => f > 0).length;
    expect(faded).toBe(farVerts.length);
    print(`${GG}: ${faded} of ${all.fade.length} backdrop vertices fade (the far Golden Gate's, 250 m)`);
  });
});

describe('the Golden Gate from the headlands (G1)', () => {
  const road = track(GG);
  const near = landmarkPlacements(road).find((p) => p.node === 'gg_bridge');
  const piece = piecesOf(GG).find((p) => p.id === GG_FAR) as BridgePiece | undefined;

  it("stands the far bridge on the near kit's own line: its ends at the anchorages, its towers at the towers", () => {
    expect(near, 'the near kit is placed').toBeDefined();
    expect(piece, 'the far piece is on this network').toBeDefined();
    if (!near || !piece) return;
    expect(piece.nearFadeM ?? 0).toBeGreaterThan(0);
    const { network } = files(GG);
    const g = geoFrame(network.originLatDeg, network.originLonDeg);
    const w = (q: Pt) => (piece.frame === 'local' ? [q[0], q[1]] : g.toWorld(q[0], q[1]));
    const [ax, az] = w(piece.from);
    const [bx, bz] = w(piece.to);
    const at = (u: number) => [ax! + (bx! - ax!) * u, az! + (bz! - az!) * u] as const;
    const f = near.feature;
    const side = SUSPENSION.sideSpanM;
    const nearPts = [f.s0, f.s0 + side, f.s1 - side, f.s1].map((s) => road.toWorld(near.edge, s, 0, 0));
    const farPts = [0, ...(piece.towersAt ?? []), 1].map(at);
    expect(farPts).toHaveLength(4);
    const off = nearPts.map((p, i) => Math.hypot(p.x - farPts[i]![0], p.z - farPts[i]![1]));
    // The far deck's top as built over each of those points: the height, where the point lies under it,
    // of the highest still, non-vertical triangle below the towers' tops (the deck's top faces).
    const ring = build(GG, () => false).soup;
    const far = build(GG, (p) => p.id === GG_FAR).soup;
    const verts = pieceVertices(far, ring);
    // (Just inside each end, so the point is under the deck rather than on its edge.)
    const deckPts = [f.s0 + 5, f.s0 + side, f.s1 - side, f.s1 - 5].map((s) =>
      road.toWorld(near.edge, s, 0, 0),
    );
    const deckTop = deckPts.map((q) => {
      let top = -Infinity;
      for (let i = 0; i + 2 < verts.length; i += 3) {
        const [a, b, c] = [verts[i]!, verts[i + 1]!, verts[i + 2]!].map((v) => vtx(far, v)) as [
          ReturnType<typeof vtx>,
          ReturnType<typeof vtx>,
          ReturnType<typeof vtx>,
        ];
        if (far.motion[verts[i]! * 4 + 2] !== 0 || Math.max(a.y, b.y, c.y) > 120) continue;
        const det = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
        if (Math.abs(det) < 1e-6) continue;
        const u = ((q.x - a.x) * (c.z - a.z) - (c.x - a.x) * (q.z - a.z)) / det;
        const w = ((b.x - a.x) * (q.z - a.z) - (q.x - a.x) * (b.z - a.z)) / det;
        if (u < -1e-9 || w < -1e-9 || u + w > 1 + 1e-9) continue;
        top = Math.max(top, a.y + u * (b.y - a.y) + w * (c.y - a.y));
      }
      return top;
    });
    print(
      `far Golden Gate against the near kit: ends and towers ${off.map((o) => o.toFixed(1)).join(', ')} m apart; its deck ${deckTop.map((y) => y.toFixed(1)).join(', ')} m against the road's ${deckPts.map((p) => p.y.toFixed(1)).join(', ')} m`,
    );
    for (const o of off) expect(o).toBeLessThan(5);
    // The far deck lies on the road's own deck at each end and tower, so the handover is one bridge.
    deckPts.forEach((p, i) => expect(Math.abs(p.y - deckTop[i]!)).toBeLessThan(2));
  });

  it('shows from Hawk Hill and Conzelman Road, where the near kit is lost in the fog', () => {
    const ring = build(GG, () => false).soup;
    const far = build(GG, (p) => p.id === GG_FAR).soup;
    const towers = pieceVertices(far, ring).filter((v) => far.pos[v * 3 + 1]! > 150);
    expect(towers.length).toBeGreaterThan(10);
    const fogFar = 480;
    let cameras = 0;
    let seen = 0;
    let highest = 0;
    for (const id of ['osm-sf-gg-hawk-hill', 'osm-sf-gg-conzelman']) {
      const e = road.edgeIndex(id);
      for (let s = 0; s < road.edges[e]!.length; s += 20) {
        const cam = road.toWorld(e, s, 0, 3.2);
        cameras++;
        let best = -90;
        for (const v of towers) {
          const p = vtx(far, v);
          const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
          // Facing a tower, its view depth is its distance: the most of it the rider can see.
          const h = nearFadeAt(d, far.fade[v]!, fogFar);
          if (h === null || h > 0.5) continue;
          best = Math.max(
            best,
            (Math.atan2(p.y - cam.y, Math.hypot(p.x - cam.x, p.z - cam.z)) * 180) / Math.PI,
          );
        }
        if (best > -90) seen++;
        highest = Math.max(highest, best);
      }
    }
    // Control: today's region pieces alone stand nothing over 150 m within 400 m of the deck.
    const control = build(GG, (p) => p.id !== GG_FAR).soup;
    const mid = road.toWorld(near!.edge, (near!.feature.s0 + near!.feature.s1) / 2, 0, 0);
    let controlTowers = 0;
    for (let v = 0; v < control.pos.length / 3; v++) {
      const p = vtx(control, v);
      if (p.y > 150 && Math.hypot(p.x - mid.x, p.z - mid.z) < 1400) controlTowers++;
    }
    print(
      `the far Golden Gate's towers seen (past the fog, less than half hazed) from ${seen} of ${cameras} cameras on Hawk Hill and Conzelman Road, up to ${highest.toFixed(1)} degrees; control without the piece: ${controlTowers} tower vertices over the strait`,
    );
    expect(seen / cameras).toBeGreaterThan(0.9);
    expect(controlTowers).toBe(0);
  });

  it('is never drawn where the near kit draws: from every camera on the route, nothing of it inside the fog', () => {
    const ring = build(GG, () => false).soup;
    const count = (soup: Soup) => {
      let drawnInFog = 0;
      let pairs = 0;
      const verts = pieceVertices(soup, ring);
      for (const e of road.edges)
        for (let s = 0; s < e.length; s += 25) {
          const cam = road.toWorld(e.index, s, 0, 3.2);
          for (const fogFar of [300, 480, 700]) {
            for (const v of verts) {
              const p = vtx(soup, v);
              // Its view depth is at most its distance: a vertex this near is inside the fog.
              const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
              if (d >= fadeFrom(fogFar)) continue;
              pairs++;
              if (nearFadeAt(d, soup.fade[v]!, fogFar) !== null) drawnInFog++;
            }
          }
        }
      return { drawnInFog, pairs };
    };
    const real = count(build(GG, (p) => p.id === GG_FAR).soup);
    // Control: the same piece with no fade (#503's second bridge) is drawn inside the fog all along.
    const { region, network } = files(GG);
    const unfaded = buildSoup(
      { ...region, pieces: [] },
      {
        ...network,
        pieces: (network.pieces ?? []).filter((p) => p.id === GG_FAR).map(({ nearFadeM: _, ...p }) => p),
      },
      roadPointsOf(road.edges, 1),
      7,
    ).soup;
    const control = count(unfaded);
    print(
      `far Golden Gate vertices inside the fog from cameras along the route: ${real.drawnInFog} of ${real.pairs} drawn; without its fade ${control.drawnInFog} of ${control.pairs}`,
    );
    expect(real.pairs).toBeGreaterThan(1000);
    expect(real.drawnInFog).toBe(0);
    expect(control.drawnInFog).toBe(control.pairs);
  });
});

// W2: Coit Tower on Telegraph Hill, over the city from the San Francisco networks. Lombard's route
// finishes there with the near kit's tower, so the far one stands on every other network and never on
// one that places a near coit_tower.
describe('Coit Tower over Telegraph Hill (W2)', () => {
  const SF = Object.values(networkFiles)
    .filter((n) => n.region === 'san-francisco')
    .map((n) => n.id);
  const nearCoit = (id: string) => landmarkPlacements(track(id)).some((p) => p.node === 'coit_tower');

  it('stands where the baked Telegraph Hill Boulevard ends, at the hill top', () => {
    const coit = files('osm-sf-lombard').region.pieces.find((p) => p.id === 'coit-tower') as
      SkylinePiece | undefined;
    expect(coit, 'the region has a coit-tower piece').toBeDefined();
    if (!coit) return;
    const tower = coit.towers?.[0];
    expect(tower).toBeDefined();
    if (!tower) return;
    const road = track('osm-sf-lombard');
    const { network } = files('osm-sf-lombard');
    const [x, z] = geoFrame(network.originLatDeg, network.originLonDeg).toWorld(tower.at[0], tower.at[1]);
    const e = road.edgeIndex('osm-sf-lombard-telegraph-hill');
    const end = road.toWorld(e, road.edges[e]!.length, 0, 0);
    const off = Math.hypot(end.x - x, end.z - z);
    print(
      `far Coit Tower ${off.toFixed(0)} m from the end of the baked Telegraph Hill Boulevard (y ${end.y.toFixed(0)} m), standing on ${coit.baseM} m`,
    );
    expect(off).toBeLessThan(60);
    expect(Math.abs((coit.baseM ?? 0) - end.y)).toBeLessThan(10);
  });

  it('is listed for exactly the San Francisco networks with no near Coit Tower, and stands on them', () => {
    const pieces = files('osm-sf-lombard').region.pieces.filter(
      (p) => p.id === 'coit-tower' || p.id === 'telegraph-hill',
    );
    expect(pieces).toHaveLength(2);
    const withNear = SF.filter(nearCoit);
    expect(withNear).toContain('osm-sf-lombard');
    const standing: string[] = [];
    for (const p of pieces)
      for (const id of SF) expect(p.networks?.includes(id) ?? true, `${p.id} on ${id}`).toBe(!nearCoit(id));
    for (const id of SF.filter((n) => !nearCoit(n))) {
      const s = build(id, (p) => p.id === 'coit-tower').stats;
      if (s.kinds.skyline) standing.push(id);
    }
    print(
      `far Coit Tower: ${withNear.join(', ')} place the near one; the far one stands on ${standing.length} of ${SF.length - withNear.length} others (${standing.join(', ')})`,
    );
    // Its hill-top spot is 60 m from Chinatown's lantern row: there the keep-out leaves it out.
    expect(standing.length).toBeGreaterThanOrEqual(SF.length - withNear.length - 1);
  });
});
