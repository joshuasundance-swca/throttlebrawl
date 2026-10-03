// Run W-U's sound pass (the pitch deck's #5, "Every region sounds like itself", and run W-T's audio
// follow-ups): smashables break by what they are made of, the moving set pieces have their moments
// (the runaway cable car rings while it rolls), thrown weapons whirl, landings slam and surge, a
// beaten rival's engine sputters, and a boxing bell rings at the finish.
import { describe, expect, it } from 'vitest';
import {
  SET_PIECE_BEATS,
  SMASHABLE_KINDS,
  type EntitySnapshot,
  type SimEvent,
  type SimSnapshot,
  type SmashableSnapshot,
} from '../sim/api';
import { CUE_PATCHES, SMASH_MATERIALS } from './cue-patches';
import { BEAT_CUES, cueForEvent } from './cues';
import { createEngineVoice, resolveEngineProfile } from './engine-patch';
import { FakeAudioContext, fakeContextFactory } from './fake-context';
import { createAudio, RUNAWAY_BELL, SPUTTER } from './index';

function rider(id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: -id * 4,
    heading: 0,
    speed: 20,
    lean: 0,
    contentId: 'deacon-vane',
    name: 'x',
    faction: 'rider',
    slot: -1,
    throttle: 0.5,
    rpm: 5000,
    gear: 2,
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
const snap = (entities: EntitySnapshot[], smashables: SmashableSnapshot[] = []): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 2000, finishOrder: [] },
  smashables,
});
const ev = (type: string, actor: number, data: SimEvent['data'] = {}, target?: number): SimEvent =>
  (target === undefined
    ? { tick: 1, type, actor, data }
    : { tick: 1, type, actor, target, data }) as SimEvent;
const prop = (id: number, x: number, z: number): SmashableSnapshot => ({
  id,
  kind: 'parking-meter',
  name: 'METER EXPIRED',
  x,
  y: 0,
  z,
  heading: 0,
  smashedTick: 1,
  hitVx: 0,
  hitVz: 0,
});

async function mixer() {
  const { ctx, create } = fakeContextFactory();
  const audio = createAudio({ createContext: create, radioKeys: null, barkEvents: null, radioSeed: 7 });
  await audio.resume();
  ctx.currentTime = 1;
  const cues = () => audio.inspect().lastCues.filter((c) => c.cue !== 'go');
  return { ctx, audio, cues };
}

describe('which cue each W-T event gets', () => {
  it('a smash sounds by its kind', () => {
    const c = cueForEvent(ev('smash', 3, { prop: 1, kind: 'mailbox', name: 'RETURN TO SENDER' }), 0);
    expect(c).toMatchObject({ cue: 'smash', variant: 'mailbox' });
  });

  it('every smashable kind is made of something, and kinds that differ sound different', () => {
    for (const kind of SMASHABLE_KINDS) expect(SMASH_MATERIALS[kind], kind).toBeDefined();
    const shape = (variant: string) => {
      const ctx = new FakeAudioContext();
      CUE_PATCHES.smash(ctx as unknown as BaseAudioContext, ctx.createGain() as unknown as AudioNode, 0, 1, {
        variant,
      });
      return ctx.nodes.map((n) => `${n.kind}:${n.frequency.calls[0]?.value ?? ''}`).join(',');
    };
    const shapes = new Set(SMASHABLE_KINDS.map(shape));
    expect(shapes.size).toBe(SMASHABLE_KINDS.length);
    // A kind added later still breaks (as wood) instead of throwing.
    expect(shape('beach-umbrella')).toBe(shape('no-such-kind'));
  });

  it('a throw whirls; a briefcase bursting is paper; landing on a rider is a slam', () => {
    expect(cueForEvent(ev('throw', 2, { weapon: 'base:briefcase', pickup: 9 }, 0), 0)?.cue).toBe('toss');
    expect(
      cueForEvent(ev('hit', 2, { weapon: 'base:briefcase', thrown: true, burst: true }, 0), 0)?.cue,
    ).toBe('paper');
    expect(cueForEvent(ev('hit', 0, { weapon: 'landing' }, 3), 0)?.cue).toBe('slam');
    // A weapon in the hand still clangs.
    expect(cueForEvent(ev('hit', 2, { weapon: 'base:lead-pipe' }, 0), 0)?.cue).toBe('hit');
  });

  it('a clean landing that surges whooshes; a plain one thumps', () => {
    expect(cueForEvent(ev('land', 0, { quality: 'clean', surge: true, surgeS: 1 }), 0)?.cue).toBe('surge');
    expect(cueForEvent(ev('land', 0, { quality: 'clean' }), 0)?.cue).toBe('land');
  });

  it('a hop over a shed log thumps; any other jump stays silent', () => {
    expect(cueForEvent(ev('jump', 2, { cause: 'log' }), 0)?.cue).toBe('logHop');
    expect(cueForEvent(ev('jump', 2, {}), 0)).toBeNull();
  });

  it('each set-piece beat has its own cue with a patch; an unknown beat is silent', () => {
    for (const beat of SET_PIECE_BEATS) {
      const c = cueForEvent(ev('setPieceBeat', 5, { beat, piece: 'x', id: 'x' }), 0);
      expect(c?.cue, beat).toBe(BEAT_CUES[beat]);
      expect(CUE_PATCHES[c!.cue], beat).toBeTypeOf('function');
    }
    expect(cueForEvent(ev('setPieceBeat', 5, { beat: 'somethingNew' }), 0)).toBeNull();
  });

  it('your finish rings the bell three times; a rival finishing rings it once', () => {
    expect(cueForEvent(ev('finish', 0), 0)?.cue).toBe('finish');
    expect(cueForEvent(ev('finish', 4), 0)?.cue).toBe('ding');
    const strikes = (cue: 'finish' | 'ding') => {
      const ctx = new FakeAudioContext();
      CUE_PATCHES[cue](ctx as unknown as BaseAudioContext, ctx.createGain() as unknown as AudioNode, 0, 1);
      // The bell's fundamental (1175 Hz) is struck once per ding.
      return ctx.nodes.filter((n) => n.kind === 'oscillator' && n.frequency.calls[0]?.value === 1175).length;
    };
    expect(strikes('finish')).toBe(3);
    expect(strikes('ding')).toBe(1);
  });
});

describe('the mixer places them', () => {
  it('a smash is heard from the smashable, not from the rider credited far away', async () => {
    const m = await mixer();
    // The player at the origin; the rider credited 600 m off; the meter 10 m away.
    const s = snap([rider(0, { slot: 0, contentId: 'player' }), rider(1, { z: -600 })], [prop(5, 0, -10)]);
    m.audio.frame(s, 0);
    m.audio.onEvents([ev('smash', 1, { prop: 5, kind: 'parking-meter', takedown: true }, 2)], s);
    expect(m.cues().at(-1)).toMatchObject({ cue: 'smash', variant: 'parking-meter' });
    // With the meter out of the snapshot too, it falls back to the actor: too far to hear.
    const far = snap([rider(0, { slot: 0, contentId: 'player' }), rider(1, { z: -600 })]);
    const before = m.cues().length;
    m.audio.onEvents([ev('smash', 1, { prop: 5, kind: 'parking-meter', takedown: false })], far);
    expect(m.cues().length).toBe(before);
  });

  it('the runaway cable car rings while it rolls, then stops when it stops', async () => {
    const m = await mixer();
    const me = rider(0, { slot: 0, contentId: 'player' });
    const car = (speed: number) =>
      rider(7, { kind: 'vehicle', contentId: 'region-sf:event-runaway-cable-car', z: -60, speed });
    let s = snap([me, car(8)]);
    m.audio.frame(s, 0);
    m.audio.onEvents([ev('setPieceBeat', 7, { beat: 'runaway', piece: 'cable-runaway', id: 'x' })], s);
    expect(m.cues().at(-1)?.cue).toBe('runaway');
    expect(m.audio.inspect().runawayBell).toBe(7);
    // Five seconds of frames at 20 Hz while it rolls back.
    for (let i = 1; i <= 100; i++) {
      m.ctx.currentTime = 1 + i * 0.05;
      m.audio.frame(s, 0);
    }
    const rung = m.cues().filter((c) => c.cue === 'cableBell').length;
    // About one bell every RUNAWAY_BELL.everyS after the first one's wait.
    const expected = (5 - RUNAWAY_BELL.everyS - 0.3) / RUNAWAY_BELL.everyS;
    expect(rung).toBeGreaterThanOrEqual(Math.floor(expected) - 1);
    expect(rung).toBeLessThanOrEqual(Math.ceil(expected) + 1);
    // It stops rolling: the bells stop.
    s = snap([me, car(0)]);
    m.ctx.currentTime += 0.05;
    m.audio.frame(s, 0);
    expect(m.audio.inspect().runawayBell).toBeNull();
    for (let i = 1; i <= 40; i++) {
      m.ctx.currentTime += 0.05;
      m.audio.frame(s, 0);
    }
    expect(m.cues().filter((c) => c.cue === 'cableBell').length).toBe(rung);
  });
});

describe("a beaten rival's engine sputters", () => {
  async function ride(health: number, seconds = 20) {
    const m = await mixer();
    const s = snap([rider(0, { slot: 0, contentId: 'player' }), rider(1, { health, z: -8 })]);
    for (let i = 0; i <= seconds * 20; i++) {
      m.ctx.currentTime = 1 + i * 0.05;
      m.audio.frame(s, 0);
    }
    return m;
  }

  it('a fresh rival and one just under half health never sputter', async () => {
    expect((await ride(100)).audio.inspect().sputters).toBe(0);
    expect((await ride(100 * (1 - SPUTTER.fromWeakness) + 1)).audio.inspect().sputters).toBe(0);
  });

  it('a rival nearly down sputters often; one at half health now and then', async () => {
    const weak = (await ride(5)).audio.inspect().sputters;
    const half = (await ride(45)).audio.inspect().sputters;
    // 20 s at about 0.8 to 2.6 s a misfire (the gap is jittered 0.6x to 1.4x): bands, not exact counts.
    expect(weak).toBeGreaterThanOrEqual(12);
    expect(weak).toBeLessThanOrEqual(40);
    expect(half).toBeGreaterThanOrEqual(4);
    expect(half).toBeLessThan(weak);
  });

  it('the engine voice misfires: its gate dips and comes back, then a backfire', () => {
    const ctx = new FakeAudioContext();
    const v = createEngineVoice(
      ctx as unknown as BaseAudioContext,
      ctx.createGain() as unknown as AudioNode,
      resolveEngineProfile(undefined),
      'lite',
    );
    const dips = () =>
      ctx.nodes.flatMap((n) => n.gain.calls).filter((c) => c.method === 'setValueAtTime' && c.value === 0.1);
    const sources = () =>
      ctx.nodes.filter((n) => n.kind === 'oscillator' || n.kind === 'bufferSource').length;
    const before = sources();
    v.sputter(2, 0);
    expect(dips()).toHaveLength(0);
    v.sputter(2, 1);
    expect(dips()).toHaveLength(3);
    expect(dips()[0]!.time).toBe(2);
    // The backfire: a noise burst and a thump.
    expect(sources() - before).toBe(2);
  });
});
