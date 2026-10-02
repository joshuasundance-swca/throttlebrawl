import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import { AUDIO_TUNING, busTargets, createAudio, type Volumes } from './index';
import { fakeContextFactory } from './fake-context';

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

function snapshot(entities: EntitySnapshot[], timeScale = 1): SimSnapshot {
  return { tick: 100, timeScale, entities, race: { over: false, routeLength: 2000, finishOrder: [] } };
}

async function running() {
  const { ctx, create } = fakeContextFactory();
  const audio = createAudio({ createContext: create });
  await audio.resume();
  ctx.currentTime = 1.5;
  return { ctx, audio };
}

// Heading 0 faces -z, so "ahead of the player" is negative z.
const player = (over: Partial<EntitySnapshot> = {}) =>
  entity(0, { contentId: 'player', slot: 0, speed: 30, ...over });

describe('buses and settings', () => {
  it('bus gains follow the settings sliders, and mute silences master only', async () => {
    const { ctx, audio } = await running();
    const v: Volumes = { master: 0.5, music: 0.25, effects: 1, voices: 0 };
    audio.setVolumes(v, false);
    const expected = busTargets(v, false);
    expect(expected.master).toBeCloseTo(0.25); // squared taper
    expect(expected.effects).toBe(1);
    expect(expected.voices).toBe(0);
    expect(audio.inspect().busTargets).toEqual(expected);

    // The graph itself was told those targets: every bus feeds master, master feeds the limiter,
    // and the limiter reaches the destination through the ceiling (M2: a gain into a shaper).
    const limiter = ctx.nodes.find((n) => n.kind === 'compressor');
    const ceiling = limiter?.outputs[0];
    expect(ceiling?.kind).toBe('gain');
    expect(ceiling?.outputs[0]?.kind).toBe('shaper');
    expect(ceiling?.outputs[0]?.outputs).toContain(ctx.destination);
    const master = ctx.inputsOf(limiter!, 'gain')[0]!;
    expect(master.gain.target).toBeCloseTo(expected.master);
    const buses = ctx.inputsOf(master, 'gain').map((b) => b.gain.target);
    expect(buses.sort()).toEqual([expected.music, expected.effects, expected.voices].sort());

    audio.setVolumes(v, true);
    expect(master.gain.target).toBe(0);
    expect(audio.inspect().busTargets.effects).toBe(1);
  });

  it('volumes set before the start tap apply when the context is built', async () => {
    const { ctx, create } = fakeContextFactory();
    const audio = createAudio({ createContext: create });
    audio.setVolumes({ master: 1, music: 0.5, effects: 0.5, voices: 0.5 }, false);
    expect(audio.state()).toBe('none');
    await audio.resume();
    expect(audio.state()).toBe('running');
    const limiter = ctx.nodes.find((n) => n.kind === 'compressor')!;
    const master = ctx.inputsOf(limiter, 'gain')[0]!;
    expect(master.gain.target).toBe(1);
    // M2: every gain starts at its setting, so the first frame has no swell from the defaults.
    expect(master.gain.value).toBe(1);
    expect(ctx.inputsOf(master, 'gain').map((b) => b.gain.value)).toEqual([0.25, 0.25, 0.25]);
  });

  it('declares its tuning as presentation-only', () => {
    expect(AUDIO_TUNING.length).toBeGreaterThan(0);
    for (const d of AUDIO_TUNING) {
      expect(d.id.startsWith('audio.')).toBe(true);
      expect(d.affectsSim).toBe(false);
      expect(d.default).toBeGreaterThanOrEqual(d.min);
      expect(d.default).toBeLessThanOrEqual(d.max);
    }
  });
});

describe('engine', () => {
  it('the player engine pitch follows rpm', async () => {
    const { audio } = await running();
    audio.frame(snapshot([player({ rpm: 2000 })]), 0);
    const low = audio.inspect().playerEngineHz;
    audio.frame(snapshot([player({ rpm: 9000 })]), 0);
    const high = audio.inspect().playerEngineHz;
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
  });

  it('the skeleton update(player) path still drives the engine, and null silences it', async () => {
    const { audio } = await running();
    audio.update({ rpm: 8000, throttle: 1, speed: 30 });
    expect(audio.inspect().playerEngineHz).toBeGreaterThan(0);
    expect(audio.inspect().playerEngineLevel).toBeGreaterThan(0);
    audio.update(null);
    expect(audio.inspect().playerEngineLevel).toBe(0);
  });

  it('gives nearby rivals their own cheaper engines, and drops far ones', async () => {
    const { audio } = await running();
    const near = entity(1, { z: -20 });
    const far = entity(2, { z: -900 });
    audio.frame(snapshot([player(), near, far]), 0);
    expect(audio.inspect().otherEngines).toEqual([1]);
  });

  it('ducks the engine during hit-stop so the hit rings through', async () => {
    const { audio } = await running();
    audio.frame(snapshot([player()]), 0);
    const normal = audio.inspect().playerEngineLevel;
    audio.frame(snapshot([player()], 0), 0);
    expect(audio.inspect().playerEngineLevel).toBeLessThan(normal * 0.5);
  });
});

describe('cues', () => {
  const hit: SimEvent = { tick: 100, type: 'hit', actor: 0, target: 1, data: { weapon: 'punch' } };

  it('plays a hit the moment its event arrives: on the hit-stop tick, no scheduling delay', async () => {
    const { ctx, audio } = await running();
    const snap = snapshot([player(), entity(1, { z: -1 })], 0);
    audio.frame(snap, 0);
    ctx.currentTime = 2.25;
    audio.onEvents([hit], snap);
    const played = audio.inspect().lastCues.at(-1);
    expect(played).toEqual({ cue: 'punch', at: 2.25 });
    const started = ctx.nodes.filter((n) => n.startedAt === 2.25);
    expect(started.length).toBeGreaterThan(0);
  });

  it('plays nothing for silent events and survives unknown ones', async () => {
    const { audio } = await running();
    const unknown = { tick: 1, type: 'brandNew', actor: 0, data: {} } as unknown as SimEvent;
    audio.onEvents([{ tick: 1, type: 'overtake', actor: 0, target: 1, data: {} }, unknown]);
    expect(audio.inspect().lastCues).toEqual([]);
  });

  it('caps the number of voices', async () => {
    const { audio } = await running();
    audio.setParam('audio.maxVoices', 8);
    const snap = snapshot([player(), entity(1, { z: -2 })]);
    audio.frame(snap, 0);
    const many: SimEvent[] = Array.from({ length: 40 }, (_, i) => ({ ...hit, tick: i }));
    audio.onEvents(many, snap);
    expect(audio.inspect().activeVoices).toBeLessThanOrEqual(8);
  });

  it('does nothing before the start tap', () => {
    const { create } = fakeContextFactory();
    const audio = createAudio({ createContext: create });
    expect(() => {
      audio.frame(snapshot([player()]), 0);
      audio.onEvents([hit]);
    }).not.toThrow();
    expect(audio.inspect().lastCues).toEqual([]);
  });
});

describe('telegraphs', () => {
  it('an oncoming car in your lane honks once, not every frame', async () => {
    const { ctx, audio } = await running();
    const car = entity(5, {
      kind: 'vehicle',
      contentId: 'sedan',
      z: -50,
      heading: Math.PI,
      road: { edge: 0, s: 0, d: 0, h: 0, dir: -1, yaw: 0 },
    });
    for (let i = 0; i < 10; i++) {
      ctx.currentTime += 1 / 60;
      audio.frame(snapshot([player(), car]), 0);
    }
    expect(audio.inspect().lastCues.map((c) => c.cue)).toEqual(['horn']);
  });

  it('a truck gets the low horn; a car in the other lane or going your way does not honk', async () => {
    const { audio } = await running();
    const truck = entity(6, { kind: 'vehicle', contentId: 'box-truck', z: -40, heading: Math.PI });
    const otherLane = entity(7, { kind: 'vehicle', contentId: 'sedan', z: -40, x: 6, heading: Math.PI });
    const sameWay = entity(8, { kind: 'vehicle', contentId: 'sedan', z: -30, heading: 0 });
    audio.frame(snapshot([player(), truck, otherLane, sameWay]), 0);
    expect(audio.inspect().lastCues.map((c) => c.cue)).toEqual(['truckHorn']);
  });

  it('the siren sounds while a cop is near, and stops when he is gone', async () => {
    const { audio } = await running();
    const cop = entity(9, { faction: 'law', contentId: 'sgt-pruitt', z: 60, speed: 30 });
    audio.frame(snapshot([player(), cop]), 0);
    expect(audio.inspect().sirenLevel).toBeGreaterThan(0);
    audio.frame(snapshot([player()]), 0);
    expect(audio.inspect().sirenLevel).toBe(0);
  });
});

describe('music', () => {
  it('schedules the loop during a race and stops outside it', async () => {
    const { ctx, audio } = await running();
    // The score (a race starts on a station since playtest 2; this is the score's loop).
    audio.setParam('audio.radio', 1);
    audio.frame(snapshot([player()]), 0);
    expect(audio.inspect().musicPlaying).toBe(true);
    const scheduled = ctx.nodes.filter((n) => n.startedAt !== null).length;
    ctx.currentTime += 0.5;
    audio.frame(snapshot([player()]), 0);
    expect(ctx.nodes.filter((n) => n.startedAt !== null).length).toBeGreaterThan(scheduled);
    audio.frame(null, 0);
    expect(audio.inspect().musicPlaying).toBe(false);
  });
});
