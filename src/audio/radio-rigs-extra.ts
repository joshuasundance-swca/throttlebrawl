// The rigs for the four bands of playtest 4 (radio-compose-extra.ts; P4-17). Each genre sounds like
// itself, not like the bands before it:
// - garage: a fuzz-box guitar (bright, splatty, not grunge's heavy wall) through a small amp and a
//   slapback, a combo organ (a reedy square through a wobbling short delay, its vibrato), a trashy
//   kit with a tambourine and a floor tom;
// - darkwave: rain on the glass (a filtered noise bed and drops), a string-machine pad, a glassy FM
//   electric piano, a sequencer bass whose filter opens with the velocity, a drum machine with a
//   gated snare, a soft pulse lead and a glassy arpeggio into a dotted-eighth echo and a long hall;
// - swamp: a twangy guitar through a tremolo locked to the triplets, a slide guitar (long glides into
//   each note) into a slapback, a harmonica (reedy, bent, a breath on the attack), a washboard, a
//   foot stomp and an upright bass, in a small room;
// - jazz: a ride cymbal with its ping, a hat's chick, a soft kit, an upright bass, an FM electric
//   piano comping, and a muted horn (a buzzy reed through a cup mute's band-pass) in a small room.
// The primitives are radio-rig-kit.ts's; each note is one to three sources and a gain, so the cost
// on a phone stays near the other bands'.
import { createKit, midiHz, shaperCurve, type Kit } from './radio-rig-kit';
import type { RadioNote } from './radio-compose';
import type { ExtraGenre } from './radio-genres';
import type { RadioRig, Timbre } from './radio-synth';

export { EXTRA_GENRES, type ExtraGenre } from './radio-genres';

/**
 * Each rig's output trim, [default], set so every band plays at about the others' loudness (measured
 * offline; tests/e2e/audio-radio.spec.ts checks every band within 3.5 dB of the others).
 */
export const EXTRA_TRIM: Readonly<Record<ExtraGenre, number>> = {
  garage: 0.8,
  darkwave: 1,
  swamp: 1.1,
  jazz: 0.87,
};

type Play = (n: RadioNote, t: number, stepS: number) => void;
interface Built {
  play: Play;
  timbres: Partial<Record<RadioNote['layer'], Timbre>>;
  onTempo?: (stepS: number) => void;
}

/** An LFO into a param: `rate` Hz, `depth` around the param's own value. */
export function lfo(ctx: BaseAudioContext, param: AudioParam, rate: number, depth: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.frequency.value = rate;
  const d = ctx.createGain();
  d.gain.value = depth;
  o.connect(d).connect(param);
  o.start();
  return o;
}

/** A two-operator FM electric piano note: a sine carrier, a sine modulator whose index decays. */
export function fmKeys(
  k: Kit,
  ctx: BaseAudioContext,
  dest: AudioNode,
  midi: number,
  t: number,
  level: number,
  hold: number,
  bright: number,
) {
  const f = midiHz(midi);
  const car = ctx.createOscillator();
  car.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.frequency.value = f;
  const index = ctx.createGain();
  index.gain.setValueAtTime(f * bright, t);
  index.gain.exponentialRampToValueAtTime(Math.max(1, f * bright * 0.12), t + 0.5);
  mod.connect(index).connect(car.frequency);
  const ring = Math.min(2.4, hold + 0.6);
  car.connect(k.env(dest, t, level, ring, 0.004));
  car.start(t);
  mod.start(t);
  car.stop(t + ring + 0.03);
  mod.stop(t + ring + 0.03);
}

function garage(ctx: BaseAudioContext, k: Kit): Built {
  const roomIn = k.send(0.45);
  roomIn.connect(k.room(0.22));
  k.drums.connect(roomIn);
  // The fuzz box: a hard, splatty clip, then a small amp: bright, mid-forward, no big low end.
  const fuzzIn = ctx.createGain();
  fuzzIn.gain.value = 0.7;
  const fuzz = ctx.createWaveShaper();
  fuzz.curve = shaperCurve(5, 0.35);
  const amp = k.filter('lowpass', 4200, 0.9);
  fuzzIn
    .connect(k.filter('highpass', 160))
    .connect(fuzz)
    .connect(k.filter('peaking', 1500, 0.8, 5))
    .connect(amp)
    .connect(k.gain(0.3));
  const slap = k.send(0.3);
  amp.connect(slap).connect(k.echo(0.095, 0.15, 3000, 0.6));
  amp.connect(roomIn);
  // The combo organ: a reedy wave (odd harmonics strong, a bright octave on top), through a short
  // delay whose time wobbles (its vibrato).
  const partials = [0, 1, 0.35, 0.45, 0.1, 0.25, 0.05, 0.16, 0, 0.1];
  const combo = ctx.createPeriodicWave(new Float32Array(partials.length), new Float32Array(partials));
  const organIn = ctx.createGain();
  const vib = ctx.createDelay(0.05);
  vib.delayTime.value = 0.006;
  lfo(ctx, vib.delayTime, 6.2, 0.0018);
  organIn.connect(k.filter('lowpass', 3800)).connect(vib).connect(k.gain(0.16));
  vib.connect(roomIn);
  const bass = ctx.createGain();
  bass.connect(k.filter('lowpass', 1100)).connect(k.gain(0.85));
  return {
    timbres: { rhythm: 'twang', lead: 'twang', bass: 'bass' },
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          k.tone('sine', 115, 46, t, 0.95 * v, 0.2);
          k.noise('highpass', 2600, 0.7, t, 0.1 * v, 0.012);
          break;
        case 'snare':
          k.noise('bandpass', 2200, 0.6, t, 0.62 * v, 0.17);
          k.tone('triangle', 220, 180, t, 0.3 * v, 0.07);
          break;
        case 'hat':
          k.noise('highpass', 8000, 0.7, t, 0.11 * v, 0.045);
          break;
        case 'crash':
          k.noise('highpass', 3600, 0.7, t, 0.24 * v, 1.3);
          break;
        case 'tamb':
          // One shake: the jingles' band, a little ring (one source, as it shakes sixteenths).
          k.noise('bandpass', 8500, 1.6, t, 0.16 * v, 0.08);
          break;
        case 'tom': {
          const f = midiHz(n.midi);
          k.tone('sine', f, f * 0.66, t, 0.75 * v, 0.24);
          break;
        }
        case 'bass':
          k.pluck(bass, k.buffer(n.midi, 'bass'), t, 0.9 * v, hold * 0.85, 0.05);
          break;
        case 'rhythm':
          k.pluck(
            fuzzIn,
            k.buffer(n.midi, 'twang'),
            t + (n.strum ?? 0) * 0.006,
            0.45 * v,
            hold * 0.9,
            n.len > 2 ? 0.3 : 0.04,
          );
          break;
        case 'lead':
          k.pluck(fuzzIn, k.buffer(n.midi, 'twang'), t, 0.75 * v, hold * 0.95, 0.12, n.slide ?? 0);
          break;
        case 'organ':
          k.voice(organIn, combo, n.midi, t, 0.32 * v, hold * 0.92, 0.006, 0.05);
          break;
      }
    },
  };
}

function darkwave(ctx: BaseAudioContext, k: Kit): Built {
  const hallIn = k.send(0.55);
  hallIn.connect(k.room(0.4, 2.6, 0.68));
  const echoIn = k.send(0.32);
  const echoLine = k.echo(0.4, 0.42, 2600, 0.55);
  echoIn.connect(echoLine);
  let lastStepS = 0;
  const pad = ctx.createGain();
  pad.connect(k.filter('lowpass', 1500, 0.6)).connect(k.gain(0.2));
  pad.connect(hallIn);
  const keys = k.gain(0.3);
  keys.connect(hallIn);
  keys.connect(echoIn);
  const lead = ctx.createGain();
  lead.connect(k.filter('lowpass', 2400)).connect(k.gain(0.22));
  lead.connect(echoIn);
  lead.connect(hallIn);
  const arp = k.gain(0.16);
  arp.connect(echoIn);
  const bassBus = k.gain(0.5);
  const rain = ctx.createGain();
  rain.connect(k.gain(0.5));
  rain.connect(hallIn);
  // The gated snare's room: a short burst of the hall, cut hard.
  k.drums.connect(hallIn);
  return {
    timbres: {},
    onTempo(stepS) {
      // The echo locks to a dotted eighth (three sixteenths) of the song's tempo.
      if (stepS !== lastStepS) {
        lastStepS = stepS;
        echoLine.delayTime.setValueAtTime(Math.min(1.9, 3 * stepS), ctx.currentTime);
      }
    },
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'rain':
          if (n.midi === 0) {
            // The bed: soft hiss through a band, fading in and out over the bar.
            k.noise('bandpass', 5200, 0.5, t, 0.05 * v, hold, hold * 0.4, rain);
          } else {
            // A drop: a tiny, pitched tick.
            k.noise('bandpass', midiHz(n.midi), 9, t, 0.22 * v, 0.03, 0, rain);
          }
          break;
        case 'pad':
          k.voice(pad, 'sawtooth', n.midi, t, 0.22 * v, hold, 0.6, 1.2, -9);
          k.voice(pad, 'sawtooth', n.midi, t, 0.22 * v, hold, 0.6, 1.2, 9);
          break;
        case 'ep':
          fmKeys(k, ctx, keys, n.midi, t, 0.4 * v, hold, 1.6);
          break;
        case 'bass': {
          // A saw through a resonant low-pass that snaps shut; the velocity opens it.
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = midiHz(n.midi);
          const top = 300 + 2600 * v * v;
          const lp = k.filter('lowpass', top, 6);
          lp.frequency.setValueAtTime(top, t);
          lp.frequency.exponentialRampToValueAtTime(180, t + Math.max(0.06, hold * 0.9));
          o.connect(lp).connect(k.env(bassBus, t, 0.5, Math.max(0.06, hold * 0.95)));
          o.start(t);
          o.stop(t + hold + 0.03);
          break;
        }
        case 'kick':
          k.tone('sine', 140, 40, t, 1.0 * v, 0.34);
          break;
        case 'snare':
          // Gated: a noise burst held flat, then cut, with a body underneath.
          k.noise('bandpass', 1500, 0.5, t, 0.4 * v, 0.03);
          k.noise('bandpass', 2400, 0.4, t + 0.01, 0.28 * v, 0.17, 0.005);
          k.tone('triangle', 200, 150, t, 0.3 * v, 0.08);
          break;
        case 'hat':
          k.noise('highpass', 9000, 0.7, t, 0.1 * v, 0.03);
          break;
        case 'openhat':
          k.noise('highpass', 7500, 0.7, t, 0.12 * v, 0.25);
          break;
        case 'crash':
          k.noise('highpass', 4500, 0.7, t, 0.2 * v, 1.4);
          break;
        case 'lead':
          k.voice(lead, 'square', n.midi, t, 0.3 * v, hold * 0.95, 0.03, 0.3, 0, n.slide ?? 0);
          k.voice(lead, 'triangle', n.midi + 12, t, 0.1 * v, hold * 0.95, 0.03, 0.3);
          break;
        case 'arp':
          k.voice(arp, 'sine', n.midi, t, 0.4 * v, hold * 0.6, 0.003, 0.12);
          k.voice(arp, 'sine', n.midi + 12, t, 0.12 * v, hold * 0.4, 0.003, 0.08);
          break;
      }
    },
  };
}

function swamp(ctx: BaseAudioContext, k: Kit): Built {
  const roomIn = k.send(0.5);
  roomIn.connect(k.room(0.3, 1.4, 0.6));
  k.drums.connect(roomIn);
  // The tremolo guitar: a gain pulsed by an LFO the tempo sets (one pulse per triplet).
  const trem = ctx.createGain();
  trem.gain.value = 0.6;
  const tremLfo = lfo(ctx, trem.gain, 4.5, 0.38);
  const guitar = ctx.createGain();
  guitar
    .connect(k.filter('highpass', 150))
    .connect(k.filter('peaking', 2600, 0.9, 5))
    .connect(trem);
  trem.connect(k.gain(0.55));
  trem.connect(roomIn);
  // The slide: a little drive and a slapback.
  const slideIn = ctx.createGain();
  const drive = ctx.createWaveShaper();
  drive.curve = shaperCurve(2.2);
  const slideOut = k.gain(0.42);
  slideIn
    .connect(k.filter('highpass', 180))
    .connect(drive)
    .connect(k.filter('lowpass', 3600))
    .connect(slideOut);
  const slap = k.send(0.35);
  slideOut.connect(slap).connect(k.echo(0.11, 0.18, 3000, 0.7));
  slideOut.connect(roomIn);
  // The harmonica: a reedy pair through the cupped hands' band-pass.
  const harp = ctx.createGain();
  harp
    .connect(k.filter('bandpass', 1300, 0.9))
    .connect(k.filter('peaking', 2400, 1.2, 5))
    .connect(k.gain(0.5));
  harp.connect(roomIn);
  const bass = ctx.createGain();
  bass.connect(k.filter('lowpass', 900)).connect(k.gain(0.9));
  let lastStepS = 0;
  return {
    timbres: { rhythm: 'twang', lead: 'twang', bass: 'upright' },
    onTempo(stepS) {
      if (stepS !== lastStepS) {
        lastStepS = stepS;
        tremLfo.frequency.setValueAtTime(1 / stepS, ctx.currentTime);
      }
    },
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          // A foot stomp on boards: a low thud and a little wood.
          k.tone('sine', 90, 46, t, 0.95 * v, 0.22);
          k.noise('lowpass', 380, 0.8, t, 0.35 * v, 0.06);
          break;
        case 'snare':
          k.noise('bandpass', 1800, 0.6, t, 0.42 * v, 0.16, 0.01);
          k.tone('triangle', 190, 160, t, 0.22 * v, 0.06);
          break;
        case 'scrape':
          // A washboard: a thimble's tick and a short rasp.
          k.noise('bandpass', 4200, 1.2, t, 0.2 * v, 0.02);
          k.noise('highpass', 6000, 0.7, t + 0.012, 0.1 * v, 0.05, 0.01);
          break;
        case 'bass':
          k.pluck(bass, k.buffer(n.midi, 'upright'), t, 0.95 * v, hold * 0.9, 0.08);
          break;
        case 'rhythm':
          k.pluck(guitar, k.buffer(n.midi, 'twang'), t + (n.strum ?? 0) * 0.012, 0.42 * v, hold * 0.95, 0.35);
          break;
        case 'lead': {
          // The bottleneck: a slow glide into the note.
          const src = ctx.createBufferSource();
          src.buffer = k.buffer(n.midi, 'twang');
          const from = 2 ** ((n.slide ?? 0) / 12);
          src.playbackRate.setValueAtTime(from, t);
          src.playbackRate.linearRampToValueAtTime(1, t + Math.min(0.22, hold * 0.5));
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.75 * v, t);
          g.gain.setTargetAtTime(0.0001, t + hold, 0.06);
          src.connect(g).connect(slideIn);
          src.start(t);
          src.stop(t + hold + 0.2);
          break;
        }
        case 'harp': {
          // A reed: a saw and a square a hair apart, bending up from below; a breath on the attack.
          k.voice(harp, 'sawtooth', n.midi, t, 0.28 * v, hold * 0.95, 0.025, 0.08, 0, n.slide ?? 0);
          k.voice(harp, 'square', n.midi, t, 0.12 * v, hold * 0.95, 0.025, 0.08, 7, n.slide ?? 0);
          if (n.len >= 2) k.noise('bandpass', 1800, 1.5, t, 0.08 * v, 0.06, 0.01, harp);
          break;
        }
      }
    },
  };
}

function jazz(ctx: BaseAudioContext, k: Kit): Built {
  const roomIn = k.send(0.45);
  roomIn.connect(k.room(0.25, 1.6, 0.62));
  k.drums.connect(roomIn);
  const keys = k.gain(0.32);
  keys.connect(roomIn);
  // The muted horn: a buzzy reed through a cup mute's band-pass and a little brass bite.
  const horn = ctx.createGain();
  horn
    .connect(k.filter('highpass', 380))
    .connect(k.filter('bandpass', 1250, 1.1))
    .connect(k.filter('peaking', 2600, 1.5, 6))
    .connect(k.gain(0.75));
  horn.connect(roomIn);
  const bass = ctx.createGain();
  bass.connect(k.filter('lowpass', 1000)).connect(k.gain(0.95));
  bass.connect(roomIn);
  return {
    timbres: { bass: 'upright' },
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'ride':
          // The stick on the bow, the ping, and the wash under it.
          k.noise('bandpass', 7000, 1.4, t, 0.1 * v, 0.4);
          k.tone('sine', 2600, 2600, t, 0.035 * v, 0.35);
          k.tone('sine', 3910, 3910, t, 0.015 * v, 0.25);
          break;
        case 'hat':
          // The foot: a closed chick.
          k.noise('bandpass', 5200, 1.1, t, 0.12 * v, 0.03);
          break;
        case 'kick':
          k.tone('sine', 95, 50, t, 0.8 * v, 0.2);
          break;
        case 'snare':
          k.noise('bandpass', 1900, 0.7, t, 0.5 * v, 0.12);
          k.tone('triangle', 200, 170, t, 0.25 * v, 0.06);
          break;
        case 'bass':
          k.pluck(bass, k.buffer(n.midi, 'upright'), t, 1.0 * v, hold * 0.92, 0.06);
          break;
        case 'ep':
          fmKeys(k, ctx, keys, n.midi, t, 0.32 * v, hold, 1.1);
          break;
        case 'lead': {
          k.voice(horn, 'sawtooth', n.midi, t, 0.3 * v, hold * 0.9, 0.025, 0.06);
          k.voice(horn, 'square', n.midi, t, 0.08 * v, hold * 0.9, 0.025, 0.06, 5);
          break;
        }
      }
    },
  };
}

export function createExtraRig(ctx: BaseAudioContext, out: AudioNode, genre: ExtraGenre): RadioRig {
  const k = createKit(ctx, out);
  const built = { garage, darkwave, swamp, jazz }[genre](ctx, k);
  const trim = EXTRA_TRIM[genre];
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
