// docs/milestones/police-pursuit.md: the public snapshot must drive Escape before the finish,
// even when a cop has no weapon and never enters a combat attack phase.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { createRaceLog, eventPlan } from '../../src/career';
import { loadBasePack } from '../../src/content';
import { createSim, quantizeInput, type SimConfig } from '../../src/sim/api';
import { firstSeed, ISOLATED, seedRange } from './batch';

const REG = loadBasePack();
const eventId = Object.keys(REG.events)
  .filter((id) => REG.events[id]?.kind === 'cop-escape' && REG.events[id]?.rules?.['escapeBy'] === 'survive')
  .sort((a, b) => (REG.events[a]?.tier ?? 0) - (REG.events[b]?.tier ?? 0) || a.localeCompare(b))[0];
if (!eventId) throw new Error('the shipped content must have a survival Escape');
const PLAN = eventPlan(REG, eventId);

function run(seed: number) {
  const { config: built, playerId } = createHeadlessRace({
    seed,
    eventId,
    tuning: { ...ISOLATED, 'cops.spawnChance': 1, 'ai.aggressionScale': 0 },
  });
  const config: SimConfig = {
    ...built,
    weapons: [],
    riders: built.riders.map(({ startingWeapon: _weapon, ...rider }) => rider),
  };
  const sim = createSim(config);
  const log = createRaceLog({
    playerId,
    rules: PLAN.rules,
    objectives: PLAN.objectives,
    routeId: PLAN.lengths[0]?.route ?? eventId,
    roadIds: config.road.edges.map((e) => e.id),
  });
  const input = quantizeInput({ steer: 0, throttle: 0.6, brake: 0, flags: 0 });
  const limit = Math.ceil(((PLAN.rules.surviveS ?? 60) + 30) * 60);
  let pursued = false;
  let pursuitTick = -1;
  let attackTicks = 0;
  while (sim.tick < limit && !sim.isOver() && log.status().state === 'running') {
    sim.step([input]);
    const snap = sim.snapshot();
    for (const cop of snap.entities.filter((e) => e.faction === 'law')) {
      if (cop.attackPhase !== 'idle') attackTicks++;
      if (cop.mode === 'Road' && cop.pursuitTargetId === playerId) {
        pursued = true;
        if (pursuitTick < 0) pursuitTick = sim.tick;
      }
    }
    log.note(sim.events(), snap);
  }
  return { pursued, pursuitTick, attackTicks, ticks: sim.tick, status: log.status(), tally: log.tally() };
}

describe('Escape follows real pursuit rather than combat attacks', () => {
  it('wins an authored survival objective with unarmed police, before the player finishes', () => {
    const search = firstSeed('unarmed survival Escape', seedRange(1, 8), run, (r) => r.pursued);
    expect(search.result).not.toBeNull();
    if (!search.result) throw new Error(search.summary);
    const r = search.result;
    process.stdout.write(
      `[escape-pursuit] ${eventId}: chase t${r.pursuitTick}, end t${r.ticks}, ${r.status.headline}, attacks ${r.attackTicks}\n`,
    );
    expect(r.attackTicks).toBe(0);
    expect(r.status).toMatchObject({ state: 'won', endNow: true });
    expect(r.tally.finished).toBe(false);
    expect(r.tally.busted).toBe(false);
    expect(r.ticks - r.pursuitTick).toBeGreaterThanOrEqual(Math.floor((PLAN.rules.surviveS ?? 60) * 60));
  });
});
