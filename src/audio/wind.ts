// The wind (playtest 1, item 10, [decided]: speed cues). Filtered noise that rises with the
// player's speed: silent below `audio.windFromMps`, full at `audio.windFullMps`, on a squared curve
// so it swells near top speed. The band it sits in climbs with speed too, from a low rumble to a
// hiss. It runs into the effects input, so the slow motion's low-pass and the effects bus level
// apply to it. Numbers are presentation tuning sliders [default].
import { noiseBuffer } from './engine-patch';

export const WIND_DEFAULTS = {
  /** Peak level at full speed (0 = off). */
  gain: 0.3,
  /** Speed where the wind starts, m/s. */
  fromMps: 10,
  /** Speed where it is full, m/s (the starter bike's top speed is about 45 m/s). */
  fullMps: 45,
  /** The band's centre at the start and at full speed, Hz. */
  lowHz: 320,
  highHz: 1500,
} as const;

export interface WindParams {
  gain: number;
  fromMps: number;
  fullMps: number;
}

/** How far into the wind's range a speed is, 0..1. */
export function windAmount(speedMps: number, p: WindParams): number {
  const span = p.fullMps - p.fromMps;
  if (!(span > 0) || !Number.isFinite(speedMps)) return speedMps >= p.fullMps ? 1 : 0;
  return Math.min(1, Math.max(0, (speedMps - p.fromMps) / span));
}

/** The wind's level at a speed: squared, so it swells toward top speed. */
export function windLevel(speedMps: number, p: WindParams): number {
  const a = windAmount(speedMps, p);
  return Math.max(0, p.gain) * a * a;
}

export interface WindVoice {
  /** Aims the wind at a speed (m/s); `scale` multiplies the level (0 while down or stopped). */
  set(speedMps: number, p: WindParams, scale?: number): void;
  level(): number;
  stop(): void;
}

export function createWindVoice(ctx: BaseAudioContext, out: AudioNode): WindVoice {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 0.7;
  band.frequency.value = WIND_DEFAULTS.lowHz;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(band);
  band.connect(gain);
  gain.connect(out);
  src.start();
  let current = 0;
  return {
    set(speedMps, p, scale = 1) {
      const t = ctx.currentTime;
      const a = windAmount(speedMps, p);
      current = windLevel(speedMps, p) * Math.max(0, scale);
      gain.gain.setTargetAtTime(current, t, 0.08);
      band.frequency.setTargetAtTime(
        WIND_DEFAULTS.lowHz + (WIND_DEFAULTS.highHz - WIND_DEFAULTS.lowHz) * a,
        t,
        0.1,
      );
    },
    level: () => current,
    stop() {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      current = 0;
      try {
        src.stop(ctx.currentTime + 0.3);
      } catch {
        // already stopped
      }
    },
  };
}
