import {
  configFromHeader,
  createReplayController,
  HASH_EVERY_TICKS,
  validateCompletedRecording,
  type Recording,
  type ReplayHeader,
} from '../replay';
import type { Sim, SimConfig, SimSnapshot } from '../sim/api';

export interface ReplayPlaybackOptions {
  recording: unknown;
  expectedReplayKey: string;
  roadsFor: (header: ReplayHeader) => Pick<SimConfig, 'road' | 'route'>;
  createSimulation: (config: SimConfig) => Sim;
}

export interface ReplayPlayback {
  readonly sim: Sim;
  readonly recording: Recording;
  readonly prev: SimSnapshot | null;
  readonly curr: SimSnapshot;
  readonly playerId: number;
  readonly durationTicks: number;
  /** True only after every input, checkpoint and terminal hash has been verified. */
  readonly complete: boolean;
  /** Checkpoint and terminal comparisons actually performed, including a failed comparison. */
  readonly checked: number;
  /** Advances at most one recorded tick; after a failure or completion this is a no-op. */
  step(): void;
}

/** A completed recording's presentation state, independent of clocks and the live race. */
export function createReplayPlayback(options: ReplayPlaybackOptions): ReplayPlayback {
  // Preflight must precede both road reconstruction and sim construction.
  const recording = validateCompletedRecording(options.recording, options.expectedReplayKey);
  const { road, route } = options.roadsFor(recording.header);
  const sim = options.createSimulation(configFromHeader(recording.header, road, route));
  if (sim.tick !== 0) throw new Error('replay: playback requires a fresh sim at tick 0');
  const controller = createReplayController(recording);
  let prev: SimSnapshot | null = null;
  let curr = sim.snapshot();
  const player = curr.entities.find((entity) => entity.kind === 'rider' && entity.slot === 0);
  if (!player) throw new Error('replay: playback has no rider in human slot 0');
  const durationTicks = recording.inputs.length;
  let complete = false;
  let stopped = false;
  let checked = 0;
  let nextTick = 0;

  return {
    sim,
    recording,
    playerId: player.id,
    durationTicks,
    get prev() {
      return prev;
    },
    get curr() {
      return curr;
    },
    get complete() {
      return complete;
    },
    get checked() {
      return checked;
    },
    step() {
      if (stopped || complete) return;
      try {
        if (sim.tick !== nextTick) throw new Error(`replay: expected sim tick ${nextTick}, got ${sim.tick}`);
        const tick = nextTick;
        const result = controller.step(sim);
        // The validated schedule is public; the controller has no running comparison count.
        // Both comparisons occur when a checkpoint and the terminal share a tick.
        if (tick % HASH_EVERY_TICKS === 0) checked++;
        if (tick === durationTicks - 1) checked++;
        if (sim.tick !== tick + 1)
          throw new Error(`replay: sim tick ${tick} did not advance exactly once (got ${sim.tick})`);
        prev = curr;
        curr = sim.snapshot();
        nextTick++;
        if (result !== 'stepped') {
          const mismatch = controller.desync;
          throw new Error(
            mismatch
              ? `replay: hash desync at tick ${mismatch.tick}: expected ${mismatch.expected}, got ${mismatch.actual}`
              : `replay: unexpected input exhaustion at tick ${tick}`,
          );
        }
        if (nextTick === durationTicks) {
          // At exact exhaustion run() observes end and returns cumulative results without
          // stepping the sim. Do not use isOver(): recordings can contain post-finish inputs.
          const final = controller.run(sim);
          if (
            final.ticks !== durationTicks ||
            final.checked !== recording.hashes.length + 1 ||
            final.desync !== null ||
            final.finalHash !== recording.end?.hash ||
            sim.tick !== durationTicks
          ) {
            throw new Error(`replay: completion verification failed at tick ${tick}`);
          }
          checked = final.checked;
          complete = true;
        }
      } catch (error) {
        stopped = true;
        throw error;
      }
    },
  };
}
