// The radio's band (M4 radio-1): plays a Composition's notes on the existing WebAudio engine.
// Guitars and basses are plucked strings (Karplus-Strong, rendered once per pitch into a small
// buffer and cached), so they sound like strings, not test tones; drums are synthesized like the
// score's (music.ts). Each genre has its own rig:
// - surf: a bright, slightly driven guitar into a spring reverb, electric bass. The spring is three
//   damped comb filters at 30-44 ms, whose flutter is the tank's metallic "drip". A 1.6 s
//   convolver was tried first: offline it cost about seven times the rest of the band's render
//   time, too much for a phone;
// - rockabilly: a twangy guitar into a slapback echo, a dark upright bass with the slap's click,
//   brushes and a ride.
// Everything is scheduled ahead from the frame loop (radio.ts), so there are no timers.
import { noiseBuffer } from './engine-patch';
import { seededRandom, type RadioNote } from './radio-compose';

export type RadioGenre = 'surf' | 'rockabilly' | 'grunge' | 'folk' | 'synth' | 'psych';
/**
 * String timbres. Each has its own buffer length, so a probe that counts buffer lengths can tell the
 * bands apart (tests/e2e/audio-radio.spec.ts): 1.1 twang, 0.8 clean, 0.9 bass, 0.6 upright, and the
 * regional bands' 1.2 drive (grunge and psych guitars), 1.3 acoustic and 0.45 banjo (folk).
 */
export type Timbre = 'twang' | 'clean' | 'bass' | 'upright' | 'drive' | 'acoustic' | 'banjo';

/** Karplus-Strong settings: excitation brightness, loop damping (0.5 = classic), loop gain, length. */
const TIMBRES: Readonly<Record<Timbre, { bright: number; damp: number; decay: number; dur: number }>> = {
  twang: { bright: 0.9, damp: 0.3, decay: 0.9975, dur: 1.1 },
  clean: { bright: 0.6, damp: 0.45, decay: 0.996, dur: 0.8 },
  bass: { bright: 0.45, damp: 0.5, decay: 0.995, dur: 0.9 },
  upright: { bright: 0.25, damp: 0.5, decay: 0.989, dur: 0.6 },
  drive: { bright: 0.95, damp: 0.25, decay: 0.998, dur: 1.2 },
  acoustic: { bright: 0.75, damp: 0.42, decay: 0.997, dur: 1.3 },
  banjo: { bright: 1, damp: 0.12, decay: 0.992, dur: 0.45 },
};

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** A plucked string at `midi`, rendered with Karplus-Strong. Deterministic (seeded noise). */
export function pluckBuffer(ctx: BaseAudioContext, midi: number, timbre: Timbre): AudioBuffer {
  const t = TIMBRES[timbre];
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.round(t.dur * sr));
  const buf = ctx.createBuffer(1, len, sr);
  const y = buf.getChannelData(0);
  const period = sr / midiHz(midi);
  // The averaging filter delays by `damp` samples, so the loop reads `period - damp` back.
  const delay = Math.max(2, period - t.damp);
  const n0 = Math.min(len, Math.ceil(period));
  const rand = seededRandom(Math.imul(midi + 1, 7919) ^ timbre.length);
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < n0; i++) {
    lp += t.bright * (rand() * 2 - 1 - lp);
    y[i] = lp;
    mean += lp;
  }
  mean /= Math.max(1, n0);
  for (let i = 0; i < n0; i++) y[i] = (y[i] ?? 0) - mean;
  for (let i = n0; i < len; i++) {
    const x = i - delay;
    const i0 = Math.floor(x);
    const fr = x - i0;
    const a = (y[i0] ?? 0) * (1 - fr) + (y[i0 + 1] ?? 0) * fr;
    const b = (y[i0 - 1] ?? 0) * (1 - fr) + (y[i0] ?? 0) * fr;
    y[i] = t.decay * ((1 - t.damp) * a + t.damp * b);
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(y[i] ?? 0));
  if (peak > 0) for (let i = 0; i < len; i++) y[i] = ((y[i] ?? 0) / peak) * 0.9;
  return buf;
}

export interface RadioRig {
  readonly genre: RadioGenre;
  /** Schedules one note at `t` (audio clock), `stepS` seconds per grid step. */
  play(note: RadioNote, t: number, stepS: number): void;
  /** Renders every pluck buffer the notes need, so the first bar does not stall. */
  prepare(notes: readonly RadioNote[]): void;
  /** The rig's output level (0..1), for the station switch's crossfade. */
  setLevel(level: number, at: number): void;
  /** Scales the spring (surf) or the slapback (rockabilly): 0 = dry, 1 = as designed. */
  setFx(scale: number): void;
}

/** Mix levels per part, [default]. Surf's spring makes it louder, so its rig is trimmed to match. */
const LEVELS = { drums: 0.55, bass: 0.75, guitar: 0.42, fxSend: 0.55, surfTrim: 0.62 } as const;
/** The spring's comb delays (s) and their feedback, [default]. */
const SPRING = { delays: [0.0297, 0.0371, 0.0437], feedback: 0.8, dampHz: 3600, wet: 0.3 } as const;

export function createRadioRig(ctx: BaseAudioContext, out: AudioNode, genre: RadioGenre): RadioRig {
  const surf = genre === 'surf';
  const rigOut = ctx.createGain();
  rigOut.gain.value = 0;
  rigOut.connect(out);

  // Guitars: high-pass, the twang peak, a touch of drive on surf; dry plus the genre's effect.
  const guitar = ctx.createGain();
  guitar.gain.value = LEVELS.guitar;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 140;
  const peak = ctx.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = surf ? 2400 : 3000;
  peak.Q.value = 0.9;
  peak.gain.value = 6;
  guitar.connect(hp).connect(peak);
  let tone: AudioNode = peak;
  if (surf) {
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(1.6 * x) / Math.tanh(1.6);
    }
    drive.curve = curve;
    peak.connect(drive);
    tone = drive;
  }
  tone.connect(rigOut);
  const send = ctx.createGain();
  send.gain.value = LEVELS.fxSend;
  tone.connect(send);
  if (surf) {
    // The tank: band-limited in, three damped combs in parallel, summed out.
    const springIn = ctx.createBiquadFilter();
    springIn.type = 'bandpass';
    springIn.frequency.value = 1800;
    springIn.Q.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = SPRING.wet;
    send.connect(springIn);
    for (const d of SPRING.delays) {
      const line = ctx.createDelay(0.1);
      line.delayTime.value = d;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = SPRING.dampHz;
      const fb = ctx.createGain();
      fb.gain.value = SPRING.feedback;
      springIn.connect(line).connect(damp);
      damp.connect(fb).connect(line);
      damp.connect(wet);
    }
    wet.connect(rigOut);
  } else {
    // Slapback: one short echo, a little darker, barely fed back.
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.11;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 3200;
    const fb = ctx.createGain();
    fb.gain.value = 0.18;
    const wet = ctx.createGain();
    wet.gain.value = 0.75;
    send.connect(delay).connect(dark).connect(wet).connect(rigOut);
    dark.connect(fb).connect(delay);
  }

  const bass = ctx.createGain();
  bass.gain.value = LEVELS.bass;
  const bassTone = ctx.createBiquadFilter();
  bassTone.type = 'lowpass';
  bassTone.frequency.value = surf ? 1600 : 1100;
  bass.connect(bassTone).connect(rigOut);

  const drums = ctx.createGain();
  drums.gain.value = LEVELS.drums;
  drums.connect(rigOut);
  if (surf) {
    // A little of the kit in the spring too, as surf records have it.
    const drumSend = ctx.createGain();
    drumSend.gain.value = 0.15;
    drums.connect(drumSend).connect(send);
  }

  const cache = new Map<string, AudioBuffer>();
  const leadTimbre: Timbre = 'twang';
  const rhythmTimbre: Timbre = surf ? 'clean' : 'twang';
  const bassTimbre: Timbre = surf ? 'bass' : 'upright';
  const timbreOf = (layer: RadioNote['layer']): Timbre | null =>
    layer === 'lead' || layer === 'gliss'
      ? leadTimbre
      : layer === 'rhythm'
        ? rhythmTimbre
        : layer === 'bass'
          ? bassTimbre
          : null;
  const buffer = (midi: number, timbre: Timbre) => {
    const k = `${timbre}:${midi}`;
    let b = cache.get(k);
    if (!b) {
      b = pluckBuffer(ctx, midi, timbre);
      cache.set(k, b);
    }
    return b;
  };

  const env = (dest: AudioNode, t: number, peakLevel: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(peakLevel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(dest);
    return g;
  };
  const osc = (type: OscillatorType, f0: number, f1: number, t: number, level: number, decay: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + decay);
    o.connect(env(drums, t, level, decay));
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
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.value = f;
    bq.Q.value = q;
    const g = ctx.createGain();
    if (attack > 0) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + attack);
    } else g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    n.connect(bq).connect(g).connect(drums);
    n.start(t, (t * 7.31) % 0.9);
    n.stop(t + attack + decay + 0.02);
  };

  /** One pick of a string: buffer source, held for `hold` s, then a short release. */
  const pick = (
    dest: AudioNode,
    buf: AudioBuffer,
    t: number,
    level: number,
    hold: number,
    release: number,
    rate0 = 1,
    rate1 = 1,
    glideS = 0.06,
  ) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(rate0, t);
    if (rate1 !== rate0) src.playbackRate.exponentialRampToValueAtTime(rate1, t + glideS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.setTargetAtTime(0.0001, t + hold, release / 3);
    src.connect(g).connect(dest);
    src.start(t);
    src.stop(t + hold + release + 0.02);
  };

  return {
    genre,
    prepare(notes) {
      for (const n of notes) {
        const timbre = timbreOf(n.layer);
        if (timbre) buffer(n.midi, timbre);
      }
    },
    setLevel(level, at) {
      rigOut.gain.setTargetAtTime(level * (surf ? LEVELS.surfTrim : 1), at, 0.08);
    },
    setFx(scale) {
      send.gain.setTargetAtTime(LEVELS.fxSend * Math.max(0, scale), ctx.currentTime, 0.05);
    },
    play(note, t, stepS) {
      const v = note.vel;
      switch (note.layer) {
        case 'kick':
          osc('sine', 130, 46, t, 0.95 * v, 0.2);
          noise('highpass', 3000, 0.7, t, 0.12 * v, 0.012);
          break;
        case 'snare':
          noise('bandpass', 1900, 0.8, t, 0.5 * v, surf ? 0.14 : 0.11);
          osc('triangle', 190, 160, t, 0.3 * v, 0.07);
          break;
        case 'brush':
          noise('bandpass', 3400, 0.5, t, 0.22 * v, 0.16, 0.02);
          break;
        case 'hat':
          noise('highpass', 8000, 0.7, t, 0.13 * v, 0.035);
          break;
        case 'ride':
          noise('bandpass', 6500, 1.6, t, 0.11 * v, 0.24);
          osc('sine', 2350, 2350, t, 0.03 * v, 0.18);
          break;
        case 'crash':
          noise('highpass', 5000, 0.7, t, 0.22 * v, 1.0);
          break;
        case 'tom': {
          const f = midiHz(note.midi);
          osc('sine', f, f * 0.7, t, 0.6 * v, 0.22);
          noise('lowpass', 900, 0.7, t, 0.08 * v, 0.05);
          break;
        }
        case 'slap':
          noise('highpass', 1800, 0.7, t, 0.3 * v, 0.022);
          osc('triangle', 140, 90, t, 0.2 * v, 0.035);
          break;
        case 'bass':
          pick(bass, buffer(note.midi, bassTimbre), t, 0.9 * v, note.len * stepS * 0.9, 0.06);
          break;
        case 'rhythm':
          // Chord tones strummed a few milliseconds apart, choked short (palm-muted feel).
          pick(
            guitar,
            buffer(note.midi, rhythmTimbre),
            t + (note.strum ?? 0) * 0.009,
            0.45 * v,
            note.len * stepS * 0.85,
            note.len > 2 ? 0.25 : 0.05,
          );
          break;
        case 'lead': {
          const buf = buffer(note.midi, leadTimbre);
          if (note.trem) {
            // Tremolo picking: a fresh pick every half step, down-strokes a little harder.
            const h = stepS / 2;
            const picks = Math.max(1, Math.round(note.len * 2));
            for (let k = 0; k < picks; k++)
              pick(guitar, buf, t + k * h, (k % 2 ? 0.62 : 0.75) * v, h * 0.9, 0.03);
          } else {
            const r0 = note.slide ? 2 ** (note.slide / 12) : 1;
            pick(guitar, buf, t, 0.8 * v, note.len * stepS * 0.95, 0.1, r0, 1);
          }
          break;
        }
        case 'gliss': {
          // The drop: tremolo picks sliding down the string by `slide` semitones.
          const buf = buffer(note.midi, leadTimbre);
          const h = stepS / 2;
          const picks = Math.max(2, Math.round(note.len * 2));
          const total = note.slide ?? -24;
          for (let k = 0; k < picks; k++) {
            const a = 2 ** ((total * k) / picks / 12);
            const b = 2 ** ((total * (k + 1)) / picks / 12);
            pick(guitar, buf, t + k * h, (k % 2 ? 0.6 : 0.72) * v, h * 0.95, 0.03, a, b, h);
          }
          break;
        }
      }
    },
  };
}
