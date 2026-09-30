// The slow-motion treatment (M2.md audio-2): while a takedown's slow motion runs, the effects bus
// is pitched down and low-passed and the music ducks, so the world sounds as slow as it looks.
// Two nodes sit on the bus inputs: every effects source feeds `fxIn` (a low-pass that stays wide
// open outside slow motion) and the music loop feeds `musicIn` (a duck gain). The bus gains
// themselves are untouched, so they keep following the volume sliders. Pitch is applied by the
// sources: engines through their detune, cues when they start (index.ts reads `pitch()`).

/** Presentation-only feel numbers, each a tuning slider (index.ts, AUDIO_TUNING). */
export interface SlowmoParams {
  /** Low-pass cutoff on the effects bus during slow motion, Hz. */
  lowpassHz: number;
  /** Pitch shift of the effects during slow motion, semitones (negative = down). */
  pitchSemis: number;
  /** Music level during slow motion, 0..1 of its normal level. */
  musicDuck: number;
  /** Time constant of the glide in and out, seconds. */
  glideS: number;
}

export const SLOWMO_DEFAULTS: SlowmoParams = {
  lowpassHz: 900,
  pitchSemis: -5,
  musicDuck: 0.35,
  glideS: 0.06,
};

/** The low-pass cutoff outside slow motion: effectively open. */
export const OPEN_HZ = 20000;

export interface SlowmoTreatment {
  /** Every effects source connects here. */
  readonly fxIn: AudioNode;
  /** The music loop connects here. */
  readonly musicIn: AudioNode;
  /** Glides the treatment in or out; repeated calls with the same state do nothing. */
  set(active: boolean, at?: number): void;
  readonly active: () => boolean;
  /** The pitch factor sources should apply now (1 outside slow motion). */
  readonly pitch: () => number;
  /** The cutoff the low-pass is gliding to, Hz. */
  readonly lowpassTarget: () => number;
  /** The level the music duck is gliding to. */
  readonly musicTarget: () => number;
  /** New feel numbers; applied at once if the treatment is on. */
  setParams(p: Partial<SlowmoParams>): void;
}

export function createSlowmoTreatment(
  ctx: BaseAudioContext,
  effectsBus: AudioNode,
  musicBus: AudioNode,
  initial: Partial<SlowmoParams> = {},
): SlowmoTreatment {
  const params: SlowmoParams = { ...SLOWMO_DEFAULTS, ...initial };
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.9;
  lp.frequency.value = OPEN_HZ;
  lp.connect(effectsBus);
  const duck = ctx.createGain();
  duck.gain.value = 1;
  duck.connect(musicBus);

  let on = false;
  let lpTarget = OPEN_HZ;
  let musicTarget = 1;

  const apply = (at: number) => {
    lpTarget = on ? Math.min(OPEN_HZ, Math.max(80, params.lowpassHz)) : OPEN_HZ;
    musicTarget = on ? Math.min(1, Math.max(0, params.musicDuck)) : 1;
    const glide = Math.max(0.005, params.glideS);
    lp.frequency.setTargetAtTime(lpTarget, at, glide);
    // The music comes back a little slower than it ducks, so the exit breathes.
    duck.gain.setTargetAtTime(musicTarget, at, on ? glide : glide * 3);
  };

  return {
    fxIn: lp,
    musicIn: duck,
    set(active, at = ctx.currentTime) {
      if (active === on) return;
      on = active;
      apply(at);
    },
    active: () => on,
    pitch: () => (on ? 2 ** (params.pitchSemis / 12) : 1),
    lowpassTarget: () => lpTarget,
    musicTarget: () => musicTarget,
    setParams(p) {
      Object.assign(params, p);
      if (on) apply(ctx.currentTime);
    },
  };
}
