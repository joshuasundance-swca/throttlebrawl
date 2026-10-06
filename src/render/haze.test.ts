// The haze per stretch (the maintainer, 2026-10-06, playtest 4 answers: "Thin it on Chuckanut: a longer, lighter haze
// on that drive only, so the sea below the cliff shows. The rest of the region keeps its misty mood."). Where the haze
// thins is data, a road tag (`thin-haze`); how far it reaches there is a tuning number (render.thinHazeFarM). Asked:
// - Chuckanut Drive's three roads, all along, and Lake Samish's East Shore Drive take the thin haze;
// - every other Pacific Northwest road keeps the region's 480 m, Bridge City's and I-5's named;
// - the haze moves to a new stretch's reach smoothly, never past it, and is there within a few seconds.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { easeHaze, HAZE_EASE_S, hazeFarAt, THIN_HAZE_TAG, thinHazeSpans } from './haze';
import { defaultRenderParams } from './tuning';

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

function network(id: string): RoadNetwork {
  const n = Object.values(networkFiles).find((f) => f.id === id);
  if (!n) throw new Error(`no network ${id}`);
  const roads = n.roads.map((r) => {
    const road = Object.values(roadFiles).find((f) => f.id === r);
    if (!road) throw new Error(`no road ${r}`);
    return road;
  });
  return createRoadNetwork({ network: n, roads });
}

const params = defaultRenderParams();
/** The thin roads, by id: Chuckanut Drive's three and Lake Samish's East Shore Drive. */
const THIN = new Set([
  'osm-chuckanut-larrabee',
  'osm-chuckanut-cliffs',
  'osm-chuckanut-oyster-creek',
  'osm-samish-east-shore',
]);

describe('the haze per stretch: thin on Chuckanut and by Lake Samish, the region elsewhere', () => {
  it('the defaults: the region 480 m, a thin stretch 700 m (the classic look’s own fog end, inside the 760 m far plane)', () => {
    expect(params.regionFogFarM).toBe(480);
    expect(params.thinHazeFarM).toBe(700);
  });

  it('every metre of every Pacific Northwest road reads the haze its tag says', () => {
    const ids = Object.values(networkFiles).map((n) => n.id);
    let thin = 0;
    let region = 0;
    const wrong: string[] = [];
    for (const id of ids) {
      const road = network(id);
      const spans = thinHazeSpans(road);
      for (const e of road.edges)
        for (let s = 0; s <= e.length; s += 10) {
          const far = hazeFarAt(spans, e.index, s, params);
          const want = THIN.has(e.id) ? params.thinHazeFarM : params.regionFogFarM;
          if (far === params.thinHazeFarM) thin++;
          else region++;
          if (far !== want) wrong.push(`${e.id} s ${s}: ${far}`);
        }
    }
    print(
      `${ids.length} PNW networks, every 10 m: ${thin} stations take the thin haze, ${region} the region's; wrong: ${wrong.length}`,
    );
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(thin).toBeGreaterThan(1000);
    expect(region).toBeGreaterThan(thin);
  });

  it("Bridge City and I-5 keep the region's 480 m all along", () => {
    for (const [id, pick] of [
      ['osm-pnw-portland', () => true],
      [
        'osm-pnw-samish',
        (e: { tags: readonly { tag: string }[] }) => e.tags.some((t) => t.tag === 'interstate'),
      ],
    ] as const) {
      const road = network(id);
      const spans = thinHazeSpans(road);
      const edges = road.edges.filter((e) => pick(e));
      expect(edges.length).toBeGreaterThan(0);
      for (const e of edges)
        for (let s = 0; s <= e.length; s += 5) expect(hazeFarAt(spans, e.index, s, params)).toBe(480);
    }
  });

  it('a tag over part of a road thins only that part, and the region number follows its slider (the control)', () => {
    const road = network('osm-pnw-chuckanut');
    const spans = thinHazeSpans(road);
    const e = road.edges[0]!;
    expect(e.tags.some((t) => t.tag === THIN_HAZE_TAG)).toBe(true);
    // The same road with no tag is the region's haze, whatever the slider says.
    const none = new Map<number, readonly (readonly [number, number])[]>();
    expect(hazeFarAt(none, e.index, 100, params)).toBe(480);
    expect(hazeFarAt(none, e.index, 100, { ...params, regionFogFarM: 420 })).toBe(420);
    const part = new Map([[e.index, [[100, 200]] as const]]);
    expect(hazeFarAt(part, e.index, 150, params)).toBe(700);
    expect(hazeFarAt(part, e.index, 250, params)).toBe(480);
    expect(hazeFarAt(spans, e.index, 100, { ...params, thinHazeFarM: 650 })).toBe(650);
  });

  it('the haze eases to a new reach: no jump, no overshoot, there within a few seconds', () => {
    let far = 480;
    const seen: number[] = [];
    for (let t = 0; t < 8; t += 1 / 60) {
      far = easeHaze(far, 700, 1 / 60);
      seen.push(far);
    }
    const steps = seen.slice(1).map((v, i) => v - seen[i]!);
    print(
      `480 to 700 m at 60 fps: ${(seen[59]! - 480).toFixed(0)} m after 1 s, ${(seen[179]! - 480).toFixed(0)} m after 3 s; largest step ${Math.max(...steps).toFixed(2)} m`,
    );
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(700);
    expect(Math.max(...steps)).toBeLessThan(5);
    // Most of the way within 3 s (a rider at 38 m/s is 114 m on), all of it within 8.
    expect(HAZE_EASE_S).toBeLessThanOrEqual(1);
    expect(seen[179]! - 480).toBeGreaterThan(0.95 * 220);
    expect(seen.at(-1)!).toBeGreaterThan(699);
    // The other way, and a long frame (a tab back from the background) never overshoots.
    expect(easeHaze(700, 480, 1 / 60)).toBeLessThan(700);
    expect(easeHaze(700, 480, 1 / 60)).toBeGreaterThan(690);
    expect(easeHaze(700, 480, 60)).toBe(480);
    expect(easeHaze(600, 600, 1 / 60)).toBe(600);
  });
});
