// combat-2 through the real sim (createSim with every system, ai-1's controller on the rival): a
// brawler who picks up the roadside pipe swings it at the player, the steal cue telegraphs the
// window, and a player who presses attack on the cue takes the pipe. Nothing here reaches into
// the sim's internals: the player reacts to the events alone, as a person reacts to the glint.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import {
  createSim,
  quantizeInput,
  SIM_TUNING,
  tuningDefaults,
  type SimConfig,
  type SimEvent,
  type SimInput,
} from '../api';
import { F, KICK, PIPE, PUNCH } from './harness.test-util';

const BIKE = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};

function brawlConfig(seed: number): SimConfig {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1500, kappa: 0 }]));
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 1480 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return {
    seed,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [],
      raceEndTimeoutTicks: 1800,
    },
    riders: [
      {
        contentId: 'base:brawler',
        name: 'Brawler',
        role: 'rival',
        faction: 'rider',
        controller: {
          kind: 'ai',
          style: 'heavy-hitter',
          personality: { aggression: 1, dirtiness: 0, targetPreference: ['player'] },
        },
        bike: BIKE,
        massKg: 80,
        healthMax: 1000,
      },
      {
        contentId: 'base:player',
        name: 'Player',
        role: 'player',
        faction: 'rider',
        controller: { kind: 'player', slot: 0 },
        bike: BIKE,
        massKg: 80,
        healthMax: 1000,
      },
    ],
    weapons: [PUNCH, KICK, PIPE],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    // ai-1's brawler without rivals-1's style quirks (on by default since the integration round):
    // the heavy hitter's slow start would keep him off the pipe this scenario is built around.
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), 'ai.styleQuirks': 0 },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const RIVAL = 0;
const PLAYER = 1;

/** Rides the race; when `reactToCue`, presses attack on the tick after a steal cue aimed at the player. */
function race(seed: number, reactToCue: boolean) {
  const sim = createSim(brawlConfig(seed));
  const events: SimEvent[] = [];
  /** The snapshot's heldWeapon of both sides of each weaponGrab, on its tick. */
  const held: { source: unknown; actor: string | null; target: string | null }[] = [];
  /** Cues aimed at the player while his hands were empty: the ones a press can answer with a steal. */
  let openCues = 0;
  let press = false;
  for (let t = 0; t < 60 * 50 && !sim.isOver(); t++) {
    // The player holds its lane (1.7 m right of centre), as a person steers back after a shove;
    // combat-3's kick moves a rider about a lane, so a player who never steered would end up on
    // the shoulder and draw the rival past the roadside pipes.
    const me = sim.snapshot().entities[PLAYER];
    const steer = me ? Math.max(-1, Math.min(1, (1.7 - me.road.d) * 0.3 - me.road.yaw * 2)) : 0;
    const input: SimInput = quantizeInput({ throttle: 0.8, brake: 0, steer, flags: press ? F.attack : 0 });
    sim.step([input]);
    const evs = sim.events();
    events.push(...evs);
    for (const g of evs.filter((e) => e.type === 'weaponGrab')) {
      const ents = sim.snapshot().entities;
      held.push({
        source: g.data['source'],
        actor: ents[g.actor]?.heldWeapon ?? null,
        target: ents[g.target ?? -1]?.heldWeapon ?? null,
      });
    }
    const cue = evs.some((e) => e.type === 'stealWindow' && e.actor === RIVAL && e.target === PLAYER);
    if (cue && !sim.snapshot().entities[PLAYER]?.heldWeapon) openCues++;
    press = reactToCue && cue;
  }
  return { sim, events, held, openCues };
}

/**
 * The first seed whose rival reaches a roadside pipe before the player does. Which rider rolls over
 * a pipe first depends on both launches (playtest 1c's launch punch moved seed 3's player onto it
 * first), and a player who holds a pipe cannot steal one, so the steal scenario needs the rival armed.
 */
function rivalArmedSeed(): number {
  for (let seed = 1; seed <= 10; seed++) {
    const first = of(race(seed, false).events, 'weaponGrab').find((e) => e.data['source'] === 'road');
    if (first?.actor === RIVAL) return seed;
  }
  throw new Error('no seed in 1-10 arms the rival first');
}

const of = (events: readonly SimEvent[], type: SimEvent['type']) => events.filter((e) => e.type === type);

describe('combat-2 through the real sim, against ai-1', () => {
  it('the rival picks up a pipe and swings it; the cue comes on tick 7 of each pipe wind-up', () => {
    const { events } = race(3, false);
    const pickups = of(events, 'weaponGrab').filter((e) => e.data['source'] === 'road');
    const rivalPipe = pickups.find((e) => e.actor === RIVAL);
    expect(rivalPipe).toBeDefined();
    const swings = of(events, 'attackStart').filter(
      (e) => e.actor === RIVAL && e.data['weapon'] === PIPE.contentId,
    );
    expect(swings.length).toBeGreaterThan(0);
    const cues = of(events, 'stealWindow');
    // Every uninterrupted pipe wind-up gets exactly one cue, 7 ticks in, with its cause id.
    for (const cue of cues) {
      const swing = swings.find((s) => s.causeId === cue.causeId);
      expect(swing).toBeDefined();
      expect(cue.tick - (swing?.tick ?? 0)).toBe(7);
    }
    expect(cues.length).toBeGreaterThan(0);
  });

  it('a player who presses attack on the cue steals the pipe; one who does not, keeps getting hit by it', () => {
    const seed = rivalArmedSeed();
    const passive = race(seed, false);
    const pipeHitsOnPlayer = of(passive.events, 'hit').filter(
      (e) => e.actor === RIVAL && e.target === PLAYER && e.data['weapon'] === PIPE.contentId,
    );
    expect(pipeHitsOnPlayer.length).toBeGreaterThan(0);

    const thief = race(seed, true);
    const steals = of(thief.events, 'weaponGrab').filter((e) => e.data['source'] === 'steal');
    expect(steals.length).toBeGreaterThan(0);
    expect(steals[0]?.actor).toBe(PLAYER);
    expect(steals[0]?.target).toBe(RIVAL);
    expect(steals[0]?.data['windupTick']).toBe(8);
    // The snapshot shows the pipe move: in the thief's hand, out of the rival's.
    expect(thief.held.find((h) => h.source === 'steal')).toEqual({
      source: 'steal',
      actor: PIPE.contentId,
      target: null,
    });
    expect(thief.held.find((h) => h.source === 'road')?.actor).toBe(PIPE.contentId);
    // The same seed replays to the same hash.
    expect(race(seed, true).sim.hash()).toBe(thief.sim.hash());
  });

  it('over ten seeds, every cue aimed at the player that it answers ends in a steal', () => {
    const rows: string[] = [];
    let seedsWithSteal = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { events, openCues } = race(seed, true);
      const grabs = of(events, 'weaponGrab');
      const steals = grabs.filter((e) => e.data['source'] === 'steal');
      const cuesAtPlayer = of(events, 'stealWindow').filter((e) => e.actor === RIVAL && e.target === PLAYER);
      for (const s of steals) expect(s.data['windupTick']).toBe(8);
      // Pressing on the tick after the cue is always inside the window (the cue is its tick 7). A
      // player already holding a pipe cannot take another, so only cues met empty-handed count.
      if (openCues > 0) expect(steals.length, `seed ${seed}`).toBeGreaterThan(0);
      if (steals.length > 0) seedsWithSteal++;
      const pipeHits = of(events, 'hit').filter((e) => e.data['weapon'] === PIPE.contentId);
      const swings = of(events, 'attackStart').filter((e) => e.data['weapon'] === PIPE.contentId);
      rows.push(
        `seed ${seed}: ${grabs.length - steals.length} pickups, ${swings.length} pipe swings, ` +
          `${cuesAtPlayer.length} cues at the player, ${pipeHits.length} pipe hits, ${steals.length} steals`,
      );
    }
    // On the dev machine at the time of writing: 7 of 10 seeds end in a steal (in the other three
    // the rival rides past the pipes). The floor catches a regression without pinning AI lines.
    expect(seedsWithSteal, rows.join('\n')).toBeGreaterThanOrEqual(3);
  });
});
