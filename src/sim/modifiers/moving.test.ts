// The moving set pieces' plain maths (run W-T, the pitch deck's #9, "weird events that move"):
// the serial signs' spacing, the skiff's slide, the logs' spread and roll, the hop over a log, the
// cable car's roll back, and which side of a lane-vote gantry a rider is under. Driven by sim steps
// (dt = 1/60), never wall time.
import { describe, expect, it } from 'vitest';
import {
  gantrySpan,
  hopVy,
  logTargetCd,
  MOVING,
  rollStep,
  serialLeads,
  slideStep,
  voteSide,
  type Slide,
} from './moving';

const DT = 1 / 60;

describe('serial signs', () => {
  it('spreads one joke over four signs, punchline last (nearest the event)', () => {
    const leads = serialLeads(4, 160, false);
    expect(leads).toHaveLength(4);
    // The first line is furthest ahead of the event; each next one is one gap closer.
    for (let i = 1; i < 4; i++) expect(leads[i - 1]! - leads[i]!).toBeCloseTo(MOVING.serialGapM);
    expect(leads[3]).toBe(160);
  });

  it('stands further out when the event keeps its own warning sign', () => {
    const leads = serialLeads(4, 160, true);
    expect(Math.min(...leads)).toBeGreaterThan(160);
    expect(serialLeads(0, 160, true)).toEqual([]);
  });
});

describe('the skiff off its trailer', () => {
  it('slides across the centre line, slews round and comes to rest within a few seconds', () => {
    // A forward lane 2 m right of the centre line (side +1), the skiff at the truck's 13 m/s.
    const s: Slide = { v: 13, cd: 2, yaw: 0 };
    let along = 0;
    let ticks = 0;
    while (s.v > 0 && ticks < 60 * 10) {
      slideStep(s, 2, 1, DT);
      along += s.v * DT;
      ticks++;
    }
    expect(ticks / 60).toBeLessThan(4);
    expect(along).toBeGreaterThan(10);
    expect(along).toBeLessThan(25);
    // It ends on the far side of the centre line, turned well off the road's line.
    expect(s.cd).toBeLessThan(0);
    expect(Math.abs(s.yaw)).toBeGreaterThan(0.5);
    const rest = { ...s };
    slideStep(s, 2, 1, DT);
    expect(s).toEqual(rest);
  });

  it('mirrors on a road whose forward lanes are left of the centre line', () => {
    const s: Slide = { v: 13, cd: -2, yaw: 0 };
    for (let i = 0; i < 600; i++) slideStep(s, -2, -1, DT);
    expect(s.cd).toBeGreaterThan(0);
  });
});

describe('the log spill', () => {
  it('lays the logs across both lanes, alternating sides', () => {
    const cds = Array.from({ length: 6 }, (_, k) => logTargetCd(k, 2, 1));
    expect(cds.some((cd) => cd > 0.5)).toBe(true);
    expect(cds.some((cd) => cd < -0.5)).toBe(true);
    for (const cd of cds) expect(Math.abs(cd)).toBeLessThanOrEqual(2.5);
  });

  it('a hop over a log grows with speed, within bounds', () => {
    expect(hopVy(0)).toBe(MOVING.hopVyMin);
    expect(hopVy(40)).toBeGreaterThan(hopVy(20));
    expect(hopVy(200)).toBe(MOVING.hopVyMax);
  });
});

describe('the runaway cable car', () => {
  it('stops climbing, rolls back faster and faster, and tops out', () => {
    let v = 4.5;
    const seen: number[] = [];
    for (let i = 0; i < 60 * 12; i++) {
      v = rollStep(v, DT);
      seen.push(v);
    }
    expect(seen[30]!).toBeLessThan(4.5);
    expect(Math.min(...seen)).toBeCloseTo(-MOVING.rollMaxMps, 6);
    // Monotone: it never rolls forward again on its own.
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]!);
  });
});

describe('the lane vote', () => {
  it('on a two-lane road the gantry spans both lanes, split at the centre line', () => {
    const g = gantrySpan([{ cd: 2, width: 4 }], 1);
    expect(g.splitCd).toBe(0);
    expect(g.spanM).toBe(8);
    expect(voteSide(2, g.splitCd, 1)).toBe('right');
    expect(voteSide(-1.5, g.splitCd, 1)).toBe('left');
  });

  it('on a wider carriageway it spans the forward lanes only, split between them', () => {
    const g = gantrySpan(
      [
        { cd: -2, width: 4 },
        { cd: -6, width: 4 },
      ],
      -1,
    );
    expect(g.splitCd).toBe(-4);
    expect(g.spanM).toBe(8);
    // Forward lanes on the left of the centre line: the outer lane (cd -6) is the rider's right.
    expect(voteSide(-6, g.splitCd, -1)).toBe('right');
    expect(voteSide(-2, g.splitCd, -1)).toBe('left');
  });
});
