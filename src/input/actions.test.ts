// Playtest 3's input contract (K0a): the action state's `wheelie`, which the devices set while the
// wheelie button is held (playtest 4), reaches the sim as InputFlag.wheelie, and leaves the other bits alone.
import { describe, expect, it } from 'vitest';
import { InputFlag } from '../sim/api';
import { emptyActions, toSimInput } from './actions';

describe('toSimInput: the wheelie bit (playtest 3)', () => {
  it('sets InputFlag.wheelie while the action state holds wheelie', () => {
    const held = toSimInput({ ...emptyActions(), throttle: 0.6, wheelie: true });
    expect(held.flags).toBe(InputFlag.wheelie);
    expect(held.throttle).toBe(153);
  });

  it('leaves it clear when wheelie is false or absent, and keeps the other flags', () => {
    expect(toSimInput({ ...emptyActions(), wheelie: false }).flags).toBe(0);
    expect(toSimInput(emptyActions()).flags).toBe(0);
    const both = toSimInput({ ...emptyActions(), kick: true, wheelie: true });
    expect(both.flags).toBe(InputFlag.kick | InputFlag.wheelie);
  });
});
