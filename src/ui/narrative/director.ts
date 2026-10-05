// Turns sim events into bark requests (docs/architecture.md, "Barks and narrative": it never reads
// sim internals; everything arrives as snapshot fields and events). The speaker is always the
// rider the trigger is about, as in `hit-landed`; only AI riders speak (slot -1), and a cop only on
// his own triggers (run W-T, below).
//   raceStart -> `race-start`, spoken by one of the rivals, to the player;
//   overtake  -> `overtake`, spoken by the overtaker, about the rider passed;
//   hit       -> `hit-landed`, spoken by the attacker, about the rider hit.
// M2 (narrative-2) adds [default]:
//   takedown (data.kind traffic) -> `takedown-into-traffic`, spoken by the rider credited, about
//     the rider who went down;
//   takedown, or combat's knocked-off crash -> `knocked-down-by-target`, spoken by the rider who
//     went down, about the rider credited (one fall is one bark, however many events describe it);
//   crash with nobody to blame -> `crash-self`, spoken by the rider who crashed;
//   nearMiss -> `near-miss`, spoken by the rider who scraped past.
// W-Q (the pitch deck's item 11, "fill the dead air after a crash: rivals riding past heckle you"):
//   overtake of a rider who is down (in the tumble or on foot) -> `knocked-down-target`, the
//     heckle, spoken by the rival riding past, about the rider down; with no line to say, the
//     plain `overtake` as before. [default]
// W-P road events [default]:
//   modifierStart -> `modifier-start`, spoken by one of the rivals, to the player, as a road event
//     (a set piece: roadwork, a parade, a speed trap...) comes up; lines pick their event with a
//     `modifier.id` (or `modifier.kind`) condition, which the race memory holds from the event.
// Run W-T (law with a personality) [default], each spoken by the cop (faction law), about the player:
//   siren on -> `cop-siren`; bust -> `busted`; law (data.kind) -> `cop-relentless`, `cop-radar` (only
//   a reading over the limit), `cop-citation`, `cop-bill`, `cop-budget-out`, `cop-jurisdiction`.
// Memory facts for `when` conditions come from the current race (memory.ts). It holds no DOM: the
// view is injected, so it is unit-tested.
import { SIM_HZ, type EntitySnapshot, type SimEvent, type SimSnapshot } from '../../sim/api';
import { createRaceMemory, factsFor, type NarrativeSetting } from './memory';
import type { BarkSelector, BarkTarget } from './selector';

/** What the app hands along with each tick's events. */
export interface NarrativeContext {
  snapshot: SimSnapshot;
  /** The race seed: the presentation stream is seeded from it at race start. */
  seed: number;
  /** Names this race in "cut this" flags; `seed-<seed>` when absent. */
  raceId?: string;
  /** The event kind, region and time of day, for `when` conditions; unknown when absent. */
  setting?: NarrativeSetting | null;
}

export interface ShownBark {
  contentRef: string;
  speakerName: string;
  text: string;
  startS: number;
  durationS: number;
  /** The sim tick it started on, and the race, for a "cut this" flag. */
  tick: number;
  raceId: string;
  /**
   * What the strip item is when it is not a rival's or cop's bark: `line` is the landing one-liner,
   * which has no speaker and is listed as a sign ("cut this" names it by its words alone).
   */
  strip?: 'line';
}

export interface BarkView {
  show(bark: ShownBark): void;
  hide(): void;
}

export interface BarkDirector {
  onEvents(events: readonly SimEvent[], context?: NarrativeContext | null): void;
}

export interface BarkDirectorOptions {
  /** A rider's bike class, for `target.bikeClass`. */
  bikeClassOf?: (riderContentId: string) => string | undefined;
  /** Called for every bark shown (the "recently seen" list). */
  onShown?: (bark: ShownBark) => void;
}

const isRival = (e: EntitySnapshot | undefined): e is EntitySnapshot =>
  !!e && e.kind === 'rider' && e.slot < 0 && e.faction !== 'law';

const isRider = (e: EntitySnapshot | undefined): e is EntitySnapshot => !!e && e.kind === 'rider';

const isLaw = (e: EntitySnapshot | undefined): e is EntitySnapshot =>
  !!e && e.kind === 'rider' && e.slot < 0 && e.faction === 'law';

/** A `law` event's kind (run W-T) to the bark trigger its cop speaks. */
const LAW_TRIGGERS: Readonly<Record<string, string>> = {
  relentless: 'cop-relentless',
  radar: 'cop-radar',
  citation: 'cop-citation',
  bill: 'cop-bill',
  budgetOut: 'cop-budget-out',
  jurisdiction: 'cop-jurisdiction',
};

function asTarget(e: EntitySnapshot | null | undefined): BarkTarget | null {
  return e && e.kind === 'rider' ? { contentRef: e.contentId, isPlayer: e.slot >= 0 } : null;
}

/** The race id a flag carries when the app names none. */
export const raceIdOf = (context: NarrativeContext): string => context.raceId ?? `seed-${context.seed}`;

export function createBarkDirector(
  selector: BarkSelector,
  view: BarkView,
  options: BarkDirectorOptions = {},
): BarkDirector {
  const memory = createRaceMemory();

  const say = (
    context: NarrativeContext,
    trigger: string,
    speakers: readonly EntitySnapshot[],
    target: EntitySnapshot | null,
    tick: number,
  ): boolean => {
    if (!speakers.length) return false;
    const bark = selector.request({
      trigger,
      speakers: speakers.map((s) => s.contentId),
      target: asTarget(target),
      nowS: tick / SIM_HZ,
      facts: (speakerId) => {
        const speaker = speakers.find((s) => s.contentId === speakerId);
        if (!speaker) return undefined;
        return factsFor({
          snapshot: context.snapshot,
          memory,
          speaker,
          target,
          setting: context.setting,
          bikeClassOf: options.bikeClassOf,
        });
      },
    });
    if (!bark) return false;
    const who = speakers.find((s) => s.contentId === bark.speaker);
    const shown: ShownBark = {
      contentRef: bark.line.ref,
      speakerName: who?.name ?? bark.speaker,
      text: bark.line.text,
      startS: bark.startS,
      durationS: bark.durationS,
      tick,
      raceId: raceIdOf(context),
    };
    view.show(shown);
    options.onShown?.(shown);
    return true;
  };

  return {
    onEvents(events, context) {
      // Without the snapshot nobody can be named, so the narrative stays silent.
      if (!context) return;
      const entities = context.snapshot.entities;
      const byId = (id: number | undefined) =>
        id === undefined ? undefined : entities.find((e) => e.id === id);
      // Riders a takedown names this tick: their crash is not a crash-self, and one fall barks once.
      const takenDown = new Set<number>();
      for (const e of events) if (e.type === 'takedown' && e.target !== undefined) takenDown.add(e.target);
      const fallBarked = new Set<number>();
      const knockedDown = (
        downed: EntitySnapshot | undefined,
        by: EntitySnapshot | undefined,
        tick: number,
      ) => {
        if (!isRival(downed) || fallBarked.has(downed.id)) return;
        fallBarked.add(downed.id);
        say(context, 'knocked-down-by-target', [downed], isRider(by) ? by : null, tick);
      };

      for (const e of events) {
        if (e.type === 'raceStart') {
          selector.reset(context.seed);
          memory.reset();
        }
        memory.observe([e]);
        switch (e.type) {
          case 'raceStart': {
            view.hide();
            const player = entities.find((x) => x.kind === 'rider' && x.slot >= 0);
            say(context, 'race-start', entities.filter(isRival), player ?? null, e.tick);
            break;
          }
          case 'overtake':
          case 'hit': {
            const speaker = byId(e.actor);
            if (!isRival(speaker)) break;
            const target = byId(e.target);
            const down = isRider(target) && (target.mode === 'Tumble' || target.mode === 'OnFoot');
            if (
              e.type === 'overtake' &&
              down &&
              say(context, 'knocked-down-target', [speaker], target, e.tick)
            )
              break;
            say(
              context,
              e.type === 'hit' ? 'hit-landed' : 'overtake',
              [speaker],
              isRider(target) ? target : null,
              e.tick,
            );
            break;
          }
          case 'takedown': {
            const credited = byId(e.actor);
            const downed = byId(e.target);
            if (e.data['kind'] === 'traffic' && isRival(credited)) {
              say(context, 'takedown-into-traffic', [credited], isRider(downed) ? downed : null, e.tick);
            }
            knockedDown(downed, credited, e.tick);
            break;
          }
          case 'crash': {
            const rider = byId(e.actor);
            if (e.data['reason'] === 'knockedOff') {
              // combat: actor = the rider knocked off, target = the attacker.
              knockedDown(rider, byId(e.target), e.tick);
            } else if (isRival(rider) && !takenDown.has(rider.id)) {
              say(context, 'crash-self', [rider], null, e.tick);
            }
            break;
          }
          case 'nearMiss': {
            const rider = byId(e.actor);
            if (isRival(rider)) say(context, 'near-miss', [rider], null, e.tick);
            break;
          }
          case 'modifierStart': {
            const player = entities.find((x) => x.kind === 'rider' && x.slot >= 0);
            say(context, 'modifier-start', entities.filter(isRival), player ?? null, e.tick);
            break;
          }
          case 'siren':
          case 'bust':
          case 'law': {
            // Run W-T (law with a personality): the cop speaks for himself, on his siren, his bust
            // and his habit showing (a radar reading only when it caught you over the limit).
            const cop = byId(e.actor);
            if (!isLaw(cop)) break;
            const trigger =
              e.type === 'siren'
                ? e.data['on'] === true
                  ? 'cop-siren'
                  : null
                : e.type === 'bust'
                  ? 'busted'
                  : e.data['kind'] === 'radar' && e.data['over'] !== true
                    ? null
                    : (LAW_TRIGGERS[String(e.data['kind'])] ?? null);
            if (!trigger) break;
            const target = byId(e.target) ?? entities.find((x) => x.kind === 'rider' && x.slot >= 0);
            say(context, trigger, [cop], isRider(target) ? target : null, e.tick);
            break;
          }
          case 'raceEnd':
            view.hide();
            break;
          default:
            break;
        }
      }
    },
  };
}
