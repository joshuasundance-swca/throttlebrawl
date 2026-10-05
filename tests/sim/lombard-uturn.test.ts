/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 4, P4-9: "Lombard's hairpins feel impossible to control smoothly". The feel audit found
// the cause: the old U-turn rule (12 m/s or less, brake 0.5 or more, steer 0.85 or more) turned a
// phone rider round on the crooked block's first bend, every time he braked into it with the stick
// near full lock. The maintainer's answer (round 5, [decided]): a U-turn has its OWN gesture, and
// braking into a hairpin never flips you. So this rides Lombard's crooked block as a phone rider
// does (the brake is a button, 1 or 0; the stick sits at a fixed lock toward each bend) and asserts
// the rule it protects: the bike's direction never flips, and it comes out the end of the block.
// The own gesture itself turns a bike round on a straight (src/sim/riders/uturn.test.ts), and here
// on the block's own lane.
import { describe, expect, it } from 'vitest';
import type { RoadPos } from '../../src/road';
import { quantizeInput, type SimInput } from '../../src/sim/api';
import { riderHarness, type RiderHarness } from '../../src/sim/riders/testing';
import { sharpestAhead, soloConfig } from './drift-bot';

/** Lombard Street: Polk, the crest at Hyde, the crooked block's eight hairpins, then the flats. */
const LOMBARD = {
  label: 'Lombard Street (osm-sf-lombard-run)',
  event: 'region-sf:sf-hill-sprint',
  route: 'region-sf:osm-sf-lombard-run',
} as const;
/** The road of Lombard's eight hairpins. */
const CROOKED = 'osm-sf-lombard-crooked';
/** A bend this sharp (R 12.5 m) is a hairpin's core: the rider turns in and brakes there. */
const HAIRPIN_KAPPA = 0.08;
const BIKE = 'base:rustbucket-400';

const phone = (steer: number, throttle: number, brake: 0 | 1): SimInput =>
  quantizeInput({ steer, throttle, brake, flags: 0 });

/**
 * A phone rider's tick. In a hairpin's core the stick is held at `lock` toward the bend and the
 * brake button is down while the bike is over `hairpinMps`; between bends the stick keeps the lane's
 * middle and the thumb holds `hairpinMps` on the throttle.
 */
function phoneRider(
  h: RiderHarness,
  edge: number,
  lock: number,
  hairpinMps: number,
  stutter: boolean,
): SimInput {
  const { pos, speed, yaw } = h.rider;
  const at: RoadPos = { edge: pos.edge, s: pos.s, d: pos.d, dir: pos.dir };
  const here = sharpestAhead(h.config, at, 6);
  if (Math.abs(here) >= HAIRPIN_KAPPA && pos.edge === edge) {
    const over = speed > hairpinMps;
    // A stuttering thumb taps the button on and off through the bend instead of holding it.
    const down = stutter ? over && Math.floor(h.world.tick / 6) % 2 === 0 : over;
    return phone(Math.sign(here) * lock, over ? 0 : 0.5, down ? 1 : 0);
  }
  const law = Math.max(-1, Math.min(1, -0.35 * pos.d * pos.dir - 2.5 * yaw));
  return phone(law, speed < hairpinMps ? 1 : 0, 0);
}

interface BlockRun {
  /** Whether the bike's direction on the road flipped at any tick. */
  flipped: boolean;
  /** Whether the bike was past the block's end (or off its edge) by the time it stopped. */
  cleared: boolean;
  crashes: number;
  seconds: number;
  /** The most the bike's heading offset from the road got to, radians. */
  maxYaw: number;
}

function rideBlock(lock: number, hairpinMps: number, stutter: boolean): BlockRun {
  const config = soloConfig(LOMBARD, BIKE, 1);
  const edge = config.road.edgeIndex(CROOKED);
  const length = config.road.edges[edge]?.length ?? 0;
  const h = riderHarness(config, { edge, s: 1, d: 0, speed: hairpinMps });
  const run: BlockRun = { flipped: false, cleared: false, crashes: 0, seconds: 0, maxYaw: 0 };
  for (let t = 0; t < 90 * 60; t++) {
    for (const e of h.step(phoneRider(h, edge, lock, hairpinMps, stutter)))
      if (e.type === 'crash') run.crashes++;
    run.seconds = (t + 1) / 60;
    run.maxYaw = Math.max(run.maxYaw, Math.abs(h.rider.yaw));
    if (h.rider.pos.dir !== 1) run.flipped = true;
    if (h.rider.pos.edge !== edge || h.rider.pos.s >= length - 1) {
      run.cleared = true;
      break;
    }
  }
  return run;
}

describe('Lombard Street: braking into the hairpins never turns a phone rider round (playtest 4, P4-9)', () => {
  it('the premise holds: the crooked block is a run of tight hairpins', () => {
    const config = soloConfig(LOMBARD, BIKE, 1);
    const edge = config.road.edgeIndex(CROOKED);
    expect(edge).toBeGreaterThanOrEqual(0);
    let sharp = 0;
    for (let s = 0; s < (config.road.edges[edge]?.length ?? 0); s++)
      if (Math.abs(config.road.kappaAt(edge, s)) >= HAIRPIN_KAPPA) sharp++;
    expect(sharp).toBeGreaterThan(50);
  });

  it('a held brake button with the stick at lock (0.86 to full) rides the whole block with no flip', () => {
    const lines: string[] = [];
    for (const lock of [0.86, 0.9, 1]) {
      for (const hairpinMps of [6, 8, 10]) {
        const run = rideBlock(lock, hairpinMps, false);
        lines.push(
          `lock ${lock}, hairpins at ${hairpinMps} m/s: ${run.cleared ? 'through' : 'stuck'} in ` +
            `${run.seconds.toFixed(1)} s, ${run.crashes} crashes, flipped ${run.flipped}, ` +
            `most heading ${run.maxYaw.toFixed(2)} rad`,
        );
        expect(run.flipped, lines.at(-1)).toBe(false);
        expect(run.maxYaw, lines.at(-1)).toBeLessThanOrEqual(1.2);
        expect(run.cleared, lines.at(-1)).toBe(true);
      }
    }
    console.log(
      `[examined] ${LOMBARD.label}, ${BIKE}, crooked block, held brake button:\n${lines.join('\n')}`,
    );
  });

  it('a stuttering brake thumb with the stick at lock rides it with no flip either', () => {
    for (const lock of [0.9, 1]) {
      const run = rideBlock(lock, 8, true);
      expect(run.flipped, `lock ${lock}`).toBe(false);
      expect(run.maxYaw, `lock ${lock}`).toBeLessThanOrEqual(1.2);
      expect(run.cleared, `lock ${lock}`).toBe(true);
    }
  });

  it('the own gesture still turns a bike round on the block: a tap, then the second press held at lock', () => {
    const config = soloConfig(LOMBARD, BIKE, 1);
    const edge = config.road.edgeIndex(CROOKED);
    // The start of the block is a straight run into the first bend; stop there and turn round.
    const h = riderHarness(config, { edge, s: 1, d: 0, speed: 3 });
    const drive = (ticks: number, steer: number, brake: 0 | 1) => {
      for (let t = 0; t < ticks; t++) h.step(phone(steer, 0, brake));
    };
    drive(6, 0, 1);
    drive(6, 0, 0);
    expect(h.rider.pos.dir).toBe(1);
    for (let t = 0; t < 3 * 60 && h.rider.pos.dir === 1; t++) h.step(phone(-1, 0, 1));
    expect(h.rider.pos.dir).toBe(-1);
  });
});
