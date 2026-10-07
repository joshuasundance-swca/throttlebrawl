// A road's edge kit keeps off its siblings (polish J2; the maintainer, 2026-10-06: "a road race in a physical
// world with honest edges": a thing drawn in a lane that the rider rides through is a ghost). Where two roads
// overlap at a split or a join, the verge's fence, brush and hedge, a guardrail, a bridge's rail and posts and
// its bays stop where the other road's lanes begin, and start again past them. The ride-column check
// (road-clear-*.test.ts) holds the drawn triangles; these tests hold the plan behind them, with the places the
// maintainer's phone found, and say what each examined.
import { describe, expect, it } from 'vitest';
import type { RoadNetwork } from '../road';
import { BARE_BAYS, BAY_KINDS, BAY_M } from './bridge-bays';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { EdgeLocator, laneExtentAt } from './overlap';
import { buildRoadScene, networkTags } from './road-mesh';
import { print, track } from './scene-cost.test-util';
import { VergeLayer } from './verge';

const look = createFlatLook();

/**
 * Whether a world point lies over another edge's lanes (within `margin`), by the existing `at` lookup and
 * the lanes' own extent: a different route to the answer than `onLanes`'s vertex map.
 */
function overLanes(road: RoadNetwork, loc: EdgeLocator, x: number, z: number, except: number, margin = 0) {
  return loc.at(x, z, except).some((h) => {
    const [lo, hi] = laneExtentAt(road, h.edge, h.s);
    return h.d > lo - margin && h.d < hi + margin;
  });
}

describe('EdgeLocator.onLanes: another road’s lanes under a point', () => {
  const { road } = track('keys-m1');
  const loc = new EdgeLocator(road);
  const mine = road.edgeIndex('m1-boat-ramp-cut');
  const other = road.edgeIndex('m1-marina-bends');

  it('finds the marina split’s other road under the bends’ start, and nothing under open road', () => {
    // Walking the boat ramp cut's centre line from its start, it lies over the bends' lanes for a stretch.
    const under: number[] = [];
    for (let s = 0; s <= 80; s += 2) {
      const p = road.toWorld(mine, s, 0, 0);
      if (loc.onLanes(p.x, p.z, mine)) under.push(s);
    }
    expect(under.length, 'the cut lies over the bends’ lanes for a stretch').toBeGreaterThan(3);
    // The control: mid-road, far from any split, is under no other road's lanes (so a "true" is not everything).
    const mid = road.toWorld(mine, 400, 0, 0);
    expect(loc.onLanes(mid.x, mid.z, mine)).toBe(false);
    print(
      `[examined] onLanes: the cut’s centre is over the bends’ lanes at ${under.length} of 41 points of s 0-80, mid-road (s 400) is not`,
    );
  });

  it('widens by the margin and agrees with the lookup it replaces, on a sweep of the split', () => {
    let agree = 0;
    let onCount = 0;
    for (const edge of [mine, other]) {
      const e = road.edges[edge]!;
      for (let s = 0; s <= Math.min(e.length, 120); s += 2) {
        for (const d of [-9, -6, -3, 0, 3, 6, 9]) {
          const p = road.toWorld(edge, s, d, 0);
          for (const margin of [0, 0.5]) {
            const a = loc.onLanes(p.x, p.z, edge, margin);
            const b = overLanes(road, loc, p.x, p.z, edge, margin);
            expect(a, `edge ${e.id} s ${s} d ${d} margin ${margin}`).toBe(b);
            agree++;
            if (a) onCount++;
          }
        }
      }
    }
    expect(onCount, 'the sweep reaches the other road’s lanes').toBeGreaterThan(50);
    expect(onCount, 'and not all of the ground').toBeLessThan(agree);
    print(
      `[examined] onLanes against at()+lanes: ${agree} points of the marina split and its bends, ${onCount} under lanes`,
    );
  });

  it('takes the margin: a point 0.1 m past the other road’s lanes is under them only with 0.3 m of room', () => {
    const p0 = road.toWorld(mine, 12, 0, 0);
    const h = loc.at(p0.x, p0.z, mine).find((x) => x.edge === other);
    expect(h, 'the main road runs under the bends’ start').toBeDefined();
    const [, hi] = laneExtentAt(road, other, h!.s);
    const out = road.toWorld(other, h!.s, hi + 0.1, 0);
    expect(overLanes(road, loc, out.x, out.z, mine, 0)).toBe(false);
    expect(overLanes(road, loc, out.x, out.z, mine, 0.3)).toBe(true);
    expect(loc.onLanes(out.x, out.z, mine, 0)).toBe(false);
    expect(loc.onLanes(out.x, out.z, mine, 0.3)).toBe(true);
  });
});

describe('the verge fence stops where the marina split’s other road begins, and starts again past it', () => {
  const { road, dressing } = track('keys-m1');
  const verge = new VergeLayer(road, look, { tags: networkTags(road, dressing).tags });
  const loc = new EdgeLocator(road);

  it('draws no fence panel over another road’s lanes, and every panel left out lay over them', () => {
    let drawn = 0;
    let left = 0;
    let ghosts = 0;
    let wrongly = 0;
    const where: string[] = [];
    for (const id of [
      'c-marina-split-main',
      'm1-marina-bends',
      'c-marina-merge-main',
      'c-boat-ramp-in',
      'm1-boat-ramp-cut',
      'c-boat-ramp-out',
    ]) {
      const e = road.edgeIndex(id);
      const edge = road.edges[e]!;
      for (const side of [-1, 1] as const) {
        for (let s0 = 0; s0 + 2 <= edge.length; s0 += 2) {
          const v = road.vergeAt(e, s0 + 1, side < 0 ? 'left' : 'right');
          if (v.widthM < 0.5 || v.edge !== 'fence') continue;
          const lines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
            const q = road.toWorld(
              e,
              s0 + 2 * t,
              road.vergeAt(e, s0 + 2 * t, side < 0 ? 'left' : 'right').dOuter,
              0,
            );
            return overLanes(road, loc, q.x, q.z, e, 0.2);
          });
          const over = lines.some(Boolean);
          // The layer's own answer: smash counts the panels that overlap [s0 + 0.5, s0 + 1.5] on a side.
          const there = verge.smash(e, side, s0 + 0.5, s0 + 1.5) > 0;
          if (there) {
            drawn++;
            if (over) ghosts++;
          } else {
            left++;
            if (!over) wrongly++;
            if (where.length < 6) where.push(`${id} s ${s0}`);
          }
        }
      }
    }
    expect(ghosts, 'panels drawn over another road’s lanes').toBe(0);
    expect(wrongly, 'panels left out with no other road under them').toBe(0);
    expect(
      left,
      'the split’s overlap leaves some out (the control: the check can see a hole)',
    ).toBeGreaterThan(10);
    expect(drawn, 'and the fence starts again past it').toBeGreaterThan(50);
    print(
      `[examined] marina split fence: ${drawn} panels drawn, ${left} left out over another road (${where.join(', ')}...)`,
    );
  });
});

describe('the Seven Mile’s bays: those whose rails or walls would stand in another road’s lanes are placed bare', () => {
  it('flags each bay with a roadside part over a sibling’s lanes, and no other', async () => {
    const { road, dressing } = track('osm-keys-seven-mile');
    const kit = await bakeRepoModel('sevenMileKit');
    const scene = buildRoadScene(road, look, dressing, { seed: 1, models: { sevenMileKit: kit } });
    const loc = new EdgeLocator(road);
    let bare = 0;
    let whole = 0;
    let wrong = 0;
    const kinds = new Map<string, number>();
    for (const spot of scene.bays) {
      const kind = BAY_KINDS[spot.variant]!;
      const part = BARE_BAYS[kind];
      if (!part) {
        expect(spot.bare, `${kind} has nothing above its deck`).toBeUndefined();
        continue;
      }
      // Independent of the plan's sampling: every metre along the bay, at each part's line, a little more room.
      let over = false;
      for (let s = spot.s; s <= spot.s + BAY_M[kind] && !over; s += 1) {
        for (const d of part.across.flatMap((x) => [-x, x])) {
          const p = road.toWorld(spot.edge, Math.min(s, road.edges[spot.edge]!.length), d, 0);
          if (overLanes(road, loc, p.x, p.z, spot.edge, 0.45)) over = true;
        }
      }
      if (spot.bare) {
        bare++;
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        // A flagged bay was flagged for a reason the one-metre sweep also finds (it may be slightly wider).
        if (!over) wrong++;
      } else {
        whole++;
        // A whole bay has nothing over another road at the same room (the plan's probe is every 1/8 bay).
        expect(
          over,
          `${kind} on ${road.edges[spot.edge]!.id} s ${spot.s.toFixed(0)} stands bare-worthy but whole`,
        ).toBe(false);
      }
    }
    expect(bare, 'the old road’s split and join put bays over the bridge’s lanes').toBeGreaterThan(0);
    expect(whole, 'and most stand whole').toBeGreaterThan(bare);
    expect(wrong, 'bare bays with nothing over another road').toBe(0);
    print(
      `[examined] seven-mile bays: ${bare} bare (${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}), ${whole} whole`,
    );
  }, 120_000);

  it('bakes each bare variant with nothing above its deck (the whole one stands up to a metre over it)', async () => {
    const kit = await bakeRepoModel('sevenMileKit');
    const top = (i: number) => {
      const g = kit.variants[i]!;
      g.computeBoundingBox();
      return g.boundingBox!.max.y;
    };
    const rows: string[] = [];
    for (const [name, part] of Object.entries(BARE_BAYS)) {
      const whole = top(BAY_KINDS.indexOf(name as (typeof BAY_KINDS)[number]));
      const bare = top(part.variant);
      rows.push(`${name} ${whole.toFixed(2)} m -> ${bare.toFixed(2)} m`);
      expect(bare, `${name} bare`).toBeLessThanOrEqual(0);
      // The control: the whole bay does stand over the deck, so the cut is what took it off.
      expect(whole, `${name} whole`).toBeGreaterThan(0.5);
      expect(
        kit.variants[part.variant]!.getAttribute('position').count,
        `${name} keeps its underside`,
      ).toBeGreaterThan(30);
    }
    print(`[examined] bare bay variants, highest point over the deck: ${rows.join('; ')}`);
  });
});
