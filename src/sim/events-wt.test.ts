// The W-T contract (the pitch deck's #9, "weird events that move"): the moving set pieces' moment
// event and its beats, a log and a lane-vote gantry as prop kinds, and a gantry's width. Render,
// audio and barks key on these.
import { describe, expect, it } from 'vitest';
import {
  PROP_KINDS,
  SET_PIECE_BEATS,
  type PropSnapshot,
  type SetPieceBeat,
  type SimEvent,
  type SimEventType,
} from './api';

describe('the W-T sim contract', () => {
  it('lists the beats: a trailer unhitched, a cable car lost, a load shed, a vote cast', () => {
    expect([...SET_PIECE_BEATS]).toEqual(['unhitch', 'runaway', 'shed', 'vote']);
  });

  it('accepts a setPieceBeat event, a vote naming its side and pick', () => {
    const type = 'setPieceBeat' satisfies SimEventType;
    const beat: SetPieceBeat = 'vote';
    const ev: SimEvent = {
      tick: 9,
      type,
      actor: -1,
      target: 0,
      data: {
        beat,
        piece: 'lane-vote',
        id: 'base:keys-lane-vote',
        side: 'left',
        pick: 'base:keys-gator-crossing',
      },
    };
    expect(ev.data['beat']).toBe('vote');
  });

  it('a log and a gantry are prop kinds, and only a gantry carries a width', () => {
    expect(PROP_KINDS).toContain('log');
    expect(PROP_KINDS).toContain('gantry');
    const base = {
      id: 1,
      variant: '',
      label: '',
      piece: 'x',
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      tilt: 0,
      moving: false,
    };
    const gantry: PropSnapshot = { ...base, kind: 'gantry', label: 'GATOR CROSSING | PARADE', spanM: 8 };
    const log: PropSnapshot = { ...base, kind: 'log', tilt: 7.5, moving: true };
    expect(gantry.spanM).toBe(8);
    expect(log.spanM).toBeUndefined();
  });
});
