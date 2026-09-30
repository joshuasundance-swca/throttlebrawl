// What the narrative remembers about the current race, from SimEvents only (it never reads sim
// internals), and the fact resolver built from it plus the snapshot. Until M4's career keeps
// grudges and history across races (docs/architecture.md, "Barks and narrative"), memory facts
// read from the current race: reset() at race start clears it. [default]
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../../sim/api';

type EntityId = number;
import type { FactResolver, FactValue } from './conditions';

/** Facts about the race's setting the app may pass along; unknown until it does. */
export interface NarrativeSetting {
  eventKind?: string;
  regionId?: string;
  timeOfDay?: string;
}

/**
 * In-race grudge points per noted grudge, on the 0–10 grudge scale. One noted grudge (a rival you
 * knocked off) reaches the "grudge of 4 or more" memory lines; two max it out. [default]
 */
export const GRUDGE_POINTS_PER_NOTE = 5;
const GRUDGE_MAX = 10;

export interface RaceMemory {
  /** Folds one tick's events in. */
  observe(events: readonly SimEvent[]): void;
  reset(): void;
  /** Takedowns `by` landed on `on` this race (takedown events, and knock-offs by health). */
  takedowns(by: EntityId, on: EntityId): number;
  /** Grudge points `holder` holds against `against` this race, 0..10. */
  grudge(holder: EntityId, against: EntityId): number;
  /** 1 while a cop chase runs (the siren is on), else 0. */
  readonly heat: number;
  readonly modifier: { kind?: string; id?: string };
}

const key = (a: EntityId, b: EntityId) => `${a}>${b}`;

export function createRaceMemory(): RaceMemory {
  let takedowns = new Map<string, number>();
  let downs = new Set<string>();
  let grudges = new Map<string, number>();
  let heat = 0;
  let modifier: { kind?: string; id?: string } = {};

  // One knock-down counts once: combat's knocked-off crash and combat-4's `health` takedown
  // describe the same fall, so they are keyed by the downed rider and the causing hit.
  const down = (by: EntityId, on: EntityId, cause: number | undefined, tick: number) => {
    const id = `${on}@${cause ?? `t${tick}`}`;
    if (downs.has(id)) return;
    downs.add(id);
    takedowns.set(key(by, on), (takedowns.get(key(by, on)) ?? 0) + 1);
  };

  return {
    observe(events) {
      for (const e of events) {
        switch (e.type) {
          case 'takedown':
            if (e.target !== undefined) down(e.actor, e.target, e.causeId, e.tick);
            break;
          case 'crash':
            // combat: actor = the rider knocked off, target = the attacker, data.reason knockedOff.
            if (e.data['reason'] === 'knockedOff' && e.target !== undefined)
              down(e.target, e.actor, e.causeId, e.tick);
            break;
          case 'grudgeNoted':
            if (e.target !== undefined)
              grudges.set(key(e.actor, e.target), (grudges.get(key(e.actor, e.target)) ?? 0) + 1);
            break;
          case 'siren':
            heat = e.data['on'] === true ? 1 : 0;
            break;
          case 'modifierStart': {
            const kind = e.data['kind'];
            const id = e.data['id'];
            modifier = {
              ...(typeof kind === 'string' ? { kind } : {}),
              ...(typeof id === 'string' ? { id } : {}),
            };
            break;
          }
          case 'modifierEnd':
            modifier = {};
            break;
          default:
            break;
        }
      }
    },
    reset() {
      takedowns = new Map();
      downs = new Set();
      grudges = new Map();
      heat = 0;
      modifier = {};
    },
    takedowns: (by, on) => takedowns.get(key(by, on)) ?? 0,
    grudge: (holder, against) =>
      Math.min(GRUDGE_MAX, (grudges.get(key(holder, against)) ?? 0) * GRUDGE_POINTS_PER_NOTE),
    get heat() {
      return heat;
    },
    get modifier() {
      return modifier;
    },
  };
}

export interface FactSources {
  snapshot: SimSnapshot;
  memory: RaceMemory;
  speaker: EntitySnapshot;
  target: EntitySnapshot | null;
  setting?: NarrativeSetting | null | undefined;
  /** A rider's bike class (`rat`, `scooter`…), from the registry; unknown when absent. */
  bikeClassOf?: ((riderContentId: string) => string | undefined) | undefined;
}

const frac = (e: EntitySnapshot | null) => (e && e.healthMax > 0 ? e.health / e.healthMax : undefined);
const weapon = (e: EntitySnapshot | null) => (e ? (e.heldWeapon ?? 'none') : undefined);

/**
 * The fact resolver for one speaker and target. `race.progress` is the human player's share of
 * the route (0..1), else the speaker's: the race as the player sees it. [default]
 */
export function factsFor(src: FactSources): FactResolver {
  const { snapshot, memory, speaker, target, setting } = src;
  return (fact: string): FactValue => {
    switch (fact) {
      case 'grudge.speakerTowardTarget':
        return target ? memory.grudge(speaker.id, target.id) : undefined;
      case 'grudge.targetTowardSpeaker':
        return target ? memory.grudge(target.id, speaker.id) : undefined;
      case 'history.takedowns.targetOnSpeaker':
        return target ? memory.takedowns(target.id, speaker.id) : undefined;
      case 'history.takedowns.speakerOnTarget':
        return target ? memory.takedowns(speaker.id, target.id) : undefined;
      case 'race.progress': {
        const len = snapshot.race?.routeLength ?? 0;
        const who = snapshot.entities.find((e) => e.kind === 'rider' && e.slot >= 0) ?? speaker;
        return len > 0 ? Math.min(1, Math.max(0, who.progress / len)) : undefined;
      }
      case 'race.position.speaker':
        return speaker.place;
      case 'race.position.target':
        return target?.place;
      case 'speaker.healthFrac':
        return frac(speaker);
      case 'target.healthFrac':
        return frac(target);
      case 'speaker.weapon':
        return weapon(speaker);
      case 'target.weapon':
        return weapon(target);
      case 'target.bikeClass':
        return target ? src.bikeClassOf?.(target.contentId) : undefined;
      case 'heat.level':
        return memory.heat;
      case 'modifier.kind':
        return memory.modifier.kind;
      case 'modifier.id':
        return memory.modifier.id;
      case 'event.kind':
        return setting?.eventKind;
      case 'region.id':
        return setting?.regionId;
      case 'timeOfDay':
        return setting?.timeOfDay;
      // history.lastRace.*, history.racesTogether and flags.* need the career (M4): unknown.
      default:
        return undefined;
    }
  };
}
