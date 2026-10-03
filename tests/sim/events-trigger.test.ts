/// <reference types="vite/client" />
// The moving road events play NEAR THE RACERS (#391's duds, found on the live game in run W-T's
// final check). With the world on as it ships (traffic both ways, cops, the lot), a moving piece's
// vehicle used to be placed 500-600 m ahead of the leading racer when the piece went live: past
// traffic's keep-alive range (its 400 m window plus 50 m), so traffic recycled the cable car within
// seconds, and the runaway never came. A log truck placed that far out could still be running away
// when the piece ended behind it. And the SF cable street on the default route had no stretch the
// runaway could stand on (its walls), so it never turned up there at all.
// Now each moving piece's vehicle is placed ahead of the leading racer, inside traffic's range, its
// piece lasts until the field has met it, and its beat fires with a racer in range. Seeded bands
// over several races, never a floor set at the measured rate. Driven by sim ticks only.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { SimConfig, SimModifierDef } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { setPieceState } from '../../src/sim/modifiers';
import { MOVING } from '../../src/sim/modifiers/moving';
import { toCorridor, trafficState } from '../../src/sim/traffic';
import { seedRange } from './batch';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const SF = 'region-sf:sf-hill-sprint';
const SF_HILLS = 'region-sf:osm-sf-hills-run';
const PNW = 'region-pnw:pnw-fogline-run';
const CABLE = 'region-sf:sf-cable-runaway';
const LOGS = 'region-pnw:pnw-log-spill';

/** The race as it ships (no isolation profile: traffic recycling is what broke the pieces). */
function shipped(event: string, seed: number, route?: string): SimConfig {
  return buildSimConfig(REG, STREAMS.forEvent(REG, event, 'standard', route), {
    seed,
    eventId: event,
    length: 'standard',
    ...(route ? { route } : {}),
  });
}

/** The shipped race with only one road event, sure to fire. */
function forced(event: string, seed: number, mod: string, route?: string): SimConfig {
  const base = shipped(event, seed, route);
  const mods: SimModifierDef[] = base.modifiers
    .filter((m) => m.contentId === mod)
    .map((m) => ({ ...m, chance: 1 }));
  expect(mods).toHaveLength(1);
  return { ...base, modifiers: mods };
}

interface Outcome {
  placed: boolean;
  started: boolean;
  /** The beat's tick (-1 none) and the nearest racer's distance behind its vehicle then, m. */
  beatTick: number;
  gap: number;
}

/** Rides a race with the bot until the piece is over (or the race is). */
function ride(cfg: SimConfig, beatName: string): Outcome {
  const { sim, world } = createSimWithWorld(cfg);
  const st = setPieceState(world);
  const out: Outcome = { placed: st.pieces.length > 0, started: false, beatTick: -1, gap: Infinity };
  if (!out.placed) return out;
  const playerId = cfg.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < 60 * 60 * 6 && (st.pieces[0]?.phase ?? 2) !== 2) {
    const actions = emptyActions();
    bot.drive(snap, playerId, cfg.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    for (const e of sim.events()) {
      if (e.type === 'modifierStart') out.started = true;
      if (e.type !== 'setPieceBeat' || e.data['beat'] !== beatName || out.beatTick >= 0) continue;
      out.beatTick = e.tick;
      // How far behind the vehicle the nearest racer is, along the route.
      const c = trafficState(world).corridor;
      const v = world.movers[e.actor];
      const at = v ? toCorridor(c, v.pos) : null;
      if (!at) continue;
      for (const m of world.movers) {
        if (m.kind !== 'rider' || cfg.riders[m.riderIndex]?.faction === 'law') continue;
        const r = toCorridor(c, m.pos);
        if (!r) continue;
        const behind = c.routeDir * (at.u - r.u);
        if (behind >= 0) out.gap = Math.min(out.gap, behind);
      }
    }
  }
  return out;
}

function tally(name: string, runs: Outcome[]) {
  const placed = runs.filter((r) => r.placed).length;
  const beats = runs.filter((r) => r.beatTick >= 0);
  const duds = runs.filter((r) => r.started && r.beatTick < 0).length;
  console.log(
    `[print] ${name}: placed ${placed}/${runs.length}, beat ${beats.length}, duds ${duds}, gaps at the beat ${beats.map((r) => r.gap.toFixed(0)).join(', ')} m`,
  );
  return { placed, beats, duds };
}

describe('moving road events trigger near the racers (#391)', () => {
  it('the SF cable car runs away at the field on the Russian Hill route', () => {
    const runs = seedRange(1, 10).map((seed) => ride(forced(SF, seed, CABLE, SF_HILLS), 'runaway'));
    const { placed, beats, duds } = tally('cable runaway, Russian Hill', runs);
    expect(placed).toBe(10);
    // Before the fix: 4 beats in 10 (6 duds). A band, not the measured rate.
    expect(beats.length).toBeGreaterThanOrEqual(8);
    expect(duds).toBeLessThanOrEqual(2);
    for (const r of beats) expect(r.gap).toBeLessThanOrEqual(MOVING.runawayM + 1);
  }, 300_000);

  it('the SF cable car turns up on the default route (its cable street has walls)', () => {
    const runs = seedRange(1, 8).map((seed) => ride(forced(SF, seed, CABLE), 'runaway'));
    const { placed, beats } = tally('cable runaway, default route', runs);
    // Before the fix: never placed (0 of 8).
    expect(placed).toBeGreaterThanOrEqual(6);
    expect(beats.length).toBeGreaterThanOrEqual(Math.ceil(placed * 0.75));
    for (const r of beats) expect(r.gap).toBeLessThanOrEqual(MOVING.runawayM + 1);
  }, 300_000);

  it('the PNW log truck sheds its logs with a racer in range', () => {
    const runs = seedRange(1, 10).map((seed) => ride(forced(PNW, seed, LOGS), 'shed'));
    const { placed, beats, duds } = tally('log spill', runs);
    expect(placed).toBeGreaterThanOrEqual(9);
    expect(beats.length).toBeGreaterThanOrEqual(Math.ceil(placed * 0.8));
    expect(duds).toBeLessThanOrEqual(1);
    for (const r of beats) expect(r.gap).toBeLessThanOrEqual(MOVING.shedRangeM + 1);
  }, 300_000);

  it('keeps one or two road events a race at most', () => {
    for (const [event, route] of [
      [SF, SF_HILLS],
      [SF, undefined],
      [PNW, undefined],
    ] as const) {
      for (const seed of seedRange(1, 12)) {
        const cfg = shipped(event, seed, route);
        const cap = cfg.event.modifiersPerRace ?? Infinity;
        expect(cap).toBeLessThanOrEqual(2);
        const { world } = createSimWithWorld(cfg);
        expect(setPieceState(world).pieces.length).toBeLessThanOrEqual(cap);
      }
    }
  });
});
