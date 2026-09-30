// The end of a race for the player (app-2's state machine: race, then results or "Busted"). The
// sim's race runs on until the rest of the field is home or the race-end timeout passes (riders-3),
// but the player's own race is over at their finish or their bust: the results screen comes up a
// short beat later, so the line (or the cuffs) is seen, and nobody waits out a 30 s timeout. [default]
import { secondsToTicks, type SimEvent, type SimSnapshot } from '../sim/api';

/** The beat between the player's finish or bust and the results screen: 2 s. */
export const RESULTS_BEAT_TICKS = secondsToTicks(2);

export interface PlayerOutcome {
  /** The tick the player finished or was busted, or null while still racing. */
  readonly doneTick: number | null;
  /** The bust, when the law took the player out. */
  readonly bust: { fineCash: number } | null;
  /** Reads one step's events for the player's finish or bust. */
  note(events: readonly SimEvent[], playerId: number, tick: number): void;
}

export function createOutcome(): PlayerOutcome {
  let doneTick: number | null = null;
  let bust: { fineCash: number } | null = null;
  return {
    get doneTick() {
      return doneTick;
    },
    get bust() {
      return bust;
    },
    note(events, playerId, tick) {
      for (const e of events) {
        if (e.type === 'bust' && e.target === playerId && !bust) {
          const fine = e.data['fineCash'];
          bust = { fineCash: typeof fine === 'number' ? fine : 0 };
          doneTick ??= tick;
        } else if (e.type === 'finish' && e.actor === playerId) doneTick ??= tick;
      }
    },
  };
}

/** Whether the results screen is due: a beat after the player is done, or once the race is over. */
export function resultsDue(outcome: PlayerOutcome, tick: number, raceOver: boolean): boolean {
  if (raceOver) return true;
  return outcome.doneTick !== null && tick >= outcome.doneTick + RESULTS_BEAT_TICKS;
}

export interface ResultEvent {
  id: string;
  name?: string | undefined;
  byPlaceCash: readonly number[];
}

export interface PlayerResult {
  place: number;
  of: number;
  prizeCash: number;
  eventName: string;
  busted?: boolean;
  fineCash?: number;
}

/** The results screen's numbers: the place among the racers (never the law) and its prize, or the bust. */
export function raceResult(
  snapshot: SimSnapshot,
  playerId: number,
  outcome: PlayerOutcome,
  event: ResultEvent,
): PlayerResult {
  const racers = snapshot.entities.filter((e) => e.kind === 'rider' && e.faction !== 'law').length;
  const me = snapshot.entities[playerId];
  const order = snapshot.race.finishOrder;
  const place = me ? (order.includes(playerId) ? order.indexOf(playerId) + 1 : me.place) : 0;
  const eventName = event.name ?? event.id;
  if (outcome.bust)
    return { place, of: racers, prizeCash: 0, eventName, busted: true, fineCash: outcome.bust.fineCash };
  return { place, of: racers, prizeCash: event.byPlaceCash[place - 1] ?? 0, eventName };
}
