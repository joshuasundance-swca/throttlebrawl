// Riding a bridge taper (road/bridge-taper.ts; playtest 4, the maintainer on the Gorge: "when it goes
// from grass to bridge or whatever the rider clips from open air onto the bridge. You can see it
// happen if you stay to the far right"). A rider out at the far edge of a forest verge, riding onto a
// bridge, is eased onto the deck along the band's taper: its place across the road never jumps, no
// barrier event fires on the way, and it reaches the deck inside the rails. The edge coming in costs
// it nothing; pressing out into the ferns costs what the ferns cost anywhere.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import type { SimConfig, SimEvent } from '../types';
import { input, riderHarness, testConfig } from './testing';

/** FIXTURE_LANES' outer edge, m. */
const LANES_EDGE = 4.9;

/** 600 m of forest road (a 6 m dirt band, a brush edge) with a railed bridge over s 300..400. */
function bridgeConfig(): SimConfig {
  const edges = [{ id: 'a', lengthM: 600, kappa: 0 }];
  const bundle = fixtureNetwork(edges);
  for (const road of bundle.roads) {
    road.tags = [
      { s0: 0, s1: 600, side: 'both', tag: 'forest' },
      { s0: 300, s1: 400, side: 'both', tag: 'bridge' },
    ];
    road.barriers = [{ s0: 300, s1: 400, side: 'both', kind: 'rail', heightM: 1 }];
  }
  const road = createRoadNetwork(bundle);
  const base = testConfig({ edges, tuning: { 'ground.offRoad': 1 } });
  return {
    ...base,
    road,
    route: createRouteProgress(road, {
      id: 'r',
      network: 'fixture',
      start: { road: 'a', s: 40, dir: 1 },
      finish: { road: 'a', s: 580 },
      mainPath: ['a'],
      allowedRoads: ['a'],
      closed: false,
    }),
  };
}

const edgeEvents = (events: readonly SimEvent[]) =>
  events.filter((e) => (e.type === 'wobble' || e.type === 'crash') && e.data['cause'] !== undefined);

/** Rides from the band's far edge at s 200 onto the deck (to s 330) with these bars. */
function ride(side: 1 | -1, steer: number) {
  const h = riderHarness(bridgeConfig(), { s: 200, d: side * (LANES_EDGE + 6 - 0.5), speed: 30 });
  const startD = h.rider.pos.d;
  let prevD = startD;
  let maxStep = 0;
  const events: SimEvent[] = [];
  for (let t = 0; t < 60 * 20 && h.rider.pos.s < 330; t++) {
    events.push(...edgeEvents(h.step(input(1, 0, steer))));
    maxStep = Math.max(maxStep, Math.abs(h.rider.pos.d - prevD));
    prevD = h.rider.pos.d;
  }
  return { startD, maxStep, events, d: h.rider.pos.d, s: h.rider.pos.s, speed: h.rider.speed };
}

describe('a bridge taper eases a rider on the verge onto the deck (playtest 4)', () => {
  for (const side of [1, -1] as const) {
    const name = side > 0 ? 'right' : 'left';
    it(`at the far ${name}, riding straight at 30 m/s: no jump, no event, no speed lost to the taper`, () => {
      const r = ride(side, 0);
      console.log(
        `[examined] far ${name}, bars straight, from d ${r.startD.toFixed(2)} at s 200: largest move across in a ` +
          `tick ${r.maxStep.toFixed(3)} m; at s ${r.s.toFixed(0)} d ${r.d.toFixed(2)}, ${r.speed.toFixed(1)} m/s; ` +
          `events ${r.events.map((e) => `${e.type}/${String(e.data['cause'])}`).join(', ') || 'none'}`,
      );
      expect(Math.abs(r.startD)).toBeGreaterThan(LANES_EDGE + 5); // it started out on the band
      expect(r.s).toBeGreaterThanOrEqual(330);
      // A tick is 0.5 m of road at 30 m/s; the taper brings the edge in by 0.05 m of it.
      expect(r.maxStep).toBeGreaterThan(0.01); // it was moved in, a little each tick
      expect(r.maxStep).toBeLessThan(0.1);
      expect(Math.abs(r.d)).toBeLessThanOrEqual(LANES_EDGE - 0.5 + 1e-9); // on the deck, inside the rail
      expect(r.events).toEqual([]);
      expect(r.speed).toBeGreaterThan(27); // on dirt at 0.8 of the bike's top speed, no drag from the taper
    });

    it(`at the far ${name}, pressing out into the ferns: held and slowed by them as anywhere, never thrown`, () => {
      const r = ride(side, side);
      console.log(
        `[examined] far ${name}, bars out, from d ${r.startD.toFixed(2)}: largest move across in a tick ` +
          `${r.maxStep.toFixed(3)} m; at s ${r.s.toFixed(0)} d ${r.d.toFixed(2)}, ${r.speed.toFixed(1)} m/s; events ` +
          `${r.events.map((e) => `${e.type}/${String(e.data['cause'])}`).join(', ') || 'none'}`,
      );
      expect(r.maxStep).toBeLessThan(0.1);
      expect(r.speed).toBeLessThan(30); // the ferns' drag, as along any brush edge
      expect(r.events.filter((e) => e.type === 'crash')).toEqual([]);
      expect(r.events.filter((e) => e.data['cause'] === 'barrier')).toEqual([]);
    });
  }
});
