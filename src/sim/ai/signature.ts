// Signature moves (interview, 2026-10-02: "Visible personalities"): each rival's one move that is
// both a tell and an opening. This file holds the per-rider state and the snapshot view; the moves
// themselves are driven from the controllers phase (sim/ai). All state is plain data in
// systemState(world, 'ai.signature'); randomness comes only from the `ai` stream.
import type { EntityId } from '../../core';
import { SIGNATURE_IDS, SIGNATURE_PHASES, SIM_HZ, type SignatureSnapshot } from '../types';
import { systemState, type World } from '../world';

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
}

const SIGNATURE_STATE = 'ai.signature';

export function signatureState(world: World): SignatureState {
  return systemState<SignatureState>(world, SIGNATURE_STATE, () => ({
    move: [],
    phase: [],
    since: [],
    until: [],
    target: [],
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
