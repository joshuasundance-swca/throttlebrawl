// Playtest 1 (2026-09-30): "idk how to kick on the laptop". The pause screen shows a keyboard
// legend drawn from the key map; this checks the legend input/ hands to ui/.
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEY_MAP, KEY_ACTION_NAMES, keyLabel, keyLegend, type KeyAction } from './index';

describe('input: the keyboard legend for the pause screen', () => {
  it('names K kick, J punch, and U and O punch to a side', () => {
    const rows = keyLegend();
    const find = (action: string) => rows.find((r) => r.action === action)?.keys;
    expect(find('kick')).toBe('K');
    expect(find('punch')).toBe('J');
    expect(find('punch left')).toBe('U');
    expect(find('punch right')).toBe('O');
    expect(find('ride')).toBe('W / ↑');
    expect(find('brake')).toBe('S / ↓');
    expect(find('steer left')).toBe('A / ←');
    expect(find('steer right')).toBe('D / →');
    expect(find('look back')).toBe('L');
    expect(find('skip the run back')).toBe('Space');
  });

  it('lists every bound action in the key map, once', () => {
    const rows = keyLegend();
    const actions = Object.keys(DEFAULT_KEY_MAP) as KeyAction[];
    expect(rows).toHaveLength(actions.length);
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(actions.map((a) => KEY_ACTION_NAMES[a])));
  });

  it('follows a remap and leaves out an unbound action', () => {
    const rows = keyLegend({ ...DEFAULT_KEY_MAP, kick: ['KeyF', 'Digit2'], lookBack: [] });
    expect(rows.find((r) => r.action === 'kick')?.keys).toBe('F / 2');
    expect(rows.some((r) => r.action === 'look back')).toBe(false);
  });

  it('prints key codes as the key caps read', () => {
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('Backquote')).toBe('`');
    expect(keyLabel('ArrowRight')).toBe('→');
    expect(keyLabel('ShiftLeft')).toBe('ShiftLeft');
  });
});
