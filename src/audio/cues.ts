// SimEvent -> sound cue (docs/architecture.md, "Audio": SFX are event-driven). M1's cues are all
// synthesized (cue-patches.ts). The table is keyed by string, not by the SimEventType union, so a
// contract PR that adds an event type never breaks this module; audio.test.ts lists the M1 types
// and says which one still needs a decision.
import type { SimEvent } from '../sim/api';

export const CUE_IDS = [
  'punch',
  'kick',
  'hit',
  'miss',
  'crash',
  'land',
  'grab',
  'horn',
  'truckHorn',
  'sirenWhoop',
  'go',
  'finish',
] as const;
export type CueId = (typeof CUE_IDS)[number];

/** A cue for each event type, or null for a deliberate silence. */
export const EVENT_CUES: Readonly<Record<string, CueId | null>> = {
  raceStart: 'go',
  raceEnd: null,
  finish: 'finish',
  overtake: null,
  lapOrCheckpoint: null,
  // The wind-up stays quiet; the swing is heard when it lands (hit, kick) or whiffs (miss).
  attackStart: null,
  attackMiss: 'miss',
  hit: 'punch', // refined by weapon in cueForEvent
  kick: 'kick',
  weaponGrab: 'grab',
  crash: 'crash',
  takedown: 'crash',
  nearMiss: null, // the horn telegraph already covers the pass
  bust: 'sirenWhoop',
  jump: null,
  land: 'land',
  pedDive: null,
  cashAward: null,
  style: null,
  modifierStart: null,
  modifierEnd: null,
  // cops-1 promises "a siren cue event"; any type naming a siren gets the whoop (see cueForEvent).
  siren: 'sirenWhoop',
};

/** Event types that make a sound. */
export const SOUNDING_EVENTS = Object.keys(EVENT_CUES).filter((t) => EVENT_CUES[t] !== null);

const PRIORITY: Readonly<Record<CueId, number>> = {
  crash: 75,
  kick: 70,
  punch: 68,
  hit: 70,
  miss: 45,
  land: 50,
  grab: 55,
  horn: 60,
  truckHorn: 62,
  sirenWhoop: 65,
  go: 85,
  finish: 85,
};

/** Added to a cue's priority when the player is the actor or the target. */
const PLAYER_BONUS = 20;

export interface CueChoice {
  cue: CueId;
  priority: number;
  playerInvolved: boolean;
}

export function cueForEvent(e: SimEvent, playerId: number): CueChoice | null {
  const type: string = e.type;
  let cue = Object.hasOwn(EVENT_CUES, type) ? (EVENT_CUES[type] ?? null) : null;
  if (!Object.hasOwn(EVENT_CUES, type) && /siren/i.test(type)) cue = 'sirenWhoop';
  if (cue === null) return null;
  if (type === 'hit') {
    const w = e.data['weapon'];
    if (w === 'kick') cue = 'kick';
    else if (typeof w === 'string' && w !== 'punch' && e.data['unarmed'] !== true) cue = 'hit';
  }
  const playerInvolved = e.actor === playerId || e.target === playerId;
  return { cue, priority: PRIORITY[cue] + (playerInvolved ? PLAYER_BONUS : 0), playerInvolved };
}
