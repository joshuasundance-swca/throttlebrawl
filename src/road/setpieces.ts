// Set pieces from the race seed (playtest 1c item 2, [decided] 2026-09-30: "I want randomness so you
// don't see the same cars in the same order, ramp truck in the same place, etc"). A `boostPad` or
// `rampTruck` feature whose `params.slot` names a slot is one candidate for that slot: each race's
// seed picks one candidate per slot, and the others are not there that race. A set piece without a
// slot is always there. Pure and deterministic (integer hashing only, on its own seed stream, so no
// sim roll moves), so the sim, render and tools all agree on a seed's placement.
import { createRng, nextU32, streamSeed } from '../core';
import type { BakedFeature } from './types';

/** The feature kinds a slot may hold. */
export const SEEDED_SET_PIECE_KINDS: readonly string[] = ['boostPad', 'rampTruck'];

/** A feature's slot name, or null when it is always there (no slot, or not a set-piece kind). */
export function setPieceSlot(f: BakedFeature): string | null {
  if (!SEEDED_SET_PIECE_KINDS.includes(f.kind)) return null;
  const v = f.params?.['slot'];
  return typeof v === 'string' && v !== '' ? v : null;
}

/** Every slot's candidates over a network's edges: slot name to feature ids, in id order. */
export function setPieceSlots(
  edges: readonly { readonly features: readonly BakedFeature[] }[],
): ReadonlyMap<string, readonly string[]> {
  const slots = new Map<string, string[]>();
  for (const e of edges) {
    for (const f of e.features) {
      const slot = setPieceSlot(f);
      if (slot === null) continue;
      const ids = slots.get(slot) ?? [];
      ids.push(f.id);
      slots.set(slot, ids);
    }
  }
  for (const ids of slots.values()) ids.sort();
  return slots;
}

/** The candidates a race seed picks: one feature id per slot. */
export function chooseSetPieces(
  edges: readonly { readonly features: readonly BakedFeature[] }[],
  seed: number,
): ReadonlySet<string> {
  const chosen = new Set<string>();
  const slots = setPieceSlots(edges);
  for (const name of [...slots.keys()].sort()) {
    const ids = slots.get(name) ?? [];
    if (ids.length === 0) continue;
    const pick = ids[nextU32(createRng(streamSeed(seed, `setPiece:${name}`))) % ids.length];
    if (pick !== undefined) chosen.add(pick);
  }
  return chosen;
}

/** Whether a feature is there in a race whose picked candidates are `chosen`. */
export function setPieceActive(f: BakedFeature, chosen: ReadonlySet<string>): boolean {
  return setPieceSlot(f) === null || chosen.has(f.id);
}
