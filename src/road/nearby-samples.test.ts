import { expect, it } from 'vitest';
import { nearbySamples, type SampleEdge } from './nearby-samples';

// The previous ground query's exhaustive grid scan is the numerical oracle. Keep
// its packed keys, candidate square, arithmetic and smaller-index tie rule.
function reference(edges: readonly SampleEdge[], x: number, z: number) {
  const key = (cx: number, cz: number) => (cx + 0x8000) * 0x10000 + (cz + 0x8000);
  const cells = new Map<number, number[]>();
  for (const e of edges)
    for (let i = 0; i < e.count; i++) {
      const k = key(Math.floor((e.x[i] ?? 0) / 64), Math.floor((e.z[i] ?? 0) / 64));
      const list = cells.get(k);
      if (list) list.push(e.index, i);
      else cells.set(k, [e.index, i]);
    }
  const out = new Map<number, { i: number; d2: number }>();
  for (let a = -5; a <= 5; a++)
    for (let b = -5; b <= 5; b++) {
      const list = cells.get(key(Math.floor(x / 64) + a, Math.floor(z / 64) + b));
      if (!list) continue;
      for (let j = 0; j < list.length; j += 2) {
        const e = list[j]!,
          i = list[j + 1]!,
          ed = edges[e];
        if (!ed) continue;
        const ox = x - (ed.x[i] ?? 0),
          oz = z - (ed.z[i] ?? 0);
        const d2 = ox * ox + oz * oz,
          prev = out.get(e);
        if (!prev || d2 < prev.d2 || (d2 === prev.d2 && i < prev.i)) out.set(e, { i, d2 });
      }
    }
  return [...out].sort(([a], [b]) => a - b);
}
function edge(index: number, points: readonly (readonly [number, number])[]): SampleEdge {
  return { index, count: points.length, x: points.map((p) => p[0]), z: points.map((p) => p[1]) };
}
function check(edges: readonly SampleEdge[], points: readonly (readonly [number, number])[]) {
  const query = nearbySamples(edges, 64, 5);
  for (const [x, z] of [...points, ...[...points].reverse(), ...points])
    expect([...query(x, z)].sort(([a], [b]) => a - b)).toEqual(reference(edges, x, z));
}

it('matches exhaustive nearest samples across curves, overlapping edges, cells and exact ties', () => {
  const edges = [
    edge(
      0,
      Array.from({ length: 600 }, (_, i): [number, number] => [
        Math.fround((i % 33) * 7 - 110),
        Math.fround(i * 2 - 600),
      ]),
    ),
    edge(
      1,
      Array.from({ length: 420 }, (_, i): [number, number] => [
        Math.fround(i * 3 - 500),
        Math.fround((i % 19) * 5 - 70),
      ]),
    ),
    edge(2, [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [64, 64],
      [64, 64],
      ...Array.from({ length: 30 }, (_, i): [number, number] => [i % 2 ? 100 + i : -100 - i, 0]),
    ]),
    edge(3, []),
  ];
  const points: [number, number][] = [
    [0, 0],
    [64, 64],
    [-64, -64],
    [64 - 1e-12, 64 + 1e-12],
    [10000, 10000],
  ];
  for (let i = 0; i < 250; i++) points.push([((i * 71) % 1601) - 800, ((i * 113) % 1801) - 900]);
  check(edges, points);
  expect(nearbySamples(edges, 64, 5)(0, 0).get(2)?.i).toBe(0);
});

it('preserves packed-key aliases and large finite-coordinate behavior without clipping candidates', () => {
  // (cx+1, cz-65536) has the same packed key; it remains a candidate even far away.
  const edges = [
    edge(0, [
      [64, -65536 * 64],
      [0, 0],
    ]),
    edge(1, [[64, -65536 * 64]]),
    edge(2, [[1e305, 1e305]]),
  ];
  check(edges, [
    [0, 0],
    [64, -65536 * 64],
    [1e305, 1e305],
    [-1e305, -1e305],
  ]);
  expect(nearbySamples(edges, 64, 5)(0, 0).has(1)).toBe(true);
});

it('retains exhaustive nonfinite fallback semantics and empty-network results', () => {
  check(
    [],
    [
      [0, 0],
      [NaN, NaN],
    ],
  );
  check(
    [
      edge(0, [
        [NaN, NaN],
        [Infinity, 0],
        [-Infinity, 0],
        [0, 0],
      ]),
    ],
    [
      [NaN, NaN],
      [Infinity, 0],
      [-Infinity, 0],
      [0, 0],
    ],
  );
});

it('reduces coordinate work for nearby moving queries without changing their nearest sample', () => {
  const points = Array.from({ length: 4096 }, (_, i): [number, number] => [
    (i % 64) * 4,
    Math.floor(i / 64) * 4,
  ]);
  const raw = edge(0, points);
  let reads = 0;
  const counted = (values: ArrayLike<number>) =>
    new Proxy(values, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
  const edges = [{ ...raw, x: counted(raw.x), z: counted(raw.z) }];
  const query = nearbySamples(edges, 64, 5);
  query(2, 4); // Build the static candidates, then move to another exact point in this cell.
  reads = 0;
  const answer = [...query(2.25, 4.5)];
  const indexedReads = reads;
  reads = 0;
  expect(answer).toEqual(reference(edges, 2.25, 4.5));
  expect(reads).toBeGreaterThanOrEqual(points.length * 2); // Exhaustive observer control.
  expect(indexedReads).toBeLessThan(points.length * 2);
});
