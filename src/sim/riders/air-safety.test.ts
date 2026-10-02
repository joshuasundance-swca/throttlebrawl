// Air inputs that are not meant as a flip never crash the landing (playtest 2, 2026-10-02: "It's too
// easy to crash after a jump", "Forgiving landings"). The W-Q0 verifier found that with air control on,
// holding the brake from mid-air to the ground (braking for the corner after a crest) looped the bike
// out: 23 of 34 jumps went down, against 0 of 34 with air control off; a kick held 0.35 s put 9 of 34
// down. The jumps are the riders lane's own fixtures: the 25 % ramp and the 3 m crest, over a spread
// of speeds and of times after take-off. The bar is 0 crashes for every pattern, at the default air
// control and at its maximum.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, humpProfile } from '../../road';
import { InputFlag, type SimConfig, type SimEvent, type SimInput } from '../types';
import { input, riderHarness, testConfig } from './testing';

const RAMP = [
  { id: 'runup', lengthM: 200, kappa: 0 },
  { id: 'ramp', lengthM: 16, kappa: 0, grade: 0.25 },
  { id: 'landing', lengthM: 600, kappa: 0 },
];

function crestConfig(tuning: Record<string, number>): SimConfig {
  const base = testConfig({ edges: [{ id: 'a', lengthM: 800, kappa: 0 }], tuning });
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 800, kappa: 0 }]);
  const road = bundle.roads[0]!;
  const data = road.samples.data as Record<string, number[]>;
  const y = data['y'] ?? [];
  const grade = data['grade'] ?? [];
  for (let i = 0; i < y.length; i++) {
    const [hy, hg] = humpProfile([{ centreM: 400, lengthM: 60, heightM: 3 }], i * road.sampleSpacingM);
    y[i] = (y[i] ?? 0) + hy;
    grade[i] = (grade[i] ?? 0) + hg;
  }
  const net = createRoadNetwork(bundle);
  const route = createRouteProgress(net, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 780 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return { ...base, road: net, route };
}

/** The input t ticks after the air input starts. */
type Pattern = (t: number) => SimInput;
const kick = (): SimInput => ({ ...input(1), flags: InputFlag.kick });
const PATTERNS: Record<string, Pattern> = {
  'brake held to the ground': () => input(0, 1),
  'brake tap 0.25 s': (t) => (t < 15 ? input(0, 1) : input(1)),
  'kick held 0.2 s': (t) => (t < 12 ? kick() : input(1)),
  'kick held 0.35 s': (t) => (t < 21 ? kick() : input(1)),
  'kick held to the ground': () => kick(),
};

interface Outcome {
  quality: string;
  airTicks: number;
  crashed: boolean;
}

function jump(site: 'ramp' | 'crest', speed: number, startAt: number, pat: Pattern, airControl: number) {
  const tuning = { 'riders.airControl': airControl };
  const config = site === 'ramp' ? testConfig({ edges: RAMP, tuning }) : crestConfig(tuning);
  const h = riderHarness(config, { edge: 0, s: site === 'ramp' ? 150 : 330, d: 0, speed });
  const events: SimEvent[] = [];
  let airT = -1;
  for (let k = 0; k < 60 * 8; k++) {
    const inAir = h.rider.mode === 'Airborne';
    airT = inAir ? airT + 1 : -1;
    const i = inAir && airT >= startAt ? pat(airT - startAt) : input(h.rider.speed < speed ? 1 : 0.6);
    events.push(...h.step(i));
    const land = events.find((e) => e.type === 'land');
    if (land) {
      // The second after the landing counts too.
      for (let q = 0; q < 60; q++) events.push(...h.step(input(1)));
      const out: Outcome = {
        quality: String(land.data['quality']),
        airTicks: Number(land.data['airTicks']),
        crashed: events.some((e) => e.type === 'crash'),
      };
      return out;
    }
  }
  return null;
}

function batch(pat: Pattern, airControl: number) {
  let jumps = 0;
  let crashes = 0;
  let wobbles = 0;
  const down: string[] = [];
  for (const site of ['ramp', 'crest'] as const) {
    for (const speed of site === 'ramp' ? [24, 28, 32, 36] : [30, 34, 38]) {
      // 6 ticks is the browser repro: the brake pressed 0.1 s after take-off.
      for (const startAt of [0, 6, 10, 20, 30, 40]) {
        const r = jump(site, speed, startAt, pat, airControl);
        if (!r || r.airTicks <= startAt) continue;
        jumps++;
        if (r.crashed) {
          crashes++;
          down.push(`${site} ${speed} m/s from tick ${startAt}`);
        } else if (r.quality === 'wobble') wobbles++;
      }
    }
  }
  return { jumps, crashes, wobbles, down };
}

describe('air inputs that are not a flip never crash the landing (W-Q0 verifier mustFix)', () => {
  for (const airControl of [1, 2]) {
    for (const [name, pat] of Object.entries(PATTERNS)) {
      it(`${name}, air control ${airControl}: 0 crashes`, () => {
        const r = batch(pat, airControl);
        expect(r.jumps).toBeGreaterThanOrEqual(30);
        expect(r.down, `${r.crashes}/${r.jumps} down, ${r.wobbles} wobble`).toEqual([]);
        expect(r.crashes).toBe(0);
      });
    }
  }
});
