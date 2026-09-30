// sim/world: the entity store, the tick order and the system registry API. A contract
// (docs/milestones/M1.md, "Cross-lane rules"): only the tick order and the registry API are fixed.
export { addMover, addStyle, createWorld, emit, noteGrudge, setSlowmo, systemState } from './store';
export type { Mover, World, WorldFacts } from './store';
export { orderSystems, stepWorld, TICK_ORDER } from './tick';
export type { SimSystem, SystemName } from './tick';
export { hashPlain, worldHash } from './hash';
