// sim/modifiers: event modifiers (docs/architecture.md, "Event modifiers"). SimConfig.modifiers
// holds the resolved `event-modifier` entries an event opted into; their effects are a closed list
// in code. W-P (the maintainer, 2026-10-01b) builds the first effect, `set-piece`: roadwork, crash
// scenes, parades, a hay truck and speed traps on the road (./setpieces.ts). The rest of the
// reserved list (gusts, convoys, bounties, guest riders) is still the shelf. Everything rolls on the
// `modifiers` stream only, and the phase runs last in the tick, so it reads every system's state as
// this tick left it.
import type { TuningParamDecl } from '../../core';
import type { SimConfig } from '../types';
import type { SimSystem, World } from '../world';
import { initSetPieces, PROP_CONTACT_KEY, stepSetPieces } from './setpieces';
import { raceState } from '../race';

export { propSnapshots, SET_PIECE, SET_PIECES, setPieceState } from './setpieces';
export type { SetPiece, SetPieceName, SetPieceState, SetProp } from './setpieces';

export const MODIFIERS_TUNING: readonly TuningParamDecl[] = [
  {
    // W-P: how often the road set pieces turn up, as a scale on each one's chance. 0 is none. [default]
    id: 'modifiers.setPieceChance',
    group: 'traffic',
    label: 'Road events',
    default: 1,
    min: 0,
    max: 3,
    step: 0.1,
    unit: '×',
    affectsSim: true,
    system: true,
  },
  {
    // The maintainer, 2026-10-06 ("a road race in a physical world with honest edges"): every set-piece prop
    // a rider can reach is met by the one rule (sim/modifiers/setpieces.ts, PROP_CONTACT). On [default].
    id: PROP_CONTACT_KEY,
    group: 'crashes',
    label: 'Road event props are physical (0 off, 1 on)',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    affectsSim: true,
    system: true,
  },
];

export const modifiersSystem: SimSystem = {
  name: 'modifiers',
  init(world: World, config: SimConfig) {
    initSetPieces(world, config);
  },
  step(world: World, config: SimConfig) {
    stepSetPieces(world, config, raceState(world).over);
  },
};
