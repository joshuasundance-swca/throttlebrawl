// The synthesized engine (docs/architecture.md, "Audio": engine synthesis). A bike's pack entry
// names a patch (`engineSound.preset`) and may shape it with numbers (content-packs.md, "Bike").
// The sound is a custom periodic wave at the firing frequency, weighted toward the upper
// harmonics because phone speakers drop the low fundamentals, plus intake noise, a sub-octave
// lope and a detuned twin for roughness, then a soft clip, an exhaust low-pass that opens with the
// throttle, and a high-pass that throws away lows a phone cannot play anyway.
//
// This file has NO runtime imports on purpose: tests/e2e/audio-engine.spec.ts transpiles this one
// file and renders the real patch offline in a real browser.

export interface EngineProfile {
  readonly preset: string;
  readonly cylinders: number;
  /** The sim's rpm range (src/sim/riders: 1200 at rest to 10000 at the top of a gear). */
  readonly idleRpm: number;
  readonly redlineRpm: number;
  /** Firing frequency at idle and at redline. */
  readonly idleHz: number;
  readonly redlineHz: number;
  /** Weights of harmonics 1..n; past them the weights fall off as 1/k^tilt. */
  readonly harmonics: readonly number[];
  readonly tilt: number;
  /** 0..1: intake and mechanical noise. */
  readonly noise: number;
  /** 0..1: sub-octave lope and detune. */
  readonly roughness: number;
  readonly intakeHz: number;
  readonly exhaustHz: number;
}

const base = { idleRpm: 1200, redlineRpm: 10000 } as const;

// The M1 starter (rustbucket-400): a big single, lumpy and loud. Also the fallback patch.
const SINGLE_THUMP: EngineProfile = {
  ...base,
  preset: 'single-thump',
  cylinders: 1,
  idleHz: 24,
  redlineHz: 125,
  harmonics: [0.3, 0.65, 1, 0.9, 0.85, 0.7, 0.6, 0.55, 0.5, 0.45],
  tilt: 0.7,
  noise: 0.3,
  roughness: 0.55,
  intakeHz: 950,
  exhaustHz: 1500,
};

/** Synth patches by preset name. Adding a preset is code; a pack only picks one and shapes it. */
export const ENGINE_PRESETS: Readonly<Record<string, EngineProfile>> = {
  'single-thump': SINGLE_THUMP,
  'two-stroke-buzz': {
    ...base,
    preset: 'two-stroke-buzz',
    cylinders: 1,
    idleHz: 38,
    redlineHz: 190,
    harmonics: [0.3, 0.5, 0.8, 1, 0.9, 0.9, 0.8, 0.8, 0.7, 0.7],
    tilt: 0.5,
    noise: 0.35,
    roughness: 0.7,
    intakeHz: 1800,
    exhaustHz: 2600,
  },
  'v-twin': {
    ...base,
    preset: 'v-twin',
    cylinders: 2,
    idleHz: 18,
    redlineHz: 95,
    harmonics: [0.3, 1, 0.5, 0.85, 0.45, 0.7, 0.4, 0.55, 0.35, 0.45],
    tilt: 0.75,
    noise: 0.2,
    roughness: 0.65,
    intakeHz: 750,
    exhaustHz: 1200,
  },
  'inline-four': {
    ...base,
    preset: 'inline-four',
    cylinders: 4,
    idleHz: 45,
    redlineHz: 340,
    harmonics: [0.3, 1, 0.6, 0.75, 0.5, 0.5, 0.4],
    tilt: 0.9,
    noise: 0.15,
    roughness: 0.2,
    intakeHz: 2200,
    exhaustHz: 3200,
  },
  // Playtest 2 (2026-10-02, ENGINE: "a voice per bike"): a dirt bike's high-revving single, its odd
  // harmonics and intake noise up front (the rasp), and a lawn mower's slow, lumpy putter.
  'dirt-rasp': {
    ...base,
    preset: 'dirt-rasp',
    cylinders: 1,
    idleHz: 30,
    redlineHz: 210,
    harmonics: [0.3, 0.35, 1, 0.4, 0.95, 0.4, 0.85, 0.35, 0.7, 0.3, 0.6],
    tilt: 0.45,
    noise: 0.5,
    roughness: 0.5,
    intakeHz: 2400,
    exhaustHz: 2800,
  },
  'mower-putt': {
    ...base,
    preset: 'mower-putt',
    cylinders: 1,
    idleHz: 20,
    redlineHz: 62,
    harmonics: [0.4, 0.8, 1, 0.7, 0.9, 0.5, 0.6, 0.4],
    tilt: 0.6,
    noise: 0.4,
    roughness: 0.85,
    intakeHz: 1300,
    exhaustHz: 1700,
  },
};

export const DEFAULT_ENGINE_PRESET = 'single-thump';

/**
 * A pack's `engineSound` block: a preset name plus optional numbers. It comes from a bike file, or
 * from the base pack's `defaults.engineSoundByClass` for a rider drawn on a bike class (app/ picks
 * which; playtest 2, 2026-10-02: "a voice per bike").
 */
export type EngineSoundSpec = Readonly<Record<string, unknown>> & { readonly preset?: unknown };

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;

/** The preset named by the pack entry, shaped by its numbers; bad or unknown values fall back. */
export function resolveEngineProfile(spec: EngineSoundSpec | undefined): EngineProfile {
  const name = typeof spec?.preset === 'string' ? spec.preset : DEFAULT_ENGINE_PRESET;
  const p: EngineProfile = ENGINE_PRESETS[name] ?? SINGLE_THUMP;
  if (!spec) return p;
  const idleHz = num(spec['idleHz'], 5, 400) ?? p.idleHz;
  const redlineHz = num(spec['redlineHz'], idleHz + 1, 1000) ?? Math.max(p.redlineHz, idleHz + 1);
  return {
    ...p,
    cylinders: Math.round(num(spec['cylinders'], 1, 12) ?? p.cylinders),
    idleHz,
    redlineHz,
    roughness: num(spec['roughness'], 0, 1) ?? p.roughness,
    noise: num(spec['noise'], 0, 1) ?? p.noise,
  };
}

/** Firing frequency for an rpm, linear between idle and redline and clamped to them. */
export function engineFrequencyHz(p: EngineProfile, rpm: number): number {
  const span = p.redlineRpm - p.idleRpm;
  const u = span > 0 ? Math.min(1, Math.max(0, (rpm - p.idleRpm) / span)) : 0;
  return p.idleHz + (p.redlineHz - p.idleHz) * u;
}

/** Weights of harmonics 1..count. */
export function harmonicWeights(p: EngineProfile, count: number): number[] {
  const n = p.harmonics.length;
  const last = p.harmonics[n - 1] ?? 1;
  const out: number[] = [];
  for (let k = 1; k <= count; k++) out.push(k <= n ? (p.harmonics[k - 1] ?? 0) : last * (n / k) ** p.tilt);
  return out;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise per context, from a fixed-seed generator (so renders repeat). */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (buf) return buf;
  buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let s = 0x2f6b1d3 >>> 0;
  for (let i = 0; i < data.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = s / 2147483648 - 1;
  }
  noiseBuffers.set(ctx, buf);
  return buf;
}

let clipCurve: Float32Array<ArrayBuffer> | null = null;
function softClip(): Float32Array<ArrayBuffer> {
  if (clipCurve) return clipCurve;
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2);
  }
  return (clipCurve = curve);
}

export interface EngineState {
  rpm: number;
  /** 0..1 applied throttle. */
  throttle: number;
}

export interface EngineVoice {
  readonly profile: EngineProfile;
  /** Follows rpm and throttle; values glide, so calling once per frame is enough. */
  set(state: EngineState, at?: number): void;
  /** Overall level (distance, ducking); 0 is silent. */
  setLevel(level: number, at?: number): void;
  /** Pitch factor from Doppler, 1 = none. */
  setDoppler(factor: number, at?: number): void;
  /** Left (-1) to right (1); the cheaper patch for other riders only (the player's is centred). */
  setPan(pan: number, at?: number): void;
  /**
   * An exhaust pop or crackle at `at` (playtest 2: "a pop on decel"), size 0..1, under the voice's
   * own level. The full patch only; the cheaper one for other riders ignores it.
   */
  pop(at: number, size: number): void;
  /**
   * A beaten rival's engine missing (the pitch deck's #5: "his engine sputters"): from `at`, one to
   * three misfires that cut the engine for a few tens of milliseconds, then a backfire. Size 0..1.
   * Both patches.
   */
  sputter(at: number, size: number): void;
  stop(at?: number): void;
  /** The last firing frequency and level set, for tests and the debug report. */
  readonly hz: () => number;
  readonly level: () => number;
}

/**
 * Builds one engine voice into `out`. `full` is the player's patch; `lite` is the cheaper patch for
 * other riders (fewer harmonics, no noise, no clipper).
 */
export function createEngineVoice(
  ctx: BaseAudioContext,
  out: AudioNode,
  profile: EngineProfile,
  quality: 'full' | 'lite' = 'full',
): EngineVoice {
  const full = quality === 'full';
  const count = full ? 48 : 16;
  const weights = harmonicWeights(profile, count);
  const real = new Float32Array(count + 1);
  const imag = new Float32Array(count + 1);
  for (let k = 1; k <= count; k++) imag[k] = weights[k - 1] ?? 0;
  const wave = ctx.createPeriodicWave(real, imag);

  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);
  // The misfire gate (sputter): 1 while the engine fires, dipped for a misfire. Pops bypass it.
  const cut = ctx.createGain();
  cut.gain.value = 1;
  cut.connect(level);

  // Exhaust pops: a short band of noise and a low thump, straight into the level stage.
  const popPatch = (at: number, size: number) => {
    const z = Math.min(1, Math.max(0, size));
    if (z <= 0) return;
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 450 + 500 * z;
    band.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1.6 * z, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    n.connect(band).connect(g).connect(level);
    n.start(at, (at * 13.7) % 0.9);
    n.stop(at + 0.06);
    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(90, at);
    thump.frequency.exponentialRampToValueAtTime(45, at + 0.05);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.9 * z, at);
    tg.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    thump.connect(tg).connect(level);
    thump.start(at);
    thump.stop(at + 0.07);
  };
  /** Misfires: the gate drops to 0.1 and comes back, one to three times, then a backfire pop. */
  const sputter = (at: number, size: number) => {
    const z = Math.min(1, Math.max(0, Number.isFinite(size) ? size : 0));
    if (z <= 0) return;
    const misfires = 1 + Math.round(2 * z);
    let t = at;
    for (let i = 0; i < misfires; i++) {
      cut.gain.setValueAtTime(0.1, t);
      cut.gain.setValueAtTime(1, t + 0.04 + 0.04 * z);
      t += 0.11 + 0.05 * z;
    }
    popPatch(t, 0.35 + 0.5 * z);
  };

  const exhaust = ctx.createBiquadFilter();
  exhaust.type = 'lowpass';
  exhaust.Q.value = 0.8;
  exhaust.frequency.value = profile.exhaustHz;

  const body = ctx.createGain(); // follows throttle (engine load)
  body.gain.value = 0.4;

  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.value = profile.idleHz;
  const sources: (OscillatorNode | AudioBufferSourceNode)[] = [osc];
  const detuned: { node: OscillatorNode; cents: number }[] = [{ node: osc, cents: 0 }];

  if (full) {
    const phone = ctx.createBiquadFilter();
    phone.type = 'highpass';
    phone.frequency.value = 110;
    phone.Q.value = 0.7;
    const clip = ctx.createWaveShaper();
    clip.curve = softClip();
    body.connect(clip).connect(exhaust).connect(phone).connect(cut);
    osc.connect(body);

    // A detuned twin: beating that reads as a rough, mechanical engine.
    const twin = ctx.createOscillator();
    twin.setPeriodicWave(wave);
    twin.frequency.value = profile.idleHz;
    const twinCents = 6 + profile.roughness * 18;
    twin.detune.value = twinCents;
    const twinGain = ctx.createGain();
    twinGain.gain.value = 0.35 + profile.roughness * 0.3;
    twin.connect(twinGain).connect(body);
    sources.push(twin);
    detuned.push({ node: twin, cents: twinCents });

    // Sub-octave lope for the thump of a big single or a twin.
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = profile.idleHz / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = profile.roughness * 0.18;
    sub.connect(subGain).connect(body);
    sources.push(sub);
    detuned.push({ node: sub, cents: 0 });

    // Intake noise, opening with the throttle.
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;
    const intake = ctx.createBiquadFilter();
    intake.type = 'bandpass';
    intake.frequency.value = profile.intakeHz;
    intake.Q.value = 0.9;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = profile.noise * 0.3;
    noise.connect(intake).connect(noiseGain).connect(exhaust);
    sources.push(noise);

    let hz = profile.idleHz;
    let lvl = 0;
    const setState = ({ rpm, throttle }: EngineState, at = ctx.currentTime) => {
      const t = Math.min(1, Math.max(0, throttle));
      hz = engineFrequencyHz(profile, rpm);
      osc.frequency.setTargetAtTime(hz, at, 0.03);
      twin.frequency.setTargetAtTime(hz, at, 0.03);
      sub.frequency.setTargetAtTime(hz / 2, at, 0.03);
      exhaust.frequency.setTargetAtTime(profile.exhaustHz * (0.55 + 0.9 * t) + hz * 6, at, 0.05);
      body.gain.setTargetAtTime(0.35 + 0.65 * t, at, 0.05);
      noiseGain.gain.setTargetAtTime(profile.noise * (0.12 + 0.5 * t), at, 0.05);
      intake.frequency.setTargetAtTime(profile.intakeHz * (0.8 + 0.6 * t) + hz * 4, at, 0.05);
    };
    for (const s of sources) s.start();
    return voice(
      setState,
      () => hz,
      () => lvl,
      (v) => (lvl = v),
      popPatch,
    );
  }

  // Other riders sit left or right of you as they pass (a stereo panner where the browser has one).
  const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
  if (panner) {
    level.disconnect();
    level.connect(panner).connect(out);
  }
  osc.connect(body).connect(exhaust).connect(cut);
  let hz = profile.idleHz;
  let lvl = 0;
  const setState = ({ rpm, throttle }: EngineState, at = ctx.currentTime) => {
    const t = Math.min(1, Math.max(0, throttle));
    hz = engineFrequencyHz(profile, rpm);
    osc.frequency.setTargetAtTime(hz, at, 0.04);
    exhaust.frequency.setTargetAtTime(profile.exhaustHz * (0.5 + 0.7 * t) + hz * 5, at, 0.06);
    body.gain.setTargetAtTime(0.4 + 0.6 * t, at, 0.06);
  };
  osc.start();
  return voice(
    setState,
    () => hz,
    () => lvl,
    (v) => (lvl = v),
    () => {},
    (p, at = ctx.currentTime) => panner?.pan.setTargetAtTime(Math.min(1, Math.max(-1, p)), at, 0.05),
  );

  function voice(
    setState: EngineVoice['set'],
    hz: () => number,
    lvl: () => number,
    setLvl: (v: number) => void,
    pop: EngineVoice['pop'],
    setPan: EngineVoice['setPan'] = () => {},
  ): EngineVoice {
    return {
      profile,
      set: setState,
      pop,
      sputter,
      setPan,
      setLevel(v, at = ctx.currentTime) {
        setLvl(v);
        level.gain.setTargetAtTime(v, at, 0.04);
      },
      setDoppler(factor, at = ctx.currentTime) {
        const cents = 1200 * Math.log2(Math.min(2, Math.max(0.5, factor)));
        for (const d of detuned) d.node.detune.setTargetAtTime(d.cents + cents, at, 0.05);
      },
      stop(at = ctx.currentTime) {
        level.gain.setTargetAtTime(0, at, 0.03);
        for (const s of sources) s.stop(at + 0.15);
      },
      hz,
      level: lvl,
    };
  }
}
