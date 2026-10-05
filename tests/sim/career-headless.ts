// The headless career, shared by tests/sim/career-headless-*.test.ts (one region a file, so the
// sim tier can run them side by side). See career-harness.ts for how a race is built and ridden.
//
// What it proves (docs/milestones/M4.md, career-1 and the M4 exit): the dev bot plays every event
// of the region and the boss, in the career's own order while its wins open the map (each node
// once), then the rest in free play, on at least the bike the career gives at each node's tier;
// every race is decided by its event's rules within its time limit (its route's length at a share
// of that bike's top speed, `raceLimitS`, so a long route or a slow bike gets longer); the cash ledger
// never goes below $0; the grudges a race leaves are the next race's SimConfig.grudges; the history
// keeps every race. The rules' own path from the first race to the teaser and free play, with
// every race won, is tests/sim/career-content.test.ts: the dev bot is a fighter, not a racer (it
// averages about 28 to 33 m/s against rival paces of 32 to 46), so it wins hunts, escapes and
// knockdown grudges and loses most races to the line; its real record is printed.
import { expect } from 'vitest';
import { careerDefs, careerOf, eventPlan, startCareer } from '../../src/career';
import { DEFAULT_PROFILE } from '../../src/save';
import { RACE_LIMIT_SHARE, raceLimitS, REG, runCareer, tierBike } from './career-harness';

export function headlessCareer(region: string): void {
  const defs = careerDefs(REG);
  const def = careerOf(defs, region);
  if (!def) throw new Error(`no career for ${region}`);
  const t0 = Date.now();
  const run = runCareer(defs, def, startCareer(defs, { ...DEFAULT_PROFILE }), { maxTries: 1 });
  for (const line of run.log) console.log(line);

  // Every event and the boss, played.
  const played = new Set(run.races.map((r) => r.config.event.contentId));
  expect([...played].sort()).toEqual(def.nodes.map((n) => n.event).sort());
  expect(played).toContain(def.nodes.find((n) => n.id === def.boss)?.event);
  run.races.forEach((race, i) => {
    const plan = eventPlan(REG, race.config.event.contentId);
    const node = def.nodes.find((n) => n.event === race.config.event.contentId);
    const bike = race.config.riders.find((r) => r.controller.kind === 'player')?.bike;
    const limitS = raceLimitS(race.config);
    const what =
      `${plan.key} on ${bike?.contentId ?? '?'}: ${(race.ticks / 60).toFixed(0)} s of a ` +
      `${limitS.toFixed(0)} s limit (${(race.config.route.length / 1000).toFixed(2)} km at ` +
      `${RACE_LIMIT_SHARE} of ${bike?.topSpeedMps ?? '?'} m/s)`;
    console.log(what);
    // Ridden on at least the bike the career gives at the node's tier.
    const given = node ? tierBike(def, node) : null;
    if (given) expect(bike?.topSpeedMps ?? 0, what).toBeGreaterThanOrEqual(given.topSpeedMps);
    // Decided by its rules within its time limit: won or lost, never still running.
    expect(race.status.state, what).not.toBe('running');
    expect(race.ticks / 60, what).toBeLessThanOrEqual(limitS);
    expect(race.report.cashAfter).toBeGreaterThanOrEqual(0);
    // The grudges this race left are what the next race starts from.
    const next = run.races[i + 1];
    if (next) expect(next.config.grudges).toEqual(race.profile.grudges);
  });
  expect(run.profile.history.length).toBe(run.races.length);
  const wins = run.races.filter((r) => r.report.won);
  const byKind: Record<string, string> = {};
  for (const r of run.races) {
    const kind = eventPlan(REG, r.config.event.contentId).kind;
    byKind[kind] = `${(byKind[kind] ?? '').length ? byKind[kind] + ' ' : ''}${r.report.won ? 'W' : 'L'}`;
  }
  // The bot does win events: the first race (finish to win) at least.
  expect(wins.length).toBeGreaterThan(0);
  console.log(
    `${def.regionId}: ${run.races.length} races, ${wins.length} won (${Object.entries(byKind)
      .map(([k, v]) => `${k} ${v}`)
      .join('; ')}), cash $${run.profile.cash}, tier ${run.profile.regions[def.regionId]?.tier}, ` +
      `grudges ${JSON.stringify(run.profile.grudges)}, ${Date.now() - t0} ms`,
  );
}
