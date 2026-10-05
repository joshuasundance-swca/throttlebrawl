// Control remapping (the maintainer, 2026-10-05: "can we customize keyboard settings and stuff? I want
// to be sure it's a joy to play and use all functions"): every action has a binding on the keyboard and
// on the pad, the saved record becomes the maps the devices read, conflicts are named, a slot's change
// keeps the record to what was changed, and the drift's brake sits under a thumb by default.
import { describe, expect, it } from 'vitest';
import {
  BIND_ROWS,
  bindingConflicts,
  bindingLabel,
  boundTokens,
  createInput,
  DEFAULT_KEY_MAP,
  DEFAULT_PAD_MAP,
  emptyActions,
  GamepadState,
  KeyboardState,
  keyMapFromBindings,
  padMapFromBindings,
  toSimInput,
  withBinding,
  type BindAction,
  type KeyAction,
  type PadButtonAction,
  type PadLike,
} from './index';

/** Every action a player can do on a keyboard or a pad, listed by hand from the brief. */
const EVERY_ACTION = [
  'steer',
  'steerLeft',
  'steerRight',
  'throttle',
  'brake',
  'uturn',
  'wheelie',
  'attack',
  'attackLeft',
  'attackRight',
  'kick',
  'kickStraight',
  'lookBack',
  'cycleCamera',
  'pause',
  'skipRunBack',
] as const satisfies readonly BindAction[];

describe('input: every action is reachable on the keyboard and the pad', () => {
  it('each action has a default binding on each device it has a row for, and a row on both', () => {
    const missing: string[] = [];
    for (const action of EVERY_ACTION) {
      const row = BIND_ROWS.find((r) => r.action === action);
      if (!row) {
        missing.push(`${action}: no settings row`);
        continue;
      }
      if (!row.gamepad) missing.push(`${action}: no pad row`);
      if (action !== 'steer' && !row.keyboard) missing.push(`${action}: no keyboard row`);
      if (row.keyboard && boundTokens('keyboard', {}, action).length === 0) missing.push(`${action}: no key`);
      if (row.gamepad && boundTokens('gamepad', {}, action).length === 0)
        missing.push(`${action}: no pad control`);
    }
    // Steering on the keyboard is the two steer keys; the stick row is the pad's.
    expect(DEFAULT_KEY_MAP.steerLeft.length).toBeGreaterThan(0);
    console.log(`[examined] ${EVERY_ACTION.length} actions x 2 devices, ${BIND_ROWS.length} settings rows`);
    expect(missing).toEqual([]);
  });

  it('the rows cover every key action and every pad action, and nothing else', () => {
    const rows = new Set(BIND_ROWS.map((r) => r.action));
    expect(rows).toEqual(new Set(EVERY_ACTION));
    for (const a of Object.keys(DEFAULT_KEY_MAP) as KeyAction[]) expect(rows.has(a), a).toBe(true);
    for (const a of Object.keys(DEFAULT_PAD_MAP.buttons) as PadButtonAction[])
      expect(rows.has(a), a).toBe(true);
  });

  it('the default keys and buttons clash only where it is meant (skip the run-back shares)', () => {
    expect([...bindingConflicts('keyboard', {}).entries()]).toEqual([]);
    expect([...bindingConflicts('gamepad', {}).entries()]).toEqual([]);
  });
});

describe('input: the drift-friendly keyboard defaults (2026-10-05)', () => {
  it('Space brakes as S and Down still do, and still skips the run-back', () => {
    expect(DEFAULT_KEY_MAP.brake).toEqual(['KeyS', 'ArrowDown', 'Space']);
    expect(DEFAULT_KEY_MAP.skipRunBack).toEqual(['Space']);
  });

  it('W, A and Space held at once: throttle, full left lock and the brake, the drift entry', () => {
    const kb = new KeyboardState();
    for (const code of ['KeyW', 'KeyA', 'Space']) kb.down(code);
    const a = emptyActions();
    for (let t = 0; t < 30; t++) {
      Object.assign(a, emptyActions());
      kb.sample(a, 1 / 60);
    }
    expect(a.throttle).toBe(1);
    expect(a.steer).toBe(-1);
    expect(a.brake).toBe(1);
  });

  it('every key a player learned before still does what it did', () => {
    const before: Record<string, string[]> = {
      throttle: ['KeyW', 'ArrowUp'],
      brake: ['KeyS', 'ArrowDown'],
      steerLeft: ['KeyA', 'ArrowLeft'],
      steerRight: ['KeyD', 'ArrowRight'],
      attack: ['KeyJ'],
      attackLeft: ['KeyU'],
      attackRight: ['KeyO'],
      kick: ['KeyK'],
      kickStraight: ['KeyI'],
      lookBack: ['KeyL'],
      skipRunBack: ['Space'],
      cycleCamera: ['KeyC'],
      wheelie: ['KeyH'],
    };
    for (const [action, codes] of Object.entries(before))
      for (const code of codes)
        expect(DEFAULT_KEY_MAP[action as KeyAction], `${action} ${code}`).toContain(code);
  });
});

describe('input: the saved record to the maps the devices read', () => {
  it('only listed actions change; unusable keys keep the default; Esc always pauses and nothing else', () => {
    const map = keyMapFromBindings({
      brake: ['ShiftLeft', 'KeyS'],
      kick: ['Backquote'], // the tuning panel's: unusable, so the default stays
      attack: ['Escape', 'KeyF'], // Esc is pause's
      pause: ['KeyP'],
    });
    expect(map.brake).toEqual(['ShiftLeft', 'KeyS']);
    expect(map.kick).toEqual(DEFAULT_KEY_MAP.kick);
    expect(map.attack).toEqual(['KeyF']);
    expect(map.pause).toEqual(['Escape', 'KeyP']);
    expect(map.throttle).toEqual(DEFAULT_KEY_MAP.throttle);
    expect(keyMapFromBindings({})).toEqual(DEFAULT_KEY_MAP);
  });

  it('a remapped key drives the action, and the old one stops, through createInput', () => {
    const listeners = new Map<string, (e: Event) => void>();
    const target = {
      addEventListener: (t: string, fn: (e: Event) => void) => listeners.set(t, fn),
      removeEventListener: () => undefined,
    };
    const surface = {
      ...target,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
    };
    const input = createInput({
      keys: target,
      surface,
      layout: { elements: [], mirror: false } as never,
      gamepads: () => [],
      vibrate: null,
      controls: { keyBindings: { attack: ['KeyF'] } },
    });
    const press = (code: string) => {
      listeners.get('keydown')?.({ code } as unknown as Event);
      const cmd = input.sample(1 / 60);
      listeners.get('keyup')?.({ code } as unknown as Event);
      input.sample(1 / 60);
      return cmd;
    };
    expect(press('KeyF').flags).not.toBe(0);
    expect(press('KeyJ').flags).toBe(0);
    // Back to the defaults (Reset): J punches again.
    input.setOptions({ keyBindings: {} });
    expect(press('KeyJ').flags).not.toBe(0);
    input.dispose();
  });

  it('a pad remap of the U-turn and pause buttons moves them', () => {
    const map = padMapFromBindings({ uturn: ['button4'], pause: ['button8'] });
    expect(map.buttons.uturn).toEqual([4]);
    expect(map.buttons.pause).toEqual([8]);
    const pad = (pressed: number): PadLike => ({
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: i === pressed,
        value: i === pressed ? 1 : 0,
      })),
    });
    const gp = new GamepadState(map);
    const a = emptyActions();
    gp.sample(a, [pad(8)], 0.2, 1 / 60);
    expect(a.pause).toBe(true);
    // A pause is presentation only: nothing reaches the sim.
    expect(toSimInput(a)).toEqual(toSimInput(emptyActions()));
  });
});

describe('input: one slot changed, conflicts, labels', () => {
  it('a slot replaced, added or cleared; back at the defaults leaves the record', () => {
    let b = withBinding('keyboard', {}, 'brake', 2, 'ShiftLeft');
    expect(b).toEqual({ brake: ['KeyS', 'ArrowDown', 'ShiftLeft'] });
    b = withBinding('keyboard', b, 'brake', 2, 'Space');
    expect(b).toEqual({});
    b = withBinding('keyboard', b, 'uturn', 1, 'KeyE');
    expect(b).toEqual({ uturn: ['KeyQ', 'KeyE'] });
    b = withBinding('keyboard', b, 'uturn', 0, null);
    expect(b).toEqual({ uturn: ['KeyE'] });
    // The last binding can't be cleared, so no action is ever left without a key.
    expect(withBinding('keyboard', b, 'uturn', 0, null)).toBe(b);
    // Esc on pause is fixed; another pause key can be added beside it.
    expect(withBinding('keyboard', {}, 'pause', 0, 'KeyP')).toEqual({});
    expect(withBinding('keyboard', {}, 'pause', 1, 'KeyP')).toEqual({ pause: ['Escape', 'KeyP'] });
    expect(withBinding('keyboard', {}, 'kick', 0, 'Escape')).toEqual({});
    // A slot holds one key: the same key twice is one binding.
    expect(withBinding('keyboard', {}, 'kick', 1, 'KeyK')).toEqual({});
  });

  it('pad slots take buttons, and the stick slot takes an axis', () => {
    expect(withBinding('gamepad', {}, 'kick', 0, 'button1')).toEqual({ kick: ['button1'] });
    expect(withBinding('gamepad', {}, 'kick', 0, 'axis1')).toEqual({});
    expect(withBinding('gamepad', {}, 'steer', 0, 'axis2')).toEqual({ steer: ['axis2'] });
    expect(padMapFromBindings({ steer: ['axis2'] }).steerAxis).toBe(2);
    expect(withBinding('gamepad', {}, 'steer', 0, 'button1')).toEqual({});
  });

  it('names a key or button that does two jobs, on both rows, and R as the radio', () => {
    const b = withBinding('keyboard', {}, 'kick', 0, 'KeyJ');
    const c = bindingConflicts('keyboard', b);
    expect(c.get('kick')).toEqual([{ token: 'KeyJ', others: ['Punch'] }]);
    expect(c.get('attack')).toEqual([{ token: 'KeyJ', others: ['Kick'] }]);
    expect(bindingConflicts('keyboard', { lookBack: ['KeyR'] }).get('lookBack')?.[0]?.others).toEqual([
      'radio station',
    ]);
    // Skipping the run-back shares with anything (it only counts on foot).
    expect(bindingConflicts('keyboard', { skipRunBack: ['KeyJ'] }).size).toBe(0);
    const pad = bindingConflicts('gamepad', { lookBack: ['button0'] });
    expect(pad.get('lookBack')?.[0]?.others).toEqual(['Punch']);
  });

  it('labels keys and buttons as players read them', () => {
    expect(bindingLabel('keyboard', 'Space')).toBe('Space');
    expect(bindingLabel('keyboard', 'ShiftLeft')).toBe('L Shift');
    expect(bindingLabel('keyboard', 'KeyQ')).toBe('Q');
    expect(bindingLabel('gamepad', 'button0')).toBe('Cross');
    expect(bindingLabel('gamepad', 'button13')).toBe('D-pad down');
    expect(bindingLabel('gamepad', 'button9')).toBe('Options');
    expect(bindingLabel('gamepad', 'button40')).toBe('Button 40');
    expect(bindingLabel('gamepad', 'axis0')).toBe('Left stick');
    expect(bindingLabel('gamepad', 'axis2')).toBe('Right stick');
  });
});
