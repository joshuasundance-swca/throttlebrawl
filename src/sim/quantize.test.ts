import { describe, expect, it } from 'vitest';
import { InputFlag, quantizeInput } from './api';

// SimInput must be canonical integers: a recording is replayed from JSON (the debug file), and
// JSON has no -0, so a -0 in the live race and a 0 in the replay hash differently (replay-1 found
// this: a steer of about -0.003 rounded to -0 and the file replay desynced at the next checkpoint).
describe('quantizeInput', () => {
  it('never returns -0, so a recording survives JSON', () => {
    for (const steer of [-0.003, -0, -1e-9]) {
      const q = quantizeInput({ steer, throttle: -0.001, brake: -0, flags: 0 });
      for (const v of Object.values(q)) expect(Object.is(v, -0), `steer ${steer}`).toBe(false);
      expect(JSON.parse(JSON.stringify(q))).toEqual(q);
    }
  });

  it('turns a NaN axis into 0 instead of feeding NaN to the sim', () => {
    expect(quantizeInput({ steer: NaN, throttle: NaN, brake: NaN, flags: 0 })).toEqual({
      steer: 0,
      throttle: 0,
      brake: 0,
      flags: 0,
    });
  });

  it('keeps the ranges: steer -127..127, throttle and brake 0..255', () => {
    expect(quantizeInput({ steer: -2, throttle: 2, brake: 0.5, flags: 0x1ffff })).toEqual({
      steer: -127,
      throttle: 255,
      brake: 128,
      flags: 0xffff,
    });
  });

  it('keeps 16 flag bits, so the wheelie bit (256, playtest 3) reaches the sim', () => {
    expect(InputFlag.wheelie).toBe(256);
    expect(quantizeInput({ steer: 0, throttle: 0, brake: 0, flags: 0x1ff }).flags).toBe(0x1ff);
    expect(quantizeInput({ steer: 0, throttle: 0, brake: 0, flags: InputFlag.wheelie }).flags).toBe(256);
  });
});
