// Playtest 3's moves, heard (moves spec §4.4; the maintainer: braking into a hairpin should be "a
// first class experience"): the wheelie's pop and its front coming down, the drift's tyre squeal
// and chain tick, the exit boost's rush and the hood launch's crunch and spring. The event-to-cue
// table is checked as data, the patches on the fake context, and the continuous squeal and the pop
// through the mixer, as wind.test.ts does for the wind.
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimEventType, SimSnapshot } from '../sim/api';
import { CUE_PATCHES } from './cue-patches';
import {
  CUE_IDS,
  cueForEvent,
  createMovesCues,
  EVENT_CUES,
  SOUNDING_EVENTS,
  squealLevel,
  SQUEAL,
  type CueId,
} from './cues';
import { FakeAudioContext, fakeContextFactory } from './fake-context';
import { AUDIO_TUNING, createAudio } from './index';

const ev = (type: SimEventType, actor: number, data: SimEvent['data'] = {}, target?: number): SimEvent =>
  target === undefined ? { tick: 10, type, actor, data } : { tick: 10, type, actor, target, data };

describe('the moves in the event table', () => {
  it('hoodLaunch, driftStart, driftEnd and wheelieEnd each have a decision', () => {
    for (const t of ['hoodLaunch', 'driftStart', 'driftEnd', 'wheelieEnd'])
      expect(t in EVENT_CUES, t).toBe(true);
    for (const t of ['hoodLaunch', 'driftStart', 'driftEnd', 'wheelieEnd']) {
      expect(SOUNDING_EVENTS, t).toContain(t);
    }
  });

  it('a hood launch crunches and springs, bigger with more flips, for anyone near enough to hear it', () => {
    const one = cueForEvent(ev('hoodLaunch', 0, { part: 'hood', flips: 1 }, 7), 0);
    const two = cueForEvent(ev('hoodLaunch', 0, { part: 'hood', flips: 2 }, 7), 0);
    const trunk = cueForEvent(ev('hoodLaunch', 0, { part: 'trunk', flips: 1 }, 7), 0);
    expect(one?.cue).toBe('hoodBoing');
    expect(trunk?.cue).toBe('hoodBoing');
    expect(two?.impact ?? 0).toBeGreaterThan(one?.impact ?? 1);
    expect(one?.playerInvolved).toBe(true);
    expect(cueForEvent(ev('hoodLaunch', 3, { part: 'hood', flips: 1 }), 0)?.playerInvolved).toBe(false);
    // A parked hazard has no target and still launches.
    expect(
      cueForEvent(ev('hoodLaunch', 0, { part: 'hood', flips: 2, feature: 'ferry-pickup' }), 0)?.cue,
    ).toBe('hoodBoing');
  });

  it('a drift start bites with a tyre squeal; a chained one adds its tick (the chain rides in the variant)', () => {
    const lone = cueForEvent(ev('driftStart', 0, { side: 1, speed: 30, chain: 1 }), 0);
    const chained = cueForEvent(ev('driftStart', 0, { side: -1, speed: 30, chain: 3 }), 0);
    expect(lone?.cue).toBe('driftBite');
    expect(lone?.variant).toBeUndefined();
    expect(chained?.cue).toBe('driftBite');
    expect(chained?.variant).toBe('3');
    // Only the player's own: a rival's drift is not news (and rivals never drift).
    expect(cueForEvent(ev('driftStart', 4, { side: 1, speed: 30, chain: 1 }), 0)).toBeNull();
  });

  it('a clean drift exit that boosts rushes, scaled by the boost; every other end is silent', () => {
    const small = cueForEvent(
      ev('driftEnd', 0, { seconds: 1, clean: true, chain: 1, points: 0, boostMps: 2.5 }),
      0,
    );
    const big = cueForEvent(
      ev('driftEnd', 0, { seconds: 3, clean: true, chain: 2, points: 0, boostMps: 6 }),
      0,
    );
    expect(small?.cue).toBe('driftBoost');
    expect(big?.impact ?? 0).toBeGreaterThan(small?.impact ?? 1);
    expect(big?.impact).toBeCloseTo(1, 5);
    // The bank (the chain's window lapsing), a sloppy exit and a wipeout carry no boost: the cash
    // chime, the wobble and the crash already sound, and the squeal ends on its own.
    const quiet = [
      { seconds: 0, clean: true, chain: 2, points: 120, boostMps: 0, bank: true },
      { seconds: 1, clean: false, chain: 1, points: 40, boostMps: 0 },
      { seconds: 1, clean: false, chain: 1, points: 0, boostMps: 0, lost: 90 },
    ];
    for (const data of quiet)
      expect(cueForEvent(ev('driftEnd', 0, data), 0), JSON.stringify(data)).toBeNull();
    expect(
      cueForEvent(ev('driftEnd', 5, { seconds: 1, clean: true, chain: 1, points: 0, boostMps: 4 }), 0),
    ).toBeNull();
  });

  it('a clean wheelie coming down thumps the front tyre; a loop-out, a slammed front and a blip stay silent', () => {
    const down = (data: SimEvent['data']) => cueForEvent(ev('wheelieEnd', 0, data), 0);
    expect(down({ seconds: 2, sweetS: 1.5, clean: true, loopOut: false })?.cue).toBe('wheelieDown');
    // The loop-out's crash and the wobble's squeal already sound.
    expect(down({ seconds: 2, sweetS: 0, clean: false, loopOut: true })).toBeNull();
    expect(down({ seconds: 2, sweetS: 0, clean: false, loopOut: false })).toBeNull();
    expect(down({ seconds: 0.2, sweetS: 0, clean: true, loopOut: false })).toBeNull();
    expect(
      cueForEvent(ev('wheelieEnd', 6, { seconds: 2, sweetS: 1, clean: true, loopOut: false }), 0),
    ).toBeNull();
  });

  it('keeps the existing cues as they were', () => {
    expect(cueForEvent(ev('crash', 2), 0)?.cue).toBe('crash');
    expect(cueForEvent(ev('land', 0), 0)?.cue).toBe('land');
    expect(cueForEvent(ev('style', 0, { kind: 'drift', points: 120 }), 0)?.cue).toBe('cash');
  });
});

describe('the patches', () => {
  /** Renders a cue on the fake context: how many sources it starts and when it has died away. */
  function render(cue: CueId, opts: { impact?: number; variant?: string } = {}) {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const playing = CUE_PATCHES[cue](
      ctx as unknown as BaseAudioContext,
      out as unknown as AudioNode,
      1,
      1,
      opts,
    );
    const sources = ctx.nodes.filter((n) => n.kind === 'oscillator' || n.kind === 'bufferSource');
    return { sources: sources.length, endsAt: playing.endsAt };
  }

  it('every new cue has a patch that starts sound and dies away inside two seconds', () => {
    for (const cue of ['wheelieUp', 'wheelieDown', 'driftBite', 'driftBoost', 'hoodBoing'] as const) {
      expect(CUE_IDS, cue).toContain(cue);
      const r = render(cue);
      expect(r.sources, cue).toBeGreaterThan(1);
      expect(r.endsAt, cue).toBeGreaterThan(1.1);
      expect(r.endsAt, cue).toBeLessThan(3);
    }
  });

  it('a chained drift adds a tick per link, and a second flip adds a second spring', () => {
    expect(render('driftBite', { variant: '3' }).sources).toBeGreaterThan(render('driftBite').sources);
    expect(render('driftBite', { variant: '2' }).sources).toBeLessThan(
      render('driftBite', { variant: '4' }).sources,
    );
    expect(render('hoodBoing', { impact: 0.67 }).sources).toBeGreaterThan(
      render('hoodBoing', { impact: 0.34 }).sources,
    );
  });

  it('a bigger boost rushes longer', () => {
    expect(render('driftBoost', { impact: 1 }).endsAt).toBeGreaterThan(
      render('driftBoost', { impact: 0.2 }).endsAt,
    );
  });
});

describe('the squeal and the pop, by the numbers', () => {
  it('the squeal is silent without slip, swells with it and stops growing at full slip', () => {
    const g = 0.3;
    expect(squealLevel(0, g)).toBe(0);
    expect(squealLevel(SQUEAL.deadRad / 2, g)).toBe(0);
    const levels = [0.1, 0.2, 0.4, SQUEAL.fullRad].map((d) => squealLevel(d, g));
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]!);
    expect(squealLevel(SQUEAL.fullRad, g)).toBeCloseTo(g, 6);
    expect(squealLevel(2, g)).toBeCloseTo(g, 6);
    // Either side of the bike, and nothing for garbage.
    expect(squealLevel(-0.4, g)).toBeCloseTo(squealLevel(0.4, g), 9);
    expect(squealLevel(Number.NaN, g)).toBe(0);
    expect(squealLevel(0.5, 0)).toBe(0);
  });

  it('the wheelie pops once, on the snapshot where the front goes up; a stale or first look never pops', () => {
    const moves = (wheelieS: number) => ({
      wheelieS,
      wheelieBand: wheelieS > 0 ? ('low' as const) : null,
      driftS: 0,
      driftChain: 0,
      driftCash: 0,
      driftSide: 0 as const,
    });
    const t = createMovesCues();
    expect(t.step(moves(0.5))).toEqual([]); // joined mid-wheelie (a resume): no pop
    expect(t.step(moves(0.6))).toEqual([]);
    expect(t.step(moves(0))).toEqual([]);
    const pop = t.step(moves(0.02));
    expect(pop.map((c) => c.cue)).toEqual(['wheelieUp']);
    expect(pop[0]?.playerInvolved).toBe(true);
    expect(t.step(moves(0.1))).toEqual([]);
    expect(t.step(moves(0.2))).toEqual([]);
    t.step(null);
    expect(t.step(moves(0.02))).toEqual([]); // after a null (out of the race) the next look is a first look
    t.step(moves(0));
    expect(t.step(moves(0.02)).length).toBe(1);
  });
});

function me(over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id: 0,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 30,
    lean: 0,
    contentId: 'player',
    name: 'you',
    faction: 'rider',
    slot: 0,
    throttle: 1,
    rpm: 6000,
    gear: 3,
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

const snap = (e: EntitySnapshot, wheelieS = 0, timeScale = 1): SimSnapshot => ({
  tick: 10,
  timeScale,
  entities: [e],
  race: { over: false, routeLength: 2000, finishOrder: [] },
  moves: {
    wheelieS,
    wheelieBand: wheelieS > 0 ? 'sweet' : null,
    driftS: 0,
    driftChain: 0,
    driftCash: 0,
    driftSide: 0,
  },
});

async function mixer() {
  const { ctx, create } = fakeContextFactory();
  const audio = createAudio({ createContext: create });
  await audio.resume();
  return { audio, ctx };
}

describe('the mixer', () => {
  it('squeals while the bike slides, louder with more slip, either way round', async () => {
    const { audio } = await mixer();
    audio.frame(snap(me({ drift: 0 })), 0);
    expect(audio.inspect().squealLevel).toBe(0);
    audio.frame(snap(me({ drift: 0.2 })), 0);
    const light = audio.inspect().squealLevel;
    audio.frame(snap(me({ drift: 0.6 })), 0);
    const hard = audio.inspect().squealLevel;
    audio.frame(snap(me({ drift: -0.6 })), 0);
    const left = audio.inspect().squealLevel;
    console.log(
      `[examined] squeal level at slip 0, 0.2, 0.6, -0.6 rad: 0, ${light.toFixed(3)}, ${hard.toFixed(3)}, ${left.toFixed(3)}`,
    );
    expect(light).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(light);
    expect(left).toBeCloseTo(hard, 9);
  });

  it('stops when the rider is down, in the air or out of the race, and ducks in a hit-stop', async () => {
    const { audio } = await mixer();
    audio.frame(snap(me({ drift: 0.6 })), 0);
    const riding = audio.inspect().squealLevel;
    expect(riding).toBeGreaterThan(0);
    audio.frame(snap(me({ drift: 0.6, mode: 'Tumble' })), 0);
    expect(audio.inspect().squealLevel).toBe(0);
    audio.frame(snap(me({ drift: 0.6, mode: 'Airborne' })), 0);
    expect(audio.inspect().squealLevel).toBe(0);
    audio.frame(snap(me({ drift: 0.6 }), 0, 0), 0);
    expect(audio.inspect().squealLevel).toBeLessThan(riding);
    audio.frame(snap(me({ drift: 0.6 })), 0);
    audio.frame(null, 0);
    expect(audio.inspect().squealLevel).toBe(0);
  });

  it('follows its slider (a non-default value changes the result), and 0 is off', async () => {
    const { audio } = await mixer();
    audio.frame(snap(me({ drift: 0.6 })), 0);
    const base = audio.inspect().squealLevel;
    audio.setParam('audio.squealGain', SQUEAL.gain * 2);
    audio.frame(snap(me({ drift: 0.6 })), 0);
    expect(audio.inspect().squealLevel).toBeCloseTo(base * 2, 9);
    audio.setParam('audio.squealGain', 0);
    audio.frame(snap(me({ drift: 0.6 })), 0);
    expect(audio.inspect().squealLevel).toBe(0);
    const d = AUDIO_TUNING.find((t) => t.id === 'audio.squealGain');
    expect(d?.affectsSim).toBe(false);
    expect(d && d.default >= d.min && d.default <= d.max).toBe(true);
    expect(d?.default).toBe(SQUEAL.gain);
  });

  it('pops once as the front goes up, and plays the event cues through the pool', async () => {
    const { audio, ctx } = await mixer();
    ctx.currentTime = 1;
    audio.frame(snap(me(), 0), 0);
    audio.frame(snap(me(), 0.02), 0);
    audio.frame(snap(me(), 0.1), 0);
    audio.frame(snap(me(), 0.2), 0);
    const cues = () => audio.inspect().lastCues.map((c) => c.cue);
    expect(cues().filter((c) => c === 'wheelieUp').length).toBe(1);

    const s = snap(me(), 0);
    audio.onEvents([ev('hoodLaunch', 0, { part: 'hood', flips: 2 }, 9)], s);
    audio.onEvents([ev('driftStart', 0, { side: 1, speed: 30, chain: 2 })], s);
    audio.onEvents([ev('driftEnd', 0, { seconds: 2, clean: true, chain: 2, points: 0, boostMps: 5 })], s);
    audio.onEvents([ev('wheelieEnd', 0, { seconds: 2, sweetS: 1, clean: true, loopOut: false })], s);
    const played = audio.inspect().lastCues;
    expect(played.map((c) => c.cue)).toEqual(
      expect.arrayContaining(['hoodBoing', 'driftBite', 'driftBoost', 'wheelieDown']),
    );
    expect(played.find((c) => c.cue === 'driftBite')?.variant).toBe('2');
  });
});
