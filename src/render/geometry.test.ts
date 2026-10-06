// Playtest 4 run B (mustFix 1): a strip drawn with only the samples its shape needs (geometry.ts
// keptSamples, ChunkedStrips' `simplify`) draws the same surface: every sample left out lies within the
// tolerance of the strip that is drawn, a bend, a crest and a change of colour keep their samples, and a
// straight even stretch is one quad. The negative control: a tolerance of 0 on a bend leaves nothing out.
import { describe, expect, it } from 'vitest';
import { ChunkedStrips, keptSamples, type Point3 } from './geometry';

const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });

/** A strip 3 m wide along a path, sampled every 2 m. */
function stripAlong(path: (u: number) => Point3, n: number): [Point3, Point3][] {
  const out: [Point3, Point3][] = [];
  for (let i = 0; i <= n; i++) {
    const c = path(i * 2);
    out.push([p(c.x - 1.5, c.y, c.z), p(c.x + 1.5, c.y, c.z)]);
  }
  return out;
}

/** The farthest any sample's points lie from the drawn strip (the kept samples' straight edges). */
function worstMiss(rows: readonly (readonly Point3[])[], kept: readonly number[]): number {
  let worst = 0;
  for (let k = 0; k + 1 < kept.length; k++) {
    const a = kept[k]!;
    const b = kept[k + 1]!;
    for (let m = a + 1; m < b; m++)
      for (let q = 0; q < rows[m]!.length; q++) {
        const [s0, s1, x] = [rows[a]![q]!, rows[b]![q]!, rows[m]![q]!];
        const t = Math.max(0, Math.min(1, (x.z - s0.z) / (s1.z - s0.z || 1)));
        worst = Math.max(
          worst,
          Math.hypot(
            x.x - (s0.x + (s1.x - s0.x) * t),
            x.y - (s0.y + (s1.y - s0.y) * t),
            x.z - (s0.z + (s1.z - s0.z) * t),
          ),
        );
      }
  }
  return worst;
}

describe('keptSamples', () => {
  it('draws a straight, even 100 m strip as one quad per 40 m span, ends kept', () => {
    const rows = stripAlong((u) => p(0, 0.02 * u, u), 50);
    const kept = keptSamples(rows, 0.01, 40);
    expect(kept[0]).toBe(0);
    expect(kept.at(-1)).toBe(50);
    expect(kept.length).toBe(4); // 0, 20 (40 m), 40 (80 m), 50
    expect(worstMiss(rows, kept)).toBeLessThan(1e-9);
  });

  it('keeps a crest and a bend within the tolerance, and leaves out most of the samples', () => {
    // A vertical curve and a bend, both of radius 300 m.
    const crest = (u: number) => p(0, -(u * u) / 600, u);
    const bend = (u: number) => p(300 - 300 * Math.cos(u / 300), 0, 300 * Math.sin(u / 300));
    for (const [name, path] of [
      ['crest', crest],
      ['bend', bend],
    ] as const) {
      const rows = stripAlong(path, 60);
      const kept = keptSamples(rows, 0.01, 40);
      const miss = worstMiss(rows, kept);
      expect(miss, name).toBeLessThanOrEqual(0.01 + 1e-9);
      expect(kept.length, name).toBeLessThan(rows.length);
      expect(kept.length, name).toBeGreaterThan(2);
    }
  });

  it('keeps every sample on a bend at a tolerance of 0 (the negative control)', () => {
    const rows = stripAlong((u) => p(60 - 60 * Math.cos(u / 60), 0, 60 * Math.sin(u / 60)), 30);
    expect(keptSamples(rows, 0, 40)).toEqual(rows.map((_, i) => i));
  });

  it('keeps the samples where the colour changes', () => {
    const rows = stripAlong((u) => p(0, 0, u), 20);
    const colour = (i: number) => (i < 7 ? 'a' : 'b');
    const kept = keptSamples(rows, 0.01, 40, (i, j) => colour(i) === colour(j));
    expect(kept).toContain(6);
    expect(kept).toContain(7);
    for (let k = 0; k + 1 < kept.length; k++)
      for (let m = kept[k]! + 1; m < kept[k + 1]!; m++) expect(colour(m)).toBe(colour(kept[k]!));
  });
});

describe('ChunkedStrips with simplify', () => {
  it('draws the same strip in fewer triangles, and the same as before without it', () => {
    const rows = stripAlong((u) => p(0, 0, u), 50);
    const plain = new ChunkedStrips(() => 'a');
    const thin = new ChunkedStrips(() => 'a', { tolM: 0.01, maxSpanM: 40 });
    for (const s of [plain, thin]) {
      for (const [a, b] of rows) s.pair(a, b);
      s.breakStrip();
    }
    expect(plain.triangleCount).toBe(100);
    expect(thin.triangleCount).toBe(6);
    // An open strip is drawn when the chunks are read, not dropped.
    const open = new ChunkedStrips(() => 'a', { tolM: 0.01, maxSpanM: 40 });
    for (const [a, b] of rows) open.pair(a, b);
    expect(open.triangleCount).toBe(6);
  });
});
