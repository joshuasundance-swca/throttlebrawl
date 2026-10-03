// SimEvent -> sound cue (docs/architecture.md, "Audio": SFX are event-driven). Every cue is
// synthesized (cue-patches.ts). The table is keyed by string, not by the SimEventType union, so a
// contract PR that adds an event type never breaks this module; cues.test.ts lists the event types
// and says which one still needs a decision. M2 (audio-2) adds the takedown stinger, the slow-motion
// whooshes, the rail clang, the splash, the respawn blip, the style-cash chime, the steal glint, the
// wobble and the near-miss whoosh, and scales crashes by how hard they hit.
import type { SimEvent, SimSnapshot } from '../sim/api';

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
  'tune',
  'modem',
  // Run W-U (sound pass): the W-T events' own sounds, and a rival's finish.
  'ding',
  'smash',
  'toss',
  'paper',
  'slam',
  'surge',
  'logHop',
  'unhitch',
  'runaway',
  'cableBell',
  'shed',
  'vote',
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
  // Dial-Up's Bad Connection (run W-T): the modem screech warns of the drop; only `screech` sounds.
  badConnection: 'modem',
  // Run W-U (sound pass), the W-T events. A roadside smashable breaks, by what it is made of
  // (`data.kind`; cueForEvent sets the variant). A thrown weapon whirls. A moving set piece's moment
  // has its own sound (`data.beat`, cueForEvent). A jump is silent, except a hop over a shed log.
  smash: 'smash',
  throw: 'toss',
  setPieceBeat: 'unhitch', // refined by beat in cueForEvent
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
  tune: 56,
  modem: 66,
  ding: 60,
  smash: 66,
  toss: 50,
  paper: 69,
  slam: 74,
  surge: 56,
  logHop: 52,
  unhitch: 64,
  runaway: 70,
  cableBell: 58,
  shed: 64,
  vote: 60,
};

/** A moving set piece's moment (`setPieceBeat`'s `data.beat`, run W-T) to its cue. */
export const BEAT_CUES: Readonly<Record<string, CueId>> = {
  unhitch: 'unhitch',
  runaway: 'runaway',
  shed: 'shed',
  vote: 'vote',
};

/** Added to a cue's priority when the player is the actor or the target. */
const PLAYER_BONUS = 20;

export interface CueChoice {
  cue: CueId;
  priority: number;
  playerInvolved: boolean;
  /** 0..1: how hard it hit. Crash cues add layers with it; other cues use 1. */
  impact: number;
  /** Which kind of the cue: a smash's `SmashableKind` (what breaks decides how it sounds). */
  variant?: string;
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
  // A hop over a shed log (run W-T's log spill): a wooden thump under the wheels.
  if (type === 'jump' && e.data['cause'] === 'log') cue = 'logHop';
  if (type === 'setPieceBeat') cue = BEAT_CUES[String(e.data['beat'])] ?? null;
  if (cue === null) return null;
  if (PLAYER_ONLY_EVENTS.has(type) && e.actor !== playerId) return null;
  // cops-1's siren event carries `on`; only the start of a chase whoops.
  if (type === 'siren' && e.data['on'] === false) return null;
  // Bad Connection: the screech is the warning; the drop and the reconnect are seen, not heard.
  if (type === 'badConnection' && e.data['phase'] !== 'screech') return null;
  if (type === 'hit') {
    const w = e.data['weapon'];
    if (w === 'kick') cue = 'kick';
    // Run W-T: a landing on a rider ("Air that pays") is a body slam, not a weapon's clang; a thrown
    // briefcase that bursts lands with its paperwork.
    else if (w === 'landing') cue = 'slam';
    else if (e.data['burst'] === true) cue = 'paper';
    else if (typeof w === 'string' && w !== 'punch' && e.data['unarmed'] !== true) cue = 'hit';
  }
  // A clean landing after real air surges (pitch deck #13): the thump and a rush of air.
  if (type === 'land' && e.data['surge'] === true) cue = 'surge';
  // The finish: the boxing bell rings you in (three strikes); a rival's finish is one ding.
  if (type === 'finish' && e.actor !== playerId) cue = 'ding';
  const impact = cue === 'crash' ? crashImpact(e, riderSpeedMps) : 1;
  const playerInvolved = e.actor === playerId || e.target === playerId;
  const kind = e.data['kind'];
  return {
    cue,
    priority: PRIORITY[cue] + (playerInvolved ? PLAYER_BONUS : 0),
    playerInvolved,
    impact,
    ...(cue === 'smash' && typeof kind === 'string' ? { variant: kind } : {}),
  };
}

/** The cues that land on a body: they sound meatier as the target weakens (cue-patches.ts, MEATY). */
export const MELEE_CUES: ReadonlySet<CueId> = new Set<CueId>(['punch', 'kick', 'hit', 'slam', 'paper']);

/**
 * How beaten a rival is, 0 (full health) to 1 (nearly down), read from the snapshot (playtest 2,
 * 2026-10-02 audio: "hits sound lower and meatier as a rival weakens"). 0 for anyone who is not an
 * AI rider: the player's own hits-taken, traffic and an unknown target stay as they were. The
 * snapshot may be a tick behind the hit, which is a fraction of a hit's damage and not audible.
 */
export function weaknessOf(snapshot: SimSnapshot | null | undefined, targetId: number | undefined): number {
  if (!snapshot || targetId === undefined) return 0;
  const t =
    snapshot.entities[targetId]?.id === targetId
      ? snapshot.entities[targetId]
      : snapshot.entities.find((x) => x.id === targetId);
  if (!t || t.kind !== 'rider' || t.slot >= 0 || !(t.healthMax > 0)) return 0;
  return clamp01(1 - t.health / t.healthMax);
}
