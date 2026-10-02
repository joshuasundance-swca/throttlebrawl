// Forgiving landings (playtest 2, 2026-10-02: "It's too easy to crash after a jump"; the maintainer
// picked "Forgiving landings"). A seeded batch of jumps the way a thumb on a phone flies them: off the
// 25 % ramp onto a straight and onto a bend, and over a sharp crest, at a spread of speeds and lines,
// with the steering a player really gives in the air (none, a held thumb, or a jab of full lock).
// Every landing is counted: clean, wobble or crash, and a crash must be a really bad landing.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, humpProfile } from '../../road';
import type { SimConfig, SimEvent } from '../types';
import { maxYawAt, RIDERS_TUNING } from './index';
import { input, riderHarness, testConfig, TEST_BIKE, type RiderHarness } from './testing';

const print = (line: string) => console.log(line);

/** A small seeded generator for the batch's draws (test code: any fixed sequence will do). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const RAMP_STRAIGHT = [
  { id: 'runup', lengthM: 200, kappa: 0 },
  { id: 'ramp', lengthM: 16, kappa: 0, grade: 0.25 },
  { id: 'landing', lengthM: 600, kappa: 0 },
];
/** The same ramp onto a bend of about 80 m radius, as a real road's crest on a curve. */
const RAMP_BEND = [
  { id: 'runup', lengthM: 200, kappa: 0 },
  { id: 'ramp', lengthM: 16, kappa: 0, grade: 0.25 },
  { id: 'landing', lengthM: 600, kappa: 0.0125 },
];

function humpConfig(): SimConfig {
  const base = testConfig({ edges: [{ id: 'a', lengthM: 800, kappa: 0 }] });
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 800, kappa: 0 }]);
  const road = bundle.roads[0];
  if (!road) throw new Error('no road');
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

const SITES = [
  {
    name: 'ramp onto a straight',
    config: () => testConfig({ edges: RAMP_STRAIGHT }),
    at: { edge: 0, s: 150 },
  },
  { name: 'ramp onto a bend', config: () => testConfig({ edges: RAMP_BEND }), at: { edge: 0, s: 150 } },
  { name: 'sharp crest', config: humpConfig, at: { edge: 0, s: 330 } },
];

export interface Landing {
  quality: string;
  lateralMps: number;
  verticalMps: number;
  crashCause: string | null;
}

/** One jump: the thumb's air steering is `air(tickInAir, steerAtTakeoff)`. */
function fly(
  config: SimConfig,
  at: { edge: number; s: number },
  speed: number,
  d: number,
  air: (t: number, held: number) => number,
): Landing | null {
  const h = riderHarness(config, { edge: at.edge, s: at.s, d, speed });
  // On the ground the thumb holds its line and the bend: a heading back toward d, plus the turn the
  // road's curve needs.
  const ground = (r: RiderHarness) => {
    const m = r.rider;
    const want = (d - m.pos.d) * 0.05 * m.pos.dir + (config.road.kappaAt(m.pos.edge, m.pos.s) * m.speed) / 4;
    const steer = (want - m.yaw) / maxYawAt(TEST_BIKE.steerRateMps, m.speed, 1);
    return Math.max(-1, Math.min(1, steer));
  };
  let airT = -1;
  let held = 0;
  const events: SimEvent[] = [];
  for (let t = 0; t < 60 * 8; t++) {
    const inAir = h.rider.mode === 'Airborne';
    airT = inAir ? airT + 1 : -1;
    const g = ground(h);
    const steer = inAir ? air(airT, held) : g;
    if (!inAir) held = g;
    events.push(...h.step(input(h.rider.mode === 'Road' && h.rider.speed < speed ? 1 : 0.6, 0, steer)));
    const land = events.find((e) => e.type === 'land');
    if (land) {
      // The second after the landing too: a shaky bike may still go down.
      for (let k = 0; k < 60; k++)
        events.push(...h.step(input(1, 0, h.rider.mode === 'Road' ? ground(h) : 0)));
      const crash = events.find((e) => e.type === 'crash');
      return {
        quality: String(land.data['quality']),
        lateralMps: Number(land.data['lateralMps']),
        verticalMps: Number(land.data['verticalMps']),
        crashCause: crash ? String(crash.data['cause']) : null,
      };
    }
  }
  return null;
}

/** The batch: every site, TRIALS seeded jumps each. */
export function landingBatch(trials = 120, seed = 7): { site: string; thumb: string; l: Landing }[] {
  const rnd = lcg(seed);
  const out: { site: string; thumb: string; l: Landing }[] = [];
  for (const site of SITES) {
    const config = site.config();
    for (let i = 0; i < trials; i++) {
      const speed = (site.name === 'sharp crest' ? 30 : 24) + (site.name === 'sharp crest' ? 8 : 14) * rnd();
      const d = -1.5 + 3 * rnd();
      const kind = Math.floor(rnd() * 3);
      const jabAt = Math.floor(rnd() * 40);
      const jabLen = 6 + Math.floor(rnd() * 30);
      const jabDir = rnd() < 0.5 ? -1 : 1;
      const thumb = ['bars straight', 'held thumb', 'jab'][kind] ?? '';
      const air =
        kind === 0
          ? () => 0
          : kind === 1
            ? (_t: number, held: number) => held
            : (t: number) => (t >= jabAt && t < jabAt + jabLen ? jabDir : 0);
      const l = fly(config, site.at, speed, d, air);
      if (l) out.push({ site: site.name, thumb, l });
    }
  }
  return out;
}

describe('forgiving landings: a seeded batch of thumb-flown jumps (playtest 2, 2026-10-02)', () => {
  it('lands nearly every jump, and only a really bad landing crashes', () => {
    const batch = landingBatch();
    const crashLine = RIDERS_TUNING.find((p) => p.id === 'riders.landingCrashMps')?.default ?? 0;
    const tally: Record<string, { n: number; clean: number; wobble: number; crash: number; after: number }> =
      {};
    for (const { site, thumb, l } of batch) {
      for (const key of [site, thumb, 'all']) {
        const t = (tally[key] ??= { n: 0, clean: 0, wobble: 0, crash: 0, after: 0 });
        t.n++;
        if (l.quality === 'clean') t.clean++;
        else if (l.quality === 'wobble') t.wobble++;
        else t.crash++;
        if (l.quality !== 'crash' && l.crashCause !== null) t.after++;
      }
    }
    for (const [k, t] of Object.entries(tally)) {
      print(
        `[landings] ${k}: ${t.n} jumps, ${t.clean} clean, ${t.wobble} wobble, ${t.crash} crash on landing, ${t.after} crash in the second after (${((100 * (t.crash + t.after)) / t.n).toFixed(1)}% down)`,
      );
    }
    const all = tally['all'];
    expect(all?.n).toBe(360);
    // Down on fewer than 1 in 20 thumb-flown jumps (before playtest 2: 153 of these 360, 42.5 %).
    expect((all?.crash ?? 0) + (all?.after ?? 0)).toBeLessThan(0.05 * (all?.n ?? 0));
    // And every landing crash is a really bad one: sideways at or past the crash line, or a
    // drop far harder than any ramp here gives.
    for (const { l } of batch) {
      if (l.quality === 'crash') expect(l.lateralMps >= crashLine || l.verticalMps >= 22).toBe(true);
    }
  });
});
