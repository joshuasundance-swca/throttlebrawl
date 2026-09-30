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

describe('bark director: M2 triggers', () => {
  const evd = (
    tick: number,
    type: SimEvent['type'],
    actor: number,
    target: number | undefined,
    data: Record<string, string | number | boolean>,
    causeId?: number,
  ): SimEvent => ({
    tick,
    type,
    actor,
    ...(target === undefined ? {} : { target }),
    ...(causeId === undefined ? {} : { causeId }),
    data,
  });

  function m2Pool() {
    const line = (id: string, trigger: string, extra: Record<string, unknown> = {}) => ({
      id,
      trigger,
      text: id,
      ...extra,
    });
    return barkLinesFrom({
      'base:deacon-core': {
        type: 'bark-set',
        id: 'deacon-core',
        defaults: { speaker: 'deacon-vane', cooldownS: 0 },
        lines: [
          line('deacon-traffic', 'takedown-into-traffic'),
          line('deacon-down', 'knocked-down-by-target', { target: 'player' }),
          line('deacon-crash', 'crash-self'),
          line('deacon-near', 'near-miss'),
        ],
      },
      'base:kevin-core': {
        type: 'bark-set',
        id: 'kevin-core',
        defaults: { speaker: 'kevin-from-accounting', cooldownS: 0 },
        lines: [
          line('kevin-down', 'knocked-down-by-target'),
          line('kevin-down-again', 'knocked-down-by-target', {
            weight: 1000,
            when: [{ fact: 'history.takedowns.targetOnSpeaker', op: 'gte', value: 2 }],
          }),
        ],
      },
    });
  }
  const refs = (shown: ShownBark[]) => shown.map((b) => b.contentRef.slice(b.contentRef.indexOf('#') + 1));

  it('has the rival who scored a traffic takedown gloat, and the rider who went down answer later', () => {
    const { view, shown } = fakeView();
    const d = createBarkDirector(createBarkSelector(m2Pool()), view);
    // Deacon (0) takes Kevin (1) down into traffic: Deacon speaks; Kevin's line waits for the bubble.
    d.onEvents(
      [
        evd(600, 'crash', 1, 7, { cause: 'traffic', contact: 'crash' }),
        evd(600, 'takedown', 0, 1, { kind: 'traffic' }, 3),
      ],
      { snapshot: SNAP, seed: 1 },
    );
    expect(refs(shown)).toEqual(['deacon-traffic']);
    expect(shown[0]?.tick).toBe(600);
    expect(shown[0]?.raceId).toBe('seed-1');
  });

  it('has a rival knocked down by you answer you, once per fall, however many events describe it', () => {
    const { view, shown } = fakeView();
    const d = createBarkDirector(createBarkSelector(m2Pool()), view);
    // combat's knock-off (actor = the rider knocked off, target = the attacker) and combat-4's
    // health takedown for the same hit, in one tick: one bark.
    d.onEvents(
      [
        evd(600, 'crash', 0, 2, { reason: 'knockedOff', by: 2 }, 5),
        evd(600, 'takedown', 2, 0, { kind: 'health' }, 5),
      ],
      { snapshot: SNAP, seed: 1, raceId: 'race-7' },
    );
    expect(refs(shown)).toEqual(['deacon-down']);
    expect(shown[0]?.raceId).toBe('race-7');
    // A knock-off by another rival: Deacon's line is for the player only, so silence.
    d.onEvents([evd(1200, 'crash', 0, 1, { reason: 'knockedOff', by: 1 }, 6)], { snapshot: SNAP, seed: 1 });
    expect(refs(shown)).toEqual(['deacon-down']);
  });

  it('reads memory facts from the current race: the second takedown unlocks the memory line', () => {
    const { view, shown } = fakeView();
    const d = createBarkDirector(createBarkSelector(m2Pool()), view);
    d.onEvents([evd(0, 'raceStart', -1, undefined, {})], { snapshot: SNAP, seed: 3 });
    shown.length = 0;
    d.onEvents([evd(600, 'takedown', 2, 1, { kind: 'scenery' }, 1)], { snapshot: SNAP, seed: 3 });
    d.onEvents([evd(1200, 'takedown', 2, 1, { kind: 'scenery' }, 2)], { snapshot: SNAP, seed: 3 });
    expect(refs(shown)).toEqual(['kevin-down', 'kevin-down-again']);
    // A new race forgets: the first takedown gets the plain line again.
    d.onEvents([evd(0, 'raceStart', -1, undefined, {})], { snapshot: SNAP, seed: 4 });
    shown.length = 0;
    d.onEvents([evd(600, 'takedown', 2, 1, { kind: 'scenery' }, 1)], { snapshot: SNAP, seed: 4 });
    expect(refs(shown)).toEqual(['kevin-down']);
  });

  it('maps a crash nobody caused to crash-self, and a near miss to near-miss, for rivals only', () => {
    const { view, shown } = fakeView();
    const d = createBarkDirector(createBarkSelector(m2Pool()), view);
    d.onEvents([evd(600, 'crash', 0, undefined, { cause: 'barrier' })], { snapshot: SNAP, seed: 1 });
    d.onEvents([evd(1200, 'nearMiss', 0, 9, { clearanceM: 0.3, oncoming: true })], {
      snapshot: SNAP,
      seed: 1,
    });
    // The player's own crash and near miss make no rival speak for them.
    d.onEvents([evd(1800, 'crash', 2, undefined, { cause: 'barrier' })], { snapshot: SNAP, seed: 1 });
    d.onEvents([evd(2400, 'nearMiss', 2, 9, { clearanceM: 0.3 })], { snapshot: SNAP, seed: 1 });
    expect(refs(shown)).toEqual(['deacon-crash', 'deacon-near']);
  });

  it('reports every shown bark to onShown, for the recently seen list', () => {
    const { view } = fakeView();
    const seen: string[] = [];
    const d = createBarkDirector(createBarkSelector(m2Pool()), view, {
      onShown: (b) => seen.push(b.contentRef),
    });
    d.onEvents([evd(600, 'nearMiss', 0, 9, {})], { snapshot: SNAP, seed: 1 });
    expect(seen).toEqual(['base:bark-set/deacon-core#deacon-near']);
  });
});
