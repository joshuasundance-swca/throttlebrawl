// Turns sim events into bark requests (docs/architecture.md, "Barks and narrative": it never reads
// sim internals; everything arrives as snapshot fields and events). M1 maps three events:
//   raceStart -> `race-start`, spoken by one of the rivals, to the player;
//   overtake  -> `overtake`, spoken by the overtaker, about the rider passed;
//   hit       -> `hit-landed`, spoken by the attacker, about the rider hit.
// Only AI riders speak (slot -1). It holds no DOM: the view is injected, so it is unit-tested.
import { SIM_HZ, type EntitySnapshot, type SimEvent, type SimSnapshot } from '../../sim/api';
import type { BarkSelector, BarkTarget } from './selector';

/** What the app hands along with each tick's events. */
export interface NarrativeContext {
  snapshot: SimSnapshot;
  /** The race seed: the presentation stream is seeded from it at race start. */
  seed: number;
}

export interface ShownBark {
  contentRef: string;
  speakerName: string;
  text: string;
  startS: number;
  durationS: number;
}

export interface BarkView {
  show(bark: ShownBark): void;
  hide(): void;
}

export interface BarkDirector {
  onEvents(events: readonly SimEvent[], context?: NarrativeContext | null): void;
}

const isRival = (e: EntitySnapshot | undefined): e is EntitySnapshot =>
  !!e && e.kind === 'rider' && e.slot < 0 && e.faction !== 'law';

function asTarget(e: EntitySnapshot | undefined): BarkTarget | null {
  return e && e.kind === 'rider' ? { contentRef: e.contentId, isPlayer: e.slot >= 0 } : null;
}

export function createBarkDirector(selector: BarkSelector, view: BarkView): BarkDirector {
  const say = (
    trigger: string,
    speakers: readonly EntitySnapshot[],
    target: BarkTarget | null,
    nowS: number,
  ) => {
    if (!speakers.length) return;
    const bark = selector.request({ trigger, speakers: speakers.map((s) => s.contentId), target, nowS });
    if (!bark) return;
    const who = speakers.find((s) => s.contentId === bark.speaker);
    view.show({
      contentRef: bark.line.ref,
      speakerName: who?.name ?? bark.speaker,
      text: bark.line.text,
      startS: bark.startS,
      durationS: bark.durationS,
    });
  };

  return {
    onEvents(events, context) {
      // Without the snapshot nobody can be named, so the narrative stays silent.
      if (!context) return;
      const entities = context.snapshot.entities;
      const byId = (id: number | undefined) =>
        id === undefined ? undefined : entities.find((e) => e.id === id);
      for (const e of events) {
        const nowS = e.tick / SIM_HZ;
        switch (e.type) {
          case 'raceStart': {
            selector.reset(context.seed);
            view.hide();
            const player = entities.find((x) => x.kind === 'rider' && x.slot >= 0);
            say('race-start', entities.filter(isRival), asTarget(player), nowS);
            break;
          }
          case 'overtake':
          case 'hit': {
            const speaker = byId(e.actor);
            if (!isRival(speaker)) break;
            say(e.type === 'hit' ? 'hit-landed' : 'overtake', [speaker], asTarget(byId(e.target)), nowS);
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
