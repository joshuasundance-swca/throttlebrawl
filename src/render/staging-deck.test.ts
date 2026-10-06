// The Seven Mile's repair platform, from the chase camera (playtest 4, P4-19; the run A check, item 10:
// "from the chase camera on the deck, the piles don't show, and the deck reads as a flat orange slab").
// Two rules, each with a control that must fail:
//  - the deck is laid like a deck: plank seams across it and a kerb along each edge, only on a repair
//    deck (a bridge with no drive lane), never on the new span or the old bridge;
//  - the piles can be seen: from a chase camera 7 m behind a rider and 2.6 m up, the deck's own edge
//    hides everything under it, so the piles that read are the ones that stand clear of it and rise
//    above the sightline, against the sea. The test counts the screen area of the pile triangles the
//    deck does not hide, at every position along the bay.
import { Box3, BufferGeometry, Float32BufferAttribute, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { BAY_M, STAGING_LEGS, withStagingLegs } from './bridge-bays';
import { createFlatLook } from './look';
import { buildRoadScene, STAGING_KERB, STAGING_PLANK_M, type RoadDressing } from './road-mesh';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);
const look = createFlatLook();

// ---- The piles, as the chase camera sees them ------------------------------------------------------

/** The camera of the still-scene cost test and the camera's own design note: 7 m back, 2.6 m up, 915 x 412. */
const CAMERA = { backM: 7, upM: 2.6, aheadM: 18, aimUpM: 0.9, fov: 70, w: 915, h: 412 };
/** The platform's deck: the kit's rails stand at 3.92 m; the deck and its fascia hide what is under them. */
const DECK = { halfM: 4.1, thickM: 1.2 };
/** The repair decks stand 4 m over the sea (the real bake's osm-sm-old-road and its kin). */
const DECK_ABOVE_SEA_M = 4;

type V3 = readonly [number, number, number];
/** A pile triangle: its corners, and the red of its colour (the old piles' and the new ones' differ). */
interface Tri {
  v: readonly V3[];
  red: number;
}

/** The triangles `withStagingLegs` adds to a lone triangle, repeated down a bridge every `BAY_M.staging` m. */
function pilesAlongBridge(bays: number): Tri[] {
  const base = new BufferGeometry();
  base.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0.1, 0.1, 0, 0], 3));
  base.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  base.setAttribute('color', new Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  const g = withStagingLegs(base);
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  const tris: Tri[] = [];
  for (let b = -1; b < bays; b++) {
    for (let i = 3; i + 2 < pos.count; i += 3) {
      tris.push({
        v: [0, 1, 2].map(
          (k) => [pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k) + b * BAY_M.staging] as V3,
        ),
        red: col.getX(i),
      });
    }
  }
  return tris;
}

/** Whether the segment from `a` to `b` crosses the deck's box (the slab method). */
function crossesDeck(a: Vector3, b: Vector3): boolean {
  const lo = [-DECK.halfM, -DECK.thickM, -Infinity];
  const hi = [DECK.halfM, 0, Infinity];
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  const o = [a.x, a.y, a.z];
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const dk = d[k] as number;
    const ok = o[k] as number;
    if (Math.abs(dk) < 1e-9) {
      if (ok < (lo[k] as number) || ok > (hi[k] as number)) return false;
      continue;
    }
    let u0 = ((lo[k] as number) - ok) / dk;
    let u1 = ((hi[k] as number) - ok) / dk;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t0 > t1) return false;
  }
  return true;
}

interface Seen {
  /** Screen px squared the deck leaves visible, over the piles within 12 to 70 m ahead. */
  areaPx: number;
  /** Piles (a pile is a run of triangles at one station and side) with at least 40 px squared showing. */
  piles: number;
}

/** What the camera sees of the piles with the rider `s` m along the bridge. */
function seenFrom(tris: readonly Tri[], s: number, only?: readonly Tri[]): Seen {
  const cam = new PerspectiveCamera(CAMERA.fov, CAMERA.w / CAMERA.h, 0.3, 760);
  const eye = new Vector3(0, CAMERA.upM, s - CAMERA.backM);
  cam.position.copy(eye);
  cam.lookAt(0, CAMERA.aimUpM, s + CAMERA.aheadM);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  let areaPx = 0;
  const perPile = new Map<string, number>();
  for (const { v: t } of only ?? tris) {
    const c = new Vector3(
      (t[0]![0] + t[1]![0] + t[2]![0]) / 3,
      (t[0]![1] + t[1]![1] + t[2]![1]) / 3,
      (t[0]![2] + t[1]![2] + t[2]![2]) / 3,
    );
    const ahead = c.z - s;
    if (ahead < 12 || ahead > 70) continue;
    // Under the sea nothing shows.
    if (c.y < -DECK_ABOVE_SEA_M) continue;
    // The deck hides it.
    if (crossesDeck(eye, c)) continue;
    // Facing the camera (a tube's far side is not drawn).
    const [a, b, d] = t.map((p) => new Vector3(p[0], p[1], p[2])) as [Vector3, Vector3, Vector3];
    // The tubes wind outward, so a triangle on a pile's far side faces away and is not drawn.
    const n = b.clone().sub(a).cross(d.clone().sub(a));
    if (n.dot(eye.clone().sub(c)) <= 0) continue;
    const px = [a, b, d].map((p) => {
      const q = p.clone().project(cam);
      return [((q.x + 1) / 2) * CAMERA.w, ((1 - q.y) / 2) * CAMERA.h] as const;
    });
    if (px.some(([x, y]) => x < 0 || x > CAMERA.w || y < 0 || y > CAMERA.h)) continue;
    const area =
      Math.abs(
        (px[1]![0] - px[0]![0]) * (px[2]![1] - px[0]![1]) - (px[2]![0] - px[0]![0]) * (px[1]![1] - px[0]![1]),
      ) / 2;
    areaPx += area;
    const key = `${Math.round(c.z / 2.5)}:${Math.sign(c.x)}`;
    perPile.set(key, (perPile.get(key) ?? 0) + area);
  }
  return { areaPx, piles: [...perPile.values()].filter((v) => v >= 40).length };
}

/** The piles the platform had before this change: the kit-coloured raked ones, leaning in under the deck. */
const rakedOnly = (tris: readonly Tri[]): Tri[] =>
  tris.filter((t) => Math.abs(t.red - (STAGING_LEGS.colour[0] as number)) < 1e-4);

describe('the repair platform stands on piles the chase camera can see (playtest 4, item 10)', () => {
  const tris = pilesAlongBridge(9);
  const positions = Array.from({ length: 20 }, (_, i) => i * (BAY_M.staging / 20));

  it('shows several piles clear of the deck from every position along the bay, with area enough to read', () => {
    const rows = positions.map((s) => seenFrom(tris, s));
    const minArea = Math.min(...rows.map((r) => r.areaPx));
    const minPiles = Math.min(...rows.map((r) => r.piles));
    print(
      `repair platform piles from the chase camera: at least ${Math.round(minArea)} px squared of pile and ${minPiles} piles showing at every position (mean ${Math.round(rows.reduce((a, r) => a + r.areaPx, 0) / rows.length)} px squared)`,
    );
    expect(minPiles).toBeGreaterThanOrEqual(12);
    expect(minArea).toBeGreaterThanOrEqual(2000);
  });

  it('control: the piles the platform had, leaning in under the deck, are what the same measure finds hidden', () => {
    const rows = positions.map((s) => seenFrom(tris, s, rakedOnly(tris)));
    const maxArea = Math.max(...rows.map((r) => r.areaPx));
    const maxPiles = Math.max(...rows.map((r) => r.piles));
    print(`the old raked piles alone: at most ${Math.round(maxArea)} px squared, ${maxPiles} piles showing`);
    expect(maxPiles).toBeLessThan(12);
    expect(maxArea).toBeLessThan(2000);
  });
});

// ---- The deck's own surface ------------------------------------------------------------------------

const networkFile = Object.values(
  import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/osm-keys-seven-mile.json', {
    eager: true,
    import: 'default',
  }),
)[0] as BakedNetwork;
const roadFiles = Object.values(
  import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
    eager: true,
    import: 'default',
  }),
).filter((r) => networkFile.roads.includes(r.id));
const road: RoadNetwork = createRoadNetwork({ network: networkFile, roads: roadFiles });
const dressing = Object.fromEntries(roadFiles.map((r) => [r.id, r])) as unknown as RoadDressing;

describe('the repair deck is laid like a deck (playtest 4, item 10)', () => {
  const scene = buildRoadScene(road, look, dressing, { seed: 1 });
  scene.group.updateMatrixWorld(true);

  /** The road-surface triangles lying `lift` over the deck on one edge, as (s, d) boxes. */
  function laid(edgeId: string, lift: number) {
    const edge = road.edgeIndex(edgeId);
    const out: { s0: number; s1: number; d0: number; d1: number }[] = [];
    // The edge's box, so only the chunks that reach it are walked.
    const box = new Box3();
    const len = road.edges[edge]?.length ?? 0;
    for (let s = 0; s <= len; s += 20) {
      const p = road.toWorld(edge, s, 0, 0);
      box.expandByPoint(new Vector3(p.x, p.y, p.z));
    }
    box.expandByVector(new Vector3(15, 30, 15));
    scene.group.traverse((o) => {
      const mesh = o as { isMesh?: boolean; geometry?: BufferGeometry };
      if (!mesh.isMesh || !mesh.geometry) return;
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox && !mesh.geometry.boundingBox.intersectsBox(box)) return;
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      const n = index ? index.count : pos.count;
      for (let i = 0; i + 2 < n; i += 3) {
        const ids = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
        const ps = ids.map((id) => ({ x: pos.getX(id), y: pos.getY(id), z: pos.getZ(id) }));
        const near = road.project(ps[0]!.x, ps[0]!.z);
        if (near.edge !== edge) continue;
        const sd = ps.map((p) => {
          const q = road.project(p.x, p.z);
          return { s: q.s, d: q.d, rel: p.y - road.toWorld(edge, q.s, 0, 0).y };
        });
        if (sd.some((q) => Math.abs(q.rel - lift) > 0.004)) continue;
        // A triangle whose corners the projection puts far apart on the edge belongs to another road.
        if (Math.max(...sd.map((q) => q.s)) - Math.min(...sd.map((q) => q.s)) > 5) continue;
        out.push({
          s0: Math.min(...sd.map((q) => q.s)),
          s1: Math.max(...sd.map((q) => q.s)),
          d0: Math.min(...sd.map((q) => q.d)),
          d1: Math.max(...sd.map((q) => q.d)),
        });
      }
    });
    return out;
  }

  const LAID_LIFT = 0.06;
  const deckEdge = 'osm-sm-old-road';
  const length = road.edges[road.edgeIndex(deckEdge)]?.length ?? 0;
  const gapM = 30;

  it('puts a plank seam across the repair deck every STAGING_PLANK_M, bar its gap', () => {
    const seams = laid(deckEdge, LAID_LIFT).filter((t) => t.d1 - t.d0 > 4 && t.s1 - t.s0 < 0.4);
    // Two triangles to a seam quad: count the distinct places they start.
    const places = new Set(seams.map((t) => Math.floor(t.s0 / STAGING_PLANK_M)));
    const expected = (length - gapM) / STAGING_PLANK_M;
    print(
      `${places.size} plank seams on the ${length.toFixed(0)} m repair deck (about ${expected.toFixed(0)} expected, the gap taken out)`,
    );
    expect(places.size).toBeGreaterThanOrEqual(expected * 0.9);
    expect(places.size).toBeLessThanOrEqual(expected * 1.1);
  });

  it('runs a kerb along each edge of the repair deck, the length of it bar the gap', () => {
    const kerbs = laid(deckEdge, LAID_LIFT).filter((t) => t.s1 - t.s0 > 0.9);
    for (const side of [-1, 1]) {
      const own = kerbs.filter((t) => Math.sign(t.d0 + t.d1) === side);
      expect(own.length, `a kerb on side ${side}`).toBeGreaterThan(0);
      // Inside the lane's edge (3 m), STAGING_KERB.widthM wide.
      for (const t of own) {
        expect(Math.abs(t.d0), 'inside the edge').toBeGreaterThanOrEqual(3 - STAGING_KERB.widthM - 0.05);
        expect(Math.abs(t.d1), 'inside the edge').toBeLessThanOrEqual(3 + 0.05);
      }
      const covered = new Set(own.map((t) => Math.round(t.s0 / 2))).size * 2;
      print(`kerb on side ${side}: ${covered.toFixed(0)} m of ${(length - gapM).toFixed(0)} m`);
      expect(covered).toBeGreaterThanOrEqual((length - gapM) * 0.85);
    }
  });

  it('control: the new span and the old bridge carry neither seams nor kerbs of this kind, and the laying check can see them', () => {
    // The check finds a deck's seams where there are some (so an empty answer below is a real one).
    expect(laid(deckEdge, LAID_LIFT).length).toBeGreaterThan(100);
    for (const id of ['osm-sm-bridge-east', 'osm-sm-old-moser']) {
      expect(JSON.stringify(laid(id, LAID_LIFT)), id).toBe('[]');
    }
  });
});
