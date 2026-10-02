import { describe, expect, it } from 'vitest';
import { InputFlag } from '../sim/api';
import { DEFAULT_KEY_MAP, emptyActions, KeyboardState, toSimInput } from './index';

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

  it('holding an attack key attacks once; the side and kick stay held while the key is down', () => {
    const kb = new KeyboardState();
    kb.down('KeyO');
    const ticks = Array.from({ length: 10 }, () => {
      const a = emptyActions();
      kb.sample(a, 1 / 60);
      return toSimInput(a);
    });
    expect(ticks.filter((t) => t.flags & InputFlag.attack)).toHaveLength(1);
    expect(ticks.every((t) => t.flags & InputFlag.attackSideRight)).toBe(true);
    kb.up('KeyO');
    const after = emptyActions();
    kb.sample(after, 1 / 60);
    expect(toSimInput(after).flags).toBe(0);
  });

  it('a key tapped between ticks still lands its side and kick flags', () => {
    const kb = new KeyboardState();
    kb.down('KeyK');
    kb.up('KeyK');
    const a = emptyActions();
    kb.sample(a, 1 / 60);
    const flags = toSimInput(a).flags;
    expect(flags & InputFlag.attack).toBeTruthy();
    expect(flags & InputFlag.kick).toBeTruthy();
  });

  // C was the reserved cruise key; since the integration round it cycles the camera view (a
  // presentation action, never a SimInput flag). The cruise action itself stays reserved.
  it('maps look back and skip run-back; C changes the view and sets no sim flag', () => {
    const kb = new KeyboardState();
    kb.down('KeyL');
    kb.down('Space');
    kb.down('KeyC');
    const a = emptyActions();
    kb.sample(a, 1 / 60);
    const input = toSimInput(a);
    expect(input.flags).toBe(InputFlag.lookBack | InputFlag.skipRunBack);
    expect(a.cycleCamera).toBe(true);
    expect(DEFAULT_KEY_MAP.cycleCamera).toEqual(['KeyC']);
  });

  it('playtest 2: K with U or O held kicks to that side, either order; I is the straight kick', () => {
    const sided = (first: string, second: string) => {
      const kb = new KeyboardState();
      kb.down(first);
      kb.sample(emptyActions(), 1 / 60);
      kb.down(second);
      const a = emptyActions();
      kb.sample(a, 1 / 60);
      return toSimInput(a).flags;
    };
    const both = InputFlag.attackSideLeft | InputFlag.attackSideRight;
    for (const f of [sided('KeyU', 'KeyK'), sided('KeyK', 'KeyU')]) {
      expect(f & InputFlag.kick).toBeTruthy();
      expect(f & both).toBe(InputFlag.attackSideLeft);
    }
    expect(sided('KeyK', 'KeyO') & both).toBe(InputFlag.attackSideRight);

    const kb = new KeyboardState();
    kb.down('KeyI');
    const a = emptyActions();
    kb.sample(a, 1 / 60);
    expect(toSimInput(a).flags).toBe(InputFlag.attack | InputFlag.kick | both);
    const held = emptyActions();
    kb.sample(held, 1 / 60);
    expect(toSimInput(held).flags).toBe(InputFlag.kick | both); // level-held, one press
    kb.up('KeyI');
    const after = emptyActions();
    kb.sample(after, 1 / 60);
    expect(toSimInput(after).flags).toBe(0);
  });

  it('keys are remappable', () => {
    const kb = new KeyboardState({ ...DEFAULT_KEY_MAP, attack: ['KeyF'] });
    kb.down('KeyJ');
    const a = emptyActions();
    kb.sample(a, 1 / 60);
    expect(a.attack).toBe(false);
    kb.down('KeyF');
    const b = emptyActions();
    kb.sample(b, 1 / 60);
    expect(b.attack).toBe(true);
  });
});
