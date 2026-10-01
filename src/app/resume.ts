// Resume after a reload (docs/architecture.md, "Resume after a reload"; docs/milestones/M2.md,
// app-3 item 4). The race's recording (header plus the human and bot inputs) is the saved state:
// app/ builds a fresh headless sim from the SimConfig in the recording's header, never from the
// current settings, and re-runs it with the recorded inputs and tuning changes to the saved tick,
// checking the recorded state hashes on the way. AI inputs are a deterministic function of sim
// state, so they are not stored. No per-field serializer: `sim.serialize()` and `restoreSim()`
// stay reserved until the phone's printed fast-forward time for a long race passes 3 s.
//
// replay/ reads and writes the recording and offers it on boot (replay-2); app-4 wires the
// resume card and the Start-tap sequence around this function.
import { lookup, packOf, type ContentRegistry } from '../content';
import {
  configFromHeader,
  createReplayController,
  type Desync,
  type Recording,
  type ReplayHeader,
} from '../replay';
import { createSim, type Sim, type SimConfig } from '../sim/api';
import type { RegionStream } from '../stream';
import { DEFAULT_EVENT, eventKey, eventLength, qualifyIn } from './config';
import type { StreamCache } from './regions';

/** The road and route handles a recording's race ran on (rebuilt, never stored). */
export type RoadsFor = (header: ReplayHeader) => Pick<SimConfig, 'road' | 'route'>;

export interface ResumeResult {
  /** The resumed sim, standing at the saved tick; the race carries on from here. */
  sim: Sim;
  /** Ticks fast-forwarded. */
  ticks: number;
  /** Recorded state hashes compared on the way. */
  checked: number;
  /** The first recorded hash that differed, or null. A desync means the resume is not exact. */
  desync: Desync | null;
}

/** Builds a fresh sim from the recording's header and re-runs it to the saved tick. */
export function resumeFromRecording(rec: Recording, roadsFor: RoadsFor): ResumeResult {
  const { road, route } = roadsFor(rec.header);
  const sim = createSim(configFromHeader(rec.header, road, route));
  const result = createReplayController(rec).run(sim);
  return { sim, ticks: result.ticks, checked: result.checked, desync: result.desync };
}

/**
 * The road handles for a header from this build's content: the route the header names
 * (`event.routeId`), else the route of its event length, on that route's region stream. `streams`
 * is one region's stream (the Keys, as before) or a cache that builds any region's (app/regions.ts).
 */
export function roadsForHeader(reg: ContentRegistry, streams: RegionStream | StreamCache): RoadsFor {
  return (header) => {
    const event = header.config?.event;
    const key = eventKey(header.eventId || DEFAULT_EVENT);
    const routeId =
      event?.routeId ?? qualifyIn(packOf(key), eventLength(lookup(reg.events, key), event?.lengthId).route);
    const stream = 'forRoute' in streams ? streams.forRoute(reg, routeId) : streams;
    return { road: stream.road, route: stream.routeFor(lookup(reg.routes, routeId)) };
  };
}
