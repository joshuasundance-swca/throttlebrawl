import { describe, expect, it } from 'vitest';
import { topAt } from '../road';
import { fitRoof } from './roof-fit';
import { boxAt, planOfBoxes } from './roof-fit.test-util';

// What a flat mark lies on, on a roof (roof-fit.ts): the roof under a caster, the plane of its top under an
// oval, and the oval drawn smaller at an eave so no part of it floats in the air. Each rule has its control.

// A flat roof (4 m) and a pitched one (eave 4 m, ridge 7 m, the ridge along the box's u axis, so the roof falls
// away along z), x 2..18 and z -110..-90 each, 40 m apart; and a deck (underside 4.5 m) over the road.
const FLAT = boxAt('flat', 10, -100, 0, 8, 10, { kind: 'flat', topM: 4 });
const PITCHED = boxAt('pitched', 50, -100, 0, 8, 10, { kind: 'pitched', eaveM: 4, ridgeM: 7, ridge: 'u' });
const DECK = boxAt('deck', 90, -100, 0, 8, 10, { kind: 'flat', topM: 1 }, 4.5);
const plan = planOfBoxes([FLAT, PITCHED, DECK]);
const LENGTH = 2.3;
const WIDTH = 1.1;

describe('the roof under a caster', () => {
  it('a flat roof: its top, a level plane, the whole oval', () => {
    const fit = fitRoof(plan, 10, 4, -100, 0, LENGTH, WIDTH);
    expect(fit).not.toBeNull();
    expect(fit?.y).toBeCloseTo(4, 9);
    expect(fit?.ny).toBeCloseTo(1, 9);
    expect(fit?.nx).toBeCloseTo(0, 9);
    expect(fit?.nz).toBeCloseTo(0, 9);
    expect(fit?.scale).toBe(1);
  });

  it('a pitched roof: the plane follows the slope the rider rides, either way he faces', () => {
    // 4 m from the ridge along z: the roof there is 7 - 3 * 0.4 = 5.8 m, falling 0.3 m per metre toward -z.
    const toward = fitRoof(plan, 50, 5.8, -104, 0, LENGTH, WIDTH);
    expect(toward?.y).toBeCloseTo(5.8, 6);
    // Rise per metre forward: heading 0 faces -z, so forward is downhill here.
    const rise = (f: NonNullable<typeof toward>, fx: number, fz: number) => -(f.nx * fx + f.nz * fz) / f.ny;
    expect(rise(toward as NonNullable<typeof toward>, 0, -1)).toBeCloseTo(-0.3, 6);
    // Facing the other way (heading pi: forward is +z, uphill) the same roof is a climb of 0.3.
    const back = fitRoof(plan, 50, 5.8, -104, Math.PI, LENGTH, WIDTH);
    expect(rise(back as NonNullable<typeof back>, 0, 1)).toBeCloseTo(0.3, 6);
    // And it is the roof's own top: a step of the plane along the heading agrees with road/structures.ts topAt.
    const st = plan.items[1];
    expect(st).toBeDefined();
    if (!st) return;
    const a = topAt(st, 50, -104) ?? NaN;
    const b = topAt(st, 50, -105) ?? NaN;
    expect(b - a).toBeCloseTo(-0.3, 6);
    // Across a ridge-line heading (along x) the roof is level: no tilt along it.
    const along = fitRoof(plan, 50, 5.8, -104, Math.PI / 2, LENGTH, WIDTH);
    expect(rise(along as NonNullable<typeof along>, -1, 0)).toBeCloseTo(0, 6);
  });

  it('control: the road beside a building, and the road under a deck, have no roof', () => {
    expect(fitRoof(plan, 25, 0, -100, 0, LENGTH, WIDTH)).toBeNull();
    expect(fitRoof(plan, 90, 0, -100, 0, LENGTH, WIDTH)).toBeNull();
    // A rider a kerb over the roof still stands on it; one 2 m over it (a jump) does not "stand" but is over it:
    // the caller passes the height of what throws the shadow, so a flier is asked at his floor.
    expect(fitRoof(plan, 10, 4.2, -100, 0, LENGTH, WIDTH)?.y).toBeCloseTo(4, 9);
    expect(fitRoof(plan, 10, 3.5, -100, 0, LENGTH, WIDTH)).toBeNull();
  });

  it('a top too small to hold a bike (a post, a bike rack) is no roof, a roof of the same height is', () => {
    const small = planOfBoxes([boxAt('post', 10, -100, 0, 0.4, 0.4, { kind: 'flat', topM: 1.5 })]);
    expect(fitRoof(small, 10, 1.5, -100, 0, LENGTH, WIDTH)).toBeNull();
    const bike = planOfBoxes([boxAt('rack', 10, -100, 0, 0.7, 0.3, { kind: 'flat', topM: 1.5 })]);
    expect(fitRoof(bike, 10, 1.5, -100, 0, LENGTH, WIDTH)).toBeNull();
    const roof = planOfBoxes([boxAt('shed', 10, -100, 0, 3, 3, { kind: 'flat', topM: 1.5 })]);
    expect(fitRoof(roof, 10, 1.5, -100, 0, LENGTH, WIDTH)?.y).toBeCloseTo(1.5, 9);
  });

  it('chooses the highest top under him: a deck over the road, then the roof on it', () => {
    const two = planOfBoxes([
      boxAt('low', 10, -100, 0, 8, 10, { kind: 'flat', topM: 4 }),
      boxAt('over', 10, -100, 0, 3, 3, { kind: 'flat', topM: 1 }, 4),
    ]);
    expect(fitRoof(two, 10, 5.1, -100, 0, LENGTH, WIDTH)?.y).toBeCloseTo(5, 9);
    expect(fitRoof(two, 10, 4.1, -100, 0, LENGTH, WIDTH)?.y).toBeCloseTo(4, 9);
  });
});

describe('an oval at the eave', () => {
  it('is drawn smaller until all of it is on the roof', () => {
    // The roof ends at z -110: 0.9 m from the edge a 2.3 m oval's front (1.15 m) hangs over; 70 % of it (0.8 m) fits.
    const near = fitRoof(plan, 10, 4, -109.1, 0, LENGTH, WIDTH);
    expect(near?.scale).toBe(0.7);
    const hl = (LENGTH * (near?.scale ?? 1)) / 2;
    expect(-109.1 - hl).toBeGreaterThan(-110);
    // Control: well inside it is the whole oval.
    expect(fitRoof(plan, 10, 4, -104, 0, LENGTH, WIDTH)?.scale).toBe(1);
  });

  it('a rider on the very edge gets a small flat oval at the roof’s top, never none and never in the air', () => {
    const edge = fitRoof(plan, 10, 4, -109.9, 0, LENGTH, WIDTH);
    expect(edge?.scale).toBe(0.45);
    expect(edge?.y).toBeCloseTo(4, 9);
    expect(edge?.ny).toBe(1);
  });
});
