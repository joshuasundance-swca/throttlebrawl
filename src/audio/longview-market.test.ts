import { describe, expect, it } from 'vitest';
import authored from '../../tools/gis/networks/osm-pnw-longview-diamond.json';
import kessler from '../../packs/region-pnw/regions/pacific-northwest/roads/osm-longview-diamond-kessler.json';
import {
  BAR_FADE_M,
  BAR_LOOKAHEAD_S,
  BAR_MIN_LEVEL,
  BAR_PHRASE_S,
  createDirector,
  musicAt,
  tagsAt,
  type ScapeInput,
  type ScapeRoad,
} from './soundscape';

const market = kessler.features.find((f) => f.id === 'street-plant-market')!;
const midpoint = (market.s0 + market.s1) / 2;
const road: ScapeRoad = { edges: [kessler] };
const withoutMusic: ScapeRoad = {
  edges: [
    {
      ...kessler,
      features: kessler.features.map((f) => {
        if (f.id !== market.id) return f;
        const params: Record<string, unknown> = { ...f.params };
        delete params['music'];
        return { ...f, params };
      }),
    },
  ],
};
const input = (t: number, over: Partial<ScapeInput> = {}): ScapeInput => ({
  t,
  region: 'pnw',
  speedMps: 20,
  edge: 0,
  s: midpoint,
  grounded: true,
  tags: tagsAt(road, 0, midpoint),
  near: [],
  dry: true,
  music: musicAt(road, 0, midpoint),
  ...over,
});

describe('Kessler plant-market music from the authored frontage', () => {
  it('authors the existing busker style in the market and preserves it in the baked road', () => {
    const source: {
      lines: { roads: { id: string; features?: ScapeRoad['edges'][number]['features'] }[] }[];
    } = authored;
    const sourceRoad = source.lines.flatMap((line) => line.roads).find((r) => r.id === kessler.id)!;
    const sourceMarket = sourceRoad.features?.find((f) => f.id === market.id);
    expect(sourceMarket?.kind).toBe('roadsideZone');
    expect(sourceMarket?.params).toMatchObject({ place: 'plant-market', music: 'busker' });
    expect(market).toEqual(sourceMarket);
  });

  it('is full along the actual frontage, fades on both approaches and is absent beyond earshot', () => {
    for (const s of [market.s0, midpoint, market.s1])
      expect(musicAt(road, 0, s)).toEqual({ style: 'busker', level: 1 });
    for (const s of [market.s0 - BAR_FADE_M / 2, market.s1 + BAR_FADE_M / 2]) {
      expect(musicAt(road, 0, s)?.style).toBe('busker');
      expect(musicAt(road, 0, s)?.level).toBeCloseTo(0.5 ** 1.5);
    }
    for (const s of [market.s0 - BAR_FADE_M, market.s1 + BAR_FADE_M]) expect(musicAt(road, 0, s)).toBeNull();
    expect(musicAt(withoutMusic, 0, midpoint)).toBeNull();
  });

  it('schedules the existing phrases in PNW only while the rider qualifies for this frontage', () => {
    const director = createDirector(1);
    const first = director.step(input(1)).events.filter((e) => e.kind === 'barMusic');
    expect(first).toEqual([{ kind: 'barMusic', style: 'busker', level: 1, at: 1, bar: 0 }]);
    expect(
      director.step(input(1 + BAR_PHRASE_S - BAR_LOOKAHEAD_S)).events.filter((e) => e.kind === 'barMusic'),
    ).toEqual([{ kind: 'barMusic', style: 'busker', level: 1, at: 1 + BAR_PHRASE_S, bar: 1 }]);
    const silent: Partial<ScapeInput>[] = [
      { music: musicAt(withoutMusic, 0, midpoint) },
      { s: market.s1 + BAR_FADE_M, music: musicAt(road, 0, market.s1 + BAR_FADE_M) },
      { grounded: false },
      { region: null },
      { music: { style: 'busker', level: BAR_MIN_LEVEL / 2 } },
    ];
    for (const control of silent)
      expect(
        createDirector(1)
          .step(input(1, control))
          .events.filter((e) => e.kind === 'barMusic'),
      ).toEqual([]);
  });

  it('restarts from the current audio time after a pause or absence without a catch-up burst', () => {
    for (const leave of [false, true]) {
      const director = createDirector(1);
      director.step(input(1));
      const returnAt = 1 + BAR_PHRASE_S * 20;
      if (leave) director.step(input(returnAt - BAR_PHRASE_S, { music: null }));
      const resumed = director.step(input(returnAt)).events.filter((e) => e.kind === 'barMusic');
      expect(resumed).toHaveLength(1);
      expect(resumed[0]?.at).toBe(returnAt);
      expect(director.step(input(returnAt)).events.filter((e) => e.kind === 'barMusic')).toEqual([]);
    }
  });
});
