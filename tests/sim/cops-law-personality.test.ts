/// <reference types="vite/client" />
// Law with a personality (the pitch deck's #11, run W-T: "Every region's cops are a different
// problem, not a different hat") in real races, the dev bot riding. Each check turns on only the
// cops it needs on top of the isolation profile (tests/sim/batch.ts), and searches the first seed
// whose race shows the behaviour (firstSeed), then asserts it there:
// - the Keys: Trooper Dalrymple radar-guns the long bridge;
// - the Pacific Northwest: Deputy Lindqvist's citations, billed at the finish;
// - San Francisco: Officer Meter's pursuit budget runs out, and he stays out;
// - the END OF JURISDICTION sign cools the heat and the cops on you pull over;
// - and, with the whole world on, PNW roadblocks at three times the heat (2 of 8 races before run
//   W-T, when no cop was ever free and out of sight at tier 3; 5 of 8 after).
// The rules themselves are pinned in src/sim/cops/habits.test.ts. Release content, loaded the way
// the game loads it.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, regionChoices } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { SimConfig, SimEvent, SimSnapshot } from '../../src/sim/api';
import { firstSeed, ISOLATED, seedRange } from './batch';

const REG = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));

interface Ride {
  config: SimConfig;
  playerId: number;
  events: SimEvent[];
  /** The snapshot after each step, only on ticks with a law or siren event (and the first). */
  snaps: Map<number, SimSnapshot>;
  first: SimSnapshot;
  finished: boolean;
}

/** Rides one race with the bot until `done` says so, the race ends or `maxS` passes. */
function ride(
  eventId: string,
  seed: number,
  tuning: Record<string, number>,
  maxS: number,
  done: (r: Ride) => boolean = () => false,
): Ride {
  const { sim, config, playerId } = createHeadlessRace({ seed, eventId, tuning }, { registry: REG });
  const bot = createBot();
  let snap = sim.snapshot();
  const r: Ride = { config, playerId, events: [], snaps: new Map(), first: snap, finished: false };
  while (!sim.isOver() && sim.tick < maxS * 60 && !done(r)) {
    const a = emptyActions();
    bot.drive(snap, playerId, config.route, a);
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    const evs = sim.events().filter((e) => e.type === 'law' || e.type === 'siren' || e.type === 'heat');
    if (evs.length) r.snaps.set(sim.tick, snap);
    r.events.push(...evs);
    if (snap.race.finishOrder.includes(playerId)) r.finished = true;
  }
  return r;
}

const lawOf = (r: Ride, kind: string) => r.events.filter((e) => e.type === 'law' && e.data['kind'] === kind);
const eventOf = (region: string) => {
  const c = regionChoices(REG).find((x) => x.id.endsWith(region));
  if (!c) throw new Error(`no region ${region}`);
  return c.eventId;
};

describe('law with a personality: the data', () => {
  it('every event with law fields a patrol and runs the heat meter (every race: one or two on patrol)', () => {
    const missing = Object.entries(REG.events)
      .filter(([, e]) => {
        const c = e.cops as { mode: string; patrolMax?: number; heat?: boolean };
        return c.mode !== 'none' && (!(Number(c.patrolMax) >= 1) || c.heat !== true);
      })
      .map(([id]) => id);
    expect(missing).toEqual([]);
  });

  it("every region's cop has his own habit, and his agency an END OF JURISDICTION sign", () => {
    const want: Record<string, string> = {
      'base:sgt-pruitt': 'relentless',
      'base:trooper-dalrymple': 'radar',
      'region-pnw:deputy-lindqvist': 'citations',
      'region-sf:officer-meter': 'budget',
    };
    for (const [id, kind] of Object.entries(want)) expect(REG.riders[id]?.law?.habit?.kind, id).toBe(kind);
    for (const c of regionChoices(REG)) {
      const { config } = createHeadlessRace({ seed: 1, eventId: c.eventId }, { registry: REG });
      expect(config.event.cops?.jurisdiction?.label, c.id).toMatch(/^END OF JURISDICTION\. /);
    }
  });
});

describe('law with a personality: real races', () => {
  it('the Keys: Trooper Dalrymple waits at the bridge with his radar, and clocks the bot', () => {
    const tuning = { ...ISOLATED, 'cops.patrolScale': 1 };
    const event = eventOf('florida-keys');
    const found = firstSeed(
      'the Keys radar reading',
      seedRange(1, 6),
      (seed) => ride(event, seed, tuning, 120, (r) => lawOf(r, 'radar').length > 0 && r.events.length > 2),
      (r) => lawOf(r, 'radar').length > 0,
    );
    const r = found.result;
    expect(r, found.summary).not.toBeNull();
    if (!r) return;
    // His radar stands beside the road from the start.
    expect(r.first.props?.some((p) => p.kind === 'radar' && p.variant === 'trooper')).toBe(true);
    const reading = lawOf(r, 'radar')[0];
    if (!reading) throw new Error('no reading');
    const cop = r.config.riders[reading.actor];
    expect(cop?.contentId).toBe('base:trooper-dalrymple');
    expect(reading.target).toBe(r.playerId);
    const over = Number(reading.data['mps']) > Number(reading.data['limitMps']);
    expect(reading.data['over']).toBe(over);
    const siren = r.events.find(
      (e) => e.type === 'siren' && e.actor === reading.actor && e.data['on'] === true,
    );
    process.stdout.write(
      `cops law: Keys radar: ${found.summary}; ${Number(reading.data['mps']).toFixed(1)} m/s against ` +
        `${String(reading.data['limitMps'])}, over ${String(over)}, siren ${siren ? 'on' : 'none'}\n`,
    );
    if (over) expect(siren?.tick ?? Infinity).toBeGreaterThanOrEqual(reading.tick);
    else expect(siren).toBeUndefined();
  });

  it('the Pacific Northwest: Deputy Lindqvist writes citations alongside, and bills them at the finish', () => {
    const tuning = { ...ISOLATED, 'cops.patrolScale': 1 };
    const event = eventOf('pacific-northwest');
    const found = firstSeed(
      'the PNW citations',
      seedRange(1, 6),
      (seed) => ride(event, seed, tuning, 360),
      (r) => r.finished && lawOf(r, 'citation').length > 0,
    );
    const r = found.result;
    expect(r, found.summary).not.toBeNull();
    if (!r) return;
    const cites = lawOf(r, 'citation').filter((e) => e.target === r.playerId);
    const bills = lawOf(r, 'bill');
    process.stdout.write(
      `cops law: PNW citations: ${found.summary}; ${cites.length} written, billed ` +
        `${bills.map((b) => `${String(b.data['count'])} for $${String(b.data['totalCash'])}`).join(', ')}\n`,
    );
    expect(bills).toHaveLength(1);
    expect(bills[0]?.target).toBe(r.playerId);
    expect(bills[0]?.data['count']).toBe(cites.length);
    expect(bills[0]?.data['totalCash']).toBe(cites.reduce((s, e) => s + Number(e.data['cashEach']), 0));
    for (const e of cites) expect(r.config.riders[e.actor]?.contentId).toBe('region-pnw:deputy-lindqvist');
  });

  it("San Francisco: Officer Meter's pursuit budget runs out, and he never chases again", () => {
    const tuning = { ...ISOLATED, 'cops.patrolScale': 1 };
    const event = eventOf('san-francisco');
    const found = firstSeed(
      'the SF pursuit budget',
      seedRange(1, 6),
      (seed) => ride(event, seed, tuning, 180),
      (r) => lawOf(r, 'budgetOut').length > 0,
    );
    const r = found.result;
    expect(r, found.summary).not.toBeNull();
    if (!r) return;
    const out = lawOf(r, 'budgetOut')[0];
    if (!out) throw new Error('no budgetOut');
    process.stdout.write(`cops law: SF budget: ${found.summary}; spent at ${(out.tick / 60).toFixed(0)} s\n`);
    const later = r.events.filter(
      (e) => e.tick > out.tick && e.type === 'siren' && e.actor === out.actor && e.data['on'] === true,
    );
    expect(later).toEqual([]);
    expect(
      r.events.some(
        (e) => e.tick === out.tick && e.type === 'siren' && e.actor === out.actor && !e.data['on'],
      ),
    ).toBe(true);
  });

  it('the END OF JURISDICTION sign: crossing it hot cools the heat, and the cops on him pull over', () => {
    const tuning = { ...ISOLATED, 'cops.heatScale': 3, 'cops.spawnChance': 1, 'cops.patrolScale': 1 };
    const event = eventOf('florida-keys');
    const found = firstSeed(
      'the Keys jurisdiction sign',
      seedRange(1, 6),
      (seed) => ride(event, seed, tuning, 300, (r) => lawOf(r, 'jurisdiction').length > 0),
      (r) => lawOf(r, 'jurisdiction').length > 0,
    );
    const r = found.result;
    expect(r, found.summary).not.toBeNull();
    if (!r) return;
    expect(r.first.props?.find((p) => p.variant === 'jurisdiction')?.label).toBe(
      'END OF JURISDICTION. Keys County Deputies thank you for leaving.',
    );
    const crossed = lawOf(r, 'jurisdiction')[0];
    if (!crossed) throw new Error('no crossing');
    const snap = r.snaps.get(crossed.tick + 1) ?? r.snaps.get(crossed.tick);
    process.stdout.write(
      `cops law: Keys sign: ${found.summary}; crossed at ${(crossed.tick / 60).toFixed(0)} s with heat ` +
        `${(Number(crossed.data['heatBefore']) * 100).toFixed(0)}\n`,
    );
    expect(crossed.target).toBe(r.playerId);
    expect(snap?.law?.heat).toBe(0);
    // Nobody chases him on the tick he crosses.
    expect(
      snap?.entities.some((e) => e.faction === 'law' && e.targetId === r.playerId && e.mode === 'Road'),
    ).toBe(false);
  });

  // The whole world on, three times the heat (tier 3 never comes in the isolation profile). Measured
  // over seeds 1 to 8 (run W-T): 2 of 8 races met a roadblock before the radio rule; 5 of 8 with it
  // on the tree it was written on, 3 of 8 once main's later systems reshuffled the races. A rate
  // band would move with every such system, so this checks that the radioed-ahead path fires in a
  // real race (a roadblock cop who was already chasing), on the first seed that shows it.
  it('the Pacific Northwest: a cop chasing from out of sight behind is radioed ahead to the roadblock', () => {
    const event = eventOf('pacific-northwest');
    const radioed = (r: Ride) => {
      const chasing = new Set<number>();
      let ahead = 0;
      for (const e of r.events) {
        if (e.type !== 'siren') continue;
        if (e.data['on'] !== true) chasing.delete(e.actor);
        else if (e.data['cause'] !== 'roadblock') chasing.add(e.actor);
        else if (chasing.has(e.actor)) ahead++;
      }
      return ahead;
    };
    const found = firstSeed(
      'a PNW roadblock cop radioed ahead',
      seedRange(1, 8),
      (seed) => ride(event, seed, { 'cops.heatScale': 3 }, 360),
      (r) => radioed(r) > 0,
    );
    process.stdout.write(`cops law: PNW roadblock: ${found.summary}\n`);
    expect(found.result, found.summary).not.toBeNull();
  });
});
