import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { roadNetworkSchema, roadSchema, routeSchema } from '../../src/content/schema';
import {
  compileTrack,
  createRoadNetwork,
  createRouteProgress,
  curvedRoadRates,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
  type RoadPos,
} from '../../src/road';
import { KEYS_M1 } from './tracks/keys-m1';

// The M1 track as baked into the pack (M1 road-1 acceptance): the files are fresh, pass the
// content schemas and the road lint, and the queries behave on the real bends and junctions.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const region = path.join(root, 'packs/base/regions/florida-keys');
const read = (dir: string, id: string): unknown =>
  JSON.parse(readFileSync(path.join(region, dir, `${id}.json`), 'utf8')) as unknown;

const compiled = compileTrack(KEYS_M1);
const network = read('networks', 'keys-m1') as BakedNetwork;
const roads = network.roads.map((id) => read('roads', id) as BakedRoad);
// road-3: one route per race length, all on this network.
const ROUTE_IDS = ['m1-skeleton-sprint', 'm1-standard-run', 'm1-long-haul'] as const;
const routes = ROUTE_IDS.map((id) => read('routes', id) as BakedRoute);
const route = routes[0] as BakedRoute; // the short length: the M1 sprint
const net = createRoadNetwork({ network, roads });
const progress = createRouteProgress(net, route);

describe('tools/road: the baked M1 track', () => {
  it('is fresh: the pack files equal a new compile of tools/road/tracks/keys-m1.ts', () => {
    expect(network).toEqual(compiled.network);
    expect(roads).toEqual(compiled.roads);
    expect(routes).toEqual(compiled.routes);
  });

  it('passes the content schemas and the road lint with no issues', () => {
    expect(roadNetworkSchema.safeParse(network).success).toBe(true);
    for (const r of roads) expect(roadSchema.safeParse(r).success, r.id).toBe(true);
    for (const r of routes) expect(routeSchema.safeParse(r).success, r.id).toBe(true);
    const issues = lintRoadNetwork({ network, roads, routes });
    expect(issues).toEqual([]);
  });

  it('its short route is about 3.5 km of the M1 roads, joined end to end, with bridge humps', () => {
    console.log(
      `M1 track: ${roads.map((r) => `${r.id} ${r.lengthM.toFixed(1)} m`).join(', ')}; route ${progress.length.toFixed(1)} m`,
    );
    // road-2: four main roads and two connector roads on the main path, and the shortcut's three;
    // road-3: five more main roads past the Sandbar Causeway.
    expect(net.edges.length).toBe(14);
    expect(progress.mainEdges.map((e) => net.edges[e]?.id)).toEqual([
      'm1-marina-run',
      'c-marina-split-main',
      'm1-marina-bends',
      'c-marina-merge-main',
      'm1-pelican-bridge',
      'm1-sandbar-causeway',
    ]);
    expect(progress.length).toBeGreaterThan(3300);
    expect(progress.length).toBeLessThan(3800);
    expect(progress.distanceToFinish(progress.start.edge, progress.start.s)).toBeCloseTo(progress.length, 6);
    const ys = roads.flatMap((r) => r.samples.data['y'] ?? []);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(6); // exaggerated humps
    // Real bends both ways: tighter than 300 m radius somewhere, each way.
    const ks = roads.flatMap((r) => r.samples.data['kappa'] ?? []);
    expect(Math.max(...ks)).toBeGreaterThan(1 / 300);
    expect(Math.min(...ks)).toBeLessThan(-1 / 300);
  });

  it('has three or four roadside zones on the short route, a cop spawn, a start grid, a finish and checkpoints', () => {
    const all = net.edges.flatMap((e) => e.features);
    const short = net.edges.filter((e) => progress.allows(e.index)).flatMap((e) => e.features);
    const zones = short.filter((f) => f.kind === 'roadsideZone').length;
    expect(zones).toBeGreaterThanOrEqual(3);
    expect(zones).toBeLessThanOrEqual(4);
    expect(all.filter((f) => f.kind === 'copSpawn').length).toBe(1);
    expect(progress.startGrid).not.toBeNull();
    expect(progress.checkpoints.length).toBeGreaterThanOrEqual(1);
    for (const c of progress.checkpoints) {
      expect(c.progress).toBeGreaterThan(0);
      expect(c.progress).toBeLessThan(progress.length);
    }
    // The grid fits behind the start line.
    const g = progress.startGrid;
    expect(route.start.s - (g ? (g.rows - 1) * g.rowGapM : 0)).toBeGreaterThanOrEqual(0);
    // The bridge has rails both sides.
    const bridge = net.edgeIndex('m1-pelican-bridge');
    expect(net.barrierAt(bridge, 500, 'left')?.kind).toBe('rail');
    expect(net.barrierAt(bridge, 500, 'right')?.kind).toBe('rail');
  });

  it('playtest 1: travel lanes about 4 m wide (M1 had 3.4 m), with rideable shoulders both sides', () => {
    let checked = 0;
    for (const e of net.edges) {
      const lanes = net.lanesAt(e.index, e.length / 2);
      if (lanes.some((l) => l.kind === 'shortcut')) continue;
      const drive = lanes.filter((l) => l.kind === 'drive');
      const shoulders = lanes.filter((l) => l.kind === 'shoulder');
      expect(
        drive.map((l) => l.widthM),
        e.id,
      ).toEqual([4, 4]);
      expect(shoulders.map((l) => Math.sign(l.dCenterM)).sort(), e.id).toEqual([-1, 1]);
      for (const sh of shoulders) expect(sh.widthM, e.id).toBeGreaterThanOrEqual(1.5);
      // No gaps: the shoulder starts where the travel lane ends.
      expect(Math.min(...lanes.map((l) => l.dCenterM - l.widthM / 2)), e.id).toBeCloseTo(-5.5, 9);
      expect(Math.max(...lanes.map((l) => l.dCenterM + l.widthM / 2)), e.id).toBeCloseTo(5.5, 9);
      checked++;
    }
    expect(checked).toBe(11); // the long route's main path: nine roads and two connectors
  });

  it('road-3: three race lengths, short, standard and long, each longer route carrying on from the last', () => {
    // M2's starting numbers: about 2, 4 and 6 minutes at M1's 29–32 m/s average.
    const want = [
      [3300, 3800],
      [7000, 7700],
      [10400, 11500],
    ] as const;
    const lines: string[] = [];
    routes.forEach((r, i) => {
      const p = createRouteProgress(net, r);
      const [lo, hi] = want[i] ?? [0, 0];
      lines.push(`${r.id} ${(p.length / 1000).toFixed(2)} km, ${p.checkpoints.length} checkpoints`);
      expect(p.length, r.id).toBeGreaterThan(lo);
      expect(p.length, r.id).toBeLessThan(hi);
      expect(r.closed, r.id).toBe(false); // point to point: one lap
      // Same start and grid; each main path extends the previous one.
      expect(r.start).toEqual(route.start);
      expect(r.startGrid).toEqual(route.startGrid);
      const prev = routes[i - 1];
      if (prev) expect(r.mainPath.slice(0, prev.mainPath.length)).toEqual(prev.mainPath);
      // The boat-ramp cut is on every length, with the same saving.
      expect(p.shortcuts.map((c) => c.gainM)).toEqual(progress.shortcuts.map((c) => c.gainM));
      // Checkpoints in order, strictly inside the race.
      let last = 0;
      for (const c of p.checkpoints) {
        expect(c.progress, r.id).toBeGreaterThan(last);
        last = c.progress;
      }
      expect(last, r.id).toBeLessThan(p.length);
      // A route allows only the roads up to its finish: nothing past it.
      const finishAt = p.progressAt(p.finish.edge, p.finish.s);
      for (const e of net.edges) {
        if (!p.allows(e.index)) continue;
        expect(p.progressAt(e.index, 0), `${r.id} ${e.id}`).toBeLessThanOrEqual(finishAt);
      }
    });
    console.log(`race lengths: ${lines.join('; ')}`);
  });

  it('road-3: a sign or billboard slot for every region item, each live, off the road, on every length', () => {
    const regionFile = JSON.parse(readFileSync(path.join(region, 'region.json'), 'utf8')) as {
      signs?: { id: string; status?: string; tags?: string[] }[];
      billboards?: { id: string; status?: string; tags?: string[] }[];
    };
    const items = new Map(
      [...(regionFile.signs ?? []), ...(regionFile.billboards ?? [])].map((i) => [i.id, i]),
    );
    const slots = net.edges.flatMap((e) =>
      e.features.filter((f) => f.kind === 'billboard').map((f) => ({ e, f })),
    );
    console.log(
      `board slots: ${slots.map(({ e, f }) => `${f.id} -> ${f.item} on ${e.id} s ${f.s0}-${f.s1} d ${f.d0}..${f.d1}`).join('; ')}`,
    );
    expect(slots.length).toBeGreaterThanOrEqual(2);
    // Run W-P (maintainer, 2026-10-01b: "the worlds just feel very empty"): every item has a slot,
    // so each one can be seen and vetoed in a race, and a new item needs a slot here too.
    expect(new Set(slots.map(({ f }) => f.item))).toEqual(new Set(items.keys()));
    expect(new Set(slots.map(({ f }) => f.id)).size).toBe(slots.length);
    for (const { e, f } of slots) {
      // A named item (a stable content reference for the veto), live in the region file.
      expect(typeof f.item, f.id).toBe('string');
      expect(items.get(f.item ?? '')?.status ?? 'live', f.id).toBe('live');
      expect(items.has(f.item ?? ''), f.id).toBe(true);
      // Off the road on one side: clear of the 5.5 m edge, and of the rail posts beyond it.
      expect(Math.sign(f.d0), f.id).toBe(Math.sign(f.d1));
      expect(Math.min(Math.abs(f.d0), Math.abs(f.d1)), f.id).toBeGreaterThanOrEqual(6.5);
      // Clear of the other features on its road.
      for (const g of e.features) {
        if (g === f) continue;
        const overlap = g.s0 < f.s1 && f.s0 < g.s1 && g.d0 < f.d1 && f.d0 < g.d1;
        expect(overlap, `${f.id} overlaps ${g.id ?? g.kind}`).toBe(false);
      }
      // On the short route, so every race length passes it; a key's own sign (run W-Q, distinct
      // keys: tagged `key-*`) stands on its key, so it is on every length that reaches that key,
      // and the longest always does.
      const ownKey = items.get(f.item ?? '')?.tags?.some((t) => t.startsWith('key-'));
      for (const r of routes) {
        if (ownKey && r.id !== 'm1-long-haul') continue;
        expect(createRouteProgress(net, r).allows(e.index), `${f.id} ${r.id}`).toBe(true);
      }
    }
  });

  it('road-3: barrierAt returns the rail on the bridge stretches and nothing off them; the water is y = 0', () => {
    let on = 0;
    for (const name of ['m1-pelican-bridge', 'm1-long-bridge']) {
      const bridge = id(name);
      for (let s = 0; s <= (net.edges[bridge]?.length ?? 0); s += 25) {
        for (const side of ['left', 'right'] as const) {
          expect(net.barrierAt(bridge, s, side), `${name} ${s} ${side}`).toEqual({
            kind: 'rail',
            heightM: 1,
          });
          on++;
        }
        // Sea level is world y = 0 (docs/content-packs.md, "Barriers"): the deck is always above it.
        expect(net.surfaceHeight(bridge, s, 0)).toBeGreaterThan(0);
      }
    }
    let off = 0;
    for (const name of [
      'm1-marina-run',
      'm1-marina-bends',
      'm1-sandbar-causeway',
      'm1-boat-ramp-cut',
      'm1-mangrove-cut',
      'm1-tarpon-flats',
      'm1-conch-row',
      'm1-last-resort-causeway',
    ]) {
      const e = id(name);
      for (let s = 0; s <= (net.edges[e]?.length ?? 0); s += 25) {
        for (const side of ['left', 'right'] as const) {
          expect(net.barrierAt(e, s, side), `${name} ${s} ${side}`).toBeNull();
          off++;
        }
      }
    }
    console.log(`barrierAt: ${on} rail answers on the bridge, ${off} empty answers off it`);
    expect(on).toBeGreaterThan(280);
    expect(off).toBeGreaterThan(500);
  });

  it('round-trips toWorld and project within 1 cm on its straights and bends', () => {
    let checked = 0;
    let worst = 0;
    for (const e of net.edges) {
      for (let s = 5; s < e.length - 5; s += 37) {
        for (const d of [-4.5, -1.7, 0, 1.7, 4.5]) {
          const w = net.toWorld(e.index, s, d, 0);
          const p = net.project(w.x, w.z, e.index);
          expect(p.edge).toBe(e.index);
          worst = Math.max(worst, Math.abs(p.s - s), Math.abs(p.d - d));
          checked++;
        }
      }
    }
    console.log(`round trip: ${checked} points, worst error ${(worst * 1000).toFixed(2)} mm`);
    expect(checked).toBeGreaterThan(400);
    expect(worst).toBeLessThan(0.01);
  });

  it('gives a right-hand bend positive kappa, and the kappa sign always follows the turn', () => {
    let checked = 0;
    for (const e of net.edges) {
      for (let s = 10; s < e.length - 10; s += 10) {
        const k = net.kappaAt(e.index, s);
        if (Math.abs(k) < 1e-3) continue;
        const a = net.frameAt(e.index, s - 5);
        const b = net.frameAt(e.index, s + 5);
        // Seen from above (x east, z south), a right turn rotates the tangent clockwise toward +d.
        const turn = a.tx * b.tz - a.tz * b.tx;
        expect(Math.sign(turn), `${e.id} s ${s}`).toBe(Math.sign(k));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('never launches a grounded bike at top speed: crest curvature × v² stays below g', () => {
    // The starter bike's top speed from the pack (100 mph since playtest 1, item 10; M1 had 85).
    const bike = JSON.parse(
      readFileSync(path.join(root, 'packs/base/bikes/rustbucket-400.json'), 'utf8'),
    ) as {
      handling: { topSpeedMps: number };
    };
    const top = bike.handling.topSpeedMps;
    expect(top).toBeGreaterThan(44);
    let checked = 0;
    for (const r of roads) {
      const y = r.samples.data['y'] ?? [];
      const h = r.sampleSpacingM;
      // Except on purpose: a ramp's lip (road-2), with two samples either side for the average.
      const ramps = (r.features ?? []).filter((f) => f.kind === 'ramp');
      for (let i = 2; i < y.length - 2; i++) {
        if (ramps.some((f) => i * h >= f.s0 - 2 * h && i * h <= f.s1 + 2 * h)) continue;
        checked++;
        // Second difference over 4 m, which smooths the 0.1 mm rounding.
        const curv = ((y[i + 2] ?? 0) - 2 * (y[i] ?? 0) + (y[i - 2] ?? 0)) / (4 * h * h);
        expect(-curv * top * top, `${r.id} sample ${i}`).toBeLessThan(9.81 * 0.8);
      }
    }
    expect(checked).toBeGreaterThan(1700);
  });

  it('keeps world distance for movers inside and outside a real bend (the 1 − kappa·d rule)', () => {
    // The tightest right bend on the track.
    let at = { edge: 0, s: 0, k: 0 };
    for (const e of net.edges)
      for (let s = 50; s < e.length - 150; s += 2) {
        const k = net.kappaAt(e.index, s);
        if (k > at.k) at = { edge: e.index, s: s - 60, k };
      }
    const walk = (d: number) => {
      const pos: RoadPos = { edge: at.edge, s: at.s, d, dir: 1 };
      let world = 0;
      let prev = net.toWorld(pos.edge, pos.s, d, 0);
      const r = { ds: 0, dd: 0, yawDrift: 0 };
      for (let t = 0; t < 180; t++) {
        curvedRoadRates(net.kappaAt(pos.edge, pos.s), pos.d, 1, 30, 0, r);
        pos.s += r.ds / 60;
        const w = net.toWorld(pos.edge, pos.s, d, 0);
        world += Math.hypot(w.x - prev.x, w.z - prev.z);
        prev = w;
      }
      return { gained: pos.s - at.s, world };
    };
    const inside = walk(1.7);
    const outside = walk(-1.7);
    console.log(
      `bend kappa ${at.k.toFixed(5)}: inside gains ${inside.gained.toFixed(2)} m of s, outside ${outside.gained.toFixed(2)} m; both cover ${inside.world.toFixed(2)} / ${outside.world.toFixed(2)} m`,
    );
    expect(inside.world).toBeCloseTo(90, 0);
    expect(outside.world).toBeCloseTo(90, 0);
    expect(inside.gained).toBeGreaterThan(outside.gained);
  });

  /** Steps a mover 1.1 m of s at a time from `pos` until `stop`; returns the edges and the worst step error. */
  const walk = (pos: RoadPos, stop: (p: RoadPos) => boolean) => {
    let prev = net.toWorld(pos.edge, pos.s, pos.d, 0);
    const seen = [pos.edge];
    let worst = 0;
    for (let t = 0; t < 6000 && !stop(pos); t++) {
      const k = net.kappaAt(pos.edge, pos.s);
      pos.s += pos.dir * 1.1;
      expect(net.advance(pos)).toBe('ok');
      if (seen[seen.length - 1] !== pos.edge) seen.push(pos.edge);
      const w = net.toWorld(pos.edge, pos.s, pos.d, 0);
      // Ground covered: 1.1 m of s scaled by 1 − kappa·d (kappa averaged over the step).
      const expected = 1.1 * (1 - ((k + net.kappaAt(pos.edge, pos.s)) / 2) * pos.d);
      const step = Math.hypot(w.x - prev.x, w.z - prev.z);
      worst = Math.max(worst, Math.abs(step - expected));
      prev = w;
    }
    return { seen: seen.map((e) => net.edges[e]?.id), worst };
  };
  const id = (name: string) => net.edgeIndex(name);

  it('carries movers both ways along the main path, across every junction, with no lost or doubled distance', () => {
    const fwd = walk(
      { edge: id('m1-marina-run'), s: 200, d: 1.7, dir: 1 },
      (p) => p.edge === id('m1-sandbar-causeway') && p.s > 100,
    );
    expect(fwd.seen).toEqual(progress.mainEdges.map((e) => net.edges[e]?.id));
    const back = walk(
      { edge: id('m1-sandbar-causeway'), s: 100, d: -1.7, dir: -1 },
      (p) => p.edge === id('m1-marina-run') && p.s < 200,
    );
    expect(back.seen).toEqual([...progress.mainEdges].reverse().map((e) => net.edges[e]?.id));
    console.log(
      `main path: worst step error ${(fwd.worst * 1000).toFixed(2)} / ${(back.worst * 1000).toFixed(2)} mm`,
    );
    // 1 cm per step, which covers the sampled positions.
    expect(fwd.worst).toBeLessThan(0.01);
    expect(back.worst).toBeLessThan(0.01);
  });

  it('road-2: a mover hugging the right edge takes the boat-ramp cut and rejoins on the bridge', () => {
    const run = walk(
      { edge: id('m1-marina-run'), s: 200, d: 3.6, dir: 1 },
      (p) => p.edge === id('m1-pelican-bridge') && p.s > 100,
    );
    expect(run.seen).toEqual([
      'm1-marina-run',
      'c-boat-ramp-in',
      'm1-boat-ramp-cut',
      'c-boat-ramp-out',
      'm1-pelican-bridge',
    ]);
    console.log(`shortcut path: worst step error ${(run.worst * 1000).toFixed(2)} mm`);
    expect(run.worst).toBeLessThan(0.01);
  });

  it('road-2: the shortcut saves 40–80 m to the finish, progress never falls on it, and its ramp is straight', () => {
    expect(progress.shortcuts).toHaveLength(1);
    const cut = progress.shortcuts[0];
    console.log(
      `boat-ramp cut: split zone s ${cut?.s0}–${cut?.s1}, d ${cut?.d0}–${cut?.d1} on ${net.edges[cut?.edge ?? 0]?.id}; saves ${cut?.gainM.toFixed(1)} m`,
    );
    expect(cut?.edge).toBe(id('m1-marina-run'));
    expect(cut?.gainM).toBeGreaterThan(40);
    expect(cut?.gainM).toBeLessThan(80);
    // Progress along the shortcut path, sampled every metre, never falls.
    let prev = -Infinity;
    for (const name of [
      'm1-marina-run',
      'c-boat-ramp-in',
      'm1-boat-ramp-cut',
      'c-boat-ramp-out',
      'm1-pelican-bridge',
    ]) {
      const e = id(name);
      for (let s = 0; s <= (net.edges[e]?.length ?? 0); s += 1) {
        const g = progress.progressAt(e, s);
        expect(g, `${name} ${s}`).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = g;
      }
    }
    // The ramp: one on the cut, on road with no curvature from its start to past the landing.
    const ramps = net.featuresOf(id('m1-boat-ramp-cut'), 'ramp');
    expect(ramps).toHaveLength(1);
    const r = ramps[0];
    for (let s = r?.s0 ?? 0; s <= (r?.s1 ?? 0) + 80; s += 2)
      expect(Math.abs(net.kappaAt(id('m1-boat-ramp-cut'), s))).toBeLessThan(1e-4);
    // Its lip stands about 1.5 m above the kicker's foot.
    const lip = (r?.s0 ?? 0) + 15;
    expect(
      net.surfaceHeight(id('m1-boat-ramp-cut'), lip, 0) -
        net.surfaceHeight(id('m1-boat-ramp-cut'), r?.s0 ?? 0, 0),
    ).toBeGreaterThan(1.3);
    // Traffic can never route onto it: every edge of the shortcut carries only a shortcut lane.
    for (const name of ['c-boat-ramp-in', 'm1-boat-ramp-cut', 'c-boat-ramp-out']) {
      expect(net.lanesAt(id(name), 5).map((l) => l.kind)).toEqual(['shortcut']);
    }
  });
});
