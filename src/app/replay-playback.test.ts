import { describe, expect, it, vi } from 'vitest';
import { ISOLATED } from '../../tests/sim/batch';
import { createInputRecorder, HASH_EVERY_TICKS } from '../replay';
import { createSim, quantizeInput, type SimConfig, type SimSnapshot } from '../sim/api';
import { createHeadlessRace } from './headless';
import { createReplayPlayback } from './replay-playback';

const KEY = 'playback-code+playback-content';

/** A short real-sim recording, with optional world systems isolated and no race-length wait. */
function fixture(ticks = HASH_EVERY_TICKS + 2, slots = 1) {
  const { config } = createHeadlessRace({
    seed: 1,
    tuning: ISOLATED,
    freePlay: true,
    rivals: 0,
    cops: false,
  });
  const player = config.riders.find((rider) => rider.controller.kind === 'player');
  if (!player) throw new Error('fixture has no player');
  config.playerSlots = slots;
  // Slot zero deliberately comes last: its entity id must not be guessed from field order.
  config.riders = Array.from({ length: slots }, (_, index) => ({
    ...player,
    controller: { kind: 'player' as const, slot: slots - index - 1 },
  }));
  const sim = createSim(config);
  const recorder = createInputRecorder();
  recorder.beginRace(sim, KEY);
  const snapshots: SimSnapshot[] = [sim.snapshot()];
  for (let tick = 0; tick < ticks; tick++) {
    if (tick === 2) {
      sim.applyParam('riders.steerScale', 1.3);
      recorder.recordParam(tick, 'riders.steerScale', 1.3);
    }
    const inputs = Array.from({ length: slots }, (_, slot) =>
      quantizeInput({ steer: tick % 2 ? 0.1 : -0.1, throttle: 1 - slot / 2, brake: 0, flags: 0 }),
    );
    recorder.record(tick, inputs);
    sim.step(inputs);
    snapshots.push(sim.snapshot());
    if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
  }
  recorder.finish(sim.tick - 1, sim.hash());
  const recording = recorder.current();
  if (!recording) throw new Error('fixture has no recording');
  const roadsFor = vi.fn(() => ({ road: config.road, route: config.route }));
  const createSimulation = vi.fn((options: SimConfig) => createSim(options));
  return { recording, snapshots, roadsFor, createSimulation, finalHash: sim.hash() };
}

function start(f: ReturnType<typeof fixture>, recording: unknown = f.recording) {
  return createReplayPlayback({
    recording,
    expectedReplayKey: KEY,
    roadsFor: f.roadsFor,
    createSimulation: f.createSimulation,
  });
}

function exhaust(playback: Awaited<ReturnType<typeof createReplayPlayback>>) {
  for (let tick = 0; tick < playback.durationTicks; tick++) playback.step();
  expect(playback.complete).toBe(true);
}

describe('completed recording playback', () => {
  it('does not construct roads or a sim when preparation is retired while its validator loads', async () => {
    const f = fixture(1);
    const controller = new AbortController();
    const pending = createReplayPlayback({
      recording: f.recording,
      expectedReplayKey: KEY,
      roadsFor: f.roadsFor,
      createSimulation: f.createSimulation,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/retired/);
    expect(f.roadsFor).not.toHaveBeenCalled();
    expect(f.createSimulation).not.toHaveBeenCalled();
  });
  it('rejects wrong-key, malformed and unfinished recordings before road or sim construction', async () => {
    const f = fixture(1);
    const unfinished = structuredClone(f.recording);
    delete unfinished.end;
    for (const recording of [
      null,
      { ...f.recording, header: { ...f.recording.header, replayKey: 'old-key' } },
      { ...f.recording, inputs: [[{ steer: 0.5, throttle: 255, brake: 0, flags: 0 }]] },
      unfinished,
    ]) {
      await expect(start(f, recording)).rejects.toThrow(/replay/i);
      expect(f.roadsFor).not.toHaveBeenCalled();
      expect(f.createSimulation).not.toHaveBeenCalled();
    }
  });

  it.each([1, HASH_EVERY_TICKS + 1, HASH_EVERY_TICKS + 2])(
    'replays %i real sim ticks, snapshots, tuning changes and every compared hash exactly once',
    async (ticks) => {
      const f = fixture(ticks);
      const original = structuredClone(f.recording);
      const playback = await start(f);
      const step = vi.spyOn(playback.sim, 'step');
      expect(playback.prev).toBeNull();
      expect(playback.curr).toEqual(f.snapshots[0]);
      expect(playback.durationTicks).toBe(ticks);
      expect(playback.checked).toBe(0);
      expect(playback.complete).toBe(false);
      for (let tick = 0; tick < ticks; tick++) {
        const previous = playback.curr;
        playback.step();
        expect(playback.prev).toBe(previous);
        expect(playback.curr).toEqual(f.snapshots[tick + 1]);
        expect(playback.sim.tick).toBe(tick + 1);
        expect(playback.checked).toBe(Math.floor(tick / HASH_EVERY_TICKS) + 1 + Number(tick === ticks - 1));
        expect(playback.complete).toBe(tick === ticks - 1);
      }
      expect(playback.sim.hash()).toBe(f.finalHash);
      expect(playback.checked).toBe(f.recording.hashes.length + 1);
      const final = playback.curr;
      playback.step();
      playback.step();
      expect(playback.curr).toBe(final);
      expect(step).toHaveBeenCalledTimes(ticks);
      expect(f.recording).toEqual(original);
      expect(playback.recording).toEqual(original);
      expect(playback.recording).not.toBe(f.recording);
    },
  );

  it('isolates config and inputs from later caller mutation and sim config mutation', async () => {
    const f = fixture(3);
    const original = structuredClone(f.recording);
    const playback = await start(f);
    f.recording.inputs[0]![0]!.throttle = 0;
    f.recording.header.config!.riders[0]!.name = 'Changed';
    playback.sim.config.riders[0]!.name = 'Sim changed';
    expect(playback.recording).toEqual(original);
    exhaust(playback);
    expect(playback.sim.hash()).toBe(f.finalHash);
  });

  it('exhausts all recorded inputs even when isOver already reports true', async () => {
    const f = fixture(3);
    f.createSimulation.mockImplementation((config) => {
      const sim = createSim(config);
      vi.spyOn(sim, 'isOver').mockReturnValue(true);
      return sim;
    });
    const playback = await start(f);
    expect(playback.sim.isOver()).toBe(true);
    exhaust(playback);
    expect(playback.sim.tick).toBe(f.recording.inputs.length);
    expect(playback.sim.hash()).toBe(f.finalHash);
  });

  it.each(['input', 'checkpoint', 'terminal'] as const)(
    'fails deterministically on tampered %s and keeps later steps stopped',
    async (kind) => {
      const f = fixture();
      const recording = structuredClone(f.recording);
      if (kind === 'input') recording.inputs[1]![0]!.throttle = 0;
      if (kind === 'checkpoint') recording.hashes[1]!.hash = (recording.hashes[1]!.hash ^ 1) >>> 0;
      if (kind === 'terminal') recording.end!.hash = (recording.end!.hash ^ 1) >>> 0;
      const playback = await start(f, recording);
      const step = vi.spyOn(playback.sim, 'step');
      const failAt = kind === 'terminal' ? recording.inputs.length - 1 : HASH_EVERY_TICKS;
      for (let tick = 0; tick < failAt; tick++) playback.step();
      expect(() => playback.step()).toThrow(new RegExp(`replay.*(desync|hash).*${failAt}`, 'i'));
      expect(playback.complete).toBe(false);
      expect(playback.checked).toBe(kind === 'terminal' ? 3 : 2);
      const stoppedAt = playback.sim.tick;
      const calls = step.mock.calls.length;
      playback.step();
      playback.step();
      expect(playback.sim.tick).toBe(stoppedAt);
      expect(step).toHaveBeenCalledTimes(calls);
      expect(playback.complete).toBe(false);
    },
  );

  it('checks the cumulative final hash after the final controller step', async () => {
    const f = fixture(2);
    f.createSimulation.mockImplementation((config) => {
      const sim = createSim(config);
      const hash = sim.hash.bind(sim);
      let finalReads = 0;
      vi.spyOn(sim, 'hash').mockImplementation(() =>
        sim.tick === 2 && ++finalReads > 1 ? (hash() ^ 1) >>> 0 : hash(),
      );
      return sim;
    });
    const playback = await start(f);
    const step = vi.spyOn(playback.sim, 'step');
    playback.step();
    expect(() => playback.step()).toThrow(/replay.*(completion|final|hash)/i);
    expect(playback.complete).toBe(false);
    playback.step();
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('restarts with a fresh factory and identifies human slot zero in a multiple-slot field', async () => {
    const f = fixture(3, 2);
    const first = await start(f);
    expect(first.playerId).toBe(first.curr.entities.find((entity) => entity.slot === 0)?.id);
    expect(first.playerId).not.toBe(first.curr.entities.find((entity) => entity.slot === 1)?.id);
    exhaust(first);
    const restarted = await start(f);
    expect(restarted.sim).not.toBe(first.sim);
    expect(restarted.sim.tick).toBe(0);
    expect(restarted.prev).toBeNull();
    expect(restarted.checked).toBe(0);
    exhaust(restarted);
    expect(restarted.curr).toEqual(first.curr);
    expect(restarted.sim.hash()).toBe(first.sim.hash());
  });

  it('stops if the injected simulation does not advance exactly one tick', async () => {
    const f = fixture(3);
    f.createSimulation.mockImplementation((config) => {
      const sim = createSim(config);
      const step = sim.step.bind(sim);
      vi.spyOn(sim, 'step').mockImplementation((inputs) => {
        step(inputs);
        step(inputs);
      });
      return sim;
    });
    const playback = await start(f);
    expect(() => playback.step()).toThrow(/replay.*tick/i);
    expect(playback.complete).toBe(false);
    const tick = playback.sim.tick;
    playback.step();
    expect(playback.sim.tick).toBe(tick);
  });
});
