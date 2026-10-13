import { configFromHeader, createReplayController, type Recording } from '../replay';
import { createSim, type Sim, type SimEvent, type SimSnapshot } from '../sim/api';
import type { RoadsFor } from './resume';
import { decodeSavedRecording, type SavedRaceEnvelope } from './saved-race';

export * from './saved-race';
export { commitFrozenProfile } from './frozen-result';
export { recoveryCareer, quickRecoveryKey } from './recovery-context';

export interface ReconstructedRace {
  sim: Sim;
  recording: Recording;
  ticks: number;
  checked: number;
}

/** Historical callback receives the original pre-step tick, with no presentation calls. */
export function reconstructSavedRace(
  attempt: SavedRaceEnvelope,
  roadsFor: RoadsFor,
  note: (events: readonly SimEvent[], snapshot: SimSnapshot, tick: number) => void,
): ReconstructedRace {
  const recording = decodeSavedRecording(attempt);
  const { road, route } = roadsFor(recording.header);
  const sim = createSim(configFromHeader(recording.header, road, route));
  const controller = createReplayController(recording);
  while (sim.tick < recording.inputs.length) {
    const tick = sim.tick;
    if (controller.step(sim) !== 'stepped') throw new Error(`Saved race hash desync at tick ${tick}`);
    note(sim.events(), sim.snapshot(), tick);
  }
  // At the input boundary run() only observes end; it does not step the sim again.
  const replayed = controller.run(sim);
  if (replayed.desync || replayed.finalHash !== attempt.savedHash)
    throw new Error('Saved race final hash does not match');
  return { sim, recording, ticks: replayed.ticks, checked: replayed.checked };
}
