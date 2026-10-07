// High riders in the sound (the maintainer, playing on the phone, 2026-10-06: "land on it and ride on it";
// "go over and across barriers, possibly resulting in a crash like falling in the water"; "consistent
// physics and gameplay is important here so players know what to expect"; high falls "(a)": a clean
// cut-away with no gag):
// - a LOW splash sounds as it always has; a HIGH drop does not splash (the rail's clang and the respawn's
//   blip still say it happened);
// - the road's own sounds (rain on the ground, a bridge's joints) go on while he rides a roof: that is
//   riding, though the snapshot's `grounded` is false (his height over the road is not 0), and it stops
//   for a flight, a tumble and a run on foot.
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent } from '../sim/api';
import { cueForEvent } from './cues';
import { rollingOn } from './rolling';

const ev = (type: SimEvent['type'], actor: number, data: SimEvent['data'] = {}): SimEvent => ({
  tick: 10,
  type,
  actor,
  data,
});

describe('the splash is heard for a low drop only', () => {
  it('a low drop into water, or a splash with no word of how far, sounds as ever', () => {
    expect(cueForEvent(ev('splash', 0, { over: true, past: 'water', dropM: 4, high: false }), 0)?.cue).toBe(
      'splash',
    );
    expect(cueForEvent(ev('splash', 0, { body: 'rider', penaltyTicks: 240 }), 0)?.cue).toBe('splash');
  });

  it('a high drop is silent', () => {
    expect(cueForEvent(ev('splash', 0, { over: true, past: 'water', dropM: 68, high: true }), 0)).toBeNull();
    expect(cueForEvent(ev('splash', 0, { over: true, past: 'drop', dropM: 70, high: true }), 0)).toBeNull();
  });

  it('control: the rail and the respawn of a high drop still sound', () => {
    const high = { over: true, past: 'water', dropM: 68, high: true };
    expect(cueForEvent(ev('railOver', 0, { body: 'rider', ...high }), 0)?.cue).toBe('railClang');
    expect(cueForEvent(ev('respawn', 0, { reason: 'splash', ...high }), 0)?.cue).toBe('respawn');
  });
});

describe('the road’s sounds go on while he rides what holds him up', () => {
  const at = (mode: EntitySnapshot['mode'], grounded: boolean) => ({ mode, grounded });

  it('riding the road, or a roof (up off the road: `grounded` false): rolling', () => {
    expect(rollingOn(at('Road', true))).toBe(true);
    expect(rollingOn(at('Road', false))).toBe(true);
  });

  it('control: in the air, tumbling and on foot are not rolling', () => {
    expect(rollingOn(at('Airborne', false))).toBe(false);
    expect(rollingOn(at('Tumble', false))).toBe(false);
    expect(rollingOn(at('OnFoot', true))).toBe(false);
  });
});
