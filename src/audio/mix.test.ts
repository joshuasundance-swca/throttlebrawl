// audio-2 (M2.md, the mix): the M2 cues, crash layering, the slow-motion treatment and the fuller
// score, on the fake context. The real graph is rendered offline in tests/e2e/audio-mix.spec.ts.
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import { ceilingShape, KNEE } from './ceiling';
import { CRASH_LAYERS, CUE_PATCHES } from './cue-patches';
import { crashImpact, cueForEvent } from './cues';
import { fakeContextFactory, FakeAudioContext, FakeNode } from './fake-context';
import { AUDIO_TUNING, createAudio } from './index';
import { LAYER_AT, LOOP_BARS, scoreAt } from './music';
import { createSlowmoTreatment, OPEN_HZ, SLOWMO_DEFAULTS } from './slowmo';

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

const player = (over: Partial<EntitySnapshot> = {}) =>
  entity(0, { contentId: 'player', slot: 0, speed: 30, ...over });

function snapshot(entities: EntitySnapshot[], over: Partial<SimSnapshot> = {}): SimSnapshot {
  return {
    tick: 100,
    timeScale: 1,
    entities,
    race: { over: false, routeLength: 2000, finishOrder: [] },
    ...over,
  };
}

const ev = (type: string, actor = 0, target?: number, data: SimEvent['data'] = {}): SimEvent =>
  ({ tick: 10, type, actor, ...(target === undefined ? {} : { target }), data }) as SimEvent;

async function running() {
  const { ctx, create } = fakeContextFactory();
  const audio = createAudio({ createContext: create });
  await audio.resume();
  ctx.currentTime = 1.5;
  return { ctx, audio };
}

/** Sources a patch started, on a fresh fake context. */
function sourcesOf(cue: keyof typeof CUE_PATCHES, impact: number, pitch = 1) {
  const ctx = new FakeAudioContext();
  const out = ctx.createGain();
  CUE_PATCHES[cue](ctx as unknown as BaseAudioContext, out as unknown as AudioNode, 0, 1, { impact, pitch });
  return ctx.nodes.filter((n) => n.kind === 'oscillator' || n.kind === 'bufferSource');
}

describe('M2 cues', () => {
  it('the M2 events that should sound get their own cues', () => {
    expect(cueForEvent(ev('takedown', 0, 1, { kind: 'traffic' }), 0)?.cue).toBe('takedown');
    expect(cueForEvent(ev('slowmoStart', 0, 1), 0)?.cue).toBe('slowIn');
    expect(cueForEvent(ev('slowmoEnd', 0, 1), 0)?.cue).toBe('slowOut');
    expect(cueForEvent(ev('railOver', 2, undefined, { body: 'rider' }), 0)?.cue).toBe('railClang');
    expect(cueForEvent(ev('splash', 2, undefined, { body: 'rider' }), 0)?.cue).toBe('splash');
    expect(cueForEvent(ev('respawn', 0), 0)?.cue).toBe('respawn');
    expect(cueForEvent(ev('style', 0, undefined, { kind: 'nearMiss', points: 50 }), 0)?.cue).toBe('cash');
    expect(cueForEvent(ev('stealWindow', 3, 0, { weapon: 'base:lead-pipe' }), 0)?.cue).toBe('glint');
    expect(cueForEvent(ev('wobble', 0), 0)?.cue).toBe('wobble');
    expect(cueForEvent(ev('nearMiss', 0, 43, { clearanceM: 0.3 }), 0)?.cue).toBe('passBy');
  });

  it('style cash, respawns and close passes sound only for the player', () => {
    expect(cueForEvent(ev('style', 4, undefined, { kind: 'airtime', points: 20 }), 0)).toBeNull();
    expect(cueForEvent(ev('respawn', 4), 0)).toBeNull();
    expect(cueForEvent(ev('nearMiss', 4, 43), 0)).toBeNull();
    // A rival's takedown is still heard (quieter with distance, in index.ts).
    expect(cueForEvent(ev('takedown', 4, 2), 0)?.cue).toBe('takedown');
  });

  it('the siren whoops when a chase starts, not when it ends', () => {
    expect(cueForEvent(ev('siren', 5, undefined, { on: true }), 0)?.cue).toBe('sirenWhoop');
    expect(cueForEvent(ev('siren', 5, undefined, { on: false }), 0)).toBeNull();
  });

  it('get-ups, fist shakes and grudges stay silent (seen and barked, not sounded)', () => {
    for (const t of ['getUp', 'fistShake', 'grudgeNoted']) expect(cueForEvent(ev(t, 2, 0), 0), t).toBeNull();
  });
});

describe('crashes layered by impact', () => {
  it('reads the impact from what the sim reports', () => {
    const scrape = crashImpact(ev('crash', 1, undefined, { cause: 'barrier', speed: 8, impactMps: 3 }), null);
    const wall = crashImpact(ev('crash', 1, undefined, { cause: 'barrier', speed: 38, impactMps: 14 }), null);
    expect(scrape).toBeLessThan(CRASH_LAYERS.roar);
    expect(wall).toBe(1);
    // A big vehicle is a big crash even if the rider was slow; failing data, the rider's speed.
    expect(crashImpact(ev('crash', 1, 7, { cause: 'traffic', hazard: 'big' }), 5)).toBeGreaterThanOrEqual(
      CRASH_LAYERS.debris,
    );
    expect(crashImpact(ev('crash', 1, undefined, { reason: 'knockedOff' }), 40)).toBe(1);
    expect(crashImpact(ev('crash', 1, undefined, { reason: 'knockedOff' }), 4)).toBeLessThan(0.2);
  });

  it('a harder crash stacks more layers, and each layer is louder', () => {
    const light = sourcesOf('crash', 0.1).length;
    const medium = sourcesOf('crash', 0.5).length;
    const heavy = sourcesOf('crash', 1).length;
    expect(light).toBeLessThan(medium);
    expect(medium).toBeLessThan(heavy);
    const peak = (impact: number) => {
      const ctx = new FakeAudioContext();
      CUE_PATCHES.crash(ctx as unknown as BaseAudioContext, ctx.createGain() as unknown as AudioNode, 0, 1, {
        impact,
      });
      // The first envelope is the body thump's.
      const env = ctx.nodes.find((n) => n.kind === 'gain' && n.gain.calls.length > 0 && n !== ctx.nodes[0]);
      return env?.gain.calls[0]?.value ?? 0;
    };
    expect(peak(1)).toBeGreaterThan(peak(0.1));
  });

  it('the crash-size slider changes what plays', async () => {
    const count = async (scale: number) => {
      const { ctx, audio } = await running();
      audio.setParam('audio.crashImpactScale', scale);
      const snap = snapshot([player(), entity(1, { z: -5, speed: 38 })]);
      audio.frame(snap, 0);
      const before = ctx.nodes.length;
      audio.onEvents([ev('crash', 1, undefined, { cause: 'barrier', speed: 38, impactMps: 14 })], snap);
      return ctx.nodes.length - before;
    };
    expect(await count(0.2)).toBeLessThan(await count(1));
  });
});

describe('the slow-motion treatment', () => {
  const inputsOf = (ctx: FakeAudioContext, dest: FakeNode) =>
    ctx.nodes.filter((n) => n.outputs.includes(dest));

  it('sits on the bus inputs: effects through a low-pass, music through a duck', () => {
    const ctx = new FakeAudioContext();
    const fx = ctx.createGain();
    const music = ctx.createGain();
    const t = createSlowmoTreatment(
      ctx as unknown as BaseAudioContext,
      fx as unknown as AudioNode,
      music as unknown as AudioNode,
    );
    expect(inputsOf(ctx, fx).map((n) => n.kind)).toEqual(['biquad']);
    expect(inputsOf(ctx, music).map((n) => n.kind)).toEqual(['gain']);
    expect(t.lowpassTarget()).toBe(OPEN_HZ);
    t.set(true, 2);
    const lp = inputsOf(ctx, fx)[0]!;
    expect(lp.frequency.target).toBe(SLOWMO_DEFAULTS.lowpassHz);
    expect(inputsOf(ctx, music)[0]!.gain.target).toBe(SLOWMO_DEFAULTS.musicDuck);
    expect(t.pitch()).toBeCloseTo(2 ** (SLOWMO_DEFAULTS.pitchSemis / 12));
    t.set(false, 3);
    expect(lp.frequency.target).toBe(OPEN_HZ);
    expect(t.pitch()).toBe(1);
  });

  it('a scripted takedown switches it on with its event and off with the snapshot', async () => {
    const { audio } = await running();
    const rival = entity(1, { z: -3 });
    const snap = snapshot([player(), rival]);
    audio.frame(snap, 0);
    expect(audio.inspect().slowmo.active).toBe(false);
    audio.onEvents(
      [
        ev('hit', 0, 1, { weapon: 'kick' }),
        ev('crash', 1, undefined, { reason: 'knockedOff' }),
        ev('takedown', 0, 1, { kind: 'traffic' }),
        ev('slowmoStart', 0, 1, { ticks: 48, timeScale: 0.3 }),
      ],
      snap,
    );
    const s = audio.inspect();
    expect(s.slowmo.active).toBe(true);
    expect(s.slowmo.lowpassHz).toBe(SLOWMO_DEFAULTS.lowpassHz);
    expect(s.slowmo.musicLevel).toBe(SLOWMO_DEFAULTS.musicDuck);
    expect(s.lastCues.map((c) => c.cue)).toEqual(['kick', 'crash', 'takedown', 'slowIn']);
    // While the snapshot says slow motion runs, it stays on; when it says it ended, it goes off.
    audio.frame(
      snapshot([player(), rival], { timeScale: 0.3, slowmo: { active: true, remainingTicks: 20 } }),
      0,
    );
    expect(audio.inspect().slowmo.active).toBe(true);
    audio.frame(snapshot([player(), rival], { slowmo: { active: false, remainingTicks: 0 } }), 0);
    expect(audio.inspect().slowmo.active).toBe(false);
    expect(audio.inspect().slowmo.lowpassHz).toBe(OPEN_HZ);
  });

  it('pitches the engine and new cues down while it runs', async () => {
    const { ctx, audio } = await running();
    const on = snapshot([player()], { timeScale: 0.3, slowmo: { active: true, remainingTicks: 30 } });
    audio.frame(on, 0);
    const engineDetunes = ctx.nodes
      .filter((n) => n.kind === 'oscillator')
      .map((n) => n.detune.calls.at(-1)?.value ?? 0);
    expect(Math.min(...engineDetunes)).toBeLessThan(-300); // about -500 cents for -5 semitones
    const before = ctx.nodes.length;
    audio.onEvents([ev('hit', 0, 1, { weapon: 'punch' })], on);
    const punchOsc = ctx.nodes.slice(before).find((n) => n.kind === 'oscillator')!;
    expect(punchOsc.frequency.calls[0]!.value).toBeCloseTo(160 * 2 ** (-5 / 12), 3);
  });

  it('its feel numbers are sliders that change the result', async () => {
    const { audio } = await running();
    audio.setParam('audio.slowmoLowpassHz', 1500);
    audio.setParam('audio.slowmoMusicDuck', 0.1);
    audio.setParam('audio.slowmoPitchSemis', -2);
    audio.frame(snapshot([player()], { slowmo: { active: true, remainingTicks: 10 } }), 0);
    const s = audio.inspect().slowmo;
    expect(s.lowpassHz).toBe(1500);
    expect(s.musicLevel).toBe(0.1);
    expect(s.pitch).toBeCloseTo(2 ** (-2 / 12));
    for (const id of [
      'audio.slowmoLowpassHz',
      'audio.slowmoPitchSemis',
      'audio.slowmoMusicDuck',
      'audio.crashImpactScale',
    ]) {
      expect(AUDIO_TUNING.map((d) => d.id)).toContain(id);
    }
  });

  it('switches off when the race ends', async () => {
    const { audio } = await running();
    audio.frame(snapshot([player()]), 0);
    audio.onEvents([ev('slowmoStart', 0, 1)]);
    expect(audio.inspect().slowmo.active).toBe(true);
    audio.frame(null, 0);
    expect(audio.inspect().slowmo.active).toBe(false);
  });
});

describe('the fuller score', () => {
  const layersIn = (bars: number[], intensity: number) => {
    const set = new Set<string>();
    for (const bar of bars)
      for (let s = 0; s < 16; s++) for (const n of scoreAt(bar * 16 + s, intensity)) set.add(n.layer);
    return set;
  };

  it('is sixteen bars with a bridge that differs from the verse and fills back to the top', () => {
    expect(LOOP_BARS).toBe(16);
    const bar = (b: number) => JSON.stringify(Array.from({ length: 16 }, (_, s) => scoreAt(b * 16 + s, 1)));
    expect(bar(8)).not.toBe(bar(0));
    expect(bar(12)).not.toBe(bar(0));
    expect(layersIn([15], 1).has('tom')).toBe(true);
    // It loops: step 256 is step 0.
    expect(scoreAt(LOOP_BARS * 16, 1)).toEqual(scoreAt(0, 1));
  });

  it('adds layers as intensity rises', () => {
    const all = Array.from({ length: 16 }, (_, i) => i);
    const calm = layersIn(all, LAYER_AT.stabs - 0.05);
    const cruising = layersIn(all, LAYER_AT.lead - 0.05);
    const flat = layersIn(all, 1);
    expect(calm.has('stab')).toBe(false);
    expect(calm.has('lead')).toBe(false);
    expect(calm.has('bass')).toBe(true);
    expect(cruising.has('stab')).toBe(true);
    expect(cruising.has('lead')).toBe(false);
    expect(flat.has('lead')).toBe(true);
    const count = (i: number) =>
      all.reduce(
        (n, b) =>
          n + Array.from({ length: 16 }, (_, s) => scoreAt(b * 16 + s, i).length).reduce((a, x) => a + x, 0),
        0,
      );
    expect(count(1)).toBeGreaterThan(count(0.5));
  });
});

describe('the output ceiling', () => {
  it('passes ordinary play unchanged and never lets a pile-up past 1.0', () => {
    for (const x of [0, 0.1, -0.5, KNEE, -KNEE]) expect(ceilingShape(x)).toBe(x);
    let last = 0;
    for (let x = 0; x <= 4; x += 0.01) {
      const y = ceilingShape(x);
      expect(y).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(last);
      expect(ceilingShape(-x)).toBe(-y);
      last = y;
    }
    expect(ceilingShape(2)).toBeGreaterThan(0.99);
  });
});
