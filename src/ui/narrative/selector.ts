// The M1 bark selector (docs/content-packs.md, "Bark sets and line selection", its staging note):
// a trigger match (with the speaker and target selectors), a cooldown per line, a no-repeat ring
// per speaker, and a weighted pick on a presentation random stream that never touches the sim.
// `when` conditions, specificity, career-long novelty and memory facts arrive in M2 or later.
//
// Time is race time in seconds (sim tick ÷ 60), so the gates are exact and testable. [default]
// In M1 a "session" is one race: reset() at race start clears the rings, cooldowns and gaps
// (race time starts again at 0), and career-long memory arrives with career/ in M4.
import type { TuningParamDecl } from '../../sim/api';

/** The closed v1 trigger list (docs/content-packs.md, "Line fields"). */
export const V1_TRIGGERS = [
  'race-start',
  'race-end-win',
  'race-end-lose',
  'overtake',
  'overtaken',
  'alongside-idle',
  'hit-landed',
  'hit-taken',
  'weapon-stolen-by-speaker',
  'weapon-stolen-from-speaker',
  'knocked-down-target',
  'knocked-down-by-target',
  'takedown-into-traffic',
  'near-miss',
  'crash-self',
  'busted',
  'cop-siren',
  'grudge-spotted',
  'gang-up-join',
  'interlude',
  'modifier-start',
] as const;

/** The triggers M1 fires (docs/milestones/M1.md, narrative-1). */
export const M1_TRIGGERS = ['race-start', 'overtake', 'hit-landed'] as const;

/** `barks.*` tuning (docs/content-packs.md, "Selection algorithm": all its numbers are tuning). */
export const BARK_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'barks.minGapPerSpeakerS',
    group: 'barks',
    label: 'Gap per rival',
    default: 6,
    min: 0,
    max: 30,
    step: 0.5,
    unit: 's',
    affectsSim: false,
  },
  {
    id: 'barks.minGapGlobalS',
    group: 'barks',
    label: 'Quiet after a bark',
    default: 0.5,
    min: 0,
    max: 5,
    step: 0.1,
    unit: 's',
    affectsSim: false,
  },
  {
    id: 'barks.ringSize',
    group: 'barks',
    label: 'No-repeat ring',
    default: 12,
    min: 0,
    max: 24,
    step: 1,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'barks.minBubbleS',
    group: 'barks',
    label: 'Shortest bubble',
    default: 2,
    min: 0.5,
    max: 6,
    step: 0.1,
    unit: 's',
    affectsSim: false,
  },
  {
    id: 'barks.charsPerS',
    group: 'barks',
    label: 'Reading speed',
    default: 15,
    min: 5,
    max: 30,
    step: 1,
    unit: 'chars/s',
    affectsSim: false,
  },
];

export interface BarkParams {
  minGapPerSpeakerS: number;
  minGapGlobalS: number;
  ringSize: number;
  minBubbleS: number;
  charsPerS: number;
}

const PARAM_KEY: Record<string, keyof BarkParams> = {
  'barks.minGapPerSpeakerS': 'minGapPerSpeakerS',
  'barks.minGapGlobalS': 'minGapGlobalS',
  'barks.ringSize': 'ringSize',
  'barks.minBubbleS': 'minBubbleS',
  'barks.charsPerS': 'charsPerS',
};

export function barkParamDefaults(): BarkParams {
  const out = {} as BarkParams;
  for (const d of BARK_TUNING) {
    const key = PARAM_KEY[d.id];
    if (key) out[key] = d.default;
  }
  return out;
}

/** How long a bubble stays up: max(2 s, characters ÷ 15 per second) (docs/tone-guide.md). */
export function bubbleDurationS(text: string, params: BarkParams = barkParamDefaults()): number {
  return Math.max(params.minBubbleS, [...text].length / params.charsPerS);
}

/** One loaded, live line, with its set's defaults applied and its selectors qualified. */
export interface BarkLine {
  /** The content reference `<pack>:bark-set/<set>#<line>`, for the veto and the heard list. */
  readonly ref: string;
  readonly packId: string;
  readonly setId: string;
  readonly id: string;
  readonly trigger: string;
  /** A qualified rider id (`base:deacon-vane`) or `any`. */
  readonly speaker: string;
  /** `any`, `player`, or a qualified rider id. */
  readonly target: string;
  readonly text: string;
  readonly cooldownS: number;
  readonly weight: number;
  readonly chance: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function qualify(packId: string, selector: string): string {
  // Bare rider ids refer to the same pack; `any` and `player` are selectors. `role:`, `crew:`
  // and `tag:` selectors arrive with the full algorithm and never match in M1.
  if (selector === 'any' || selector === 'player' || /^(?:role|crew|tag):/.test(selector)) return selector;
  return selector.includes(':') ? selector : `${packId}:${selector}`;
}

/**
 * Flattens the registry's bark-set table (keyed `<pack>:<set>`) into live lines, sorted by
 * content reference so a pick depends only on the seed. Vetoed lines are skipped (the loader
 * already skips vetoed sets), and draft lines unless `includeDrafts` is set.
 */
export function barkLinesFrom(
  sets: Readonly<Record<string, unknown>>,
  options: { includeDrafts?: boolean } = {},
): BarkLine[] {
  const out: BarkLine[] = [];
  for (const [key, set] of Object.entries(sets)) {
    if (!isObj(set) || !Array.isArray(set.lines)) continue;
    const packId = key.includes(':') ? key.slice(0, key.indexOf(':')) : 'base';
    const setId = str(set.id) ?? key.slice(key.indexOf(':') + 1);
    const defaults = isObj(set.defaults) ? set.defaults : {};
    for (const line of set.lines as unknown[]) {
      if (!isObj(line)) continue;
      const id = str(line.id);
      const trigger = str(line.trigger);
      const text = str(line.text);
      if (!id || !trigger || !text) continue;
      const status = str(line.status) ?? 'live';
      if (status === 'vetoed' || (status === 'draft' && !options.includeDrafts)) continue;
      out.push({
        ref: `${packId}:bark-set/${setId}#${id}`,
        packId,
        setId,
        id,
        trigger,
        speaker: qualify(packId, str(line.speaker) ?? str(defaults.speaker) ?? 'any'),
        target: qualify(packId, str(line.target) ?? str(defaults.target) ?? 'any'),
        text,
        cooldownS: num(line.cooldownS) ?? num(defaults.cooldownS) ?? 0,
        weight: Math.max(0, num(line.weight) ?? num(defaults.weight) ?? 1),
        chance: Math.min(1, Math.max(0, num(line.chance) ?? num(defaults.chance) ?? 1)),
      });
    }
  }
  return out.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}

export interface BarkTarget {
  /** The target rider's content id, such as `base:player` or `base:deacon-vane`. */
  contentRef: string;
  isPlayer: boolean;
}

export interface BarkRequest {
  trigger: string;
  /** Candidate speakers (qualified rider ids). One line is picked across all of them. */
  speakers: readonly string[];
  target: BarkTarget | null;
  /** Race time in seconds. */
  nowS: number;
}

export interface Bark {
  line: BarkLine;
  speaker: string;
  startS: number;
  durationS: number;
}

export interface BarkSelector {
  /** Runs one trigger. Returns the bark to show, or null for silence. */
  request(req: BarkRequest): Bark | null;
  /** A new race: clears rings, cooldowns and gaps, and reseeds the presentation stream. */
  reset(seed: number): void;
  /** Applies a `barks.*` tuning change. Unknown ids throw. */
  setParam(id: string, value: number): void;
  readonly params: Readonly<BarkParams>;
}

/** mulberry32 over a seed mixed away from the sim's streams: presentation only. */
function presentationRandom(seed: number): () => number {
  let a = (seed ^ 0x6a09e667) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function targetMatches(selector: string, target: BarkTarget | null): boolean {
  if (selector === 'any') return true;
  if (!target) return false;
  if (selector === 'player') return target.isPlayer;
  return selector === target.contentRef;
}

export function createBarkSelector(
  lines: readonly BarkLine[],
  initial: BarkParams = barkParamDefaults(),
  seed = 0,
): BarkSelector {
  const params: BarkParams = { ...initial };
  let random = presentationRandom(seed);
  let rings = new Map<string, string[]>();
  let cooldownUntil = new Map<string, number>();
  let lastSpokeAt = new Map<string, number>();
  let bubbleEndS = -Infinity;
  let lastEndS = -Infinity;

  return {
    params,
    reset(nextSeed) {
      random = presentationRandom(nextSeed);
      rings = new Map();
      cooldownUntil = new Map();
      lastSpokeAt = new Map();
      bubbleEndS = -Infinity;
      lastEndS = -Infinity;
    },
    setParam(id, value) {
      const key = PARAM_KEY[id];
      if (!key) throw new Error(`barks: unknown parameter ${id}`);
      params[key] = value;
    },
    request({ trigger, speakers, target, nowS }) {
      // 1. Gate on rate: one bubble at a time, a quiet gap after every bark, a gap per speaker.
      if (nowS < bubbleEndS || nowS < lastEndS + params.minGapGlobalS) return null;
      const ready = speakers.filter((s) => {
        const last = lastSpokeAt.get(s);
        return last === undefined || nowS - last >= params.minGapPerSpeakerS;
      });
      if (!ready.length) return null;
      // 2. Filter: trigger, speaker and target selectors, the line's cooldown and the ring.
      const ringSize = Math.max(0, Math.floor(params.ringSize));
      const candidates: { line: BarkLine; speaker: string }[] = [];
      for (const speaker of ready) {
        const ring = rings.get(speaker) ?? [];
        const recent = ring.slice(Math.max(0, ring.length - ringSize));
        for (const line of lines) {
          if (line.trigger !== trigger) continue;
          if (line.speaker !== 'any' && line.speaker !== speaker) continue;
          if (!targetMatches(line.target, target)) continue;
          if (nowS < (cooldownUntil.get(line.ref) ?? -Infinity)) continue;
          if (ringSize > 0 && recent.includes(line.ref)) continue;
          if (line.weight <= 0) continue;
          candidates.push({ line, speaker });
        }
      }
      if (!candidates.length) return null;
      // 3-4. Score (weight only in M1) and pick by weighted random on the presentation stream.
      const total = candidates.reduce((sum, c) => sum + c.line.weight, 0);
      let r = random() * total;
      let pick = candidates[candidates.length - 1];
      for (const c of candidates) {
        r -= c.line.weight;
        if (r < 0) {
          pick = c;
          break;
        }
      }
      if (!pick) return null;
      // 5. Roll chance after the pick: a miss is silence, which beats a repeat.
      if (pick.line.chance < 1 && random() >= pick.line.chance) return null;
      // 7. Record: the ring, the line's cooldown, the speaker's gap and the bubble.
      const ring = rings.get(pick.speaker) ?? [];
      ring.push(pick.line.ref);
      if (ring.length > 64) ring.splice(0, ring.length - 64);
      rings.set(pick.speaker, ring);
      cooldownUntil.set(pick.line.ref, nowS + pick.line.cooldownS);
      lastSpokeAt.set(pick.speaker, nowS);
      const durationS = bubbleDurationS(pick.line.text, params);
      bubbleEndS = lastEndS = nowS + durationS;
      return { line: pick.line, speaker: pick.speaker, startS: nowS, durationS };
    },
  };
}
