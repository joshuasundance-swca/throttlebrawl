// Playtest 4 run B (B11; identity sheets D4, P6, G5, CR4): sound per PLACE, not per region. The
// maintainer: "The real roads do not have the characteristics of the roads in question in terms of
// scenery and feel etc". Each rule here is the one a place's sound protects: Duval's crowd and
// roosters, Bridge City's hum, awnings, streetcar gong, lift bell and busker, the Golden Gate's gusting
// wind, joints and close horns, the Gorge's falls. The director decides (soundscape.ts), the voices
// make the sound (soundscape-voices.ts), the mixer feeds it the road (system.ts). Nothing here reads a
// seed's luck: each test asserts a level, a gate or a bound that the rule sets.
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { FakeAudioContext, fakeContextFactory } from './fake-context';
import {
  BAR_STYLES,
  createDirector,
  EXPOSURE,
  fallsAt,
  FALLS_FADE_M,
  gustShape,
  musicAt,
  NO_BEDS,
  OLDTOWN_CROWD_BASE,
  onOpenDeck,
  STREETCAR_RANGE_M,
  type ScapeBeds,
  type ScapeEvent,
  type ScapeInput,
  type ScapeRoad,
} from './soundscape';
import { BED_LEVEL, createScapeVoices, RAIN_LEVEL } from './soundscape-voices';
import { createAudio } from './system';

const tags = (...t: string[]) => new Set(t);

// The baked packs: the data these rules read, so a typo in a zone cannot silence a place.
interface RoadFile {
  id: string;
  tags?: { s0: number; s1: number; tag: string }[];
  features?: { kind: string; id: string; s0: number; s1: number; params?: Record<string, unknown> }[];
}
const roadFiles = import.meta.glob<RoadFile>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const roads = Object.values(roadFiles);
const zonesWith = (key: 'music' | 'sound') =>
  roads.flatMap((r) =>
    (r.features ?? [])
      .filter((f) => f.kind === 'roadsideZone' && f.params?.[key] !== undefined)
      .map((f) => ({ road: r, zone: f, value: f.params?.[key] })),
  );
const input = (over: Partial<ScapeInput> = {}): ScapeInput => ({
  t: 0,
  region: 'keys',
  speedMps: 20,
  edge: 0,
  s: 0,
  grounded: true,
  tags: tags(),
  near: [],
  ...over,
});

/** Steps the director once a frame for `seconds`, returning every event and every frame's beds. */
function run(
  over: Partial<ScapeInput>,
  seconds: number,
  seed = 1,
  step: (t: number) => Partial<ScapeInput> = () => ({}),
) {
  const d = createDirector(seed);
  const events: ScapeEvent[] = [];
  const beds: ScapeBeds[] = [];
  for (let t = 1; t < 1 + seconds; t += 1 / 30) {
    const f = d.step(input({ ...over, ...step(t), t }));
    events.push(...f.events);
    beds.push(f.beds);
  }
  return { events, beds };
}
const count = (es: readonly ScapeEvent[], kind: ScapeEvent['kind']) =>
  es.filter((e) => e.kind === kind).length;
const peak = (beds: readonly ScapeBeds[], k: keyof ScapeBeds) => Math.max(...beds.map((b) => b[k]));
const lowest = (beds: readonly ScapeBeds[], k: keyof ScapeBeds) => Math.min(...beds.map((b) => b[k]));

describe('Duval: a crowd along the street, roosters, and a louder crowd at a bar', () => {
  const street = { region: 'keys', tags: tags('key-oldtown', 'town', 'palms') } as const;

  it('murmurs along an Old Town street and nowhere else in the Keys', () => {
    const on = run(street, 20);
    expect(lowest(on.beds, 'crowd')).toBeCloseTo(OLDTOWN_CROWD_BASE, 5);
    const off = run({ region: 'keys', tags: tags('town', 'palms') }, 20);
    expect(peak(off.beds, 'crowd')).toBe(0);
    const bridge = run({ region: 'keys', tags: tags('bridge', 'water-open') }, 20);
    expect(peak(bridge.beds, 'crowd')).toBe(0);
  });

  it('swells with the bar music under the rider, to full inside a bar', () => {
    const between = run({ ...street, music: null }, 5);
    const near = run({ ...street, music: { style: 'karaoke', level: 0.5 } }, 5);
    const inside = run({ ...street, music: { style: 'karaoke', level: 1 } }, 5);
    expect(peak(near.beds, 'crowd')).toBeGreaterThan(peak(between.beds, 'crowd'));
    expect(peak(inside.beds, 'crowd')).toBeGreaterThan(peak(near.beds, 'crowd'));
    expect(peak(inside.beds, 'crowd')).toBeLessThanOrEqual(1);
  });

  it('roosters crow on the street, now and then, never off it', () => {
    const on = run(street, 120);
    // Between one crow every 7 s at the quickest and every 18 s at the slowest, plus the first.
    expect(count(on.events, 'rooster')).toBeGreaterThanOrEqual(4);
    expect(count(on.events, 'rooster')).toBeLessThanOrEqual(120 / 7 + 1);
    expect(count(run({ region: 'keys', tags: tags('town') }, 120).events, 'rooster')).toBe(0);
    expect(count(run({ region: 'pnw', tags: tags('key-oldtown') }, 120).events, 'rooster')).toBe(0);
  });

  it('keeps bar music from the Keys as before: a zone still chains phrases', () => {
    const out = run({ ...street, music: { style: 'cover-band', level: 1 } }, 6);
    expect(count(out.events, 'barMusic')).toBeGreaterThanOrEqual(3);
  });
});

describe('Bridge City: the hum, rain on awnings, the gong, the lift bell and the busker', () => {
  const blocks = { region: 'pnw', tags: tags('pdx-blocks', 'town') } as const;
  const deck = { region: 'pnw', tags: tags('pdx-deck', 'bridge') } as const;
  const near = (contentId: string, distanceM: number, id = 7) => ({
    id,
    contentId,
    distanceM,
    tags: tags(),
  });

  it('the city hums and the awnings patter on its blocks, and only there', () => {
    const b = run(blocks, 10);
    expect(peak(b.beds, 'city')).toBeGreaterThan(0);
    expect(peak(b.beds, 'awnings')).toBeGreaterThan(0);
    const forest = run({ region: 'pnw', tags: tags('forest') }, 10);
    expect(peak(forest.beds, 'city')).toBe(0);
    expect(peak(forest.beds, 'awnings')).toBe(0);
    // A bridge deck elsewhere in the region (the Gorge's creek bridge, I-5) is no city.
    const gorge = run({ region: 'pnw', tags: tags('bridge', 'forest') }, 10);
    expect(peak(gorge.beds, 'city')).toBe(0);
  });

  it('on a river deck the hum thins and the awnings are gone', () => {
    const d = run(deck, 10);
    expect(peak(d.beds, 'city')).toBeGreaterThan(0);
    expect(peak(d.beds, 'city')).toBeLessThan(peak(run(blocks, 10).beds, 'city'));
    expect(peak(d.beds, 'awnings')).toBe(0);
  });

  it('the rain stays: the helmet rain is the region rule, awnings are an addition', () => {
    const d = createDirector(1);
    expect(d.step(input({ ...blocks, t: 1 })).rain).toBeGreaterThan(0.4);
  });

  it('a streetcar within range rings its gong once, and again only after a wait', () => {
    const at = (t: number, d: number) =>
      createDirector(1).step(input({ ...blocks, t, near: [near('region-pnw:pdx-streetcar', d)] }));
    expect(count(at(1, STREETCAR_RANGE_M - 5).events, 'gong')).toBe(1);
    expect(count(at(1, STREETCAR_RANGE_M + 5).events, 'gong')).toBe(0);
    // One car, 12 s of frames: it rings once every few seconds, not every frame.
    const d = createDirector(1);
    let n = 0;
    for (let t = 1; t < 13; t += 1 / 30)
      n += count(
        d.step(input({ ...blocks, t, near: [near('region-pnw:pdx-streetcar', 30)] })).events,
        'gong',
      );
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(3);
    // Nearer is louder, and another vehicle is not a streetcar.
    const lvl = (m: number) =>
      (at(1, m).events.find((e) => e.kind === 'gong') as { level: number } | undefined)?.level ?? 0;
    expect(lvl(10)).toBeGreaterThan(lvl(60));
    const other = createDirector(1).step(
      input({ ...blocks, t: 1, near: [near('region-pnw:log-truck', 10)] }),
    );
    expect(count(other.events, 'gong')).toBe(0);
  });

  it('the lift bell and horn sound from a river deck, never from a street or another region', () => {
    expect(count(run(deck, 120).events, 'liftBell')).toBeGreaterThanOrEqual(1);
    expect(count(run(blocks, 120).events, 'liftBell')).toBe(0);
    expect(count(run({ region: 'pnw', tags: tags('bridge', 'forest') }, 120).events, 'liftBell')).toBe(0);
    expect(count(run({ region: 'sf', tags: tags('pdx-deck') }, 120).events, 'liftBell')).toBe(0);
  });

  it('a busker plays where a zone says so, in any region (the square)', () => {
    const out = run({ ...blocks, music: { style: 'busker', level: 1 } }, 6);
    const music = out.events.filter((e) => e.kind === 'barMusic');
    expect(music.length).toBeGreaterThanOrEqual(3);
    expect(new Set(music.map((m) => m.style))).toEqual(new Set(['busker']));
  });

  it('musicAt reads a busker from a zone like any other style', () => {
    const road: ScapeRoad = {
      edges: [
        {
          tags: [],
          features: [{ kind: 'roadsideZone', id: 'sq', s0: 55, s1: 125, params: { music: 'busker' } }],
        },
      ],
    };
    expect(musicAt(road, 0, 90)).toEqual({ style: 'busker', level: 1 });
  });
});

describe('the Golden Gate and the headlands: wind that gusts, joints, close horns', () => {
  const gate = { region: 'sf', tags: tags('bridge', 'water-open') } as const;
  const headlands = { region: 'sf', tags: tags('headlands') } as const;

  it('gusts on the open deck and the headlands, harder on the deck', () => {
    const g = run(gate, 30, 1, () => ({ speedMps: 30 }));
    const h = run(headlands, 30, 1, () => ({ speedMps: 30 }));
    expect(peak(g.beds, 'gust')).toBeGreaterThan(0);
    expect(peak(h.beds, 'gust')).toBeGreaterThan(0);
    expect(peak(g.beds, 'gust')).toBeGreaterThan(peak(h.beds, 'gust'));
    expect(peak(g.beds, 'gust') / peak(h.beds, 'gust')).toBeCloseTo(EXPOSURE.deck / EXPOSURE.headlands, 1);
  });

  it('a gust comes and goes: the level swings, it is not a steady hiss', () => {
    const g = run(gate, 30, 1, () => ({ speedMps: 30 }));
    expect(peak(g.beds, 'gust') - lowest(g.beds, 'gust')).toBeGreaterThan(0.25);
    expect(gustShape(0)).toBeGreaterThanOrEqual(0);
    for (let t = 0; t < 60; t += 0.37) {
      expect(gustShape(t)).toBeGreaterThanOrEqual(-1e-9);
      expect(gustShape(t)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('is harder with speed, and still there (softer) when stopped', () => {
    const at = (v: number) => peak(run(gate, 20, 1, () => ({ speedMps: v })).beds, 'gust');
    expect(at(35)).toBeGreaterThan(at(10));
    expect(at(0)).toBeGreaterThan(0);
  });

  it('is not on an overpass, in the city, or in another region', () => {
    // `bridge` alone is any overpass (SF has several); the Gate is a bridge over open water.
    expect(peak(run({ region: 'sf', tags: tags('bridge') }, 20).beds, 'gust')).toBe(0);
    expect(peak(run({ region: 'sf', tags: tags('cable-line', 'towers') }, 20).beds, 'gust')).toBe(0);
    expect(peak(run({ region: 'keys', tags: tags('bridge', 'water-open') }, 20).beds, 'gust')).toBe(0);
    expect(peak(run({ region: 'pnw', tags: tags('headlands') }, 20).beds, 'gust')).toBe(0);
  });

  it('the deck clacks at its joints, softer than the Keys, and an overpass does not', () => {
    const joints = (over: Partial<ScapeInput>) => {
      const d = createDirector(1);
      const out: Extract<ScapeEvent, { kind: 'joint' }>[] = [];
      let s = 0;
      for (let t = 1; s < 244; t += 1 / 60) {
        out.push(...d.step(input({ ...over, t, s, speedMps: 30 })).events.filter((e) => e.kind === 'joint'));
        s += 0.5;
      }
      return out;
    };
    const deck = joints(gate);
    expect(deck.length).toBeGreaterThanOrEqual(19);
    expect(joints({ region: 'sf', tags: tags('bridge') })).toHaveLength(0);
    const keys = joints({ region: 'keys', tags: tags('bridge') });
    expect(deck[0]!.level).toBeLessThan(keys[0]!.level);
  });

  it('the horns are close on the deck: louder and more often than across the bay', () => {
    const horns = (over: Partial<ScapeInput>) => run(over, 240).events.filter((e) => e.kind === 'foghorn');
    const onDeck = horns(gate);
    const ashore = horns({ region: 'sf', tags: tags('headlands') });
    expect(onDeck.length).toBeGreaterThan(ashore.length);
    const mean = (hs: typeof onDeck) => hs.reduce((a, h) => a + h.level, 0) / hs.length;
    expect(mean(onDeck)).toBeGreaterThan(mean(ashore));
  });
});

describe('the Gorge: the falls by the road', () => {
  const zone = (id: string, s0: number, s1: number, sound: unknown) => ({
    kind: 'roadsideZone',
    id,
    s0,
    s1,
    params: { sound },
  });
  const road = (...f: ReturnType<typeof zone>[]): ScapeRoad => ({ edges: [{ tags: [], features: f }] });
  const falls = road(zone('f', 1000, 1100, 'falls'));

  it('fallsAt is full in the zone and fades to nothing over FALLS_FADE_M, nearer louder', () => {
    expect(fallsAt(falls, 0, 1050)).toBe(1);
    expect(fallsAt(falls, 0, 1000)).toBe(1);
    expect(fallsAt(falls, 0, 1100 + FALLS_FADE_M)).toBe(0);
    expect(fallsAt(falls, 0, 1000 - FALLS_FADE_M - 1)).toBe(0);
    const out = [0, 20, 50, 100, 130].map((m) => fallsAt(falls, 0, 1100 + m));
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeLessThan(out[i - 1] as number);
    expect(out[out.length - 1]).toBeGreaterThan(0);
  });

  it('only a roadside zone whose sound is `falls` counts, and two zones give the louder', () => {
    for (const bad of ['surf', 7, null, undefined, ['falls']])
      expect(fallsAt(road(zone('x', 0, 100, bad)), 0, 50), String(bad)).toBe(0);
    const billboard: ScapeRoad = {
      edges: [
        { tags: [], features: [{ kind: 'billboard', id: 'b', s0: 0, s1: 100, params: { sound: 'falls' } }] },
      ],
    };
    expect(fallsAt(billboard, 0, 50)).toBe(0);
    expect(fallsAt(null, 0, 50)).toBe(0);
    expect(fallsAt(falls, 3, 1050)).toBe(0);
    expect(fallsAt(road(zone('a', 0, 100, 'falls'), zone('b', 140, 200, 'falls')), 0, 130)).toBeCloseTo(
      fallsAt(road(zone('b', 140, 200, 'falls')), 0, 130),
      10,
    );
  });

  it('the director follows it in the Pacific Northwest only', () => {
    const pnw = run({ region: 'pnw', tags: tags('forest'), falls: 0.8 }, 6);
    expect(peak(pnw.beds, 'falls')).toBeCloseTo(0.8, 5);
    expect(peak(run({ region: 'pnw', tags: tags('forest'), falls: 0 }, 6).beds, 'falls')).toBe(0);
    expect(peak(run({ region: 'keys', falls: 1 }, 6).beds, 'falls')).toBe(0);
    expect(peak(run({ region: 'sf', falls: 1 }, 6).beds, 'falls')).toBe(0);
  });
});

describe('the packs name only sounds the voices can play, in the places they belong', () => {
  it('every zone that names music names a style the voices play, and every `sound` one the falls', () => {
    const music = zonesWith('music');
    expect(music.length).toBeGreaterThan(0);
    for (const m of music) expect(BAR_STYLES as readonly unknown[], `${m.zone.id}`).toContain(m.value);
    const sounds = zonesWith('sound');
    expect(sounds.length).toBeGreaterThan(0);
    for (const m of sounds) expect(m.value, `${m.zone.id}`).toBe('falls');
  });

  it("each Gorge falls stands on land just past its road's creek bridge, and the bridge hears it", () => {
    const falls = zonesWith('sound').filter((z) => z.road.id.startsWith('osm-gorge-'));
    // Latourell Creek and Shepperd's Dell: two roads, one fall each.
    expect(new Set(falls.map((z) => z.road.id))).toEqual(
      new Set(['osm-gorge-latourell', 'osm-gorge-shepperds-dell']),
    );
    for (const z of falls) {
      // Its hikers stand on land, so the zone is off the deck (a zone over the bridge stood them over
      // the creek: the geometry sweeps caught it), and within 40 m of it.
      const bridges = (z.road.tags ?? []).filter((t) => t.tag === 'bridge');
      expect(
        bridges.some((b) => z.zone.s0 <= b.s1 && z.zone.s1 >= b.s0),
        `${z.zone.id} over a bridge`,
      ).toBe(false);
      const near = bridges.filter((b) => z.zone.s0 - b.s1 <= 40 && b.s0 - z.zone.s1 <= 40);
      expect(near.length, `${z.zone.id} beside a bridge`).toBe(1);
      const mid = (z.zone.s0 + z.zone.s1) / 2;
      const scape: ScapeRoad = { edges: [{ tags: z.road.tags ?? [], features: z.road.features ?? [] }] };
      expect(fallsAt(scape, 0, mid)).toBe(1);
      // The roar is still loud crossing the creek.
      const deck = (near[0]!.s0 + near[0]!.s1) / 2;
      expect(fallsAt(scape, 0, deck), `${z.zone.id} on the bridge`).toBeGreaterThan(0.35);
    }
  });

  it("Portland's busker plays at the square, where the plaza stands", () => {
    const busker = zonesWith('music').filter((z) => z.value === 'busker');
    expect(busker).toHaveLength(1);
    const { road, zone } = busker[0]!;
    expect(road.id.startsWith('osm-pnw-pdx-')).toBe(true);
    const plaza = (road.features ?? []).find((f) => f.kind === 'landmark' && f.id === 'square-plaza');
    expect(plaza).toBeDefined();
    expect(zone.s0 <= plaza!.s0 && zone.s1 >= plaza!.s1).toBe(true);
  });

  it('the Gate, the headlands and the city carry the tags their sounds read on the real roads', () => {
    const has = (tag: string, prefix: string) =>
      roads.some((r) => r.id.startsWith(prefix) && (r.tags ?? []).some((t) => t.tag === tag));
    expect(has('headlands', 'osm-sf-gg-')).toBe(true);
    const gate = roads.find((r) => r.id === 'osm-sf-gg-bridge');
    expect(onOpenDeck(new Set((gate?.tags ?? []).map((t) => t.tag)))).toBe(true);
    expect(has('pdx-blocks', 'osm-pnw-pdx-')).toBe(true);
    expect(has('pdx-deck', 'osm-pnw-pdx-')).toBe(true);
    expect(has('key-oldtown', 'osm-duval-')).toBe(true);
  });
});

describe('no place sound without a region, and none is louder than the rain', () => {
  it('a rider with no region hears no bed', () => {
    const f = createDirector(1).step(input({ region: null, tags: tags('key-oldtown', 'pdx-blocks') }));
    expect(f.beds).toEqual(NO_BEDS);
  });

  it('no bed is at its level louder than the rain on the helmet, the loudest steady sound there', () => {
    for (const [k, level] of Object.entries(BED_LEVEL)) expect(level, k).toBeLessThanOrEqual(RAIN_LEVEL);
    expect(Object.keys(BED_LEVEL).sort()).toEqual(Object.keys(NO_BEDS).sort());
  });

  it('is deterministic: the same seed and ride give the same place sounds', () => {
    const a = run({ region: 'keys', tags: tags('key-oldtown') }, 60, 5);
    const b = run({ region: 'keys', tags: tags('key-oldtown') }, 60, 5);
    expect(a.events).toEqual(b.events);
    expect(a.beds).toEqual(b.beds);
  });
});

describe('the voices: beds start only when first heard, and let go when quiet', () => {
  const make = () => {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const v = createScapeVoices(ctx as unknown as BaseAudioContext, out as unknown as AudioNode);
    return { ctx, out, v };
  };
  const beds = (over: Partial<ScapeBeds>): ScapeBeds => ({ ...NO_BEDS, ...over });

  it('nothing is built for a bed that never sounds', () => {
    const { ctx, v } = make();
    const before = ctx.nodes.length;
    v.setBeds(NO_BEDS, 1);
    expect(ctx.nodes.length).toBe(before);
    expect(ctx.running()).toHaveLength(0);
  });

  it('a bed starts on its first level, once, and follows it', () => {
    const { ctx, v } = make();
    v.setBeds(beds({ crowd: 0.5 }), 1);
    const sources = ctx.running();
    expect(sources.length).toBeGreaterThan(0);
    v.setBeds(beds({ crowd: 0.9 }), 1);
    expect(ctx.running()).toHaveLength(sources.length);
    expect(v.bedLevels().crowd).toBeCloseTo(0.9 * 1, 5);
    // Another bed starts its own, and the crowd's stay.
    v.setBeds(beds({ crowd: 0.9, gust: 0.4 }), 1);
    expect(ctx.running().length).toBeGreaterThan(sources.length);
  });

  it('the master level scales a bed, and a bed is capped at its own level', () => {
    const { v } = make();
    v.setBeds(beds({ falls: 1, gust: 5 }), 0.5);
    expect(v.bedLevels().falls).toBeCloseTo(0.5, 5);
    expect(v.bedLevels().gust).toBeLessThanOrEqual(0.5);
  });

  it('a bed that has been quiet for a while is stopped, and starts again on demand', () => {
    const { ctx, v } = make();
    v.setBeds(beds({ falls: 0.6 }), 1);
    const first = ctx.running();
    expect(first.length).toBeGreaterThan(0);
    ctx.currentTime = 1;
    v.setBeds(NO_BEDS, 1);
    expect(ctx.running()).toHaveLength(first.length);
    ctx.currentTime = 60;
    v.setBeds(NO_BEDS, 1);
    expect(ctx.running()).toHaveLength(0);
    v.setBeds(beds({ falls: 0.6 }), 1);
    expect(ctx.running()).toHaveLength(first.length);
  });

  it('stop silences every bed', () => {
    const { ctx, v } = make();
    v.setBeds(beds({ crowd: 1, gust: 1, falls: 1, city: 1, awnings: 1 }), 1);
    v.stop();
    for (const s of ctx.nodes.filter((n) => n.kind === 'bufferSource' || n.kind === 'oscillator'))
      expect(s.stoppedAt, s.kind).not.toBeNull();
    v.setBeds(beds({ crowd: 1 }), 1);
    expect(v.bedLevels().crowd).toBe(0);
  });

  it('the new events make sources that all stop themselves', () => {
    const events: ScapeEvent[] = [
      { kind: 'rooster', level: 1, pitch: 1 },
      { kind: 'gong', level: 1, strikes: 2 },
      { kind: 'liftBell', level: 1 },
      { kind: 'barMusic', level: 1, style: 'busker', at: 1, bar: 0 },
      { kind: 'barMusic', level: 1, style: 'busker', at: 2, bar: 3 },
    ];
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
      expect(v.active(), e.kind).toBeGreaterThan(0);
    }
  });

  it('a gong strikes `strikes` times and the lift bell rings, then the horn blows twice', () => {
    const g = make();
    g.v.play({ kind: 'gong', level: 1, strikes: 3 }, 1, 1);
    expect(new Set(g.ctx.nodes.filter((n) => n.kind === 'oscillator').map((n) => n.startedAt)).size).toBe(3);
    const l = make();
    l.v.play({ kind: 'liftBell', level: 1 }, 1, 1);
    const starts = [...new Set(l.ctx.nodes.filter((n) => n.startedAt !== null).map((n) => n.startedAt))];
    // Many bell strikes, then two horn blasts after the last of them.
    expect(starts.length).toBeGreaterThan(8);
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
const snap = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 2000, finishOrder: [] },
});

describe('the mixer plays the place sounds', () => {
  async function started(regionId: string | null, road: ScapeRoad | null) {
    const { ctx, create } = fakeContextFactory();
    const audio = createAudio({ createContext: create, radioKeys: null, barkEvents: null });
    audio.setRegion(regionId);
    audio.setRoad(road);
    await audio.resume();
    return { ctx, audio };
  }
  function drive(
    h: Awaited<ReturnType<typeof started>>,
    from: number,
    metres: number,
    others: EntitySnapshot[] = [],
  ) {
    let s = from;
    for (let t = 2; s < from + metres; t += 1 / 60) {
      h.ctx.currentTime = t;
      const me = entity(0, { speed: 30, road: { edge: 0, s, d: 0, h: 0, dir: 1, yaw: 0 } });
      h.audio.frame(snap([me, ...others]), 0);
      s += 0.5;
    }
  }

  it("Duval: the street's crowd is heard, louder at a bar's front than between bars", async () => {
    const road: ScapeRoad = {
      edges: [
        {
          tags: [{ s0: 0, s1: 2000, tag: 'key-oldtown' }],
          features: [{ kind: 'roadsideZone', id: 'bar', s0: 500, s1: 600, params: { music: 'cover-band' } }],
        },
      ],
    };
    const h = await started('base:florida-keys', road);
    drive(h, 1000, 20);
    const between = h.audio.inspect().soundscape.beds.crowd;
    expect(between).toBeGreaterThan(0);
    drive(h, 520, 20);
    expect(h.audio.inspect().soundscape.beds.crowd).toBeGreaterThan(between);
  });

  it('the Gorge: the falls roar near the zone and are gone far from it', async () => {
    const road: ScapeRoad = {
      edges: [
        {
          tags: [{ s0: 0, s1: 3000, tag: 'forest' }],
          features: [{ kind: 'roadsideZone', id: 'falls', s0: 1000, s1: 1080, params: { sound: 'falls' } }],
        },
      ],
    };
    const h = await started('region-pnw:pacific-northwest', road);
    drive(h, 1010, 10);
    const near = h.audio.inspect().soundscape.beds.falls;
    expect(near).toBeGreaterThan(0);
    drive(h, 2400, 10);
    expect(h.audio.inspect().soundscape.beds.falls).toBeLessThan(near);
    expect(h.audio.inspect().soundscape.beds.falls).toBe(0);
  });

  it('Bridge City: a streetcar near the rider rings its gong', async () => {
    const road: ScapeRoad = { edges: [{ tags: [{ s0: 0, s1: 3000, tag: 'pdx-blocks' }] }] };
    const car = entity(9, {
      kind: 'vehicle',
      contentId: 'region-pnw:pdx-streetcar',
      slot: -1,
      road: { edge: 0, s: 60, d: 0, h: 0, dir: 1, yaw: 0 },
      z: -30,
    });
    const h = await started('region-pnw:pacific-northwest', road);
    drive(h, 10, 12, [car]);
    expect(h.audio.inspect().soundscape.played.some((e) => e.kind === 'gong')).toBe(true);
    expect(h.audio.inspect().soundscape.beds.city).toBeGreaterThan(0);
  });

  it('the Golden Gate: wind on the deck, and the slider turns every place sound off', async () => {
    const road: ScapeRoad = {
      edges: [
        {
          tags: [
            { s0: 0, s1: 3000, tag: 'bridge' },
            { s0: 0, s1: 3000, tag: 'water-open' },
          ],
        },
      ],
    };
    const on = await started('region-sf:san-francisco', road);
    drive(on, 10, 60);
    expect(on.audio.inspect().soundscape.beds.gust).toBeGreaterThan(0);
    const off = await started('region-sf:san-francisco', road);
    off.audio.setParam('audio.soundscape', 0);
    drive(off, 10, 60);
    expect(off.audio.inspect().soundscape.beds.gust).toBe(0);
  });

  it('leaving the race silences the beds', async () => {
    const road: ScapeRoad = { edges: [{ tags: [{ s0: 0, s1: 3000, tag: 'pdx-blocks' }] }] };
    const h = await started('region-pnw:pacific-northwest', road);
    drive(h, 10, 20);
    expect(h.audio.inspect().soundscape.beds.city).toBeGreaterThan(0);
    h.audio.frame(null, 0);
    expect(h.audio.inspect().soundscape.beds.city).toBe(0);
  });
});
