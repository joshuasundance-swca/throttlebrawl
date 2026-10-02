// Signature moves (interview, 2026-10-02: "Visible personalities"): each rival's one move that is
// both a tell and an opening (docs/content-packs.md, "Rider", `personality.signature`). The rider
// file names the move; this file runs it as a small state machine per rider (tell, act, open) and
// tells the controller (sim/ai index.ts) what to change this tick: the line, the pace, whether it
// may swing, a swing it must throw. Riders, combat and traffic act on the result exactly as on any
// other AI input, so the moves need nothing from the other systems.
//
// All state is plain data in systemState(world, 'ai.signature'); randomness comes only from the
// `ai` stream, and only riders with a move ever draw from it, so a race without signatures replays
// exactly as before. The `ai.signatures` tuning switch (on by default) turns every move off.
//
// Every number here is a [default] feel number.
import type { EntityId } from '../../core';
import { clamp, nextFloat } from '../../core';
import type { RoadNetwork } from '../../road';
import {
  SIGNATURE_IDS,
  SIGNATURE_PHASES,
  SIM_HZ,
  type SignatureId,
  type SignaturePhase,
  type SignatureSnapshot,
} from '../types';
import { systemState, type Mover, type World } from '../world';
import type { ObstacleSize, Reach, Seen } from './sense';

/** Per-rider signature state, by entity id. Indices into SIGNATURE_IDS and SIGNATURE_PHASES; -1 none. */
export interface SignatureState {
  /** The rider's move (SIGNATURE_IDS index), or -1 when it has none. */
  move: number[];
  /** The phase showing now (SIGNATURE_PHASES index), or -1 when nothing shows. */
  phase: number[];
  /** Tick the phase began. */
  since: number[];
  /** Tick the phase ends, or -1 when it lasts until something happens. */
  until: number[];
  /** Whom the move is aimed at, or -1. */
  target: number[];
  /** No new move starts before this tick. */
  next: number[];
  /** Moves started (entered `act`), for tests and the debug report. */
  count: number[];
  /** Ticks spent in each phase (tell, act, open), for tests and the debug report. */
  tellTicks: number[];
  actTicks: number[];
  openTicks: number[];
  /** The last landed hit on this rider the move has seen (tick), so each hit counts once. */
  seenHit: number[];
  /** A move's own number: the bell's held swing flags, the shove or counter already thrown (1). */
  aux: number[];
  /** A move's committed line (road d): Chad's no-hands line, Old Growth's charge, Pivot's new side. */
  lineD: number[];
}

const SIGNATURE_STATE = 'ai.signature';

export function signatureState(world: World): SignatureState {
  return systemState<SignatureState>(world, SIGNATURE_STATE, () => ({
    move: [],
    phase: [],
    since: [],
    until: [],
    target: [],
    next: [],
    count: [],
    tellTicks: [],
    actTicks: [],
    openTicks: [],
    seenHit: [],
    aux: [],
    lineD: [],
  }));
}

/**
 * The signature move `id` shows this tick, for the snapshot; null when none shows. Read-only: it
 * never creates the state, so taking a snapshot cannot change the world's hash.
 */
export function signatureView(world: World, id: EntityId): SignatureSnapshot | null {
  const st = world.systems[SIGNATURE_STATE] as SignatureState | undefined;
  if (!st) return null;
  const move = SIGNATURE_IDS[st.move[id] ?? -1];
  const phase = SIGNATURE_PHASES[st.phase[id] ?? -1];
  if (!move || !phase) return null;
  const until = st.until[id] ?? -1;
  return {
    move,
    phase,
    seconds: Math.max(0, world.tick - (st.since[id] ?? world.tick)) / SIM_HZ,
    left: until < 0 ? -1 : Math.max(0, until - world.tick) / SIM_HZ,
    targetId: st.target[id] ?? -1,
  };
}

// ---- Numbers ([default], ticks at 60 Hz) ------------------------------------------------------

/** How long Gus's bell swings before each hit he throws, ticks. */
export const BELL_TELL_TICKS = 24;

/** No timed move starts in the first seconds of a race (the pack is bunched off the line). */
const FIRST_TICK = 600;

interface MoveSpec {
  /** Ticks of the tell, the act (its longest) and the opening after it. */
  tell: number;
  act: number;
  open: number;
  /** Ticks from one move's start to the earliest next one, plus up to `spread` more (seeded). */
  gap: number;
  spread: number;
}

const SPEC: Readonly<Record<SignatureId, MoveSpec>> = {
  // Chad: phone up (0.5 s), films himself no-hands for 3 s, fumbles it back (0.5 s).
  selfie: { tell: 30, act: 180, open: 30, gap: 720, spread: 600 },
  // The Mayor: a hand up (0.5 s), waves and drifts into the oncoming lane (2.5 s), back (0.5 s).
  wave: { tell: 30, act: 150, open: 30, gap: 600, spread: 480 },
  // Gus: the bell swings for 0.4 s before every hit; the act is the swing's own wind-up.
  bell: { tell: BELL_TELL_TICKS, act: 0, open: 0, gap: 0, spread: 0 },
  // Kevin: brakes to drop level with whoever hit him (up to 0.5 s), counters (up to 0.75 s to get
  // in reach), then files the paperwork (0.67 s, no swings).
  counter: { tell: 30, act: 45, open: 40, gap: 240, spread: 120 },
  // Dial-Up: a twitch (0.33 s), frozen on a dead throttle (0.75 s), lurches back (0.5 s).
  lag: { tell: 20, act: 45, open: 30, gap: 480, spread: 360 },
  // Mother Rust: swings wide (0.5 s), rams across (up to 0.6 s), straightens out (0.83 s).
  ram: { tell: 30, act: 36, open: 50, gap: 360, spread: 240 },
  // Deacon: no timer; his anger is counted in hits.
  'slow-burn': { tell: -1, act: -1, open: 0, gap: 0, spread: 0 },
  // Tammy: rides beside you being nice (1.5 s), shoves (up to 0.67 s to get in reach), cackles (0.5 s).
  'sweet-talk': { tell: 90, act: 40, open: 30, gap: 480, spread: 240 },
  // Juniper: a shoulder check (0.4 s), cuts into your line and brake-checks (up to 1.25 s), then
  // pulls away (0.75 s) right in front of you.
  'cut-in': { tell: 24, act: 75, open: 45, gap: 480, spread: 360 },
  // Old Growth: head down (0.67 s), charges whoever is ahead in his line (up to 1.5 s), winded (1 s).
  timber: { tell: 40, act: 90, open: 60, gap: 540, spread: 360 },
  // Pivot: the blinker (0.5 s), swaps sides with a burst (0.75 s), the battery sags (2 s).
  pivot: { tell: 30, act: 45, open: 120, gap: 540, spread: 360 },
};

/** Deacon's anger: hits taken before he simmers, and before he goes relentless. */
const SIMMER_AT = 1;
const RELENTLESS_AT = 3;
/** Deacon relentless: his swing chance and seek range scale, and how much faster he hunts. */
export const RELENTLESS_AGGRESSION = 1.6;
/** Chad's pace while filming, and the Mayor's while waving. */
const SELFIE_PACE = 0.93;
const WAVE_PACE = 0.97;
/** The Mayor's drift: this share of his lane's width past its centre, toward oncoming traffic. */
const WAVE_DRIFT = 0.75;
/** He waves at a car or a passer-by seen this far ahead, metres. */
const WAVE_SEE_MIN = 20;
const WAVE_SEE_MAX = 250;
/** A rider this close (|ahead| ≤ s, |dd| ≤ d) means a fight is on: no selfie or wave then. */
const BUSY_S = 5;
const BUSY_D = 3;
/** Dial-Up's twitch, metres, and his reconnect lurch. */
const LAG_TWITCH_M = 1;
const LAG_LURCH = 1.12;
/** Dial-Up does not freeze with something in his line this close ahead, metres. */
const LAG_CLEAR_M = 30;
/** Mother Rust rams a target alongside: |ahead| below this, |dd| in [min, max]. */
const RAM_ALONGSIDE_S = 3;
const RAM_DD_MIN = 0.8;
const RAM_DD_MAX = 3.5;
/** How far she swings wide first, and the gap at which the ram has landed. */
const RAM_WIDE_M = 1.2;
const RAM_CONTACT_D = 1;
const RAM_OPEN_PACE = 0.95;
/** Tammy picks a mark this close, and rides beside it this far across. */
const TALK_SEE_S = 12;
const TALK_SEE_D = 5;
const TALK_OFFSET_D = 1.4;
/** Juniper cuts in on a rider this far behind her (metres), in another line (|dd| in [min, max]). */
const CUT_BEHIND_MIN = 3;
const CUT_BEHIND_MAX = 16;
const CUT_DD_MIN = 1;
const CUT_DD_MAX = 5;
/** In the mark's line (|dd| below this) and ahead of it, she brake-checks this much below its speed. */
const CUT_LINE_D = 0.8;
const CUT_BRAKE_MPS = 5;
const CUT_OPEN_PACE = 1.05;
/** Old Growth charges a rider this far ahead in his line (|dd| below the max), this much faster. */
const TIMBER_AHEAD_MIN = 5;
const TIMBER_AHEAD_MAX = 30;
const TIMBER_DD_MAX = 1.5;
const TIMBER_CHARGE_MPS = 7;
/** He cannot steer much in a charge (lateral m/s), and it ends at contact or a sidestep. */
const TIMBER_LATERAL = 0.6;
const TIMBER_CONTACT_S = 1.2;
const TIMBER_SIDESTEP_D = 2.5;
const TIMBER_OPEN_PACE = 0.88;
/** Pivot swaps this far across, with this burst, then sags. */
const PIVOT_SWAP_M = 2.6;
const PIVOT_BURST = 1.15;
const PIVOT_SAG = 0.85;
/** Kevin's counter: how close level (|ahead|) counts as dropped back far enough. */
const COUNTER_LEVEL_S = 1;
/** Kevin's brake: m/s below the attacker's speed per metre it is behind him, and at most. */
const COUNTER_GAIN = 2;
const COUNTER_DROP_MPS = 7;

// ---- The state machine ------------------------------------------------------------------------

const PHASE: Readonly<Record<SignaturePhase, number>> = { tell: 0, act: 1, open: 2 };

/** The move rider `id` has, or null. */
export function moveOf(world: World, id: EntityId): SignatureId | null {
  const st = world.systems[SIGNATURE_STATE] as SignatureState | undefined;
  // A signature is a style quirk too: the `ai.styleQuirks` switch (off: M1's behaviour sets) turns
  // the moves off with the rest. Absent counts as on for the moves' own switch.
  if (!st || (world.params['ai.signatures'] ?? 1) < 0.5 || (world.params['ai.styleQuirks'] ?? 0) < 0.5)
    return null;
  return SIGNATURE_IDS[st.move[id] ?? -1] ?? null;
}

function phaseOf(sg: SignatureState, id: EntityId): SignaturePhase | null {
  return SIGNATURE_PHASES[sg.phase[id] ?? -1] ?? null;
}

function enter(
  sg: SignatureState,
  id: EntityId,
  tick: number,
  phase: SignaturePhase | null,
  ticks: number,
  target = sg.target[id] ?? -1,
): void {
  sg.phase[id] = phase === null ? -1 : PHASE[phase];
  sg.since[id] = tick;
  sg.until[id] = phase === null || ticks < 0 ? -1 : tick + ticks;
  sg.target[id] = phase === null ? -1 : target;
  if (phase === 'act') sg.count[id] = (sg.count[id] ?? 0) + 1;
}

/** Ends the move now and schedules the next one from the move's gap. */
function finish(world: World, sg: SignatureState, id: EntityId, move: SignatureId): void {
  const spec = SPEC[move];
  enter(sg, id, world.tick, null, 0);
  sg.aux[id] = 0;
  sg.next[id] = world.tick + spec.gap + Math.floor(nextFloat(world.rng.ai) * (spec.spread + 1));
}

/** Rolled at race start, in ascending id order, for every AI rider with a move. */
export function initSignature(world: World, id: EntityId, move: SignatureId | undefined): void {
  const sg = signatureState(world);
  sg.move[id] = move ? SIGNATURE_IDS.indexOf(move) : -1;
  sg.phase[id] = -1;
  sg.since[id] = 0;
  sg.until[id] = -1;
  sg.target[id] = -1;
  sg.count[id] = 0;
  sg.tellTicks[id] = 0;
  sg.actTicks[id] = 0;
  sg.openTicks[id] = 0;
  sg.seenHit[id] = -1;
  sg.aux[id] = 0;
  sg.lineD[id] = 0;
  // A move that answers a hit (Kevin's counter) is ready at once; the others wait out the start.
  const spec = move && move !== 'counter' ? SPEC[move] : null;
  sg.next[id] = spec && spec.spread > 0 ? FIRST_TICK + Math.floor(nextFloat(world.rng.ai) * spec.spread) : 0;
}

/** The rider is down, unsticking or out of the race: any move in progress ends (no new roll). */
export function interruptSignature(world: World, id: EntityId): void {
  const sg = world.systems[SIGNATURE_STATE] as SignatureState | undefined;
  if (!sg || (sg.phase[id] ?? -1) < 0) return;
  const move = SIGNATURE_IDS[sg.move[id] ?? -1];
  if (!move || move === 'slow-burn') return;
  enter(sg, id, world.tick, null, 0);
  sg.aux[id] = 0;
  sg.next[id] = Math.max(sg.next[id] ?? 0, world.tick + SPEC[move].gap);
}

// ---- Deacon: slow to anger, then relentless ---------------------------------------------------

/** Deacon's mood this tick: calm (no fight), simmering (still no fight) or relentless. */
export interface SlowBurn {
  mood: 'calm' | 'simmer' | 'relentless';
  /** Whom he is relentless toward (the rider who wronged him most), or -1. */
  huntId: EntityId;
}

/**
 * Deacon's anger from the hits he has taken (`wrongs`: by attacker) and any grudge he holds; sets
 * his showing phase (tell while simmering, act once relentless, both until the race ends).
 */
export function slowBurn(
  world: World,
  id: EntityId,
  wrongs: Readonly<Record<string, number>> | undefined,
  grudges: readonly EntityId[],
): SlowBurn {
  const sg = signatureState(world);
  let anger = 0;
  let huntId = -1;
  let most = 0;
  for (const [k, n] of Object.entries(wrongs ?? {})) {
    anger += n;
    const who = Number(k);
    if (n > most || (n === most && who < huntId)) {
      most = n;
      huntId = who;
    }
  }
  if (grudges.length > 0) {
    anger = Math.max(anger, RELENTLESS_AT);
    if (huntId < 0) huntId = grudges[0] ?? -1;
  }
  const mood = anger >= RELENTLESS_AT ? 'relentless' : anger >= SIMMER_AT ? 'simmer' : 'calm';
  const want = mood === 'relentless' ? PHASE.act : mood === 'simmer' ? PHASE.tell : -1;
  if ((sg.phase[id] ?? -1) !== want) {
    enter(sg, id, world.tick, mood === 'relentless' ? 'act' : mood === 'simmer' ? 'tell' : null, -1, huntId);
  } else if (want >= 0) {
    sg.target[id] = huntId;
  }
  return { mood, huntId };
}

// ---- Gus: the bell before every hit -----------------------------------------------------------

/**
 * A swing Gus decided on (its press flags) is held behind the bell: the bell swings for the tell,
 * then the swing goes. Returns true when the swing was taken (the caller presses nothing now).
 */
export function holdForBell(world: World, id: EntityId, flags: number, victim: EntityId): boolean {
  const sg = signatureState(world);
  if ((sg.phase[id] ?? -1) >= 0) return false;
  sg.aux[id] = flags;
  enter(sg, id, world.tick, 'tell', SPEC.bell.tell, victim);
  return true;
}

/**
 * The bell has rung out: the held swing's flags to press now (and the act shows its wind-up), or 0.
 * Once the wind-up has shown, the move ends, ready for the next swing.
 */
export function releaseBell(world: World, id: EntityId, windupTicks: number): number {
  const sg = signatureState(world);
  const phase = phaseOf(sg, id);
  if (phase === 'act' && world.tick >= (sg.until[id] ?? 0)) enter(sg, id, world.tick, null, 0);
  if (phase !== 'tell' || world.tick < (sg.until[id] ?? 0)) return 0;
  const flags = sg.aux[id] ?? 0;
  sg.aux[id] = 0;
  enter(sg, id, world.tick, 'act', windupTicks);
  return flags;
}

// ---- The timed moves --------------------------------------------------------------------------

/** What the controller sees this tick, for a move to read. */
export interface SignatureCtx {
  world: World;
  road: RoadNetwork;
  m: Mover;
  /** Riders it may fight, as seen from it. */
  riders: readonly Seen[];
  /** Traffic and pedestrians, as seen from it. */
  obstacles: readonly { s: Seen; size: ObstacleSize }[];
  /** Its current fight target, or null. */
  target: Seen | null;
  players: readonly EntityId[];
  /** Racing, not unsticking, not fleeing: free to start a move. */
  free: boolean;
  /** The tick of the last hit landed on it, and who landed it (-1: none). */
  lastHitTick: number;
  lastHitBy: EntityId;
  /** Its lane's centre and width, and the road's rideable d range. */
  laneCentre: number;
  laneWidth: number;
  dLo: number;
  dHi: number;
  /** Its pace for this tick, m/s. */
  speedTarget: number;
  punch: Reach;
  kick: Reach;
}

/** What a move changes this tick. Absent fields leave the controller's own choice. */
export interface SignatureOut {
  dTarget?: number;
  lateralMax?: number;
  lateralGain?: number;
  speedTarget?: number;
  /** No swings this tick (the move is the opening). */
  noSwing?: boolean;
  /** Throw this swing now, whatever the swing timer says. */
  press?: { victim: Seen; kick: boolean };
  /** A dead throttle and no brake (Dial-Up's lag). */
  freeze?: boolean;
}

function inReach(s: Seen, v: number, r: Reach): boolean {
  const ds = s.ahead + (s.vAlong - v) * (r.windupTicks / 60);
  return Math.abs(ds) <= r.sM && Math.abs(s.dd) <= r.dM;
}

function find(c: SignatureCtx, id: EntityId): Seen | null {
  return c.riders.find((r) => r.mover.id === id) ?? null;
}

/** Whether a fight is on around this rider: anyone within a fight's distance. */
function busy(c: SignatureCtx): boolean {
  return c.riders.some((r) => Math.abs(r.ahead) <= BUSY_S && Math.abs(r.dd) <= BUSY_D);
}

/** The side of the road (+1 or −1 in d) its oncoming lanes are on, or 0 on a one-way road. */
export function oncomingSide(road: RoadNetwork, m: Mover): number {
  let own = 0;
  let ownN = 0;
  let other = 0;
  let otherN = 0;
  for (const l of road.lanesAt(m.pos.edge, m.pos.s)) {
    if (l.kind !== 'drive') continue;
    if (l.direction === m.pos.dir) {
      own += l.dCenterM;
      ownN++;
    } else {
      other += l.dCenterM;
      otherN++;
    }
  }
  if (otherN === 0) return 0;
  return other / otherN >= (ownN === 0 ? m.pos.d : own / ownN) ? 1 : -1;
}

/** The nearest candidate, players first. */
function pick(c: SignatureCtx, ok: (r: Seen) => boolean): Seen | null {
  let best: Seen | null = null;
  let bestKey = Infinity;
  for (const r of c.riders) {
    if (!ok(r)) continue;
    const key = Math.abs(r.ahead) + Math.abs(r.dd) + (c.players.includes(r.mover.id) ? 0 : 1000);
    if (key < bestKey) {
      bestKey = key;
      best = r;
    }
  }
  return best;
}

/** Speed that closes the along-road gap to `r` (chase hard, wait gently), m/s. */
function matchSpeed(r: Seen, ahead = r.ahead): number {
  return Math.max(0, r.vAlong + ahead * (ahead >= 0 ? 0.8 : 0.5));
}

/**
 * One tick of rider `c.m`'s timed move (every move but the bell and the slow burn, which the
 * controller runs at its swing and its target choice). Starts a move when its time comes, steps
 * the phases, and says what changes this tick.
 */
export function stepSignature(c: SignatureCtx, move: SignatureId): SignatureOut {
  const { world, m } = c;
  const sg = signatureState(world);
  const id = m.id;
  const tick = world.tick;
  const spec = SPEC[move];
  const hitNow = c.lastHitTick >= 0 && c.lastHitTick > (sg.seenHit[id] ?? -1);
  if (hitNow) sg.seenHit[id] = c.lastHitTick;
  let phase = phaseOf(sg, id);

  // Phase timers: tell → act → open → done.
  if (phase !== null && (sg.until[id] ?? -1) >= 0 && tick >= (sg.until[id] ?? 0)) {
    if (phase === 'tell') {
      enter(sg, id, tick, 'act', spec.act);
      // The committed line: Chad's straight no-hands line; Old Growth's charge down his mark's line.
      if (move === 'selfie') sg.lineD[id] = m.pos.d;
      else if (move === 'timber') sg.lineD[id] = find(c, sg.target[id] ?? -1)?.mover.pos.d ?? m.pos.d;
    } else if (phase === 'act' && spec.open > 0) enter(sg, id, tick, 'open', spec.open);
    else finish(world, sg, id, move);
    phase = phaseOf(sg, id);
  }

  if (phase === null) {
    if (!c.free) return {};
    const started = startMove(c, move, sg, hitNow);
    if (!started) return {};
    phase = phaseOf(sg, id);
  }
  if (phase === 'tell') sg.tellTicks[id] = (sg.tellTicks[id] ?? 0) + 1;
  else if (phase === 'act') sg.actTicks[id] = (sg.actTicks[id] ?? 0) + 1;
  else if (phase === 'open') sg.openTicks[id] = (sg.openTicks[id] ?? 0) + 1;

  switch (move) {
    case 'selfie':
      return selfie(c, sg, phase, hitNow);
    case 'wave':
      return wave(c, sg, phase, hitNow);
    case 'counter':
      return counter(c, sg, phase);
    case 'lag':
      return lag(c, sg, phase);
    case 'ram':
      return ram(c, sg, phase);
    case 'sweet-talk':
      return sweetTalk(c, sg, phase, hitNow);
    case 'cut-in':
      return cutIn(c, sg, phase);
    case 'timber':
      return timber(c, sg, phase);
    case 'pivot':
      return pivot(c, sg, phase);
    default:
      return {};
  }
}

/** Whether `move` starts now; if so it has entered its tell (or act). */
function startMove(c: SignatureCtx, move: SignatureId, sg: SignatureState, hitNow: boolean): boolean {
  const { world, m } = c;
  const id = m.id;
  const tick = world.tick;
  if (tick < (sg.next[id] ?? 0)) return false;
  const tell = SPEC[move].tell;
  switch (move) {
    case 'selfie':
    case 'pivot':
      if (busy(c)) return false;
      enter(sg, id, tick, 'tell', tell, -1);
      if (move === 'pivot') {
        const side = m.pos.d >= c.laneCentre ? -1 : 1;
        sg.lineD[id] = clamp(m.pos.d + side * PIVOT_SWAP_M, c.dLo, c.dHi);
      }
      return true;
    case 'wave': {
      if (busy(c) || oncomingSide(c.road, m) === 0) return false;
      // Anyone to wave at: a car either way, or someone on the verge. The traffic rules pull him
      // back out of the oncoming lane when a car comes, so the drift lasts while that lane is clear.
      const voter = c.obstacles.some((o) => o.s.ahead >= WAVE_SEE_MIN && o.s.ahead <= WAVE_SEE_MAX);
      if (!voter) return false;
      enter(sg, id, tick, 'tell', tell, -1);
      return true;
    }
    case 'counter': {
      if (!hitNow) return false;
      const by = find(c, c.lastHitBy);
      if (!by) return false;
      sg.aux[id] = 0;
      enter(sg, id, tick, 'tell', tell, by.mover.id);
      return true;
    }
    case 'lag': {
      const blocked = c.obstacles.some(
        (o) => o.s.ahead > -2 && o.s.ahead < LAG_CLEAR_M && Math.abs(o.s.dd) < o.size.halfWidth + 1.5,
      );
      if (blocked) return false;
      sg.lineD[id] = nextFloat(world.rng.ai) < 0.5 ? -1 : 1;
      enter(sg, id, tick, 'tell', tell, -1);
      return true;
    }
    case 'ram': {
      const t = c.target;
      if (
        !t ||
        Math.abs(t.ahead) > RAM_ALONGSIDE_S ||
        Math.abs(t.dd) < RAM_DD_MIN ||
        Math.abs(t.dd) > RAM_DD_MAX
      )
        return false;
      // The wide line, away from her target, before she comes back across.
      sg.lineD[id] = clamp(m.pos.d - (t.dd > 0 ? 1 : -1) * RAM_WIDE_M, c.dLo, c.dHi);
      enter(sg, id, tick, 'tell', tell, t.mover.id);
      return true;
    }
    case 'sweet-talk': {
      const mark =
        c.target && Math.abs(c.target.ahead) <= TALK_SEE_S && Math.abs(c.target.dd) <= TALK_SEE_D
          ? c.target
          : pick(
              c,
              (r) =>
                c.players.includes(r.mover.id) &&
                Math.abs(r.ahead) <= TALK_SEE_S &&
                Math.abs(r.dd) <= TALK_SEE_D,
            );
      if (!mark) return false;
      sg.aux[id] = 0;
      enter(sg, id, tick, hitNow ? 'act' : 'tell', hitNow ? SPEC[move].act : tell, mark.mover.id);
      return true;
    }
    case 'cut-in': {
      const mark = pick(
        c,
        (r) =>
          r.ahead <= -CUT_BEHIND_MIN &&
          r.ahead >= -CUT_BEHIND_MAX &&
          Math.abs(r.dd) >= CUT_DD_MIN &&
          Math.abs(r.dd) <= CUT_DD_MAX,
      );
      if (!mark) return false;
      sg.aux[id] = 0;
      enter(sg, id, tick, 'tell', tell, mark.mover.id);
      return true;
    }
    case 'timber': {
      const mark = pick(
        c,
        (r) => r.ahead >= TIMBER_AHEAD_MIN && r.ahead <= TIMBER_AHEAD_MAX && Math.abs(r.dd) <= TIMBER_DD_MAX,
      );
      if (!mark) return false;
      enter(sg, id, tick, 'tell', tell, mark.mover.id);
      return true;
    }
    default:
      return false;
  }
}

/** Chad: phone up, then three seconds no-hands on a straight line, filming. No swings throughout. */
function selfie(
  c: SignatureCtx,
  sg: SignatureState,
  phase: SignaturePhase | null,
  hitNow: boolean,
): SignatureOut {
  const id = c.m.id;
  if (phase === 'act') {
    // Hit while filming: he drops the act (and nearly the phone).
    if (hitNow) {
      enter(sg, id, c.world.tick, 'open', SPEC.selfie.open);
      return { noSwing: true };
    }
    return {
      dTarget: sg.lineD[id] ?? c.m.pos.d,
      lateralMax: 1,
      speedTarget: c.speedTarget * SELFIE_PACE,
      noSwing: true,
    };
  }
  return { noSwing: true };
}

/** The Mayor: a hand up, then he waves at oncoming traffic and drifts over the centre line. */
function wave(
  c: SignatureCtx,
  sg: SignatureState,
  phase: SignaturePhase | null,
  hitNow: boolean,
): SignatureOut {
  const id = c.m.id;
  if (phase === 'act') {
    if (hitNow) {
      enter(sg, id, c.world.tick, 'open', SPEC.wave.open);
      return { noSwing: true };
    }
    const side = oncomingSide(c.road, c.m);
    return {
      dTarget: clamp(c.laneCentre + side * c.laneWidth * WAVE_DRIFT, c.dLo, c.dHi),
      lateralMax: 1.2,
      speedTarget: c.speedTarget * WAVE_PACE,
      noSwing: true,
    };
  }
  return { noSwing: true };
}

/** Kevin: brakes precisely to drop level with whoever hit him, then counters with a kick. */
function counter(c: SignatureCtx, sg: SignatureState, phase: SignaturePhase | null): SignatureOut {
  const id = c.m.id;
  if (phase === 'open') return { noSwing: true };
  const who = find(c, sg.target[id] ?? -1);
  if (!who) {
    finish(c.world, sg, id, 'counter');
    return {};
  }
  const side = who.dd > 0 ? -1 : 1;
  const line = {
    dTarget: clamp(who.mover.pos.d + side * 1.1, c.dLo, c.dHi),
    lateralMax: 3.5,
    // Precise: a firm brake while the attacker is behind him, easing off as they come level.
    speedTarget: Math.max(0, who.vAlong + clamp(who.ahead * COUNTER_GAIN, -COUNTER_DROP_MPS, 3)),
  };
  if (phase === 'tell') {
    if (Math.abs(who.ahead) <= COUNTER_LEVEL_S) enter(sg, id, c.world.tick, 'act', SPEC.counter.act);
    return { ...line, noSwing: true };
  }
  // Act: throw the counter as soon as it reaches; then the act shows its wind-up.
  if ((sg.aux[id] ?? 0) === 0) {
    const v = c.m.speed;
    const kick = inReach(who, v, c.kick);
    if (kick || inReach(who, v, c.punch)) {
      sg.aux[id] = 1;
      sg.until[id] = c.world.tick + (kick ? c.kick : c.punch).windupTicks;
      return { ...line, press: { victim: who, kick } };
    }
  }
  return { ...line, noSwing: true };
}

/** Dial-Up: a twitch, then frozen on a dead throttle, then a lurch as he reconnects. */
function lag(c: SignatureCtx, sg: SignatureState, phase: SignaturePhase | null): SignatureOut {
  const id = c.m.id;
  if (phase === 'tell') {
    return {
      dTarget: clamp(c.m.pos.d + (sg.lineD[id] ?? 1) * LAG_TWITCH_M, c.dLo, c.dHi),
      lateralMax: 4,
      lateralGain: 4,
    };
  }
  if (phase === 'act') {
    // Something in his line after all: the connection comes back early.
    const blocked = c.obstacles.some(
      (o) => o.s.ahead > -2 && o.s.ahead < LAG_CLEAR_M / 2 && Math.abs(o.s.dd) < o.size.halfWidth + 1.5,
    );
    if (blocked) {
      enter(sg, id, c.world.tick, 'open', SPEC.lag.open);
      return { speedTarget: c.speedTarget * LAG_LURCH, noSwing: true };
    }
    // Frozen on the throttle; the bars keep their drift (the line he was on keeps weaving).
    return { noSwing: true, freeze: true };
  }
  return { speedTarget: c.speedTarget * LAG_LURCH, noSwing: true };
}

/** Mother Rust: swings wide, then rams her bike across into her target. */
function ram(c: SignatureCtx, sg: SignatureState, phase: SignaturePhase | null): SignatureOut {
  const id = c.m.id;
  if (phase === 'open') return { speedTarget: c.speedTarget * RAM_OPEN_PACE, noSwing: true };
  const who = find(c, sg.target[id] ?? -1);
  if (!who) {
    finish(c.world, sg, id, 'ram');
    return {};
  }
  if (phase === 'tell') {
    return {
      dTarget: sg.lineD[id] ?? c.m.pos.d,
      lateralMax: 3,
      lateralGain: 2,
      speedTarget: matchSpeed(who),
      noSwing: true,
    };
  }
  if (Math.abs(who.dd) < RAM_CONTACT_D) {
    enter(sg, id, c.world.tick, 'open', SPEC.ram.open);
    return { noSwing: true };
  }
  return {
    dTarget: clamp(who.mover.pos.d, c.dLo, c.dHi),
    lateralMax: 5,
    lateralGain: 3,
    speedTarget: matchSpeed(who),
    noSwing: true,
  };
}

/** Tammy: rides beside her mark being nice, then shoves (a kick). Hit her and she shoves at once. */
function sweetTalk(
  c: SignatureCtx,
  sg: SignatureState,
  phase: SignaturePhase | null,
  hitNow: boolean,
): SignatureOut {
  const id = c.m.id;
  if (phase === 'open') return { noSwing: true };
  const who = find(c, sg.target[id] ?? -1);
  if (!who || Math.abs(who.ahead) > TALK_SEE_S * 1.3) {
    finish(c.world, sg, id, 'sweet-talk');
    return {};
  }
  const side = who.dd > 0 ? -1 : 1;
  const line = {
    dTarget: clamp(who.mover.pos.d + side * TALK_OFFSET_D, c.dLo, c.dHi),
    lateralMax: 3,
    speedTarget: matchSpeed(who),
  };
  if (phase === 'tell') {
    if (hitNow) enter(sg, id, c.world.tick, 'act', SPEC['sweet-talk'].act);
    else return { ...line, noSwing: true };
  }
  if ((sg.aux[id] ?? 0) === 0 && inReach(who, c.m.speed, c.kick)) {
    sg.aux[id] = 1;
    sg.until[id] = c.world.tick + c.kick.windupTicks;
    return { ...line, press: { victim: who, kick: true } };
  }
  // Closing in for the shove: a little nearer than the chat.
  return {
    ...line,
    dTarget: clamp(who.mover.pos.d + side * Math.min(TALK_OFFSET_D, c.kick.dM * 0.8), c.dLo, c.dHi),
    noSwing: true,
  };
}

/** Juniper: a shoulder check, then she cuts into her mark's line just ahead of it and brake-checks. */
function cutIn(c: SignatureCtx, sg: SignatureState, phase: SignaturePhase | null): SignatureOut {
  const id = c.m.id;
  if (phase === 'open') return { speedTarget: c.speedTarget * CUT_OPEN_PACE, noSwing: true };
  const who = find(c, sg.target[id] ?? -1);
  if (!who) {
    finish(c.world, sg, id, 'cut-in');
    return {};
  }
  if (phase === 'tell') return { noSwing: true };
  // The mark got past her: the cut is over.
  if (who.ahead > 0) {
    enter(sg, id, c.world.tick, 'open', SPEC['cut-in'].open);
    return { noSwing: true };
  }
  const inLine = Math.abs(who.dd) < CUT_LINE_D;
  if (inLine) sg.aux[id] = 1;
  return {
    dTarget: clamp(who.mover.pos.d, c.dLo, c.dHi),
    lateralMax: 3.5,
    speedTarget:
      (sg.aux[id] ?? 0) === 1
        ? Math.max(0, who.vAlong - CUT_BRAKE_MPS)
        : Math.max(c.speedTarget, who.vAlong + 1),
    noSwing: true,
  };
}

/** Old Growth: head down, then he charges whoever is ahead in his line, barely steering. */
function timber(c: SignatureCtx, sg: SignatureState, phase: SignaturePhase | null): SignatureOut {
  const id = c.m.id;
  if (phase === 'open') return { speedTarget: c.speedTarget * TIMBER_OPEN_PACE, noSwing: true };
  const who = find(c, sg.target[id] ?? -1);
  if (!who) {
    finish(c.world, sg, id, 'timber');
    return {};
  }
  if (phase === 'tell') return { dTarget: c.m.pos.d, lateralMax: 1, noSwing: true };
  if (who.ahead < TIMBER_CONTACT_S || Math.abs(who.dd) > TIMBER_SIDESTEP_D) {
    enter(sg, id, c.world.tick, 'open', SPEC.timber.open);
    return { noSwing: true };
  }
  return {
    dTarget: sg.lineD[id] ?? c.m.pos.d,
    lateralMax: TIMBER_LATERAL,
    speedTarget: who.vAlong + TIMBER_CHARGE_MPS,
    noSwing: true,
  };
}

/** Pivot: the blinker, then a swap to the other side with a burst; then his battery sags. */
function pivot(c: SignatureCtx, sg: SignatureState, phase: SignaturePhase | null): SignatureOut {
  const id = c.m.id;
  if (phase === 'tell') return {};
  if (phase === 'act') {
    return {
      dTarget: sg.lineD[id] ?? c.m.pos.d,
      lateralMax: 4,
      lateralGain: 2.5,
      speedTarget: c.speedTarget * PIVOT_BURST,
    };
  }
  return { speedTarget: c.speedTarget * PIVOT_SAG, noSwing: true };
}
