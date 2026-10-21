/** Static sample coordinates, as consumed by the drawn-ground query. */
export interface SampleEdge {
  readonly index: number;
  readonly count: number;
  readonly x: ArrayLike<number>;
  readonly z: ArrayLike<number>;
}
interface Nearest {
  i: number;
  d2: number;
}
interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
type Node = Bounds & ({ samples: number[] } | { left: Node; right: Node });
type ForestRow = { edge: number; root: Node };
interface Forest {
  rows: ForestRow[];
  sorted: ForestRow[];
}
type Visitor = (edge: number, i: number, d2: number) => void;

function tree(edge: SampleEdge, samples: number[]): Node {
  const box: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const i of samples) {
    const x = edge.x[i] ?? 0,
      z = edge.z[i] ?? 0;
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minZ = Math.min(box.minZ, z);
    box.maxZ = Math.max(box.maxZ, z);
  }
  if (samples.length <= 8) return { ...box, samples };
  const alongX = box.maxX - box.minX >= box.maxZ - box.minZ;
  samples.sort(
    (a, b) => ((alongX ? edge.x[a] : edge.z[a]) ?? 0) - ((alongX ? edge.x[b] : edge.z[b]) ?? 0) || a - b,
  );
  const mid = Math.floor(samples.length / 2);
  return { ...box, left: tree(edge, samples.slice(0, mid)), right: tree(edge, samples.slice(mid)) };
}
function distance(box: Bounds, x: number, z: number): number {
  const dx = x < box.minX ? box.minX - x : x > box.maxX ? x - box.maxX : 0;
  const dz = z < box.minZ ? box.minZ - z : z > box.maxZ ? z - box.maxZ : 0;
  return dx * dx + dz * dz;
}
function search(node: Node, edge: SampleEdge, x: number, z: number, best: Nearest): void {
  if (distance(node, x, z) > best.d2) return;
  if ('samples' in node) {
    for (const i of node.samples) {
      const ox = x - (edge.x[i] ?? 0),
        oz = z - (edge.z[i] ?? 0);
      const d2 = ox * ox + oz * oz;
      if (best.i < 0 || d2 < best.d2 || (d2 === best.d2 && i < best.i)) {
        best.i = i;
        best.d2 = d2;
      }
    }
  } else {
    const leftFirst = distance(node.left, x, z) <= distance(node.right, x, z);
    search(leftFirst ? node.left : node.right, edge, x, z, best);
    search(leftFirst ? node.right : node.left, edge, x, z, best);
  }
}

/**
 * Exact nearest sample per edge from the original packed-key cell square. Only
 * candidate selection is accelerated: no projection, radius or height rule lives here.
 * As with the ground caches, road sample geometry is static for this handle's lifetime.
 */
export function nearbySamples(edges: readonly SampleEdge[], cellM: number, span: number) {
  const key = (cx: number, cz: number) => (cx + 0x8000) * 0x10000 + (cz + 0x8000);
  let cells: Map<number, number[]> | null = null;
  let finite = true;
  // Bounded performance cache; eviction cannot change the candidate square or result.
  const forests = new Map<string, Forest>();
  const build = () => {
    const grid = new Map<number, number[]>();
    for (const e of edges)
      for (let i = 0; i < e.count; i++) {
        const x = e.x[i] ?? 0,
          z = e.z[i] ?? 0;
        finite &&= Number.isFinite(x) && Number.isFinite(z);
        const k = key(Math.floor(x / cellM), Math.floor(z / cellM));
        const list = grid.get(k);
        if (list) list.push(e.index, i);
        else grid.set(k, [e.index, i]);
      }
    return grid;
  };
  const select = (x: number, z: number, visitor?: Visitor): Map<number, Nearest> | undefined => {
    cells ??= build();
    const cx = Math.floor(x / cellM),
      cz = Math.floor(z / cellM);
    let out = visitor ? undefined : new Map<number, Nearest>();
    // Preserve the old scan's order-dependent NaN behavior for direct synthetic inputs.
    if (!finite || !Number.isFinite(x) || !Number.isFinite(z)) {
      out ??= new Map<number, Nearest>();
      for (let a = -span; a <= span; a++)
        for (let b = -span; b <= span; b++) {
          const list = cells.get(key(cx + a, cz + b));
          if (!list) continue;
          for (let j = 0; j < list.length; j += 2) {
            const e = list[j] ?? -1,
              i = list[j + 1] ?? 0,
              ed = edges[e];
            if (!ed) continue;
            const ox = x - (ed.x[i] ?? 0),
              oz = z - (ed.z[i] ?? 0);
            const d2 = ox * ox + oz * oz,
              prev = out.get(e);
            if (!prev || d2 < prev.d2 || (d2 === prev.d2 && i < prev.i)) out.set(e, { i, d2 });
          }
        }
      if (visitor)
        for (const e of [...out.keys()].sort((a, b) => a - b)) {
          const near = out.get(e)!;
          visitor(e, near.i, near.d2);
        }
      return out;
    }
    const id = `${cx},${cz}`;
    let forest = forests.get(id);
    if (!forest) {
      const candidates = new Map<number, Set<number>>();
      for (let a = -span; a <= span; a++)
        for (let b = -span; b <= span; b++) {
          const list = cells.get(key(cx + a, cz + b));
          if (!list) continue;
          for (let j = 0; j < list.length; j += 2) {
            const e = list[j] ?? -1,
              i = list[j + 1] ?? 0;
            if (!edges[e]) continue;
            let samples = candidates.get(e);
            if (!samples) {
              samples = new Set();
              candidates.set(e, samples);
            }
            samples.add(i);
          }
        }
      const rows = [...candidates].map(([edge, samples]) => ({
        edge,
        root: tree(edges[edge]!, [...samples]),
      }));
      forest = { rows, sorted: [...rows].sort((a, b) => a.edge - b.edge) };
      if (forests.size >= 64) forests.delete(forests.keys().next().value!);
    } else forests.delete(id);
    forests.set(id, forest);
    // Per-call scratch is never exposed: nested visitor queries cannot change an outer result.
    const best = { i: -1, d2: Infinity };
    for (const { edge, root } of visitor ? forest.sorted : forest.rows) {
      best.i = -1;
      best.d2 = Infinity;
      search(root, edges[edge]!, x, z, best);
      if (best.i >= 0) {
        if (visitor) visitor(edge, best.i, best.d2);
        else out!.set(edge, { i: best.i, d2: best.d2 });
      }
    }
    return out;
  };
  const query = (x: number, z: number) => select(x, z)!;
  return Object.assign(query, {
    visit(x: number, z: number, visitor: Visitor) {
      select(x, z, visitor);
    },
  });
}
