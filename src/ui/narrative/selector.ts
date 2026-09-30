// The bark selector (docs/content-packs.md, "Bark sets and line selection"): a trigger match
// (with the speaker and target selectors), `when` conditions, a cooldown per line, a no-repeat ring
// per speaker, priority interrupts, and a pick weighted by `weight × specificity × novelty` on a
// presentation random stream that never touches the sim. M2 (narrative-2) added the conditions,
// specificity, priority and `oncePerCareer`, and skips lines cut on this device. Career-long
// novelty and heard-counts arrive with career/ in M4, through the `heardCount` seam.
//
// Time is race time in seconds (sim tick ÷ 60), so the gates are exact and testable. [default]
// In M1 a "session" is one race: reset() at race start clears the rings, cooldowns and gaps
// (race time starts again at 0), and career-long memory arrives with career/ in M4.
import { BARK_TRIGGERS } from '../../content';
import type { TuningParamDecl } from '../../sim/api';
import {
  conditionsFrom,
  matchConditions,
  novelty,
  specificity,
  type BarkCondition,
  type FactResolver,
} from './conditions';

/** The closed v1 trigger list: content/'s registry (src/content/schema/vocab.ts). */
export const V1_TRIGGERS = BARK_TRIGGERS;

/** The triggers M1 fires (docs/milestones/M1.md, narrative-1). */
export const M1_TRIGGERS = ['race-start', 'overtake', 'hit-landed'] as const;

/** The triggers M2 adds (docs/milestones/M2.md, narrative-2). */
export const M2_TRIGGERS = [
  'takedown-into-traffic',
  'knocked-down-by-target',
  'crash-self',
  'near-miss',
] as const;

/** The highest line priority (docs/content-packs.md, "Line fields": 0–3). */
export const MAX_PRIORITY = 3;

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
  /** Conditions, all of which must hold. */
  readonly when: readonly BarkCondition[];
  /** 0–3: a higher-priority line may interrupt a lower one on screen. */
  readonly priority: number;
  readonly oncePerCareer: boolean;
  /** The speaker is an exact rider id rather than a selector (specificity ×1.5). */
  readonly exactSpeaker: boolean;
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
 * already skips vetoed sets), and draft lines unless `includeDrafts` is set. A line whose `when`
 * is malformed or names an unknown fact is dropped: it could only ever play out of context.
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
      const when = conditionsFrom(line.when);
      if (!when) continue;
      const speaker = qualify(packId, str(line.speaker) ?? str(defaults.speaker) ?? 'any');
      out.push({
        ref: `${packId}:bark-set/${setId}#${id}`,
        packId,
        setId,
        id,
        trigger,
        speaker,
        target: qualify(packId, str(line.target) ?? str(defaults.target) ?? 'any'),
        text,
        cooldownS: num(line.cooldownS) ?? num(defaults.cooldownS) ?? 0,
        weight: Math.max(0, num(line.weight) ?? num(defaults.weight) ?? 1),
        chance: Math.min(1, Math.max(0, num(line.chance) ?? num(defaults.chance) ?? 1)),
        when,
        priority: Math.min(
          MAX_PRIORITY,
          Math.max(0, Math.floor(num(line.priority) ?? num(defaults.priority) ?? 0)),
        ),
        oncePerCareer: line.oncePerCareer === true,
        exactSpeaker: speaker !== 'any' && speaker !== 'player' && !/^(?:role|crew|tag):/.test(speaker),
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
  /** The facts for a candidate speaker's `when` conditions; without them, conditioned lines stay quiet. */
  facts?: ((speaker: string) => FactResolver | undefined) | undefined;
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
  /** Cuts a line on this device ("cut this"): it never plays again. */
  veto(ref: string): void;
  isVetoed(ref: string): boolean;
}

export interface BarkSelectorOptions {
  /** Times a line was heard over the career (M4's career/); 0 until then, so novelty is 1. */
  heardCount?: (ref: string) => number;
  /** Content references already cut on this device. */
  vetoed?: Iterable<string>;
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
  options: BarkSelectorOptions = {},
): BarkSelector {
  const params: BarkParams = { ...initial };
  const vetoed = new Set<string>(options.vetoed ?? []);
  // `oncePerCareer` lines already said. Until the career saves them (M4), "once" is once per page
  // session: reset() at race start keeps this set. [default]
  const spent = new Set<string>();
  let onScreenPriority = 0;
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
      onScreenPriority = 0;
    },
    veto(ref) {
      vetoed.add(ref);
    },
    isVetoed: (ref) => vetoed.has(ref),
    setParam(id, value) {
      const key = PARAM_KEY[id];
      if (!key) throw new Error(`barks: unknown parameter ${id}`);
      params[key] = value;
    },
    request({ trigger, speakers, target, nowS, facts }) {
      // 1. Gate on rate: one bubble at a time and a quiet gap after every bark, unless the new
      // line's priority is higher than the last bark's; and a gap per speaker, always.
      const busy = nowS < bubbleEndS || nowS < lastEndS + params.minGapGlobalS;
      const minPriority = busy ? onScreenPriority + 1 : 0;
      if (minPriority > MAX_PRIORITY) return null;
      const ready = speakers.filter((s) => {
        const last = lastSpokeAt.get(s);
        return last === undefined || nowS - last >= params.minGapPerSpeakerS;
      });
      if (!ready.length) return null;
      // 2. Filter: trigger, speaker and target selectors, priority while busy, cuts, the line's
      // cooldown, the ring, a spent once-line, and every `when` condition.
      const ringSize = Math.max(0, Math.floor(params.ringSize));
      const candidates: { line: BarkLine; speaker: string; score: number }[] = [];
      for (const speaker of ready) {
        const ring = rings.get(speaker) ?? [];
        const recent = ring.slice(Math.max(0, ring.length - ringSize));
        let resolver: FactResolver | undefined;
        let resolved = false;
        for (const line of lines) {
          if (line.trigger !== trigger) continue;
          if (line.speaker !== 'any' && line.speaker !== speaker) continue;
          if (!targetMatches(line.target, target)) continue;
          if (line.priority < minPriority) continue;
          if (vetoed.has(line.ref)) continue;
          if (nowS < (cooldownUntil.get(line.ref) ?? -Infinity)) continue;
          if (ringSize > 0 && recent.includes(line.ref)) continue;
          if (line.oncePerCareer && spent.has(line.ref)) continue;
          if (line.weight <= 0) continue;
          if (line.when.length && !resolved) {
            resolver = facts?.(speaker);
            resolved = true;
          }
          const match = matchConditions(line.when, resolver, line.packId);
          if (!match) continue;
          // 3. Score: weight × specificity × novelty.
          const heard = options.heardCount?.(line.ref) ?? 0;
          const score = line.weight * specificity(match, line.exactSpeaker) * novelty(heard);
          candidates.push({ line, speaker, score });
        }
      }
      if (!candidates.length) return null;
      // 4. Pick by weighted random on the presentation stream.
      const total = candidates.reduce((sum, c) => sum + c.score, 0);
      let r = random() * total;
      let pick = candidates[candidates.length - 1];
      for (const c of candidates) {
        r -= c.score;
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
      if (pick.line.oncePerCareer) spent.add(pick.line.ref);
      onScreenPriority = pick.line.priority;
      const durationS = bubbleDurationS(pick.line.text, params);
      bubbleEndS = lastEndS = nowS + durationS;
      return { line: pick.line, speaker: pick.speaker, startS: nowS, durationS };
    },
  };
}
