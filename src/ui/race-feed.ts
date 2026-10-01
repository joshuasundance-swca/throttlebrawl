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

function cash(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** One style event's pop-up: its kind, its word and its cash (null when the event has none). */
export interface StylePop {
  kind: string;
  word: string;
  points: number | null;
}

/** A style event's pop-up, or null for anything else. */
export function stylePop(e: SimEvent): StylePop | null {
  if (e.type !== 'style') return null;
  const kind = e.data['kind'];
  const word = typeof kind === 'string' ? STYLE_WORDS[kind] : undefined;
  if (typeof kind !== 'string' || !word) return null;
  const points = e.data['points'];
  return { kind, word, points: typeof points === 'number' && Number.isFinite(points) ? points : null };
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
