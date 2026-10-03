// core: shared low-level types, deterministic math, seeded random streams, hashing and version
// headers (docs/architecture.md, "Ownership table"). Imports nothing from the project. A
// contract: changes land in a small contract PR (docs/milestones/M1.md, "Cross-lane rules").
export * from './math';
export * from './hash';
export * from './rng';
export * from './version';
export * from './layout';
export * from './tuning';
export * from './callbacks';
export * from './ids';
export * from './difficulty';
export * from './surfaces';
export * from './grudge-rules';
export * from './routes';
export * from './smashables';
