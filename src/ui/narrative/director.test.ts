import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../../sim/api';
import { createBarkDirector, type BarkView, type ShownBark } from './director';
import { barkLinesFrom, createBarkSelector } from './selector';

function rider(id: number, contentId: string, name: string, slot = -1): EntitySnapshot {
  return { id, kind: 'rider', contentId, name, slot } as unknown as EntitySnapshot;
}

const ENTITIES = [
  rider(0, 'base:deacon-vane', 'Deacon Vane'),
  rider(1, 'base:kevin-from-accounting', 'Kevin from Accounting'),
  rider(2, 'base:player', 'You', 0),
];
const SNAP = { tick: 0, entities: ENTITIES } as unknown as SimSnapshot;

const LINE_42 = 'Every road leads somewhere. Yours ends her';

function pool() {
  return barkLinesFrom({
    'base:deacon-core': {
      type: 'bark-set',
      id: 'deacon-core',
      defaults: { speaker: 'deacon-vane', cooldownS: 90 },
      lines: [
        { id: 'deacon-start', trigger: 'race-start', text: LINE_42 },
        { id: 'deacon-pass', trigger: 'overtake', text: 'Get thee behind me. Stay there.' },
        { id: 'deacon-hit', trigger: 'hit-landed', text: 'Consider yourself baptized.' },
      ],
    },
    'base:kevin-core': {
      type: 'bark-set',
      id: 'kevin-core',
      defaults: { speaker: 'kevin-from-accounting', cooldownS: 90 },
      lines: [{ id: 'kevin-start', trigger: 'race-start', text: 'Quick sync before we start: you lose.' }],
    },
    // The player never speaks, even with lines of its own.
    'base:player-core': {
      type: 'bark-set',
      id: 'player-core',
      defaults: { speaker: 'player' },
      lines: [{ id: 'player-pass', trigger: 'overtake', text: 'Nope.' }],
    },
  });
}

function fakeView() {
  const shown: ShownBark[] = [];
  let hides = 0;
  const view: BarkView = {
    show: (b) => shown.push(b),
    hide: () => hides++,
  };
  return { view, shown, hides: () => hides };
}

const ev = (tick: number, type: SimEvent['type'], actor: number, target?: number): SimEvent =>
  target === undefined ? { tick, type, actor, data: {} } : { tick, type, actor, target, data: {} };

describe('bark director', () => {
  it('has one rival speak at race start, and shows a 42-character line for 2.8 s', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { view, shown } = fakeView();
      const d = createBarkDirector(createBarkSelector(pool()), view);
      d.onEvents([ev(0, 'raceStart', -1)], { snapshot: SNAP, seed });
      expect(shown.length).toBe(1);
      const b = shown[0];
      expect(['Deacon Vane', 'Kevin from Accounting']).toContain(b?.speakerName);
      if (b?.speakerName === 'Deacon Vane') {
        expect(b.text).toBe(LINE_42);
        expect(b.durationS).toBeCloseTo(2.8, 10);
        expect(b.contentRef).toBe('base:bark-set/deacon-core#deacon-start');
      }
    }
  });

  it('seeds the race-start pick from the race seed, so both rivals get a turn across seeds', () => {
    const speakers = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const { view, shown } = fakeView();
      createBarkDirector(createBarkSelector(pool()), view).onEvents([ev(0, 'raceStart', -1)], {
        snapshot: SNAP,
        seed,
      });
      speakers.add(shown[0]?.speakerName ?? '');
      const again = fakeView();
      createBarkDirector(createBarkSelector(pool()), again.view).onEvents([ev(0, 'raceStart', -1)], {
        snapshot: SNAP,
        seed,
      });
      expect(again.shown[0]?.contentRef).toBe(shown[0]?.contentRef);
    }
    expect(speakers).toEqual(new Set(['Deacon Vane', 'Kevin from Accounting']));
  });

  it('maps overtake to the overtaker and hit to hit-landed for the attacker', () => {
    const { view, shown } = fakeView();
    const d = createBarkDirector(createBarkSelector(pool()), view);
    d.onEvents([ev(600, 'overtake', 0, 2)], { snapshot: SNAP, seed: 1 });
    d.onEvents([ev(1200, 'hit', 0, 2)], { snapshot: SNAP, seed: 1 });
    expect(shown.map((b) => b.contentRef)).toEqual([
      'base:bark-set/deacon-core#deacon-pass',
      'base:bark-set/deacon-core#deacon-hit',
    ]);
    expect(shown[1]?.startS).toBe(20);
  });

  it('never makes the player speak, and ignores events it cannot place', () => {
    const { view, shown } = fakeView();
    const d = createBarkDirector(createBarkSelector(pool()), view);
    d.onEvents([ev(60, 'overtake', 2, 0)], { snapshot: SNAP, seed: 1 });
    d.onEvents([ev(120, 'overtake', 99, 0)], { snapshot: SNAP, seed: 1 });
    d.onEvents([ev(180, 'overtake', 0, 2)]);
    expect(shown).toEqual([]);
  });

  it('starts every race clean and hides the bubble when the race ends', () => {
    const { view, shown, hides } = fakeView();
    const d = createBarkDirector(createBarkSelector(pool()), view);
    d.onEvents([ev(600, 'overtake', 0, 2)], { snapshot: SNAP, seed: 1 });
    d.onEvents([ev(700, 'raceEnd', -1)], { snapshot: SNAP, seed: 1 });
    expect(hides()).toBe(1);
    // A new race: tick 0 again, and Deacon's overtake line is off cooldown.
    d.onEvents([ev(0, 'raceStart', -1)], { snapshot: SNAP, seed: 2 });
    d.onEvents([ev(600, 'overtake', 0, 2)], { snapshot: SNAP, seed: 2 });
    expect(shown.filter((b) => b.contentRef.endsWith('#deacon-pass')).length).toBe(2);
  });
});
