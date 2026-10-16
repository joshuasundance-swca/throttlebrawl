import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  readConnector,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../../src/road';
import { BARRIER_LOOK_STYLES, barrierLookAt } from '../../src/render/barrier-looks';
import { sizeOfBoard } from '../../src/render/boards';
import { createFlatLook } from '../../src/render/look';
import { EdgeLocator, laneExtentAt } from '../../src/render/overlap';
import { VergeLayer } from '../../src/render/verge';

// I-5 over the Chuckanut Mountains (playtest 4, P4-19, run C5; the identity sheets' I1): the interstate
// district. Its tag, its concrete bridge parapets, its wide shoulder and the guard rail at the
// shoulder's edge, and the boards that stand outside it, live in the committed roads and in the config
// that bakes them (networks/osm-pnw-samish.json), so a re-bake gives them back. Without the OSM extract
// this test cannot re-bake, so it holds the two to each other (as routes-pnw-dressing.test.ts does for
// Bridge City) and then checks the rules the dressing is for on the real network.

const REGION = 'packs/region-pnw/regions/pacific-northwest';

interface Json {
  [key: string]: unknown;
}
interface Tag {
  s0: number;
  s1: number;
  side: string;
  tag: string;
}
interface Barrier {
  s0: number;
  s1: number;
  side: string;
  kind: string;
  heightM: number;
  look?: string;
}
interface Feature extends Json {
  id: string;
  kind: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
}
interface Road {
  id: string;
  tags: Tag[];
  barriers: Barrier[];
  features: Feature[];
}
interface ConfigRoad {
  id: string;
  tags?: string[];
  deckTags?: string[];
  features?: Feature[];
}

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const config = read<{
  lines: { id: string; roads?: ConfigRoad[]; bridgeBarrier?: Json }[];
}>('tools/gis/networks/osm-pnw-samish.json');
const i5 = config.lines.find((l) => l.id === 'i5');
/** Authored I-5 road fragments, selected by their source tag so host cuts do not freeze a replacement list here. */
const MAIN = (i5?.roads ?? []).filter((r) => r.tags?.includes('interstate')).map((r) => r.id);
const baked = (id: string) => read<Road>(`${REGION}/roads/${id}.json`);
const network = read<BakedNetwork>(`${REGION}/networks/osm-pnw-samish.json`);
const roads = network.roads.map(baked);
const road: RoadNetwork = createRoadNetwork({ network, roads: roads as unknown as BakedRoad[] });
const rangesOf = (r: Road, name: string) =>
  r.tags.filter((t) => t.tag === name && t.side === 'both').map((t) => [t.s0, t.s1]);
const mainSet = new Set(MAIN);
/** Generated through pieces whose normalized connector rows join two authored I-5 host fragments. */
const through = network.junctions.flatMap((junction) =>
  junction.connectors.flatMap((raw) => {
    const row = readConnector(raw);
    return row && mainSet.has(row.from.road) && mainSet.has(row.to.road) ? [row.road] : [];
  }),
);
const expectedSet = new Set([...MAIN, ...through]);
const EXPECTED_INTERSTATE = network.roads.filter((id) => expectedSet.has(id));
const ACTUAL_INTERSTATE = network.roads.filter((id) => rangesOf(baked(id), 'interstate').length > 0);

describe('I-5 is an interstate district in the bake config and in the baked roads alike', () => {
  it('lists the interstate tag on every road of the highway, and a deck tag so the bridges keep it', () => {
    const cfgRoads = i5?.roads ?? [];
    expect(MAIN.length).toBeGreaterThan(0);
    expect(cfgRoads.map((r) => r.id)).toEqual(MAIN);
    for (const r of cfgRoads) {
      expect(r.tags, r.id).toContain('interstate');
      expect(r.tags, `${r.id} keeps the forest beside it`).toContain('forest');
      expect(network.roads, `${r.id} is emitted`).toContain(r.id);
    }
    for (const r of cfgRoads.filter((c) => baked(c.id).tags.some((t) => t.tag === 'bridge')))
      expect(r.deckTags, `${r.id} has a bridge`).toContain('interstate');
  });

  it('covers every forest stretch and bridge deck on the emitted interstate cohort, including host-cut pieces', () => {
    let examined = 0;
    expect(ACTUAL_INTERSTATE, 'only source hosts and their generated through pieces carry the tag').toEqual(
      EXPECTED_INTERSTATE,
    );
    for (const id of EXPECTED_INTERSTATE) {
      const r = baked(id);
      expect(rangesOf(r, 'interstate').length, id).toBeGreaterThan(0);
      const want = [...rangesOf(r, 'forest'), ...rangesOf(r, 'bridge')].sort(
        (a, b) => (a[0] ?? 0) - (b[0] ?? 0),
      );
      const got = rangesOf(r, 'interstate').sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
      expect(got, id).toEqual(want);
      examined += got.length;
    }
    console.log(`[examined] ${EXPECTED_INTERSTATE.length} roads, ${examined} interstate runs`);
    // The shore drives and the branch ramps are not the interstate.
    for (const id of network.roads.filter((x) => !expectedSet.has(x)))
      expect(rangesOf(baked(id), 'interstate'), id).toEqual([]);
  });

  it('stands a concrete wall on each bridge, as the config says, and no barrier anywhere else', () => {
    const want = i5?.bridgeBarrier as Json;
    expect(want).toMatchObject({ kind: 'wall', look: 'concrete' });
    let bridges = 0;
    for (const id of MAIN) {
      const r = baked(id);
      const decks = r.tags.filter((t) => t.tag === 'bridge');
      expect(r.barriers.length, id).toBe(decks.length);
      for (const d of decks) {
        bridges++;
        expect(r.barriers, `${id} at ${d.s0}`).toContainEqual({
          s0: d.s0,
          s1: d.s1,
          side: 'both',
          kind: want['kind'],
          heightM: want['heightM'],
          look: want['look'],
        });
      }
    }
    expect(bridges).toBeGreaterThanOrEqual(2);
    // The concrete parapet is drawn at the height its panel is built to.
    expect(want['heightM']).toBe(BARRIER_LOOK_STYLES.concrete.heightM);
  });

  it('lists every board and zone of its roads in the baked road, the same, and the road has no others', () => {
    for (const c of i5?.roads ?? []) {
      const r = baked(c.id);
      for (const f of c.features ?? [])
        expect(
          r.features.find((x) => x.id === f.id),
          `${c.id}: ${f.id}`,
        ).toMatchObject(f);
      expect(r.features.map((x) => x.id).sort(), c.id).toEqual((c.features ?? []).map((f) => f.id).sort());
    }
  });
});

describe('the interstate district, drawn on the real network', () => {
  const verge = new VergeLayer(road, createFlatLook(), { tags: new Set(['forest', 'interstate']) });
  const mainEdges = road.edges.filter((e) => e.tags.some((t) => t.tag === 'interstate'));

  it('has a paved shoulder wider than the lanes own on both sides of every interstate road, ending hard', () => {
    expect(mainEdges.map((e) => e.id).sort()).toEqual([...EXPECTED_INTERSTATE].sort());
    for (const e of mainEdges)
      for (const side of ['left', 'right'] as const) {
        const v = road.vergeAt(e.index, e.length / 2, side);
        const bridge = e.barriers.some((b) => b.s0 <= e.length / 2 && b.s1 >= e.length / 2);
        if (bridge) continue;
        expect(v.surface, `${e.id} ${side}`).toBe('shoulder');
        expect(v.edge, `${e.id} ${side}`).toBe('hard');
        expect(v.widthM, `${e.id} ${side}`).toBeGreaterThanOrEqual(3);
      }
  });

  it('draws every concrete parapet panel except where its segment crosses another road’s lanes', () => {
    const looks = verge.counts().looks;
    const guard = looks['guardrail']?.panels ?? 0;
    const concrete = looks['concrete']?.panels ?? 0;
    const total = mainEdges.reduce((n, e) => n + e.length, 0);
    const decks = mainEdges.flatMap((e) => e.barriers.map((b) => b.s1 - b.s0));
    expect(Object.keys(looks).sort()).toEqual(['concrete', 'guardrail']);
    const points = verge.lookPanelPoints('concrete');
    const locator = new EdgeLocator(road);
    const style = BARRIER_LOOK_STYLES.concrete;
    let drawn = 0;
    let left = 0;
    let ghosts = 0;
    let wrongly = 0;
    for (const e of mainEdges) {
      for (const side of [-1, 1] as const) {
        const name = side < 0 ? 'left' : 'right';
        const lane = side < 0 ? e.dMin : e.dMax;
        for (const barrier of e.barriers) {
          if (barrier.side !== 'both' && barrier.side !== name) continue;
          const s1 = Math.min(e.length, barrier.s1);
          for (let s0 = Math.max(0, barrier.s0); s0 < s1 - 1e-6; s0 += style.segM) {
            expect(barrierLookAt(barrier, e.tags, name, s0), `${e.id} ${name} s ${s0}`).toBe('concrete');
            const end = Math.min(s1, s0 + style.segM);
            const d = lane + side * style.outM;
            const a = road.toWorld(e.index, s0, d, 0);
            const b = road.toWorld(e.index, end, d, 0);
            const x = (a.x + b.x) / 2;
            const z = (a.z + b.z) / 2;
            const there = points.some((p) => Math.hypot(p.x - x, p.z - z) < 0.01);
            const crossing = [0, 0.25, 0.5, 0.75, 1].some((t) =>
              locator.at(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, e.index).some((hit) => {
                const [lo, hi] = laneExtentAt(road, hit.edge, hit.s);
                return hit.d > lo - 0.3 && hit.d < hi + 0.3;
              }),
            );
            if (there) {
              drawn++;
              if (crossing) ghosts++;
            } else {
              left++;
              if (!crossing) wrongly++;
            }
          }
        }
      }
    }
    expect(drawn, 'the public panel list contains every planned concrete panel').toBe(points.length);
    expect(drawn, 'the bridges retain concrete parapets away from crossings').toBeGreaterThan(0);
    expect(left, 'a live-lane crossing exercises the omission rule').toBeGreaterThan(0);
    expect(ghosts, 'concrete panels drawn through another road’s lanes').toBe(0);
    expect(wrongly, 'concrete panels omitted without another road under them').toBe(0);
    expect(concrete).toBe(drawn);
    console.log(`[examined] concrete parapets: ${drawn} drawn, ${left} omitted over other lanes`);
    // Two rails the whole way, less the decks and the stretches a branch leaves or joins by (the lead-in).
    const possible = (2 * (total - decks.reduce((a, b) => a + b, 0))) / BARRIER_LOOK_STYLES.guardrail.segM;
    console.log(
      `[examined] ${guard} guard rail panels of ${possible.toFixed(0)} the roads could carry, ${concrete} concrete`,
    );
    expect(guard).toBeGreaterThan(0.8 * possible);
    expect(guard).toBeLessThanOrEqual(possible);
  });

  it('keeps every rail panel clear of the branch ramps, which cross the shoulder', () => {
    const ramps = road.edges.filter((e) => e.isConnector && !e.tags.some((t) => t.tag === 'interstate'));
    expect(ramps.length, 'the branch has connector roads').toBeGreaterThanOrEqual(2);
    // A ramp is a 6 m lane: a rail panel within its width of the ramp's line would stand across it.
    const halfM = 3 + BARRIER_LOOK_STYLES.guardrail.segM / 2;
    let nearest = Infinity;
    for (const p of verge.lookPanelPoints('guardrail'))
      for (const e of ramps)
        for (let i = 0; i < e.count; i += 1) {
          const d = Math.hypot((e.x[i] ?? 0) - p.x, (e.z[i] ?? 0) - p.z);
          if (d < nearest) nearest = d;
        }
    console.log(`[examined] nearest rail panel to a ramp's line: ${nearest.toFixed(1)} m (limit ${halfM} m)`);
    expect(nearest).toBeGreaterThan(halfM);
  });

  it('stands every sign, billboard and pullout outside the guard rail, and the cop lot inside it', () => {
    let boards = 0;
    for (const e of mainEdges) {
      for (const f of baked(e.id).features) {
        const mid = (f.s0 + f.s1) / 2;
        const side = f.d0 + f.d1 < 0 ? 'left' : 'right';
        const rail = Math.abs(road.vergeAt(e.index, mid, side).dOuter);
        if (f.kind === 'copSpawn') {
          expect(
            Math.max(Math.abs(f.d0), Math.abs(f.d1)),
            `${f.id} stays on the paved shoulder`,
          ).toBeLessThanOrEqual(rail);
          continue;
        }
        if (f.kind !== 'billboard' && f.kind !== 'roadsideZone') continue;
        let near = Math.min(Math.abs(f.d0), Math.abs(f.d1));
        if (f.kind === 'billboard') {
          // A board is as wide as its size says (boards.ts): its near edge is its centre less half of that.
          const kind = f.pool === 'billboards' ? 'billboard' : 'sign';
          const size = sizeOfBoard(
            kind,
            (f.params as { style?: 'guide' } | undefined)?.style === 'guide' ? 'guide' : 'default',
          );
          const w = Math.min(size.maxW, Math.max(size.minW, Math.abs(f.d1 - f.d0)));
          near = Math.abs(f.d0 + f.d1) / 2 - w / 2;
          boards++;
        }
        expect(near, `${f.id} (${e.id}) stands past the rail at ${rail.toFixed(1)} m`).toBeGreaterThan(rail);
      }
    }
    expect(boards).toBeGreaterThanOrEqual(8);
  });

  it('puts exit words on every guide sign: each names a live sign of the region, and none draws from the pool', () => {
    const region = read<{ signs: { id: string; text: string; status?: string }[] }>(`${REGION}/region.json`);
    const items: string[] = [];
    for (const e of mainEdges) {
      for (const f of baked(e.id).features) {
        if (f.kind !== 'billboard' || (f.params as { style?: string } | undefined)?.style !== 'guide')
          continue;
        expect(f['pool'], `${f.id} must not draw a random sign`).toBeUndefined();
        const sign = region.signs.find((s) => s.id === f['item']);
        expect(sign, `${f.id} names a sign of the region`).toBeDefined();
        expect(sign?.status, f.id).toBe('live');
        // A headline in capitals, then a plain line: the shape every sign's words have.
        expect(sign?.text, f.id).toMatch(/^[A-Z0-9][A-Z0-9 ,:'-]*\. \S/);
        items.push(String(f['item']));
      }
    }
    expect(new Set(items).size, 'each guide sign has words of its own').toBe(items.length);
    expect(items.length).toBeGreaterThanOrEqual(5);
  });
});
