import { describe, expect, it } from 'vitest';
import { InputFlag } from '../sim/api';
import { emptyActions, KeyboardState, toSimInput } from './index';

describe('input: keyboard and latching', () => {
  it('latches a tap shorter than one tick until the next sample, exactly once', () => {
    const kb = new KeyboardState();
    kb.down('KeyJ');
    kb.up('KeyJ'); // released before the tick samples it
    const first = emptyActions();
    kb.sample(first, 1 / 60);
    expect(toSimInput(first).flags & InputFlag.attack).toBe(InputFlag.attack);
    const second = emptyActions();
    kb.sample(second, 1 / 60);
    expect(toSimInput(second).flags & InputFlag.attack).toBe(0);
  });

  it('ramps the throttle up while held and quantizes it', () => {
    const kb = new KeyboardState();
    kb.down('ArrowUp');
    const a = emptyActions();
    kb.sample(a, 1 / 60);
    expect(a.throttle).toBeCloseTo(0.05, 6);
    for (let i = 0; i < 30; i++) kb.sample(emptyActions(), 1 / 60);
    const b = emptyActions();
    kb.sample(b, 1 / 60);
    expect(toSimInput(b).throttle).toBe(255);
    kb.up('ArrowUp');
    const c = emptyActions();
    kb.sample(c, 1 / 60);
    expect(c.throttle).toBe(0);
  });

  it('maps steering, brake, forced sides and kick', () => {
    const kb = new KeyboardState();
    for (const k of ['KeyA', 'KeyS', 'KeyU', 'KeyK']) kb.down(k);
    const a = emptyActions();
    kb.sample(a, 1 / 60);
    const input = toSimInput(a);
    expect(input.steer).toBe(-127);
    expect(input.brake).toBe(255);
    expect(input.flags & InputFlag.attackSideLeft).toBeTruthy();
    expect(input.flags & InputFlag.kick).toBeTruthy();
  });
});
