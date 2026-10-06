// The Golden Gate's code-made anchorage (playtest 4, P4-19, G4). Rules on the soup itself, in the cable
// entry's frame; the real bridge's anchorages on its real road are in landmarks-sf.test.ts.
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { ANCHORAGE, anchorageSoup, anchorageTopM } from './gg-anchorage';

const ENTRY = 6;
const SADDLE_X = 17.5;
/** The kit's old housings per side (tools/blender/props/golden_gate_kit.py): length x width x height of each step. */
const OLD_STEPS = [
  { len: 38, wid: 6.5, from: -0.3, to: 3 },
  { len: 23, wid: 5.6, from: 3, to: 6.5 },
  { len: 11, wid: 4.6, from: 6.5, to: 8 },
] as const;
const oldVolumeOverDeck =
  2 * OLD_STEPS.reduce((sum, s) => sum + s.len * s.wid * (s.to - Math.max(0, s.from)), 0);

interface V {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
}
function verts(paint: string): V[] {
  const soup = anchorageSoup(SADDLE_X, ENTRY, paint);
  const out: V[] = [];
  for (let i = 0; i < soup.pos.length; i += 3) {
    out.push({
      x: soup.pos[i] ?? 0,
      y: soup.pos[i + 1] ?? 0,
      z: soup.pos[i + 2] ?? 0,
      r: soup.col[i] ?? 0,
      g: soup.col[i + 1] ?? 0,
      b: soup.col[i + 2] ?? 0,
    });
  }
  return out;
}

describe('the anchorage soup', () => {
  const v = verts('#c0452f');

  it('is two housings, one under each cable, with a few dozen triangles each', () => {
    expect(v.length % 3).toBe(0);
    const tris = v.length / 3;
    expect(tris).toBeLessThanOrEqual(2 * 6 * 12);
    expect(v.filter((p) => p.x < 0).length).toBe(v.filter((p) => p.x > 0).length);
    expect(Math.min(...v.map((p) => p.x))).toBeGreaterThan(-(SADDLE_X + ANCHORAGE.halfWidthM[0] + 0.01));
  });

  it('stays clear of the road, behind the entry, and under the cable it carries', () => {
    const over = v.filter((p) => p.y > 0.3);
    expect(Math.min(...over.map((p) => Math.abs(p.x)))).toBeGreaterThanOrEqual(14.5);
    // Nothing stands out on the span; the collar's face is the front (0.7 m past the entry).
    expect(Math.max(...v.map((p) => p.z))).toBeLessThanOrEqual(0.71);
    expect(Math.min(...v.map((p) => p.z))).toBeGreaterThanOrEqual(-ANCHORAGE.lengthM[0] - 0.01);
    // The housing's highest top is under the cable (its centre is `capUnderM` over it), the collar round it.
    const topsOfBody = Math.max(...over.filter((p) => p.z < -0.3).map((p) => p.y));
    expect(topsOfBody).toBeCloseTo(anchorageTopM(ENTRY), 5);
    expect(Math.max(...over.map((p) => p.y))).toBeLessThanOrEqual(ENTRY + 0.7);
  });

  it("holds under a quarter of the old blocks' volume over the deck, the control being the kit's own numbers", () => {
    // The soup's volume over the deck: each step's box above y 0 (the foot is under it).
    const A = ANCHORAGE;
    const tops = [...A.topM, anchorageTopM(ENTRY)];
    const volume =
      2 *
      tops.reduce((sum, top, k) => {
        const low = k === 0 ? 0 : (tops[k - 1] as number);
        return sum + (A.lengthM[k] as number) * 2 * (A.halfWidthM[k] as number) * (top - low);
      }, 0);
    expect(volume).toBeLessThan(oldVolumeOverDeck * 0.35);
    // The control: the same sum over the old blocks' figures is far over the bar, so the bar can fail.
    expect(oldVolumeOverDeck).toBeGreaterThan(2000);
  });

  it("takes the bridge's paint, whatever the region says, above the plinth", () => {
    const green = new Color('#00ff00');
    const upper = verts('#00ff00').filter((p) => p.y > 1.2);
    expect(upper.length).toBeGreaterThan(0);
    // The body is the paint itself; only the collar is a shade of it.
    const exact = upper.filter((p) => p.r === 0 && Math.abs(p.g - green.g) < 1e-6 && p.b === 0);
    expect(exact.length / upper.length).toBeGreaterThan(0.7);
    for (const p of upper) expect(p.r).toBe(0);
  });

  it('winds every triangle outward (a flat-shaded solid shows its front faces)', () => {
    const soup = anchorageSoup(SADDLE_X, ENTRY, '#c0452f');
    for (let i = 0; i < soup.pos.length; i += 9) {
      const a = [soup.pos[i] ?? 0, soup.pos[i + 1] ?? 0, soup.pos[i + 2] ?? 0];
      const b = [soup.pos[i + 3] ?? 0, soup.pos[i + 4] ?? 0, soup.pos[i + 5] ?? 0];
      const c = [soup.pos[i + 6] ?? 0, soup.pos[i + 7] ?? 0, soup.pos[i + 8] ?? 0];
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const w = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      const given = [soup.nrm[i] ?? 0, soup.nrm[i + 1] ?? 0, soup.nrm[i + 2] ?? 0];
      expect(n[0]! * given[0]! + n[1]! * given[1]! + n[2]! * given[2]!).toBeGreaterThan(0);
    }
  });
});
