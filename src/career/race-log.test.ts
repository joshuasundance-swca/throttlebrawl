import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import {
  AUDIT_MAX_LINE_ITEMS,
  createRaceLog,
  LOSE_HEAT_S,
  MIN_CHASE_S,
  type ObjectiveSpec,
  type RaceRules,
} from './race-log';

// Each objective type has a pass case and a fail case (docs/milestones/M4.md, events-1 and the M4
// exit: "Each objective type has unit tests"), on hand-built snapshots and events: the race log
// reads only the sim's public events and snapshots.

const ME = 1;
const RIVAL = 0;
const COP = 2;

function entity(id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 30,
    lean: 0,
    contentId: id === ME ? 'base:player' : id === COP ? 'base:sgt-pruitt' : 'base:kevin-from-accounting',
    name: '',
    faction: id === COP ? 'law' : 'rider',
    slot: id === ME ? 0 : -1,
    throttle: 1,
    rpm: 0,
    gear: 1,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: 0,
    distanceToFinish: 1000,
    place: 1,
    finished: false,
    ...over,
  };
}

/** A tiny race: the rival, the player and a cop; one step per call, at timeScale 1. */
function race(rules: RaceRules, objectives: ObjectiveSpec[], opts: { roads?: string[] } = {}) {
  const log = createRaceLog({
    playerId: ME,
    rules,
    objectives,
    routeId: 'test-run',
    roadIds: opts.roads ?? ['road-a', 'road-b'],
    secrets: [
      {
        id: 'stash',
        kind: 'stash',
        name: 'A stash',
        road: 'road-b',
        s: 500,
        ref: '',
        cash: 300,
        atFraction: null,
      },
      {
        id: 'cut',
        kind: 'shortcut',
        name: 'The cut',
        road: 'road-a',
        s: 900,
        ref: 'other-run#the-cut',
        cash: 0,
        atFraction: null,
      },
      {
        id: 'pirate',
        kind: 'station',
        name: 'Pirate',
        road: 'road-a',
        s: 0,
        ref: '',
        cash: 0,
        atFraction: 0.5,
      },
    ],
  });
  let tick = 0;
  let me: Partial<EntitySnapshot> = {};
  let rival: Partial<EntitySnapshot> = {};
  let cop: Partial<EntitySnapshot> = {};
  let order: number[] = [];
  const step = (events: Omit<SimEvent, 'tick'>[] = [], n = 1) => {
    for (let i = 0; i < n; i++) {
      tick++;
      const snap: SimSnapshot = {
        tick,
        timeScale: 1,
        entities: [entity(RIVAL, rival), entity(ME, me), entity(COP, cop)],
        race: { over: false, routeLength: 2000, finishOrder: order },
      };
      log.note(i === 0 ? events.map((e) => ({ ...e, tick })) : [], snap);
    }
  };
  return {
    log,
    step,
    setMe: (o: Partial<EntitySnapshot>) => (me = { ...me, ...o }),
    setRival: (o: Partial<EntitySnapshot>) => (rival = { ...rival, ...o }),
    setCop: (o: Partial<EntitySnapshot>) => (cop = { ...cop, ...o }),
    finish: (id: number) => {
      order = [...order, id];
      step([{ type: 'finish', actor: id, data: { place: order.length, classified: false } }]);
    },
  };
}

const obj = (
  kind: ObjectiveSpec['kind'],
  params: Record<string, unknown> = {},
  required = true,
): ObjectiveSpec => ({
  id: kind,
  kind,
  required,
  rewardCash: 0,
  params,
});

describe('classic race: finish at or above a place', () => {
  it('passes on a podium finish', () => {
    const r = race({ kind: 'classic-race' }, [obj('finish-place', { maxPlace: 2 })]);
    r.step();
    expect(r.log.status().state).toBe('running');
    r.finish(RIVAL);
    r.finish(ME);
    expect(r.log.status()).toMatchObject({ state: 'won', endNow: false });
    expect(r.log.tally()).toMatchObject({ finished: true, place: 2, racers: 2 });
  });
  it('fails below the place, and on a bust', () => {
    const r = race({ kind: 'classic-race' }, [obj('finish-place', { maxPlace: 1 })]);
    r.finish(RIVAL);
    r.finish(ME);
    expect(r.log.status().state).toBe('lost');
    const b = race({ kind: 'classic-race' }, [obj('finish-place', { maxPlace: 3 })]);
    b.step([{ type: 'bust', actor: COP, target: ME, data: { fineCash: 400 } }]);
    expect(b.log.status().state).toBe('lost');
    expect(b.log.tally()).toMatchObject({ busted: true, fineCash: 400 });
  });
});

describe('takedown hunt: N takedowns before the finish', () => {
  const rules: RaceRules = { kind: 'takedown-hunt', targetCount: 2, targets: 'any', endOnCount: true };
  it('passes at the count, and ends the event there', () => {
    const r = race(rules, [obj('takedowns', { count: 2 })]);
    r.step([{ type: 'takedown', actor: ME, target: RIVAL, data: { kind: 'traffic' } }]);
    expect(r.log.status().objectives[0]?.label).toBe('TAKEDOWNS 1/2');
    expect(r.log.status().state).toBe('running');
    // Someone else's takedown does not count.
    r.step([{ type: 'takedown', actor: RIVAL, target: ME, data: { kind: 'health' } }]);
    r.step([{ type: 'takedown', actor: ME, target: RIVAL, data: { kind: 'health' } }]);
    expect(r.log.status()).toMatchObject({ state: 'won', endNow: true });
  });
  it('fails at the finish short of the count, and at the time limit', () => {
    const r = race(rules, [obj('takedowns', { count: 2 })]);
    r.step([{ type: 'takedown', actor: ME, target: RIVAL, data: { kind: 'traffic' } }]);
    r.finish(ME);
    expect(r.log.status().state).toBe('lost');
    const t = race({ ...rules, timeLimitS: 2 }, [obj('takedowns', { count: 2 })]);
    t.step([], 119);
    expect(t.log.status().state).toBe('running');
    t.step([], 2);
    expect(t.log.status()).toMatchObject({ state: 'lost', endNow: true });
  });
  it('counts only the listed targets when the event names them', () => {
    const r = race({ ...rules, targets: ['base:chad-speedwell'] }, [obj('takedowns', { count: 1 })]);
    r.step([{ type: 'takedown', actor: ME, target: RIVAL, data: { kind: 'traffic' } }]);
    expect(r.log.status().state).toBe('running');
    expect(r.log.tally().takedowns).toBe(1);
  });
});

describe('cop escape: survive or lose the heat', () => {
  const survive: RaceRules = { kind: 'cop-escape', escapeBy: 'survive', surviveS: 5 };
  it('the clock starts when a cop is on you; surviving it passes and ends the event', () => {
    const r = race(survive, [obj('escape')]);
    r.step([], 600); // ten seconds, nobody chasing: no clock yet
    expect(r.log.status().objectives[0]?.label).toBe('LOSE THE COPS');
    r.setCop({ targetId: ME });
    r.step([], 299);
    expect(r.log.status().state).toBe('running');
    r.step([], 2);
    expect(r.log.status()).toMatchObject({ state: 'won', endNow: true });
  });
  it('a bust fails it', () => {
    const r = race(survive, [obj('escape')]);
    r.setCop({ targetId: ME });
    r.step([], 60);
    r.step([{ type: 'bust', actor: COP, target: ME, data: { fineCash: 600 } }]);
    expect(r.log.status().state).toBe('lost');
  });
  it('losing the cops passes, but only after a real chase', () => {
    const r = race({ ...survive, surviveS: 600 }, [obj('escape')]);
    r.setCop({ targetId: ME });
    r.step([], 60); // one second of chase, then he looks elsewhere: not a chase lost
    r.setCop({ targetId: RIVAL });
    r.step([], Math.round((LOSE_HEAT_S + 1) * 60));
    expect(r.log.status().state).toBe('running');
    r.setCop({ targetId: ME });
    r.step([], Math.round(MIN_CHASE_S * 60));
    r.setCop({ targetId: -1 });
    r.step([], Math.round(LOSE_HEAT_S * 60) + 1);
    expect(r.log.status().objectives[0]?.label).toBe('LOST THE COPS');
    expect(r.log.status().state).toBe('won');
  });
  it('by distance: the metres ridden since the chase began', () => {
    const r = race({ kind: 'cop-escape', escapeBy: 'distance', escapeDistanceM: 500 }, [obj('escape')]);
    r.setMe({ progress: 200 });
    r.setCop({ targetId: ME });
    r.step();
    r.setMe({ progress: 650 });
    r.step();
    expect(r.log.status().state).toBe('running');
    r.setMe({ progress: 700 });
    r.step();
    expect(r.log.status().state).toBe('won');
  });
});

describe('grudge match: beat one rival', () => {
  const ahead: RaceRules = {
    kind: 'grudge-match',
    rival: 'base:kevin-from-accounting',
    winBy: 'finish-ahead',
  };
  it('to the line: passes when you finish first', () => {
    const r = race(ahead, [obj('beat-rival')]);
    r.step();
    r.finish(ME);
    expect(r.log.status().state).toBe('won');
  });
  it('to the line: fails the moment the rival crosses first, and ends the event', () => {
    const r = race(ahead, [obj('beat-rival')]);
    r.step();
    r.finish(RIVAL);
    expect(r.log.status()).toMatchObject({ state: 'lost', endNow: true });
  });
  it('by knockdowns: passes at the count, only knockdowns of that rival by you count', () => {
    const r = race({ ...ahead, winBy: 'knockdowns', knockdownsToWin: 2 }, [obj('beat-rival')]);
    r.step([{ type: 'takedown', actor: ME, target: RIVAL, data: { kind: 'traffic' } }]);
    r.step([{ type: 'takedown', actor: COP, target: RIVAL, data: { kind: 'traffic' } }]);
    expect(r.log.status().objectives[0]?.label).toBe('KNOCK DOWN 1/2');
    r.step([{ type: 'takedown', actor: ME, target: RIVAL, data: { kind: 'health' } }]);
    expect(r.log.status()).toMatchObject({ state: 'won', endNow: true });
  });
  it('by knockdowns: fails at the finish short of the count', () => {
    const r = race({ ...ahead, winBy: 'knockdowns', knockdownsToWin: 2 }, [obj('beat-rival')]);
    r.finish(ME);
    expect(r.log.status().state).toBe('lost');
  });
  it('a boss beaten either way: to the line, or knocked down enough times', () => {
    const r = race(ahead, [obj('beat-rival', { orKnockdowns: 2 })]);
    r.step([{ type: 'takedown', actor: ME, target: RIVAL, data: { kind: 'traffic' } }]);
    r.step([{ type: 'takedown', actor: ME, target: RIVAL, data: { kind: 'traffic' } }]);
    expect(r.log.status()).toMatchObject({ state: 'won', endNow: true });
  });
});

describe("grudge rules: the rival's own rule (run W-T, the pitch deck's #14)", () => {
  const base: RaceRules = {
    kind: 'grudge-match',
    rival: 'base:kevin-from-accounting',
    winBy: 'finish-ahead',
  };
  const hit = (actor: number, target: number) => ({ type: 'hit' as const, actor, target, data: {} });
  const down = (kind: string) => ({ type: 'takedown' as const, actor: ME, target: RIVAL, data: { kind } });

  it('the audit: each hit the rival lands on you adds a knockdown to the count, up to the cap', () => {
    const audit: RaceRules = { ...base, winBy: 'knockdowns', knockdownsToWin: 2, rule: 'audit' };
    const r = race(audit, [obj('beat-rival')]);
    r.step();
    expect(r.log.status().objectives[0]?.label).toBe('KNOCK DOWN 0/2');
    r.step([hit(RIVAL, ME)]);
    expect(r.log.status().objectives[0]?.label).toBe('KNOCK DOWN 0/3 · 1 LINE ITEM');
    // A hit he lands on someone else, or one landed on him, is not a line item.
    r.step([hit(RIVAL, COP), hit(ME, RIVAL), hit(COP, ME)]);
    expect(r.log.status().objectives[0]?.label).toBe('KNOCK DOWN 0/3 · 1 LINE ITEM');
    for (let i = 0; i < AUDIT_MAX_LINE_ITEMS + 2; i++) r.step([hit(RIVAL, ME)]);
    const want = 2 + AUDIT_MAX_LINE_ITEMS;
    expect(r.log.status().objectives[0]?.label).toBe(
      `KNOCK DOWN 0/${want} · ${AUDIT_MAX_LINE_ITEMS} LINE ITEMS`,
    );
    for (let i = 0; i < want - 1; i++) r.step([down('health')]);
    expect(r.log.status().state).toBe('running');
    r.step([down('health')]);
    expect(r.log.status()).toMatchObject({ state: 'won', endNow: true });
  });

  it('without the audit, his hits add nothing', () => {
    const r = race({ ...base, winBy: 'knockdowns', knockdownsToWin: 1 }, [obj('beat-rival')]);
    r.step([hit(RIVAL, ME)]);
    r.step([down('health')]);
    expect(r.log.status().state).toBe('won');
  });

  it('the collab: the most style cash at your finish wins, not the place', () => {
    const collab: RaceRules = { ...base, rule: 'collab' };
    const style = (actor: number, points: number) => ({
      type: 'style' as const,
      actor,
      data: { kind: 'nearMiss', points },
    });
    const lost = race(collab, [obj('beat-rival')]);
    lost.step([style(ME, 200), style(RIVAL, 300)]);
    expect(lost.log.status().objectives[0]?.label).toBe('MOST STYLE: YOU $200 · THEM $300');
    lost.finish(ME);
    expect(lost.log.status().state).toBe('lost');

    const won = race(collab, [obj('beat-rival')]);
    won.step([style(ME, 500), style(RIVAL, 300)]);
    // Crossing first decides nothing: he is still behind on views.
    won.finish(RIVAL);
    expect(won.log.status().state).toBe('running');
    won.step([style(RIVAL, 100)]);
    won.finish(ME);
    expect(won.log.status().state).toBe('won');
  });

  it('the collab: a tie is not a win, and a bust loses it', () => {
    const collab: RaceRules = { ...base, rule: 'collab' };
    const tie = race(collab, [obj('beat-rival')]);
    tie.finish(ME);
    expect(tie.log.status().state).toBe('lost');
    const bust = race(collab, [obj('beat-rival')]);
    bust.step([{ type: 'style', actor: ME, data: { kind: 'nearMiss', points: 900 } }]);
    bust.step([{ type: 'bust', actor: COP, target: ME, data: { fineCash: 100 } }]);
    expect(bust.log.status().state).toBe('lost');
  });

  it('timber: only traffic and scenery takedowns of the rival count', () => {
    const timber: RaceRules = { ...base, winBy: 'knockdowns', knockdownsToWin: 2, rule: 'timber' };
    const r = race(timber, [obj('beat-rival')]);
    r.step([down('health')]);
    expect(r.log.status().objectives[0]?.label).toBe('TIMBER 0/2: INTO TRAFFIC OR SCENERY');
    r.step([down('traffic')]);
    r.step([down('health')]);
    expect(r.log.status().state).toBe('running');
    r.step([down('scenery')]);
    expect(r.log.status()).toMatchObject({ state: 'won', endNow: true });
  });

  it('timber on a boss beaten either way: to the line, or felled enough times', () => {
    const r = race({ ...base, rule: 'timber' }, [obj('beat-rival', { orKnockdowns: 2 })]);
    r.step([down('health')]);
    r.step([down('traffic')]);
    expect(r.log.status().objectives[0]?.label).toBe('BEAT THEM HOME OR FELL THEM 1/2');
    r.step([down('scenery')]);
    expect(r.log.status().state).toBe('won');
  });
});

describe('optional objectives and what the race found', () => {
  it('style cash and a ridden branch pay; missing them never loses the event', () => {
    const r = race({ kind: 'classic-race' }, [
      obj('finish-place', { maxPlace: 9 }),
      { ...obj('style-cash', { cash: 100 }, false), rewardCash: 50 },
      { ...obj('ride-branch', { branch: 'the-cut' }, false), rewardCash: 80 },
    ]);
    r.step([{ type: 'style', actor: ME, data: { kind: 'nearMiss', points: 60 } }]);
    r.step([{ type: 'style', actor: RIVAL, data: { kind: 'nearMiss', points: 999 } }]);
    r.step([{ type: 'style', actor: ME, data: { kind: 'takedownCombo', points: 50 } }]);
    r.setMe({ branch: 'the-cut' });
    r.step();
    r.setMe({ branch: null });
    r.finish(ME);
    const s = r.log.status();
    expect(s.state).toBe('won');
    expect(s.objectives.map((o) => o.met)).toEqual([true, true, true]);
    const t = r.log.tally();
    expect(t.styleCash).toBe(110);
    expect(t.style).toEqual({ nearMiss: { count: 1, cash: 60 }, takedownCombo: { count: 1, cash: 50 } });
    expect(t.branches).toEqual(['test-run#the-cut']);
    // The shortcut secret is the same branch on another route: found.
    expect(t.secrets).toContain('cut');
  });
  it('secrets: passed within reach on their road, or past a pirate station spot', () => {
    const r = race({ kind: 'classic-race' }, [obj('finish-place', { maxPlace: 9 })]);
    r.setMe({ road: { edge: 1, s: 380, d: 0, h: 0, dir: 1, yaw: 0 }, progress: 900 });
    r.step();
    expect(r.log.tally().secrets).toEqual([]);
    r.setMe({ road: { edge: 1, s: 450, d: 0, h: 0, dir: 1, yaw: 0 }, progress: 1001 });
    r.step();
    expect(r.log.tally().secrets).toEqual(['pirate', 'stash']);
  });
  it('tallies what the player did to each rival, for the grudges', () => {
    const r = race({ kind: 'classic-race' }, [obj('finish-place', { maxPlace: 9 })]);
    r.step([{ type: 'hit', actor: ME, target: RIVAL, data: {} }]);
    r.step([{ type: 'hit', actor: ME, target: RIVAL, data: {} }]);
    r.step([
      { type: 'weaponGrab', actor: ME, target: RIVAL, data: { source: 'steal', weapon: 'base:lead-pipe' } },
    ]);
    r.step([
      { type: 'weaponGrab', actor: ME, target: 99, data: { source: 'road', weapon: 'base:lead-pipe' } },
    ]);
    r.step([{ type: 'takedown', actor: ME, target: RIVAL, data: { kind: 'traffic' } }]);
    expect(r.log.tally().toRivals).toEqual({
      'base:kevin-from-accounting': { hits: 2, takedowns: 1, steals: 1 },
    });
    expect(r.log.tally()).toMatchObject({ field: ['base:kevin-from-accounting'], player: 'base:player' });
  });
});
