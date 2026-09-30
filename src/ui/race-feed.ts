// What ui reads from the race's events (docs/milestones/M2.md, ui-3): the short style pop-ups
// ("NEAR MISS", "ONCOMING", "AIRTIME") and the player's takedowns and style cash for the results
// screen. Pure logic, no DOM. Style events come from sim/race (riders-5) and takedowns from
// combat-4; until those land nothing pops and the tally reads zero.
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

/** A style event's pop-up, such as `NEAR MISS +$50`, or null for anything else. */
export function styleText(e: SimEvent): string | null {
  if (e.type !== 'style') return null;
  const kind = e.data['kind'];
  const word = typeof kind === 'string' ? STYLE_WORDS[kind] : undefined;
  if (!word) return null;
  const points = e.data['points'];
  return typeof points === 'number' && Number.isFinite(points) ? `${word} +${cash(points)}` : word;
}

export interface RaceTally {
  /** Feeds one step's events; `playerId` is the player's entity id. */
  onEvents(events: readonly SimEvent[], playerId: number): void;
  /** The player's `styleTally` from the latest snapshot, which wins over the summed events. */
  noteSnapshotTally(styleTally: number | undefined): void;
  /** The pop-ups raised since the last call, oldest first. */
  takePopups(): string[];
  reset(): void;
  readonly takedowns: number;
  readonly styleCash: number;
}

export function createRaceTally(): RaceTally {
  let takedowns = 0;
  let summed = 0;
  let fromSnapshot: number | null = null;
  let popups: string[] = [];
  return {
    onEvents(events, playerId) {
      for (const e of events) {
        if (e.actor !== playerId) continue;
        if (e.type === 'takedown') takedowns++;
        else if (e.type === 'style') {
          const points = e.data['points'];
          if (typeof points === 'number' && Number.isFinite(points)) summed += points;
          const text = styleText(e);
          if (text) popups.push(text);
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
