// SimEvent -> sound cue (docs/architecture.md, "Audio": SFX are event-driven). Every cue is
// synthesized (cue-patches.ts). The table is keyed by string, not by the SimEventType union, so a
// contract PR that adds an event type never breaks this module; cues.test.ts lists the event types
// and says which one still needs a decision. M2 (audio-2) adds the takedown stinger, the slow-motion
// whooshes, the rail clang, the splash, the respawn blip, the style-cash chime, the steal glint, the
// wobble and the near-miss whoosh, and scales crashes by how hard they hit.
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
  'takedown',
  'slowIn',
  'slowOut',
  'railClang',
  'splash',
  'respawn',
  'cash',
  'glint',
  'wobble',
  'passBy',
  'boost',
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
  // A held weapon's snatch window opens: a glint you can hear, so the steal is fair.
  stealWindow: 'glint',
  // A brush, a scrape or a rough landing: a short tyre squeal.
  wobble: 'wobble',
  crash: 'crash', // layered by impact in cueForEvent
  // The victim's crash already sounds; the takedown adds the stinger that says "you did that".
  takedown: 'takedown',
  // The horn telegraphed the car; the player's own close pass gets a whoosh.
  nearMiss: 'passBy',
  bust: 'sirenWhoop',
  // cops-1's chase cue; any other type naming a siren gets the whoop too (see cueForEvent).
  siren: 'sirenWhoop',
  jump: null,
  land: 'land',
  pedDive: null,
  cashAward: null,
  // Style cash scored: a small chime, for the player only.
  style: 'cash',
  // The slow motion's way in and out; the effects bus treatment itself is slowmo.ts.
  slowmoStart: 'slowIn',
  slowmoEnd: 'slowOut',
  railOver: 'railClang',
  splash: 'splash',
  respawn: 'respawn',
  // A boost pad (playtest 1b quick wins): a rising whoosh, heard for anyone, quieter with distance.
  boost: 'boost',
  // The get-up, fist shake and grudge are seen (render, HUD) and said (barks); a sound would
  // step on the rival's bark.
  getUp: null,
  fistShake: null,
  grudgeNoted: null,
  modifierStart: null,
  modifierEnd: null,
};

/** Event types that make a sound. */
export const SOUNDING_EVENTS = Object.keys(EVENT_CUES).filter((t) => EVENT_CUES[t] !== null);

/**
 * Cues heard only when the player is the actor: their own style cash, their own respawn and their
 * own close passes. A rival scoring style is not news.
 */
export const PLAYER_ONLY_EVENTS: ReadonlySet<string> = new Set(['style', 'respawn', 'nearMiss']);

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
  takedown: 80,
  slowIn: 78,
  slowOut: 72,
  railClang: 72,
  splash: 76,
  respawn: 58,
  cash: 52,
  glint: 64,
  wobble: 48,
  passBy: 46,
  boost: 58,
};

/** Added to a cue's priority when the player is the actor or the target. */
const PLAYER_BONUS = 20;

export interface CueChoice {
  cue: CueId;
  priority: number;
  playerInvolved: boolean;
  /** 0..1: how hard it hit. Crash cues add layers with it; other cues use 1. */
  impact: number;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const num = (e: SimEvent, key: string): number | null => {
  const v = e.data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/**
 * How hard a crash hit, 0..1, from what the sim reports about it: the speed into a barrier, the
 * landing's vertical speed, a big vehicle, or failing all those the rider's speed (from the
 * snapshot). A 40 m/s (about 90 mph) wipeout is a full-size crash. [default]
 */
export function crashImpact(e: SimEvent, riderSpeedMps: number | null): number {
  const across = num(e, 'impactMps');
  const vertical = num(e, 'verticalMps');
  const speed = num(e, 'speed') ?? riderSpeedMps ?? 25;
  let impact = clamp01(speed / 40);
  if (across !== null) impact = Math.max(impact, clamp01(across / 14));
  if (vertical !== null) impact = Math.max(impact, clamp01(vertical / 12));
  if (e.data['cause'] === 'traffic') impact = Math.max(impact, e.data['hazard'] === 'big' ? 0.85 : 0.6);
  if (e.data['cause'] === 'splash') impact = 1;
  return impact;
}

export function cueForEvent(
  e: SimEvent,
  playerId: number,
  riderSpeedMps: number | null = null,
): CueChoice | null {
  const type: string = e.type;
  let cue = Object.hasOwn(EVENT_CUES, type) ? (EVENT_CUES[type] ?? null) : null;
  if (!Object.hasOwn(EVENT_CUES, type) && /siren/i.test(type)) cue = 'sirenWhoop';
  if (cue === null) return null;
  if (PLAYER_ONLY_EVENTS.has(type) && e.actor !== playerId) return null;
  // cops-1's siren event carries `on`; only the start of a chase whoops.
  if (type === 'siren' && e.data['on'] === false) return null;
  if (type === 'hit') {
    const w = e.data['weapon'];
    if (w === 'kick') cue = 'kick';
    else if (typeof w === 'string' && w !== 'punch' && e.data['unarmed'] !== true) cue = 'hit';
  }
  const impact = cue === 'crash' ? crashImpact(e, riderSpeedMps) : 1;
  const playerInvolved = e.actor === playerId || e.target === playerId;
  return {
    cue,
    priority: PRIORITY[cue] + (playerInvolved ? PLAYER_BONUS : 0),
    playerInvolved,
    impact,
  };
}
