import { describe, expect, it } from 'vitest';
import { createReplayControls, replayKeyAction } from './replay-controls';

const pad = (index: number, ...pressed: number[]) => ({
  index,
  connected: true,
  buttons: Array.from({ length: 4 }, (_, i) => ({ pressed: pressed.includes(i) })),
});
describe('replay-local controls', () => {
  it('maps explicit viewer keys without accepting held repeats or race controls', () => {
    expect(replayKeyAction('Space', false)).toBe('toggle');
    expect(replayKeyAction('Enter', false)).toBe('toggle');
    expect(replayKeyAction('KeyR', false)).toBe('restart');
    expect(replayKeyAction('KeyC', false)).toBe('camera');
    expect(replayKeyAction('Escape', false)).toBe('return');
    for (const code of ['Space', 'Enter', 'KeyR', 'KeyC', 'Escape'])
      expect(replayKeyAction(code, true)).toBeNull();
    for (const code of ['ArrowUp', 'KeyW', 'KeyM', 'Backquote'])
      expect(replayKeyAction(code, false)).toBeNull();
  });
  it('quarantines held and newly connected pads until release, including sparse indexes', () => {
    const controls = createReplayControls([null, pad(4, 0)]);
    expect(controls.poll([null, pad(4, 0)])).toEqual([]);
    expect(controls.poll([pad(7, 1), pad(4)])).toEqual([]);
    expect(controls.poll([pad(7), pad(4, 0)])).toEqual(['toggle']);
    expect(controls.poll([pad(7, 1), pad(4, 0)])).toEqual(['return']);
    expect(controls.poll([pad(7, 1), pad(4, 0)])).toEqual([]);
    expect(controls.poll([])).toEqual([]);
    expect(controls.poll([pad(4, 0)])).toEqual([]);
    expect(controls.poll([pad(4)])).toEqual([]);
    expect(controls.poll([pad(4, 2, 3)])).toEqual(['restart', 'camera']);
  });
});
