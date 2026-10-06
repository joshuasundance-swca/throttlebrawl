// Smathers' salt ponds read as shallow water in every look and at every time of day (polish J3, punch item 3 of polish
// G's check; the ponds of #630, playtest 4 run B's fix check). The live check sampled the ponds at golden hour as #c1814f
// beside the sea's #1c6b64: rust-brown, "mud flats more than water", not the pale olive #a8b47c the lane chose. The
// cause: a water tint multiplies the LOOK's own water colour, and #630's pond was a tint over the classic water, whose
// red is 0.01 (linear) against the ink looks' 0.013 to 0.03: the pond's red tint of about 40 made the ink looks' pond
// orange (hue 56 to 64 degrees in every ink look at every time of day, in the model below). The colour drawn is now the
// pond's own in every look (sea-bands.ts `seaTintAt`'s `water`).
//
// What is asked, in the colour the player sees (lit-water.test-util.ts: the look's water colour, the time of day's
// exposure or the classic look's hemisphere and sun, the film grade): at every look (classic, kodak, wasteland, brush) and
// every time of day (dawn, noon, golden hour, dusk, night) the pond in the middle reads as water of its own, not the
// sea's and not mud: well apart from every colour of the sea (shallows, seagrass and sand patches), paler than the
// shallows, in the greens (hue 95 to 185 degrees: not orange, not brown), with some colour to it; and its edge stays a
// shade of the pond, never a brown. Controls: the pond as #630 shipped it fails the hue check in the ink looks, and
// the same spot without its pond is the sea's colour.
import { Color, Scene, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import {
  deltaE,
  hueChroma,
  lab,
  litSea,
  LOOK_IDS_LIT,
  regionPalette,
  TIMES_OF_DAY,
  type Rgb,
} from './lit-water.test-util';
import { CLASSIC_PALETTE, createFlatLook } from './look';
import { createLookSet } from './looks';
import type { RoadDressing } from './road-mesh';
import { SeaBands, seaPlanFor, seaTintAt, type SeaPlan } from './sea-bands';
import type { SideTag } from './scenery';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

const KW = 'osm-keys-key-west';
const BEACH = 'osm-kw-smathers-beach';
const POND_S = 2025;

/** The Key West sea plan, with or without the Smathers ponds' tag, and a way to read the sea's tint beside the road. */
function plan(without = false): {
  road: RoadNetwork;
  plan: SeaPlan;
  at: (
    s: number,
    side: -1 | 1,
    across: number,
    water?: readonly number[],
    seed?: number,
  ) => readonly number[];
} {
  const t = track(KW);
  const dressing = without
    ? ({
        ...t.dressing,
        [BEACH]: {
          ...(t.dressing[BEACH] as unknown as BakedRoad),
          tags: ((t.dressing[BEACH] as unknown as BakedRoad).tags as readonly SideTag[]).filter(
            (x) => x.tag !== 'salt-pond',
          ),
        },
      } as unknown as RoadDressing)
    : t.dressing;
  const p = seaPlanFor(t.road, (e) => dressing[e.id]?.tags);
  if (!p) throw new Error('no plan');
  const edge = t.road.edges[t.road.edgeIndex(BEACH)]!;
  const half = Math.max(-edge.dMin, edge.dMax);
  return {
    road: t.road,
    plan: p,
    at(s, side, across, water, seed = 1) {
      const w = t.road.toWorld(edge.index, s, side * (half + 0.6 + across), 0);
      return seaTintAt(p, w.x, w.z, seed, water as [number, number, number] | undefined);
    },
  };
}

/** The tint #630 shipped: its olive over the classic water's own colour, whatever look it is multiplied by. */
const SHIPPED = (() => {
  const c = new Color('#a8b47c');
  const base = new Color(CLASSIC_PALETTE.water);
  return [c.r / base.r, c.g / base.g, c.b / base.b];
})();

const HUE_FROM = 95;
const HUE_TO = 185;
const APART = 20;

describe('the Smathers salt ponds, as the player sees them in every look and at every time of day', () => {
  const ks = plan();
  // Every colour the sea shows near and far from the Smathers road (the sea does not depend on the water colour it multiplies).
  const seaTints: (readonly number[])[] = [];
  for (const seed of [1, 2, 3, 4, 5])
    for (let s = 100; s <= 4600; s += 150)
      for (const across of [60, 150, 300, 600, 1200]) seaTints.push(ks.at(s, -1, across, undefined, seed));

  for (const look of LOOK_IDS_LIT) {
    for (const time of TIMES_OF_DAY) {
      it(`${look} at ${time}: the pond is its own water, pale and green, apart from the sea`, () => {
        const sea = litSea(look, time);
        const pond = sea.lit(ks.at(POND_S, 1, 45, sea.water));
        const edge = sea.lit(ks.at(POND_S, 1, 1, sea.water));
        const shallows = sea.lit([1, 1, 1]);
        const seas = seaTints.map((t) => sea.lit(t));
        const apart = Math.min(...seas.map((c) => deltaE(lab(c), lab(pond))));
        const { hue, chroma } = hueChroma(pond);
        const edgeHue = hueChroma(edge).hue;
        print(
          `${look} at ${time}: pond ${hex(pond)} (hue ${hue.toFixed(0)}, chroma ${chroma.toFixed(0)}, ${apart.toFixed(0)} from the nearest sea colour, ${(lab(pond)[0] - lab(shallows)[0]).toFixed(0)} paler than the shallows ${hex(shallows)}); edge ${hex(edge)} (hue ${edgeHue.toFixed(0)})`,
        );
        expect(apart, 'colour distance (Lab) from the nearest sea colour').toBeGreaterThanOrEqual(APART);
        expect(lab(pond)[0] - lab(shallows)[0], 'lightness over the shallows (Lab L)').toBeGreaterThanOrEqual(
          8,
        );
        expect(hue, 'hue of the pond (degrees)').toBeGreaterThanOrEqual(HUE_FROM);
        expect(hue, 'hue of the pond (degrees)').toBeLessThanOrEqual(HUE_TO);
        expect(chroma, 'chroma of the pond').toBeGreaterThanOrEqual(12);
        // The edge: a darker shade of the pond, in the same greens and never brown.
        expect(lab(edge)[0], 'the edge is darker than the middle').toBeLessThan(lab(pond)[0] - 5);
        expect(edgeHue, 'hue of the edge (degrees)').toBeGreaterThanOrEqual(80);
        expect(edgeHue, 'hue of the edge (degrees)').toBeLessThanOrEqual(HUE_TO);
      });
    }
  }

  it('the measure can tell: the pond as #630 shipped it is orange in every ink look (control)', () => {
    for (const look of ['kodak', 'wasteland', 'brush'] as const) {
      for (const time of TIMES_OF_DAY) {
        const shipped = litSea(look, time).lit(SHIPPED);
        expect(hueChroma(shipped).hue, `${look} at ${time}: ${hex(shipped)}`).toBeLessThan(HUE_FROM);
      }
    }
    // And the live check's own frame: kodak at golden hour, rust-brown, the sampled #c1814f's hue (about 28 to 63 degrees).
    expect(hueChroma(litSea('kodak', 'golden-hour').lit(SHIPPED)).hue).toBeLessThan(70);
  });

  it('the measure can tell: the same spot without its pond tag is the sea`s colour (control)', () => {
    const none = plan(true);
    for (const look of LOOK_IDS_LIT) {
      const sea = litSea(look, 'golden-hour');
      const spot = sea.lit(none.at(POND_S, 1, 45, sea.water));
      const nearest = Math.min(...seaTints.map((t) => deltaE(lab(sea.lit(t)), lab(spot))));
      expect(nearest, look).toBeLessThan(APART);
    }
  });
});

describe('the sea mesh draws the pond in the look it is in, and again when the look changes', () => {
  const ks = plan();
  const edge = ks.road.edges[ks.road.edgeIndex(BEACH)]!;
  const half = Math.max(-edge.dMin, edge.dMax);
  const spot = ks.road.toWorld(edge.index, POND_S, half + 0.6 + 45, 0);
  const start = ks.road.toWorld(edge.index, POND_S, 0, 0);

  /** The colour of the vertex nearest the pond's middle, and where that vertex is. */
  const vertexAt = (sea: SeaBands) => {
    const pos = sea.mesh.geometry.getAttribute('position') as BufferAttribute;
    const col = sea.mesh.geometry.getAttribute('color') as BufferAttribute;
    let best = 0;
    let d = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const dd = Math.hypot(pos.getX(i) - spot.x, pos.getZ(i) - spot.z);
      if (dd < d) {
        d = dd;
        best = i;
      }
    }
    return { x: pos.getX(best), z: pos.getZ(best), colour: [col.getX(best), col.getY(best), col.getZ(best)] };
  };

  it('paints the vertex the tint that makes the pond its colour over the look`s own water, and repaints it when the look changes', () => {
    const set = createLookSet(createFlatLook());
    set.setupScene(new Scene(), {
      timeOfDay: 'golden-hour',
      palette: regionPalette('florida-keys', 'golden-hour'),
    });
    set.select('kodak');
    const sea = new SeaBands(ks.plan, set, 1, { x: start.x, z: start.z, halfX: 20000, halfZ: 20000 }, start);
    const water = (): [number, number, number] => {
      const c = (sea.mesh.material as unknown as { color: Color }).color;
      return [c.r, c.g, c.b];
    };
    const near = (a: readonly number[], b: readonly number[]) =>
      a.forEach((v, k) => expect(v / (b[k] ?? 1), `channel ${k}`).toBeCloseTo(1, 4));
    const kodak = vertexAt(sea);
    near(kodak.colour, seaTintAt(ks.plan, kodak.x, kodak.z, 1, water()));
    const kodakWater = water();
    // A look that changes the water colour: the same vertex is made again for it.
    set.select('wasteland');
    expect(water()).not.toEqual(kodakWater);
    sea.update(start.x, start.z);
    const wasteland = vertexAt(sea);
    near(wasteland.colour, seaTintAt(ks.plan, wasteland.x, wasteland.z, 1, water()));
    expect(wasteland.colour).not.toEqual(kodak.colour);
    // The control: seen through the classic water colour, as before this change, it would be neither.
    expect(seaTintAt(ks.plan, kodak.x, kodak.z, 1)).not.toEqual(kodak.colour);
  });
});

const hex = (rgb: Rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
