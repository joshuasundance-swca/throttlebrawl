import { describe, expect, it } from 'vitest';
import { BARK_FACTS } from '../../content';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../../sim/api';
import { createRaceMemory, factsFor, GRUDGE_POINTS_PER_NOTE } from './memory';

const ev = (
  type: SimEvent['type'],
  actor: number,
  target?: number,
  data = {},
  causeId?: number,
): SimEvent => ({
  tick: 100,
  type,
  actor,
  ...(target === undefined ? {} : { target }),
  ...(causeId === undefined ? {} : { causeId }),
  data,
});

function rider(id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    contentId: `base:r${id}`,
    slot: -1,
    place: id + 1,
    health: 50,
    healthMax: 100,
    heldWeapon: null,
    progress: 0,
    ...over,
  } as unknown as EntitySnapshot;
}

describe('race memory', () => {
  it('counts a fall once, whether combat knocks off, a takedown credits it, or both', () => {
    const m = createRaceMemory();
    // combat's knock-off: actor = the rider knocked off, target = the attacker.
    m.observe([ev('crash', 1, 0, { reason: 'knockedOff', by: 0 }, 7)]);
    expect(m.takedowns(0, 1)).toBe(1);
    // combat-4's health takedown for the same hit (same cause): still one.
    m.observe([ev('takedown', 0, 1, { kind: 'health' }, 7)]);
    expect(m.takedowns(0, 1)).toBe(1);
    // A traffic takedown later: two.
    m.observe([ev('takedown', 0, 1, { kind: 'traffic' }, 9)]);
    expect(m.takedowns(0, 1)).toBe(2);
    expect(m.takedowns(1, 0)).toBe(0);
    // A crash with any other cause is not a takedown.
    m.observe([ev('crash', 1, 5, { cause: 'traffic' }, 11)]);
    expect(m.takedowns(5, 1)).toBe(0);
  });

  it('turns noted grudges into 0–10 grudge points, the siren into heat, and resets per race', () => {
    const m = createRaceMemory();
    m.observe([ev('grudgeNoted', 2, 0)]);
    expect(m.grudge(2, 0)).toBe(GRUDGE_POINTS_PER_NOTE);
    expect(m.grudge(0, 2)).toBe(0);
    m.observe([ev('grudgeNoted', 2, 0), ev('grudgeNoted', 2, 0)]);
    expect(m.grudge(2, 0)).toBe(10);
    m.observe([ev('siren', 9, undefined, { on: true })]);
    expect(m.heat).toBe(1);
    m.observe([ev('modifierStart', -1, undefined, { kind: 'parade', id: 'base:parade' })]);
    expect(m.modifier).toEqual({ kind: 'parade', id: 'base:parade' });
    m.observe([ev('siren', 9, undefined, { on: false }), ev('modifierEnd', -1)]);
    expect(m.heat).toBe(0);
    expect(m.modifier).toEqual({});
    m.observe([ev('siren', 9, undefined, { on: true })]);
    m.reset();
    expect(m.grudge(2, 0)).toBe(0);
    expect(m.heat).toBe(0);
  });
});

describe('fact resolver', () => {
  const player = rider(0, { slot: 0, progress: 750, place: 2, health: 100, heldWeapon: 'base:lead-pipe' });
  const speaker = rider(1, { place: 1, health: 25 });
  const snapshot = {
    tick: 100,
    entities: [player, speaker],
    race: { over: false, routeLength: 3000, finishOrder: [] },
  } as unknown as SimSnapshot;

  it('answers race state from the snapshot and memory from the race', () => {
    const memory = createRaceMemory();
    memory.observe([ev('takedown', 0, 1, { kind: 'traffic' }, 1), ev('grudgeNoted', 1, 0)]);
    const f = factsFor({
      snapshot,
      memory,
      speaker,
      target: player,
      setting: { eventKind: 'race', regionId: 'base:florida-keys' },
      bikeClassOf: (id) => (id === 'base:r0' ? 'rat' : undefined),
    });
    expect(f('race.progress')).toBe(0.25);
    expect(f('race.position.speaker')).toBe(1);
    expect(f('race.position.target')).toBe(2);
    expect(f('speaker.healthFrac')).toBe(0.25);
    expect(f('target.healthFrac')).toBe(1);
    expect(f('speaker.weapon')).toBe('none');
    expect(f('target.weapon')).toBe('base:lead-pipe');
    expect(f('target.bikeClass')).toBe('rat');
    expect(f('history.takedowns.targetOnSpeaker')).toBe(1);
    expect(f('history.takedowns.speakerOnTarget')).toBe(0);
    expect(f('grudge.speakerTowardTarget')).toBe(GRUDGE_POINTS_PER_NOTE);
    expect(f('grudge.targetTowardSpeaker')).toBe(0);
    expect(f('heat.level')).toBe(0);
    expect(f('event.kind')).toBe('race');
    expect(f('region.id')).toBe('base:florida-keys');
    // Unknown until the app or the career can say.
    expect(f('timeOfDay')).toBeUndefined();
    expect(f('modifier.kind')).toBeUndefined();
    expect(f('history.lastRace.targetBeatSpeaker')).toBeUndefined();
    expect(f('history.racesTogether')).toBeUndefined();
    expect(f('flags.met-the-mayor')).toBeUndefined();
  });

  it('leaves every target fact unknown when there is no target', () => {
    const f = factsFor({ snapshot, memory: createRaceMemory(), speaker, target: null });
    for (const fact of [
      'race.position.target',
      'target.healthFrac',
      'target.weapon',
      'target.bikeClass',
      'grudge.speakerTowardTarget',
      'history.takedowns.targetOnSpeaker',
    ]) {
      expect(f(fact), fact).toBeUndefined();
    }
    expect(f('race.position.speaker')).toBe(1);
  });

  it("answers every fact in content/'s vocabulary, except the career ones until M4", () => {
    const CAREER = new Set(['history.lastRace.targetBeatSpeaker', 'history.racesTogether']);
    const memory = createRaceMemory();
    memory.observe([ev('modifierStart', -1, undefined, { kind: 'league', id: 'base:bounty' })]);
    const f = factsFor({
      snapshot,
      memory,
      speaker,
      target: player,
      setting: { eventKind: 'classic-race', regionId: 'base:florida-keys', timeOfDay: 'noon' },
      bikeClassOf: () => 'rat',
    });
    const facts = [...Object.keys(BARK_FACTS), 'flags.met-the-mayor'];
    expect(facts.length).toBe(21);
    for (const fact of facts) {
      const career = CAREER.has(fact) || fact.startsWith('flags.');
      expect(f(fact) === undefined, fact).toBe(career);
    }
  });
});
