import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { createStubBot } from '../../src/dev/bot';
import { createInputRecorder, decodeReplay, encodeReplay, makeReplayKey } from '../../src/replay';
import { createSim, InputFlag, quantizeInput, type SimEvent, type SimInput } from '../../src/sim/api';

// The wheelie in a real race (playtest 3; scratch spec moves.md §3.2, test 7): a 1,200-tick course of
// wheelies, traffic and rivals and all, recorded and replayed from its file, ends on the same state
// hash and the same events. Counted in ticks; the wheelies are the bot's line with the wheelie button
// (playtest 4) held for 1.5 s every 5 s, then let go, with the thumb off the gas for a second after.

const SEED = 7;
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

function course(): SimInput[] {
  const race = createHeadlessRace({ seed: SEED });
  const sim = createSim(race.config);
  const bot = createStubBot();
  const out: SimInput[] = [];
  for (let t = 0; t < TICKS && !sim.isOver(); t++) {
    const me = sim.snapshot().entities[race.playerId];
    if (!me) throw new Error('no player');
    const a = blank();
    bot.drive(me, race.route, a);
    const phase = t % 300;
    const up = phase >= 150 && phase < 240;
    // After the hold the button and the gas come off for a second, and the front comes down.
    const down = phase >= 240;
    const cmd = quantizeInput({
      ...a,
      throttle: down ? 0 : a.throttle,
      flags: up ? InputFlag.wheelie : 0,
    });
    out.push(cmd);
    sim.step([cmd]);
  }
  return out;
}

describe('a wheelie course records and replays exactly', () => {
  it('replays from its file to the same hash and the same events', () => {
    const { config } = createHeadlessRace({ seed: SEED });
    const cmds = course();
    const sim = createSim(config);
    const recorder = createInputRecorder();
    recorder.beginRace(sim, makeReplayKey('test-build', 'test-content'));
    const events: SimEvent[] = [];
    cmds.forEach((cmd, t) => {
      recorder.record(t, [cmd]);
      sim.step([cmd]);
      events.push(...sim.events());
    });
    recorder.finish(sim.tick - 1, sim.hash());
    const rec = recorder.current();
    if (!rec) throw new Error('no recording');
    const back = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(rec))));

    const again = createSim(config);
    const replayed: SimEvent[] = [];
    for (const slots of back.inputs) {
      again.step(slots.map((s) => ({ ...s })));
      replayed.push(...again.events());
    }
    const ends = events.filter((e) => e.type === 'wheelieEnd');
    console.log(
      `[examined] ${cmds.length} ticks, ${ends.length} wheelies (${ends.filter((e) => e.data['clean'] === true).length} clean), hash ${sim.hash()}`,
    );
    console.log(`[examined] ${JSON.stringify(ends.map((e) => [e.tick, e.data]))}`);
    expect(ends.length).toBeGreaterThanOrEqual(2);
    expect(ends.some((e) => e.data['clean'] === true)).toBe(true);
    expect(again.hash()).toBe(sim.hash());
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(events));
  });

  it('switched on but never popped, a race rides exactly as with the wheelie off', () => {
    const { config } = createHeadlessRace({ seed: SEED });
    expect(config.tuning['riders.wheelie']).toBe(1);
    const cmds = course().map((c) => ({ ...c, flags: c.flags & ~InputFlag.wheelie }));
    const ride = (wheelie: number): string[] => {
      const sim = createSim({ ...config, tuning: { ...config.tuning, 'riders.wheelie': wheelie } });
      return cmds.map((cmd) => {
        sim.step([cmd]);
        return JSON.stringify(sim.snapshot()) + JSON.stringify(sim.events());
      });
    };
    const on = ride(1);
    const off = ride(0);
    console.log(`[examined] ${on.length} ticks of snapshots and events, wheelie on vs off, no flag`);
    expect(on.length).toBe(cmds.length);
    expect(on.findIndex((s, i) => s !== off[i])).toBe(-1);
  });
});
