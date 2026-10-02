// The regional soundscape (run W-Q audio): the director's decisions from the road under the rider,
// the voices on the fake context, and the mixer wiring. The real graph renders offline in
// tests/e2e/audio-soundscape.spec.ts.
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { FakeAudioContext, fakeContextFactory } from './fake-context';
import { AUDIO_TUNING, createAudio } from './index';
import {
  createDirector,
  JOINT_SPACING_M,
  scapeRegionOf,
  tagsAt,
  WHEELBASE_M,
  type ScapeEvent,
  type ScapeInput,
  type ScapeRoad,
} from './soundscape';
import { createScapeVoices, dropletBuffer, MAX_SCAPE_EVENTS } from './soundscape-voices';

const tags = (...t: string[]) => new Set(t);
const input = (over: Partial<ScapeInput> = {}): ScapeInput => ({
  t: 0,
  region: 'keys',
  speedMps: 30,
  edge: 0,
  s: 0,
  grounded: true,
  tags: tags('bridge'),
  near: [],
  ...over,
});
const kinds = (es: readonly ScapeEvent[]) => es.map((e) => e.kind);
const levelOf = (e: ScapeEvent | undefined) => (e as { level: number }).level;

/** Rides `from`..`to` metres at `speed` in 60 Hz frames, returning every event heard. */
function ride(
  d: ReturnType<typeof createDirector>,
  over: Partial<ScapeInput>,
  from: number,
  to: number,
  speed: number,
) {
  const out: ScapeEvent[] = [];
  const dt = 1 / 60;
  let s = from;
  let t = 0;
  while (s < to) {
    out.push(...d.step(input({ ...over, t, s, speedMps: speed })).events);
    s += speed * dt;
    t += dt;
  }
  return out;
}

describe('scapeRegionOf', () => {
  it('names the three regions, qualified or not', () => {
    expect(scapeRegionOf('base:florida-keys')).toBe('keys');
    expect(scapeRegionOf('region-pnw:pacific-northwest')).toBe('pnw');
    expect(scapeRegionOf('region-sf:san-francisco')).toBe('sf');
    expect(scapeRegionOf('florida-keys')).toBe('keys');
    expect(scapeRegionOf(null)).toBeNull();
    expect(scapeRegionOf('mars')).toBeNull();
  });
});

describe('tagsAt', () => {
  const road: ScapeRoad = {
    edges: [
      {
        tags: [
          { s0: 0, s1: 100, tag: 'forest' },
          { s0: 50, s1: 80, tag: 'bridge' },
        ],
      },
      { tags: [] },
    ],
  };
  it('lists the tags over s, any side, and nothing off the map', () => {
    expect([...tagsAt(road, 0, 60)].sort()).toEqual(['bridge', 'forest']);
    expect([...tagsAt(road, 0, 90)]).toEqual(['forest']);
    expect(tagsAt(road, 0, 101).size).toBe(0);
    expect(tagsAt(road, 1, 5).size).toBe(0);
    expect(tagsAt(road, 9, 5).size).toBe(0);
    expect(tagsAt(null, 0, 5).size).toBe(0);
  });
});

describe('the Keys: bridge joints that tell your speed', () => {
  const joints = (speed: number, over: Partial<ScapeInput> = {}) => {
    const d = createDirector(1);
    d.step(input({ ...over, s: 0 }));
    return ride(d, over, 0, 240, speed).filter(
      (e): e is Extract<ScapeEvent, { kind: 'joint' }> => e.kind === 'joint',
    );
  };

  it('one thump per joint: 240 m is about 19 joints at any speed', () => {
    for (const v of [15, 30, 45]) {
      const n = joints(v).length;
      expect(Math.abs(n - 240 / JOINT_SPACING_M), `at ${v} m/s`).toBeLessThanOrEqual(1);
    }
  });

  it('the rate tells the speed: twice the speed, twice the thumps a second', () => {
    const rate = (v: number) => {
      const d = createDirector(1);
      d.step(input({ s: 0 }));
      let t = 0;
      let count = 0;
      let s = 0;
      while (t < 12) {
        count += d.step(input({ t, s, speedMps: v })).events.filter((e) => e.kind === 'joint').length;
        s += v / 60;
        t += 1 / 60;
      }
      return count / 12;
    };
    const slow = rate(15);
    const fast = rate(30);
    expect(fast / slow).toBeGreaterThan(1.8);
    expect(fast / slow).toBeLessThan(2.2);
    expect(fast).toBeCloseTo(30 / JOINT_SPACING_M, 0);
  });

  it('the wheel gap shrinks and the thump swells as you go faster', () => {
    const slow = joints(12)[0]!;
    const fast = joints(42)[0]!;
    expect(slow.wheelGapS).toBeCloseTo(WHEELBASE_M / 12, 3);
    expect(fast.wheelGapS).toBeLessThan(slow.wheelGapS);
    expect(fast.level).toBeGreaterThan(slow.level);
  });

  it('no joints off a bridge, in the air or standing', () => {
    expect(joints(30, { tags: tags('causeway') })).toHaveLength(0);
    expect(joints(30, { grounded: false })).toHaveLength(0);
    expect(joints(1.5)).toHaveLength(0);
  });

  it('a jump in s (a respawn, a handover) or a new edge is not a run of joints', () => {
    const d = createDirector(1);
    d.step(input({ s: 5 }));
    expect(kinds(d.step(input({ t: 0.016, s: 605 })).events)).not.toContain('joint');
    d.step(input({ t: 0.03, s: 10, edge: 3 }));
    expect(kinds(d.step(input({ t: 0.05, s: 11, edge: 3 })).events)).not.toContain('joint');
  });

  it('works running toward lower s (an oncoming lane)', () => {
    const d = createDirector(1);
    let s = 240;
    let n = 0;
    d.step(input({ s }));
    for (let t = 0; s > 0; t += 1 / 60) {
      n += d.step(input({ t, s, speedMps: 25 })).events.filter((e) => e.kind === 'joint').length;
      s -= 25 / 60;
    }
    expect(Math.abs(n - 240 / JOINT_SPACING_M)).toBeLessThanOrEqual(1);
  });
});

describe('the Keys: gulls and halyards', () => {
  const heard = (over: Partial<ScapeInput>, seconds = 120) => {
    const d = createDirector(7);
    const out: ScapeEvent[] = [];
    for (let t = 0; t < seconds; t += 0.25)
      out.push(...d.step(input({ ...over, t, s: 0, speedMps: 0 })).events);
    return out;
  };

  it('gulls cry over the water, every 5 to 13 seconds', () => {
    const n = heard({ tags: tags('water-open') }).filter((e) => e.kind === 'gull').length;
    expect(n).toBeGreaterThanOrEqual(120 / 15);
    expect(n).toBeLessThanOrEqual(120 / 5 + 1);
  });

  it('and not inland', () => {
    expect(heard({ tags: tags('town') }).filter((e) => e.kind === 'gull')).toHaveLength(0);
  });

  it('halyards clink only in a marina', () => {
    expect(heard({ tags: tags('marina') }).filter((e) => e.kind === 'halyard').length).toBeGreaterThan(5);
    expect(heard({ tags: tags('water-open') }).filter((e) => e.kind === 'halyard')).toHaveLength(0);
  });
});

describe('the Pacific Northwest: rain and the engine brake', () => {
  it('rain on the helmet is always there and harder with speed, softer off the bike', () => {
    const rain = (over: Partial<ScapeInput>) =>
      createDirector(1).step(input({ region: 'pnw', ...over })).rain;
    expect(rain({ speedMps: 0 })).toBeGreaterThan(0.3);
    expect(rain({ speedMps: 35 })).toBeGreaterThan(rain({ speedMps: 5 }));
    expect(rain({ speedMps: 35 })).toBeLessThanOrEqual(1);
    expect(rain({ grounded: false })).toBeLessThan(rain({ speedMps: 0 }));
  });

  it('no rain in the Keys or San Francisco', () => {
    for (const region of ['keys', 'sf'] as const) {
      expect(createDirector(1).step(input({ region, speedMps: 30 })).rain).toBe(0);
    }
  });

  const truck = (distanceM: number, id = 5) => ({
    id,
    contentId: 'region-pnw:log-truck',
    distanceM,
    tags: tags(),
  });

  it('a near log truck brakes once, louder the nearer, and not again for 30 seconds', () => {
    const d = createDirector(2);
    const first = d.step(input({ region: 'pnw', t: 0, near: [truck(30)] })).events;
    const brake = first.find((e) => e.kind === 'engineBrake');
    expect(brake).toMatchObject({ kind: 'engineBrake', distant: false });
    expect(kinds(d.step(input({ region: 'pnw', t: 10, near: [truck(30)] })).events)).not.toContain(
      'engineBrake',
    );
    expect(kinds(d.step(input({ region: 'pnw', t: 31, near: [truck(30)] })).events)).toContain('engineBrake');
    const far = createDirector(2)
      .step(input({ region: 'pnw', t: 0, near: [truck(100)] }))
      .events.find((e) => e.kind === 'engineBrake');
    expect(levelOf(far)).toBeLessThan(levelOf(brake));
  });

  it('a truck out of range, or any other vehicle, does not', () => {
    const d = createDirector(2);
    const far = d.step(input({ region: 'pnw', near: [truck(400)] }));
    expect(kinds(far.events)).not.toContain('engineBrake');
    const other = d.step(input({ region: 'pnw', near: [{ ...truck(20, 6), contentId: 'base:pickup' }] }));
    expect(kinds(other.events)).not.toContain('engineBrake');
  });

  it('now and then one is heard up the road, in the forest only', () => {
    const run = (t: ReadonlySet<string>) => {
      const d = createDirector(3);
      const out: ScapeEvent[] = [];
      for (let time = 0; time < 300; time += 0.5) {
        out.push(...d.step(input({ region: 'pnw', t: time, tags: t })).events);
      }
      return out.filter((e) => e.kind === 'engineBrake');
    };
    const forest = run(tags('forest'));
    expect(forest.length).toBeGreaterThanOrEqual(5);
    expect(forest.every((e) => e.kind === 'engineBrake' && e.distant)).toBe(true);
    expect(run(tags('town'))).toHaveLength(0);
  });
});

describe('San Francisco: the foghorn and the cable-car bells', () => {
  const run = (over: Partial<ScapeInput>, seconds = 240) => {
    const d = createDirector(4);
    const out: ScapeEvent[] = [];
    for (let t = 0; t < seconds; t += 0.5) out.push(...d.step(input({ region: 'sf', t, ...over })).events);
    return out;
  };

  it('the foghorn sounds every so often, more often in the fog and louder', () => {
    const clear = run({ tags: tags('row-houses') }).filter((e) => e.kind === 'foghorn');
    const fog = run({ tags: tags('fog') }).filter((e) => e.kind === 'foghorn');
    expect(clear.length).toBeGreaterThanOrEqual(5);
    expect(fog.length).toBeGreaterThan(clear.length);
    const avg = (es: ScapeEvent[]) => es.reduce((a, e) => a + levelOf(e), 0) / es.length;
    expect(avg(fog)).toBeGreaterThan(avg(clear));
  });

  it('bells ring only on a cable line', () => {
    expect(run({ tags: tags('row-houses') }).filter((e) => e.kind === 'bell')).toHaveLength(0);
    expect(run({ tags: tags('cable-line') }).filter((e) => e.kind === 'bell').length).toBeGreaterThan(10);
  });

  const car = (over: Partial<{ id: number; distanceM: number; tags: ReadonlySet<string> }> = {}) => ({
    id: 8,
    contentId: 'region-sf:cable-car',
    distanceM: 40,
    tags: tags('cable-line'),
    ...over,
  });

  it('a cable car on a cable line rings for its distance; one that is not on one never does', () => {
    const on = createDirector(4).step(
      input({ region: 'sf', tags: tags('row-houses'), near: [car()] }),
    ).events;
    expect(kinds(on)).toContain('bell');
    const strayed = createDirector(4).step(
      input({ region: 'sf', tags: tags('forest'), near: [car({ tags: tags('forest') })] }),
    );
    expect(kinds(strayed.events)).not.toContain('bell');
    const farOff = createDirector(4).step(input({ region: 'sf', near: [car({ distanceM: 300 })] }));
    expect(kinds(farOff.events)).not.toContain('bell');
    const bell = (d: number) =>
      createDirector(4)
        .step(input({ region: 'sf', tags: tags('row-houses'), near: [car({ distanceM: d })] }))
        .events.find((e) => e.kind === 'bell');
    expect(levelOf(bell(10))).toBeGreaterThan(levelOf(bell(80)));
  });
});

describe('the director is deterministic and silent without a region', () => {
  it('the same seed and ride give the same sounds', () => {
    const go = () => ride(createDirector(9), { tags: tags('bridge', 'water-open') }, 0, 600, 30);
    expect(go()).toEqual(go());
  });
  it('different seeds differ', () => {
    const a = ride(createDirector(9), { tags: tags('water-open') }, 0, 3000, 30);
    const b = ride(createDirector(10), { tags: tags('water-open') }, 0, 3000, 30);
    expect(a).not.toEqual(b);
  });
  it('no region, no sound', () => {
    expect(createDirector(1).step(input({ region: null }))).toEqual({ events: [], rain: 0 });
  });
});

describe('the voices', () => {
  const make = () => {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const v = createScapeVoices(ctx as unknown as BaseAudioContext, out as unknown as AudioNode);
    return { ctx, out, v };
  };
  const events: ScapeEvent[] = [
    { kind: 'joint', level: 1, wheelGapS: 0.06 },
    { kind: 'gull', level: 1, pitch: 1 },
    { kind: 'halyard', level: 1, pitch: 1 },
    { kind: 'engineBrake', level: 1, distant: false },
    { kind: 'engineBrake', level: 0.3, distant: true },
    { kind: 'foghorn', level: 1 },
    { kind: 'bell', level: 1, strikes: 2 },
  ];

  it('every event makes sources, all of which are scheduled to stop', () => {
    for (const e of events) {
      const { ctx, v } = make();
      const before = ctx.nodes.length;
      expect(v.play(e, 1, 1), e.kind).toBe(true);
      const sources = ctx.nodes
        .slice(before)
        .filter((n) => n.kind === 'oscillator' || n.kind === 'bufferSource');
      expect(sources.length, e.kind).toBeGreaterThan(0);
      for (const s of sources) {
        expect(s.startedAt, e.kind).not.toBeNull();
        expect(s.stoppedAt, e.kind).not.toBeNull();
        expect(s.stoppedAt!, e.kind).toBeGreaterThan(s.startedAt!);
      }
    }
  });

  it('a bell strikes `strikes` times and a joint thumps twice', () => {
    const { ctx, v } = make();
    v.play({ kind: 'bell', level: 1, strikes: 3 }, 1, 1);
    const tones = ctx.nodes.filter((n) => n.kind === 'oscillator');
    expect(new Set(tones.map((n) => n.startedAt)).size).toBe(3);
    const j = make();
    j.v.play({ kind: 'joint', level: 1, wheelGapS: 0.07 }, 2, 1);
    const starts = [
      ...new Set(j.ctx.nodes.filter((n) => n.startedAt !== null).map((n) => n.startedAt)),
    ].sort();
    expect(starts).toEqual([2, 2.07]);
  });

  it('the foghorn is two notes, the second lower', () => {
    const { ctx, v } = make();
    v.play({ kind: 'foghorn', level: 1 }, 5, 1);
    const saws = ctx.nodes.filter((n) => n.kind === 'oscillator' && n.type === 'sawtooth');
    expect(saws).toHaveLength(2);
    expect(saws[1]!.frequency.value).toBeLessThan(saws[0]!.frequency.value);
    expect(saws[1]!.startedAt!).toBeGreaterThan(saws[0]!.startedAt! + 1.5);
  });

  it('a silent or past-the-cap event is dropped, and a stopped voice makes nothing', () => {
    const { ctx, v } = make();
    expect(v.play(events[0]!, 1, 0)).toBe(false);
    for (let k = 0; k < MAX_SCAPE_EVENTS; k++) expect(v.play(events[0]!, 1, 1)).toBe(true);
    expect(v.active()).toBe(MAX_SCAPE_EVENTS);
    expect(v.play(events[0]!, 1, 1)).toBe(false);
    // A source ending frees a place.
    ctx.nodes.find((n) => n.onended !== null)!.end();
    expect(v.active()).toBe(MAX_SCAPE_EVENTS - 1);
    v.stop();
    expect(v.play(events[0]!, 1, 1)).toBe(false);
  });

  it('the rain starts on first use and follows its level', () => {
    const { ctx, v } = make();
    v.setRain(0);
    expect(ctx.running('bufferSource')).toHaveLength(0);
    v.setRain(0.7);
    expect(v.rainLevel()).toBe(0.7);
    expect(ctx.running('bufferSource')).toHaveLength(2);
    v.setRain(0.9);
    expect(ctx.running('bufferSource')).toHaveLength(2);
    v.setRain(-3);
    expect(v.rainLevel()).toBe(0);
  });

  it('the droplet buffer is sparse, bounded and seeded', () => {
    const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
    const a = dropletBuffer(ctx).getChannelData(0);
    const b = dropletBuffer(ctx).getChannelData(0);
    expect(a).toEqual(b);
    expect(a.length).toBe(48000 * 2);
    const peak = Math.max(...a.map(Math.abs));
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(3);
    const quiet = a.filter((x) => Math.abs(x) < 0.001).length / a.length;
    expect(quiet).toBeGreaterThan(0.5);
  });
});

// --- The mixer ---------------------------------------------------------------------------------

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
    contentId: 'player',
    name: 'x',
    faction: 'rider',
    slot: 0,
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
const snap = (entities: EntitySnapshot[], timeScale = 1): SimSnapshot => ({
  tick: 1,
  timeScale,
  entities,
  race: { over: false, routeLength: 2000, finishOrder: [] },
});

describe('the mixer plays the soundscape', () => {
  const road: ScapeRoad = {
    edges: [
      { tags: [{ s0: 0, s1: 5000, tag: 'bridge' }] },
      { tags: [{ s0: 0, s1: 5000, tag: 'cable-line' }] },
    ],
  };
  async function started(regionId: string | null, withRoad: ScapeRoad | null = road) {
    const { ctx, create } = fakeContextFactory();
    const audio = createAudio({ createContext: create, radioKeys: null, barkEvents: null });
    audio.setRegion(regionId);
    audio.setRoad(withRoad);
    await audio.resume();
    return { ctx, audio };
  }
  /** Drives frames over `metres` at 30 m/s on `edge`, advancing the fake audio clock. */
  function drive(
    h: Awaited<ReturnType<typeof started>>,
    metres: number,
    edge = 0,
    others: EntitySnapshot[] = [],
  ) {
    let s = 10;
    for (let t = 2; s < 10 + metres; t += 1 / 60) {
      h.ctx.currentTime = t;
      const me = entity(0, { speed: 30, road: { edge, s, d: 0, h: 0, dir: 1, yaw: 0 } });
      h.audio.frame(snap([me, ...others]), 0);
      s += 0.5;
    }
  }

  it('the Keys: joints on a bridge, one per 12.2 m', async () => {
    const h = await started('base:florida-keys');
    drive(h, 244);
    const joints = h.audio.inspect().soundscape.played.filter((e) => e.kind === 'joint');
    expect(joints.length).toBeGreaterThanOrEqual(19);
    expect(h.audio.inspect().soundscape.region).toBe('keys');
  });

  it('the slider silences it, and no road means no regional sound', async () => {
    const off = await started('base:florida-keys');
    off.audio.setParam('audio.soundscape', 0);
    drive(off, 244);
    expect(off.audio.inspect().soundscape.played).toHaveLength(0);
    expect(off.audio.inspect().soundscape.region).toBeNull();
    const none = await started('base:florida-keys', null);
    drive(none, 244);
    expect(none.audio.inspect().soundscape.played.filter((e) => e.kind === 'joint')).toHaveLength(0);
  });

  it('the Pacific Northwest: rain, louder at speed, silent when the race is left', async () => {
    const h = await started('region-pnw:pacific-northwest');
    drive(h, 20);
    expect(h.audio.inspect().soundscape.rain).toBeGreaterThan(0.5);
    h.audio.frame(null, 0);
    expect(h.audio.inspect().soundscape.rain).toBe(0);
  });

  it('San Francisco: a cable car on a cable line rings its bell, and the same car off one does not', async () => {
    const car = entity(9, {
      kind: 'vehicle',
      contentId: 'region-sf:cable-car',
      slot: -1,
      road: { edge: 1, s: 40, d: 0, h: 0, dir: 1, yaw: 0 },
      z: -30,
    });
    const on = await started('region-sf:san-francisco');
    drive(on, 12, 1, [car]);
    expect(on.audio.inspect().soundscape.played.some((e) => e.kind === 'bell')).toBe(true);
    const off = await started('region-sf:san-francisco', {
      edges: [{ tags: [] }, { tags: [{ s0: 0, s1: 5000, tag: 'forest' }] }],
    });
    drive(off, 12, 1, [car]);
    expect(off.audio.inspect().soundscape.played.some((e) => e.kind === 'bell')).toBe(false);
  });

  it('declares one slider', () => {
    const d = AUDIO_TUNING.find((p) => p.id === 'audio.soundscape');
    expect(d).toMatchObject({ default: 1, min: 0, affectsSim: false });
  });
});
