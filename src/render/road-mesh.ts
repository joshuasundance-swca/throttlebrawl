// The road as meshes (M1 render-1): surfaces from the road profiles, markings, posts, bridge rails,
// deck fascias and pylons, the ramp's warning stripes and the sea. Every edge goes into the same
// merged geometry per material, so the draw-call count stays flat however many edges the network
// has (docs/architecture.md, "Performance budgets": merged static geometry per chunk).
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3 } from 'three';
import type { Edge, RoadNetwork } from '../road';
import type { LaneInfo } from '../sim/api';
import { StripAccumulator, type Point3 } from './geometry';
import type { LookStyle, MaterialKind } from './look';

/** Surface higher than this above sea level (world y = 0) counts as a bridge deck. */
export const ELEVATED_M = 2.5;
/** Metres of shoulder beyond the outermost lane, drawn as verge. */
const VERGE_M = 0.6;
const STEP_M = 2;

export interface BarrierSpan {
  s0: number;
  s1: number;
  side: string;
  kind: string;
  heightM?: number;
}
export interface FeatureSpan {
  kind: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  /** A `billboard` slot's own id, and the region item or pool it shows (boards.ts). */
  id?: string | undefined;
  item?: string | undefined;
  pool?: string | undefined;
}
export interface TagSpan {
  s0: number;
  s1: number;
  side?: string;
  tag: string;
}
/** Per-road set dressing, structurally a subset of a road file (docs/content-packs.md). */
export interface EdgeDressing {
  barriers?: readonly BarrierSpan[] | undefined;
  features?: readonly FeatureSpan[] | undefined;
  tags?: readonly TagSpan[] | undefined;
}
/** Set dressing keyed by road id. Road files satisfy EdgeDressing, so app/ can pass them as-is. */
export type RoadDressing = Readonly<Record<string, EdgeDressing>>;

export interface RoadSceneStats {
  meshes: number;
  triangles: number;
  railM: number;
  rampStripes: number;
  pylons: number;
}

export interface RoadScene {
  group: Group;
  stats: RoadSceneStats;
  dispose(): void;
}

interface LaneSpans {
  drive: [number, number] | null;
  shortcut: [number, number] | null;
  /** Lines between adjacent drive lanes; `opposite` when the two lanes run opposite ways. */
  dividers: { d: number; opposite: boolean }[];
}

export function laneSpans(lanes: readonly LaneInfo[]): LaneSpans {
  const span = (kind: LaneInfo['kind']): [number, number] | null => {
    const ls = lanes.filter((l) => l.kind === kind);
    if (!ls.length) return null;
    return [
      Math.min(...ls.map((l) => l.dCenterM - l.widthM / 2)),
      Math.max(...ls.map((l) => l.dCenterM + l.widthM / 2)),
    ];
  };
  const drive = lanes.filter((l) => l.kind === 'drive').sort((a, b) => a.dCenterM - b.dCenterM);
  const dividers: LaneSpans['dividers'] = [];
  for (let i = 1; i < drive.length; i++) {
    const a = drive[i - 1];
    const b = drive[i];
    if (!a || !b) continue;
    dividers.push({
      d: (a.dCenterM + a.widthM / 2 + b.dCenterM - b.widthM / 2) / 2,
      opposite: a.direction !== b.direction,
    });
  }
  return { drive: span('drive'), shortcut: span('shortcut'), dividers };
}

/** Dressing for an edge: the explicit record, else fields the road module may carry on the edge. */
function dressingOf(edge: Edge, dressing: RoadDressing | undefined): EdgeDressing {
  const explicit = dressing?.[edge.id];
  if (explicit) return explicit;
  const carried = edge as Edge & EdgeDressing;
  return { barriers: carried.barriers, features: carried.features, tags: carried.tags };
}

function samplesOf(edge: Edge): number[] {
  const n = Math.max(1, Math.round(edge.length / STEP_M));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push((edge.length * i) / n);
  return out;
}

function sideHas(side: string | undefined, want: 'left' | 'right'): boolean {
  return side === undefined || side === 'both' || side === want;
}

/** Barrier spans for one side: explicit barriers, else bridge tags, else the elevation rule. */
function barriersFor(
  road: RoadNetwork,
  edge: Edge,
  dress: EdgeDressing,
  side: 'left' | 'right',
): BarrierSpan[] {
  if (dress.barriers) return dress.barriers.filter((b) => sideHas(b.side, side));
  const bridges = (dress.tags ?? []).filter((t) => t.tag === 'bridge' && sideHas(t.side, side));
  if (bridges.length) return bridges.map((t) => ({ s0: t.s0, s1: t.s1, side, kind: 'rail', heightM: 1 }));
  // No data: rail the stretches that stand clear of the water.
  const spans: BarrierSpan[] = [];
  let start = -1;
  const ss = samplesOf(edge);
  for (const s of ss) {
    const high = road.toWorld(edge.index, s, 0, 0).y >= ELEVATED_M;
    if (high && start < 0) start = s;
    if (!high && start >= 0) {
      spans.push({ s0: start, s1: s, side, kind: 'rail', heightM: 1 });
      start = -1;
    }
  }
  if (start >= 0) spans.push({ s0: start, s1: edge.length, side, kind: 'rail', heightM: 1 });
  return spans;
}

export function buildRoadScene(road: RoadNetwork, look: LookStyle, dressing?: RoadDressing): RoadScene {
  const acc: Partial<Record<MaterialKind, StripAccumulator>> = {};
  const strip = (kind: MaterialKind): StripAccumulator => (acc[kind] ??= new StripAccumulator());
  const w = (edge: number, s: number, d: number, h: number): Point3 => road.toWorld(edge, s, d, h);
  const postSpots: Point3[] = [];
  const railPostSpots: { p: Point3; h: number }[] = [];
  const pylonSpots: { p: Point3; h: number }[] = [];
  let railM = 0;
  let rampStripes = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const e of road.edges) {
    const dress = dressingOf(e, dressing);
    const ss = samplesOf(e);
    const outerL = e.dMin - VERGE_M;
    const outerR = e.dMax + VERGE_M;
    for (const kind of ['road', 'shortcut', 'shoulder', 'marking', 'markingCenter', 'deck'] as const) {
      strip(kind).breakStrip();
    }
    // Surfaces and solid edge lines, sample by sample, pausing where a span is absent.
    const surfaces: { kind: MaterialKind; span: (l: LaneSpans) => [number, number] | null; lift: number }[] =
      [
        { kind: 'road', span: (l) => l.drive, lift: 0 },
        { kind: 'shortcut', span: (l) => l.shortcut, lift: 0 },
        { kind: 'shoulder', span: (l) => [outerL, (l.drive ?? l.shortcut ?? [0, 0])[0]], lift: -0.02 },
        { kind: 'shoulder', span: (l) => [(l.drive ?? l.shortcut ?? [0, 0])[1], outerR], lift: -0.02 },
        {
          kind: 'marking',
          span: (l) => (l.drive ? [l.drive[0] + 0.1, l.drive[0] + 0.25] : null),
          lift: 0.03,
        },
        {
          kind: 'marking',
          span: (l) => (l.drive ? [l.drive[1] - 0.25, l.drive[1] - 0.1] : null),
          lift: 0.03,
        },
      ];
    for (const surf of surfaces) {
      const a = strip(surf.kind);
      a.breakStrip();
      for (const s of ss) {
        const span = surf.span(laneSpans(road.lanesAt(e.index, s)));
        if (!span || span[1] - span[0] < 0.01) {
          a.breakStrip();
          continue;
        }
        a.pair(w(e.index, s, span[0], surf.lift), w(e.index, s, span[1], surf.lift));
      }
      a.breakStrip();
    }
    // Deck fascia on bridges, an embankment down to the water elsewhere, on both sides.
    for (const [d, out] of [
      [outerL, -1],
      [outerR, 1],
    ] as const) {
      const deck = strip('deck');
      deck.breakStrip();
      for (const s of ss) {
        const top = w(e.index, s, d, -0.02);
        const bottom =
          top.y >= ELEVATED_M
            ? { x: top.x, y: top.y - 1, z: top.z }
            : { ...w(e.index, s, d + out * 2, 0), y: -0.4 };
        if (out < 0) deck.pair(bottom, top);
        else deck.pair(top, bottom);
      }
      deck.breakStrip();
    }
    // Centre and lane dashes: 3 m on, 9 m off; yellow between opposite directions.
    for (let s = 2; s + 3 < e.length; s += 12) {
      for (const div of laneSpans(road.lanesAt(e.index, s)).dividers) {
        strip(div.opposite ? 'markingCenter' : 'marking').quad(
          w(e.index, s, div.d - 0.08, 0.03),
          w(e.index, s, div.d + 0.08, 0.03),
          w(e.index, s + 3, div.d - 0.08, 0.03),
          w(e.index, s + 3, div.d + 0.08, 0.03),
        );
      }
    }
    // Delineator posts every 25 m on the verge: a sense of speed. Pylons under the deck every 24 m.
    for (let s = 0; s < e.length; s += 25) {
      if (road.toWorld(e.index, s, 0, 0).y >= ELEVATED_M) continue; // the rails do this job on bridges
      postSpots.push(w(e.index, s, outerL + 0.25, 0.55), w(e.index, s, outerR - 0.25, 0.55));
    }
    for (let s = 12; s < e.length; s += 24) {
      for (const d of [e.dMin + 0.8, e.dMax - 0.8]) {
        const p = w(e.index, s, d, 0);
        if (p.y >= ELEVATED_M) pylonSpots.push({ p: { x: p.x, y: -0.5, z: p.z }, h: p.y - 1 + 0.5 });
      }
    }
    // Rails (a band on posts) and walls, from the dressing or the elevation rule.
    for (const [side, d] of [
      ['left', outerL + 0.05],
      ['right', outerR - 0.05],
    ] as const) {
      for (const b of barriersFor(road, e, dress, side)) {
        const s0 = Math.max(0, b.s0);
        const s1 = Math.min(e.length, b.s1);
        if (s1 <= s0) continue;
        const h = b.heightM ?? 1;
        const bottom = b.kind === 'wall' ? 0 : h - 0.3;
        const rail = strip('rail');
        rail.breakStrip();
        for (let s = s0; ; s = Math.min(s1, s + STEP_M)) {
          rail.pair(w(e.index, s, d, h), w(e.index, s, d, bottom));
          if (s >= s1) break;
        }
        rail.breakStrip();
        railM += s1 - s0;
        if (b.kind !== 'wall') {
          for (let s = s0; s <= s1; s += 3) railPostSpots.push({ p: w(e.index, s, d, 0), h });
        }
      }
    }
    // The ramp: orange stripes over `ramp` features, or over steep shortcut stretches with no data.
    const ramps: FeatureSpan[] = (dress.features ?? []).filter((f) => f.kind === 'ramp');
    if (!ramps.length) {
      let start = -1;
      for (let i = 0; i < e.count; i++) {
        const s = Math.min(e.length, i * e.spacing);
        const steep = (e.grade[i] ?? 0) > 0.08 && laneSpans(road.lanesAt(e.index, s)).shortcut !== null;
        if (steep && start < 0) start = s;
        if ((!steep || i === e.count - 1) && start >= 0) {
          const span = laneSpans(road.lanesAt(e.index, start)).shortcut ?? [0, 0];
          ramps.push({ kind: 'ramp', s0: start, s1: s, d0: span[0], d1: span[1] });
          start = -1;
        }
      }
    }
    for (const r of ramps) {
      for (let s = r.s0; s + 0.5 <= r.s1; s += 1) {
        strip('rampMark').quad(
          w(e.index, s, r.d0, 0.04),
          w(e.index, s, r.d1, 0.04),
          w(e.index, s + 0.5, r.d0, 0.04),
          w(e.index, s + 0.5, r.d1, 0.04),
        );
        rampStripes++;
      }
    }
    for (let i = 0; i < e.count; i++) {
      minX = Math.min(minX, e.x[i] ?? 0);
      maxX = Math.max(maxX, e.x[i] ?? 0);
      minZ = Math.min(minZ, e.z[i] ?? 0);
      maxZ = Math.max(maxZ, e.z[i] ?? 0);
    }
  }

  const group = new Group();
  group.name = 'road';
  let triangles = 0;
  const doubleSided = new Set<MaterialKind>(['rail', 'deck']);
  for (const [kind, a] of Object.entries(acc) as [MaterialKind, StripAccumulator][]) {
    if (a.isEmpty) continue;
    triangles += a.triangleCount;
    const mesh = new Mesh(a.build(), look.material(kind, { doubleSided: doubleSided.has(kind) }));
    mesh.name = `road-${kind}`;
    group.add(mesh);
  }
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const addInstanced = (
    name: string,
    geo: BoxGeometry,
    kind: MaterialKind,
    spots: readonly { p: Point3; h: number }[],
  ) => {
    if (!spots.length) return;
    const mesh = new InstancedMesh(geo, look.material(kind), spots.length);
    spots.forEach(({ p, h }, i) =>
      mesh.setMatrixAt(i, m.compose(new Vector3(p.x, p.y, p.z), q, one.clone().setY(h))),
    );
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    triangles += ((geo.index?.count ?? 0) / 3) * spots.length;
    group.add(mesh);
  };
  addInstanced(
    'road-posts',
    new BoxGeometry(0.15, 1.1, 0.15),
    'post',
    postSpots.map((p) => ({ p, h: 1 })),
  );
  // Unit-height boxes standing on their base, stretched by the instance scale.
  addInstanced('road-rail-posts', new BoxGeometry(0.1, 1, 0.1).translate(0, 0.5, 0), 'rail', railPostSpots);
  addInstanced('road-pylons', new BoxGeometry(0.9, 1, 0.9).translate(0, 0.5, 0), 'deck', pylonSpots);

  // The sea, at world y = 0 (sea level in the network frame).
  const water = new Mesh(new PlaneGeometry(maxX - minX + 3000, maxZ - minZ + 3000), look.material('water'));
  water.rotation.x = -Math.PI / 2;
  water.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  water.name = 'road-water';
  group.add(water);
  triangles += 2;

  return {
    group,
    stats: { meshes: group.children.length, triangles, railM, rampStripes, pylons: pylonSpots.length },
    dispose() {
      group.traverse((o) => {
        if (o instanceof Mesh) (o.geometry as BoxGeometry).dispose();
      });
    },
  };
}
