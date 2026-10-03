/// <reference types="vite/client" />
// Grudge rules in the sim (run W-T, the pitch deck's #14): Dial-Up's "Bad Connection" in his grudge
// match on the Keys' long haul. Seeded bot races from the real packs, driven by sim ticks, on the
// isolated profile (no traffic, cops or set pieces), so the one behaviour shows on its own:
//   - the event file's rule reaches SimConfig with its rival qualified as the riders are;
//   - each drop is warned: a `screech`, then the `drop` 45 ticks later, then the `reconnect` 60
//     ticks after that (a second frozen), in that order, cycle after cycle;
//   - a reconnect on clear road moves him 15 m up his edge in one tick (his road s jumps);
//   - the same race without the rule never emits one, and his plain lag still shows;
//   - a race replays to the same hash.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type SimConfig } from '../../src/sim/api';
import { ISOLATED } from './batch';

const print = (line: string) => process.stdout.write(`[grudge-rules] ${line}\n`);
const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENT = 'base:keys-t3-dialup-grudge';
const TICKS = 120 * 60;
const SEEDS = [1, 2, 3];

function config(seed: number): SimConfig {
  return buildSimConfig(REG, STREAMS.forEvent(REG, EVENT), { seed, eventId: EVENT, tuning: { ...ISOLATED } });
}

interface Beat {
  tick: number;
  phase: string;
  jumpM: number;
  /** Dial-Up's road s on the tick before the event and on its tick. */
  sBefore: number;
  sAfter: number;
  edgeSame: boolean;
}

function race(cfg: SimConfig) {
  const sim = createSim(cfg);
  const me = cfg.riders.findIndex((r) => r.controller.kind === 'player');
  const dial = cfg.riders.findIndex((r) => r.contentId === 'base:dial-up');
  const bot = createBot();
  const beats: Beat[] = [];
  let lagActTicks = 0;
  let snap = sim.snapshot();
  while (sim.tick < TICKS && !sim.isOver()) {
    const before = snap.entities[dial]?.road;
    const a = emptyActions();
    bot.drive(snap, me, cfg.route, a);
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    const after = snap.entities[dial]?.road;
    const sig = snap.entities[dial]?.signature;
    if (sig?.move === 'lag' && sig.phase === 'act') lagActTicks++;
    for (const e of sim.events()) {
      if (e.type !== 'badConnection') continue;
      expect(e.actor).toBe(dial);
      beats.push({
        tick: e.tick,
        phase: String(e.data['phase']),
        jumpM: Number(e.data['jumpM'] ?? 0),
        sBefore: before?.s ?? 0,
        sAfter: after?.s ?? 0,
        edgeSame: before?.edge === after?.edge,
      });
    }
  }
  return { beats, lagActTicks, hash: sim.hash() };
}

describe("Dial-Up's Bad Connection in his grudge match", () => {
  it("the event's rule reaches SimConfig, its rival qualified as the riders are", () => {
    const cfg = config(1);
    expect(cfg.event.grudgeRule).toEqual({ rule: 'bad-connection', rival: 'base:dial-up' });
    expect(cfg.riders.map((r) => r.contentId)).toContain('base:dial-up');
    // An event without a rule carries none, so its races (and hashes) are as before.
    const plain = buildSimConfig(REG, STREAMS.forEvent(REG, 'base:keys-t3-long-haul'), {
      seed: 1,
      eventId: 'base:keys-t3-long-haul',
    });
    expect('grudgeRule' in plain.event).toBe(false);
  });

  const runs = SEEDS.map((seed) => ({ seed, ...race(config(seed)) }));

  it('warns, drops for a second and reconnects up the road, cycle after cycle', () => {
    let cycles = 0;
    let jumps = 0;
    for (const r of runs) {
      // Every drop follows its screech, and every reconnect its drop: never a drop unwarned. (A
      // knock-down mid-warning may cut a cycle short, so a screech may stand alone.)
      for (let i = 0; i < r.beats.length; i++) {
        const b = r.beats[i];
        if (b?.phase === 'drop') expect(r.beats[i - 1]?.phase, `seed ${r.seed} beat ${i}`).toBe('screech');
        if (b?.phase === 'reconnect') expect(r.beats[i - 1]?.phase, `seed ${r.seed} beat ${i}`).toBe('drop');
      }
      for (let i = 2; i < r.beats.length; i++) {
        const [screech, drop, back] = [r.beats[i - 2], r.beats[i - 1], r.beats[i]];
        if (back?.phase !== 'reconnect' || !screech || !drop) continue;
        cycles++;
        expect(drop.tick - screech.tick, `seed ${r.seed}`).toBe(45);
        if (back.jumpM > 0) {
          // A full second frozen, unless something came into his line (it reconnects early then);
          // one knocked down mid-drop reconnects late, where he is, with no jump.
          expect(back.tick - drop.tick, `seed ${r.seed}`).toBeLessThanOrEqual(60);
          jumps++;
          expect(back.jumpM).toBe(15);
          // In one tick his road s moved the jump plus at most a tick's riding.
          if (back.edgeSame) expect(Math.abs(back.sAfter - back.sBefore)).toBeGreaterThanOrEqual(15);
        }
      }
      print(
        `seed ${r.seed}: ${r.beats.length} beats, ${r.beats.filter((b) => b.phase === 'reconnect' && b.jumpM > 0).length} ` +
          `reconnects 15 m up the road, ${r.lagActTicks} ticks frozen`,
      );
    }
    print(`[examined] ${runs.length} races, ${cycles} drop cycles, ${jumps} jumps`);
    // Every 6 to 10 s from the tenth second of a two-minute race: a band, not the measured count.
    expect(cycles).toBeGreaterThanOrEqual(runs.length * 4);
    expect(jumps).toBeGreaterThanOrEqual(cycles / 2);
  });

  it('without the rule: no Bad Connection, and his plain lag still shows', () => {
    const cfg = config(1);
    const plain: SimConfig = { ...cfg, event: { ...cfg.event } };
    delete (plain.event as { grudgeRule?: unknown }).grudgeRule;
    const r = race(plain);
    expect(r.beats).toHaveLength(0);
    expect(r.lagActTicks).toBeGreaterThan(0);
  });

  it('a race replays to the same hash', () => {
    expect(race(config(1)).hash).toBe(runs[0]?.hash);
  });
});
