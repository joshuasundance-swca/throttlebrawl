import { describe, expect, it } from 'vitest';
import park from '../../packs/region-clinton/regions/clinton-iowa/roads/osm-clinton-eagle-entry.json';
import rural from '../../packs/region-clinton/regions/clinton-iowa/roads/osm-clinton-county-180th.json';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { FakeAudioContext, fakeContextFactory } from './fake-context';
import {
  createDirector,
  gustShape,
  NO_BEDS,
  scapeRegionOf,
  tagsAt,
  type ScapeEvent,
  type ScapeInput,
  type ScapeRoad,
} from './soundscape';
import { BED_IDLE_S, createScapeVoices, MAX_SCAPE_EVENTS } from './soundscape-voices';
import { createAudio } from './system';

const road: ScapeRoad = { edges: [park, rural] };
const position = (edge: number, tag: string) => {
  const interval = road.edges[edge]!.tags.find((t) => t.tag === tag)!;
  return (interval.s0 + interval.s1) / 2;
};
const parkS = position(0, 'iowa-park');
const ruralS = position(1, 'rural');
const input = (over: Partial<ScapeInput> = {}): ScapeInput => ({
  t: 0,
  region: scapeRegionOf('clinton-iowa'),
  speedMps: 0,
  edge: 0,
  s: parkS,
  grounded: true,
  tags: tagsAt(road, 0, parkS),
  near: [],
  ...over,
});
const rustles = (frame: ReturnType<ReturnType<typeof createDirector>['step']>) =>
  frame.events.filter((e) => e.kind === 'leafRustle');

describe('Iowa place director reads the shipped road tags', () => {
  it('maps exact qualified and unqualified Iowa IDs, retaining old region controls', () => {
    expect(scapeRegionOf('clinton-iowa')).toBe('iowa');
    expect(scapeRegionOf('region-clinton:clinton-iowa')).toBe('iowa');
    for (const id of [null, '', 'iowa', 'clinton-iowa-other', 'other-clinton-iowa'])
      expect(scapeRegionOf(id)).toBeNull();
    expect(scapeRegionOf('base:florida-keys')).toBe('keys');
    expect(scapeRegionOf('region-pnw:pacific-northwest')).toBe('pnw');
    expect(scapeRegionOf('region-sf:san-francisco')).toBe('sf');
  });

  it('keeps rural breeze at rest and gives overlapping park tags precedence', () => {
    expect(input().tags.has('rural')).toBe(true);
    for (const t of [0, 0.3, 3, 8, 19, 40])
      for (const speedMps of [0, 30]) {
        const p = createDirector().step(input({ t, speedMps }));
        const r = createDirector().step(input({ t, speedMps, tags: tagsAt(road, 1, ruralS) }));
        expect(p.beds.gust).toBeGreaterThan(0);
        expect(p.beds.gust).toBeCloseTo(0.08 * gustShape(t));
        expect(r.beds.gust).toBeCloseTo(0.22 * gustShape(t));
        expect(p.beds.gust).toBeLessThan(r.beds.gust);
        expect(p.beds.gust).toBeLessThanOrEqual(0.08);
        expect(r.beds.gust).toBeLessThanOrEqual(0.22);
        expect({ ...p.beds, gust: 0 }).toEqual(NO_BEDS);
        expect(p.rain).toBe(0);
      }
  });

  it('requires region and an in-range tag, preserving other regions own ambience', () => {
    for (const tags of [
      tagsAt(null, 0, parkS),
      tagsAt(road, 99, parkS),
      tagsAt(road, 0, -1),
      tagsAt(road, 0, park.lengthM + 1),
      tagsAt(road, 1, ruralS),
    ]) {
      const d = createDirector();
      for (const t of [0, 7, 40, 1000]) {
        const f = d.step(input({ tags, t }));
        expect(rustles(f)).toEqual([]);
        if (!tags.has('rural')) expect(f.beds).toEqual(NO_BEDS);
      }
    }
    for (const region of [null, 'keys', 'pnw', 'sf'] as const) {
      const d = createDirector();
      d.step(input({ region }));
      const f = d.step(input({ region, t: 40 }));
      expect(rustles(f)).toEqual([]);
      expect(f.beds.gust).toBe(0);
      if (region === 'pnw') expect(f.rain).toBeGreaterThan(0);
      if (region === 'sf') expect(f.events.some((e) => e.kind === 'foghorn')).toBe(true);
    }
  });

  it('spaces rustles by the audio clock, repeats seeds, and emits once after a long jump', () => {
    const run = () => {
      const d = createDirector(41);
      const heard: { t: number; event: ScapeEvent }[] = [];
      for (let tick = 0; tick <= 1200; tick++) {
        const t = tick / 10;
        for (const event of rustles(d.step(input({ t })))) heard.push({ t, event });
      }
      return heard;
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a[0]!.t).toBeGreaterThanOrEqual(2);
    expect(a[0]!.t).toBeLessThanOrEqual(6.1);
    for (let k = 0; k < a.length; k++) {
      expect(a[k]!.event.level).toBeGreaterThanOrEqual(0.12);
      expect(a[k]!.event.level).toBeLessThanOrEqual(0.18);
      if (k) {
        const gap = a[k]!.t - a[k - 1]!.t;
        expect(gap).toBeGreaterThanOrEqual(10);
        expect(gap).toBeLessThanOrEqual(22.1);
      }
    }
    const d = createDirector();
    d.step(input());
    expect(rustles(d.step(input({ t: 1000 })))).toHaveLength(1);
    expect(rustles(d.step(input({ t: 1000 })))).toEqual([]);
  });

  it('rearms off-tag expiry, reset and region changes without a return burst', () => {
    const d = createDirector();
    d.step(input());
    expect(rustles(d.step(input({ t: 100, tags: new Set() })))).toEqual([]);
    expect(rustles(d.step(input({ t: 100 })))).toEqual([]);
    expect(rustles(d.step(input({ t: 101.9 })))).toEqual([]);
    expect(rustles(d.step(input({ t: 107 })))).toHaveLength(1);
    d.reset();
    expect(rustles(d.step(input({ t: 1000 })))).toEqual([]);
    d.step(input({ t: 2000, region: 'sf', tags: new Set(['headlands']) }));
    const f = d.step(input({ t: 3000, tags: new Set() }));
    expect(f.beds).toEqual(NO_BEDS);
    expect(f.events).toEqual([]);
  });
});

describe('Iowa synthesis reuses the lazy gust pair and one finite event source', () => {
  const make = () => {
    const ctx = new FakeAudioContext();
    const v = createScapeVoices(ctx as unknown as BaseAudioContext, ctx.createGain() as unknown as AudioNode);
    return { ctx, v };
  };
  const event = { kind: 'leafRustle', level: 0.15 } as ScapeEvent;
  it('builds no idle bed, retains two gust sources, releases and restarts them', () => {
    const { ctx, v } = make();
    v.setBeds(NO_BEDS, 1);
    expect(ctx.running()).toHaveLength(0);
    for (let t = 0; t < 20; t++) {
      ctx.currentTime = t;
      v.setBeds({ ...NO_BEDS, gust: 0.08 }, 1);
      expect(ctx.running()).toHaveLength(2);
    }
    v.setBeds(NO_BEDS, 1);
    ctx.currentTime += BED_IDLE_S + 1;
    v.setBeds(NO_BEDS, 1);
    expect(ctx.running()).toHaveLength(0);
    v.setBeds({ ...NO_BEDS, gust: 0.22 }, 1);
    expect(ctx.running()).toHaveLength(2);
  });
  it('allocates exactly one scheduled source, releases tracking on completion and refuses zero gain', () => {
    const { ctx, v } = make();
    const before = ctx.nodes.length;
    expect(v.play(event, 4, 0)).toBe(false);
    expect(ctx.nodes).toHaveLength(before);
    expect(v.play(event, 4, 1)).toBe(true);
    const sources = ctx.nodes.filter((n) => n.kind === 'bufferSource' || n.kind === 'oscillator');
    expect(sources).toHaveLength(1);
    expect(sources[0]!.startedAt).toBe(4);
    expect(sources[0]!.stoppedAt).toBeGreaterThan(4);
    expect(sources[0]!.stoppedAt).toBeLessThan(5);
    expect(v.active()).toBe(1);
    sources[0]!.end();
    expect(v.active()).toBe(0);
  });
  it('drops saturated events and terminal stop prevents all new rustles', () => {
    const { ctx, v } = make();
    for (let k = 0; k < MAX_SCAPE_EVENTS; k++) expect(v.play(event, 1, 1)).toBe(true);
    expect(v.active()).toBe(MAX_SCAPE_EVENTS);
    expect(ctx.nodes.filter((n) => n.kind === 'bufferSource')).toHaveLength(MAX_SCAPE_EVENTS);
    const before = ctx.nodes.length;
    expect(v.play(event, 1, 1)).toBe(false);
    expect(ctx.nodes).toHaveLength(before);
    ctx.currentTime = 1.1;
    v.stop();
    for (const n of ctx.nodes.filter((n) => n.kind === 'bufferSource')) expect(n.stoppedAt).toBeCloseTo(1.4);
    expect(v.play(event, 2, 1)).toBe(false);
    expect(ctx.nodes).toHaveLength(before);
  });
});

const me = (s = parkS): EntitySnapshot => ({
  id: 0,
  kind: 'rider',
  mode: 'Road',
  road: { edge: 0, s, d: 0, h: 0, dir: 1, yaw: 0 },
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  speed: 0,
  lean: 0,
  contentId: 'player',
  name: 'x',
  faction: 'rider',
  slot: 0,
  throttle: 0,
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
});
const snapshot = (): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities: [me()],
  race: { over: false, routeLength: 2000, finishOrder: [] },
});

describe('Iowa mixer control and reset path', () => {
  it('uses qualified region and real tags without changing inputs; slider, hitstop and race reset apply', async () => {
    const { ctx, create } = fakeContextFactory();
    const audio = createAudio({ createContext: create, radioKeys: null, barkEvents: null });
    audio.setRegion('region-clinton:clinton-iowa');
    audio.setRoad(road);
    await audio.resume();
    const snap = snapshot();
    const original = JSON.stringify({ snap, road });
    const frame = (t: number) => {
      ctx.currentTime = t;
      audio.frame(snap, 0);
      return audio.inspect().soundscape;
    };
    const on = frame(0).beds.gust;
    expect(on).toBeGreaterThan(0);
    snap.timeScale = 0;
    expect(frame(0).beds.gust).toBeCloseTo(on * 0.3);
    snap.timeScale = 1;
    frame(7);
    expect(audio.inspect().soundscape.played.some((e) => e.kind === 'leafRustle')).toBe(true);
    audio.setParam('audio.soundscape', 0);
    const before = frame(20).played.length;
    expect(frame(100).beds).toEqual(NO_BEDS);
    expect(frame(100).played).toHaveLength(before);
    audio.setParam('audio.soundscape', 1);
    expect(frame(100).beds.gust).toBeGreaterThan(0);
    expect(frame(100).played).toHaveLength(before);
    audio.frame(null, 0);
    expect(audio.inspect().soundscape.beds).toEqual(NO_BEDS);
    expect(frame(200).played).toHaveLength(before);
    audio.setRoad(road);
    expect(frame(300).played).toHaveLength(before);
    audio.setRegion('region-sf:san-francisco');
    expect(frame(400).beds.gust).toBe(0);
    audio.setRegion('region-clinton:clinton-iowa');
    expect(frame(500).played).toHaveLength(before);
    expect(JSON.stringify({ snap, road })).toBe(original);
  });
});
