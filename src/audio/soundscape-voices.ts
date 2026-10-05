// The regional soundscape's sounds (run W-Q audio; the director that decides when is soundscape.ts).
// Everything is made in code like the rest of the mix [decided: code-made sounds first]: a bridge
// joint's two-wheel thump, a gull, a halyard's clink, a log truck's engine brake, a two-tone
// foghorn, a cable-car bell, a party street's bar music (playtest 4, P4-16: a cover band, a steel pan
// and a karaoke machine through a doorway) and the rain on the helmet. Each event is a handful of sources that stop
// themselves, started at `t` on the audio clock; the rain is one looping buffer of droplet ticks.
// They feed the effects input, so the slow-motion low-pass and the effects bus apply.
import { noiseBuffer } from './engine-patch';
import { BAR_PHRASE_S, type ScapeEvent } from './soundscape';

const SILENT = 0.0001;
/** The one-shot events' level at full (the rain has its own), measured against the engine, [default]. */
export const EVENT_LEVEL = 0.5;
/** The rain's level at full (the director's 1), under the engine and the wind: measured, [default]. */
export const RAIN_LEVEL = 0.22;
/** Most one-shot events alive at once; a burst past this is dropped, never queued. */
export const MAX_SCAPE_EVENTS = 24;

export interface ScapeVoices {
  /** Plays one event at `t` (audio clock) with `gain` on top of its own level. */
  play(e: ScapeEvent, t: number, gain: number): boolean;
  /** Aims the rain on the helmet (0..1, already scaled by the master level). */
  setRain(level: number): void;
  readonly rainLevel: () => number;
  /** Events playing now. */
  readonly active: () => number;
  stop(): void;
}

/** Droplet ticks: a few hundred a second, each a very short decaying burst, seeded. */
export function dropletBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(rate * seconds), rate);
  const data = buf.getChannelData(0);
  let s = 0x51a1e5 >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // About 260 drops a second on average, each 1 to 3 ms long, louder or softer.
  const drops = Math.floor(seconds * 260);
  for (let k = 0; k < drops; k++) {
    const at = Math.floor(next() * data.length);
    const len = Math.floor(rate * (0.001 + 0.002 * next()));
    const amp = 0.25 + 0.75 * next() ** 2;
    for (let j = 0; j < len && at + j < data.length; j++) {
      const idx = (at + j) % data.length;
      data[idx] = (data[idx] ?? 0) + amp * (next() * 2 - 1) * Math.exp((-5 * j) / len);
    }
  }
  return buf;
}

export function createScapeVoices(ctx: BaseAudioContext, out: AudioNode): ScapeVoices {
  let active = 0;
  let stopped = false;
  const live: AudioScheduledSourceNode[] = [];

  /** Counts an event until its last source ends (`onended` works on a real context and a fake). */
  const track = (last: AudioScheduledSourceNode) => {
    active++;
    live.push(last);
    last.onended = () => {
      active = Math.max(0, active - 1);
      const i = live.indexOf(last);
      if (i >= 0) live.splice(i, 1);
    };
  };

  const bus = ctx.createGain();
  bus.gain.value = EVENT_LEVEL;
  bus.connect(out);

  /** An envelope into the bus: instant or ramped rise to `peak`, exponential decay. */
  const env = (t: number, peak: number, decay: number, attack = 0, dest: AudioNode = bus) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(attack > 0 ? SILENT : Math.max(SILENT, peak), t);
    if (attack > 0) g.gain.linearRampToValueAtTime(Math.max(SILENT, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(SILENT, t + attack + decay);
    g.connect(dest);
    return g;
  };
  const tone = (
    type: OscillatorType,
    f0: number,
    f1: number,
    t: number,
    peak: number,
    decay: number,
    attack = 0,
    dest?: AudioNode,
  ) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    o.connect(env(t, peak, decay, attack, dest));
    o.start(t);
    o.stop(t + attack + decay + 0.03);
    return o;
  };
  const noise = (
    type: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    t: number,
    peak: number,
    decay: number,
    attack = 0,
    dest?: AudioNode,
  ) => {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    n.connect(f).connect(env(t, peak, decay, attack, dest));
    n.start(t, (t * 3.7) % 0.9);
    n.stop(t + attack + decay + 0.03);
    return n;
  };

  // --- The events ---------------------------------------------------------------------------

  /** A bridge joint: the front wheel's thump, then the rear wheel's `wheelGapS` later. */
  const joint = (e: Extract<ScapeEvent, { kind: 'joint' }>, t: number, g: number) => {
    const thump = (at: number, k: number) => {
      tone('sine', 78, 40, at, 0.95 * k * g, 0.11);
      noise('bandpass', 1500, 900, 1.4, at, 0.22 * k * g, 0.025);
      // A concrete "tick" under the thump, so it reads on a phone speaker.
      return noise('lowpass', 520, 260, 0.8, at, 0.45 * k * g, 0.05);
    };
    thump(t, e.level);
    track(thump(t + e.wheelGapS, 0.75 * e.level));
  };

  /** A gull: two or three gliding cries through a narrow formant. */
  const gull = (e: Extract<ScapeEvent, { kind: 'gull' }>, t: number, g: number) => {
    const cries = 2 + (Math.round(e.pitch * 10) % 2);
    let last: AudioScheduledSourceNode | null = null;
    for (let k = 0; k < cries; k++) {
      const at = t + k * 0.34;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const base = 1500 * e.pitch * (1 - 0.06 * k);
      o.frequency.setValueAtTime(base * 0.8, at);
      o.frequency.linearRampToValueAtTime(base * 1.35, at + 0.12);
      o.frequency.exponentialRampToValueAtTime(base * 0.95, at + 0.3);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2100 * e.pitch;
      band.Q.value = 3;
      o.connect(band).connect(env(at, 0.5 * e.level * g, 0.28, 0.04));
      o.start(at);
      o.stop(at + 0.36);
      last = o;
    }
    if (last) track(last);
  };

  /** A halyard against a mast: a bright ping with an inharmonic partial. */
  const halyard = (e: Extract<ScapeEvent, { kind: 'halyard' }>, t: number, g: number) => {
    // Clinks of one cluster are spread by the pitch, so the same event never stacks on one instant.
    const at = t + (e.pitch % 0.1) * 3;
    const f = 2300 * e.pitch;
    tone('sine', f, f, at, 0.3 * e.level * g, 0.1);
    const last = tone('sine', f * 2.76, f * 2.76, at, 0.1 * e.level * g, 0.05);
    track(last);
  };

  /**
   * A log truck's engine brake: a burst of rapid pops, a gated low noise that slows as the truck
   * sheds speed. Distant: the same, band-limited and quieter, as if from up the road.
   */
  const engineBrake = (e: Extract<ScapeEvent, { kind: 'engineBrake' }>, t: number, g: number) => {
    const len = e.distant ? 1.6 : 1.4;
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    n.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(e.distant ? 260 : 340, t);
    band.frequency.exponentialRampToValueAtTime(e.distant ? 170 : 220, t + len);
    band.Q.value = 1.1;
    // The gate: a square wave around 0.5, its rate sliding down from about 58 to 34 pops a second.
    const gate = ctx.createGain();
    gate.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(58, t);
    lfo.frequency.linearRampToValueAtTime(34, t + len);
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(gate.gain);
    n.connect(band)
      .connect(gate)
      .connect(env(t, 0.9 * e.level * g, len, 0.06));
    // The cylinder note under the pops.
    tone('sawtooth', 66, 44, t, 0.28 * e.level * g, len, 0.06);
    n.start(t, (t * 1.9) % 0.9);
    n.stop(t + len + 0.1);
    lfo.start(t);
    lfo.stop(t + len + 0.1);
    track(n);
  };

  /** A two-tone foghorn: a low note that falls to a lower one, each long, through a dark filter. */
  const foghorn = (e: Extract<ScapeEvent, { kind: 'foghorn' }>, t: number, g: number) => {
    const note = (at: number, hz: number, hold: number) => {
      const dark = ctx.createBiquadFilter();
      dark.type = 'lowpass';
      dark.frequency.value = 420;
      dark.Q.value = 0.9;
      const body = ctx.createGain();
      body.gain.setValueAtTime(SILENT, at);
      body.gain.linearRampToValueAtTime(0.5 * e.level * g, at + 0.3);
      body.gain.setValueAtTime(0.5 * e.level * g, at + hold);
      body.gain.exponentialRampToValueAtTime(SILENT, at + hold + 0.7);
      dark.connect(body).connect(bus);
      let main: OscillatorNode | null = null;
      for (const [type, mul] of [
        ['sawtooth', 1],
        ['square', 1.006],
        ['sine', 0.5],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz * mul;
        o.connect(dark);
        o.start(at);
        o.stop(at + hold + 0.75);
        main ??= o;
      }
      return main as OscillatorNode;
    };
    note(t, 98, 1.7);
    track(note(t + 2.3, 73.4, 2.1));
  };

  /** A cable-car bell: struck `strikes` times, a bright inharmonic clang each. */
  const bell = (e: Extract<ScapeEvent, { kind: 'bell' }>, t: number, g: number) => {
    let last: AudioScheduledSourceNode | null = null;
    for (let k = 0; k < e.strikes; k++) {
      const at = t + k * 0.17;
      const peak = 0.4 * e.level * g * (k === 0 ? 1 : 0.8);
      tone('sine', 1180, 1176, at, peak, 0.55);
      tone('sine', 2830, 2820, at, peak * 0.5, 0.35);
      last = tone('sine', 4840, 4830, at, peak * 0.28, 0.22);
      noise('highpass', 5000, 5000, 0.7, at, peak * 0.4, 0.015);
    }
    if (last) track(last);
  };

  // --- A party street's bar music -------------------------------------------------------------
  // One phrase (BAR_PHRASE_S, four beats) of a bar's music, heard through an open front: everything
  // goes through a low-pass (a doorway muffles the highs), a little under the effects bus. Three styles,
  // each with four variations by the phrase's number so a long street is not one loop: a cover band
  // (kick, snare, hats, a bass walking the chords, power-chord stabs), a steel pan (a pentatonic tune,
  // a bass boom and a conga), and a karaoke machine (a bossa shaker, an organ chord and a singer a
  // quarter-tone flat, wobbling). The director schedules each phrase on the audio clock, so they chain.
  let muffle: BiquadFilterNode | null = null;
  const doorway = (): AudioNode => {
    if (muffle) return muffle;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.Q.value = 0.7;
    const body = ctx.createGain();
    body.gain.value = 0.6;
    lp.connect(body).connect(bus);
    muffle = lp;
    return lp;
  };
  const BEAT = BAR_PHRASE_S / 4;
  const EIGHTH = BEAT / 2;

  const barMusic = (e: Extract<ScapeEvent, { kind: 'barMusic' }>, t: number, g: number) => {
    const to = doorway();
    const v = e.level * g;
    const t0 = Math.max(e.at, t);
    const v4 = ((e.bar % 4) + 4) % 4;
    // The source that ends last stands for the phrase in the event count.
    const last: { src: AudioScheduledSourceNode | null; end: number } = { src: null, end: 0 };
    const keep = (src: AudioScheduledSourceNode, end: number) => {
      if (end >= last.end) {
        last.end = end;
        last.src = src;
      }
    };
    const at = (eighths: number) => t0 + eighths * EIGHTH;
    const tn = (
      type: OscillatorType,
      f: number,
      f1: number,
      k: number,
      peak: number,
      decay: number,
      atk = 0,
    ) => keep(tone(type, f, f1, at(k), peak * v, decay, atk, to), at(k) + atk + decay);
    const nz = (
      type: BiquadFilterType,
      f: number,
      f1: number,
      q: number,
      k: number,
      peak: number,
      decay: number,
    ) => keep(noise(type, f, f1, q, at(k), peak * v, decay, 0, to), at(k) + decay);

    if (e.style === 'cover-band') {
      // E, A, B, A: the chords of any bar band.
      const root = [82.41, 110, 123.47, 110][v4] as number;
      for (const k of [0, 4]) {
        tn('sine', 120, 45, k, 0.9, 0.14);
        if (v4 % 2 === 1 && k === 4) tn('sine', 120, 45, 5, 0.6, 0.12);
      }
      for (const k of [2, 6]) {
        nz('bandpass', 1800, 1200, 0.8, k, 0.5, 0.1);
        tn('triangle', 190, 150, k, 0.25, 0.08);
      }
      for (let k = 0; k < 8; k++) nz('highpass', 7000, 7000, 0.7, k, 0.12, 0.03);
      for (let k = 0; k < 8; k++)
        tn('sawtooth', k % 4 === 3 ? root * 1.498 : root, k % 4 === 3 ? root * 1.498 : root, k, 0.4, 0.16);
      for (const k of [0, 5]) {
        tn('sawtooth', root * 4, root * 4, k, 0.16, 0.3);
        tn('sawtooth', root * 4 * 1.498, root * 4 * 1.498, k, 0.14, 0.3);
      }
    } else if (e.style === 'steel-drum') {
      // C pentatonic, four tunes: the pan is a sine and its octave with a quick decay.
      const scale = [523.25, 587.33, 659.25, 784, 880, 1046.5];
      const tunes = [
        [0, 2, 3, 2, 4, 3, 2, 0],
        [3, 4, 5, 4, 3, 2, 3, 2],
        [2, 3, 2, 0, 2, 3, 4, 3],
        [4, 3, 2, 3, 0, 2, 3, 0],
      ] as const;
      // A rest on two steps keeps it syncopated (the calypso's 3 + 3 + 2).
      const rests = new Set([1, 4, 7].map((x) => (x + v4) % 8));
      (tunes[v4] as readonly number[]).forEach((deg, k) => {
        if (rests.has(k)) return;
        const f = scale[deg] as number;
        tn('sine', f, f, k, 0.5, 0.4);
        tn('sine', f * 2, f * 2, k, 0.2, 0.18);
      });
      for (const k of [0, 5]) tn('sine', 98, 60, k, 0.7, 0.25);
      for (const k of [3, 6, 7]) nz('bandpass', 900, 700, 2, k, 0.22, 0.05);
    } else {
      // Karaoke: C, Am, F, G under a singer who is not quite on the note.
      const chord = (
        [
          [261.63, 329.63, 392],
          [220, 261.63, 329.63],
          [174.61, 220, 261.63],
          [196, 246.94, 293.66],
        ] as const
      )[v4] ?? [261.63, 329.63, 392];
      for (const f of chord) tn('square', f, f, 0, 0.1, BAR_PHRASE_S * 0.95, 0.03);
      for (const k of [0, 4]) tn('sine', 110, 50, k, 0.7, 0.14);
      for (let k = 0; k < 8; k++) nz('highpass', 6000, 6000, 0.7, k, k % 2 ? 0.1 : 0.06, 0.04);
      // The singer: two held notes a half bar each, flat, with a wobble.
      const tunes = [
        [392, 440],
        [440, 392],
        [349.23, 392],
        [392, 293.66],
      ] as const;
      (tunes[v4] as readonly number[]).forEach((f, half) => {
        const k = half * 4;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f * 0.985;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5;
        const depth = ctx.createGain();
        depth.gain.value = 9;
        lfo.connect(depth).connect(o.frequency);
        o.connect(env(at(k), 0.42 * v, BEAT * 1.8, 0.08, to));
        o.start(at(k));
        o.stop(at(k) + 0.08 + BEAT * 1.8 + 0.03);
        lfo.start(at(k));
        lfo.stop(at(k) + 0.08 + BEAT * 1.8 + 0.03);
        keep(o, at(k) + 0.08 + BEAT * 1.8);
      });
    }
    if (last.src) track(last.src);
  };

  // --- The rain on the helmet ----------------------------------------------------------------
  // Droplet ticks through a high-pass and a presence band; a second, slower layer of the same
  // buffer a semitone down thickens it. One looping source each, so it costs the same however hard
  // it rains.
  const rainGain = ctx.createGain();
  rainGain.gain.value = 0;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3600;
  presence.Q.value = 0.8;
  presence.gain.value = 5;
  hp.connect(presence).connect(rainGain).connect(out);
  const rainSrc: AudioBufferSourceNode[] = [];
  let rain = 0;
  let rainStarted = false;
  const startRain = () => {
    if (rainStarted) return;
    rainStarted = true;
    const rainBuf = dropletBuffer(ctx);
    for (const rate of [1, 0.94]) {
      const s = ctx.createBufferSource();
      s.buffer = rainBuf;
      s.loop = true;
      s.playbackRate.value = rate;
      s.connect(hp);
      s.start(0, rate === 1 ? 0 : 0.7);
      rainSrc.push(s);
    }
  };

  return {
    play(e, t, gain) {
      if (stopped || gain <= 0.001 || active >= MAX_SCAPE_EVENTS) return false;
      switch (e.kind) {
        case 'joint':
          joint(e, t, gain);
          break;
        case 'gull':
          gull(e, t, gain);
          break;
        case 'halyard':
          halyard(e, t, gain);
          break;
        case 'engineBrake':
          engineBrake(e, t, gain);
          break;
        case 'foghorn':
          foghorn(e, t, gain);
          break;
        case 'bell':
          bell(e, t, gain);
          break;
        case 'barMusic':
          barMusic(e, t, gain);
          break;
      }
      return true;
    },
    setRain(level) {
      rain = Math.max(0, Number.isFinite(level) ? level : 0);
      if (rain > 0) startRain();
      rainGain.gain.setTargetAtTime(rain * RAIN_LEVEL, ctx.currentTime, 0.25);
    },
    rainLevel: () => rain,
    active: () => active,
    stop() {
      stopped = true;
      const now = ctx.currentTime;
      rainGain.gain.setTargetAtTime(0, now, 0.05);
      bus.gain.setTargetAtTime(0, now, 0.05);
      for (const s of rainSrc) {
        try {
          s.stop(now + 0.3);
        } catch {
          // already stopped
        }
      }
      for (const s of live.splice(0)) {
        try {
          s.stop(now + 0.3);
        } catch {
          // already stopped
        }
      }
    },
  };
}
