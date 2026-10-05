// A rider's own station (run W-U, the pitch deck's #5): "When Pivot rides, Pivot FM appears and
// changes genre every eight bars; knock him down and it goes to dead air, then 'We're excited to
// announce our next chapter.'" A station file with a `rider` is never on the dial. While that rider
// rides near you, his broadcast takes your radio over (behind the pirate's burst of static, never a
// radio that is off); ride away from him and your station comes back. Knock him down (or let him
// crash) while it plays and it goes to dead air; after a beat his line plays, and once he is back on
// his bike near you the station returns with its next track (while he lies near you the air stays
// dead; ride on and your own station comes back). This file is the pure state machine;
// system.ts feeds it the rider's distance each frame and acts on what it says.

/** [default] Hysteresis and timings, metres and seconds. */
export const RIDER_STATION = {
  /** He takes the radio over within this distance... */
  inM: 70,
  /** ...and gives it back past this one, once it has played at least `holdS`. */
  outM: 130,
  holdS: 8,
  /** Dead air after he goes down, before his line. */
  deadAirS: 2.5,
  /** The line's time on air before the station can come back. */
  lineS: 4,
} as const;

export type RiderStationPhase = 'off' | 'on' | 'dead';

/** The rider as the player hears him this frame, or null when he is not in the race (or out of it). */
export interface RiderSight {
  distanceM: number;
  /** In the tumble or on foot. */
  down: boolean;
}

export interface RiderStationMachine {
  readonly phase: () => RiderStationPhase;
  /**
   * One frame. Returns what changed: `tune` when the radio switches to or from the station (the
   * static burst), `announce` once per knockdown when the dead air ends (his line), and `nextTrack`
   * when the station comes back after a knockdown.
   */
  step(now: number, sight: RiderSight | null): { tune: boolean; announce: boolean; nextTrack: boolean };
  reset(): void;
}

export function createRiderStation(): RiderStationMachine {
  let phase: RiderStationPhase = 'off';
  let since = 0;
  let announced = false;
  const near = (s: RiderSight | null, m: number): boolean => !!s && !s.down && s.distanceM <= m;
  return {
    phase: () => phase,
    reset() {
      phase = 'off';
      announced = false;
    },
    step(now, sight) {
      const out = { tune: false, announce: false, nextTrack: false };
      if (phase === 'off') {
        if (near(sight, RIDER_STATION.inM)) {
          phase = 'on';
          since = now;
          out.tune = true;
        }
      } else if (phase === 'on') {
        if (sight?.down) {
          phase = 'dead';
          since = now;
          announced = false;
        } else if (!sight || (sight.distanceM > RIDER_STATION.outM && now - since >= RIDER_STATION.holdS)) {
          phase = 'off';
          out.tune = true;
        }
      } else {
        const t = now - since;
        if (!announced && t >= RIDER_STATION.deadAirS) {
          announced = true;
          out.announce = true;
        } else if (announced && t >= RIDER_STATION.deadAirS + RIDER_STATION.lineS) {
          if (near(sight, RIDER_STATION.outM)) {
            // The next chapter: back on air with a new track.
            phase = 'on';
            since = now;
            out.nextTrack = true;
          } else if (!sight || !sight.down || sight.distanceM > RIDER_STATION.outM) {
            // He is gone, rode off or was left behind: your station comes back. While he lies
            // near you, the air stays dead.
            phase = 'off';
            out.tune = true;
          }
        }
      }
      return out;
    },
  };
}
