// Learn by riding (the product spec, Career: "You learn the controls by riding event 1, with prompts
// that appear only as they become relevant. The steal prompt, for example, appears the first time a
// rival winds up." [decided for learn-by-riding; default for the timing]). Each prompt shows once
// per career, the first time its moment comes in a career race (the profile's `oncePerCareer`
// keeps `prompt:<id>`), so a flip prompt that event 1 never needed still comes at the first jump.
// Plain and never patronizing (the tone guide's onboarding row: `SWIPE DOWN ON ATTACK TO KICK.`).
// A pure reader of the sim's events and snapshots. DOM-free.
import type { SimEvent, SimSnapshot } from '../sim/api';

export interface Prompt {
  id: string;
  /** Touch words, then the keys in brackets. */
  text: string;
}

/** The prompts, by id, in the order a first race usually meets them. [default] */
export const PROMPTS: Readonly<Record<string, string>> = {
  ride: 'THUMB UP ON THE LEFT TO RIDE. [W]',
  fight: 'TAP HIT TO PUNCH. SWIPE DOWN ON IT TO KICK. [J] [K]',
  steal: 'HIT HIM AS HE SWINGS TO TAKE THE WEAPON.',
  down: 'TAP HIT TO SKIP THE RUN BACK. [SPACE]',
  cop: 'COP. HE ONLY BUSTS YOU IF HE KNOCKS YOU OFF.',
  air: 'IN THE AIR: HOLD BRAKE TO FLIP BACK, KICK TO FLIP FORWARD.',
  'near-miss': 'CLOSE PASSES PAY.',
};

/** Seconds into the race before the first prompt. */
const RIDE_AFTER_S = 1;
/** A rival this close (m, both ways) is close enough to hit. */
const REACH_S_M = 4;
const REACH_D_M = 2.2;

export interface Onboarding {
  /** Reads one step; returns a prompt to show now, or null. */
  note(events: readonly SimEvent[], snapshot: SimSnapshot, playerId: number): Prompt | null;
  /** The prompt ids shown so far (seen before this race included). */
  shown(): string[];
}

export function createOnboarding(seen: readonly string[]): Onboarding {
  const shown = new Set(seen.filter((f) => f.startsWith('prompt:')).map((f) => f.slice('prompt:'.length)));
  let ticks = 0;
  const show = (id: string): Prompt | null => {
    if (shown.has(id)) return null;
    const text = PROMPTS[id];
    if (!text) return null;
    shown.add(id);
    return { id, text };
  };
  return {
    note(events, snap, me) {
      ticks++;
      const self = snap.entities[me];
      if (!self) return null;
      if (ticks >= RIDE_AFTER_S * 60 && self.speed < 3 && self.mode === 'Road') {
        const p = show('ride');
        if (p) return p;
      }
      for (const e of events) {
        if (e.type === 'stealWindow' && e.target === me) {
          const p = show('steal');
          if (p) return p;
        }
        if (
          (e.type === 'crash' || e.type === 'takedown') &&
          (e.actor === me || e.target === me) &&
          self.mode !== 'Road'
        ) {
          const p = show('down');
          if (p) return p;
        }
        if (e.type === 'siren' && e.data['on'] === true) {
          const p = show('cop');
          if (p) return p;
        }
        if (e.type === 'jump' && e.actor === me) {
          const p = show('air');
          if (p) return p;
        }
        if (e.type === 'nearMiss' && e.actor === me) {
          const p = show('near-miss');
          if (p) return p;
        }
      }
      if (!shown.has('fight') && self.mode === 'Road') {
        const close = snap.entities.some(
          (o) =>
            o.id !== me &&
            o.kind === 'rider' &&
            o.faction !== 'law' &&
            o.mode === 'Road' &&
            o.road.edge === self.road.edge &&
            Math.abs(o.road.s - self.road.s) < REACH_S_M &&
            Math.abs(o.road.d - self.road.d) < REACH_D_M,
        );
        if (close) return show('fight');
      }
      return null;
    },
    shown: () => [...shown],
  };
}

/** The profile's once-per-career flags with these prompt ids added. */
export function withPromptsSeen(flags: readonly string[], ids: readonly string[]): string[] {
  return [...new Set([...flags, ...ids.map((id) => `prompt:${id}`)])].sort();
}
