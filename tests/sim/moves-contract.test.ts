import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { createStubBot } from '../../src/dev/bot';
import { createInputRecorder, decodeReplay, encodeReplay, makeReplayKey } from '../../src/replay';
import { createSim, InputFlag, quantizeInput, type SimConfig, type SimInput } from '../../src/sim/api';

// Playtest 3's moves contract (K0a; scratch spec moves.md §2, "Tests in P0"): the wheelie, the drift
// and the gaps plug into sim/riders and sim/traffic through hooks that are neutral while each move
// is off, and a move is off while its switch is absent or 0. These hold for the lanes that fill the
// hooks (T2.1, T2.3, T3.1) as much as for the stubs: a lane that breaks one has changed a race
// nobody opted into. Real headless races, traffic and all, so the traffic hook runs too.

/** The moves' on/off switches (each lane declares its own key; absent or 0 means off). */
const MOVE_SWITCHES = ['riders.wheelie', 'riders.drift'] as const;
const SEEDS = [7, 42];
const TICKS = 1200;

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

/** The race's config with the switches at 0, or with them left out entirely. */
function configFor(seed: number, switches: 'zero' | 'absent'): SimConfig {
  const { config } = createHeadlessRace({ seed });
  const tuning: Record<string, number> = { ...config.tuning };
  for (const id of MOVE_SWITCHES) {
    if (switches === 'zero') tuning[id] = 0;
    else delete tuning[id];
  }
  return { ...config, tuning };
}

/**
 * The bot's commands for a race, with a hard brake at full lock for a second every five (the
 * drift's way in, on any bend), recorded once so every variant rides the very same sticks.
 */
function botCommands(seed: number): SimInput[] {
  const race = createHeadlessRace({ seed });
  const sim = createSim(configFor(seed, 'zero'));
  const bot = createStubBot();
  const out: SimInput[] = [];
  for (let t = 0; t < TICKS && !sim.isOver(); t++) {
    const me = sim.snapshot().entities[race.playerId];
    if (!me) throw new Error('no player');
    const a = blank();
    bot.drive(me, race.route, a);
    const pulse = t % 300 >= 200 && t % 300 < 260;
    const cmd = quantizeInput({
      ...a,
      brake: pulse ? 1 : a.brake,
      steer: pulse ? (t % 600 < 300 ? 1 : -1) : a.steer,
      flags: 0,
    });
    out.push(cmd);
    sim.step([cmd]);
  }
  return out;
}

/** Every tick's snapshot and events, as JSON, for a config ridden with these commands. */
function ride(config: SimConfig, cmds: readonly SimInput[], extraFlags = 0): string[] {
  const sim = createSim(config);
  const out: string[] = [];
  for (const cmd of cmds) {
    if (sim.isOver()) break;
    sim.step([{ ...cmd, flags: cmd.flags | extraFlags }]);
    out.push(JSON.stringify(sim.snapshot()) + JSON.stringify(sim.events()));
  }
  return out;
}

function firstDiff(a: readonly string[], b: readonly string[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}

describe('the moves contract: off means the race rides as before', () => {
  const races = SEEDS.map((seed) => ({ seed, cmds: botCommands(seed) }));

  it('with the switches at 0, holding the wheelie bit through brakes at full lock changes nothing', () => {
    let ticks = 0;
    for (const { seed, cmds } of races) {
      const plain = ride(configFor(seed, 'zero'), cmds);
      const held = ride(configFor(seed, 'zero'), cmds, InputFlag.wheelie);
      expect(firstDiff(plain, held), `seed ${seed}: first tick that differs`).toBe(-1);
      ticks += plain.length;
    }
    console.log(`[examined] ${races.length} races, ${ticks} ticks of snapshots and events compared`);
    expect(ticks).toBeGreaterThan(SEEDS.length * 600);
  });

  it('a switch left out rides exactly as a switch at 0', () => {
    for (const { seed, cmds } of races) {
      const zero = ride(configFor(seed, 'zero'), cmds, InputFlag.wheelie);
      const absent = ride(configFor(seed, 'absent'), cmds, InputFlag.wheelie);
      expect(firstDiff(zero, absent), `seed ${seed}: first tick that differs`).toBe(-1);
    }
  });

  it('the snapshot carries the moves: no wheelie, no drift, and a moves block for the player', () => {
    const { seed, cmds } = races[0] ?? { seed: 7, cmds: [] };
    const sim = createSim(configFor(seed, 'zero'));
    for (const cmd of cmds.slice(0, 120)) sim.step([{ ...cmd, flags: InputFlag.wheelie }]);
    const snap = sim.snapshot();
    for (const e of snap.entities) {
      expect(e.wheelie).toBe(0);
      expect(e.drift).toBe(0);
    }
    expect(snap.moves).toEqual({
      wheelieS: 0,
      wheelieBand: null,
      driftS: 0,
      driftChain: 0,
      driftCash: 0,
      driftSide: 0,
    });
  });

  it('the wheelie bit survives a recording and its file (16-bit flags)', () => {
    const { seed, cmds } = races[0] ?? { seed: 7, cmds: [] };
    const sim = createSim(configFor(seed, 'zero'));
    const recorder = createInputRecorder();
    recorder.beginRace(sim, makeReplayKey('test-build', 'test-content'));
    const sent: SimInput[] = [];
    for (let t = 0; t < 90; t++) {
      const base = cmds[t];
      if (!base) break;
      const cmd = { ...base, flags: t >= 30 && t < 60 ? InputFlag.wheelie | InputFlag.kick : 0 };
      sent.push(cmd);
      recorder.record(t, [cmd]);
      sim.step([cmd]);
    }
    recorder.finish(sim.tick - 1, sim.hash());
    const rec = recorder.current();
    if (!rec) throw new Error('no recording');
    const back = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(rec))));
    expect(back.inputs.map((slots) => slots[0]?.flags)).toEqual(sent.map((c) => c.flags));
    expect(back.inputs[40]?.[0]?.flags).toBe(InputFlag.wheelie | InputFlag.kick);
  });
});
