// The rigs for the six newer bands (radio-compose-more.ts; run W-Q audio, interview 2026-10-02
// round 6: more stations per region in clearly different genres, plus a hidden pirate station per
// region). Each genre sounds like itself, not like the guitars of the bands before it:
// - island: a steel pan (a bright sine with an octave and a twelfth, ringing), congas and a shaker,
//   a nylon guitar chopping the offbeats and a round bass;
// - dub: a sub-bass sine, a dry rim and a one-drop kick, a skank chop and a reedy melodica thrown
//   into a tempo-locked tape echo and a spring;
// - stoner: a fuzzed riff guitar through a cabinet and a hall, a fuzz bass, a wah solo and a heavy,
//   slow kit;
// - ambient: slow detuned pads, a drone, struck bells and a breathy line, all in a long room;
// - funk: a slap bass with octave pops, chicken-scratch guitar through a bandpass, horn stabs with
//   a filter that opens on the attack and a tight kit with ghost notes;
// - chip: pulse waves (25% and 12.5% duty) and a triangle bass through a three-bit crusher, over a
//   noise kit, the sound of a game console.
// The primitives are radio-rig-kit.ts's; each note is one or two sources and a gain.
import { createKit, midiHz, shaperCurve, type Kit } from './radio-rig-kit';
import type { RadioNote } from './radio-compose';
import type { RadioGenre, RadioRig, Timbre } from './radio-synth';

export type MoreGenre = Extract<RadioGenre, 'island' | 'dub' | 'stoner' | 'ambient' | 'funk' | 'chip'>;
export const MORE_GENRES: readonly MoreGenre[] = ['island', 'dub', 'stoner', 'ambient', 'funk', 'chip'];

/** Each rig's output trim, [default], set so every band plays at about the others' loudness (measured offline in tests/e2e/audio-radio.spec.ts). */
export const MORE_TRIM: Readonly<Record<MoreGenre, number>> = {
  island: 1.2,
  dub: 0.46,
  stoner: 0.31,
  ambient: 0.46,
  funk: 1.0,
  chip: 0.9,
};

type Play = (n: RadioNote, t: number, stepS: number) => void;
interface Built {
  play: Play;
  timbres: Partial<Record<RadioNote['layer'], Timbre>>;
  onTempo?: (stepS: number) => void;
}

/** A pulse wave of `duty` as a periodic wave (bipolar, band-limited by its harmonic count). */
export function pulseWave(ctx: BaseAudioContext, duty: number, harmonics = 32): PeriodicWave {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    real[n] = (2 / (n * Math.PI)) * Math.sin(2 * Math.PI * n * duty);
    imag[n] = (2 / (n * Math.PI)) * (1 - Math.cos(2 * Math.PI * n * duty));
  }
  return ctx.createPeriodicWave(real, imag);
}

/** A staircase curve with `levels` steps each side: the three-bit crush of a console's output. */
export function crushCurve(levels: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.round(x * levels) / levels;
  }
  return c;
}

function island(ctx: BaseAudioContext, k: Kit): Built {
  const roomIn = k.send(0.5);
  k.drums.connect(roomIn);
  const pan = k.gain(0.5);
  pan.connect(roomIn);
  const guitar = ctx.createGain();
  guitar.gain.value = 0.55;
  guitar.connect(k.filter('highpass', 220)).connect(k.rigOut);
  guitar.connect(roomIn);
  const bass = ctx.createGain();
  bass.connect(k.filter('lowpass', 800)).connect(k.gain(0.85));
  roomIn.connect(k.room(0.28));
  return {
    timbres: { rhythm: 'clean', bass: 'bass' },
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          k.tone('sine', 105, 46, t, 0.95 * v, 0.22);
          break;
        case 'conga': {
          // Two drums: a deep one (midi 60) and a bright one (midi 72), a slap on the strong hits.
          const f = n.midi >= 66 ? 330 : 200;
          k.tone('sine', f * 1.18, f, t, 0.7 * v, n.midi >= 66 ? 0.12 : 0.18);
          k.noise('bandpass', 1900, 1.2, t, 0.25 * v * (v > 0.7 ? 1 : 0.4), 0.03);
          break;
        }
        case 'tamb':
          k.tamb(t, v);
          break;
        case 'bass':
          k.pluck(bass, k.buffer(n.midi, 'bass'), t, 0.9 * v, hold * 0.85, 0.07);
          break;
        case 'rhythm':
          k.pluck(guitar, k.buffer(n.midi, 'clean'), t + (n.strum ?? 0) * 0.007, 0.5 * v, hold * 0.8, 0.12);
          break;
        case 'steel': {
          // A struck steel pan: the note, its octave and its twelfth, a pair of detuned fundamentals
          // that beat, ringing about as long as the note.
          const f = midiHz(n.midi);
          const ring = Math.min(1.3, 0.35 + hold * 1.1);
          k.tone('sine', f, f, t, 0.5 * v, ring, pan);
          k.tone('sine', f * 1.0035, f * 1.0035, t, 0.25 * v, ring, pan);
          k.tone('sine', f * 2, f * 2, t, 0.22 * v, ring * 0.7, pan);
          k.tone('sine', f * 3.01, f * 3.01, t, 0.07 * v, ring * 0.4, pan);
          k.noise('bandpass', Math.min(6000, f * 4), 2, t, 0.1 * v, 0.02, 0, pan);
          break;
        }
      }
    },
  };
}

function dub(ctx: BaseAudioContext, k: Kit): Built {
  // The echo is locked to a dotted eighth (three sixteenths) of the song's tempo; the spring is a room.
  const echoIn = k.send(0.5);
  const echoLine = k.echo(0.4, 0.5, 2400, 0.7);
  echoIn.connect(echoLine);
  const springIn = k.send(0.4);
  springIn.connect(k.room(0.3, 1.8, 0.62));
  let lastStepS = 0;
  const skank = ctx.createGain();
  skank.connect(k.filter('lowpass', 2600)).connect(k.gain(0.5));
  skank.connect(echoIn);
  skank.connect(springIn);
  const reed = ctx.createGain();
  reed.connect(k.filter('lowpass', 2200)).connect(k.gain(0.3));
  reed.connect(echoIn);
  const bassBus = k.gain(0.95);
  // A reedy tone: a sawtooth and a square a hair apart, a breath of vibrato on the gain.
  const vib = ctx.createOscillator();
  vib.frequency.value = 5.2;
  const vibDepth = ctx.createGain();
  vibDepth.gain.value = 0.25;
  vib.connect(vibDepth).connect(reed.gain);
  reed.gain.value = 0.75;
  vib.start();
  k.drums.connect(springIn);
  return {
    timbres: {},
    onTempo(stepS) {
      if (stepS !== lastStepS) {
        lastStepS = stepS;
        echoLine.delayTime.setValueAtTime(Math.min(1.9, 3 * stepS), ctx.currentTime);
      }
    },
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          k.tone('sine', 90, 38, t, 1.0 * v, 0.34);
          break;
        case 'snare':
          // The one-drop's rim: a dry knock, thrown into the echo.
          k.noise('bandpass', 2300, 1.4, t, 0.45 * v, 0.07);
          k.tone('triangle', 820, 600, t, 0.35 * v, 0.06);
          k.tone('triangle', 820, 600, t, 0.15 * v, 0.06, echoIn);
          break;
        case 'hat':
          k.noise('highpass', 8200, 0.7, t, 0.1 * v, 0.04);
          break;
        case 'bass':
          k.voice(bassBus, 'sine', n.midi, t, 0.7 * v, hold * 0.92, 0.01, 0.12);
          k.voice(bassBus, 'triangle', n.midi + 12, t, 0.12 * v, hold * 0.8, 0.01, 0.1);
          break;
        case 'skank':
          // A chop: a short square-ish chord stab, one voice per string.
          k.voice(skank, 'square', n.midi, t + (n.strum ?? 0) * 0.004, 0.2 * v, 0.06, 0.004, 0.07);
          break;
        case 'lead':
          k.voice(reed, 'sawtooth', n.midi, t, 0.3 * v, hold * 0.95, 0.07, 0.25);
          k.voice(reed, 'square', n.midi, t, 0.12 * v, hold * 0.95, 0.07, 0.25, 6);
          break;
      }
    },
  };
}

function stoner(ctx: BaseAudioContext, k: Kit): Built {
  // The fuzz: heavy asymmetric clip, a cabinet low-pass, a hall.
  const fuzzIn = ctx.createGain();
  fuzzIn.gain.value = 0.6;
  const shaper = ctx.createWaveShaper();
  shaper.curve = shaperCurve(16, 0.25);
  const cab = k.filter('lowpass', 3000, 0.8);
  const hall = k.send(0.5);
  fuzzIn
    .connect(k.filter('highpass', 80))
    .connect(shaper)
    .connect(cab)
    .connect(k.filter('peaking', 500, 1, 4))
    .connect(k.gain(0.3));
  cab.connect(hall);
  // The wah: a bandpass swept by a slow LFO on the lead only.
  const wahIn = ctx.createGain();
  const wah = k.filter('bandpass', 1000, 4);
  const sweep = ctx.createOscillator();
  sweep.frequency.value = 1.3;
  const sweepDepth = ctx.createGain();
  sweepDepth.gain.value = 650;
  sweep.connect(sweepDepth).connect(wah.frequency);
  sweep.start();
  const wahShaper = ctx.createWaveShaper();
  wahShaper.curve = shaperCurve(9, 0.2);
  wahIn.connect(wahShaper).connect(wah).connect(k.gain(0.5));
  wah.connect(hall);
  const bassIn = ctx.createGain();
  const bassFuzz = ctx.createWaveShaper();
  bassFuzz.curve = shaperCurve(5);
  bassIn.connect(bassFuzz).connect(k.filter('lowpass', 700)).connect(k.gain(0.85));
  k.drums.connect(hall);
  hall.connect(k.room(0.3, 2, 0.6));
  return {
    timbres: { rhythm: 'drive', lead: 'drive', bass: 'bass' },
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          k.tone('sine', 95, 38, t, 1.0 * v, 0.36);
          k.noise('highpass', 2200, 0.7, t, 0.1 * v, 0.01);
          break;
        case 'snare':
          k.noise('bandpass', 1500, 0.6, t, 0.65 * v, 0.28);
          k.tone('triangle', 170, 130, t, 0.4 * v, 0.1);
          break;
        case 'hat':
          k.noise('highpass', 7000, 0.7, t, 0.1 * v, 0.07);
          break;
        case 'crash':
          k.noise('highpass', 3800, 0.7, t, 0.25 * v, 1.8);
          break;
        case 'tom': {
          const f = midiHz(n.midi);
          k.tone('sine', f, f * 0.6, t, 0.8 * v, 0.32);
          break;
        }
        case 'bass':
          k.pluck(bassIn, k.buffer(n.midi, 'bass'), t, 0.95 * v, hold * 0.95, 0.08);
          break;
        case 'rhythm':
          k.pluck(fuzzIn, k.buffer(n.midi, 'drive'), t + (n.strum ?? 0) * 0.005, 0.5 * v, hold * 0.95, 0.35);
          break;
        case 'lead':
          k.pluck(wahIn, k.buffer(n.midi, 'drive'), t, 0.8 * v, hold * 0.95, 0.25, n.slide ?? 0);
          break;
      }
    },
  };
}

function ambient(ctx: BaseAudioContext, k: Kit): Built {
  const hallIn = k.send(0.85);
  hallIn.connect(k.room(0.6, 3, 0.7));
  const echoIn = k.send(0.4);
  echoIn.connect(k.echo(0.52, 0.5, 2200, 0.6));
  const pad = ctx.createGain();
  pad.connect(k.filter('lowpass', 1500, 0.6)).connect(k.gain(0.22));
  pad.connect(hallIn);
  const bell = k.gain(0.35);
  bell.connect(hallIn);
  bell.connect(echoIn);
  const air = ctx.createGain();
  air.connect(k.gain(0.4));
  air.connect(hallIn);
  const droneBus = k.gain(0.5);
  return {
    timbres: {},
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'bass':
          k.voice(droneBus, 'sine', n.midi, t, 0.6 * v, hold, 1.1, 1.6);
          break;
        case 'pad':
          k.voice(pad, 'triangle', n.midi, t, 0.3 * v, hold, 1.2, 2.2, -7);
          k.voice(pad, 'triangle', n.midi, t, 0.3 * v, hold, 1.2, 2.2, 7);
          break;
        case 'glock': {
          // A struck bell: a long fundamental and two inharmonic partials that die sooner.
          const f = midiHz(n.midi);
          k.tone('sine', f, f, t, 0.5 * v, 2.6, bell);
          k.tone('sine', f * 2.76, f * 2.76, t, 0.12 * v, 1.1, bell);
          k.tone('sine', f * 5.4, f * 5.4, t, 0.04 * v, 0.5, bell);
          break;
        }
        case 'lead': {
          // A breathy line: a soft tone and a breath of filtered noise, leaning in from below.
          k.voice(air, 'sine', n.midi, t, 0.35 * v, hold * 0.9, 0.8, 1.4, 0, n.slide ?? 0);
          k.voice(air, 'triangle', n.midi + 12, t, 0.08 * v, hold * 0.9, 0.9, 1.4);
          k.noise('bandpass', midiHz(n.midi + 12), 2, t, 0.05 * v, hold, 0.8, air);
          break;
        }
      }
    },
  };
}

function funk(ctx: BaseAudioContext, k: Kit): Built {
  const roomIn = k.send(0.5);
  k.drums.connect(roomIn);
  roomIn.connect(k.room(0.2));
  // Slap bass: a lowpass with a presence bump, an octave pop through a clipper.
  const bass = ctx.createGain();
  bass
    .connect(k.filter('lowpass', 1400))
    .connect(k.filter('peaking', 1800, 1.2, 4))
    .connect(k.gain(0.85));
  // Chicken scratch: a bandpass over a clean guitar, the closed-wah of a funk rhythm part.
  const scratch = ctx.createGain();
  scratch
    .connect(k.filter('highpass', 600))
    .connect(k.filter('bandpass', 1900, 1.6))
    .connect(k.gain(0.9));
  scratch.connect(roomIn);
  const horns = ctx.createGain();
  horns.connect(k.gain(0.28));
  horns.connect(roomIn);
  return {
    timbres: { rhythm: 'clean', bass: 'bass' },
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          k.tone('sine', 125, 52, t, 1.0 * v, 0.17);
          k.noise('lowpass', 900, 0.8, t, 0.2 * v, 0.03);
          break;
        case 'snare':
          k.noise('bandpass', 2100, 0.7, t, 0.55 * v, 0.14);
          k.tone('triangle', 210, 170, t, 0.35 * v, 0.07);
          break;
        case 'hat':
          k.noise('highpass', 8800, 0.7, t, 0.11 * v, 0.03);
          break;
        case 'openhat':
          k.noise('highpass', 7000, 0.7, t, 0.13 * v, 0.22);
          break;
        case 'tom': {
          const f = midiHz(n.midi);
          k.tone('sine', f, f * 0.7, t, 0.7 * v, 0.2);
          break;
        }
        case 'bass':
          // The low notes ring; the octave pops (a short, bright note) are clicks with a body.
          if (n.len <= 1 && v < 0.7) {
            k.pluck(bass, k.buffer(n.midi, 'bass'), t, 0.7 * v, 0.04, 0.05);
            k.noise('bandpass', 2400, 1.5, t, 0.12 * v, 0.02, 0, bass);
          } else k.pluck(bass, k.buffer(n.midi, 'bass'), t, 0.95 * v, hold * 0.8, 0.06);
          break;
        case 'rhythm':
          k.pluck(scratch, k.buffer(n.midi, 'clean'), t + (n.strum ?? 0) * 0.004, 0.6 * v, 0.035, 0.03);
          break;
        case 'stab': {
          // A horn: two detuned saws through a low-pass that opens on the hit and closes.
          const lp = k.filter('lowpass', 900, 1);
          lp.frequency.setValueAtTime(900, t);
          lp.frequency.linearRampToValueAtTime(3200, t + 0.04);
          lp.frequency.setTargetAtTime(1800, t + 0.05, 0.12);
          lp.connect(horns);
          k.voice(lp, 'sawtooth', n.midi, t, 0.12 * v, hold * 0.9, 0.012, 0.05, -6);
          k.voice(lp, 'sawtooth', n.midi, t, 0.12 * v, hold * 0.9, 0.012, 0.05, 6);
          break;
        }
      }
    },
  };
}

function chip(ctx: BaseAudioContext, k: Kit): Built {
  const crush = ctx.createWaveShaper();
  crush.curve = crushCurve(7);
  const pulse25 = pulseWave(ctx, 0.25);
  const pulse125 = pulseWave(ctx, 0.125);
  const lead = ctx.createGain();
  lead.connect(crush);
  const arp = ctx.createGain();
  arp.connect(crush);
  crush.connect(k.filter('lowpass', 7500)).connect(k.gain(0.22));
  const bassBus = k.gain(0.5);
  // A little vibrato on a held lead note, as a console does: a sine of detune, from a curve.
  const vibCycles = 5.5;
  const vibCurve = new Float32Array(32);
  return {
    timbres: {},
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          k.tone('triangle', 150, 42, t, 0.95 * v, 0.13);
          break;
        case 'snare':
          k.noise('bandpass', 3200, 0.8, t, 0.35 * v, 0.1);
          break;
        case 'hat':
          k.noise('highpass', 9500, 0.7, t, 0.07 * v, 0.025);
          break;
        case 'bass':
          k.voice(bassBus, 'triangle', n.midi, t, 0.75 * v, hold * 0.9, 0.004, 0.03);
          break;
        case 'arp':
          k.voice(arp, pulse25, n.midi, t, 0.4 * v, hold * 0.8, 0.002, 0.03);
          break;
        case 'lead': {
          const o = k.voice(lead, pulse125, n.midi, t, 0.5 * v, hold * 0.95, 0.004, 0.05);
          const vibS = hold - 0.12;
          if (vibS > 0.1) {
            for (let i = 0; i < vibCurve.length; i++) {
              vibCurve[i] = 12 * Math.sin((2 * Math.PI * vibCycles * vibS * i) / (vibCurve.length - 1));
            }
            o.detune.setValueCurveAtTime(vibCurve, t + 0.12, vibS);
          }
          break;
        }
      }
    },
  };
}

export function createMoreRig(ctx: BaseAudioContext, out: AudioNode, genre: MoreGenre): RadioRig {
  const k = createKit(ctx, out);
  const built = { island, dub, stoner, ambient, funk, chip }[genre](ctx, k);
  const trim = MORE_TRIM[genre];
  return {
    genre,
    prepare(notes) {
      for (const n of notes) {
        const timbre = built.timbres[n.layer];
        if (timbre) k.buffer(n.midi, timbre);
      }
    },
    setLevel: (level, at) => k.setLevel(level, at, trim),
    setFx: (scale) => k.setFx(scale),
    play(note, t, stepS) {
      built.onTempo?.(stepS);
      built.play(note, t, stepS);
    },
  };
}
