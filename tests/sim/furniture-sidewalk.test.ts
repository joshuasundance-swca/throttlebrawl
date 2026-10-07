/// <reference types="vite/client" />
// Playtest 4 (the maintainer, 2026-10-05: street furniture is "solid but maybe forgiving to sides,
// brushes, etc"): a seeded sidewalk ride. A scripted rider rides each city's sidewalk at 22 m/s, at a
// seeded place across it, on four city races (San Francisco's hills, downtown and waterfront, and Key
// West's Duval Street), and every street piece it meets is counted by what it cost.
//
// - The furniture is met: the rides touch it often (it was a ghost before: the same rides with
//   `riders.furniture` off meet none of it, the control).
// - A rider who swerves late (a solid piece within SEE_M ahead in its path: it steers away, as a player
//   who sees it late does) mostly glances off: most of its contacts with the furniture are survived
//   (wobbles and light pieces ridden through), and its crashes on furniture are the square hits.
// - A blind rider (never swerves) meets it square on far more often: the crash share is the honest worst
//   case, printed beside the swerving one.
// - Forgiving in every place (the live check of #619: a solid contact crashed 55 to 59 % of the time on
//   Duval and Russian Hill): in each place, a swerving rider's contacts with a SOLID piece crash at most
//   SOLID_CRASH_MAX of the time (it was 41 to 51 % on Duval and Russian Hill over these rides), and a
//   rider in the middle of a Key West sidewalk meets no planter or frangipani square on (it met them
//   all: they stood across its middle).
// Seeded statistics: bands well inside the measured shares (printed), over enough contacts (MIN_CONTACTS).
// The rides are of the street furniture alone: the structures are off (`riders.structures` 0, as in ISOLATED).
// With them on, Old Town's buildings stand in Duval's sidewalk rides too (train 454: the three middle rides
// crashed 28 times, 8 of them on a planter, against none with them absent), which is the structures' rule,
// tested in tests/sim/structures-solid.test.ts, not the furniture's.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { emptyActions, toSimInput } from '../../src/input';
import { DRAWN_VERGE_M, planStreetFurniture } from '../../src/road';
import { createSim, type SimConfig } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const print = (line: string) => process.stdout.write(`${line}\n`);

const EVENTS = [
  'region-sf:sf-t2-russian-hill',
  'region-sf:sf-t1-burn-rate',
  'region-sf:sf-t1-pier-pressure',
  'base:keys-t1-last-light-duval',
];
const SEEDS = [1, 2, 3];
const TICKS = 60 * 50;
const RIDE_MPS = 22;
/** How far ahead the swerving rider sees a solid piece in its path, m (about half a second at 22 m/s). */
const SEE_M = 12;
const MIN_CONTACTS = 40;
/** The most a swerving rider's contacts with solid pieces crash, in any place with SOLID_MIN of them. */
const SOLID_CRASH_MAX = 0.3;
const SOLID_MIN = 20;

interface Tally {
  contacts: number;
  crashes: number;
  /** Contacts with a solid piece, and those that crashed. */
  solid: number;
  solidCrashes: number;
  wobbles: number;
  light: number;
  riderCrashes: number;
  byKind: Map<string, { n: number; crash: number }>;
}

const empty = (): Tally => ({
  contacts: 0,
  crashes: 0,
  solid: 0,
  solidCrashes: 0,
  wobbles: 0,
  light: 0,
  riderCrashes: 0,
  byKind: new Map(),
});

/** How a scripted rider picks its line: its seeded place, swerving late or not; or the sidewalk's middle. */
type Line = 'blind' | 'swerve' | 'middle';

function ride(
  eventId: string,
  seed: number,
  mode: Line | boolean,
  tuning: Record<string, number> = {},
): Tally {
  const line: Line = mode === true ? 'swerve' : mode === false ? 'blind' : mode;
  const swerve = line === 'swerve';
  const config: SimConfig = buildSimConfig(REG, STREAMS.forEvent(REG, eventId), {
    seed,
    eventId,
    tuning: { 'riders.structures': 0, ...tuning },
  });
  const plan = planStreetFurniture(config.road, config.seed);
  const sim = createSim(config);
  const out = empty();
  // The seed picks the side and the place across the sidewalk (0 its kerb, 1 its back).
  const side: 1 | -1 = seed % 2 === 0 ? -1 : 1;
  const frac = 0.15 + 0.7 * ((seed * 0.618034) % 1);
  let snap = sim.snapshot();
  for (let i = 0; i < TICKS && !sim.isOver(); i++) {
    const me = snap.entities.find((e) => e.kind === 'rider' && e.slot === 0);
    const a = emptyActions();
    if (me) {
      const { edge, s, d, dir } = me.road;
      const v = config.road.vergeAt(edge, s, side < 0 ? 'left' : 'right');
      const width = Math.abs(v.dOuter - v.dInner);
      let target = width > 1.6 ? v.dInner + side * (0.4 + frac * (width - 0.8)) : v.dInner;
      // The middle of the sidewalk as drawn: render draws its first DRAWN_VERGE_M as the road's verge.
      if (line === 'middle') target = v.dInner + side * (DRAWN_VERGE_M + (width - DRAWN_VERGE_M) / 2);
      if (swerve) {
        // A solid piece ahead in the path: steer for the wider gap beside it.
        for (const p of plan.byEdge[edge] ?? []) {
          if (p.cls !== 'solid') continue;
          const ahead = (p.shape.s - s) * dir;
          if (ahead < 0 || ahead > SEE_M) continue;
          if (Math.abs(p.shape.d - d) >= p.shape.reachD + 0.4) continue;
          const toKerb = Math.abs(p.shape.d - p.shape.reachD * side - v.dInner);
          const toBack = Math.abs(v.dOuter - (p.shape.d + p.shape.reachD * side));
          target =
            toKerb > toBack
              ? p.shape.d - side * (p.shape.reachD + 0.6)
              : p.shape.d + side * (p.shape.reachD + 0.6);
          break;
        }
      }
      a.steer = Math.max(-1, Math.min(1, (target - d) * 0.6 * dir));
      a.throttle = me.speed < RIDE_MPS ? 1 : 0.3;
    }
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    for (const ev of sim.events()) {
      if (ev.actor !== me?.id) continue;
      if (ev.type === 'crash') out.riderCrashes++;
      if (ev.type !== 'crash' && ev.type !== 'wobble') continue;
      if (ev.data['furniture'] === undefined) continue;
      out.contacts++;
      const kind = String(ev.data['object']);
      const k = out.byKind.get(kind) ?? { n: 0, crash: 0 };
      k.n++;
      if (ev.data['cause'] !== 'smash') out.solid++;
      if (ev.type === 'crash') {
        out.crashes++;
        out.solidCrashes++;
        k.crash++;
      } else if (ev.data['cause'] === 'smash') out.light++;
      else out.wobbles++;
      out.byKind.set(kind, k);
    }
  }
  return out;
}

function add(into: Tally, t: Tally): void {
  into.contacts += t.contacts;
  into.crashes += t.crashes;
  into.solid += t.solid;
  into.solidCrashes += t.solidCrashes;
  into.wobbles += t.wobbles;
  into.light += t.light;
  into.riderCrashes += t.riderCrashes;
  for (const [k, v] of t.byKind) {
    const e = into.byKind.get(k) ?? { n: 0, crash: 0 };
    e.n += v.n;
    e.crash += v.crash;
    into.byKind.set(k, e);
  }
}

const line = (name: string, t: Tally) =>
  `[furniture] ${name}: ${t.contacts} contacts with street furniture: ${t.crashes} crashes, ${t.wobbles} glancing wobbles, ${t.light} light pieces ridden through; survived ${t.contacts ? Math.round((100 * (t.contacts - t.crashes)) / t.contacts) : 0} %; all the rider's crashes ${t.riderCrashes}; ` +
  [...t.byKind]
    .sort()
    .map(([k, v]) => `${k} ${v.n}${v.crash ? ` (${v.crash} crash)` : ''}`)
    .join(', ');

const solidShare = (t: Tally) => (t.solid ? t.solidCrashes / t.solid : 0);
const solidLine = (name: string, t: Tally) =>
  `[furniture] ${name}: ${t.solid} contacts with solid pieces, ${t.solidCrashes} crashes (${Math.round(100 * solidShare(t))} %)`;

describe('a seeded sidewalk ride meets the street furniture (playtest 4: solid but forgiving)', () => {
  it('meets it, mostly glancing when it swerves late, in every place; the same rides with it off meet none of it', () => {
    const swerving = empty();
    const blind = empty();
    const off = empty();
    const byPlace = new Map<string, { swerving: Tally; blind: Tally }>();
    for (const eventId of EVENTS) {
      const place = { swerving: empty(), blind: empty() };
      byPlace.set(eventId, place);
      for (const seed of SEEDS) {
        const sw = ride(eventId, seed, 'swerve');
        const bl = ride(eventId, seed, 'blind');
        add(swerving, sw);
        add(blind, bl);
        add(place.swerving, sw);
        add(place.blind, bl);
        if (seed === SEEDS[0]) add(off, ride(eventId, seed, 'swerve', { 'riders.furniture': 0 }));
      }
    }
    print(line('swerving late', swerving));
    print(line('blind', blind));
    print(line('furniture off (before)', off));
    for (const [eventId, p] of byPlace) {
      print(solidLine(`${eventId}, swerving late`, p.swerving));
      print(solidLine(`${eventId}, blind`, p.blind));
    }
    // The control: with it off nothing of the street furniture is met (the ghost it was).
    expect(off.contacts).toBe(0);
    // Met, and often.
    expect(swerving.contacts).toBeGreaterThanOrEqual(MIN_CONTACTS);
    expect(blind.contacts).toBeGreaterThanOrEqual(MIN_CONTACTS);
    // Mostly survived when the rider swerves: glances and light pieces.
    const survived = (t: Tally) => (t.contacts - t.crashes) / t.contacts;
    expect(survived(swerving)).toBeGreaterThan(0.6);
    // Forgiving in every place: a swerving rider's solid contacts mostly wobble, wherever it rides.
    for (const [eventId, p] of byPlace)
      if (p.swerving.solid >= SOLID_MIN)
        expect(solidShare(p.swerving), eventId).toBeLessThanOrEqual(SOLID_CRASH_MAX);
    // Solid and forgiving both happen: some square hits crash, some brushes only wobble.
    expect(blind.crashes).toBeGreaterThan(0);
    expect(blind.wobbles + swerving.wobbles).toBeGreaterThan(0);
  }, 600_000);

  it("the middle of Key West's Old Town sidewalk is a clear line: no planter or frangipani met square on", () => {
    const middle = empty();
    const blind = empty();
    const duval = 'base:keys-t1-last-light-duval';
    for (const seed of SEEDS) {
      add(middle, ride(duval, seed, 'middle'));
      add(blind, ride(duval, seed, 'blind'));
    }
    print(line('Duval, the middle of the sidewalk', middle));
    // The control: the seeded lines across the same sidewalks meet them, some square on.
    expect(blind.solidCrashes).toBeGreaterThan(0);
    expect(middle.solidCrashes).toBe(0);
  }, 600_000);
});
