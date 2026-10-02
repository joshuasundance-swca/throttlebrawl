// The building blocks the "more bands" rigs share (radio-rigs-more.ts): a rig's output gain, effect
// sends that follow the `audio.radioFx` slider, filters, an echo, a small room, drum voices, plucked
// strings (Karplus-Strong buffers from radio-synth.ts) and enveloped oscillator notes. The same
// primitives as radio-rigs.ts builds inline for the regional bands, factored out for the six newer
// ones so each band's file is only its own instruments. Everything is scheduled ahead of time as
// one or two sources and a gain, so the cost on a phone stays small.
import { noiseBuffer } from './engine-patch';
import { pluckBuffer, type Timbre } from './radio-synth';

export const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export function shaperCurve(drive: number, asym = 0): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * (x + asym * x * x)) / norm;
  }
  return curve;
}

export function createKit(ctx: BaseAudioContext, out: AudioNode) {
  const rigOut = ctx.createGain();
  rigOut.gain.value = 0;
  rigOut.connect(out);
  /** Effect sends that follow the `audio.radioFx` slider, with their designed levels. */
  const sends: { node: GainNode; level: number }[] = [];
  const send = (level: number) => {
    const g = ctx.createGain();
    g.gain.value = level;
    sends.push({ node: g, level });
    return g;
  };
  const gain = (level: number, to: AudioNode = rigOut) => {
    const g = ctx.createGain();
    g.gain.value = level;
    g.connect(to);
    return g;
  };
  const filter = (type: BiquadFilterType, f: number, q = 0.7, dbGain = 0) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.gain.value = dbGain;
    return b;
  };
  /** A feedback echo: `time` s, `fb` feedback, darkened; returns its input. */
  const echo = (time: number, fb: number, darkHz: number, wet: number): DelayNode => {
    const d = ctx.createDelay(2);
    d.delayTime.value = time;
    const dark = filter('lowpass', darkHz);
    const f = ctx.createGain();
    f.gain.value = fb;
    d.connect(dark);
    dark.connect(f).connect(d);
    dark.connect(gain(wet));
    return d;
  };
  /** A room: damped combs, `size` scales their lengths (1 = small, 3 = a hall). */
  const room = (wet: number, size = 1, fbk = 0.55): AudioNode => {
    const input = ctx.createGain();
    const w = gain(wet);
    for (const t of [0.0231, 0.0313, 0.0419]) {
      const d = ctx.createDelay(0.3);
      d.delayTime.value = t * size;
      const damp = filter('lowpass', 3000);
      const fb = ctx.createGain();
      fb.gain.value = fbk;
      input.connect(d).connect(damp);
      damp.connect(fb).connect(d);
      damp.connect(w);
    }
    return input;
  };

  const drums = gain(0.6);
  const env = (dest: AudioNode, t: number, level: number, decay: number, attack = 0) => {
    const g = ctx.createGain();
    if (attack > 0) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
    } else g.gain.setValueAtTime(Math.max(0.0002, level), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  };
  const tone = (
    type: OscillatorType | PeriodicWave,
    f0: number,
    f1: number,
    t: number,
    level: number,
    decay: number,
    to: AudioNode = drums,
    attack = 0,
  ) => {
    const o = ctx.createOscillator();
    if (typeof type === 'string') o.type = type as OscillatorType;
    else o.setPeriodicWave(type);
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    o.connect(env(to, t, level, decay, attack));
    o.start(t);
    o.stop(t + attack + decay + 0.02);
    return o;
  };
  const noise = (
    type: BiquadFilterType,
    f: number,
    q: number,
    t: number,
    level: number,
    decay: number,
    attack = 0,
    to: AudioNode = drums,
  ) => {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    n.loop = true;
    n.connect(filter(type, f, q)).connect(env(to, t, level, decay, attack));
    n.start(t, (t * 7.31) % 0.9);
    n.stop(t + attack + decay + 0.02);
    return n;
  };
  const clap = (t: number, v: number) => {
    for (let k = 0; k < 3; k++) noise('bandpass', 1300, 0.9, t + k * 0.011, 0.38 * v, 0.012);
    noise('bandpass', 1200, 0.7, t + 0.033, 0.3 * v, 0.13);
  };
  const tamb = (t: number, v: number) => {
    noise('highpass', 7500, 0.7, t, 0.12 * v, 0.07);
    noise('bandpass', 9500, 3, t, 0.1 * v, 0.12);
  };

  const cache = new Map<string, AudioBuffer>();
  const buffer = (midi: number, timbre: Timbre) => {
    const k = `${timbre}:${midi}`;
    let b = cache.get(k);
    if (!b) {
      b = pluckBuffer(ctx, midi, timbre);
      cache.set(k, b);
    }
    return b;
  };
  const pluck = (
    dest: AudioNode,
    buf: AudioBuffer,
    t: number,
    level: number,
    hold: number,
    release: number,
    slide = 0,
  ) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (slide) {
      src.playbackRate.setValueAtTime(2 ** (slide / 12), t);
      src.playbackRate.exponentialRampToValueAtTime(1, t + 0.09);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.setTargetAtTime(0.0001, t + hold, release / 3);
    src.connect(g).connect(dest);
    src.start(t);
    src.stop(t + hold + release + 0.02);
    return src;
  };
  /** One oscillator note with an attack, a hold and a release; optional glide from `slide`. */
  const voice = (
    dest: AudioNode,
    type: OscillatorType | PeriodicWave,
    midi: number,
    t: number,
    level: number,
    hold: number,
    attack: number,
    release: number,
    detune = 0,
    slide = 0,
  ) => {
    const o = ctx.createOscillator();
    if (typeof type === 'string') o.type = type as OscillatorType;
    else o.setPeriodicWave(type);
    const f = midiHz(midi);
    o.frequency.setValueAtTime(slide ? f * 2 ** (slide / 12) : f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + Math.max(attack, hold));
    g.gain.setTargetAtTime(0.0001, t + Math.max(attack, hold), release / 3);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + Math.max(attack, hold) + release + 0.05);
    return o;
  };

  return {
    rigOut,
    sends,
    send,
    gain,
    filter,
    echo,
    room,
    drums,
    env,
    tone,
    noise,
    clap,
    tamb,
    buffer,
    pluck,
    voice,
    /** The rig's output level, scaled by its trim. */
    setLevel(level: number, at: number, trim: number) {
      rigOut.gain.setTargetAtTime(level * trim, at, 0.08);
    },
    /** Scales the effect sends (0 = dry). */
    setFx(scale: number) {
      const k = Math.max(0, scale);
      for (const s of sends) s.node.gain.setTargetAtTime(s.level * k, ctx.currentTime, 0.05);
    },
  };
}

export type Kit = ReturnType<typeof createKit>;
