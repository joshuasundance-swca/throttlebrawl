import { describe, expect, it } from 'vitest';
import type { SimEvent, SimEventType } from '../sim/api';
import { CUE_IDS, cueForEvent, EVENT_CUES, SOUNDING_EVENTS } from './cues';
import { CUE_PATCHES } from './cue-patches';

// Every event type in the M1 sim contract (src/sim/types.ts). Kept as a list, not a type-level
// exhaustiveness check, so a contract PR that adds an event type does not break this lane's
// typecheck; the test below then says which new type still needs a decision.
const M1_EVENT_TYPES = [
  'raceStart',
  'raceEnd',
  'finish',
  'overtake',
  'lapOrCheckpoint',
  'attackStart',
  'attackMiss',
  'hit',
  'kick',
  'weaponGrab',
  'crash',
  'takedown',
  'nearMiss',
  'bust',
  'jump',
  'land',
  'pedDive',
  'cashAward',
  'style',
  'modifierStart',
  'modifierEnd',
  // Added to the contract during M1 (cops-1, combat-2, riders).
  'siren',
  'stealWindow',
  'wobble',
] as const satisfies readonly SimEventType[];

// The M2 event types (app-3 contract 1, docs/milestones/M2.md), and the ones that must make a
// sound (audio-2: "every M2 event type that should make a sound has a cue").
const M2_EVENT_TYPES = [
  'slowmoStart',
  'slowmoEnd',
  'railOver',
  'splash',
  'respawn',
  'getUp',
  'fistShake',
  'grudgeNoted',
] as const satisfies readonly SimEventType[];
const M2_SOUNDING = [
  'takedown',
  'style',
  'slowmoStart',
  'slowmoEnd',
  'railOver',
  'splash',
  'respawn',
] as const;

const ev = (type: SimEventType, actor = 0, target?: number, data: SimEvent['data'] = {}): SimEvent =>
  target === undefined ? { tick: 10, type, actor, data } : { tick: 10, type, actor, target, data };

describe('event cues', () => {
  it('has a decision (a cue or deliberate silence) for every M1 and M2 event type', () => {
    const missing = [...M1_EVENT_TYPES, ...M2_EVENT_TYPES].filter((t) => !(t in EVENT_CUES));
    expect(missing).toEqual([]);
  });

  it('gives every M2 event that should make a sound a cue with a synth patch', () => {
    for (const t of M2_SOUNDING) {
      expect(SOUNDING_EVENTS, t).toContain(t);
      const cue = EVENT_CUES[t];
      expect(CUE_PATCHES[cue as keyof typeof CUE_PATCHES], `${t} -> ${String(cue)}`).toBeTypeOf('function');
    }
  });

  it('gives every sounding M1 event a cue with a synth patch', () => {
    // The events audio-1 must voice: punch, kick, hit, miss and crash, plus the rest of the M1 list.
    for (const t of [
      'hit',
      'kick',
      'attackMiss',
      'crash',
      'takedown',
      'bust',
      'land',
      'weaponGrab',
    ] as const) {
      expect(SOUNDING_EVENTS, t).toContain(t);
    }
    for (const t of SOUNDING_EVENTS) {
      const cue = EVENT_CUES[t];
      expect(cue, t).toBeTruthy();
      expect(CUE_PATCHES[cue as keyof typeof CUE_PATCHES], `${t} -> ${String(cue)}`).toBeTypeOf('function');
    }
  });

  it('has a synth patch for every cue id', () => {
    for (const id of CUE_IDS) expect(CUE_PATCHES[id], id).toBeTypeOf('function');
  });

  it('maps punches, kicks and weapon hits to different impacts', () => {
    expect(cueForEvent(ev('hit', 0, 1, { weapon: 'punch' }), 0)?.cue).toBe('punch');
    expect(cueForEvent(ev('hit', 0, 1), 0)?.cue).toBe('punch');
    expect(cueForEvent(ev('hit', 0, 1, { weapon: 'kick' }), 0)?.cue).toBe('kick');
    expect(cueForEvent(ev('kick', 0, 1), 0)?.cue).toBe('kick');
    expect(cueForEvent(ev('hit', 0, 1, { weapon: 'pipe' }), 0)?.cue).toBe('hit');
    expect(cueForEvent(ev('attackMiss', 0), 0)?.cue).toBe('miss');
    expect(cueForEvent(ev('crash', 2), 0)?.cue).toBe('crash');
  });

  it('ranks player-involved cues above the same cue between rivals', () => {
    const mine = cueForEvent(ev('hit', 3, 0), 0);
    const theirs = cueForEvent(ev('hit', 3, 2), 0);
    expect(mine?.playerInvolved).toBe(true);
    expect(theirs?.playerInvolved).toBe(false);
    expect(mine?.priority ?? 0).toBeGreaterThan(theirs?.priority ?? 0);
  });

  it('stays quiet for silent and unknown event types, without throwing', () => {
    expect(cueForEvent(ev('overtake', 0, 1), 0)).toBeNull();
    const unknown = { tick: 1, type: 'somethingNew', actor: 0, data: {} } as unknown as SimEvent;
    expect(cueForEvent(unknown, 0)).toBeNull();
  });

  it('plays a siren whoop for a siren event, whatever cops-1 names it', () => {
    for (const type of ['siren', 'sirenStart', 'copSiren']) {
      const e = { tick: 1, type, actor: 4, data: {} } as unknown as SimEvent;
      expect(cueForEvent(e, 0)?.cue, type).toBe('sirenWhoop');
    }
  });
});
