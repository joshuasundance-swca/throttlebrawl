import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import { createOutcome, raceResult, RESULTS_BEAT_TICKS, resultsDue } from './results';

function rider(id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    lean: 0,
    contentId: `base:r${id}`,
    name: `r${id}`,
    faction: 'rider',
    slot: -1,
    throttle: 0,
    rpm: 0,
    gear: 0,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: 0,
    distanceToFinish: 100,
    place: id + 1,
    finished: false,
    ...over,
  };
}

function snap(entities: EntitySnapshot[], finishOrder: number[] = [], over = false): SimSnapshot {
  return { tick: 0, timeScale: 1, entities, race: { over, routeLength: 3550, finishOrder } };
}

const ev = (type: SimEvent['type'], actor: number, target: number, data: Record<string, unknown> = {}) =>
  ({ type, actor, target, causeId: 1, data }) as unknown as SimEvent;

const EVENT = { name: 'Causeway Sprint', id: 'm1-skeleton-sprint', byPlaceCash: [1500, 900, 600, 300, 150] };
// Four rivals, the player (id 4) and the cop (id 5).
const field = () =>
  [0, 1, 2, 3].map((i) => rider(i)).concat([rider(4, { slot: 0 }), rider(5, { faction: 'law' })]);

describe('app/results: the player outcome', () => {
  it('a finish gives the place from the finish order, out of the racers only (not the law)', () => {
    const o = createOutcome();
    o.note([ev('finish', 4, -1)], 4, 900);
    const r = raceResult(snap(field(), [2, 4]), 4, o, EVENT);
    expect(r).toEqual({ place: 2, of: 5, prizeCash: 900, eventName: 'Causeway Sprint' });
  });

  it('a bust gives "Busted" and the fine from the bust event', () => {
    const o = createOutcome();
    o.note([ev('bust', 5, 4, { fineCash: 400, dwellTicks: 60 })], 4, 1200);
    const r = raceResult(snap(field()), 4, o, EVENT);
    expect(r.busted).toBe(true);
    expect(r.fineCash).toBe(400);
    expect(r.prizeCash).toBe(0);
  });

  it('ignores busts and finishes of other riders', () => {
    const o = createOutcome();
    o.note([ev('bust', 5, 1, { fineCash: 400 }), ev('finish', 2, -1)], 4, 50);
    expect(o.doneTick).toBeNull();
    expect(raceResult(snap(field()), 4, o, EVENT).busted).toBeUndefined();
  });
});

describe('app/results: when the results screen comes up', () => {
  it('a beat after the player finishes or is busted, not the whole race-end timeout', () => {
    const o = createOutcome();
    expect(resultsDue(o, 100, false)).toBe(false);
    o.note([ev('finish', 4, -1)], 4, 1000);
    expect(resultsDue(o, 1000 + RESULTS_BEAT_TICKS - 1, false)).toBe(false);
    expect(resultsDue(o, 1000 + RESULTS_BEAT_TICKS, false)).toBe(true);
    expect(RESULTS_BEAT_TICKS).toBe(120);
  });

  it('whenever the race itself is over', () => {
    expect(resultsDue(createOutcome(), 5, true)).toBe(true);
  });
});
