// The engine's feel (playtest 2, 2026-10-02: "Engine monotonous and maybe too loud", then
// "Richer and quieter": gear shifts, a rev on throttle, a pop on decel). Pure and per frame: it
// turns the sim's rider state into what the engine voice should play, so it is unit-tested without
// audio, and the voice (engine-patch.ts) only follows numbers. Presentation only: nothing here
// feeds the sim, and its randomness (which frames pop) is a small seeded stream of its own.
//
// - Gears: the sim's rpm falls to idle at every upshift (src/sim/riders gearAndRpm), which made the
//   engine whoop up from idle again and again. Above first gear the heard rpm runs from a shift
//   floor (about 60 % of redline) to redline, so an upshift is a real-sounding drop, not a restart.
// - Shifts: a gear change dips the level for a moment (the clutch) and, on a downshift, blips the
//   revs.
// - Throttle rev: snapping the throttle open flares the revs and the load for a moment.
// - Decel pops: snapping it shut at high revs, or coasting there, pops and crackles the exhaust.
import { ENGINE_FEEL_DEFAULTS } from './tuning';

// Its numbers live in tuning.ts beside the slider that reads them, off the lazy audio engine.
export { ENGINE_FEEL_DEFAULTS };
export type EngineFeelParams = { -readonly [K in keyof typeof ENGINE_FEEL_DEFAULTS]: number };

export interface FeelInput {
  /** Seconds, the audio clock (any monotonic clock). */
  t: number;
  rpm: number;
  /** 1..n; 0 or less = unknown (the heard rpm is the sim's). */
  gear: number;
  throttle: number;
  /** Off the bike (tumbling, running): idle, no feel. */
  down: boolean;
}

export interface FeelOutput {
  /** The rpm the voice should play. */
  rpm: number;
  /** 0..1 engine load for the voice (the throttle, flared by a rev). */
  load: number;
  /** Level multiplier (the clutch dip). */
  level: number;
  /** Pops to fire this frame, each with its size 0..1 and its delay from now (s). */
  pops: { delayS: number; size: number }[];
  /** What happened this frame, for tests and the debug report. */
  shift: 'up' | 'down' | null;
  rev: boolean;
}

/** The heard rpm: first gear (or an unknown gear) as the sim says, higher gears from the floor. */
export function heardRpm(
  rpm: number,
  gear: number,
  p: Pick<EngineFeelParams, 'shiftFloorRpm' | 'idleRpm' | 'redlineRpm'>,
): number {
  if (gear <= 1) return rpm;
  const u = Math.min(1, Math.max(0, (rpm - p.idleRpm) / (p.redlineRpm - p.idleRpm)));
  return p.shiftFloorRpm + u * (p.redlineRpm - p.shiftFloorRpm);
}

export interface EngineFeel {
  step(input: FeelInput): FeelOutput;
  setParams(p: Partial<EngineFeelParams>): void;
  /** Forget the last frame (a new race, a voice rebuilt). */
  reset(): void;
}

export function createEngineFeel(seed = 0x5eed, params: Partial<EngineFeelParams> = {}): EngineFeel {
  const p: EngineFeelParams = { ...ENGINE_FEEL_DEFAULTS, ...params };
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let last: { t: number; gear: number; throttle: number } | null = null;
  let dipUntil = -Infinity;
  let blipAt = -Infinity;
  let revAt = -Infinity;

  return {
    setParams(next) {
      Object.assign(p, next);
    },
    reset() {
      last = null;
      dipUntil = -Infinity;
      blipAt = -Infinity;
      revAt = -Infinity;
    },
    step({ t, rpm, gear, throttle, down }) {
      const th = Math.min(1, Math.max(0, throttle));
      if (down) {
        last = null;
        return { rpm: 0, load: 0, level: 1, pops: [], shift: null, rev: false };
      }
      const dt = last ? Math.max(0, Math.min(0.25, t - last.t)) : 0;
      let shift: FeelOutput['shift'] = null;
      if (last && gear > 0 && last.gear > 0 && gear !== last.gear) {
        shift = gear > last.gear ? 'up' : 'down';
        dipUntil = t + p.shiftDipS;
        if (shift === 'down') blipAt = t;
      }
      let rev = false;
      if (last && dt > 0 && (th - last.throttle) / dt >= p.revRisePerS && th - last.throttle >= 0.3) {
        revAt = t;
        rev = true;
      }
      const base = heardRpm(rpm, gear, p);
      const fade = (since: number, len: number) => (t - since < len ? 1 - (t - since) / len : 0);
      const blip = p.downBlipRpm * fade(blipAt, p.blipS);
      const flare = fade(revAt, p.revS);
      const heard = Math.min(p.redlineRpm * 1.05, base + blip + p.revRpm * flare);
      const load = Math.min(1, th + 0.5 * flare);
      const level = t < dipUntil ? p.shiftDip : 1;

      const pops: FeelOutput['pops'] = [];
      if (last && last.throttle >= p.popFrom && th <= p.popTo && heard >= p.popMinRpm) {
        const n = p.popBurstMin + Math.floor(rand() * (p.popBurstMax - p.popBurstMin + 1));
        for (let i = 0; i < n; i++) pops.push({ delayS: rand() * p.popBurstS, size: 0.5 + 0.5 * rand() });
        pops.sort((a, b) => a.delayS - b.delayS);
      } else if (th <= p.popTo && heard >= p.popMinRpm && rand() < dt * p.coastPopsPerS) {
        // Coasting at high revs: the odd crackle, on average `coastPopsPerS`.
        pops.push({ delayS: rand() * 0.05, size: 0.3 + 0.4 * rand() });
      }

      last = { t, gear, throttle: th };
      return { rpm: heard, load, level, pops, shift, rev };
    },
  };
}
