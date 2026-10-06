/// <reference types="vite/client" />
// Run W-U, career polish: three things run W-T's live check left UNVERIFIED, checked in seeded sim
// races from the real packs, driven by sim ticks (no wall clock, no frame waits):
//   - Bad Connection (Dial-Up's grudge, Keys tier 3) raced as the career races it, the whole world
//     on: he warns, drops and reconnects, and from each drop to its reconnect the snapshot shows him
//     frozen (signature `lag`, phase `act`), which is what render's ghost reads (render/riders/ghost.ts);
//   - Timber (Old Growth, the PNW boss) raced as the career races it: the objective counts exactly the
//     player's takedowns of him into traffic or scenery, never a fall from the fists ("health");
//   - the newspaper (air that pays, #389) on the real Pelican Channel Bridge ramp truck with the
//     game's own tuning: brake and kick held in the air opens it, the snapshot shows it while it is
//     read, folded in time it lands clean as a trick worth style cash, held into the ground it crashes.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, DEFAULT_EVENT } from '../../src/app';
import { careerDefs, careerOf, eventPlan, startCareer, type CareerDef } from '../../src/career';
import { loadBasePack, lookup } from '../../src/content';
import { emptyActions, toSimInput } from '../../src/input';
import { chooseSetPieces } from '../../src/road';
import { DEFAULT_PROFILE } from '../../src/save';
import { createSim, type EntitySnapshot, type SimEvent } from '../../src/sim/api';
import { activateRegion } from '../../src/stream';
import { playNode, REG } from './career-harness';

const print = (line: string) => process.stdout.write(`[career-polish] ${line}\n`);
const DEFS = careerDefs(REG);
const def = (region: string): CareerDef => {
  const d = careerOf(DEFS, region);
  if (!d) throw new Error(region);
  return d;
};
const fresh = () => startCareer(DEFS, { ...DEFAULT_PROFILE });
/**
 * A profile that reaches a region's boss the way the career puts a player there: on the fastest
 * bike the region sells. The field's pace is a share of the best open bike's top speed (playtest 3),
 * so a boss raced on the starting bike would only be a rider far up the road.
 */
function atTheBoss(d: CareerDef) {
  const top = (bike: string) => REG.bikes[bike]?.handling.topSpeedMps ?? 0;
  const bike = d.shop.map((s) => s.bike).sort((a, b) => top(b) - top(a))[0];
  if (!bike) throw new Error(`${d.regionId} sells no bike`);
  const start = fresh();
  return { ...start, bikes: { ...start.bikes, current: bike, owned: [...start.bikes.owned, bike] } };
}
const RACE_MS = 240_000;

describe('Bad Connection, raced as the career races it (Keys tier 3)', () => {
  const keys = def('florida-keys');
  const node = keys.nodes.find((n) => n.id === 'junkyard-hunt');

  it("the career's tier-3 grudge node is Dial-Up's Bad Connection", () => {
    expect(node?.event).toBe('base:keys-t3-dialup-grudge');
    const plan = eventPlan(REG, node?.event ?? '');
    expect(plan.kind).toBe('grudge-match');
    expect(plan.rules.rule).toBe('bad-connection');
    expect(plan.rules.rival).toBe('base:dial-up');
  });

  it(
    'he drops and reconnects in the full world, frozen in the snapshot from each drop to its reconnect',
    () => {
      if (!node) throw new Error('no junkyard-hunt node');
      let drops = 0;
      let reconnects = 0;
      let jumps = 0;
      let frozenTicks = 0;
      let notFrozen = 0;
      const seeds = [1, 2, 3];
      for (const seed of seeds) {
        let dial = -1;
        let dropped = false;
        const race = playNode(
          keys,
          node,
          fresh(),
          seed,
          true,
          (events: readonly SimEvent[], snap, config) => {
            if (dial < 0) dial = config.riders.findIndex((r) => r.contentId === 'base:dial-up');
            for (const e of events) {
              if (e.type !== 'badConnection') continue;
              expect(e.actor).toBe(dial);
              if (e.data['phase'] === 'drop') {
                drops++;
                dropped = true;
              } else if (e.data['phase'] === 'reconnect') {
                if (dropped) reconnects++;
                if (Number(e.data['jumpM']) > 0) jumps++;
                dropped = false;
              }
            }
            if (!dropped) return;
            const me = snap.entities[dial];
            // Riding and frozen in his lag's act: the ghost's cue. Down mid-drop he is no ghost (and
            // reconnects late, where he is), so only riding ticks count either way.
            if (!me || me.mode === 'Tumble' || me.mode === 'OnFoot') return;
            if (me.signature?.move === 'lag' && me.signature.phase === 'act') frozenTicks++;
            else notFrozen++;
          },
        );
        print(
          `seed ${seed}: ${race.report.outcome}, ${(race.ticks / 60).toFixed(0)} s, objectives ` +
            race.status.objectives.map((o) => `${o.label}:${String(o.met)}`).join(', '),
        );
      }
      print(
        `[examined] ${seeds.length} career races: ${drops} drops, ${reconnects} reconnects (${jumps} jumps), ` +
          `${frozenTicks} riding ticks dropped, ${notFrozen} of them not frozen in the snapshot`,
      );
      // Every 6 to 10 s while he rides (measured: 84 drops in three races of about 5 min): a floor at
      // about a third of that.
      expect(drops).toBeGreaterThanOrEqual(seeds.length * 10);
      expect(reconnects).toBeGreaterThanOrEqual(drops - seeds.length);
      // About a second frozen per drop (60 ticks), so at least half that on average.
      expect(frozenTicks).toBeGreaterThanOrEqual(drops * 30);
      expect(notFrozen).toBe(0);
    },
    RACE_MS,
  );
});

describe('Timber, raced as the career races it (the PNW boss)', () => {
  const pnw = def('pacific-northwest');
  const node = pnw.nodes.find((n) => n.id === pnw.boss);

  it("the boss is Old Growth's Timber, won home or by felling him three times", () => {
    const plan = eventPlan(REG, node?.event ?? '');
    expect(plan.rules.rule).toBe('timber');
    expect(plan.rules.rival).toBe('region-pnw:old-growth');
    expect(plan.objectives.find((o) => o.kind === 'beat-rival')?.params['orKnockdowns']).toBe(3);
  });

  it(
    'counts exactly his falls into traffic or scenery the player made, never a fall from the fists',
    () => {
      if (!node) throw new Error('no boss node');
      const byKind: Record<string, number> = {};
      let timberMoves = 0;
      let checked = 0;
      // Both kinds of fall must be seen: a fall from the fists (which must not count) and one into
      // traffic or scenery (which must). Measured on this tree, on the bike the region sells last
      // (16 seeds: 1 fist fall, 3 into traffic; on the starting bike the boss rides out of reach and
      // all 15 falls were fists). So races run from seed 1 until both are seen (at least four), up
      // to sixteen, and every race's objective is checked against what happened in it.
      // A fall from the fists is rare here (1 in those 16 races; none in 16 after the roadside dodge
      // reshuffled the races), so the search must find a counted fall, and a fist fall is checked in
      // whichever race has one: src/career/race-log.test.ts ("not a takedown by fists") holds the
      // fists rule on every run. A floor at a measured rate is not a rule (AGENTS.md).
      const counted = () => (byKind['traffic'] ?? 0) + (byKind['scenery'] ?? 0) > 0;
      const seen = () => checked >= 4 && (byKind['health'] ?? 0) > 0 && counted();
      for (let seed = 1; seed <= 16 && !seen(); seed++) {
        let me = -1;
        let rival = -1;
        let felled = 0;
        let charging = false;
        const race = playNode(pnw, node, atTheBoss(pnw), seed, true, (events, snap, config) => {
          if (rival < 0) {
            me = config.riders.findIndex((r) => r.controller.kind === 'player');
            rival = config.riders.findIndex((r) => r.contentId === 'region-pnw:old-growth');
          }
          for (const e of events) {
            if (e.type !== 'takedown' || e.actor !== me || e.target !== rival) continue;
            const kind = String(e.data['kind']);
            byKind[kind] = (byKind[kind] ?? 0) + 1;
            if (kind === 'traffic' || kind === 'scenery') felled++;
          }
          const sig = snap.entities[rival]?.signature;
          const now = sig?.move === 'timber' && sig.phase === 'act';
          if (now && !charging) timberMoves++;
          charging = now;
        });
        const beat = race.status.objectives.find((o) => o.kind === 'beat-rival');
        const shown = /FELL THEM (\d+)\/3/.exec(beat?.label ?? '');
        print(
          `seed ${seed}: ${race.report.outcome}, ${(race.ticks / 60).toFixed(0)} s, "${beat?.label}" ` +
            `met ${String(beat?.met)}; he was felled ${felled} times into traffic or scenery`,
        );
        expect(shown, beat?.label).not.toBeNull();
        expect(Number(shown?.[1])).toBe(Math.min(3, felled));
        // Felled three times wins whatever the finish (unless busted).
        if (felled >= 3 && !race.tally.busted) expect(beat?.met).toBe(true);
        checked++;
      }
      print(
        `[examined] ${checked} boss races; his falls by kind ${JSON.stringify(byKind)}; ${timberMoves} charges`,
      );
      // The rule was exercised on a counted fall (each race's count matched above), and he charged.
      expect(counted(), 'a fall into traffic or scenery in 16 races').toBe(true);
      expect(timberMoves).toBeGreaterThan(0);
    },
    RACE_MS * 3,
  );
});

describe('the newspaper on the real ramp truck (Pelican Channel Bridge), with the game’s tuning', () => {
  /** The race's own config (default tuning), the player alone on the road, the truck picked. */
  function solo() {
    const reg = loadBasePack();
    const event = lookup(reg.events, DEFAULT_EVENT);
    const routeFile = lookup(reg.routes, event.lengths[0]?.route ?? '');
    const network = lookup(reg.networks, routeFile.network);
    const stream = activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
    let seed = 1;
    while (!chooseSetPieces(stream.road.edges, seed).has('carrier-bridge-flat')) seed++;
    const built = buildSimConfig(reg, stream, {
      seed,
      tuning: { 'ai.aggressionScale': 0, 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 },
    });
    const config = { ...built, riders: built.riders.filter((r) => r.controller.kind === 'player') };
    return { sim: createSim(config), config };
  }

  /**
   * Rides the truck's line (d 4.4 from 200 m before its lip) at full throttle; in the air, `paper`
   * says whether brake and kick are held this tick (t: ticks since take-off).
   */
  function jump(paper: (t: number) => boolean) {
    const { sim, config } = solo();
    const name = (e: number) => config.road.edges[e]?.id ?? '?';
    const events: SimEvent[] = [];
    const reading: number[] = [];
    let airT = -1;
    let landed = false;
    for (let t = 0; t < 60 * 180 && !landed; t++) {
      const me = sim.snapshot().entities[0] as EntitySnapshot;
      const { edge, s, d, dir, yaw } = me.road;
      airT = me.mode === 'Airborne' ? airT + 1 : -1;
      const a = emptyActions();
      const v = Math.max(me.speed, 5);
      const kappa = config.road.kappaAt(edge, s) * dir;
      const line = name(edge) === 'm1-pelican-bridge' && s > 420 && s < 640 ? 4.4 : 2;
      a.steer = Math.max(-1, Math.min(1, 0.35 * (line - d) * dir - 2.5 * yaw + (kappa * v * v) / 22));
      if (airT >= 0 && paper(airT)) {
        a.brake = 1;
        a.kick = true;
      } else a.throttle = 1;
      sim.step([toSimInput(a)]);
      const after = sim.snapshot().entities[0] as EntitySnapshot;
      if (after.mode === 'Airborne' && after.trick === 'newspaper') reading.push(airT);
      for (const ev of sim.events()) {
        if (ev.actor !== 0) continue;
        events.push(ev);
        if (
          (ev.type === 'land' || ev.type === 'crash') &&
          airT >= 0 &&
          name(after.road.edge) === 'm1-pelican-bridge'
        )
          landed = true;
      }
    }
    const jumped = events.find((e) => e.type === 'jump');
    return { events, reading, jumped, config };
  }

  it('the race config carries the newspaper (its tuning key is on in the game)', () => {
    const { config } = solo();
    expect(config.tuning['riders.newspaperAirS']).toBeGreaterThan(0);
  });

  it('read on the truck and folded in time: shown while read, a clean landing, a trick worth style cash', () => {
    // Held from the fifth tick in the air for half a second, then let go.
    const r = jump((t) => t >= 5 && t < 35);
    const land = r.events.find((e) => e.type === 'land');
    const trick = r.events.find((e) => e.type === 'style' && e.data['kind'] === 'trick');
    print(
      `fold: jump ${Number(r.jumped?.data['speed']).toFixed(1)} m/s, read ${r.reading.length} ticks ` +
        `(air ticks ${r.reading[0]}-${r.reading.at(-1)}), land ${JSON.stringify(land?.data)}, trick cash ${String(trick?.data['points'])}`,
    );
    expect(r.jumped).toBeDefined();
    expect(r.reading.length).toBeGreaterThanOrEqual(18);
    expect(land?.data['trick']).toBe('newspaper');
    expect(land?.data['quality']).toBe('clean');
    expect(Number(trick?.data['points'])).toBeGreaterThan(0);
    expect(r.events.filter((e) => e.type === 'crash')).toHaveLength(0);
  }, 60_000);

  it('held into the ground: the rider lands holding the newspaper, a crash', () => {
    const r = jump((t) => t >= 5);
    const crash = r.events.find((e) => e.type === 'crash');
    print(`hold: read ${r.reading.length} ticks, crash ${JSON.stringify(crash?.data)}`);
    expect(r.reading.length).toBeGreaterThan(30);
    expect(crash?.data['attempt']).toBe('newspaper');
    expect(r.events.find((e) => e.type === 'land' && e.data['trick'] === 'newspaper')).toBeUndefined();
  }, 60_000);
});
