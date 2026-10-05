// The regional bands' rigs (playtest 2, 2026-10-02: "different stations and music in different
// regions"): the instruments that play radio-compose-regional.ts's songs. Each genre sounds like
// itself, not like the Keys' surf and rockabilly guitars:
// - grunge: Karplus-Strong strings through a heavy distortion and a speaker-cabinet low-pass (power
//   chords and the bent lead), a clean arpeggio guitar into an echo, a driven bass, a big kit with
//   open cymbals and a short room;
// - folk: a strummed acoustic guitar with a body resonance, banjo rolls, a glockenspiel, an
//   upright bass, foot stomps, claps and a tambourine, in a small room, and (playtest 4) a
//   tremolo-picked mandolin;
// - synth: oscillators only: a filtered saw bass with a pluck envelope, a detuned saw pad, a square
//   arpeggio and a gliding saw lead into a dotted-eighth echo, over a drum machine;
// - psych: a drawbar organ (one periodic wave) through a tremolo and a two-stage phaser, a fuzz lead
//   into a tape echo, a melodic bass, ride and tambourine.
// Shared effects (distortion, echoes, the phaser) are built once per rig; each note is one or two
// sources and a gain, scheduled ahead like the Keys' bands, so the cost on a phone stays small.
import { noiseBuffer } from './engine-patch';
import type { RadioNote } from './radio-compose';
import type { RegionalGenre } from './radio-genres';
import { pluckBuffer, type RadioRig, type Timbre } from './radio-synth';

export { REGIONAL_GENRES, type RegionalGenre } from './radio-genres';

/**
 * Each rig's output trim, [default], set so every band plays at about the Keys' loudness (measured
 * offline in tests/e2e/audio-radio.spec.ts, which checks they sit within a few dB of each other).
 */
export const RIG_TRIM: Readonly<Record<RegionalGenre, number>> = {
  // Playtest 4's whole songs open on a riff (grunge) and build to louder choruses (folk), so both
  // were trimmed to keep their first bars and their whole songs level with the other bands.
  grunge: 0.62,
  folk: 1.3,
  synth: 1.4,
  psych: 1.0,
};

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

function shaperCurve(drive: number, asym = 0): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * (x + asym * x * x)) / norm;
  }
  return curve;
}

export function createRegionalRig(ctx: BaseAudioContext, out: AudioNode, genre: RegionalGenre): RadioRig {
  const rigOut = ctx.createGain();
  rigOut.gain.value = 0;
  rigOut.connect(out);
  let fxScale = 1;
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
  /** A small room: two damped combs. */
  const room = (wet: number): AudioNode => {
    const input = ctx.createGain();
    const w = gain(wet);
    for (const t of [0.0231, 0.0313]) {
      const d = ctx.createDelay(0.1);
      d.delayTime.value = t;
      const damp = filter('lowpass', 3000);
      const fb = ctx.createGain();
      fb.gain.value = 0.55;
      input.connect(d).connect(damp);
      damp.connect(fb).connect(d);
      damp.connect(w);
    }
    return input;
  };

  // --- Shared drum voices -------------------------------------------------------------------
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
    type: OscillatorType,
    f0: number,
    f1: number,
    t: number,
    level: number,
    decay: number,
    to = drums,
  ) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + decay);
    o.connect(env(to, t, level, decay));
    o.start(t);
    o.stop(t + decay + 0.02);
  };
  const noise = (
    type: BiquadFilterType,
    f: number,
    q: number,
    t: number,
    level: number,
    decay: number,
    attack = 0,
  ) => {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    n.loop = true;
    n.connect(filter(type, f, q)).connect(env(drums, t, level, decay, attack));
    n.start(t, (t * 7.31) % 0.9);
    n.stop(t + attack + decay + 0.02);
  };
  const clap = (t: number, v: number) => {
    for (let k = 0; k < 3; k++) noise('bandpass', 1300, 0.9, t + k * 0.011, 0.38 * v, 0.012);
    noise('bandpass', 1200, 0.7, t + 0.033, 0.3 * v, 0.13);
  };
  const tamb = (t: number, v: number) => {
    noise('highpass', 7500, 0.7, t, 0.12 * v, 0.07);
    noise('bandpass', 9500, 3, t, 0.1 * v, 0.12);
  };

  // --- Strings ------------------------------------------------------------------------------
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

  // --- The genres ---------------------------------------------------------------------------
  type Play = (n: RadioNote, t: number, stepS: number) => void;
  let play: Play;
  let timbres: Partial<Record<RadioNote['layer'], Timbre>> = {};
  /** Called before each note with the grid, for tempo-locked effects. */
  let onTempo: (stepS: number) => void = () => {};

  if (genre === 'grunge') {
    // The distortion: high-pass, heavy asymmetric clip, a cabinet low-pass and a low-mid push.
    const dist = ctx.createGain();
    dist.gain.value = 0.55;
    const shaper = ctx.createWaveShaper();
    shaper.curve = shaperCurve(7, 0.15);
    shaper.oversample = 'none';
    const cab = filter('lowpass', 3400, 0.8);
    const push = filter('peaking', 700, 1, 4);
    dist.connect(filter('highpass', 110)).connect(shaper).connect(cab).connect(push).connect(gain(0.32));
    const clean = gain(0.5);
    const cleanEcho = send(0.35);
    clean.connect(cleanEcho).connect(echo(0.36, 0.3, 2600, 0.6));
    const bassIn = ctx.createGain();
    const bassDrive = ctx.createWaveShaper();
    bassDrive.curve = shaperCurve(2);
    bassIn.connect(bassDrive).connect(filter('lowpass', 900)).connect(gain(0.8));
    const roomIn = send(0.5);
    drums.connect(roomIn).connect(room(0.25));
    timbres = { rhythm: 'drive', lead: 'drive', arp: 'clean', bass: 'bass' };
    play = (n, t, stepS) => {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          tone('sine', 120, 42, t, 1.0 * v, 0.32);
          noise('highpass', 2500, 0.7, t, 0.12 * v, 0.01);
          break;
        case 'snare':
          noise('bandpass', 1700, 0.6, t, 0.6 * v, 0.2);
          tone('triangle', 200, 165, t, 0.35 * v, 0.08);
          break;
        case 'hat':
          noise('highpass', 8000, 0.7, t, 0.12 * v, 0.04);
          break;
        case 'openhat':
          noise('highpass', 6000, 0.7, t, 0.13 * v, 0.28);
          break;
        case 'crash':
          noise('highpass', 4000, 0.7, t, 0.25 * v, 1.4);
          break;
        case 'tom': {
          const f = midiHz(n.midi);
          tone('sine', f, f * 0.65, t, 0.75 * v, 0.28);
          break;
        }
        case 'bass':
          pluck(bassIn, buffer(n.midi, 'bass'), t, 0.9 * v, hold * 0.92, 0.06);
          break;
        case 'rhythm':
          pluck(
            dist,
            buffer(n.midi, 'drive'),
            t + (n.strum ?? 0) * 0.006,
            0.5 * v,
            hold * 0.9,
            n.len > 2 ? 0.4 : 0.04,
          );
          break;
        case 'lead':
          pluck(dist, buffer(n.midi, 'drive'), t, 0.7 * v, hold * 0.95, 0.2, n.slide ?? 0);
          break;
        case 'arp':
          pluck(clean, buffer(n.midi, 'clean'), t, 0.55 * v, hold, 0.25);
          break;
      }
    };
  } else if (genre === 'folk') {
    const body = ctx.createGain();
    body.gain.value = 0.55;
    body
      .connect(filter('highpass', 90))
      .connect(filter('peaking', 220, 1.2, 4))
      .connect(filter('peaking', 3000, 0.8, 3))
      .connect(rigOut);
    const banjo = ctx.createGain();
    banjo.gain.value = 0.45;
    banjo
      .connect(filter('highpass', 300))
      .connect(filter('peaking', 2500, 1, 4))
      .connect(rigOut);
    const glock = gain(0.35);
    const bass = ctx.createGain();
    bass.connect(filter('lowpass', 900)).connect(gain(0.85));
    const roomIn = send(0.6);
    body.connect(roomIn);
    glock.connect(roomIn);
    drums.connect(roomIn);
    roomIn.connect(room(0.3));
    timbres = { rhythm: 'acoustic', arp: 'banjo', lead: 'banjo', bass: 'upright' };
    play = (n, t, stepS) => {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          // A foot stomp on boards: a low thud and a little wood.
          tone('sine', 95, 48, t, 0.95 * v, 0.2);
          noise('lowpass', 420, 0.8, t, 0.35 * v, 0.05);
          break;
        case 'clap':
          clap(t, v);
          break;
        case 'tamb':
          tamb(t, v);
          break;
        case 'bass':
          pluck(bass, buffer(n.midi, 'upright'), t, 0.9 * v, hold * 0.9, 0.08);
          break;
        case 'rhythm':
          pluck(body, buffer(n.midi, 'acoustic'), t + (n.strum ?? 0) * 0.011, 0.5 * v, hold * 1.6, 0.3);
          break;
        case 'arp':
          pluck(banjo, buffer(n.midi, 'banjo'), t, 0.6 * v, hold * 1.5, 0.12);
          break;
        case 'lead': {
          // The mandolin (playtest 4): a bright string re-picked every half step when tremolo-picked.
          const picks = n.trem ? Math.max(1, Math.round(n.len * 2)) : 1;
          const h = n.trem ? stepS / 2 : hold;
          for (let k = 0; k < picks; k++)
            pluck(banjo, buffer(n.midi, 'banjo'), t + k * h, (k % 2 ? 0.4 : 0.5) * v, h * 0.95, 0.04);
          break;
        }
        case 'glock': {
          // A bar of metal: the fundamental and its inharmonic partial, ringing.
          const f = midiHz(n.midi);
          tone('sine', f, f, t, 0.5 * v, 0.9, glock);
          tone('sine', f * 2.76, f * 2.76, t, 0.12 * v, 0.25, glock);
          break;
        }
      }
    };
  } else if (genre === 'synth') {
    const echoIn = send(0.32);
    const echoLine = echo(0.375, 0.38, 3000, 0.5);
    echoIn.connect(echoLine);
    let lastStepS = 0;
    onTempo = (stepS) => {
      // The echo locks to a dotted eighth (three sixteenths) of the song's tempo.
      if (stepS !== lastStepS) {
        lastStepS = stepS;
        echoLine.delayTime.setValueAtTime(Math.min(1.9, 3 * stepS), ctx.currentTime);
      }
    };
    const padBus = ctx.createGain();
    padBus.connect(filter('lowpass', 1800, 0.7)).connect(gain(0.22));
    const arpBus = ctx.createGain();
    arpBus.connect(filter('lowpass', 3500)).connect(gain(0.18));
    arpBus.connect(echoIn);
    const leadBus = ctx.createGain();
    leadBus.connect(filter('lowpass', 2600)).connect(gain(0.2));
    leadBus.connect(echoIn);
    const bassBus = gain(0.5);
    play = (n, t, stepS) => {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          tone('sine', 150, 45, t, 1.0 * v, 0.28);
          break;
        case 'clap':
          clap(t, v);
          break;
        case 'hat':
          noise('highpass', 9000, 0.7, t, 0.11 * v, 0.03);
          break;
        case 'openhat':
          noise('highpass', 8000, 0.7, t, 0.12 * v, 0.2);
          break;
        case 'crash':
          noise('highpass', 5000, 0.7, t, 0.2 * v, 1.2);
          break;
        case 'bass': {
          // A saw through a resonant low-pass that snaps shut: the pluck of an analogue bass.
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = midiHz(n.midi);
          const lp = filter('lowpass', 1800, 4);
          lp.frequency.setValueAtTime(1800, t);
          lp.frequency.exponentialRampToValueAtTime(260, t + 0.15);
          const g = env(bassBus, t, 0.55 * v, Math.max(0.08, hold * 0.9));
          o.connect(lp).connect(g);
          o.start(t);
          o.stop(t + hold + 0.05);
          break;
        }
        case 'pad':
          voice(padBus, 'sawtooth', n.midi, t, 0.3 * v, hold, 0.25, 0.4, -7);
          voice(padBus, 'sawtooth', n.midi, t, 0.3 * v, hold, 0.25, 0.4, 7);
          break;
        case 'arp':
          voice(arpBus, 'square', n.midi, t, 0.5 * v, hold * 0.5, 0.004, 0.08);
          break;
        case 'lead':
          voice(leadBus, 'sawtooth', n.midi, t, 0.55 * v, hold * 0.95, 0.02, 0.15, 0, n.slide ?? 0);
          break;
      }
    };
  } else {
    // Psych: the organ's drawbars as one periodic wave (fundamental, octave, twelfth, ...).
    const bars = [0, 1, 1, 0.8, 0.5, 0, 0.3, 0, 0.25];
    const real = new Float32Array(bars.length);
    const imag = new Float32Array(bars);
    const organWave = ctx.createPeriodicWave(real, imag);
    const organ = ctx.createGain();
    // Tremolo: a slow LFO on the organ's gain.
    const trem = ctx.createGain();
    trem.gain.value = 0.75;
    const tremLfo = ctx.createOscillator();
    tremLfo.frequency.value = 5.8;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.2;
    tremLfo.connect(tremDepth).connect(trem.gain);
    tremLfo.start();
    // A two-stage phaser swept by a slower LFO, mixed with the dry organ.
    const ap1 = filter('allpass', 700, 0.6);
    const ap2 = filter('allpass', 700, 0.6);
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.35;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 450;
    sweep.connect(sweepDepth);
    sweepDepth.connect(ap1.frequency);
    sweepDepth.connect(ap2.frequency);
    sweep.start();
    const organOut = gain(0.2);
    const tone2 = filter('lowpass', 4500);
    organ.connect(trem).connect(tone2);
    tone2.connect(organOut);
    tone2.connect(ap1).connect(ap2).connect(organOut);
    // The fuzz: a near-square clip, a mid hump, into a tape echo.
    const fuzzIn = ctx.createGain();
    fuzzIn.gain.value = 0.6;
    const fuzz = ctx.createWaveShaper();
    fuzz.curve = shaperCurve(12, 0.25);
    const fuzzOut = gain(0.22);
    fuzzIn
      .connect(filter('highpass', 200))
      .connect(fuzz)
      .connect(filter('peaking', 1100, 0.9, 5))
      .connect(filter('lowpass', 3000))
      .connect(fuzzOut);
    const tape = send(0.4);
    fuzzOut.connect(tape).connect(echo(0.33, 0.35, 2200, 0.5));
    const bass = ctx.createGain();
    bass.connect(filter('lowpass', 1200)).connect(gain(0.8));
    timbres = { lead: 'drive', bass: 'bass' };
    play = (n, t, stepS) => {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          tone('sine', 110, 48, t, 0.9 * v, 0.22);
          break;
        case 'snare':
          noise('bandpass', 1800, 0.8, t, 0.5 * v, 0.16);
          tone('triangle', 190, 160, t, 0.3 * v, 0.07);
          break;
        case 'ride':
          noise('bandpass', 6500, 1.6, t, 0.11 * v, 0.26);
          tone('sine', 2350, 2350, t, 0.03 * v, 0.2);
          break;
        case 'tamb':
          tamb(t, v);
          break;
        case 'crash':
          noise('highpass', 5000, 0.7, t, 0.22 * v, 1.1);
          break;
        case 'tom': {
          const f = midiHz(n.midi);
          tone('sine', f, f * 0.7, t, 0.6 * v, 0.24);
          break;
        }
        case 'bass':
          pluck(bass, buffer(n.midi, 'bass'), t, 0.9 * v, hold * 0.9, 0.06);
          break;
        case 'organ':
          voice(organ, organWave, n.midi, t, 0.32 * v, hold * 0.97, 0.012, 0.08);
          break;
        case 'lead':
          pluck(fuzzIn, buffer(n.midi, 'drive'), t, 0.7 * v, hold * 0.95, 0.15, n.slide ?? 0);
          break;
      }
    };
  }

  const trim = RIG_TRIM[genre];
  return {
    genre,
    prepare(notes) {
      for (const n of notes) {
        const timbre = timbres[n.layer];
        if (timbre) buffer(n.midi, timbre);
      }
    },
    setLevel(level, at) {
      rigOut.gain.setTargetAtTime(level * trim, at, 0.08);
    },
    setFx(scale) {
      fxScale = Math.max(0, scale);
      for (const s of sends) s.node.gain.setTargetAtTime(s.level * fxScale, ctx.currentTime, 0.05);
    },
    play(note, t, stepS) {
      onTempo(stepS);
      play(note, t, stepS);
    },
  };
}
