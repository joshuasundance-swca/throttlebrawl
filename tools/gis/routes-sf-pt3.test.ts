import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lintRoad, type BakedRoad, type BakedRoute } from '../../src/road';

// The Golden Gate and Lombard Street (playtest 3, T9.3; the maintainer, 2026-10-03: "Golden Gate",
// "real landmarks", "hairpin races like Lombard"; round 3: "real road layouts"). Two real-road
// networks of the San Francisco pack, baked by `tbgis network` from OpenStreetMap and USGS 3DEP.
// The generic checks (the road lint, scenery on drawn land, the land never ending in mid-air, the
// lanes) run over them in region-routes.test.ts, and the bot races both in
// tests/sim/road-real-routes.test.ts; this file holds what is particular to these two: the shape
// the real places have, and the numbers a later task relies on (the near bridge's placement, the
// Lombard drift probe).

const PACK = 'packs/region-sf/regions/san-francisco';

const road = (id: string): BakedRoad =>
  JSON.parse(readFileSync(`${PACK}/roads/${id}.json`, 'utf8')) as BakedRoad;
const route = (id: string): BakedRoute =>
  JSON.parse(readFileSync(`${PACK}/routes/${id}.json`, 'utf8')) as BakedRoute;
interface Report {
  lines: Record<string, { fun: { max_deviation_m: number; tightest_radius_m: number } }>;
  landmarks: { id: string; road: string; s: number; d: number; placementErrorM: number }[];
}
const report = (network: string): Report =>
  JSON.parse(readFileSync(`tools/gis/reports/${network}.network.json`, 'utf8')) as Report;

/** What the route runs, in order: each main-path road, with the length the race counts on it. */
function mainRoads(r: BakedRoute): BakedRoad[] {
  return r.mainPath.map(road);
}
const lengthOf = (roads: BakedRoad[]) => roads.reduce((a, b) => a + b.lengthM, 0);
const col = (r: BakedRoad, name: string): number[] => r.samples.data[name] as number[];
const G = 9.81;

/**
 * The speed each crest of a route's profile throws a rider following the road into the air, m/s:
 * sqrt(g / c) for the grade falling by c per metre over a 10 m window. The bake's own estimate
 * (`fun.launch_speed_mps`), not the game's airborne rule; sorted, lowest first.
 */
function crestSpeeds(roads: BakedRoad[]): { v: number; s: number }[] {
  const s: number[] = [];
  const g: number[] = [];
  let base = 0;
  for (const r of roads) {
    const sp = r.sampleSpacingM;
    col(r, 'grade').forEach((v, i) => {
      s.push(base + i * sp);
      g.push(v);
    });
    base += r.lengthM;
  }
  const at = (x: number) => {
    let j = s.findIndex((v) => v >= x);
    j = Math.min(Math.max(j, 1), s.length - 1);
    const t = (x - (s[j - 1] as number)) / Math.max((s[j] as number) - (s[j - 1] as number), 1e-9);
    return (g[j - 1] as number) + t * ((g[j] as number) - (g[j - 1] as number));
  };
  const out: { v: number; s: number }[] = [];
  for (let x = 10; x < (s[s.length - 1] as number) - 10; x += 1) {
    const c = -(at(x + 5) - at(x - 5)) / 10;
    if (c > 1e-6) out.push({ v: Math.sqrt(G / c), s: x });
  }
  return out.sort((a, b) => a.v - b.v);
}

/** Runs of tight turning along a road, each as its total turn in degrees (|kappa| over 1/15 per metre). */
function hairpins(r: BakedRoad, kappaOver = 1 / 15): number[] {
  const sp = r.sampleSpacingM;
  const k = col(r, 'kappa');
  const out: number[] = [];
  let i = 0;
  while (i < k.length) {
    if (Math.abs(k[i] as number) <= kappaOver) {
      i++;
      continue;
    }
    const sign = Math.sign(k[i] as number);
    let turn = 0;
    while (i < k.length && Math.abs(k[i] as number) > kappaOver && Math.sign(k[i] as number) === sign) {
      turn += (k[i] as number) * sp;
      i++;
    }
    out.push(Math.abs((turn * 180) / Math.PI));
  }
  return out;
}

describe('the Golden Gate (osm-sf-golden-gate)', () => {
  const r = route('osm-sf-golden-gate-run');
  const roads = mainRoads(r);
  const bridge = road('osm-sf-gg-bridge');

  it('runs Hawk Hill, Conzelman Road, Vista Point, the bridge and the toll plaza, with no choice and no gap', () => {
    expect(r.mainPath).toEqual([
      'osm-sf-gg-hawk-hill',
      'osm-sf-gg-conzelman',
      'osm-sf-gg-vista-point',
      'osm-sf-gg-bridge',
      'osm-sf-gg-toll-plaza',
    ]);
    // No branch: traffic runs the main path, and a gap goes only on a branch (T3.1's lint).
    expect([...r.allowedRoads]).toEqual([...r.mainPath]);
    expect(r.branches ?? []).toEqual([]);
    for (const x of roads)
      expect(
        (x.features ?? []).filter((f) => f.kind === 'gap'),
        x.id,
      ).toEqual([]);
    // About 6 km: real-world's estimate for the line, and the real path is 6.1 km.
    expect(lengthOf(roads)).toBeGreaterThan(5900);
    expect(lengthOf(roads)).toBeLessThan(6300);
    // It starts on the hill (about 250 m) and finishes at the toll plaza, about 55 m up.
    expect(col(roads[0] as BakedRoad, 'y')[0]).toBeGreaterThan(240);
    const last = roads[roads.length - 1] as BakedRoad;
    expect(col(last, 'y')[col(last, 'y').length - 1]).toBeLessThan(60);
  });

  it('is six lanes behind a barrier median over the whole bridge, which keeps its real length and height', () => {
    const lanes = bridge.laneSections[0]?.lanes ?? [];
    const drive = lanes.filter((l) => l.kind === 'drive');
    expect(drive.filter((l) => l.direction === 1)).toHaveLength(3);
    expect(drive.filter((l) => l.direction === -1)).toHaveLength(3);
    for (const l of drive) expect(l.widthM).toBe(4);
    expect(bridge.laneSections[0]?.median).toEqual({ widthM: 0.6, kind: 'barrier' });
    // The deck: the real suspended span is 1,966 m between anchorages; with the approaches the
    // bridge road is 2.74 km (OSM's bridge ways: 2,742 m).
    expect(bridge.lengthM).toBeGreaterThan(2700);
    expect(bridge.lengthM).toBeLessThan(2780);
    const y = col(bridge, 'y');
    // 67 m is the real clearance at mid-span; the deck runs from the abutments' heights (74 m at
    // Vista Point, 56 m at the toll plaza) with a hump over the main span. Never a dip: the deck
    // does not follow the gulch under the Marin approach.
    expect(Math.min(...y)).toBeGreaterThan(54);
    expect(Math.max(...y)).toBeLessThan(75);
    const mid = y.slice(Math.floor(y.length * 0.4), Math.floor(y.length * 0.6));
    const meanMid = mid.reduce((a, b) => a + b, 0) / mid.length;
    expect(meanMid).toBeGreaterThan(64);
    expect(meanMid).toBeLessThan(70);
    expect(Math.max(...col(bridge, 'grade').map(Math.abs))).toBeLessThan(0.025);
  });

  it('stands over open water, with a railing look that is a wall, never a rail to fall over', () => {
    const tags = bridge.tags ?? [];
    for (const t of ['bridge', 'water-open']) {
      const spans = tags.filter((x) => x.tag === t);
      expect(spans, t).toHaveLength(1);
      expect((spans[0]?.s1 ?? 0) - (spans[0]?.s0 ?? 0), t).toBeGreaterThan(bridge.lengthM - 10);
    }
    // No land tag on a deck (scenery stands on land only), and the bridge carries no forest.
    expect(tags.filter((x) => x.tag === 'forest')).toEqual([]);
    const barriers = bridge.barriers ?? [];
    expect(barriers.length).toBeGreaterThan(0);
    // Every barrier is a 1.3 m wall that looks like a railing (a `rail` is what a tumble body goes
    // over: `railOver`; the plan's rule is no fall content at the Golden Gate), on both sides.
    for (const b of barriers) {
      expect(b.kind).toBe('wall');
      expect(b.look).toBe('railing');
      expect(b.heightM).toBe(1.3);
      expect(b.side).toBe('both');
    }
    expect(Math.min(...barriers.map((b) => b.s0))).toBeLessThan(5);
    expect(Math.max(...barriers.map((b) => b.s1))).toBeGreaterThan(bridge.lengthM - 5);
    // Not jumpable either: an airborne rider does not clear it.
    expect(barriers.filter((b) => (b as { jumpable?: boolean }).jumpable)).toEqual([]);
  });

  it('carries the bridge as one landmark between its anchorages, centred on the real mid-span', () => {
    const marks = (bridge.features ?? []).filter((f) => f.kind === 'landmark');
    expect(marks).toHaveLength(1);
    const m = marks[0];
    expect(m?.id).toBe('gg-bridge');
    const p = m?.params as { model: string; overRoad?: boolean };
    // The model is the kit's composite node (render/landmarks.ts COMPOSITES), CX3's kit; the far
    // backdrop piece leaves this network, so the route shows exactly one bridge (src/render/landmarks-sf.test.ts).
    expect(p.model).toBe('golden-gate#gg_bridge');
    expect(p.overRoad).toBe(true);
    // Anchorage to anchorage: 343 m side spans and the 1,280 m main span are 1,966 m; the box is
    // 1,960 m so it lies on the one road. The mid-span stands 1,423 m into the bridge road on the
    // real path (the real centre, 37.8197 N 122.4786 W), 1,419 m on the baked line.
    const along = (m?.s1 ?? 0) - (m?.s0 ?? 0);
    expect(along).toBeCloseTo(1960, 0);
    const centre = ((m?.s0 ?? 0) + (m?.s1 ?? 0)) / 2;
    expect(centre).toBeGreaterThan(1400);
    expect(centre).toBeLessThan(1440);
    expect(m?.s0).toBeGreaterThan(0);
    expect(m?.s1).toBeLessThan(bridge.lengthM);
    // How far the baked line is from the real map (a 6 km line pinned only at its ends): the bake
    // reports it, and this is the bound a later placement can count on.
    const rep = report('osm-sf-golden-gate');
    expect(rep.landmarks[0]?.placementErrorM).toBeLessThan(35);
    expect(rep.lines['gg']?.fun.max_deviation_m).toBeLessThan(35);
  });

  it('carries the toll gantry across the toll plaza, centred on its lanes and clear of its verge', () => {
    const plaza = road('osm-sf-gg-toll-plaza');
    const marks = (plaza.features ?? []).filter((f) => f.kind === 'landmark');
    expect(marks).toHaveLength(1);
    const m = marks[0];
    expect(m?.id).toBe('toll-gantry');
    const p = m?.params as { model: string; overRoad?: boolean };
    expect(p.model).toBe('sf-landmarks#toll_gantry');
    // The road lint's `landmark-clear` would refuse a box over the lanes: the gantry spans them.
    expect(p.overRoad).toBe(true);
    // Centred on the road's axis, and wide enough (the kit's 31 m span plus its posts) to straddle
    // every lane and shoulder of the plaza's drawn width.
    expect(Math.abs(((m?.d0 ?? 0) + (m?.d1 ?? 0)) / 2)).toBeLessThan(0.5);
    const lanes = plaza.laneSections[0]?.lanes ?? [];
    const half = Math.max(...lanes.map((l) => Math.abs(l.dCenterM) + l.widthM / 2));
    expect(m?.d1 ?? 0).toBeGreaterThan(half);
    expect(m?.d0 ?? 0).toBeLessThan(-half);
    // Past the plaza's sign, inside the road, and the bake placed it on the line (the real point is
    // 28 m from the smoothed line, as the bridge's is: the config's point is tuned onto the real one).
    expect(m?.s0 ?? 0).toBeGreaterThan(70);
    expect(m?.s1 ?? 0).toBeLessThan(plaza.lengthM);
    const placed = report('osm-sf-golden-gate').landmarks.find((x) => x.id === 'toll-gantry');
    expect(placed?.road).toBe('osm-sf-gg-toll-plaza');
    expect(Math.abs(placed?.d ?? 99)).toBeLessThan(0.5);
  });

  it('keeps Conzelman Road wide enough for the road format and a lane drop at each end of the deck', () => {
    // The tightest turn is the hairpin ramp at Vista Point (12.8 m): the width rule allows 9.5 m.
    expect(report('osm-sf-golden-gate').lines['gg']?.fun.tightest_radius_m).toBeGreaterThan(9.5);
    for (const x of roads) expect(lintRoad(x), x.id).toEqual([]);
  });

  it('is a line no rider leaves the ground on', () => {
    // The lowest crest speed over the route is far over the starter bike's top speed (44.7 m/s).
    expect(crestSpeeds(roads)[0]?.v).toBeGreaterThan(80);
  });
});

describe('Lombard Street (osm-sf-lombard)', () => {
  const r = route('osm-sf-lombard-run');
  const roads = mainRoads(r);
  const crooked = road('osm-sf-lombard-crooked');

  it('runs Polk to the crest at Hyde, the crooked block, Lombard on and Telegraph Hill to Coit Tower', () => {
    expect(r.mainPath).toEqual([
      'osm-sf-lombard-climb',
      'osm-sf-lombard-crooked',
      'osm-sf-lombard-flats',
      'osm-sf-lombard-telegraph-hill',
    ]);
    expect([...r.allowedRoads]).toEqual([...r.mainPath]);
    expect(r.branches ?? []).toEqual([]);
    // 1.9 km of the real street (real-world's estimate was 2.2): Polk to the circle at the tower.
    expect(lengthOf(roads)).toBeGreaterThan(1800);
    expect(lengthOf(roads)).toBeLessThan(2000);
    for (const x of roads)
      expect(
        (x.features ?? []).filter((f) => f.kind === 'gap'),
        x.id,
      ).toEqual([]);
  });

  it('has the real eight hairpins on a one-lane brick block, 193 m long, with a 5 m radius', () => {
    const turns = hairpins(crooked);
    // Eight turns of about 90 to 110 degrees at a 15 m radius or tighter (the real ones are 120 each
    // over their whole arc; the bake's 2 m smoothing rounds each turn's tails), and a partial turn
    // at each end.
    const full = turns.filter((t) => t >= 75);
    expect(full, JSON.stringify(turns.map(Math.round))).toHaveLength(8);
    for (const t of full) expect(t).toBeLessThan(125);
    expect(turns.filter((t) => t < 75 && t >= 25)).toHaveLength(2);
    // OSM way 402111597 is 197 m with its approach; the bake cuts the block at its two ends.
    expect(crooked.lengthM).toBeGreaterThan(188);
    expect(crooked.lengthM).toBeLessThan(198);
    // The real minimum is 5.1 m over a 6 m chord (real-world, computed); the smoothed block keeps 5.3 m on the 1 m grid the bake measures, 4.9 m between its 1.2 m samples.
    const rMin = 1 / Math.max(...col(crooked, 'kappa').map(Math.abs));
    expect(rMin).toBeGreaterThan(4.5);
    expect(rMin).toBeLessThan(7);
    expect(
      Math.abs((report('osm-sf-lombard').lines['lombard']?.fun.tightest_radius_m ?? 0) - rMin),
    ).toBeLessThan(0.6);
    // The surface and the street: red brick, one-way downhill, one forward lane and nothing else.
    expect(crooked.surface).toBe('brick');
    expect((crooked.tags ?? []).map((t) => t.tag)).toContain('brick-street');
    expect(crooked.laneSections).toHaveLength(1);
    expect(crooked.laneSections[0]?.lanes).toEqual([
      { id: 'R1', dCenterM: 0, widthM: 4, direction: 1, kind: 'drive' },
    ]);
    expect(col(crooked, 'y')[0]).toBeGreaterThan(col(crooked, 'y')[col(crooked, 'y').length - 1] as number);
    // The streets either side are two-way and asphalt: the join narrows like any lane drop.
    for (const id of ['osm-sf-lombard-climb', 'osm-sf-lombard-flats', 'osm-sf-lombard-telegraph-hill']) {
      const x = road(id);
      expect(x.surface, id).toBe('asphalt');
      expect(
        x.laneSections[0]?.lanes.filter((l) => l.kind === 'drive'),
        id,
      ).toHaveLength(2);
    }
  });

  it('would fail the road format on a two-way table: the one lane is what keeps a 5 m turn legal', () => {
    // A negative control: the same baked block with the two-way lane table the other roads have
    // is refused by the game's own lint (|kappa| * dMax over 0.5).
    const section = crooked.laneSections[0] as BakedRoad['laneSections'][number];
    const widened: BakedRoad = {
      ...crooked,
      laneSections: [{ ...section, lanes: road('osm-sf-lombard-climb').laneSections[0]?.lanes ?? [] }],
    };
    expect(lintRoad(crooked)).toEqual([]);
    const issues = lintRoad(widened).filter((i) => i.rule === 'kappa-width');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('stands Coit Tower at the end of Telegraph Hill Boulevard, off the road, where the real tower stands (playtest 4, C1)', () => {
    // Playtest 4, P1 had moved it to the foot of the hill, where the flats' straight pointed at it; run B's B1 found
    // that 200 m from the real tower, which stands about 20 m from the boulevard's end, and C1 put it back. The
    // position is read against the baked road (the bake compresses straights), not from the raw lat/lon.
    const flats = road('osm-sf-lombard-flats');
    const tele = road('osm-sf-lombard-telegraph-hill');
    expect((flats.features ?? []).filter((f) => f.kind === 'landmark')).toHaveLength(0);
    const marks = (tele.features ?? []).filter((f) => f.kind === 'landmark');
    expect(marks).toHaveLength(1);
    const m = marks[0];
    expect((m?.params as { model: string }).model).toBe('sf-landmarks#coit_tower');
    // At its real height (64 m, scale 1): the model's 22 m footprint, whole inside the road's length, on the
    // road's left and past its verge, in the last 25 m of the road.
    expect((m?.params as { scale?: number }).scale).toBeUndefined();
    expect((m?.s1 ?? 0) - (m?.s0 ?? 0)).toBeCloseTo(22, 3);
    expect(m?.d1).toBeLessThanOrEqual(-8);
    expect(m?.s1).toBeLessThanOrEqual(tele.lengthM);
    expect(tele.lengthM - ((m?.s0 ?? 0) + (m?.s1 ?? 0)) / 2).toBeLessThan(25);
    const row = report('osm-sf-lombard').landmarks[0];
    expect(row?.road).toBe('osm-sf-lombard-telegraph-hill');
    expect(row?.placementErrorM).toBeLessThan(8);
    expect(report('osm-sf-lombard').lines['lombard']?.fun.max_deviation_m).toBeLessThan(10);
  });

  it('has no crest that throws a rider into the first hairpin below 35 m/s (the drift probe starts here)', () => {
    // Risk R6 of the real-world plan: `riders.crestLaunch` could throw a rider into hairpin 1. The
    // Hyde crest is the lowest on the route: it launches a bike that follows the road above 36 m/s
    // (the bake estimates 39 by a wider window), and the first hairpin starts in the crest's own
    // metres, where the hairpins ride at a third of that speed. The route's other crests (mid-climb
    // and the foot of the block) launch from 42 and 44 m/s. T2.6's bot test is the game's own rule;
    // this is the arithmetic on the profile.
    const crests = crestSpeeds(roads);
    const hyde = roads[0] as BakedRoad;
    expect(crests[0]?.v).toBeGreaterThan(35);
    expect(Math.abs((crests[0]?.s ?? 0) - hyde.lengthM)).toBeLessThan(25);
    const others = crests.filter((c) => Math.abs(c.s - hyde.lengthM) > 25);
    expect(others[0]?.v).toBeGreaterThan(40);
    // The first hairpin begins within 12 m past the crest.
    const first = hairpins(crooked).length > 0;
    expect(first).toBe(true);
    const k = col(crooked, 'kappa');
    const at = k.findIndex((v) => Math.abs(v) > 1 / 15) * crooked.sampleSpacingM;
    expect(at).toBeLessThan(12);
  });
});

// Playtest 4 (the identity sheets, cause 8): the deck's own traffic-area tag lives in the committed
// road and in the config that bakes it, so a re-bake gives it back (the OSM extract is not in the
// repo; this holds the two to each other, as routes-pnw-dressing.test.ts does for Bridge City).
describe('the Golden Gate deck carries its traffic-area tag in the config and in the baked road', () => {
  interface ConfigRoad {
    id: string;
    deckTags?: string[];
  }
  const config = JSON.parse(readFileSync('tools/gis/networks/osm-sf-golden-gate.json', 'utf8')) as {
    lines: { roads?: ConfigRoad[] }[];
  };
  const roads = config.lines.flatMap((l) => l.roads ?? []);
  const region = JSON.parse(readFileSync(`${PACK}/region.json`, 'utf8')) as {
    traffic: { areas?: { tag: string }[] };
  };
  const areaTags = new Set((region.traffic.areas ?? []).map((a) => a.tag));

  it('each deck tag in the config covers every bridge run of its road, in the baked tags', () => {
    const decked = roads.filter((r) => (r.deckTags ?? []).length > 0);
    expect(decked.map((r) => r.id)).toContain('osm-sf-gg-bridge');
    for (const r of decked) {
      const tags = road(r.id).tags ?? [];
      const bridges = tags.filter((t) => t.tag === 'bridge');
      expect(bridges.length, `${r.id} has a bridge run`).toBeGreaterThan(0);
      for (const b of bridges)
        for (const name of r.deckTags ?? [])
          expect(
            tags.some((t) => t.tag === name && t.s0 === b.s0 && t.s1 === b.s1 && t.side === 'both'),
            `${r.id}: ${name} over the bridge at ${b.s0}-${b.s1}`,
          ).toBe(true);
    }
  });

  it("a baked road carries the deck tag only if the config asks for it, and the region's areas name it", () => {
    const configured = new Set(roads.filter((r) => (r.deckTags ?? []).includes('gg-deck')).map((r) => r.id));
    for (const id of [
      'osm-sf-gg-hawk-hill',
      'osm-sf-gg-conzelman',
      'osm-sf-gg-vista-point',
      'osm-sf-gg-bridge',
      'osm-sf-gg-toll-plaza',
    ])
      expect(
        (road(id).tags ?? []).some((t) => t.tag === 'gg-deck'),
        id,
      ).toBe(configured.has(id));
    expect(areaTags.has('gg-deck')).toBe(true);
  });
});
