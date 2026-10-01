/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
// Playtest 1b quick wins ([decided] 2026-09-30) on the real keys-m1 track: the boost pads give a
// scripted rider a short boost past its top speed, and the car-carrier ramp truck on the Pelican
// Channel Bridge launches it into airtime and lands it clean, like the boat-ramp jump. The player
// rides alone (no traffic, rivals or cop), holding a line through each feature. The shared batch's
// counts are printed: how often the field meets the pads and the truck.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSimConfig, DEFAULT_EVENT, type ActionState } from '../../src/app';
import { loadBasePack, lookup } from '../../src/content';
import { chooseSetPieces } from '../../src/road';
import { createSim, quantizeInput, type EntitySnapshot, type SimEvent } from '../../src/sim/api';
import { activateRegion } from '../../src/stream';
import { BATCH_TIMEOUT_MS, simBatch, type BatchResult } from './batch';

const blank = (): ActionState => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  attack: false,
  attackSide: 0,
  kick: false,
  lookBack: false,
  skipRunBack: false,
});

/**
 * The set pieces these rides meet: the Marina Run pad and the truck at s 620 on the bridge. Since the
 * integration round each is one candidate of a seeded slot (playtest 1c item 2), so the rides use the
 * first seed that picks both (seed 3 used to, when they were always there).
 */
const PICKED = ['pad-marina-run', 'carrier-bridge-flat'];

function soloSetup() {
  const reg = loadBasePack();
  const event = lookup(reg.events, DEFAULT_EVENT);
  const routeFile = lookup(reg.routes, event.lengths[0]?.route ?? '');
  const network = lookup(reg.networks, routeFile.network);
  const stream = activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
  let seed = 1;
  while (!PICKED.every((id) => chooseSetPieces(stream.road.edges, seed).has(id))) seed++;
  const built = buildSimConfig(reg, stream, {
    seed,
    tuning: { 'ai.aggressionScale': 0, 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 },
  });
  const config = { ...built, riders: built.riders.filter((r) => r.controller.kind === 'player') };
  return { sim: createSim(config), config };
}

/**
 * Rides the main road from the grid, full throttle, holding `lineAt(edge id, s)` (the right lane's
 * centre, 2, where it returns null), until the rider reaches `stopAt` on `stopEdge`.
 */
function rideLine(lineAt: (edge: string, s: number) => number | null, stopEdge: string, stopAt: number) {
  const { sim, config } = soloSetup();
  const name = (e: number) => config.road.edges[e]?.id ?? '?';
  const events: { ev: SimEvent; edge: string; s: number }[] = [];
  const trace: { edge: string; s: number; speed: number; h: number; mode: string; boostS: number }[] = [];
  const top = config.riders[0]?.bike.topSpeedMps ?? 0;
  for (let t = 0; t < 60 * 180; t++) {
    const me = sim.snapshot().entities[0] as EntitySnapshot;
    const { edge, s, d, dir, yaw } = me.road;
    trace.push({ edge: name(edge), s, speed: me.speed, h: me.road.h, mode: me.mode, boostS: me.boostS ?? 0 });
    if (name(edge) === stopEdge && s > stopAt) break;
    const a = blank();
    a.throttle = 1;
    const v = Math.max(me.speed, 5);
    const kappa = config.road.kappaAt(edge, s) * dir;
    const target = lineAt(name(edge), s) ?? 2;
    a.steer = Math.max(-1, Math.min(1, 0.35 * (target - d) * dir - 2.5 * yaw + (kappa * v * v) / 22));
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    const now = sim.snapshot().entities[0] as EntitySnapshot;
    for (const ev of sim.events())
      if (ev.actor === 0) events.push({ ev, edge: name(now.road.edge), s: now.road.s });
  }
  return { events, trace, top };
}

describe('playtest 1b quick wins on keys-m1', () => {
  it('the Marina Run pad boosts a rider past its top speed', () => {
    // The right lane's centre, then onto the pad's line (d 3.5) for the last 120 m of the Marina
    // Run; the rider takes the boat-ramp cut after it, as the pad means it to.
    const r = rideLine(
      (edge, s) => (edge === 'm1-marina-run' && s > 110 ? 3.5 : null),
      'm1-boat-ramp-cut',
      100,
    );
    const boost = r.events.find((e) => e.ev.type === 'boost');
    const after = r.trace.filter((p) => p.boostS > 0);
    const peak = Math.max(...r.trace.map((p) => p.speed));
    console.log(
      `marina pad: boost ${JSON.stringify(boost?.ev.data)} at ${boost?.edge} s ${boost?.s.toFixed(1)}; ` +
        `peak ${peak.toFixed(1)} m/s against a top speed of ${r.top}`,
    );
    expect(boost?.ev.data['feature']).toBe('pad-marina-run');
    expect(r.events.filter((e) => e.ev.type === 'boost')).toHaveLength(1);
    expect(after.length).toBeGreaterThan(60);
    expect(peak).toBeGreaterThan(r.top + 3);
  }, 60_000);

  it('the ramp truck on the bridge: up the deck, airborne, landed clean', () => {
    // The truck's line (d 4.4) from 200 m before it to its lip, then the lane again.
    const line = (edge: string, s: number) =>
      edge === 'm1-pelican-bridge' && s > 420 && s < 640 ? 4.4 : null;
    const r = rideLine(line, 'm1-pelican-bridge', 900);
    const onBridge = (type: string) =>
      r.events.filter((e) => e.ev.type === type && e.edge === 'm1-pelican-bridge' && e.s > 500 && e.s < 900);
    const jump = onBridge('jump')[0];
    const land = onBridge('land')[0];
    const air = r.trace.filter((p) => p.edge === 'm1-pelican-bridge' && p.mode === 'Airborne' && p.s > 600);
    const deck = r.trace.filter(
      (p) => p.edge === 'm1-pelican-bridge' && p.mode === 'Road' && p.s > 621 && p.s < 631,
    );
    console.log(
      `bridge: jump at s ${jump?.s.toFixed(1)} (${Number(jump?.ev.data['speed']).toFixed(1)} m/s), ` +
        `${air.length} ticks airborne, peak h ${Math.max(0, ...air.map((p) => p.h)).toFixed(2)} m, ` +
        `landed at s ${land?.s.toFixed(1)} (${land?.ev.data['quality']}); other rider events ` +
        `${r.events.filter((e) => e.ev.type === 'crash' || e.ev.type === 'wobble').length}`,
    );
    expect(deck.length).toBeGreaterThan(3); // it rode up the deck: h above the road, grounded
    for (const p of deck) expect(p.h).toBeGreaterThan(0);
    expect(jump).toBeDefined();
    expect(jump?.s ?? 0).toBeGreaterThan(630);
    expect(jump?.s ?? 0).toBeLessThan(634);
    expect(air.length).toBeGreaterThan(60); // more than a second in the air
    expect(Math.max(...air.map((p) => p.h))).toBeGreaterThan(2.8);
    expect(land?.ev.data['quality']).toBe('clean');
    expect(land?.s ?? 0).toBeGreaterThan(700);
    expect(r.events.filter((e) => e.ev.type === 'crash')).toHaveLength(0);
  }, 60_000);
});

describe('playtest 1b quick wins in the shared batch (printed)', () => {
  let batch: BatchResult;
  beforeAll(async () => {
    batch = await simBatch();
  }, BATCH_TIMEOUT_MS);

  it('prints how often the field meets the pads and the truck', () => {
    let boosts = 0;
    let playerBoosts = 0;
    let truckHits = 0;
    let truckCrashes = 0;
    const byPad: Record<string, number> = {};
    for (const race of batch.races) {
      for (const e of race.events) {
        if (e.type === 'boost') {
          boosts++;
          if (e.actor === race.playerId) playerBoosts++;
          const id = String(e.data['feature']);
          byPad[id] = (byPad[id] ?? 0) + 1;
        }
        if ((e.type === 'wobble' || e.type === 'crash') && e.data['object'] === 'rampTruck') {
          truckHits++;
          if (e.type === 'crash') truckCrashes++;
        }
      }
    }
    process.stdout.write(
      `[quick wins] ${batch.races.length} races: ${boosts} boosts (${playerBoosts} the bot's), by pad ` +
        `${JSON.stringify(byPad)}; ${truckHits} riders ran into the ramp truck's side or front (${truckCrashes} crashed)\n`,
    );
    expect(boosts).toBeGreaterThan(0);
  });
});
