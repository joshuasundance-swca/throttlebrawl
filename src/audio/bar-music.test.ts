// Playtest 4 (P4-16, "Duval St should be a party street"): bar music from the open fronts. A party
// zone (a `roadsideZone` with `params.music` naming a style) is a bar's frontage: the Keys' soundscape
// plays that style's phrase, muffled as through a doorway, swelling as the rider comes up to the zone
// and fading as they pass. The director decides (soundscape.ts), the voices make the sound
// (soundscape-voices.ts), and the mixer feeds it the road under the rider (system.ts).
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { FakeAudioContext, fakeContextFactory } from './fake-context';
import {
  BAR_FADE_M,
  BAR_LOOKAHEAD_S,
  BAR_PHRASE_S,
  BAR_STYLES,
  createDirector,
  musicAt,
  type ScapeEvent,
  type ScapeInput,
  type ScapeRoad,
} from './soundscape';
import { createScapeVoices } from './soundscape-voices';
import { createAudio } from './system';

const zone = (id: string, s0: number, s1: number, music: unknown, extra: Record<string, unknown> = {}) => ({
  kind: 'roadsideZone',
  id,
  s0,
  s1,
  params: { music, ...extra },
});
const roadOf = (...features: ReturnType<typeof zone>[]): ScapeRoad => ({
  edges: [{ tags: [], features }, { tags: [] }],
});

describe('musicAt: where the music is, and how loud', () => {
  const road = roadOf(zone('a', 200, 300, 'steel-drum'));

  it('is full inside a music zone and fades to nothing over BAR_FADE_M outside it', () => {
    expect(musicAt(road, 0, 250)).toEqual({ style: 'steel-drum', level: 1 });
    expect(musicAt(road, 0, 200)?.level).toBe(1);
    const half = musicAt(road, 0, 300 + BAR_FADE_M / 2)?.level ?? 0;
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.8);
    expect(musicAt(road, 0, 300 + BAR_FADE_M + 1)).toBeNull();
    expect(musicAt(road, 0, 200 - BAR_FADE_M - 1)).toBeNull();
    // Monotone: the nearer, the louder, on both sides.
    const out = [0, 10, 20, 30, 40, 50].map((m) => musicAt(road, 0, 300 + m)?.level ?? 0);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeLessThan(out[i - 1] as number);
  });

  it('knows only the styles the voices can play, and only a zone that names one', () => {
    expect([...BAR_STYLES].sort()).toEqual(['busker', 'cover-band', 'karaoke', 'steel-drum']);
    for (const bad of ['accordion', 7, null, undefined, ['karaoke']])
      expect(musicAt(roadOf(zone('b', 0, 100, bad)), 0, 50), String(bad)).toBeNull();
    const noMusic: ScapeRoad = {
      edges: [{ tags: [], features: [{ kind: 'roadsideZone', id: 'c', s0: 0, s1: 100 }] }],
    };
    expect(musicAt(noMusic, 0, 50)).toBeNull();
    // Only a roadside zone plays: a billboard with the same params is not a bar.
    const sign: ScapeRoad = {
      edges: [
        {
          tags: [],
          features: [{ kind: 'billboard', id: 'd', s0: 0, s1: 100, params: { music: 'karaoke' } }],
        },
      ],
    };
    expect(musicAt(sign, 0, 50)).toBeNull();
  });

  it('the loudest zone wins where two reach, and an unknown road is silent', () => {
    const two = roadOf(zone('near', 100, 200, 'karaoke'), zone('far', 230, 330, 'cover-band'));
    expect(musicAt(two, 0, 150)).toEqual({ style: 'karaoke', level: 1 });
    expect(musicAt(two, 0, 280)).toEqual({ style: 'cover-band', level: 1 });
    expect(musicAt(two, 0, 215)?.level).toBeGreaterThan(0.5);
    expect(musicAt(two, 1, 150)).toBeNull();
    expect(musicAt(two, 9, 150)).toBeNull();
    expect(musicAt(null, 0, 150)).toBeNull();
  });
});

describe('the director: a phrase after phrase, in time', () => {
  const input = (over: Partial<ScapeInput> = {}): ScapeInput => ({
    t: 0,
    region: 'keys',
    speedMps: 20,
    edge: 0,
    s: 250,
    grounded: true,
    tags: new Set(['town']),
    near: [],
    music: { style: 'cover-band', level: 1 },
    ...over,
  });
  const barsOf = (es: readonly ScapeEvent[]) =>
    es.filter((e): e is Extract<ScapeEvent, { kind: 'barMusic' }> => e.kind === 'barMusic');
  const heard = (over: Partial<ScapeInput>, seconds: number, seed = 3) => {
    const d = createDirector(seed);
    const out: ScapeEvent[] = [];
    for (let t = 0; t < seconds; t += 1 / 60) out.push(...d.step(input({ ...over, t })).events);
    return barsOf(out);
  };

  it('chains the phrases exactly BAR_PHRASE_S apart, scheduled a little ahead, so the beat never slips', () => {
    const bars = heard({}, 12);
    expect(bars.length).toBeGreaterThanOrEqual(Math.floor(12 / BAR_PHRASE_S));
    for (let i = 1; i < bars.length; i++)
      expect((bars[i] as { at: number }).at - (bars[i - 1] as { at: number }).at).toBeCloseTo(
        BAR_PHRASE_S,
        6,
      );
    // Each is handed over no earlier than the lookahead before it starts, so it can be scheduled on the clock.
    expect((bars[0] as { at: number }).at).toBeLessThanOrEqual(BAR_LOOKAHEAD_S + 1e-9);
    expect(new Set(bars.map((b) => b.bar)).size).toBe(bars.length);
  });

  it('plays the style and the level it is given, and is quiet when the zone is out of earshot', () => {
    const loud = heard({ music: { style: 'karaoke', level: 1 } }, 6);
    expect(loud.every((b) => b.style === 'karaoke')).toBe(true);
    const soft = heard({ music: { style: 'karaoke', level: 0.4 } }, 6);
    expect((soft[0] as { level: number }).level).toBeLessThan((loud[0] as { level: number }).level);
    expect(heard({ music: { style: 'karaoke', level: 0.02 } }, 6)).toHaveLength(0);
    expect(heard({ music: null }, 6)).toHaveLength(0);
    const { music: _none, ...bare } = input();
    expect(barsOf(createDirector(3).step(bare as ScapeInput).events)).toHaveLength(0);
  });

  it('is wherever a zone names music (any region), but not with no region, and not in the air', () => {
    // Playtest 4 run B: a busker plays at Portland's square, so the zone's data decides, not the region.
    expect(heard({ region: 'sf' }, 6).length).toBeGreaterThan(0);
    expect(heard({ region: 'pnw' }, 6).length).toBeGreaterThan(0);
    expect(heard({ region: null }, 6)).toHaveLength(0);
    expect(heard({ grounded: false }, 6)).toHaveLength(0);
  });

  it('starts again on the clock after a gap (a respawn, a pause), never as a burst of catch-up phrases', () => {
    const d = createDirector(3);
    let out: ScapeEvent[] = [];
    for (let t = 0; t < 3; t += 1 / 60) out.push(...d.step(input({ t })).events);
    out = [];
    // The rider is silent for a minute, then back in a zone.
    out.push(...d.step(input({ t: 63 })).events);
    out.push(...d.step(input({ t: 63.016 })).events);
    const bars = barsOf(out);
    expect(bars.length).toBeLessThanOrEqual(1);
    if (bars[0]) expect(bars[0].at).toBeGreaterThanOrEqual(63 - 1e-9);
  });

  it('gives the same phrases for the same seed and ride', () => {
    expect(heard({}, 9, 5)).toEqual(heard({}, 9, 5));
  });
});

describe('the voices: a doorway muffles each style', () => {
  const make = () => {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const v = createScapeVoices(ctx as unknown as BaseAudioContext, out as unknown as AudioNode);
    return { ctx, v };
  };
  const bar = (style: (typeof BAR_STYLES)[number], at: number, n = 0): ScapeEvent => ({
    kind: 'barMusic',
    style,
    level: 1,
    at,
    bar: n,
  });

  it('every style makes sources that start inside its phrase and are scheduled to stop', () => {
    for (const style of BAR_STYLES) {
      const { ctx, v } = make();
      const before = ctx.nodes.length;
      expect(v.play(bar(style, 10), 9.9, 1), style).toBe(true);
      const sources = ctx.nodes
        .slice(before)
        .filter((n) => n.kind === 'oscillator' || n.kind === 'bufferSource');
      expect(sources.length, style).toBeGreaterThan(4);
      for (const s of sources) {
        expect(s.startedAt, style).not.toBeNull();
        // Scheduled on the phrase's own clock (`at`), not on the frame it was handed over in.
        expect(s.startedAt!, style).toBeGreaterThanOrEqual(10 - 1e-9);
        expect(s.startedAt!, style).toBeLessThan(10 + BAR_PHRASE_S);
        expect(s.stoppedAt!, style).toBeGreaterThan(s.startedAt!);
      }
    }
  });

  it('the styles sound different, and a later phrase of one style differs from the first', () => {
    const shape = (style: (typeof BAR_STYLES)[number], n: number) => {
      const { ctx, v } = make();
      v.play(bar(style, 0, n), 0, 1);
      return ctx.nodes
        .filter((x) => x.kind === 'oscillator')
        .map((x) => `${x.type}${Math.round(x.frequency.value)}@${x.startedAt}`)
        .join(' ');
    };
    expect(new Set(BAR_STYLES.map((s) => shape(s, 0))).size).toBe(BAR_STYLES.length);
    for (const s of BAR_STYLES) expect(shape(s, 1), s).not.toBe(shape(s, 0));
  });

  it('its level is the gain it is given, scaled: a quiet one makes quieter tones', () => {
    const peak = (level: number) => {
      const { ctx, v } = make();
      v.play({ ...(bar('cover-band', 0) as Extract<ScapeEvent, { kind: 'barMusic' }>), level }, 0, 1);
      return Math.max(
        ...ctx.nodes
          .filter((n) => n.kind === 'gain')
          .flatMap((n) => n.gain.calls.map((c) => Math.abs(c.value)))
          .filter(Number.isFinite),
      );
    };
    expect(peak(0.3)).toBeLessThan(peak(1));
  });

  it('stays inside the event cap: one phrase is one event', () => {
    const { v } = make();
    v.play(bar('steel-drum', 0), 0, 1);
    expect(v.active()).toBe(1);
  });
});

describe('the mixer plays the bars of a party street', () => {
  const road = roadOf(zone('party', 400, 520, 'cover-band'));
  const me = (s: number): EntitySnapshot => ({
    id: 0,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 20,
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
  });
  const snap = (e: EntitySnapshot): SimSnapshot => ({
    tick: 1,
    timeScale: 1,
    entities: [e],
    race: { over: false, routeLength: 2000, finishOrder: [] },
  });
  async function ride(regionId: string, from: number, to: number, slider = 1) {
    const { ctx, create } = fakeContextFactory();
    const audio = createAudio({ createContext: create, radioKeys: null, barkEvents: null });
    audio.setRegion(regionId);
    audio.setRoad(road);
    audio.setParam('audio.soundscape', slider);
    await audio.resume();
    let s = from;
    for (let t = 2; s < to; t += 1 / 60) {
      ctx.currentTime = t;
      audio.frame(snap(me(s)), 0);
      s += 20 / 60;
    }
    return audio.inspect().soundscape.played.filter((e) => e.kind === 'barMusic');
  }

  it('the Keys: the bar plays as the rider comes up to the zone and not on the empty road far from it', async () => {
    expect((await ride('base:florida-keys', 410, 500)).length).toBeGreaterThanOrEqual(3);
    expect(await ride('base:florida-keys', 20, 200)).toHaveLength(0);
  });

  it('is louder inside the zone than at the edge of earshot', async () => {
    const near = await ride('base:florida-keys', 440, 470);
    const edge = await ride('base:florida-keys', 400 - BAR_FADE_M + 2, 400 - BAR_FADE_M + 8);
    expect(near.length).toBeGreaterThan(0);
    expect(
      edge.length === 0 || (edge[0] as { level: number }).level < (near[0] as { level: number }).level,
    ).toBe(true);
  });

  it('another region plays a zone that names music too, and the regional-sounds slider silences it', async () => {
    expect((await ride('region-sf:san-francisco', 410, 500)).length).toBeGreaterThanOrEqual(3);
    expect(await ride('base:florida-keys', 410, 500, 0)).toHaveLength(0);
  });
});
