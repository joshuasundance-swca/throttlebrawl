import { expect, it } from 'vitest';
import { registryFromGlob } from '../../src/content';
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { blankActions, botInput, createBot } from '../../src/dev/bot';
import {
  configFromHeader,
  createInputRecorder,
  createReplayController,
  decodeReplay,
  encodeReplay,
  HASH_EVERY_TICKS,
} from '../../src/replay';
import { createSimWithWorld } from '../../src/sim/create';
import { trafficState } from '../../src/sim/traffic';

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));

it('records, reloads and tamper-checks a Bridge City race that actually encounters branch traffic', () => {
  const eventId = 'region-pnw:pnw-t1-bridge-city';
  const c = buildSimConfig(ALL, streamForEvent(ALL, eventId), { seed: 17, eventId });
  const { sim, world } = createSimWithWorld(c);
  const player = world.movers.find((m) => c.riders[m.riderIndex]?.role === 'player')!.id;
  const bot = createBot();
  const recorder = createInputRecorder();
  recorder.beginRace(sim, 'test-network-code+content');
  let observedAt = -1;
  let tamperTick = -1;
  while (sim.tick < 10000 && (observedAt < 0 || sim.tick < observedAt + 240)) {
    const tick = sim.tick;
    const snap = sim.snapshot();
    const me = snap.entities[player]!;
    if (tamperTick < 0 && tick > 60 && me.mode === 'Road' && me.speed > 5) tamperTick = tick;
    const actions = blankActions();
    bot.drive(snap, player, c.route, actions);
    const inputs = [botInput(actions)];
    recorder.record(tick, inputs);
    sim.step(inputs);
    if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
    const st = trafficState(world);
    if (observedAt < 0 && st.id.some((id) => c.route.trafficRoads.includes(world.movers[id]!.pos.edge)))
      observedAt = sim.tick;
  }
  expect(observedAt).toBeGreaterThan(0);
  expect(tamperTick).toBeGreaterThan(0);
  recorder.finish(sim.tick - 1, sim.hash());
  const recording = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(recorder.current()!))));
  const fresh = () => createSimWithWorld(configFromHeader(recording.header, c.road, c.route)).sim;
  const replay = createReplayController(recording).run(fresh());
  expect(replay.desync).toBeNull();
  expect(replay.finalHash).toBe(sim.hash());
  expect(replay.ticks).toBe(sim.tick);
  const tampered = structuredClone(recording);
  const command = tampered.inputs[tamperTick]![0]!;
  command.steer = command.steer === 127 ? -127 : 127;
  expect(createReplayController(tampered).run(fresh()).desync).not.toBeNull();
  console.log(
    `[examined] branch traffic at tick ${observedAt}; ${sim.tick} recorded/reloaded ticks; ${replay.checked} hashes; tamper at ${tamperTick}`,
  );
}, 90000);
