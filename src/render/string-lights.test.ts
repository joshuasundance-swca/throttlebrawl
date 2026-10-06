// The string-of-lights helper both Chinatown's lantern strings and Duval's party strings hang from
// (playtest 4, P4-19). Rules, not lists: a string sags the same everywhere, its lights keep their pitch and
// their distance from the ends, and Chinatown's lanterns come out where its own loop put them.
import { describe, expect, it } from 'vitest';
import { hangPoints, lowestPoint, sagAt, stringPoint, stringPoints } from './string-lights';

const at = (x: number, y: number, z: number) => ({ x, y, z });

describe('a hung string', () => {
  it('is level at its ends, lowest in the middle by the sag, and a parabola between', () => {
    const a = at(0, 6, 0);
    const b = at(10, 6, 0);
    expect(sagAt(0, 1)).toBe(0);
    expect(sagAt(1, 1)).toBe(0);
    expect(sagAt(0.5, 1)).toBe(1);
    expect(stringPoint(a, b, 0.5, 1)).toEqual(at(5, 5, 0));
    // The control: a quarter along drops three quarters of the sag.
    expect(stringPoint(a, b, 0.25, 1).y).toBeCloseTo(6 - 0.75, 9);
    const pts = stringPoints(a, b, 1, 10);
    expect(pts).toHaveLength(11);
    expect(pts[0]).toEqual(a);
    expect(pts[10]).toEqual(b);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(5, 9);
  });

  it('follows a grade: the ends differ in height and the sag hangs under the chord', () => {
    const a = at(0, 4, 0);
    const b = at(0, 8, 12);
    expect(stringPoint(a, b, 0.5, 0.6).y).toBeCloseTo(6 - 0.6, 9);
    expect(lowestPoint(a, b, 0.6)).toBe(4);
    expect(lowestPoint(at(0, 6, 0), at(10, 6, 0), 1)).toBe(5);
  });
});

describe('the lights on a string', () => {
  it('keep their pitch along the chord and their distance from each end', () => {
    const a = at(0, 6.6, 0);
    const b = at(15.4, 6.6, 0);
    const pts = hangPoints(a, b, { sagM: 0.9, pitchM: 1.7, endM: 1.2 });
    expect(pts[0]?.x).toBeCloseTo(1.2, 9);
    for (let i = 1; i < pts.length; i++) expect((pts[i]?.x ?? 0) - (pts[i - 1]?.x ?? 0)).toBeCloseTo(1.7, 9);
    expect(15.4 - (pts[pts.length - 1]?.x ?? 0)).toBeGreaterThanOrEqual(1.2 - 1e-6);
    // Each hangs on the cord, dropped by its own offset.
    const dropped = hangPoints(a, b, { sagM: 0.9, pitchM: 1.7, endM: 1.2, dropM: 0.05 });
    expect(dropped).toHaveLength(pts.length);
    dropped.forEach((p, i) => expect(p.y).toBeCloseTo((pts[i]?.y ?? 0) - 0.05, 9));
  });

  it("come out as Chinatown's lantern loop put them (every 1.7 m from 1.2 m in, to 1.2 m short), for any span", () => {
    for (const span of [14.3, 16.8, 18, 21.37, 23.9, 27.04]) {
      const old: number[] = [];
      for (let dd = 1.2; dd < span - 1.2; dd += 1.7) old.push(dd);
      const pts = hangPoints(at(0, 6.6, 0), at(0, 6.6, span), {
        sagM: 0.9,
        pitchM: 1.7,
        endM: 1.2,
        dropM: 0.05,
      });
      expect(pts.map((p) => p.z)).toHaveLength(old.length);
      pts.forEach((p, i) => {
        const u = (old[i] ?? 0) / span;
        expect(p.z).toBeCloseTo(old[i] ?? 0, 9);
        expect(p.y).toBeCloseTo(6.6 - 4 * 0.9 * u * (1 - u) - 0.05, 9);
      });
    }
    // A string of no length hangs nothing.
    expect(hangPoints(at(1, 5, 1), at(1, 5, 1), { sagM: 1, pitchM: 1, endM: 0.5 })).toEqual([]);
  });
});
