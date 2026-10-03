// cops-1: Sgt. Pruitt is spawned from the road's `copSpawn` feature (docs/milestones/M1.md,
// cops-1 Builds), not from a grid slot. The base event's road-1 track puts one, the bait-shop lot
// (`bait-shop-lot`), beside Marina Run at s 4..20, d 6.1..9.6 (5.5..9 before playtest 1's wider
// lanes). He waits, parked on the shoulder at the lot's road edge, until his siren, then pulls out
// after the player. Checked on the real base race (the producer the batch uses), then over the
// shared batch's traces. Since playtest 2 (2026-10-02) the starting cops patrol up the road and the
// lot keeps the field's last cop (for a speed trap or chaos); the batch check follows whichever cop
// sounds the first siren, a patrol cop, from his spot on the shoulder.
//
// The determinism run (2026-10-03, R12): riders bump (playtest 1 item 6) and traffic nudges, so a
// parked cop can be moved by the world before his siren: a rider or a car touched him in some batch
// races (seed 40: 5.1 m/s at t480; 1.2 m back along the road in others), and the old check failed
// on whichever PR reshuffled a seed into that. So:
// - the exact "parked" check (speed 0, the same spot to 5 decimals) runs per tick in a quiet race
//   (no traffic, no fights, no road events), where nothing reaches him;
// - in the batch it holds exactly until the first contact with him (a wobble, crash, hit, kick or
//   takedown that names him), and the races where something touched him are counted, printed and
//   held under a ceiling, so a spawn that drops traffic onto him every race still fails;
// - "gives chase" stays a speed band: above 10 m/s within 30 s of his siren, in every race.
/// <reference types="vite/client" />
import { beforeAll, describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { EntitySnapshot, SimEvent } from '../../src/sim/api';
import { BATCH_TIMEOUT_MS, createBatchRace, NO_ROAD_EVENTS, simBatch, type BatchResult } from './batch';

let batch: BatchResult;
beforeAll(async () => {
  batch = await simBatch();
}, BATCH_TIMEOUT_MS);

/** Event types that mean something touched a rider: the world moved him, not his own controller. */
const CONTACT = new Set<SimEvent['type']>(['wobble', 'crash', 'hit', 'kick', 'takedown']);
/** "Gives chase": above this speed, m/s, within CHASE_WITHIN_TICKS of his siren. */
const CHASE_MPS = 10;
const CHASE_WITHIN_TICKS = 30 * 60;
/**
 * At most this many of the batch's races may have something touch the first siren's cop before his
 * siren [default]. Measured 0 of 50 on main 0cd9431; the red runs of 2026-10-02 each stopped at
 * the first such race (seed 40, or another reshuffled seed). The ceiling is a fifth of the batch, so content reshuffling a seed or
 * two never trips it, while a spawn rule that drops a car onto him (the #322 bug, seed 39) in most
 * races does.
 */
const TOUCHED_MAX = 10;
/** The quiet race: no road events, patrol or heat (the batch's pins), no traffic, no fights. */
const QUIET: Readonly<Record<string, number>> = {
  ...NO_ROAD_EVENTS,
  'traffic.density': 0,
  'ai.aggressionScale': 0,
};
/** Seeds the quiet race may use, in order: the first where nothing touches him (it is seed 1 today). */
const QUIET_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

const touches = (e: SimEvent, id: number) => CONTACT.has(e.type) && (e.actor === id || e.target === id);

describe('cops: Sgt. Pruitt starts from the copSpawn feature', () => {
  it('waits at the bait-shop lot on Marina Run, on the shoulder clear of the lanes, facing the race', () => {
    const { sim, config } = createBatchRace(1);
    const edge = config.road.edgeIndex('m1-marina-run');
    const lot = config.road.featuresOf(edge, 'copSpawn');
    expect(lot.map((f) => f.id)).toEqual(['bait-shop-lot']);
    const cop = sim
      .snapshot()
      .entities.filter((e) => e.faction === 'law')
      .at(-1); // the lot's cop: the patrol takes the first ones
    expect(cop?.road.edge).toBe(edge);
    expect(cop?.road.s).toBeGreaterThanOrEqual(lot[0]?.s0 ?? NaN);
    expect(cop?.road.s).toBeLessThanOrEqual(lot[0]?.s1 ?? NaN);
    const lanes = config.road.lanesAt(edge, cop?.road.s ?? 0);
    const shoulder = lanes.find((l) => l.kind === 'shoulder' && l.dCenterM > 0); // the lot is on the right
    expect(cop?.road.d).toBeCloseTo(shoulder?.dCenterM ?? NaN, 5);
    for (const l of lanes.filter((x) => x.kind === 'drive'))
      expect(Math.abs((cop?.road.d ?? 0) - l.dCenterM)).toBeGreaterThan(l.widthM / 2);
    expect(cop?.road.dir).toBe(config.route.start.dir);
    expect(cop?.speed).toBe(0);
  });

  it('in a quiet race the first cop to sound his siren holds his spot every tick until then, then gives chase', () => {
    interface Quiet {
      seed: number;
      siren: number;
      cop: number;
      touched: boolean;
      /** The first tick he was off his spot or moving before his siren, or null. */
      moved: string | null;
      chase: { tick: number; speed: number } | null;
    }
    const run = (seed: number): Quiet => {
      const { sim, route, playerId } = createHeadlessRace({ seed, tuning: QUIET }, { includeDrafts: true });
      const bot = createBot();
      let snap = sim.snapshot();
      const law = snap.entities.filter((e) => e.faction === 'law');
      const spot = new Map(law.map((e) => [e.id, e]));
      const moved = new Map<number, string>();
      const touched = new Set<number>();
      let siren = -1;
      let cop = -1;
      let chase: Quiet['chase'] = null;
      while (!sim.isOver() && sim.tick < 120 * 60) {
        const actions = emptyActions();
        bot.drive(snap, playerId, route, actions);
        sim.step([toSimInput(actions)]);
        snap = sim.snapshot();
        if (siren < 0) {
          for (const e of sim.events()) {
            for (const c of law) if (touches(e, c.id)) touched.add(c.id);
            if (e.type === 'siren' && e.data['on'] === true && siren < 0) {
              siren = snap.tick;
              cop = e.actor;
            }
          }
        }
        if (siren < 0 || snap.tick < siren) {
          for (const c of law) {
            const now: EntitySnapshot | undefined = snap.entities[c.id];
            const was = spot.get(c.id);
            if (moved.has(c.id) || !now || !was) continue;
            const off =
              now.speed !== 0 ||
              now.road.edge !== was.road.edge ||
              Math.abs(now.road.s - was.road.s) >= 5e-6 ||
              Math.abs(now.road.d - was.road.d) >= 5e-6;
            if (off)
              moved.set(
                c.id,
                `t${snap.tick}: ${now.speed.toFixed(2)} m/s, s ${now.road.s.toFixed(3)} (was ${was.road.s.toFixed(3)}), ` +
                  `d ${now.road.d.toFixed(3)} (was ${was.road.d.toFixed(3)})`,
              );
          }
        } else if (snap.tick <= siren + CHASE_WITHIN_TICKS) {
          const me = snap.entities[cop];
          if (me && me.speed > CHASE_MPS) {
            chase = { tick: snap.tick, speed: me.speed };
            break;
          }
        } else break;
      }
      return { seed, siren, cop, touched: touched.has(cop), moved: moved.get(cop) ?? null, chase };
    };
    const tried: string[] = [];
    let q: Quiet | null = null;
    for (const seed of QUIET_SEEDS) {
      const r = run(seed);
      if (r.siren >= 0 && !r.touched) {
        q = r;
        break;
      }
      tried.push(`seed ${seed}: ${r.siren < 0 ? 'no siren' : 'something touched him'}`);
    }
    process.stdout.write(
      `[cops spawn, quiet] ${q ? `seed ${q.seed}: siren t${q.siren} (cop ${q.cop}); ${q.chase ? `${q.chase.speed.toFixed(1)} m/s at t${q.chase.tick}` : 'no chase'}` : 'no seed qualified'}` +
        `${tried.length ? `; skipped ${tried.join(', ')}` : ''}\n`,
    );
    expect(
      q,
      `a quiet race in seeds ${QUIET_SEEDS.join(', ')} where nothing touches him: ${tried.join('; ')}`,
    ).not.toBeNull();
    expect(q?.moved ?? null, `seed ${q?.seed}: parked every tick before the siren`).toBeNull();
    expect(q?.chase, `seed ${q?.seed}: gives chase within 30 s`).not.toBeNull();
  });

  it('in every batch race the first cop to sound his siren sits on the shoulder until then, then gives chase', () => {
    const lines: string[] = [];
    const touchedRaces: string[] = [];
    let exactSamples = 0;
    const { config } = createBatchRace(1);
    for (const r of batch.races) {
      const lit = r.events.find((e) => e.type === 'siren' && e.data['on'] === true);
      const siren = lit?.tick ?? Infinity;
      const copId = lit?.actor ?? -1;
      const touch = r.events.find((e) => e.tick < siren && touches(e, copId));
      const touchTick = touch?.tick ?? Infinity;
      if (touch) touchedRaces.push(`seed ${r.seed} t${touch.tick} ${touch.type}`);
      const samples = r.trace.map((t) => ({ tick: t.tick, cop: t.movers.find((m) => m.id === copId) }));
      const before = samples.filter((x) => x.tick < siren);
      const first = before[0]?.cop;
      expect(before.length, `seed ${r.seed}: samples before the siren`).toBeGreaterThan(0);
      // Until something touches him (and in most races nothing does): exactly parked.
      if (before[0] && before[0].tick < touchTick) {
        for (const x of before.filter((y) => y.tick < touchTick)) {
          exactSamples++;
          expect(x.cop?.speed, `seed ${r.seed} t${x.tick}: parked`).toBe(0);
          expect(x.cop?.edge).toBe(first?.edge);
          expect(x.cop?.s, `seed ${r.seed} t${x.tick}: s`).toBeCloseTo(first?.s ?? NaN, 5);
          expect(x.cop?.d, `seed ${r.seed} t${x.tick}: d`).toBeCloseTo(first?.d ?? NaN, 5);
        }
        // On the shoulder: clear of every drive lane.
        for (const l of config.road
          .lanesAt(first?.edge ?? -1, first?.s ?? 0)
          .filter((x) => x.kind === 'drive'))
          expect(Math.abs((first?.d ?? 0) - l.dCenterM), `seed ${r.seed}: off the lanes`).toBeGreaterThan(
            l.widthM / 2,
          );
      }
      // Within 30 s of the siren he is riding at chase speed, touched or not.
      const chasing = samples.find(
        (x) => x.tick > siren && x.tick <= siren + CHASE_WITHIN_TICKS && (x.cop?.speed ?? 0) > CHASE_MPS,
      );
      expect(chasing, `seed ${r.seed}: gives chase`).toBeDefined();
      if (r.seed === 1)
        lines.push(
          `seed 1: parked at edge ${first?.edge} s ${first?.s.toFixed(1)} d ${first?.d.toFixed(2)} ` +
            `for ${before.length} samples; siren t${siren}; ${chasing?.cop?.speed.toFixed(1)} m/s at t${chasing?.tick}`,
        );
    }
    process.stdout.write(
      `[examined] cops spawn: ${batch.races.length} races, ${exactSamples} exact parked samples; ` +
        `touched before his siren in ${touchedRaces.length} (ceiling ${TOUCHED_MAX})` +
        `${touchedRaces.length ? `: ${touchedRaces.join(', ')}` : ''}; ${lines.join('')}\n`,
    );
    expect(touchedRaces.length).toBeLessThanOrEqual(TOUCHED_MAX);
  });
});
