/// <reference types="vite/client" />
// Weird events that move (run W-T, the pitch deck's #9: "The road event doesn't stand still. It
// runs at you, runs away from you, or lets you pick."), as the packs ship them, each forced in
// (chance 1) on a real region race. Every other world system is off (ISOLATED, tests/sim/batch.ts)
// except the road events, so the field is the riders and the piece under test. Driven by sim ticks
// only: the bot rides, or a rider is put where the test needs it.
// - The Keys' boat slide: serial signs tell the joke first (punchline nearest), the trailer lets go
//   as racers close in, and the skiff stops on the far side of the centre line.
// - The PNW log spill: the truck sheds its logs, they come to rest across both lanes, and riding
//   over one is a hop.
// - SF's cable-car runaway: only on a cable street; there it loses its grip and rolls back down at
//   the field. On a route without one it never takes the race's event slot.
// - The lane vote: the side a rider passes under picks the event ahead, either side.
// - The gator crossing puts its gators on the road through the pedestrian system.
// - One seed replays to the same hashes with the moving pieces in.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import {
  LAW_PROP_ID_BASE,
  type PropSnapshot,
  type SimConfig,
  type SimEvent,
  type SimModifierDef,
} from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { setPieceState } from '../../src/sim/modifiers';
import { laneAt } from '../../src/sim/modifiers/setpieces';
import { pedsState } from '../../src/sim/peds';
import { trafficState } from '../../src/sim/traffic';
import { fromCorridor } from '../../src/sim/traffic/corridor';
import { firstSeed, ISOLATED, seedRange } from './batch';

/**
 * The road events' props only. Since #395 (law with a personality) the snapshot's props also carry
 * the cops' own, with ids from LAW_PROP_ID_BASE up: the END OF JURISDICTION sign stands in every
 * race whose law crew has one, cops on or off, and a radar trooper's radar. They are not road events.
 */
const pieceProps = (props: readonly PropSnapshot[] | undefined): PropSnapshot[] =>
  (props ?? []).filter((p) => p.id < LAW_PROP_ID_BASE);

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const KEYS = 'base:m1-skeleton-sprint';
const PNW = 'region-pnw:pnw-fogline-run';
const ROAD_EVENTS_ONLY = { ...ISOLATED, 'modifiers.setPieceChance': 1 };

function config(event: string, seed: number, route?: string): SimConfig {
  return buildSimConfig(REG, STREAMS.forEvent(REG, event, 'standard', route), {
    seed,
    eventId: event,
    length: 'standard',
    tuning: ROAD_EVENTS_ONLY,
    ...(route ? { route } : {}),
  });
}

/** The race with only the named shipped modifiers, each at the given chance, and no per-race cap. */
function only(base: SimConfig, chances: Record<string, number>): SimConfig {
  const mods: SimModifierDef[] = base.modifiers
    .filter((m) => m.contentId in chances)
    .map((m) => ({ ...m, chance: chances[m.contentId] ?? 0 }));
  expect(mods.map((m) => m.contentId).sort()).toEqual(Object.keys(chances).sort());
  const { modifiersPerRace: _cap, ...event } = base.event;
  return { ...base, event, modifiers: mods };
}

/**
 * A shipped modifier's set-piece effect. The words and counts these tests expect are read from it
 * (the quality retro's recommendation 5: a copy edit in the pack is not a test failure).
 */
function effect(modifier: string): Readonly<Record<string, unknown>> {
  const e = REG.modifiers[modifier]?.effects[0];
  if (!e) throw new Error(`no modifier ${modifier} in the packs`);
  return e;
}

/** A text field of a shipped modifier's effect, as a list (a serial sign run is one already). */
function words(modifier: string, field: string): string[] {
  const v = effect(modifier)[field];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== 'string' || v === '') throw new Error(`${modifier} has no ${field}`);
  return [v];
}

interface Run {
  events: SimEvent[];
  hashes: number[];
  signs: { label: string; variant: string; x: number; z: number }[];
  kinds: Set<string>;
  problem: string | null;
  pieces: ReturnType<typeof setPieceState>['pieces'];
  maxLogs: number;
  /** Each log's offset across the road from the centre line where it came to rest (+: the forward side). */
  logRest: number[];
}

function ride(cfg: SimConfig, maxTicks = 60 * 60 * 5, until?: (r: Run) => boolean): Run {
  const { sim, world } = createSimWithWorld(cfg);
  const playerId = cfg.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  let snap = sim.snapshot();
  const run: Run = {
    events: [],
    hashes: [],
    signs: [],
    kinds: new Set(),
    problem: null,
    pieces: [],
    maxLogs: 0,
    logRest: [],
  };
  const seen = new Set<number>();
  while (!sim.isOver() && sim.tick < maxTicks) {
    const actions = emptyActions();
    bot.drive(snap, playerId, cfg.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    run.events.push(...sim.events());
    const props = pieceProps(snap.props);
    let logs = 0;
    for (const p of props) {
      run.kinds.add(p.kind);
      if (p.kind === 'log') logs++;
      if (p.kind === 'sign' && !seen.has(p.id)) {
        seen.add(p.id);
        run.signs.push({ label: p.label, variant: p.variant, x: p.x, z: p.z });
      }
      if (![p.x, p.y, p.z, p.heading, p.tilt].every(Number.isFinite))
        run.problem ??= `prop ${p.id} not finite`;
    }
    run.maxLogs = Math.max(run.maxLogs, logs);
    for (const m of snap.entities) run.problem ??= moverProblem(m, cfg.route);
    if (sim.tick % 600 === 0) run.hashes.push(sim.hash());
    const st = setPieceState(world);
    run.pieces = st.pieces;
    // The logs once all six have come to rest, before the piece ends and clears them.
    const shed = st.props.filter((q) => q.kind === 'log');
    if (run.logRest.length === 0 && shed.length === 6 && shed.every((q) => !q.moving)) {
      const c = trafficState(world).corridor;
      for (const q of shed) {
        const p = st.pieces[q.piece];
        if (!p) continue;
        const lane = laneAt(cfg, c, q.u, p);
        run.logRest.push((q.cd - (lane.cd - (lane.side * lane.width) / 2)) * lane.side);
      }
    }
    if (until?.(run)) break;
  }
  return run;
}

const beats = (r: Run, beat: string) =>
  r.events.filter((e) => e.type === 'setPieceBeat' && e.data['beat'] === beat);

describe('weird events that move (W-T)', () => {
  it('the Keys boat slide: four serial signs, punchline nearest; the skiff slides across and stops', () => {
    const cfg = only(config(KEYS, 2), { 'base:keys-boat-slide': 1 });
    const run = ride(cfg, 60 * 60 * 5, (r) => (r.pieces[0]?.phase ?? 0) === 2);
    const p = run.pieces[0];
    console.log(
      `[print] boat slide: unhitch beats ${beats(run, 'unhitch').length}, rest cd ${p?.mcd.toFixed(2)} (lane ${p?.laneCd.toFixed(2)}), yaw ${p?.myaw.toFixed(2)}, speed ${p?.mv.toFixed(2)}; signs ${run.signs.map((s) => s.label).join(' / ')}`,
    );
    expect(run.problem).toBeNull();
    expect(p?.piece).toBe('boat-slide');
    expect(beats(run, 'unhitch')).toHaveLength(1);
    // Serial signs only (no warning sign of its own), in reading order, the punchline nearest.
    const serial = run.signs.filter((s) => s.variant === 'serial');
    const expected = words('base:keys-boat-slide', 'serial');
    expect(expected.length).toBeGreaterThan(1);
    expect(run.signs).toHaveLength(expected.length);
    expect(serial.map((s) => s.label)).toEqual(expected);
    const startU = p?.u ?? 0;
    expect(startU).not.toBe(0);
    // At rest across the centre line from the forward lane where it stopped (its inner side, past
    // the lane's inner edge), turned off the road's line.
    expect(p?.mv).toBe(0);
    if (!p) return;
    const { world } = createSimWithWorld(cfg);
    const lane = laneAt(cfg, trafficState(world).corridor, p.mu, p);
    const inward = (lane.cd - p.mcd) * lane.side;
    console.log(
      `[print] boat at rest ${inward.toFixed(2)} m inward of its lane's centre (lane ${lane.width} m wide)`,
    );
    expect(inward).toBeGreaterThan(lane.width / 2 + 0.5);
    expect(inward).toBeLessThan(lane.width / 2 + 3.5);
    expect(Math.abs(p.myaw)).toBeGreaterThan(0.4);
  });

  it('the PNW log spill: six logs across both lanes, and riding over one is a hop', () => {
    // Which seeds put a racer over a log depends on the field's lines: the first seed where one
    // hops is used (R6), and the logs' spread is checked on it.
    const found = firstSeed(
      'log spill hop',
      seedRange(1, 12),
      (seed) => ride(only(config(PNW, seed), { 'region-pnw:pnw-log-spill': 1 }), 60 * 60 * 4),
      (r) => r.events.some((e) => e.type === 'jump' && e.data['cause'] === 'log'),
    );
    console.log(`[print] ${found.summary}`);
    const run = found.result;
    expect(run, found.summary).not.toBeNull();
    if (!run) return;
    expect(run.problem).toBeNull();
    expect(beats(run, 'shed')).toHaveLength(1);
    expect(run.pieces[0]?.dropped).toBe(6);
    expect(run.maxLogs).toBe(6);
    // At rest across both lanes: some on the forward side of the centre line, some on the oncoming.
    console.log(
      `[print] logs at rest, m from the centre line: ${run.logRest.map((x) => x.toFixed(1)).join(', ')}`,
    );
    expect(run.logRest).toHaveLength(6);
    expect(run.logRest.some((x) => x > 0.5)).toBe(true);
    expect(run.logRest.some((x) => x < -0.5)).toBe(true);
    for (const x of run.logRest) expect(Math.abs(x)).toBeLessThan(5);
    const hops = run.events.filter((e) => e.type === 'jump' && e.data['cause'] === 'log');
    console.log(
      `[print] log hops ${hops.length}, by riders ${[...new Set(hops.map((e) => e.actor))].join(',')}`,
    );
    // A hop lands: every hopping rider comes down again (a land event after its jump).
    for (const h of hops)
      expect(run.events.some((e) => e.type === 'land' && e.actor === h.actor && e.tick > h.tick)).toBe(true);
  });

  it('the log truck prefers a downhill', () => {
    let down = 0;
    let placed = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const cfg = only(config(PNW, seed), { 'region-pnw:pnw-log-spill': 1 });
      const { world } = createSimWithWorld(cfg);
      const p = setPieceState(world).pieces[0];
      if (!p) continue;
      placed++;
      const c = trafficState(world).corridor;
      const pos = { edge: 0, s: 0, d: 0, dir: 1 as 1 | -1 };
      let sum = 0;
      for (let a = 0; a <= p.len; a += 10) {
        fromCorridor(c, p.u + c.routeDir * a, 0, c.routeDir, pos);
        sum += cfg.road.frameAt(pos.edge, pos.s).grade * pos.dir;
      }
      if (sum / (p.len / 10 + 1) < -0.02) down++;
    }
    console.log(`[print] log spill on a downhill in ${down} of ${placed} placements (12 seeds)`);
    expect(placed).toBeGreaterThan(8);
    expect(down / placed).toBeGreaterThan(0.6);
  });

  it('the SF cable car runs away only on a cable street, and never takes the slot elsewhere', () => {
    const events = Object.keys(REG.events).filter((id) => id.startsWith('region-sf:'));
    const onCable: string[] = [];
    const offCable: string[] = [];
    for (const event of events) {
      for (const route of [undefined, ...realRoutes(REG, event)]) {
        const cfg = config(event, 1, route);
        const has = cfg.route.mainEdges.some((e) =>
          (cfg.road.edges[e]?.tags ?? []).some((t) => t.tag === 'cable-line'),
        );
        (has ? onCable : offCable).push(`${event}|${route ?? ''}`);
      }
    }
    console.log(`[print] SF races with a cable street: ${onCable.length}; without: ${offCable.length}`);
    expect(onCable.length).toBeGreaterThan(0);
    // Off a cable street: with the runaway sure to fire and a cap of one, the roadwork still comes.
    const [offEvent, offRoute] = (offCable[0] ?? '|').split('|');
    const off = config(offEvent ?? '', 3, offRoute || undefined);
    const capped = only(off, { 'region-sf:sf-cable-runaway': 1, 'region-sf:sf-roadwork': 1 });
    const { world } = createSimWithWorld({ ...capped, event: { ...capped.event, modifiersPerRace: 1 } });
    expect(setPieceState(world).pieces.map((p) => p.piece)).toEqual(['roadwork']);
    // On one: it climbs ahead, loses its grip as racers close in, and rolls back at them.
    const [onEvent, onRoute] = (onCable[0] ?? '|').split('|');
    const found = firstSeed(
      'cable runaway',
      seedRange(1, 8),
      (seed) =>
        ride(
          only(config(onEvent ?? '', seed, onRoute || undefined), { 'region-sf:sf-cable-runaway': 1 }),
          60 * 60 * 4,
          (r) => (r.pieces[0]?.rolled ?? 0) > 60,
        ),
      (r) => r.pieces[0]?.piece === 'cable-runaway' && beats(r, 'runaway').length === 1,
    );
    console.log(`[print] ${found.summary}; rolled ${found.result?.pieces[0]?.rolled.toFixed(1)} m`);
    const run = found.result;
    expect(run, found.summary).not.toBeNull();
    expect(run?.problem).toBeNull();
    expect(run?.pieces[0]?.rolled ?? 0).toBeGreaterThan(60);
    expect(run?.signs.map((s) => s.label)).toEqual(words('region-sf:sf-cable-runaway', 'serial'));
  });

  it.each([
    ['right', 'PARADE', 'base:keys-costume-parade', 'parade'],
    ['left', 'GATOR CROSSING', 'base:keys-gator-crossing', 'animal-crossing'],
  ] as const)('the Keys lane vote: riding under its %s side picks %s', (side, _text, pick, piece) => {
    const cfg = only(config(KEYS, 4), {
      'base:keys-lane-vote': 1,
      'base:keys-costume-parade': 0,
      'base:keys-gator-crossing': 0,
    });
    const { sim, world } = createSimWithWorld(cfg);
    const vote = setPieceState(world).pieces[0];
    expect(vote?.piece).toBe('lane-vote');
    if (!vote) return;
    const c = trafficState(world).corridor;
    const player = world.movers.find((m) => cfg.riders[m.riderIndex]?.controller.kind === 'player');
    expect(player).toBeDefined();
    if (!player) return;
    // Put the player 30 m short of the gantry, under the side under test, and let it ride through.
    const laneCd = side === 'right' ? vote.laneCd : -vote.laneCd;
    const gantryU = vote.u + c.routeDir * 6;
    const events: SimEvent[] = [];
    for (let t = 0; t < 60 * 3 && vote.voted === 0; t++) {
      if (t === 0 || player.mode !== 'Road') {
        fromCorridor(c, gantryU - c.routeDir * 30, laneCd, c.routeDir, player.pos);
        player.speed = 30;
        player.yaw = 0;
        player.mode = 'Road';
      }
      sim.step([{ steer: 0, throttle: 255, brake: 0, flags: 0 }]);
      events.push(...sim.events());
    }
    const cast = events.filter((e) => e.type === 'setPieceBeat' && e.data['beat'] === 'vote');
    expect(cast).toHaveLength(1);
    expect(cast[0]?.data['side']).toBe(side);
    expect(cast[0]?.data['pick']).toBe(pick);
    const pieces = setPieceState(world).pieces;
    expect(pieces).toHaveLength(2);
    expect(pieces[1]?.piece).toBe(piece);
    expect(pieces[1]?.u).toBe(vote.voteU);
    const gantry = pieceProps(sim.snapshot().props).find((p) => p.kind === 'gantry');
    const voteMod = 'base:keys-lane-vote';
    expect(gantry?.label).toBe(
      `${words(voteMod, 'leftText').join('')} | ${words(voteMod, 'rightText').join('')}`,
    );
    expect(gantry?.variant).toBe(side);
    expect(gantry?.spanM).toBeGreaterThan(5);
  });

  it('the gator crossing sends its gators across through the pedestrian system', () => {
    const cfg = only(config(KEYS, 5), { 'base:keys-gator-crossing': 1 });
    const gatorType = cfg.trafficTypes.findIndex((t) => t.contentId === 'base:event-crossing-gator');
    expect(gatorType).toBeGreaterThanOrEqual(0);
    const run = ride(cfg, 60 * 60 * 4, (r) => r.events.some((e) => e.type === 'modifierStart'));
    expect(run.events.some((e) => e.type === 'modifierStart' && e.data['piece'] === 'animal-crossing')).toBe(
      true,
    );
    expect(run.kinds).toContain('person');
    expect(run.signs.map((s) => s.label)).toEqual(words('base:keys-gator-crossing', 'signText'));
    // Re-run to the same tick to count the gators placed (the peds state holds them).
    const { sim, world } = createSimWithWorld(cfg);
    const bot = createBot();
    const playerId = cfg.riders.findIndex((r) => r.controller.kind === 'player');
    let snap = sim.snapshot();
    while (sim.tick < (run.events.at(-1)?.tick ?? 0) + 1) {
      const actions = emptyActions();
      bot.drive(snap, playerId, cfg.route, actions);
      sim.step([toSimInput(actions)]);
      snap = sim.snapshot();
    }
    const gators = pedsState(world).type.filter((t) => t === gatorType).length;
    expect(gators).toBe(effect('base:keys-gator-crossing')['count']);
  });

  it('replays to the same hashes with every moving piece in', () => {
    const cfg = only(config(KEYS, 6), {
      'base:keys-boat-slide': 1,
      'base:keys-lane-vote': 1,
      'base:keys-costume-parade': 0,
      'base:keys-gator-crossing': 0,
    });
    const a = ride(cfg, 60 * 60);
    const b = ride(cfg, 60 * 60);
    expect(a.hashes.length).toBeGreaterThan(0);
    expect(b.hashes).toEqual(a.hashes);
  });
});
