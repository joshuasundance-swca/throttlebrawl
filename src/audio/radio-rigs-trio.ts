// The rigs for the three bands of playtest 4's run C (radio-compose-trio.ts; task C8, one new station
// in every region). Each genre sounds like itself, not like the bands before it:
// - son: a wooden clave, congas, a shaker and a cowbell, a round bass, a bright FM piano playing the
//   montuno, a trumpet (an open reed with a little vibrato) and brass stabs, in a small room;
// - dream: chiming strummed guitars through a chorus into a big hall, a shimmering arpeggio and a
//   slow detuned pad into a dotted-eighth echo, a soaring lead guitar that bends into its notes, a
//   tight motorik kit and a bass in eighths;
// - beats: an 808 kick and a sub bass that glides, a snare and a clap, tight hats, a Rhodes (soft FM)
//   in a small room, and a sine whistle that glides, in a tempo-free echo.
// The primitives are radio-rig-kit.ts's; each note is one to three sources and a gain, so the cost
// on a phone stays near the other bands'.
import { createKit, midiHz, shaperCurve, type Kit } from './radio-rig-kit';
import type { RadioNote } from './radio-compose';
import type { TrioGenre } from './radio-genres';
import { fmKeys, lfo } from './radio-rigs-extra';
import type { RadioRig, Timbre } from './radio-synth';

export { TRIO_GENRES, type TrioGenre } from './radio-genres';

/**
 * Each rig's output trim, [default], set so every band plays at about the others' loudness, from the
 * first eight seconds (what tests/e2e/audio-radio.spec.ts measures, within 3.5 dB of the others) to
 * the whole song: the parts' own levels below carry most of it, so the trims stay near 1.
 */
export const TRIO_TRIM: Readonly<Record<TrioGenre, number>> = {
  son: 1,
  dream: 1,
  beats: 1.1,
};

type Play = (n: RadioNote, t: number, stepS: number) => void;
interface Built {
  play: Play;
  timbres: Partial<Record<RadioNote['layer'], Timbre>>;
  onTempo?: (stepS: number) => void;
}

function son(ctx: BaseAudioContext, k: Kit): Built {
  const roomIn = k.send(0.4);
  roomIn.connect(k.room(0.22, 1.2, 0.5));
  k.drums.connect(roomIn);
  const keys = k.gain(1.0);
  keys.connect(roomIn);
  // The brass: a bright reed through a band-pass and a little bite, thrown into the room.
  const brass = ctx.createGain();
  brass
    .connect(k.filter('bandpass', 1700, 0.8))
    .connect(k.filter('peaking', 2800, 1.2, 5))
    .connect(k.gain(1.0));
  brass.connect(roomIn);
  // The trumpet: the same reed with a breath of vibrato on its gain.
  const trumpet = ctx.createGain();
  trumpet.gain.value = 0.8;
  lfo(ctx, trumpet.gain, 5.4, 0.12);
  trumpet
    .connect(k.filter('highpass', 300))
    .connect(k.filter('peaking', 2200, 1.1, 5))
    .connect(k.gain(0.8));
  trumpet.connect(roomIn);
  const bass = ctx.createGain();
  bass.connect(k.filter('lowpass', 900)).connect(k.gain(1.1));
  return {
    timbres: { bass: 'bass' },
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'clave':
          // Two sticks of hardwood: a short, high, dry knock.
          k.tone('sine', 2500, 2350, t, 1.7 * v, 0.06);
          k.noise('bandpass', 3200, 2, t, 0.5 * v, 0.02);
          break;
        case 'conga': {
          // Two drums: a deep one (midi 60) and a bright one (midi 72), a slap on the strong hits.
          const f = n.midi >= 66 ? 330 : 200;
          k.tone('sine', f * 1.18, f, t, 1.4 * v, n.midi >= 66 ? 0.12 : 0.18);
          k.noise('bandpass', 1900, 1.2, t, 0.5 * v * (v > 0.7 ? 1 : 0.4), 0.03);
          break;
        }
        case 'tamb':
          // A shaker: a grain of seeds, short.
          k.noise('highpass', 6000, 0.7, t, 0.9 * v, 0.06);
          break;
        case 'bell':
          // The cowbell: two inharmonic squares through a band-pass, a short ring.
          k.tone('square', 560, 560, t, 0.7 * v, 0.14, k.drums);
          k.tone('square', 845, 845, t, 0.5 * v, 0.1, k.drums);
          break;
        case 'bass':
          k.pluck(bass, k.buffer(n.midi, 'bass'), t, 0.9 * v, hold * 0.85, 0.07);
          break;
        case 'ep':
          // The piano: bright and percussive, a short ring.
          fmKeys(k, ctx, keys, n.midi, t, 0.55 * v, hold, 1.5);
          break;
        case 'stab':
          k.voice(brass, 'sawtooth', n.midi, t, 0.2 * v, hold * 0.9, 0.012, 0.08);
          k.voice(brass, 'square', n.midi, t, 0.06 * v, hold * 0.9, 0.012, 0.08, 6);
          break;
        case 'lead':
          k.voice(trumpet, 'sawtooth', n.midi, t, 0.26 * v, hold * 0.95, 0.02, 0.08, 0, n.slide ?? 0);
          k.voice(trumpet, 'square', n.midi, t, 0.08 * v, hold * 0.95, 0.02, 0.08, 5, n.slide ?? 0);
          break;
      }
    },
  };
}

function dream(ctx: BaseAudioContext, k: Kit): Built {
  const hallIn = k.send(0.55);
  hallIn.connect(k.room(0.4, 2.8, 0.7));
  const echoIn = k.send(0.3);
  const echoLine = k.echo(0.4, 0.4, 2800, 0.5);
  echoIn.connect(echoLine);
  let lastStepS = 0;
  k.drums.connect(hallIn);
  // The guitars: a short delay whose time wobbles (a chorus), a high-pass and a little sparkle, into the
  // hall and the echo.
  const chorusIn = ctx.createGain();
  const chorus = ctx.createDelay(0.05);
  chorus.delayTime.value = 0.013;
  lfo(ctx, chorus.delayTime, 0.7, 0.004);
  const guitars = k.gain(0.5);
  chorusIn
    .connect(k.filter('highpass', 200))
    .connect(k.filter('peaking', 3200, 0.8, 4))
    .connect(guitars);
  chorusIn.connect(chorus).connect(guitars);
  guitars.connect(hallIn);
  const lead = ctx.createGain();
  const drive = ctx.createWaveShaper();
  drive.curve = shaperCurve(1.6);
  lead.connect(k.filter('highpass', 250)).connect(drive).connect(k.gain(0.45));
  lead.connect(hallIn);
  lead.connect(echoIn);
  const pad = ctx.createGain();
  pad.connect(k.filter('lowpass', 1800, 0.6)).connect(k.gain(0.18));
  pad.connect(hallIn);
  const arp = k.gain(0.2);
  arp.connect(hallIn);
  arp.connect(echoIn);
  const bass = ctx.createGain();
  bass.connect(k.filter('lowpass', 1000)).connect(k.gain(0.85));
  return {
    timbres: { rhythm: 'clean', lead: 'drive', bass: 'bass' },
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
        case 'kick':
          k.tone('sine', 120, 46, t, 0.95 * v, 0.24);
          k.noise('highpass', 2600, 0.7, t, 0.08 * v, 0.012);
          break;
        case 'snare':
          k.noise('bandpass', 2100, 0.6, t, 0.55 * v, 0.2);
          k.tone('triangle', 210, 170, t, 0.28 * v, 0.07);
          break;
        case 'hat':
          k.noise('highpass', 8500, 0.7, t, 0.1 * v, 0.04);
          break;
        case 'openhat':
          k.noise('highpass', 7500, 0.7, t, 0.12 * v, 0.22);
          break;
        case 'crash':
          k.noise('highpass', 4000, 0.7, t, 0.22 * v, 1.5);
          break;
        case 'bass':
          k.pluck(bass, k.buffer(n.midi, 'bass'), t, 0.9 * v, hold * 0.85, 0.05);
          break;
        case 'rhythm':
          // A strummed chord with its notes a hair apart, left to ring.
          k.pluck(
            chorusIn,
            k.buffer(n.midi, 'clean'),
            t + (n.strum ?? 0) * 0.008,
            0.4 * v,
            hold * 0.95,
            0.35,
          );
          break;
        case 'lead':
          // A lead guitar: a long note that bends up into its pitch.
          k.pluck(lead, k.buffer(n.midi, 'drive'), t, 0.6 * v, hold * 0.95, 0.25, n.slide ?? 0);
          break;
        case 'pad':
          k.voice(pad, 'sawtooth', n.midi, t, 0.22 * v, hold, 0.7, 1.2, -8);
          k.voice(pad, 'sawtooth', n.midi, t, 0.22 * v, hold, 0.7, 1.2, 8);
          break;
        case 'arp':
          // A glassy shimmer: a sine and its octave, ringing into the hall and the echo.
          k.voice(arp, 'sine', n.midi, t, 0.4 * v, hold * 0.7, 0.004, 0.2);
          k.voice(arp, 'sine', n.midi + 12, t, 0.12 * v, hold * 0.5, 0.004, 0.14);
          break;
      }
    },
  };
}

function beats(ctx: BaseAudioContext, k: Kit): Built {
  const roomIn = k.send(0.4);
  roomIn.connect(k.room(0.2, 1.4, 0.55));
  k.drums.connect(roomIn);
  // The Rhodes: soft FM through a warm low-pass, a short room.
  const keys = ctx.createGain();
  keys.connect(k.filter('lowpass', 3600)).connect(k.gain(0.6));
  keys.connect(roomIn);
  // The 808: a sine that glides, with a little drive so a phone's speaker hears its harmonics.
  const subIn = ctx.createGain();
  const warm = ctx.createWaveShaper();
  warm.curve = shaperCurve(1.8);
  subIn.connect(warm).connect(k.filter('lowpass', 700)).connect(k.gain(0.5));
  // The whistle: a sine with a breath of vibrato, a short echo behind it.
  const whistleIn = ctx.createGain();
  whistleIn.gain.value = 0.8;
  lfo(ctx, whistleIn.gain, 5.6, 0.1);
  const whistle = k.gain(0.4);
  whistleIn.connect(whistle);
  const echoIn = k.send(0.35);
  whistle.connect(echoIn).connect(k.echo(0.33, 0.35, 2600, 0.5));
  whistle.connect(roomIn);
  return {
    timbres: {},
    play(n, t, stepS) {
      const v = n.vel;
      const hold = n.len * stepS;
      switch (n.layer) {
        case 'kick':
          // An 808 kick: a long sine that drops from a click to its sub.
          k.tone('sine', 150, 48, t, 1.0 * v, 0.42);
          break;
        case 'snare':
          k.noise('bandpass', 1900, 0.6, t, 0.9 * v, 0.15);
          k.tone('triangle', 200, 165, t, 0.5 * v, 0.07);
          break;
        case 'clap':
          k.clap(t, 1.6 * v);
          break;
        case 'hat':
          k.noise('highpass', 8000, 0.7, t, 0.16 * v, 0.035);
          break;
        case 'openhat':
          k.noise('highpass', 7000, 0.7, t, 0.2 * v, 0.2);
          break;
        case 'bass': {
          const f = midiHz(n.midi);
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.setValueAtTime(n.slide ? f * 2 ** (n.slide / 12) : f, t);
          if (n.slide) o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
          const body = Math.max(0.12, hold * 0.95);
          o.connect(k.env(subIn, t, 0.95 * v, body, 0.006));
          o.start(t);
          o.stop(t + body + 0.04);
          break;
        }
        case 'ep':
          fmKeys(k, ctx, keys, n.midi, t, 0.36 * v, hold, 0.9);
          break;
        case 'lead':
          k.voice(whistleIn, 'sine', n.midi, t, 0.4 * v, hold * 0.95, 0.03, 0.15, 0, n.slide ?? 0);
          k.voice(whistleIn, 'triangle', n.midi + 12, t, 0.06 * v, hold * 0.9, 0.03, 0.12);
          break;
      }
    },
  };
}

export function createTrioRig(ctx: BaseAudioContext, out: AudioNode, genre: TrioGenre): RadioRig {
  const k = createKit(ctx, out);
  const built = { son, dream, beats }[genre](ctx, k);
  const trim = TRIO_TRIM[genre];
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
