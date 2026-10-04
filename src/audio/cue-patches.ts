// Synthesized one-shot cues and the siren. Everything is made in code [decided: code-made sounds
// first]. Impacts start at full level on their first sample (no attack ramp), so a hit is heard
// on the tick its event arrives, which is the hit-stop tick. Each impact stacks a pitch-dropping
// body for weight with mid and high layers, since phone speakers play little below 200 Hz.
// M2 (audio-2): crashes stack more layers the harder they hit, every cue can start pitched down
// (the slow-motion treatment), and the takedown, splash, rail, whoosh and chime cues join.
import { squealAmount, squealLevel, SQUEAL, type CueId } from './cues';
import { noiseBuffer } from './engine-patch';

export interface PlayingCue {
  /** When the sound has fully decayed. */
  readonly endsAt: number;
  stop(): void;
  /** Called once, when the last source ends. */
  onEnded(cb: () => void): void;
}

export interface CueOptions {
  /** 0..1: how hard it hit (crash layering). Default 1. */
  impact?: number;
  /** Pitch factor for every oscillator and filter in the cue (slow motion). Default 1. */
  pitch?: number;
  /**
   * 0..1: how beaten the target is (melee cues only; 0 fresh, 1 nearly down). A weakened target
   * takes hits that sound lower and meatier: the body drops in pitch, a sub thump and a longer
   * body noise join, and the bright snap eases off. Default 0.
   */
  weight?: number;
  /** Which kind of the cue (a smash: the `SmashableKind` that broke). Default: the cue's own. */
  variant?: string;
}

export type CuePatch = (
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  gain: number,
  opts?: CueOptions,
) => PlayingCue;

const SILENT = 0.0001;

class Builder {
  readonly sources: AudioScheduledSourceNode[] = [];
  end: number;
  private readonly ctx: BaseAudioContext;
  private readonly out: GainNode;
  /** Pitch factor applied to every frequency (slow motion pitches the whole cue down). */
  private readonly p: number;
  constructor(ctx: BaseAudioContext, dest: AudioNode, gain: number, t: number, pitch = 1) {
    this.ctx = ctx;
    this.p = Number.isFinite(pitch) && pitch > 0 ? pitch : 1;
    this.out = ctx.createGain();
    this.out.gain.value = gain;
    this.out.connect(dest);
    this.end = t;
  }

  /** A gain envelope: instant (or `attack`) rise to `peak`, exponential decay over `decay`. */
  private env(t: number, peak: number, decay: number, attack = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(attack > 0 ? SILENT : peak, t);
    if (attack > 0) g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(SILENT, t + attack + decay);
    g.connect(this.out);
    this.end = Math.max(this.end, t + attack + decay);
    return g;
  }

  tone(type: OscillatorType, f0: number, f1: number, t: number, peak: number, decay: number, attack = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0 * this.p, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1 * this.p, t + attack + decay);
    o.connect(this.env(t, peak, decay, attack));
    o.start(t);
    o.stop(t + attack + decay + 0.02);
    this.sources.push(o);
  }

  noise(
    filter: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    t: number,
    peak: number,
    decay: number,
    attack = 0,
  ) {
    const n = this.ctx.createBufferSource();
    n.buffer = noiseBuffer(this.ctx);
    n.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0 * this.p, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1 * this.p, t + attack + decay);
    n.connect(f).connect(this.env(t, peak, decay, attack));
    n.start(t);
    n.stop(t + attack + decay + 0.02);
    this.sources.push(n);
  }

  /** A held note with a short release: horns and jingles. */
  held(type: OscillatorType, hz: number, t: number, peak: number, hold: number, lowpassHz = 3000) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz * this.p;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpassHz * this.p;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(SILENT, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.setValueAtTime(peak, t + hold);
    g.gain.exponentialRampToValueAtTime(SILENT, t + hold + 0.08);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + hold + 0.1);
    this.sources.push(o);
    this.end = Math.max(this.end, t + hold + 0.1);
  }

  done(): PlayingCue {
    const sources = this.sources;
    let remaining = sources.length;
    let cb: (() => void) | null = null;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      cb?.();
    };
    for (const s of sources) {
      s.onended = () => {
        if (--remaining <= 0) fire();
      };
    }
    return {
      endsAt: this.end,
      stop: () => {
        const now = this.ctx.currentTime;
        this.out.gain.setTargetAtTime(0, now, 0.01);
        for (const s of sources) {
          try {
            s.stop(now + 0.05);
          } catch {
            // already stopped
          }
        }
        fire();
      },
      onEnded: (f) => {
        cb = f;
      },
    };
  }
}

/**
 * A spring's "boing": the pitch leaps up and falls back with a wobble, over a thin metal twang. `m`
 * scales the pitch (a second spring rings higher).
 */
function boing(b: Builder, t: number, m: number) {
  b.tone('sine', 260 * m, 900 * m, t, 0.34, 0.1);
  b.tone('sine', 900 * m, 300 * m, t + 0.1, 0.3, 0.3);
  b.tone('triangle', 1250 * m, 1800 * m, t, 0.07, 0.16);
}

const unit = (x: number | undefined, fallback: number) =>
  x !== undefined && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : fallback;

const patch =
  (build: (b: Builder, t: number, impact: number, weight: number, variant: string) => void): CuePatch =>
  (ctx, out, t, gain, opts = {}) => {
    const b = new Builder(ctx, out, gain, t, opts.pitch);
    build(b, t, unit(opts.impact, 1), unit(opts.weight, 0), opts.variant ?? '');
    return b.done();
  };

/** A struck bell: a fundamental and inharmonic partials that die sooner (a boxing or cable-car bell). */
function strike(b: Builder, hz: number, t: number, peak: number, ring: number) {
  b.tone('sine', hz, hz, t, peak, ring);
  b.tone('sine', hz * 2.76, hz * 2.75, t, peak * 0.45, ring * 0.55);
  b.tone('sine', hz * 5.4, hz * 5.38, t, peak * 0.22, ring * 0.3);
  b.noise('highpass', 4000, 4000, 0.7, t, peak * 0.25, 0.012);
}

/**
 * What each smashable is made of (run W-T's `SmashableKind`s), so each breaks with its own sound
 * [default]: wood splinters, wire crunches, sheet metal clangs, coins spill, crockery shatters,
 * paper flutters. An unknown kind (a kind added later) gets the wood.
 */
export const SMASH_MATERIALS: Readonly<Record<string, readonly SmashLayer[]>> = {
  'lobster-traps': ['wire', 'wood'],
  mailbox: ['metal', 'paper'],
  'parking-meter': ['metal', 'coins'],
  'pop-up-desk': ['plastic', 'paper'],
  'cafe-table': ['metal', 'crockery'],
  'firewood-stand': ['wood', 'coins'],
};
export type SmashLayer = 'wood' | 'wire' | 'metal' | 'coins' | 'crockery' | 'plastic' | 'paper';

const SMASH_LAYERS: Readonly<Record<SmashLayer, (b: Builder, t: number) => void>> = {
  // Splintering boards: a hollow knock and a few dry cracks.
  wood: (b, t) => {
    b.tone('triangle', 210, 120, t, 0.5, 0.12);
    [0, 0.05, 0.11, 0.2].forEach((dt, i) => b.noise('bandpass', 1500 - i * 200, 900, 3, t + dt, 0.45, 0.05));
  },
  // A stack of wire traps folding: a springy rattle.
  wire: (b, t) => {
    b.noise('bandpass', 3200, 2400, 6, t, 0.35, 0.3);
    [0.03, 0.09, 0.16].forEach((dt) => b.tone('square', 1800 + dt * 3000, 1500, t + dt, 0.06, 0.05));
  },
  // Sheet metal: a dented clang.
  metal: (b, t) => {
    b.tone('sine', 120, 60, t, 0.6, 0.15);
    b.tone('sine', 640, 630, t, 0.28, 0.4);
    b.tone('sine', 1490, 1480, t, 0.16, 0.28);
    b.noise('bandpass', 2600, 1800, 3, t, 0.3, 0.2);
  },
  // The meter's (or the honour box's) change, all over the road.
  coins: (b, t) => {
    [0.08, 0.13, 0.19, 0.24, 0.33, 0.41].forEach((dt, i) =>
      b.tone('sine', 3300 + ((i * 577) % 900), 3300 + ((i * 577) % 900), t + dt, 0.1, 0.09),
    );
  },
  // Cups and saucers.
  crockery: (b, t) => {
    b.noise('highpass', 4500, 4500, 1.2, t + 0.02, 0.4, 0.18);
    [0.05, 0.12, 0.22].forEach((dt, i) => b.tone('sine', 2400 + i * 700, 2380 + i * 700, t + dt, 0.12, 0.12));
  },
  // A folding desk and its banner: a plastic crack and a flap.
  plastic: (b, t) => {
    b.noise('bandpass', 1200, 700, 2, t, 0.5, 0.08);
    b.noise('lowpass', 900, 400, 0.8, t + 0.1, 0.3, 0.2, 0.03);
  },
  // Papers: flyers, letters, a pitch deck, fluttering away.
  paper: (b, t) => {
    [0.06, 0.15, 0.27, 0.4].forEach((dt, i) =>
      b.noise('bandpass', 2600 + i * 400, 3200, 1.5, t + dt, 0.18, 0.1, 0.02),
    );
  },
};

/**
 * How much lower a melee body drops at full weight (the pitch factor is 1 - this * weight), and the
 * level of the sub thump a fully weakened target adds. [default]
 */
export const MEATY = { pitchDrop: 0.3, sub: 0.55 } as const;

/** Impact at which a crash adds its roar and tumbling thumps, and at which it adds debris. */
export const CRASH_LAYERS = { roar: 0.35, debris: 0.7 } as const;

export const CUE_PATCHES: Readonly<Record<CueId, CuePatch>> = {
  // A fist on leather: a pitch-dropping thump, a mid "thwack" and a bright smack. Against a weakened
  // target the body drops and a sub thump and a longer body noise join (see MEATY).
  punch: patch((b, t, _impact, w) => {
    const lo = 1 - MEATY.pitchDrop * w;
    b.tone('sine', 160 * lo, 55 * lo, t, 0.9, 0.16 + 0.1 * w);
    b.tone('triangle', 260 * lo, 120 * lo, t, 0.45, 0.1 + 0.04 * w);
    b.noise('lowpass', 2800 * lo, 500 * lo, 0.8, t, 0.7, 0.09 + 0.07 * w);
    b.noise('highpass', 3500, 3500, 0.7, t, 0.3 * (1 - 0.5 * w), 0.015);
    if (w > 0) b.tone('sine', 78, 36, t, MEATY.sub * w, 0.22 + 0.14 * w);
  }),
  // A boot: heavier and longer, with a crunch.
  kick: patch((b, t, _impact, w) => {
    const lo = 1 - MEATY.pitchDrop * w;
    b.tone('sine', 120 * lo, 42 * lo, t, 1, 0.24 + 0.12 * w);
    b.tone('square', 190 * lo, 85 * lo, t, 0.28, 0.12 + 0.05 * w);
    b.noise('bandpass', 1100 * lo, 450 * lo, 1.1, t, 0.85, 0.16 + 0.08 * w);
    b.noise('highpass', 3000, 3000, 0.7, t, 0.3 * (1 - 0.5 * w), 0.02);
    if (w > 0) b.tone('sine', 66, 32, t, MEATY.sub * w, 0.3 + 0.16 * w);
  }),
  // A weapon: an inharmonic metal clang over a short thump.
  hit: patch((b, t, _impact, w) => {
    const lo = 1 - MEATY.pitchDrop * w;
    b.tone('sine', 130 * lo, 60 * lo, t, 0.6, 0.12 + 0.08 * w);
    // The metal rings a little lower and shorter on a body that is already hurt.
    b.tone('sine', 523 * (1 - 0.1 * w), 520 * (1 - 0.1 * w), t, 0.35, 0.5 - 0.15 * w);
    b.tone('sine', 1307, 1300, t, 0.25 * (1 - 0.4 * w), 0.35);
    b.tone('sine', 2091, 2085, t, 0.18 * (1 - 0.5 * w), 0.25);
    b.tone('sine', 2977, 2970, t, 0.12 * (1 - 0.5 * w), 0.18);
    b.noise('highpass', 2000, 2000, 0.7, t, 0.4 * (1 - 0.4 * w), 0.025);
    if (w > 0) {
      b.tone('sine', 74, 34, t, MEATY.sub * w, 0.26 + 0.12 * w);
      b.noise('lowpass', 1400 * lo, 300 * lo, 0.8, t, 0.4 * w, 0.14);
    }
  }),
  // Tuning in or out (the hidden pirate station, run W-Q): a swept burst of radio static, a
  // whistle that falls as the dial slides, and a small blip when the signal locks.
  tune: patch((b, t) => {
    b.noise('bandpass', 500, 3400, 1.2, t, 0.45, 0.3, 0.02);
    b.noise('highpass', 3200, 3200, 0.7, t + 0.1, 0.2, 0.16);
    b.tone('sine', 1900, 700, t, 0.12, 0.26);
    b.tone('sine', 880, 880, t + 0.3, 0.1, 0.09);
  }),
  // A whiff: a quick noise sweep.
  miss: patch((b, t) => {
    b.noise('bandpass', 700, 2600, 2, t, 0.35, 0.16, 0.035);
  }),
  // Going down, layered by impact (M2.md audio-2). Always: the body thump, a mid crunch and the
  // metal scrape. A harder crash adds the long darkening roar and two tumbling thumps; a big one
  // adds plastic and glass debris skittering after it. Every layer is louder the harder it hit.
  crash: patch((b, t, impact) => {
    const k = 0.55 + 0.45 * impact;
    b.tone('sine', 95, 40, t, 1 * k, 0.18 + 0.1 * impact);
    b.noise('bandpass', 900, 350, 1.2, t, 0.6 * k, 0.14);
    b.noise('bandpass', 3300, 2400, 4, t, 0.28 * k, 0.35 + 0.4 * impact, 0.05);
    if (impact >= CRASH_LAYERS.roar) {
      b.noise('lowpass', 3200, 280, 0.7, t, 0.85 * k, 0.5 + 0.5 * impact);
      b.tone('sine', 85, 38, t + 0.13, 0.7 * k, 0.2);
      b.tone('sine', 75, 35, t + 0.31, 0.45 * k, 0.2);
    }
    if (impact >= CRASH_LAYERS.debris) {
      b.noise('highpass', 5200, 5200, 1.5, t + 0.05, 0.35 * k, 0.12);
      b.noise('bandpass', 4200, 3600, 6, t + 0.19, 0.3 * k, 0.09);
      b.noise('bandpass', 2600, 2200, 5, t + 0.36, 0.26 * k, 0.1);
      b.tone('triangle', 2400, 2300, t + 0.27, 0.12 * k, 0.08);
    }
  }),
  land: patch((b, t) => {
    b.tone('sine', 110, 48, t, 0.7, 0.14);
    b.noise('lowpass', 900, 300, 0.7, t, 0.45, 0.07);
  }),
  grab: patch((b, t) => {
    b.tone('triangle', 660, 990, t, 0.35, 0.09);
    b.tone('triangle', 1320, 1320, t + 0.05, 0.25, 0.08);
  }),
  // A car horn: a major-third pair of buzzy notes.
  horn: patch((b, t) => {
    b.held('sawtooth', 415, t, 0.28, 0.45, 2600);
    b.held('sawtooth', 523, t, 0.24, 0.45, 2600);
  }),
  // A truck horn: lower, longer, three notes.
  truckHorn: patch((b, t) => {
    b.held('sawtooth', 185, t, 0.3, 0.9, 2000);
    b.held('sawtooth', 233, t, 0.26, 0.9, 2000);
    b.held('sawtooth', 277, t, 0.22, 0.9, 2000);
  }),
  sirenWhoop: patch((b, t) => {
    b.tone('sawtooth', 520, 1400, t, 0.35, 0.45, 0.02);
  }),
  go: patch((b, t) => {
    b.held('square', 880, t, 0.25, 0.14, 4000);
  }),
  // Your finish (run W-U, pitch deck #5: "a boxing-bell 'ding' marks the finish"): the ring's bell,
  // struck three times as at the end of a round, over the old rising jingle, quieter.
  finish: patch((b, t) => {
    [0, 0.3, 0.6].forEach((dt) => strike(b, 1175, t + dt, 0.42, 1.4));
    [523, 659, 784, 1047].forEach((hz, i) => b.held('square', hz, t + i * 0.1, 0.08, 0.09, 4000));
  }),
  // A rival crossing the line: the same bell, struck once.
  ding: patch((b, t) => {
    strike(b, 1175, t, 0.4, 1.2);
  }),
  // A roadside smashable breaking (run W-T, "the road fights back"): a body thump, then what it is
  // made of (SMASH_MATERIALS by its kind).
  smash: patch((b, t, _impact, _w, kind) => {
    b.tone('sine', 140, 50, t, 0.7, 0.14);
    b.noise('lowpass', 2400, 400, 0.8, t, 0.5, 0.12);
    for (const layer of SMASH_MATERIALS[kind] ?? ['wood']) SMASH_LAYERS[layer](b, t);
  }),
  // A thrown weapon (run W-T): it whirls through the air, a whoosh pulsing as it turns.
  toss: patch((b, t) => {
    [0, 0.09, 0.18, 0.27].forEach((dt, i) =>
      b.noise('bandpass', 700 + i * 150, 1500, 2.2, t + dt, 0.3, 0.07, 0.03),
    );
  }),
  // Kevin's briefcase bursting on a rider (run W-T): the case's thump and his paperwork everywhere.
  paper: patch((b, t, _impact, w) => {
    const lo = 1 - MEATY.pitchDrop * w;
    b.tone('sine', 150 * lo, 55 * lo, t, 0.85, 0.16 + 0.08 * w);
    b.noise('lowpass', 2000 * lo, 400, 0.8, t, 0.6, 0.1);
    b.tone('triangle', 900, 880, t, 0.12, 0.05);
    SMASH_LAYERS.paper(b, t);
    SMASH_LAYERS.paper(b, t + 0.22);
    if (w > 0) b.tone('sine', 74, 34, t, MEATY.sub * w, 0.26 + 0.12 * w);
  }),
  // Landing on a rider ("Air that pays"): a whole bike's weight, a deep body slam with no metal.
  slam: patch((b, t, _impact, w) => {
    const lo = 1 - MEATY.pitchDrop * w;
    b.tone('sine', 100 * lo, 34 * lo, t, 1, 0.3 + 0.1 * w);
    b.tone('square', 160 * lo, 60 * lo, t, 0.25, 0.14);
    b.noise('lowpass', 1600 * lo, 250, 0.8, t, 0.85, 0.22);
    b.noise('bandpass', 900, 500, 1.2, t + 0.03, 0.4, 0.14);
    b.tone('sine', 62, 30, t, 0.4 + MEATY.sub * w, 0.35);
  }),
  // A clean landing that surges: the touchdown, then the rush of the surge.
  surge: patch((b, t) => {
    b.tone('sine', 110, 48, t, 0.6, 0.14);
    b.noise('bandpass', 400, 2800, 1.3, t + 0.04, 0.42, 0.4, 0.03);
    b.tone('sawtooth', 200, 600, t + 0.04, 0.1, 0.3);
  }),
  // A wheel over a shed log (the PNW log spill): two wooden thumps, front then rear.
  logHop: patch((b, t) => {
    b.tone('sine', 130, 55, t, 0.8, 0.12);
    b.tone('triangle', 240, 150, t, 0.25, 0.08);
    b.tone('sine', 120, 50, t + 0.09, 0.6, 0.12);
    b.noise('lowpass', 1100, 400, 0.8, t + 0.09, 0.3, 0.06);
  }),
  // The boat trailer comes unhitched (the Keys' boat slide): the coupler's clank, a chain rattling
  // after it, and the hull scraping off down the road.
  unhitch: patch((b, t) => {
    b.tone('sine', 180, 80, t, 0.6, 0.12);
    b.tone('sine', 880, 870, t, 0.25, 0.3);
    b.tone('sine', 2310, 2300, t, 0.12, 0.2);
    [0.12, 0.19, 0.25, 0.34, 0.42].forEach((dt) => b.noise('bandpass', 3800, 3400, 5, t + dt, 0.18, 0.04));
    b.noise('bandpass', 700, 420, 1.5, t + 0.25, 0.35, 1.6, 0.25);
  }),
  // The cable car loses its grip (SF's runaway): the grip lets go with a clank, the brake shoes
  // squeal, and the gripman rings for his life. More bells follow while it rolls (cableBell).
  runaway: patch((b, t) => {
    b.tone('sine', 150, 60, t, 0.6, 0.15);
    b.noise('bandpass', 1900, 1900, 9, t + 0.05, 0.28, 0.9, 0.05);
    b.tone('sawtooth', 1950, 1820, t + 0.05, 0.06, 0.9, 0.05);
    [0.12, 0.3, 0.48, 0.66].forEach((dt) => strike(b, 1480, t + dt, 0.32, 0.5));
  }),
  // A cable-car bell, rung in a hurry: a quick double clang.
  cableBell: patch((b, t) => {
    strike(b, 1480, t, 0.3, 0.45);
    strike(b, 1480, t + 0.14, 0.26, 0.45);
  }),
  // The log truck starts shedding (the PNW log spill): the binder chains let go, then logs rumble
  // off the deck.
  shed: patch((b, t) => {
    b.tone('sine', 620, 610, t, 0.22, 0.25);
    [0.04, 0.1, 0.17].forEach((dt) => b.noise('bandpass', 3600, 3200, 5, t + dt, 0.18, 0.05));
    [0.25, 0.5, 0.8, 1.05].forEach((dt, i) => b.tone('sine', 95 - i * 6, 40, t + dt, 0.75, 0.3));
    b.noise('lowpass', 500, 160, 0.7, t + 0.25, 0.6, 1.4, 0.1);
  }),
  // A lane vote is cast (the gantry): its panel flips over with a ka-chunk, and a small chime.
  vote: patch((b, t) => {
    b.noise('bandpass', 1800, 1400, 3, t, 0.4, 0.03);
    b.tone('sine', 160, 70, t + 0.08, 0.6, 0.1);
    b.noise('bandpass', 1300, 900, 3, t + 0.08, 0.35, 0.05);
    b.tone('triangle', 1319, 1319, t + 0.2, 0.18, 0.25);
    b.tone('triangle', 1760, 1760, t + 0.28, 0.16, 0.3);
  }),
  // The takedown stinger: a sub-drop boom under a bright struck-metal ding that carries over the
  // crash. It says "you did that".
  takedown: patch((b, t) => {
    b.tone('sine', 140, 38, t, 1, 0.45);
    b.tone('square', 220, 70, t, 0.22, 0.25);
    b.noise('lowpass', 1800, 200, 0.8, t, 0.5, 0.35);
    b.tone('sine', 1245, 1240, t + 0.02, 0.3, 0.6);
    b.tone('sine', 1868, 1860, t + 0.02, 0.2, 0.45);
    b.tone('sine', 3113, 3100, t + 0.02, 0.1, 0.3);
  }),
  // Into slow motion: a falling whoosh over a deep swell.
  slowIn: patch((b, t) => {
    b.noise('bandpass', 2400, 250, 1.4, t, 0.45, 0.5, 0.04);
    b.tone('sine', 180, 55, t, 0.6, 0.7, 0.03);
  }),
  // Back to speed: a short rising whoosh.
  slowOut: patch((b, t) => {
    b.noise('bandpass', 300, 2600, 1.4, t, 0.35, 0.3, 0.05);
  }),
  // A body over the guardrail: a hollow steel clang with a scrape.
  railClang: patch((b, t) => {
    b.tone('sine', 110, 55, t, 0.7, 0.18);
    b.tone('sine', 311, 309, t, 0.4, 0.55);
    b.tone('sine', 743, 740, t, 0.28, 0.4);
    b.tone('sine', 1321, 1315, t, 0.18, 0.3);
    b.noise('bandpass', 2800, 1800, 3, t, 0.3, 0.35);
  }),
  // Into the water: a slap, a wide spray that settles, and a few bubbles.
  splash: patch((b, t) => {
    b.tone('sine', 120, 45, t, 0.8, 0.2);
    b.noise('lowpass', 5000, 700, 0.6, t, 0.9, 0.9);
    b.noise('highpass', 3500, 3500, 0.7, t + 0.05, 0.4, 0.6, 0.05);
    [0.35, 0.5, 0.62, 0.8].forEach((dt, i) =>
      b.tone('sine', 380 + i * 90, 900 + i * 150, t + dt, 0.18, 0.06),
    );
  }),
  // Back on the road after a splash: two quick rising notes.
  respawn: patch((b, t) => {
    b.held('square', 660, t, 0.18, 0.07, 3000);
    b.held('square', 990, t + 0.08, 0.18, 0.1, 3000);
  }),
  // Style cash: a small two-note chime, bright enough to cut through the engine.
  cash: patch((b, t) => {
    b.tone('triangle', 1568, 1568, t, 0.25, 0.18);
    b.tone('triangle', 2093, 2093, t + 0.07, 0.25, 0.3);
    b.tone('sine', 4186, 4186, t + 0.07, 0.08, 0.2);
  }),
  // A weapon's snatch window opens: a high glint.
  glint: patch((b, t) => {
    b.tone('sine', 2637, 2637, t, 0.22, 0.25);
    b.tone('sine', 3951, 3951, t + 0.03, 0.14, 0.2);
  }),
  // A wobble: a short tyre squeal with a scuff.
  wobble: patch((b, t) => {
    b.tone('sawtooth', 900, 700, t, 0.12, 0.25, 0.02);
    b.noise('bandpass', 1600, 1200, 5, t, 0.3, 0.22, 0.02);
    b.noise('lowpass', 700, 300, 0.7, t, 0.35, 0.08);
  }),
  // A close pass: a quick air whoosh.
  passBy: patch((b, t) => {
    b.noise('bandpass', 600, 2200, 1.6, t, 0.35, 0.22, 0.06);
  }),
  // A boost pad (playtest 1b): a rising rush of air under a quick upward sweep.
  boost: patch((b, t) => {
    b.noise('bandpass', 400, 3200, 1.2, t, 0.5, 0.45, 0.03);
    b.tone('sawtooth', 180, 720, t, 0.18, 0.35);
  }),
  // A wheelie pops (playtest 3): the engine revs as the front comes up, a rush of air and the thump
  // of the lift.
  wheelieUp: patch((b, t) => {
    b.tone('sawtooth', 140, 520, t, 0.26, 0.3, 0.02);
    b.noise('bandpass', 500, 2000, 1.2, t, 0.22, 0.25, 0.02);
    b.tone('sine', 100, 55, t, 0.5, 0.16);
  }),
  // The front comes down clean: a soft thump, a scuff and a quick tyre chirp.
  wheelieDown: patch((b, t) => {
    b.tone('sine', 120, 52, t, 0.55, 0.16);
    b.noise('lowpass', 900, 300, 0.7, t, 0.32, 0.08);
    b.tone('sine', 760, 520, t + 0.01, 0.1, 0.05);
  }),
  // A drift breaks away (the squeal that follows is a continuous voice, createSquealVoice): a
  // tyre's bite, a whine and a scuff. Each link of a chain after the first adds a rising tick, the
  // chain riding in the variant.
  driftBite: patch((b, t, _impact, _w, variant) => {
    b.noise('bandpass', 1800, 3000, 6, t, 0.42, 0.55, 0.03);
    b.tone('sawtooth', 1200, 1700, t, 0.07, 0.4, 0.03);
    b.noise('lowpass', 700, 300, 0.7, t, 0.25, 0.1);
    const chain = Math.min(5, Math.max(1, Math.round(Number(variant) || 1)));
    for (let k = 1; k < chain; k++)
      b.tone(
        'triangle',
        1568 * 2 ** ((k * 2) / 12),
        1568 * 2 ** ((k * 2) / 12),
        t + 0.06 + 0.075 * k,
        0.2,
        0.07,
      );
  }),
  // The exit boost (a clean drift exit): a rising rush under an upward sweep, the blow-off valve's
  // sigh and a turbo chirp. A bigger boost (impact) rushes louder and longer.
  driftBoost: patch((b, t, impact) => {
    const k = 0.7 + 0.3 * impact;
    const dur = 0.35 + 0.35 * impact;
    b.noise('bandpass', 400, 3600, 1.2, t, 0.5 * k, dur, 0.03);
    b.tone('sawtooth', 160, 760, t, 0.18 * k, dur * 0.8);
    b.noise('highpass', 4500, 3500, 0.8, t + 0.12 + 0.1 * impact, 0.3 * k, 0.25);
    b.tone('sine', 1320, 1980, t + dur * 0.7, 0.12 * k, 0.12);
  }),
  // A wheelie rides up a car's hood or trunk (playtest 3, the launch): the crunch of sheet metal and
  // the spring of the suspension; a second flip rings a second, higher spring.
  hoodBoing: patch((b, t, impact) => {
    b.tone('sine', 110, 45, t, 0.8, 0.16);
    b.noise('bandpass', 1400, 500, 1.3, t, 0.65, 0.2);
    b.noise('bandpass', 3000, 2000, 4, t, 0.3, 0.14);
    b.tone('sine', 640, 630, t + 0.02, 0.22, 0.28);
    boing(b, t + 0.08, 1);
    if (impact >= 0.6) boing(b, t + 0.38, 1.35);
  }),
  // Dial-Up's Bad Connection (run W-T): a 56k handshake in under a second, the warning before he
  // drops. The answer tone, a falling chirp, the warbling squeal, then the hiss.
  modem: patch((b, t) => {
    b.tone('sine', 2100, 2100, t, 0.16, 0.14);
    b.tone('square', 1800, 1200, t + 0.12, 0.08, 0.12);
    b.tone('square', 1200, 2400, t + 0.24, 0.07, 0.1);
    b.tone('sawtooth', 980, 1650, t + 0.32, 0.07, 0.22);
    b.noise('bandpass', 1700, 2900, 3, t + 0.38, 0.32, 0.32, 0.02);
  }),
};

export interface SirenVoice {
  setLevel(level: number, at?: number): void;
  setDoppler(factor: number, at?: number): void;
  stop(): void;
  readonly level: () => number;
}

/** The cop's continuous wail: two buzzy oscillators swept by a slow sine. */
export function createSirenVoice(ctx: BaseAudioContext, out: AudioNode): SirenVoice {
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 400;
  lp.connect(hp).connect(level);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.45;
  const depth = ctx.createGain();
  depth.gain.value = 330;
  lfo.connect(depth);
  const oscs = (['sawtooth', 'square'] as const).map((type, i) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = 980;
    depth.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.value = i === 0 ? 0.3 : 0.15;
    o.connect(g).connect(lp);
    return o;
  });
  lfo.start();
  for (const o of oscs) o.start();
  let lvl = 0;
  return {
    setLevel(v, at = ctx.currentTime) {
      lvl = v;
      level.gain.setTargetAtTime(v, at, 0.08);
    },
    setDoppler(factor, at = ctx.currentTime) {
      const cents = 1200 * Math.log2(Math.min(2, Math.max(0.5, factor)));
      for (const o of oscs) o.detune.setTargetAtTime(cents, at, 0.05);
    },
    stop() {
      const now = ctx.currentTime;
      level.gain.setTargetAtTime(0, now, 0.05);
      lfo.stop(now + 0.3);
      for (const o of oscs) o.stop(now + 0.3);
      lvl = 0;
    },
    level: () => lvl,
  };
}

export interface SquealVoice {
  /**
   * Aims the squeal at a slip angle (radians, either side); `gain` is its level at full slip and
   * `scale` multiplies it (0 while down, in the air or stopped).
   */
  set(driftRad: number, gain: number, scale?: number): void;
  level(): number;
  stop(): void;
}

/** The drift's continuous tyre squeal: band-passed noise (1.8 to 3.0 kHz) over a thin whine. */
export function createSquealVoice(ctx: BaseAudioContext, out: AudioNode): SquealVoice {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 4;
  band.frequency.value = SQUEAL.loHz;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(band);
  band.connect(gain);
  const whine = ctx.createOscillator();
  whine.type = 'sawtooth';
  whine.frequency.value = SQUEAL.loHz * 0.6;
  const whineLevel = ctx.createGain();
  whineLevel.gain.value = 0.18;
  const whineBand = ctx.createBiquadFilter();
  whineBand.type = 'lowpass';
  whineBand.frequency.value = SQUEAL.hiHz;
  whine.connect(whineLevel).connect(whineBand).connect(gain);
  gain.connect(out);
  src.start();
  whine.start();
  let current = 0;
  return {
    set(driftRad, peak, scale = 1) {
      const t = ctx.currentTime;
      const a = squealAmount(driftRad);
      current = squealLevel(driftRad, peak) * Math.max(0, scale);
      gain.gain.setTargetAtTime(current, t, 0.05);
      band.frequency.setTargetAtTime(SQUEAL.loHz + (SQUEAL.hiHz - SQUEAL.loHz) * a, t, 0.08);
      whine.frequency.setTargetAtTime((SQUEAL.loHz + (SQUEAL.hiHz - SQUEAL.loHz) * a) * 0.6, t, 0.08);
    },
    level: () => current,
    stop() {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      current = 0;
      for (const s of [src, whine]) {
        try {
          s.stop(ctx.currentTime + 0.3);
        } catch {
          // already stopped
        }
      }
    },
  };
}
