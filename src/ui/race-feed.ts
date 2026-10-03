// What ui reads from the race's events (docs/milestones/M2.md, ui-3): the short style pop-ups
// ("NEAR MISS", "ONCOMING", "AIRTIME") and the player's takedowns and style cash for the results
// screen. Pure logic, no DOM. Style events come from sim/race (riders-5) and takedowns from
// combat-4; until those land nothing pops and the tally reads zero.
//
// Playtest 1c, 2026-09-30 [decided]: the pop-ups got in the way of the road ahead. Repeats of a kind
// now merge into the pop-up already up ("NEAR MISS ×3", their cash summed) instead of stacking, so
// a run of near misses is one small chip. The stack below is that model; index.ts draws it.
import type { SimEvent } from '../sim/api';

/** The pop-up words, in the tone guide's plain, dry voice. */
const STYLE_WORDS: Readonly<Record<string, string>> = {
  nearMiss: 'NEAR MISS',
  oncoming: 'ONCOMING',
  airtime: 'AIRTIME',
  takedownCombo: 'COMBO',
  weaponSteal: 'STOLEN',
};

/** A landed trick's word (playtest 2, 2026-10-02: flips), by `data.trick`. */
const TRICK_WORDS: Readonly<Record<string, string>> = {
  backflip: 'BACKFLIP',
  frontflip: 'FRONT FLIP',
  wheelie: 'WHEELIE',
  whip: 'WHIP',
};
const FLIP_COUNT = ['', '', 'DOUBLE ', 'TRIPLE ', 'QUADRUPLE '];

/** A trick pop-up's word: the trick, with a double or triple flip named so. */
function trickWord(e: SimEvent): string | undefined {
  const trick = e.data['trick'];
  const word = typeof trick === 'string' ? TRICK_WORDS[trick] : undefined;
  if (!word) return undefined;
  const flips = Number(e.data['flips'] ?? 0);
  return `${FLIP_COUNT[Math.min(flips, FLIP_COUNT.length - 1)] ?? ''}${word}`;
}

function cash(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** One style event's pop-up: its kind, its word and its cash (null when the event has none). */
export interface StylePop {
  kind: string;
  word: string;
  points: number | null;
}

/** A domino takedown's word (W-Q): the first rider a launched body takes out, then the next. */
function dominoWord(chain: number): string {
  return chain >= 3 ? 'STRIKE' : 'DOUBLE';
}

/** A style event's pop-up, or null for anything else. */
export function stylePop(e: SimEvent): StylePop | null {
  if (e.type !== 'style') return null;
  const domino = e.data['domino'];
  if (e.data['kind'] === 'takedownCombo' && typeof domino === 'number' && domino >= 2) {
    const points = e.data['points'];
    return {
      kind: 'domino',
      word: dominoWord(domino),
      points: typeof points === 'number' && Number.isFinite(points) ? points : null,
    };
  }
  const raw = e.data['kind'];
  // Each trick pops (and merges repeats) as its own kind: two backflips are "BACKFLIP ×2".
  const word = raw === 'trick' ? trickWord(e) : typeof raw === 'string' ? STYLE_WORDS[raw] : undefined;
  if (typeof raw !== 'string' || !word) return null;
  const kind = raw === 'trick' ? `trick:${word}` : raw;
  const points = e.data['points'];
  return { kind, word, points: typeof points === 'number' && Number.isFinite(points) ? points : null };
}

/**
 * The 'found it' stamp (W-Q): a player's first time off a shortcut this race, with the seconds it
 * saved (`shortcutFound`'s data.savedS), as its own chip: `FOUND IT -2.4 S`. Null for anything else.
 */
export function foundPop(e: SimEvent): StylePop | null {
  if (e.type !== 'shortcutFound') return null;
  const saved = e.data['savedS'];
  const word =
    typeof saved === 'number' && Number.isFinite(saved) && saved > 0
      ? `FOUND IT -${saved.toFixed(1)} S`
      : 'FOUND IT';
  return { kind: 'found', word, points: null };
}

/**
 * A named takedown (run W-T, "the road fights back"): a rider knocked into a roadside smashable
 * went down, and the smashable names it (`smash`'s data.name, such as `CATCH OF THE DAY`). Null for
 * anything else, and for a smashable merely ridden through.
 */
export function smashPop(e: SimEvent): StylePop | null {
  if (e.type !== 'smash' || e.data['takedown'] !== true) return null;
  const name = e.data['name'];
  if (typeof name !== 'string' || name === '') return null;
  return { kind: `smash:${name}`, word: name, points: null };
}

/** A style event's pop-up in one line, such as `NEAR MISS +$50`, or null for anything else. */
export function styleText(e: SimEvent): string | null {
  const pop = stylePop(e);
  if (!pop) return null;
  return pop.points === null ? pop.word : `${pop.word} +${cash(pop.points)}`;
}

/** One pop-up on screen: every repeat of its kind while it is up, with their cash summed. */
export interface PopEntry {
  readonly kind: string;
  readonly word: string;
  count: number;
  cash: number;
  /** Whether any of its events carried cash. */
  hasCash: boolean;
}

/** The pop-up's word, with the repeat count once there is more than one: `NEAR MISS ×3`. */
export function popLabel(e: PopEntry): string {
  return e.count > 1 ? `${e.word} ×${e.count}` : e.word;
}

/** The pop-up's cash, such as `+$75`, or an empty string when its events carried none. */
export function popCash(e: PopEntry): string {
  return e.hasCash ? `+${cash(e.cash)}` : '';
}

export interface PopStack {
  /**
   * Adds a pop-up. A kind already up takes it (merged: the count and cash grow, its place stays);
   * otherwise a new entry goes at the end and the oldest past the cap drop out.
   */
  add(pop: StylePop): { entry: PopEntry; merged: boolean; dropped: PopEntry[] };
  /** Takes an entry off (its time ran out). Removing one already gone does nothing. */
  remove(entry: PopEntry): void;
  /** The entries up, oldest first. */
  entries(): readonly PopEntry[];
  clear(): void;
}

export function createPopStack(max: number): PopStack {
  let up: PopEntry[] = [];
  return {
    add(pop) {
      const same = up.find((e) => e.kind === pop.kind);
      if (same) {
        same.count++;
        if (pop.points !== null) {
          same.cash += pop.points;
          same.hasCash = true;
        }
        return { entry: same, merged: true, dropped: [] };
      }
      const entry: PopEntry = {
        kind: pop.kind,
        word: pop.word,
        count: 1,
        cash: pop.points ?? 0,
        hasCash: pop.points !== null,
      };
      up.push(entry);
      const dropped = up.length > max ? up.splice(0, up.length - max) : [];
      return { entry, merged: false, dropped };
    },
    remove(entry) {
      up = up.filter((e) => e !== entry);
    },
    entries: () => up,
    clear() {
      up = [];
    },
  };
}

/**
 * A style run in progress, as the snapshot carries it (`EntitySnapshot.styleRun`, #192): an
 * oncoming stretch or a jump, its world seconds so far, the cash it would score if it ended now,
 * and whether it has lasted long enough to score.
 */
export interface MeterRun {
  kind: 'oncoming' | 'airtime';
  seconds: number;
  cash: number;
  qualifies: boolean;
}

/** The live meter's words: the kind and its seconds, such as `ONCOMING 4.2s`. */
export function meterLabel(run: MeterRun): string {
  return `${STYLE_WORDS[run.kind] ?? run.kind.toUpperCase()} ${run.seconds.toFixed(1)}s`;
}

/** The live meter's cash, such as `+$212`. */
export function meterCash(run: MeterRun): string {
  return `+${cash(run.cash)}`;
}

/** One frame of the meter: the run to show (null for none), and the run that just ended, if any. */
export interface MeterStep {
  shown: MeterRun | null;
  /** The last value shown of a run that stopped this frame: it lands on its award, or fades. */
  ended: MeterRun | null;
}

export interface StyleMeter {
  /**
   * Reads the player's run in progress. A run shows once it has lasted `showAfterS` world seconds;
   * when it stops (no run, another kind, or its seconds fell because a new stretch began), the
   * last value shown comes back as `ended`.
   */
  update(run: MeterRun | null | undefined, showAfterS: number): MeterStep;
  /** The run on show, or null. */
  readonly showing: MeterRun | null;
  reset(): void;
}

/**
 * The live style meter (playtest 1c, [decided] 2026-09-30, the maintainer: "I'd like to also watch
 * oncoming go up and up as you ride"). Pure: index.ts draws it in the pop-up stack.
 */
export function createStyleMeter(): StyleMeter {
  let showing: MeterRun | null = null;
  const valid = (run: MeterRun | null | undefined): run is MeterRun =>
    !!run && STYLE_WORDS[run.kind] !== undefined && Number.isFinite(run.seconds) && Number.isFinite(run.cash);
  return {
    update(run, showAfterS) {
      const next = valid(run) ? { ...run } : null;
      const same = !!showing && !!next && next.kind === showing.kind && next.seconds >= showing.seconds;
      const ended = showing && !same ? showing : null;
      showing = next && (same || next.seconds >= showAfterS) ? next : null;
      return { shown: showing, ended };
    },
    get showing() {
      return showing;
    },
    reset() {
      showing = null;
    },
  };
}

export interface RaceTally {
  /** Feeds one step's events; `playerId` is the player's entity id. */
  onEvents(events: readonly SimEvent[], playerId: number): void;
  /** The player's `styleTally` from the latest snapshot, which wins over the summed events. */
  noteSnapshotTally(styleTally: number | undefined): void;
  /** The pop-ups raised since the last call, oldest first. */
  takePopups(): StylePop[];
  reset(): void;
  readonly takedowns: number;
  readonly styleCash: number;
}

export function createRaceTally(): RaceTally {
  let takedowns = 0;
  let summed = 0;
  let fromSnapshot: number | null = null;
  let popups: StylePop[] = [];
  return {
    onEvents(events, playerId) {
      for (const e of events) {
        if (e.actor !== playerId) continue;
        if (e.type === 'takedown') takedowns++;
        else if (e.type === 'style') {
          const points = e.data['points'];
          if (typeof points === 'number' && Number.isFinite(points)) summed += points;
          const pop = stylePop(e);
          if (pop) popups.push(pop);
        } else if (e.type === 'shortcutFound') {
          const pop = foundPop(e);
          if (pop) popups.push(pop);
        } else if (e.type === 'smash') {
          const pop = smashPop(e);
          if (pop) popups.push(pop);
        }
      }
    },
    noteSnapshotTally(styleTally) {
      if (typeof styleTally === 'number' && Number.isFinite(styleTally)) fromSnapshot = styleTally;
    },
    takePopups() {
      const out = popups;
      popups = [];
      return out;
    },
    reset() {
      takedowns = 0;
      summed = 0;
      fromSnapshot = null;
      popups = [];
    },
    get takedowns() {
      return takedowns;
    },
    get styleCash() {
      return fromSnapshot ?? summed;
    },
  };
}
